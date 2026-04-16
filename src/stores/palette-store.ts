/**
 * Store: Palette + Theme state
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { PaletteColor, ThemeColorTreatment, ThemeSlots, ThemeTextBoxCornerStyle, ThemeTextBoxStyle, ThemeTokens } from '../domain/entities/palette';
import { applyThemeColorTreatment, applyThemeFontFamily, applyThemeSlideIcons, applyThemeTextBoxCornerStyle, applyThemeTextBoxStyle, buildThemeTokens } from '../application/palette-use-case';
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
  selectedTextBoxCornerStyle: ThemeTextBoxCornerStyle;
  selectedIconCollection: IconifyCollectionId;
  selectedSlideIcons: boolean;
  isGenerating: boolean;
  /** Tone of the active design style — used to derive deterministic BG/TEXT tokens */
  styleTone: 'dark' | 'light' | null;

  setSeeds(seeds: string[]): void;
  setColors(colors: PaletteColor[]): void;
  setSlots(slots: ThemeSlots): void;
  clearSeeds(): void;
  clearThemeColors(): void;
  setThemeName(name: string): void;
  setSelectedFont(font: string): void;
  setSelectedColorTreatment(treatment: ThemeColorTreatment): void;
  setSelectedTextBoxStyle(style: ThemeTextBoxStyle): void;
  setSelectedTextBoxCornerStyle(style: ThemeTextBoxCornerStyle): void;
  setSelectedIconCollection(collection: IconifyCollectionId): void;
  setSelectedSlideIcons(enabled: boolean): void;
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
  selectedTextBoxCornerStyle: 'square',
  selectedIconCollection: DEFAULT_ICONIFY_COLLECTION,
  selectedSlideIcons: true,
  isGenerating: false,
  styleTone: null,

  setSeeds: (seeds) => set({ seeds }),
  setColors: (colors) => set({ colors }),
  setSlots: (slots) => set({ slots }),
  clearSeeds: () => set({ seeds: [] }),
  clearThemeColors: () => set({ slots: null, tokens: null }),
  setThemeName: (name) => set({ themeName: name }),
  setSelectedFont: (selectedFont) => set({ selectedFont }),
  setSelectedColorTreatment: (selectedColorTreatment) => set({ selectedColorTreatment }),
  setSelectedTextBoxStyle: (selectedTextBoxStyle) => set({ selectedTextBoxStyle }),
  setSelectedTextBoxCornerStyle: (selectedTextBoxCornerStyle) => set({ selectedTextBoxCornerStyle }),
  setSelectedIconCollection: (selectedIconCollection) => set({ selectedIconCollection }),
  setSelectedSlideIcons: (selectedSlideIcons) => set({ selectedSlideIcons }),
  setGenerating: (v) => set({ isGenerating: v }),
  setStyleTone: (tone) => set({ styleTone: tone }),

  commitTokens() {
    const { themeName, slots, colors, styleTone, selectedFont, selectedColorTreatment, selectedTextBoxStyle, selectedTextBoxCornerStyle, selectedSlideIcons } = get();
    if (!slots) return;
    const tokens = applyThemeSlideIcons(
      applyThemeTextBoxCornerStyle(
        applyThemeTextBoxStyle(
          applyThemeColorTreatment(
            applyThemeFontFamily(
              buildThemeTokens(themeName, slots, colors, styleTone),
              selectedFont,
            ),
            selectedColorTreatment,
          ),
          selectedTextBoxStyle,
        ),
        selectedTextBoxCornerStyle,
      ),
      selectedSlideIcons,
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
      themeName: state.themeName,
      selectedFont: state.selectedFont,
      selectedColorTreatment: state.selectedColorTreatment,
      selectedTextBoxStyle: state.selectedTextBoxStyle,
      selectedTextBoxCornerStyle: state.selectedTextBoxCornerStyle,
      selectedIconCollection: state.selectedIconCollection,
      selectedSlideIcons: state.selectedSlideIcons,
      styleTone: state.styleTone,
    }),
    onRehydrateStorage: () => (state, error) => {
      if (error || !state) return;
      if (state.slots) {
        state.commitTokens();
        return;
      }
      state.clearThemeColors();
    },
  },
));
