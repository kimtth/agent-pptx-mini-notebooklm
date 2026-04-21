/**
 * LLM Provider Contract
 *
 * Normalized interface for chat/streaming/tool-calling across multiple
 * LLM backends.  The chat handler uses this contract exclusively —
 * provider-specific details live in adapter modules.
 */

// ---------------------------------------------------------------------------
// Tool definition — provider-neutral
// ---------------------------------------------------------------------------

/** JSON Schema object for tool parameters (OpenAI function-calling style). */
export type ToolParametersSchema = {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
};

/** Provider-neutral tool definition. */
export interface LLMToolDefinition {
  name: string;
  description: string;
  parameters: ToolParametersSchema;
  handler: (args: any) => Promise<{ success: boolean; message?: string; error?: string; content?: string }>;
}

export interface LLMUsageSummary {
  provider: ProviderType;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  finishReason?: string;
  cost?: number;
}

// ---------------------------------------------------------------------------
// Stream events — normalized for the renderer
// ---------------------------------------------------------------------------

export type LLMStreamDelta =
  | { type: 'content'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'usage'; usage: LLMUsageSummary }
  | { type: 'error'; message: string };

// ---------------------------------------------------------------------------
// Session configuration
// ---------------------------------------------------------------------------

export interface LLMSessionConfig {
  /** System prompt (appended or replaced depending on provider). */
  systemMessage: string;
  /** Provider-neutral tool definitions. */
  tools: LLMToolDefinition[];
  /** Skill / instruction directories (Copilot-only; others inline into systemMessage). */
  skillDirectories?: string[];
  /** Model name or deployment (interpretation is provider-specific). */
  model?: string;
  /** Enable streaming. */
  streaming?: boolean;
  /** Reasoning effort hint. */
  reasoningEffort?: 'low' | 'medium' | 'high';
}

// ---------------------------------------------------------------------------
// Session handle
// ---------------------------------------------------------------------------

export interface LLMSession {
  /** Send a user prompt and wait for completion (handles tool loop internally). */
  sendAndWait(prompt: string, timeoutMs: number): Promise<void>;
  /** Cancel an in-flight request. */
  cancel(): Promise<void>;
  /** Release resources. */
  disconnect(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Provider capabilities
// ---------------------------------------------------------------------------

export interface LLMProviderCapabilities {
  supportsToolCalls: boolean;
  supportsReasoningDeltas: boolean;
  supportsSkillDirectories: boolean;
}

// ---------------------------------------------------------------------------
// Provider interface
// ---------------------------------------------------------------------------

export interface LLMProvider {
  readonly id: string;
  readonly capabilities: LLMProviderCapabilities;

  /** Create a session with the given config. */
  createSession(
    config: LLMSessionConfig,
    onDelta: (delta: LLMStreamDelta) => void,
  ): Promise<LLMSession>;

  /** Reset any cached clients (e.g. after settings change). */
  reset(): void;
}

// ---------------------------------------------------------------------------
// Provider registry
// ---------------------------------------------------------------------------

export type ProviderType = 'copilot' | 'azure-openai' | 'openai' | 'claude';

const registry = new Map<ProviderType, LLMProvider>();

export function registerProvider(type: ProviderType, provider: LLMProvider): void {
  registry.set(type, provider);
}

export function getProvider(type: ProviderType): LLMProvider {
  const p = registry.get(type);
  if (!p) throw new Error(`LLM provider "${type}" is not registered.`);
  return p;
}

/** Resolve the active provider type from environment / settings. */
export function resolveActiveProviderType(): ProviderType {
  const explicit = process.env.LLM_PROVIDER?.trim().toLowerCase();
  if (explicit === 'openai' || explicit === 'claude' || explicit === 'azure-openai') {
    return explicit as ProviderType;
  }
  // Legacy detection: AZURE_OPENAI_ENDPOINT without explicit provider → azure-openai
  if (process.env.AZURE_OPENAI_ENDPOINT?.trim()) return 'azure-openai';
  // Default
  return 'copilot';
}

export function getActiveProvider(): LLMProvider {
  return getProvider(resolveActiveProviderType());
}

/** Reset all registered providers (used on settings change). */
export function resetAllProviders(): void {
  for (const p of registry.values()) p.reset();
}
