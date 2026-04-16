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
  customFrameworkPrompt: string | null;
  templateMeta: TemplateMeta | null;
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
