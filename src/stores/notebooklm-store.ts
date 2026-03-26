/**
 * Store: NotebookLM — persisted toggle and infographic paths
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface NotebookLMStore {
  enabled: boolean;
  infographicPaths: string[];
  setEnabled(v: boolean): void;
  setInfographicPaths(paths: string[]): void;
}

export const useNotebookLMStore = create<NotebookLMStore>()(persist(
  (set) => ({
    enabled: false,
    infographicPaths: [],
    setEnabled: (v) => set({ enabled: v }),
    setInfographicPaths: (paths) => set({ infographicPaths: paths }),
  }),
  {
    name: 'pptx-notebooklm',
    storage: createJSONStorage(() => sessionStorage),
  },
));
