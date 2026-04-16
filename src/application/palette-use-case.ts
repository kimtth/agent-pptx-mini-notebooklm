/**
 * Application: Palette Use Case
 * Assembles ThemeTokens from slots + colors (renderer-side).
 */

import type { PaletteColor, ThemeColorTreatment, ThemeSlots, ThemeTextBoxCornerStyle, ThemeTextBoxStyle, ThemeTokens } from '../domain/entities/palette';
import { getStyleDefaults } from '../domain/theme/style-theme-defaults';
import { DEFAULT_THEME_SLOTS } from '../domain/theme/default-theme';

/**
 * Guarantee a non-null ThemeTokens.
 * When `tokens` is null, derives fallback colors from the selected design style
 * so that font / icon-set / text-box-style settings look correct immediately.
 */
function ensureThemeTokens(tokens: ThemeTokens | null, designStyle?: string | null): ThemeTokens {
  if (tokens) return tokens;
  const { slots, tone } = getStyleDefaults(designStyle);
  return buildThemeTokens(designStyle ?? 'Default Theme', slots, [], tone);
}

function normalizeBackgroundHex(hex?: string | null): string | null {
  if (!hex) return null;
  const normalized = hex.trim().replace('#', '').toUpperCase();
  return /^[0-9A-F]{6}$/.test(normalized) ? normalized : null;
}

export function buildThemeTokens(
  name: string,
  slots: ThemeSlots,
  colors: PaletteColor[],
  styleTone?: 'dark' | 'light' | null,
): ThemeTokens {
  const isDark = styleTone === 'dark';
  const backgroundBase = isDark ? slots.dk1 : DEFAULT_THEME_SLOTS.lt1;
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
    BG: backgroundBase,
    TEXT: isDark ? slots.lt1 : slots.dk1,
    WHITE: slots.lt1,
    BORDER: isDark ? slots.dk2 : slots.lt2,
  };
  return { name, slots, colors, C, showSlideIcons: true };
}

export function applyThemeFontFamily(
  tokens: ThemeTokens | null,
  fontFamily?: string | null,
  designStyle?: string | null,
): ThemeTokens {
  const baseTokens = ensureThemeTokens(tokens, designStyle);
  const nextFontFamily = fontFamily?.trim() || undefined;
  if (baseTokens.fontFamily === nextFontFamily) {
    return baseTokens;
  }
  return {
    ...baseTokens,
    fontFamily: nextFontFamily,
  };
}

export function applyThemeBackground(
  tokens: ThemeTokens | null,
  designStyle?: string | null,
  styleTone?: 'dark' | 'light' | null,
  customBackgroundHex?: string | null,
): ThemeTokens {
  const normalizedBackground = normalizeBackgroundHex(customBackgroundHex);
  if (designStyle !== 'Blank Custom Color' || !normalizedBackground) {
    return ensureThemeTokens(tokens, designStyle);
  }

  const baseTokens = tokens ?? buildThemeTokens(
    designStyle,
    getStyleDefaults(designStyle).slots,
    [],
    styleTone ?? null,
  );

  if (baseTokens.C.BG === normalizedBackground) {
    return baseTokens;
  }

  return {
    ...baseTokens,
    C: {
      ...baseTokens.C,
      BG: normalizedBackground,
    },
  };
}

export function applyThemeColorTreatment(
  tokens: ThemeTokens | null,
  colorTreatment?: ThemeColorTreatment | null,
): ThemeTokens {
  const baseTokens = ensureThemeTokens(tokens);
  const nextColorTreatment = colorTreatment ?? 'mixed';
  if (baseTokens.colorTreatment === nextColorTreatment) {
    return baseTokens;
  }
  return {
    ...baseTokens,
    colorTreatment: nextColorTreatment,
  };
}

export function applyThemeTextBoxStyle(
  tokens: ThemeTokens | null,
  textBoxStyle?: ThemeTextBoxStyle | null,
): ThemeTokens {
  const baseTokens = ensureThemeTokens(tokens);
  const nextTextBoxStyle = textBoxStyle ?? 'mixed';
  if (baseTokens.textBoxStyle === nextTextBoxStyle) {
    return baseTokens;
  }
  return {
    ...baseTokens,
    textBoxStyle: nextTextBoxStyle,
  };
}

export function applyThemeTextBoxCornerStyle(
  tokens: ThemeTokens | null,
  textBoxCornerStyle?: ThemeTextBoxCornerStyle | null,
): ThemeTokens {
  const baseTokens = ensureThemeTokens(tokens);
  const nextTextBoxCornerStyle = textBoxCornerStyle ?? 'square';
  if (baseTokens.textBoxCornerStyle === nextTextBoxCornerStyle) {
    return baseTokens;
  }
  return {
    ...baseTokens,
    textBoxCornerStyle: nextTextBoxCornerStyle,
  };
}

export function applyThemeSlideIcons(
  tokens: ThemeTokens | null,
  showSlideIcons?: boolean | null,
): ThemeTokens {
  const baseTokens = ensureThemeTokens(tokens);
  const nextShowSlideIcons = showSlideIcons ?? true;
  if (baseTokens.showSlideIcons === nextShowSlideIcons) {
    return baseTokens;
  }
  return {
    ...baseTokens,
    showSlideIcons: nextShowSlideIcons,
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
