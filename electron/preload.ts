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
    onChunkProgress(cb: (progress: { chunkIndex: number; totalChunks: number; status: string; slideRange: string }) => void) {
      const handler = (_: unknown, progress: { chunkIndex: number; totalChunks: number; status: string; slideRange: string }) => cb(progress);
      ipcRenderer.on('chat:chunk-progress', handler);
      return () => ipcRenderer.removeListener('chat:chunk-progress', handler);
    },
    onChunkedPptxReady(cb: (payload: { code: string }) => void) {
      const handler = (_: unknown, payload: { code: string }) => cb(payload);
      ipcRenderer.on('chat:chunked-pptx-ready', handler);
      return () => ipcRenderer.removeListener('chat:chunked-pptx-ready', handler);
    },
  },

  theme: {
    generatePalette: (seeds: string[]) => ipcRenderer.invoke('theme:generatePalette', seeds),
    autoAssign: (colors: unknown[], seeds?: string[]) => ipcRenderer.invoke('theme:autoAssign', colors, seeds ?? []),
    exportThmx: (tokens: unknown) => ipcRenderer.invoke('theme:exportThmx', tokens),
  },

  pptx: {
    generate: (code: string, themeTokens: unknown, title: string, iconCollection?: string, slides?: unknown[], templateMeta?: unknown) =>
      ipcRenderer.invoke('pptx:generate', code, themeTokens, title, iconCollection, slides, templateMeta),
    renderPreview: (code: string, themeTokens: unknown, title: string, iconCollection?: string, slides?: unknown[], templateMeta?: unknown) =>
      ipcRenderer.invoke('pptx:renderPreview', code, themeTokens, title, iconCollection, slides, templateMeta),
    readExistingPreviews: () =>
      ipcRenderer.invoke('pptx:readExistingPreviews'),
    computeLayout: (slidesJson: string) =>
      ipcRenderer.invoke('pptx:computeLayout', slidesJson),
    importTemplate: () =>
      ipcRenderer.invoke('pptx:importTemplate'),
    removeTemplate: () =>
      ipcRenderer.invoke('pptx:removeTemplate'),
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
  },

  project: {
    getWorkspaceDir: () => ipcRenderer.invoke('project:getWorkspaceDir'),
    setWorkspaceDir: () => ipcRenderer.invoke('project:setWorkspaceDir'),
    save: (projectData: unknown, suggestedName: string) =>
      ipcRenderer.invoke('project:save', projectData, suggestedName),
    load: () => ipcRenderer.invoke('project:load'),
      listWorkspaceFiles: () => ipcRenderer.invoke('project:listWorkspaceFiles'),
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
