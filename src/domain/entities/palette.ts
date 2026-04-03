/**
 * Domain Entities: Color Palette & Theme
 */

export interface PaletteColor {
  name: string;
  hex: string;
}

/** 12 OOXML theme color slots */
export interface ThemeSlots {
  dk1: string;
  lt1: string;
  dk2: string;
  lt2: string;
  accent1: string;
  accent2: string;
  accent3: string;
  accent4: string;
  accent5: string;
  accent6: string;
  hlink: string;
  folHlink: string;
}

/** Full theme with colors usable by PowerPoint theme and PPTX generation (no '#' prefix) */
export interface ThemeTokens {
  name: string;
  fontFamily?: string;
  slots: ThemeSlots;
  /** Flat map name→hex for dropdown rendering */
  colors: PaletteColor[];
  /** Theme constants exposed to generated PPTX code (dk1→DARK, lt1→WHITE, accent1→ACCENT1, etc.) */
  C: {
    DARK: string;
    DARK2: string;
    LIGHT: string;
    LIGHT2: string;
    ACCENT1: string;
    ACCENT2: string;
    ACCENT3: string;
    ACCENT4: string;
    ACCENT5: string;
    ACCENT6: string;
    LINK: string;
    USED_LINK: string;
    // Semantic aliases computed from the above
    PRIMARY: string;
    SECONDARY: string;
    BG: string;
    TEXT: string;
    WHITE: string;
    BORDER: string;
  };
}
