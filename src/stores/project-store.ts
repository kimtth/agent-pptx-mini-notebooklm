/**
 * Store: Project — workspace directory and project save/load state
 */

import { create } from 'zustand';
import type { PptAppProject } from '../domain/ports/ipc';
import type { ChatMessage } from '../application/chat-use-case';
import { useSlidesStore } from './slides-store';
import { useChatStore } from './chat-store';
import { usePaletteStore } from './palette-store';
import { useDataSourcesStore } from './data-sources-store';
import { useNotebookLMStore } from './notebooklm-store';
import { DEFAULT_ICONIFY_COLLECTION } from '../domain/icons/iconify';
import { applyThemeColorTreatment, applyThemeFontFamily } from '../application/palette-use-case';

function normalizeLoadedSelectedImages(slide: PptAppProject['slidesWork']['slides'][number]) {
  if (Array.isArray(slide.selectedImages) && slide.selectedImages.length > 0) {
    return slide.selectedImages.map((image) => ({
      id: image.id,
      imageQuery: image.imageQuery ?? slide.imageQuery ?? null,
      imageUrl: image.imageUrl ?? null,
      imagePath: image.imagePath ?? null,
      imageAttribution: image.imageAttribution ?? null,
      sourcePageUrl: image.sourcePageUrl ?? null,
      thumbnailUrl: image.thumbnailUrl ?? image.imageUrl ?? null,
    }));
  }

  if (!slide.imagePath && !slide.imageUrl) return []

  return [{
    id: slide.imagePath ?? slide.imageUrl ?? `${slide.number}`,
    imageQuery: slide.imageQuery ?? null,
    imageUrl: slide.imageUrl ?? null,
    imagePath: slide.imagePath ?? null,
    imageAttribution: slide.imageAttribution ?? null,
    sourcePageUrl: null,
    thumbnailUrl: slide.imageUrl ?? null,
  }]
}

function normalizeLoadedWork(work: PptAppProject['slidesWork']) {
  return {
    ...work,
    designStyle: work.designStyle ?? null,
    framework: work.framework ?? null,
    customFrameworkPrompt: work.customFrameworkPrompt ?? null,
    includeImagesInLayout: work.includeImagesInLayout ?? false,
    isStreaming: false,
    isPptxBusy: false,
    thinking: null,
    slides: (work.slides ?? []).map((slide) => {
      const selectedImages = normalizeLoadedSelectedImages(slide)
      const primary = selectedImages[0] ?? null

      return {
        ...slide,
        icon: slide.icon ?? null,
        imageQuery: slide.imageQuery ?? null,
        imageQueries: slide.imageQueries ?? (slide.imageQuery ? [slide.imageQuery] : []),
        imageUrl: primary?.imageUrl ?? null,
        imagePath: primary?.imagePath ?? null,
        imageAttribution: primary?.imageAttribution ?? null,
        selectedImages,
      }
    }),
  };
}

interface ProjectStore {
  workspaceDir: string;
  currentProjectPath: string | null;
  isDirty: boolean;

  setWorkspaceDir(dir: string): void;
  setDirty(v: boolean): void;

  /** Fetch workspace dir from main process and cache it */
  initWorkspaceDir(): Promise<void>;
  /** Open folder picker via IPC, update store if chosen */
  changeWorkspaceDir(): Promise<string | null>;
  /** Serialize current app state into a PptAppProject snapshot */
  buildSnapshot(): PptAppProject;
  /** Save project — shows native save dialog */
  saveProject(): Promise<{ success: boolean; path?: string }>;
  /** Load project — shows native open dialog, then restores state in all stores */
  loadProject(): Promise<boolean>;
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  workspaceDir: '',
  currentProjectPath: null,
  isDirty: false,

  setWorkspaceDir(dir) {
    set({ workspaceDir: dir });
  },

  setDirty(v) {
    set({ isDirty: v });
  },

  async initWorkspaceDir() {
    if (!window.electronAPI?.project) return;
    const dir = await window.electronAPI.project.getWorkspaceDir();
    set({ workspaceDir: dir });
  },

  async changeWorkspaceDir() {
    if (!window.electronAPI?.project) return null;
    const dir = await window.electronAPI.project.setWorkspaceDir();
    if (dir) set({ workspaceDir: dir });
    return dir;
  },

  buildSnapshot(): PptAppProject {
    const { work } = useSlidesStore.getState();
    const { messages } = useChatStore.getState();
    const { seeds, colors, slots, tokens, themeName, selectedFont, selectedColorTreatment, selectedIconCollection } = usePaletteStore.getState();
    const { files, urls } = useDataSourcesStore.getState();
    const { enabled: nlmEnabled, infographicPaths } = useNotebookLMStore.getState();
    const { workspaceDir } = get();

    return {
      version: 1,
      savedAt: new Date().toISOString(),
      workspaceDir,
      title: work.title || 'Untitled',
      slidesWork: work,
      chatMessages: messages,
      palette: { seeds, colors, slots, tokens, themeName, selectedFont, selectedColorTreatment, selectedIconCollection, styleTone: usePaletteStore.getState().styleTone },
      dataSources: { files, urls },
      notebookLM: { enabled: nlmEnabled, infographicPaths },
    };
  },

  async saveProject() {
    if (!window.electronAPI?.project) return { success: false };
    const snapshot = get().buildSnapshot();
    const result = await window.electronAPI.project.save(snapshot, snapshot.title || 'project');
    if (result.success && result.path) {
      set({ currentProjectPath: result.path, isDirty: false });
    }
    return result;
  },

  async loadProject() {
    if (!window.electronAPI?.project) return false;
    const result = await window.electronAPI.project.load();
    if (!result) return false;

    const { data } = result;
    if (data.version !== 1) return false;

    // Restore slides store
    useSlidesStore.setState({ work: normalizeLoadedWork(data.slidesWork) });

    // Restore chat store
    useChatStore.setState({
      messages: data.chatMessages as ChatMessage[],
      pendingContent: '',
      pendingThinking: '',
    });

    // Restore palette store
    const selectedFont = data.palette.selectedFont ?? 'Calibri';
    const selectedColorTreatment = data.palette.selectedColorTreatment ?? 'solid';
    usePaletteStore.setState({
      seeds: data.palette.seeds,
      colors: data.palette.colors,
      slots: data.palette.slots,
      tokens: applyThemeColorTreatment(
        applyThemeFontFamily(data.palette.tokens, selectedFont),
        selectedColorTreatment,
      ),
      themeName: data.palette.themeName,
      selectedFont,
      selectedColorTreatment,
      selectedIconCollection: data.palette.selectedIconCollection ?? DEFAULT_ICONIFY_COLLECTION,
      styleTone: data.palette.styleTone ?? null,
    });

    // Restore data sources store
    useDataSourcesStore.setState({
      files: data.dataSources?.files ?? [],
      urls: (data.dataSources?.urls ?? []) as import('./data-sources-store').UrlEntry[],
    });

    // Restore NotebookLM store
    useNotebookLMStore.setState({
      enabled: data.notebookLM?.enabled ?? false,
      infographicPaths: data.notebookLM?.infographicPaths ?? [],
    });

    set({
      currentProjectPath: result.path,
      isDirty: false,
      workspaceDir: data.workspaceDir || get().workspaceDir,
    });
    return true;
  },
}));
