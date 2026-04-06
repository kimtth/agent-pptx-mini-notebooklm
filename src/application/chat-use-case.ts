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
  pptxBuildError: string | null;
  theme: ThemeTokens | null;
  workflow: WorkflowConfig | null;
  dataSources: DataFile[];
  urlSources: Array<{ url: string; status: string; result?: ScrapeResult }>;
  iconProvider: 'iconify';
  iconCollection: IconifyCollectionId;
  availableIcons: string[];
  includeImagesInLayout?: boolean;
  chunkSize?: number;
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

/**
 * Strip Python / pptx fenced code blocks from content for chat display.
 * The stored message is unchanged — only the rendered output is filtered.
 * When `streaming` is true, any trailing unclosed python fence is also hidden.
 */
export function stripPythonCodeForDisplay(content: string, streaming = false): string {
  // Replace complete ```python / ```py fenced code blocks
  let result = content.replace(
    /```(?:python|py)\s*\r?\n[\s\S]*?```/g,
    '',
  )

  // Also strip unlabeled fenced blocks that look like python-pptx code
  result = result.replace(
    /```\s*\r?\n([\s\S]*?)```/g,
    (_match, body: string) => looksLikePythonPptxCode(body) ? '' : _match,
  )

  // For streaming: hide trailing unclosed python code fence
  if (streaming) {
    result = result.replace(/```(?:python|py)\s*\r?\n[\s\S]*$/, '')
  }

  // Clean up excessive blank lines
  result = result.replace(/\n{3,}/g, '\n\n')
  return result.trim()
}
