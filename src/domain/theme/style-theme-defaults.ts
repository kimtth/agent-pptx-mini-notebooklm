/**
 * Per-style default ThemeSlots.
 *
 * When the user selects a design style but hasn't generated a palette yet,
 * these characteristic colors are used as the fallback theme so that font,
 * icon-set, and text-box-style settings immediately take effect with
 * colors that match the selected style's mood.
 *
 * Colors are extracted from each style's CSS preview palette
 * (modern-pptx-designs-30.html) and the style reference (styles.md).
 */

import type { ThemeSlots } from '../entities/palette'
import { DEFAULT_THEME_SLOTS } from './default-theme'

interface StyleDefaults {
  slots: ThemeSlots
  tone: 'dark' | 'light' | null
}

/** Compact helper — builds ThemeSlots from positional hex args (no '#'). */
function s(
  dk1: string, lt1: string, dk2: string, lt2: string,
  a1: string, a2: string, a3: string, a4: string, a5: string, a6: string,
  hl?: string, fhl?: string,
): ThemeSlots {
  return {
    dk1, lt1, dk2, lt2,
    accent1: a1, accent2: a2, accent3: a3, accent4: a4, accent5: a5, accent6: a6,
    hlink: hl ?? a1, folHlink: fhl ?? a2,
  }
}

/**
 * Map from lower-cased design-style name → default slots + tone.
 * Styles not listed fall through to DEFAULT_THEME_SLOTS.
 */
const STYLE_DEFAULTS: Record<string, StyleDefaults> = {
  // ── Foundation ──
  'blank white': { tone: 'light', slots: DEFAULT_THEME_SLOTS },
  'blank dark':  { tone: 'dark',  slots: DEFAULT_THEME_SLOTS },

  // ── Named Styles ──
  'glassmorphism':        { tone: 'dark',  slots: s('1A1A4E', 'FFFFFF', '2C2854', 'E8E8F5', '7C3AED', '3B82F6', '8B5CF6', '06B6D4', 'A78BFA', 'EC4899', '818CF8', '7C3AED') },
  'neo-brutalism':        { tone: 'light', slots: s('000000', 'FFFFFF', '1A1A1A', 'FFF8DC', 'FF3B30', 'F5D500', 'FF6B00', '3B82F6', '10B981', 'FF1493') },
  'bento grid':           { tone: 'light', slots: s('1A1A2E', 'F8F8F2', '2D2D44', 'EBEBEB', '4ECDC4', 'FF6B6B', 'FFE66D', '6C5CE7', 'A8E6CF', 'FD79A8') },
  'dark academia':        { tone: 'dark',  slots: s('1A1208', 'F5E6C8', '332A10', 'E8D5B0', 'C9A84C', '8A7340', '6B4E37', 'A67C52', 'D4B896', '7A5C3A') },
  'gradient mesh':        { tone: 'dark',  slots: s('1A1A2E', 'FFFFFF', '2D2D44', 'F0F0F5', 'FF6EC7', '7B61FF', '00D4FF', 'FFB347', '4ADE80', 'F43F5E') },
  'claymorphism':         { tone: 'light', slots: s('3D3D3D', 'FFFFFF', '5A5A5A', 'FFF5EE', 'A8EDEA', 'FED6E3', 'FFEAA7', 'DDA0DD', 'B5EAD7', 'FFDAC1', '74B9FF', 'A29BFE') },
  'swiss international':  { tone: 'light', slots: s('1B1B1B', 'FFFFFF', '333333', 'F2F2F2', 'E63946', '1D3557', '457B9D', 'A8DADC', 'F1FAEE', '264653') },
  'aurora neon glow':     { tone: 'dark',  slots: s('0A0A1A', 'FFFFFF', '15152A', 'E0F0FF', '00FF88', '00D4FF', 'BF40FF', 'FF3B80', '40FFF0', 'FFD700') },
  'retro y2k':            { tone: 'dark',  slots: s('0F0F1A', 'FFFFFF', '1A1A2E', 'F0E6FF', 'FF00FF', '00FFFF', 'FF6B6B', 'FFD700', '7FFF00', 'FF69B4') },
  'nordic minimalism':    { tone: 'light', slots: s('2C2C2C', 'FAF5EF', '4A4A4A', 'EDE5DA', '8B7E74', 'A3917F', 'C4B59B', '7A8B7A', 'B8A590', '96877A') },
  'typographic bold':     { tone: 'light', slots: s('1A1A1A', 'FFFFFF', '333333', 'F0F0F0', 'FF2D55', '1A1A1A', '666666', 'FF6B00', '0066CC', '333333') },
  'duotone color split':  { tone: 'dark',  slots: s('1A1A2E', 'FFFFFF', '0F0F1F', 'F0F0F5', '6366F1', 'EC4899', '7C3AED', 'F59E0B', '10B981', '8B5CF6') },
  'monochrome minimal':   { tone: 'light', slots: s('1A1A1A', 'FAFAFA', '333333', 'E5E5E5', '666666', '999999', '4A4A4A', 'B3B3B3', '2D2D2D', '7A7A7A') },
  'cyberpunk outline':    { tone: 'dark',  slots: s('0A0A14', 'FFFFFF', '141428', 'D0FFD0', '00FF41', '39FF14', '00E5FF', 'FF003C', '32CD32', '7FFF00') },
  'editorial magazine':   { tone: 'light', slots: s('1A1A1A', 'FAFAF5', '2D2D2D', 'EBEBEB', 'C0392B', '2C3E50', 'E74C3C', '34495E', '7F8C8D', 'BDC3C7') },
  'pastel soft ui':       { tone: 'light', slots: s('3D3D3D', 'FFFFFF', '5A5A5A', 'FFF0F5', 'B8A9C9', 'A7D7C5', 'F7CAC9', '92A8D1', 'FFDAC1', 'E6B8A2') },
  'dark neon miami':      { tone: 'dark',  slots: s('0D0D1A', 'FFFFFF', '1A1A33', 'FFE0F0', 'FF6AD5', 'C774E8', 'AD8CFF', '8795E8', '94D0FF', 'FF8C42') },
  'hand-crafted organic': { tone: 'light', slots: s('2C2416', 'FAF3E8', '4A3F2F', 'EDE5D4', '6B8F71', 'C9A84C', '8B7355', 'A67C52', '5B7553', 'D4A574') },
  'isometric 3d flat':    { tone: 'dark',  slots: s('0F1923', 'FFFFFF', '1A2A3F', 'DAE4F0', '2196F3', '1565C0', '42A5F5', '1E88E5', '64B5F6', '0D47A1') },
  'vaporwave':            { tone: 'dark',  slots: s('0F0F2A', 'FFFFFF', '1A1A3E', 'F0E0FF', 'FF71CE', '01CDFE', 'B967FF', 'FFFB96', '05FFA1', 'FF6B6B') },
  'art deco luxe':        { tone: 'dark',  slots: s('0D0D0D', 'F5F0E8', '1A1A1A', 'E8DFD0', 'D4AF37', 'B8860B', '8B6914', 'CFB53B', 'E5C100', 'AA8C2C') },
  'brutalist newspaper':  { tone: 'light', slots: s('1A1A1A', 'F5F0E8', '333333', 'E8E0D4', 'C0392B', '1A1A1A', '666666', '999999', '444444', '8B0000') },
  'stained glass mosaic': { tone: 'dark',  slots: s('0F0F1A', 'FFFFFF', '1A1A2E', 'F0F0F5', 'E74C3C', '3498DB', '2ECC71', 'F1C40F', '9B59B6', 'E67E22') },
  'liquid blob morphing': { tone: 'dark',  slots: s('0A0A1F', 'FFFFFF', '15153A', 'E8F0FF', '667EEA', '764BA2', 'F093FB', '4FACFE', '43E97B', 'FA709A') },
  'memphis pop pattern':  { tone: 'light', slots: s('1A1A1A', 'FFFDE7', '333333', 'FFF9C4', 'FF6B6B', '4ECDC4', 'FFE66D', '6C5CE7', 'A8E6CF', 'FF8A80') },
  'dark forest nature':   { tone: 'dark',  slots: s('0C1B0C', 'F5FBF0', '1A2E1A', 'E8F5E0', '2E7D32', '1B5E20', '4CAF50', '81C784', 'A5D6A7', '388E3C') },
  'architectural blueprint': { tone: 'dark', slots: s('0A1628', 'FFFFFF', '1A2940', 'D4E4F7', '4985C9', '2F5F9A', '6BA3E0', '8FBFE8', '3A75B8', '1E4D8C') },
  'maximalist collage':   { tone: 'light', slots: s('1A1A1A', 'FFFFFF', '2D2D2D', 'F5F5F5', 'FF3366', '33CCFF', 'FFCC00', '00CC99', 'FF6633', '9933FF') },
  'scifi holographic data': { tone: 'dark', slots: s('050510', 'FFFFFF', '0A0A20', 'E0F4FF', '00F0FF', '00BFFF', '0080FF', '00FFB0', '40E0FF', '3FC1C9') },
  'risograph print':      { tone: 'light', slots: s('1A1A1A', 'FFF8F0', '333333', 'F0E8E0', 'FF5470', '0055AA', 'FFD166', '06D6A0', 'EF476F', '118AB2') },

  // ── Template Motifs (structural — use professional neutrals) ──
  'editorial split hero':     { tone: 'light', slots: s('1A1A1A', 'FAFAF5', '2D2D2D', 'EBEBEB', 'C0392B', '2C3E50', 'E74C3C', '34495E', '7F8C8D', 'BDC3C7') },
  'diagonal block narrative': { tone: 'dark',  slots: s('1A1A2E', 'FFFFFF', '2D2D44', 'F0F0F5', '6366F1', 'EC4899', '7C3AED', 'F59E0B', '10B981', '8B5CF6') },
  'kpi dashboard strip':      { tone: 'light', slots: DEFAULT_THEME_SLOTS },
  'geometric proposal grid':  { tone: 'light', slots: s('1B1B1B', 'FFFFFF', '333333', 'F2F2F2', 'E63946', '1D3557', '457B9D', 'A8DADC', 'F1FAEE', '264653') },
  'accent monochrome focus':  { tone: 'light', slots: s('1A1A1A', 'FAFAFA', '333333', 'E5E5E5', '666666', '999999', '4A4A4A', 'B3B3B3', '2D2D2D', '7A7A7A') },
  'process timeline ribbon':  { tone: 'light', slots: DEFAULT_THEME_SLOTS },
  'organic editorial canvas': { tone: 'light', slots: s('2C2416', 'FAF3E8', '4A3F2F', 'EDE5D4', '6B8F71', 'C9A84C', '8B7355', 'A67C52', '5B7553', 'D4A574') },
}

/**
 * Look up the default ThemeSlots + tone for a given design style.
 * Falls through to DEFAULT_THEME_SLOTS when the style is unknown or unset.
 */
export function getStyleDefaults(designStyle?: string | null): StyleDefaults {
  if (!designStyle) return { slots: DEFAULT_THEME_SLOTS, tone: null }
  return STYLE_DEFAULTS[designStyle.toLowerCase()] ?? { slots: DEFAULT_THEME_SLOTS, tone: null }
}
