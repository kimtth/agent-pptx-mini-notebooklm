/**
 * Copilot LLM Adapter
 *
 * Wraps the existing @github/copilot-sdk flow behind the LLMProvider
 * contract.  Preserves native CLI resolution, skillDirectories,
 * approveAll, and Copilot-specific streaming events.
 */

import { CopilotClient, defineTool, approveAll } from '@github/copilot-sdk';
import type { SessionConfig } from '@github/copilot-sdk';
import { normalizeGitHubToken, resolveCopilotCliPath } from './copilot-runtime.ts';
import type {
  LLMProvider,
  LLMProviderCapabilities,
  LLMSession,
  LLMSessionConfig,
  LLMStreamDelta,
  LLMToolDefinition,
} from './llm-provider.ts';

const AZURE_OPENAI_SCOPE = 'https://cognitiveservices.azure.com/.default';

// ---------------------------------------------------------------------------
// Copilot client singleton
// ---------------------------------------------------------------------------

let clientInstance: CopilotClient | null = null;

function getCopilotClient(): CopilotClient {
  if (!clientInstance) {
    const token = normalizeGitHubToken(process.env.GITHUB_TOKEN);
    const cliPath = resolveCopilotCliPath();
    clientInstance = new CopilotClient({
      cliPath,
      ...(token ? { githubToken: token } : {}),
      ...(token ? { useLoggedInUser: false } : {}),
    });
  }
  return clientInstance;
}

// ---------------------------------------------------------------------------
// Session options (GitHub Models vs Azure OpenAI via Copilot SDK provider)
// ---------------------------------------------------------------------------

function resolveReasoningEffort(): 'low' | 'medium' | 'high' | undefined {
  const value = process.env.REASONING_EFFORT?.trim().toLowerCase();
  if (value === 'low' || value === 'medium' || value === 'high') return value;
  return undefined;
}

function resolveCopilotModelSource(): 'github-hosted' | 'azure-openai' {
  return process.env.COPILOT_MODEL_SOURCE?.trim().toLowerCase() === 'azure-openai'
    ? 'azure-openai'
    : 'github-hosted';
}

async function getSessionOptions(config: LLMSessionConfig): Promise<Partial<SessionConfig>> {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT?.trim();
  const modelName = config.model ?? process.env.MODEL_NAME;
  const streaming = config.streaming ?? false;
  const reasoningEffort = config.reasoningEffort ?? resolveReasoningEffort();
  const useAzureOpenAI = resolveCopilotModelSource() === 'azure-openai';

  const effort = reasoningEffort ? { reasoningEffort } : {};
  if (!modelName && !useAzureOpenAI) return { streaming, ...effort };
  if (!useAzureOpenAI) {
    return { ...(modelName ? { model: modelName } : {}), streaming, ...effort };
  }

  // Azure OpenAI via Copilot SDK provider
  if (!endpoint || !modelName) {
    throw new Error('AZURE_OPENAI_ENDPOINT and MODEL_NAME are required to use Azure OpenAI / Foundry model serving');
  }

  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  let auth: { apiKey?: string; bearerToken?: string };
  if (apiKey && apiKey.trim()) {
    auth = { apiKey: apiKey.trim() };
  } else {
    const { DefaultAzureCredential } = await import('@azure/identity');
    const tenantId = process.env.AZURE_TENANT_ID?.trim() || undefined;
    const credential = new DefaultAzureCredential(tenantId ? { tenantId } : undefined);
    const tokenResult = await credential.getToken(AZURE_OPENAI_SCOPE);
    if (!tokenResult) throw new Error('Failed to acquire Azure bearer token. Set AZURE_OPENAI_API_KEY or run "az login".');
    auth = { bearerToken: tokenResult.token };
  }

  return {
    model: modelName,
    streaming,
    ...effort,
    provider: {
      type: 'openai',
      baseUrl: endpoint.replace(/\/$/, ''),
      ...auth,
      wireApi: 'responses',
    },
  };
}

// ---------------------------------------------------------------------------
// Tool conversion: LLMToolDefinition → Copilot SDK tool
// ---------------------------------------------------------------------------

function convertTools(tools: LLMToolDefinition[]) {
  return tools.map((t) =>
    defineTool(t.name, {
      description: t.description,
      parameters: t.parameters as any,
      handler: t.handler as any,
    }),
  );
}

// ---------------------------------------------------------------------------
// LLMProvider implementation
// ---------------------------------------------------------------------------

export const copilotProvider: LLMProvider = {
  id: 'copilot',

  capabilities: {
    supportsToolCalls: true,
    supportsReasoningDeltas: true,
    supportsSkillDirectories: true,
  } satisfies LLMProviderCapabilities,

  reset(): void {
    clientInstance = null;
  },

  async createSession(
    config: LLMSessionConfig,
    onDelta: (delta: LLMStreamDelta) => void,
  ): Promise<LLMSession> {
    const copilot = getCopilotClient();
    const sessionOpts = await getSessionOptions(config);

    const copilotConfig: SessionConfig = {
      ...sessionOpts,
      tools: convertTools(config.tools),
      ...(config.skillDirectories?.length
        ? { skillDirectories: config.skillDirectories }
        : {}),
      systemMessage: {
        mode: 'append' as const,
        content: config.systemMessage,
      },
      onPermissionRequest: approveAll,
    };

    const session = await copilot.createSession(copilotConfig);

    // Wire streaming events → normalized deltas
    session.on('assistant.reasoning_delta', (event) => {
      const text = event.data?.deltaContent ?? '';
      if (text) onDelta({ type: 'thinking', text });
    });
    session.on('assistant.message_delta', (event) => {
      const text = event.data?.deltaContent ?? '';
      if (text) onDelta({ type: 'content', text });
    });
    session.on('session.error', (event) => {
      const message = event.data?.message ?? 'Unknown Copilot session error';
      onDelta({ type: 'error', message });
    });

    return {
      async sendAndWait(prompt: string, timeoutMs: number): Promise<void> {
        await session.sendAndWait({ prompt }, timeoutMs);
      },
      async cancel(): Promise<void> {
        await session.disconnect().catch(() => {});
      },
      async disconnect(): Promise<void> {
        await session.disconnect().catch(() => {});
      },
    };
  },
};
