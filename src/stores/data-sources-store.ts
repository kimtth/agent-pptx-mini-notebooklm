/**
 * Store: DataSources — persisted list of loaded files and scraped URLs
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { DataFile, ScrapeResult } from '../domain/ports/ipc';

export interface UrlEntry {
  url: string;
  status: 'idle' | 'loading' | 'ok' | 'error';
  result?: ScrapeResult;
}

interface DataSourcesStore {
  files: DataFile[];
  urls: UrlEntry[];
  setFiles(files: DataFile[]): void;
  setUrls(urls: UrlEntry[]): void;
}

export const useDataSourcesStore = create<DataSourcesStore>()(persist(
  (set) => ({
  files: [],
  urls: [],
  setFiles: (files) => set({ files }),
  setUrls: (urls) => set({ urls }),
}),
  {
    name: 'pptx-data-sources',
    storage: createJSONStorage(() => sessionStorage),
  },
));
