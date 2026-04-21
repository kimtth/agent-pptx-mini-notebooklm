/**
 * Vercel AI SDK Adapter
 *
 * Implements LLMProvider for Azure OpenAI, OpenAI, and Claude using
 * the Vercel AI SDK (`ai` package) with provider-specific packages.
 *
 * This adapter handles streaming, tool calling, and the multi-turn
 * tool execution loop that the Copilot SDK manages internally.
 */

import type {
  LLMProvider,
  LLMProviderCapabilities,
  LLMSession,
  LLMSessionConfig,
  LLMStreamDelta,
  LLMToolDefinition,
  LLMUsageSummary,
  ProviderType,
} from './llm-provider.ts';

// ---------------------------------------------------------------------------
// AI SDK model resolution
// ---------------------------------------------------------------------------

/**
 * Dynamically resolve the AI SDK `LanguageModel` based on provider type
 * and environment settings.  Imports are dynamic to avoid pulling in
 * every provider package at startup.
 */
async function resolveModel(
  providerType: ProviderType,
  modelName: string | undefined,
) {
  if (providerType === 'openai') {
    const { createOpenAI } = await import('@ai-sdk/openai');
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) throw new Error('OPENAI_API_KEY is required for the OpenAI provider.');
    const openai = createOpenAI({ apiKey });
    if (!modelName) throw new Error('MODEL_NAME is required for the OpenAI provider.');
    return openai(modelName);
  }

  if (providerType === 'azure-openai') {
    const { createAzure } = await import('@ai-sdk/azure');
    const endpoint = process.env.AZURE_OPENAI_ENDPOINT?.trim();
    if (!endpoint) throw new Error('AZURE_OPENAI_ENDPOINT is required for the Azure OpenAI provider.');
    const apiKey = process.env.AZURE_OPENAI_API_KEY?.trim();
    if (!apiKey) throw new Error('AZURE_OPENAI_API_KEY is required for the Azure OpenAI provider.');
    const azure = createAzure({
      resourceName: '',        // not used when baseURL is set
      apiKey,
      baseURL: endpoint.replace(/\/$/, ''),
    });
    if (!modelName) throw new Error('MODEL_NAME (deployment name) is required for Azure OpenAI.');
    return azure(modelName);
  }

  if (providerType === 'claude') {
    const { createAnthropic } = await import('@ai-sdk/anthropic');
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is required for the Claude provider.');
    const anthropic = createAnthropic({ apiKey });
    if (!modelName) throw new Error('MODEL_NAME is required for the Claude provider.');
    return anthropic(modelName);
  }

  throw new Error(`Unsupported AI SDK provider type: ${providerType}`);
}

// ---------------------------------------------------------------------------
// Tool conversion: LLMToolDefinition → AI SDK tool map
// ---------------------------------------------------------------------------

async function convertTools(tools: LLMToolDefinition[]) {
  const { tool: aiTool } = await import('ai');
  const { z } = await import('zod');

  const toolMap: Record<string, any> = {};
  for (const t of tools) {
    // Convert JSON Schema parameters to a Zod schema.
    // AI SDK expects Zod; we do a pragmatic conversion for the
    // object-level schema used by our tools.
    const props: Record<string, any> = {};
    const required = new Set(t.parameters.required ?? []);

    for (const [key, schema] of Object.entries(t.parameters.properties)) {
      const s = schema as any;
      let zType: any;

      if (s.type === 'string') {
        zType = s.enum ? z.enum(s.enum) : z.string();
      } else if (s.type === 'number') {
        zType = z.number();
      } else if (s.type === 'boolean') {
        zType = z.boolean();
      } else if (s.type === 'array') {
        const items = s.items as any;
        if (items?.type === 'string') {
          zType = z.array(z.string());
        } else if (items?.type === 'number') {
          zType = z.array(z.number());
        } else if (items?.type === 'object') {
          zType = z.array(z.record(z.string(), z.unknown()));
        } else {
          zType = z.array(z.unknown());
        }
      } else if (s.type === 'object') {
        zType = z.record(z.string(), z.unknown());
      } else {
        zType = z.unknown();
      }

      if (s.description) {
        zType = zType.describe(s.description);
      }

      props[key] = required.has(key) ? zType : zType.optional();
    }

    toolMap[t.name] = aiTool({
      description: t.description,
      inputSchema: z.object(props),
    });
  }

  return toolMap;
}

// ---------------------------------------------------------------------------
// Skill content inlining (replaces skillDirectories for non-Copilot)
// ---------------------------------------------------------------------------

async function inlineSkillContent(skillDirectories: string[]): Promise<string> {
  if (!skillDirectories || skillDirectories.length === 0) return '';

  const fs = await import('fs/promises');
  const path = await import('path');
  const parts: string[] = [];

  for (const dir of skillDirectories) {
    try {
      const entries = await fs.readdir(dir);
      for (const entry of entries) {
        if (!entry.endsWith('.instructions.md') && !entry.endsWith('.prompt.md')) continue;
        const content = await fs.readFile(path.join(dir, entry), 'utf-8');
        if (content.trim()) {
          parts.push(`--- ${entry} ---\n${content.trim()}`);
        }
      }
    } catch {
      // Directory not accessible — skip
    }
  }

  return parts.length > 0
    ? '\n\n## Skill Instructions\n\n' + parts.join('\n\n')
    : '';
}

// ---------------------------------------------------------------------------
// AI SDK Provider factory
// ---------------------------------------------------------------------------

function createAISDKProvider(providerType: ProviderType): LLMProvider {
  return {
    id: providerType,

    capabilities: {
      supportsToolCalls: true,
      supportsReasoningDeltas: providerType === 'claude',
      supportsSkillDirectories: false,
    } satisfies LLMProviderCapabilities,

    reset(): void {
      // No persistent client to reset — AI SDK creates fresh per-call
    },

    async createSession(
      config: LLMSessionConfig,
      onDelta: (delta: LLMStreamDelta) => void,
    ): Promise<LLMSession> {
      const { streamText } = await import('ai');

      const model = await resolveModel(providerType, config.model);
      const tools = config.tools.length > 0 ? await convertTools(config.tools) : undefined;

      // Inline skill content into the system prompt
      const skillInstructions = await inlineSkillContent(config.skillDirectories ?? []);
      const systemMessage = config.systemMessage + skillInstructions;

      let abortController: AbortController | null = null;

      // Build a tool handler map for executing tool calls from the stream
      const toolHandlerMap = new Map<string, LLMToolDefinition['handler']>();
      for (const t of config.tools) {
        toolHandlerMap.set(t.name, t.handler);
      }

      return {
        async sendAndWait(prompt: string, _timeoutMs: number): Promise<void> {
          abortController = new AbortController();

          const result = streamText({
            model,
            system: systemMessage,
            prompt,
            tools,
            maxRetries: 0,
            abortSignal: abortController.signal,
            onError: ({ error }) => {
              const message = error instanceof Error ? error.message : String(error);
              onDelta({ type: 'error', message });
            },
          });

          for await (const part of result.fullStream) {
            if (part.type === 'text-delta') {
              if (part.text) {
                onDelta({ type: 'content', text: part.text });
              }
            } else if (part.type === 'reasoning-delta') {
              if (part.text) {
                onDelta({ type: 'thinking', text: part.text });
              }
            } else if (part.type === 'tool-call') {
              // Execute tool call and feed result back
              const handler = toolHandlerMap.get(part.toolName);
              if (handler) {
                try {
                  await handler(part.input);
                } catch (err) {
                  const msg = err instanceof Error ? err.message : String(err);
                  console.error(`[aisdk] Tool ${part.toolName} failed:`, msg);
                }
              }
            } else if (part.type === 'error') {
              const message = part.error instanceof Error ? part.error.message : String(part.error);
              onDelta({ type: 'error', message });
            }
            // tool-call and tool-result are handled internally by maxSteps
          }

          const [totalUsage, finishReason] = await Promise.all([
            result.totalUsage,
            result.finishReason,
          ]);
          const usage: LLMUsageSummary = {
            provider: providerType,
            model: config.model,
            inputTokens: totalUsage.inputTokens,
            outputTokens: totalUsage.outputTokens,
            totalTokens: totalUsage.totalTokens,
            reasoningTokens: totalUsage.outputTokenDetails.reasoningTokens,
            cacheReadTokens: totalUsage.inputTokenDetails.cacheReadTokens,
            cacheWriteTokens: totalUsage.inputTokenDetails.cacheWriteTokens,
            finishReason,
          };
          onDelta({ type: 'usage', usage });
        },

        async cancel(): Promise<void> {
          abortController?.abort();
        },

        async disconnect(): Promise<void> {
          abortController?.abort();
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Exported provider instances
// ---------------------------------------------------------------------------

export const openaiProvider = createAISDKProvider('openai');
export const azureOpenAIProvider = createAISDKProvider('azure-openai');
export const claudeProvider = createAISDKProvider('claude');
