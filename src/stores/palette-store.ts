/**
 * Store: Palette + Theme state
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { PaletteColor, ThemeSlots, ThemeTokens } from '../domain/entities/palette';
import { buildThemeTokens } from '../application/palette-use-case';
import { DEFAULT_ICONIFY_COLLECTION } from '../domain/icons/iconify';
import { DEFAULT_THEME_SEEDS } from '../domain/theme/default-theme';
import type { IconifyCollectionId } from '../domain/icons/iconify';

interface PaletteStore {
  seeds: string[];
  colors: PaletteColor[];
  slots: ThemeSlots | null;
  tokens: ThemeTokens | null;
  themeName: string;
  selectedIconCollection: IconifyCollectionId;
  isGenerating: boolean;

  setSeeds(seeds: string[]): void;
  setColors(colors: PaletteColor[]): void;
  setSlots(slots: ThemeSlots): void;
  setThemeName(name: string): void;
  setSelectedIconCollection(collection: IconifyCollectionId): void;
  setGenerating(v: boolean): void;
  /** Called after slots + colors are set — builds fully typed ThemeTokens */
  commitTokens(): void;
}

export const usePaletteStore = create<PaletteStore>()(persist(
  (set, get) => ({
  seeds: DEFAULT_THEME_SEEDS,
  colors: [],
  slots: null,
  tokens: null,
  themeName: 'My Theme',
  selectedIconCollection: DEFAULT_ICONIFY_COLLECTION,
  isGenerating: false,

  setSeeds: (seeds) => set({ seeds }),
  setColors: (colors) => set({ colors }),
  setSlots: (slots) => set({ slots }),
  setThemeName: (name) => set({ themeName: name }),
  setSelectedIconCollection: (selectedIconCollection) => set({ selectedIconCollection }),
  setGenerating: (v) => set({ isGenerating: v }),

  commitTokens() {
    const { themeName, slots, colors } = get();
    if (!slots) return;
    const tokens = buildThemeTokens(themeName, slots, colors);
    set({ tokens });
  },
}),
  {
    name: 'pptx-palette',
    storage: createJSONStorage(() => sessionStorage),
    partialize: (state) => ({
      seeds: state.seeds,
      colors: state.colors,
      slots: state.slots,
      tokens: state.tokens,
      themeName: state.themeName,
      selectedIconCollection: state.selectedIconCollection,
    }),
  },
));
