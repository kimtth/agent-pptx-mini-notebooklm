/**
 * Store: Palette + Theme state
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { PaletteColor, ThemeColorTreatment, ThemeSlots, ThemeTextBoxStyle, ThemeTokens } from '../domain/entities/palette';
import { applyThemeColorTreatment, applyThemeFontFamily, applyThemeTextBoxStyle, buildThemeTokens } from '../application/palette-use-case';
import { DEFAULT_ICONIFY_COLLECTION } from '../domain/icons/iconify';
import { DEFAULT_THEME_SEEDS } from '../domain/theme/default-theme';
import type { IconifyCollectionId } from '../domain/icons/iconify';

interface PaletteStore {
  seeds: string[];
  colors: PaletteColor[];
  slots: ThemeSlots | null;
  tokens: ThemeTokens | null;
  themeName: string;
  selectedFont: string;
  selectedColorTreatment: ThemeColorTreatment;
  selectedTextBoxStyle: ThemeTextBoxStyle;
  selectedIconCollection: IconifyCollectionId;
  isGenerating: boolean;
  /** Tone of the active design style — used to flip BG/TEXT in theme tokens */
  styleTone: 'dark' | 'light' | null;

  setSeeds(seeds: string[]): void;
  setColors(colors: PaletteColor[]): void;
  setSlots(slots: ThemeSlots): void;
  setThemeName(name: string): void;
  setSelectedFont(font: string): void;
  setSelectedColorTreatment(treatment: ThemeColorTreatment): void;
  setSelectedTextBoxStyle(style: ThemeTextBoxStyle): void;
  setSelectedIconCollection(collection: IconifyCollectionId): void;
  setGenerating(v: boolean): void;
  setStyleTone(tone: 'dark' | 'light' | null): void;
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
  selectedFont: 'Calibri',
  selectedColorTreatment: 'mixed',
  selectedTextBoxStyle: 'mixed',
  selectedIconCollection: DEFAULT_ICONIFY_COLLECTION,
  isGenerating: false,
  styleTone: null,

  setSeeds: (seeds) => set({ seeds }),
  setColors: (colors) => set({ colors }),
  setSlots: (slots) => set({ slots }),
  setThemeName: (name) => set({ themeName: name }),
  setSelectedFont: (selectedFont) => set({ selectedFont }),
  setSelectedColorTreatment: (selectedColorTreatment) => set({ selectedColorTreatment }),
  setSelectedTextBoxStyle: (selectedTextBoxStyle) => set({ selectedTextBoxStyle }),
  setSelectedIconCollection: (selectedIconCollection) => set({ selectedIconCollection }),
  setGenerating: (v) => set({ isGenerating: v }),
  setStyleTone: (tone) => set({ styleTone: tone }),

  commitTokens() {
    const { themeName, slots, colors, styleTone, selectedFont, selectedColorTreatment, selectedTextBoxStyle } = get();
    if (!slots) return;
    const tokens = applyThemeTextBoxStyle(
      applyThemeColorTreatment(
        applyThemeFontFamily(
          buildThemeTokens(themeName, slots, colors, styleTone),
          selectedFont,
        ),
        selectedColorTreatment,
      ),
      selectedTextBoxStyle,
    );
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
      selectedFont: state.selectedFont,
      selectedColorTreatment: state.selectedColorTreatment,
      selectedTextBoxStyle: state.selectedTextBoxStyle,
      selectedIconCollection: state.selectedIconCollection,
      styleTone: state.styleTone,
    }),
  },
));
