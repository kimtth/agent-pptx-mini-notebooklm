/**
 * Application: Chat Use Case
 * Business logic for chat history, prompt formatting, and workspace serialization.
 */

import type { SlideItem, DesignBrief, DesignStyle, FrameworkType, TemplateMeta } from '../domain/entities/slide-work';
import type { ThemeTokens } from '../domain/entities/palette';
import type { DataFile, ScrapeResult } from '../domain/ports/ipc';
import type { IconifyCollectionId } from '../domain/icons/iconify';
import type { WorkflowConfig } from '../domain/workflows/workflow-config';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  thinking?: string;
  timestamp: number;
}

export interface WorkspaceContext {
  title: string;
  slides: SlideItem[];
  designBrief: DesignBrief | null;
  designStyle: DesignStyle | null;
  framework: FrameworkType | null;
  templateMeta: TemplateMeta | null;
  pptxBuildError?: string | null;
  theme: ThemeTokens | null;
  workflow: WorkflowConfig | null;
  dataSources: DataFile[];
  urlSources: Array<{ url: string; status: string; result?: ScrapeResult }>;
  iconProvider: 'iconify';
  iconCollection: IconifyCollectionId;
  availableIcons: string[];
}

export function createUserMessage(content: string): ChatMessage {
  return { id: crypto.randomUUID(), role: 'user', content, timestamp: Date.now() };
}

export function createAssistantMessage(content: string, thinking?: string): ChatMessage {
  return { id: crypto.randomUUID(), role: 'assistant', content, thinking, timestamp: Date.now() };
}

export function historyToIpc(messages: ChatMessage[]): Array<{ role: 'user' | 'assistant'; content: string }> {
  return messages.slice(-20).map(({ role, content }) => ({ role, content }));
}

function isSupportedPythonFenceInfo(info: string): boolean {
  if (!info) return true
  const normalized = info.trim().toLowerCase()
  return normalized === 'python' || normalized === 'py'
}

export function extractPptxCodeBlock(content: string): string | null {
  const blocks = [...content.matchAll(/```([^\r\n`]*)[ \t]*\r?\n([\s\S]*?)```/g)]
    .filter((match) => isSupportedPythonFenceInfo(match[1] ?? ''))
  if (blocks.length === 0) return null

  const preferred = blocks.find((match) => {
    const language = (match[1] ?? '').trim().toLowerCase()
    return language === 'python' || language === 'py'
  }) ?? blocks.find((match) => looksLikePythonPptxCode(match[2] ?? ''))

  return preferred?.[2]?.trim() || null
}

function looksLikePythonPptxCode(code: string): boolean {
  return /from\s+pptx\s+import|import\s+pptx|Presentation\(|def\s+build_presentation\s*\(/i.test(code)
}
