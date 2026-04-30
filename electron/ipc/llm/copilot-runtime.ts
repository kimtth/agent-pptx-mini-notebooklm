import type { SessionConfig } from '@github/copilot-sdk';
import { createRequire } from 'module';
import { resolveBundledPath } from '../project/workspace-utils.ts';

const AZURE_OPENAI_SCOPE = 'https://cognitiveservices.azure.com/.default';
const require = createRequire(import.meta.url);

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

export async function getSessionOptions(opts?: {
  streaming?: boolean;
  model?: string;
}): Promise<Partial<SessionConfig>> {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT?.trim();
  const modelName = opts?.model ?? process.env.MODEL_NAME;
  const streaming = opts?.streaming ?? false;
  const reasoningEffort = resolveReasoningEffort();
  const useAzureOpenAI = resolveCopilotModelSource() === 'azure-openai';
  const useGitHubModels = !useAzureOpenAI;

  const effort = reasoningEffort ? { reasoningEffort } : {};
  if (!modelName && !useAzureOpenAI) return { streaming, ...effort };
  if (useGitHubModels) {
    return { ...(modelName ? { model: modelName } : {}), streaming, ...effort };
  }

  if (useAzureOpenAI) {
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

  throw new Error('Invalid model session configuration.');
}

export function resolveWorkflowInstructionPath(fileName: string): string {
  return resolveBundledPath('workflows', fileName);
}

export function normalizeGitHubToken(value: string | undefined): string | undefined {
  const raw = (value ?? '').trim();
  if (!raw) return undefined;
  const noBearer = raw.replace(/^Bearer\s+/i, '');
  const unquoted = noBearer.replace(/^['\"](.*)['\"]$/, '$1').trim();
  return unquoted || undefined;
}

export function resolveCopilotCliPath(): string {
  const nativePkg = `@github/copilot-${process.platform}-${process.arch}`;
  let resolved = require.resolve(nativePkg);
  // Native executables can't run from inside an asar archive.
  // electron-builder's asarUnpack extracts them to app.asar.unpacked/.
  if (resolved.includes('app.asar') && !resolved.includes('app.asar.unpacked')) {
    resolved = resolved.replace('app.asar', 'app.asar.unpacked');
  }
  return resolved;
}