/**
 * Application: Palette Use Case
 * Assembles ThemeTokens from slots + colors (renderer-side).
 */

import type { PaletteColor, ThemeColorTreatment, ThemeSlots, ThemeTextBoxStyle, ThemeTokens } from '../domain/entities/palette';

export function buildThemeTokens(
  name: string,
  slots: ThemeSlots,
  colors: PaletteColor[],
  styleTone?: 'dark' | 'light' | null,
): ThemeTokens {
  const isDark = styleTone === 'dark';
  const C: ThemeTokens['C'] = {
    DARK: slots.dk1,
    DARK2: slots.dk2,
    LIGHT: slots.lt1,
    LIGHT2: slots.lt2,
    ACCENT1: slots.accent1,
    ACCENT2: slots.accent2,
    ACCENT3: slots.accent3,
    ACCENT4: slots.accent4,
    ACCENT5: slots.accent5,
    ACCENT6: slots.accent6,
    LINK: slots.hlink,
    USED_LINK: slots.folHlink,
    PRIMARY: slots.accent1,
    SECONDARY: slots.accent2,
    BG: isDark ? slots.dk1 : slots.lt1,
    TEXT: isDark ? slots.lt1 : slots.dk1,
    WHITE: slots.lt1,
    BORDER: isDark ? slots.dk2 : slots.lt2,
  };
  return { name, slots, colors, C };
}

export function applyThemeFontFamily(
  tokens: ThemeTokens | null,
  fontFamily?: string | null,
): ThemeTokens | null {
  if (!tokens) return null;
  const nextFontFamily = fontFamily?.trim() || undefined;
  if (tokens.fontFamily === nextFontFamily) {
    return tokens;
  }
  return {
    ...tokens,
    fontFamily: nextFontFamily,
  };
}

export function applyThemeColorTreatment(
  tokens: ThemeTokens | null,
  colorTreatment?: ThemeColorTreatment | null,
): ThemeTokens | null {
  if (!tokens) return null;
  const nextColorTreatment = colorTreatment ?? 'mixed';
  if (tokens.colorTreatment === nextColorTreatment) {
    return tokens;
  }
  return {
    ...tokens,
    colorTreatment: nextColorTreatment,
  };
}

export function applyThemeTextBoxStyle(
  tokens: ThemeTokens | null,
  textBoxStyle?: ThemeTextBoxStyle | null,
): ThemeTokens | null {
  if (!tokens) return null;
  const nextTextBoxStyle = textBoxStyle ?? 'mixed';
  if (tokens.textBoxStyle === nextTextBoxStyle) {
    return tokens;
  }
  return {
    ...tokens,
    textBoxStyle: nextTextBoxStyle,
  };
}

/** Parse `ColorName | #HEX` lines */
export function parsePaletteText(text: string): PaletteColor[] {
  return text
    .split('\n')
    .map((line) => {
      const match = line.match(/^(.+?)\s*\|\s*(#[0-9A-Fa-f]{6})/);
      return match ? { name: match[1].trim(), hex: match[2].toUpperCase() } : null;
    })
    .filter((c): c is PaletteColor => c !== null);
}
