/**
 * Domain Port: IPC API surface exposed by electron/preload.ts
 * This interface is mirrored by window.electronAPI in the renderer.
 */

import type { ScenarioPayload, SlideItem, SlideUpdatePayload, TemplateMeta } from '../entities/slide-work';
import type { PaletteColor, ThemeSlots, ThemeTokens } from '../entities/palette';
import type { IconifyCollectionId } from '../icons/iconify';
import type { WorkflowConfig } from '../workflows/workflow-config';

export interface SourceArtifact {
  markdownPath: string;
  summaryPath: string;
  summaryText: string;
}

export interface DataFile {
  path: string;
  name: string;
  type: 'csv' | 'docx' | 'txt' | 'md' | 'pdf';
  headers?: string[];
  rows?: Record<string, string>[];
  text?: string;
  summary: string;
  consumed?: SourceArtifact;
}

export interface ScrapeResult {
  url: string;
  title: string;
  text: string;
  lists: string[];
  error?: string;
  consumed?: SourceArtifact;
}

export interface ImageSearchRequest {
  number: number;
  title: string;
  keyMessage: string;
  bullets: string[];
  imageQuery?: string | null;
  imageQueries?: string[];
}

export interface ImageSearchCandidate {
  id: string;
  provider: 'direct' | 'google' | 'bing';
  searchQuery: string | null;
  title: string | null;
  imageUrl: string | null;
  thumbnailUrl: string | null;
  sourcePageUrl: string | null;
  attribution: string | null;
  inlineImageDataUrl: string | null;
}

export interface ImageSearchResult {
  query: string;
  candidates: ImageSearchCandidate[];
}

export interface ResolvedSlideImage {
  id: string;
  number: number;
  imageQuery: string | null;
  imageUrl: string | null;
  imagePath: string | null;
  imageAttribution: string | null;
  sourcePageUrl: string | null;
  thumbnailUrl: string | null;
}

export interface IpcChatAPI {
  send(
    message: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }>,
    workspace: {
      title: string;
      slides: import('../entities/slide-work').SlideItem[];
      designBrief: import('../entities/slide-work').DesignBrief | null;
      designStyle: import('../entities/slide-work').DesignStyle | null;
      framework: import('../entities/slide-work').FrameworkType | null;
      templateMeta: import('../entities/slide-work').TemplateMeta | null;
      pptxBuildError: string | null;
      theme: ThemeTokens | null;
      workflow: WorkflowConfig | null;
      dataSources: DataFile[];
      urlSources: Array<{ url: string; status: string; result?: ScrapeResult }>;
      iconProvider: 'iconify';
      iconCollection: IconifyCollectionId;
      availableIcons: string[];
    },
  ): void;

  cancel(): void;

  onStream(cb: (delta: { content?: string; thinking?: string }) => void): () => void;
  onScenario(cb: (payload: ScenarioPayload) => void): () => void;
  onSlideUpdate(cb: (slide: SlideUpdatePayload) => void): () => void;
  onFrameworkSuggested(cb: (payload: { primary: string; reasoning: string }) => void): () => void;
  onError(cb: (msg: string) => void): () => void;
  onDone(cb: () => void): () => void;
}

export interface IpcThemeAPI {
  generatePalette(seeds: string[]): Promise<PaletteColor[]>;
  autoAssign(colors: PaletteColor[]): Promise<ThemeSlots>;
  exportThmx(tokens: ThemeTokens): Promise<{ success: boolean; path?: string; error?: string }>;
}

export interface IpcPptxAPI {
  generate(
    code: string,
    themeTokens: ThemeTokens | null,
    title: string,
    iconCollection?: string,
    slides?: SlideItem[],
    templateMeta?: TemplateMeta | null,
  ): Promise<{ success: boolean; path?: string; error?: string }>;
  renderPreview(
    code: string,
    themeTokens: ThemeTokens | null,
    title: string,
    iconCollection?: string,
    slides?: Array<{ number: number; title: string; layout: string; icon?: string | null; imageQuery?: string | null; imageQueries?: string[]; imagePath?: string | null; selectedImages?: Array<{ id: string; imageQuery?: string | null; imageUrl?: string | null; imagePath?: string | null; thumbnailUrl?: string | null }> }>,
    templateMeta?: TemplateMeta | null,
  ): Promise<{ success: boolean; imagePaths?: string[]; error?: string; warning?: string }>;
  readExistingPreviews(): Promise<{ success: boolean; imagePaths: string[] }>;
  importTemplate(): Promise<{ success: boolean; templatePath?: string; meta?: TemplateMeta; error?: string; warning?: string }>;
  removeTemplate(): Promise<{ success: boolean }>;
}

export interface IpcFsAPI {
  openDirectory(): Promise<DataFile[]>;
  readFile(filePath: string): Promise<DataFile>;
}

export interface IpcScrapeAPI {
  scrapeUrl(url: string): Promise<ScrapeResult>;
}

export interface IpcImagesAPI {
  searchForSlide(slide: ImageSearchRequest): Promise<ImageSearchResult>;
  downloadForSlide(slide: ImageSearchRequest, candidate: ImageSearchCandidate): Promise<ResolvedSlideImage>;
  pickLocalFilesForSlide(slide: ImageSearchRequest): Promise<ResolvedSlideImage[]>;
  resolveForSlides(slides: ImageSearchRequest[]): Promise<ResolvedSlideImage[]>;
}

export interface IpcSettingsAPI {
  get(): Promise<Record<string, string>>;
  save(settings: Record<string, string>): Promise<void>;
}

export interface NotebookLMNotebook {
  id: string;
  title: string;
}

export interface NotebookLMArtifactResult {
  success: boolean;
  path?: string;
  error?: string;
}

export interface IpcNotebookLMAPI {
  authStatus(): Promise<{ authenticated: boolean; notebookCount?: number; error?: string }>;
  list(): Promise<{ notebooks: NotebookLMNotebook[] }>;
  generateInfographic(notebookId: string, options?: { orientation?: string; detailLevel?: string }): Promise<NotebookLMArtifactResult>;
  generateSlideDeck(notebookId: string, options?: { format?: string }): Promise<NotebookLMArtifactResult>;
  clearInfographics(): Promise<{ success: boolean }>;
  getInfographics(): Promise<string[]>;
}

export interface PptAppProject {
  version: 1;
  savedAt: string;
  workspaceDir: string;
  title: string;
  slidesWork: import('../entities/slide-work').SlideWork;
  chatMessages: Array<{ id: string; role: string; content: string; thinking?: string; timestamp: number }>;
  palette: {
    seeds: string[];
    colors: import('../entities/palette').PaletteColor[];
    slots: import('../entities/palette').ThemeSlots | null;
    tokens: import('../entities/palette').ThemeTokens | null;
    themeName: string;
    iconDir?: string | null;
    selectedIconCollection?: IconifyCollectionId;
  };
  dataSources?: {
    files: DataFile[];
    urls: Array<{ url: string; status: string; result?: ScrapeResult }>;
  };
}

export interface IpcProjectAPI {
  getWorkspaceDir(): Promise<string>;
  setWorkspaceDir(): Promise<string | null>;
  save(projectData: PptAppProject, suggestedName: string): Promise<{ success: boolean; path?: string }>;
  load(): Promise<{ data: PptAppProject; path: string } | null>;
  listWorkspaceFiles(): Promise<Array<{ name: string; path: string }>>;
}

/** Matches window.electronAPI exposed by preload.ts */
export interface ElectronAPI {
  chat: IpcChatAPI;
  theme: IpcThemeAPI;
  pptx: IpcPptxAPI;
  fs: IpcFsAPI;
  scrape: IpcScrapeAPI;
  images: IpcImagesAPI;
  settings: IpcSettingsAPI;
  project: IpcProjectAPI;
  notebooklm: IpcNotebookLMAPI;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
