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
  },

  theme: {
    generatePalette: (seeds: string[]) => ipcRenderer.invoke('theme:generatePalette', seeds),
    autoAssign: (colors: unknown[]) => ipcRenderer.invoke('theme:autoAssign', colors),
    exportThmx: (tokens: unknown) => ipcRenderer.invoke('theme:exportThmx', tokens),
  },

  pptx: {
    generate: (code: string, themeTokens: unknown, title: string, iconCollection?: string) =>
      ipcRenderer.invoke('pptx:generate', code, themeTokens, title, iconCollection),
    renderPreview: (code: string, themeTokens: unknown, title: string, iconCollection?: string) =>
      ipcRenderer.invoke('pptx:renderPreview', code, themeTokens, title, iconCollection),
    readExistingPreviews: () =>
      ipcRenderer.invoke('pptx:readExistingPreviews'),
    computeLayout: (slidesJson: string) =>
      ipcRenderer.invoke('pptx:computeLayout', slidesJson),
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
});
