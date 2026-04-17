/**
 * Electron Preload: IPC bridge via contextBridge
 * Exposes typed window.electronAPI to the renderer process.
 */

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  chat: {
    send(message: string, history: unknown[], workspace: unknown): void {
      ipcRenderer.send('chat:send', { message, history, workspace });
    },
    cancel(): void {
      ipcRenderer.send('chat:cancel');
    },
    onStream(cb: (delta: { content?: string; thinking?: string }) => void) {
      const handler = (_: unknown, delta: { content?: string; thinking?: string }) => cb(delta);
      ipcRenderer.on('chat:stream', handler);
      return () => ipcRenderer.removeListener('chat:stream', handler);
    },
    onScenario(cb: (payload: unknown) => void) {
      const handler = (_: unknown, payload: unknown) => cb(payload);
      ipcRenderer.on('chat:scenario', handler);
      return () => ipcRenderer.removeListener('chat:scenario', handler);
    },
    onSlideUpdate(cb: (slide: unknown) => void) {
      const handler = (_: unknown, slide: unknown) => cb(slide);
      ipcRenderer.on('chat:slide-update', handler);
      return () => ipcRenderer.removeListener('chat:slide-update', handler);
    },
    onFrameworkSuggested(cb: (payload: unknown) => void) {
      const handler = (_: unknown, payload: unknown) => cb(payload);
      ipcRenderer.on('chat:framework-suggested', handler);
      return () => ipcRenderer.removeListener('chat:framework-suggested', handler);
    },
    onTool(cb: (event: unknown) => void) {
      const handler = (_: unknown, event: unknown) => cb(event);
      ipcRenderer.on('chat:tool', handler);
      return () => ipcRenderer.removeListener('chat:tool', handler);
    },
    onError(cb: (msg: string) => void) {
      const handler = (_: unknown, msg: string) => cb(msg);
      ipcRenderer.on('chat:error', handler);
      return () => ipcRenderer.removeListener('chat:error', handler);
    },
    onDone(cb: () => void) {
      const handler = () => cb();
      ipcRenderer.on('chat:done', handler);
      return () => ipcRenderer.removeListener('chat:done', handler);
    },
  },

  theme: {
    listFonts: () => ipcRenderer.invoke('theme:listFonts'),
    generatePalette: (seeds: string[]) => ipcRenderer.invoke('theme:generatePalette', seeds),
    autoAssign: (colors: unknown[], seeds?: string[]) => ipcRenderer.invoke('theme:autoAssign', colors, seeds ?? []),
  },

  pptx: {
    generate: (title: string) =>
      ipcRenderer.invoke('pptx:generate', '', null, title),
    renderPreview: (designStyle: string | null, themeTokens: unknown, title: string, iconCollection?: string, slides?: unknown[], customBackgroundColor?: string | null) =>
      ipcRenderer.invoke('pptx:renderPreview', designStyle, themeTokens, title, iconCollection, slides, customBackgroundColor),
    readExistingPreviews: () =>
      ipcRenderer.invoke('pptx:readExistingPreviews'),
    rerenderPreview: () =>
      ipcRenderer.invoke('pptx:rerenderPreview'),
    openPreviewPptx: () =>
      ipcRenderer.invoke('pptx:openPreviewPptx'),
    computeLayout: (slidesJson: string) =>
      ipcRenderer.invoke('pptx:computeLayout', slidesJson),
    clearWorkspaceArtifacts: () =>
      ipcRenderer.invoke('pptx:clearWorkspaceArtifacts'),
  },

  fs: {
    openDirectory: () => ipcRenderer.invoke('fs:openDirectory'),
    readFile: (filePath: string) => ipcRenderer.invoke('fs:readFile', filePath),
  },

  scrape: {
    scrapeUrl: (url: string) => ipcRenderer.invoke('scrape:scrapeUrl', url),
  },

  images: {
    searchForSlide: (slide: unknown) => ipcRenderer.invoke('images:searchForSlide', slide),
    downloadForSlide: (slide: unknown, candidate: unknown) => ipcRenderer.invoke('images:downloadForSlide', slide, candidate),
    pickLocalFilesForSlide: (slide: unknown) => ipcRenderer.invoke('images:pickLocalFilesForSlide', slide),
    resolveForSlides: (slides: unknown[]) => ipcRenderer.invoke('images:resolveForSlides', slides),
  },

  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    save: (settings: Record<string, string>) => ipcRenderer.invoke('settings:save', settings),
    onChanged: (cb: (settings: Record<string, string>) => void) => {
      const handler = (_: unknown, settings: Record<string, string>) => cb(settings)
      ipcRenderer.on('settings:changed', handler)
      return () => ipcRenderer.removeListener('settings:changed', handler)
    },
  },

  project: {
    getWorkspaceDir: () => ipcRenderer.invoke('project:getWorkspaceDir'),
    setWorkspaceDir: () => ipcRenderer.invoke('project:setWorkspaceDir'),
    save: (projectData: unknown, suggestedName: string) =>
      ipcRenderer.invoke('project:save', projectData, suggestedName),
    load: () => ipcRenderer.invoke('project:load'),
    listWorkspaceFiles: () => ipcRenderer.invoke('project:listWorkspaceFiles'),
    openBrandStyleSamples: () => ipcRenderer.invoke('project:openBrandStyleSamples'),
  },

  notebooklm: {
    authStatus: () => ipcRenderer.invoke('notebooklm:authStatus'),
    setupAuth: () => ipcRenderer.invoke('notebooklm:setupAuth'),
    list: () => ipcRenderer.invoke('notebooklm:list'),
    createNotebook: (title: string) => ipcRenderer.invoke('notebooklm:createNotebook', title),
    uploadSources: (notebookId: string, sources: { files?: Array<{ path: string; mime?: string }>; texts?: Array<{ title: string; content: string }>; urls?: string[] }) =>
      ipcRenderer.invoke('notebooklm:uploadSources', notebookId, sources),
    generateInfographic: (notebookId: string, options?: { orientation?: string; detailLevel?: string }) =>
      ipcRenderer.invoke('notebooklm:generateInfographic', notebookId, options),
    generateSlideDeck: (notebookId: string, options?: { format?: string }) =>
      ipcRenderer.invoke('notebooklm:generateSlideDeck', notebookId, options),
    clearInfographics: () => ipcRenderer.invoke('notebooklm:clearInfographics'),
    getInfographics: () => ipcRenderer.invoke('notebooklm:getInfographics'),
  },
});
