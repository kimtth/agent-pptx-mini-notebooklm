/**
 * IPC Handler: Theme / Palette
 * - LLM palette generation via Copilot SDK
 * - Auto-assignment of 12 OOXML slots (ported from oppadu source)
 * - .thmx export via JSZip
 */

import { ipcMain, dialog } from 'electron';
import fs from 'fs/promises';
import JSZip from 'jszip';
import { CopilotClient, approveAll } from '@github/copilot-sdk';
import { normalizeGitHubToken, resolveCopilotCliPath } from './copilot-runtime.ts';
import { onSettingsSaved } from './settings-handler.ts';
import type { SessionConfig } from '@github/copilot-sdk';
import type { PaletteColor, ThemeSlots, ThemeTokens } from '../../src/domain/entities/palette';
import { DEFAULT_THEME_SLOTS } from '../../src/domain/theme/default-theme';

// ---------------------------------------------------------------------------
// Color utilities (ported from oppadu)
// ---------------------------------------------------------------------------

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16),
  };
}

function getRelativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const [rs, gs, bs] = [r / 255, g / 255, b / 255].map((c) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4),
  );
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const { r, g, b } = hexToRgb(hex);
  const rs = r / 255, gs = g / 255, bs = b / 255;
  const max = Math.max(rs, gs, bs);
  const min = Math.min(rs, gs, bs);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rs) h = ((gs - bs) / d + (gs < bs ? 6 : 0)) / 6;
  else if (max === gs) h = ((bs - rs) / d + 2) / 6;
  else h = ((rs - gs) / d + 4) / 6;
  return { h: h * 360, s, l };
}

// ---------------------------------------------------------------------------
// Auto-assign 12 OOXML theme slots (ported from oppadu)
// ---------------------------------------------------------------------------

export function autoAssignThemeColors(colors: PaletteColor[]): ThemeSlots {
  if (colors.length === 0) {
    return DEFAULT_THEME_SLOTS;
  }

  const sorted = [...colors].sort(
    (a, b) => getRelativeLuminance(a.hex) - getRelativeLuminance(b.hex),
  );

  // Darkest 2 → dk1, dk2 (in luminance-ascending order, so index 0 is darkest)
  const dk1 = sorted[0]?.hex.replace('#', '') ?? DEFAULT_THEME_SLOTS.dk1;
  const dk2 = sorted[1]?.hex.replace('#', '') ?? DEFAULT_THEME_SLOTS.dk2;

  // Lightest 2 → lt1, lt2
  const lt1 = sorted[sorted.length - 1]?.hex.replace('#', '') ?? DEFAULT_THEME_SLOTS.lt1;
  const lt2 = sorted[sorted.length - 2]?.hex.replace('#', '') ?? DEFAULT_THEME_SLOTS.lt2;

  // Middle colors sorted by saturation desc → take top 8 → sort by hue → use 6
  const middle = sorted.slice(2, sorted.length - 2);
  const bySat = [...middle].sort(
    (a, b) => hexToHsl(b.hex).s - hexToHsl(a.hex).s,
  );
  const top8 = bySat.slice(0, 8);
  const byHue = [...top8].sort((a, b) => hexToHsl(a.hex).h - hexToHsl(b.hex).h);

  // Spread 6 evenly across the hue-sorted list
  const count = byHue.length;
  const accents = Array.from({ length: 6 }, (_, i) => {
    const idx = count <= 6 ? i : Math.round((i / 5) * (count - 1));
    return byHue[Math.min(idx, count - 1)]?.hex.replace('#', '') ?? DEFAULT_THEME_SLOTS.accent1;
  });

  // hlink: blue range (hue 180–260, saturation > 0.15)
  const hlinkColor = colors.find((c) => {
    const { h, s } = hexToHsl(c.hex);
    return h >= 180 && h <= 260 && s > 0.15;
  });
  const hlink = hlinkColor?.hex.replace('#', '') ?? accents[0];

  // folHlink: purple range (hue 260–320, saturation > 0.10)
  const folHlinkColor = colors.find((c) => {
    const { h, s } = hexToHsl(c.hex);
    return h >= 260 && h <= 320 && s > 0.1;
  });
  const folHlink = folHlinkColor?.hex.replace('#', '') ?? accents[3];

  return {
    dk1, lt1, dk2, lt2,
    accent1: accents[0], accent2: accents[1], accent3: accents[2],
    accent4: accents[3], accent5: accents[4], accent6: accents[5],
    hlink, folHlink,
  };
}

// ---------------------------------------------------------------------------
// .thmx export via JSZip (matching oppadu's structure exactly)
// ---------------------------------------------------------------------------

function srgbClr(hex: string): string {
  return `<a:srgbClr val="${hex.toUpperCase()}"/>`;
}

function buildTheme1Xml(name: string, slots: ThemeSlots): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="${name}">
  <a:themeElements>
    <a:clrScheme name="${name}">
      <a:dk1>${srgbClr(slots.dk1)}</a:dk1>
      <a:lt1>${srgbClr(slots.lt1)}</a:lt1>
      <a:dk2>${srgbClr(slots.dk2)}</a:dk2>
      <a:lt2>${srgbClr(slots.lt2)}</a:lt2>
      <a:accent1>${srgbClr(slots.accent1)}</a:accent1>
      <a:accent2>${srgbClr(slots.accent2)}</a:accent2>
      <a:accent3>${srgbClr(slots.accent3)}</a:accent3>
      <a:accent4>${srgbClr(slots.accent4)}</a:accent4>
      <a:accent5>${srgbClr(slots.accent5)}</a:accent5>
      <a:accent6>${srgbClr(slots.accent6)}</a:accent6>
      <a:hlink>${srgbClr(slots.hlink)}</a:hlink>
      <a:folHlink>${srgbClr(slots.folHlink)}</a:folHlink>
    </a:clrScheme>
    <a:fontScheme name="${name}">
      <a:majorFont>
        <a:latin typeface="Calibri Light" panose="020F0302020204030204"/>
        <a:ea typeface=""/>
        <a:cs typeface=""/>
      </a:majorFont>
      <a:minorFont>
        <a:latin typeface="Calibri" panose="020F0502020204030204"/>
        <a:ea typeface=""/>
        <a:cs typeface=""/>
      </a:minorFont>
    </a:fontScheme>
    <a:fmtScheme name="${name}">
      <a:fillStyleLst>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:gradFill rotWithShape="1">
          <a:gsLst>
            <a:gs pos="0"><a:schemeClr val="phClr"><a:lumMod val="110000"/><a:satMod val="105000"/><a:tint val="67000"/></a:schemeClr></a:gs>
            <a:gs pos="50000"><a:schemeClr val="phClr"><a:lumMod val="105000"/><a:satMod val="103000"/><a:tint val="73000"/></a:schemeClr></a:gs>
            <a:gs pos="100000"><a:schemeClr val="phClr"><a:lumMod val="105000"/><a:satMod val="109000"/><a:tint val="81000"/></a:schemeClr></a:gs>
          </a:gsLst>
          <a:lin ang="5400000" scaled="0"/>
        </a:gradFill>
        <a:gradFill rotWithShape="1">
          <a:gsLst>
            <a:gs pos="0"><a:schemeClr val="phClr"><a:satMod val="103000"/><a:lumMod val="102000"/><a:tint val="94000"/></a:schemeClr></a:gs>
            <a:gs pos="100000"><a:schemeClr val="phClr"><a:lumMod val="99000"/><a:satMod val="120000"/><a:shade val="78000"/></a:schemeClr></a:gs>
          </a:gsLst>
          <a:lin ang="5400000" scaled="0"/>
        </a:gradFill>
      </a:fillStyleLst>
      <a:lnStyleLst>
        <a:ln w="6350" cap="flat" cmpd="sng" algn="ctr">
          <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
          <a:prstDash val="solid"/>
          <a:miter lim="800000"/>
        </a:ln>
        <a:ln w="12700" cap="flat" cmpd="sng" algn="ctr">
          <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
          <a:prstDash val="solid"/>
          <a:miter lim="800000"/>
        </a:ln>
        <a:ln w="19050" cap="flat" cmpd="sng" algn="ctr">
          <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
          <a:prstDash val="solid"/>
          <a:miter lim="800000"/>
        </a:ln>
      </a:lnStyleLst>
      <a:effectStyleLst>
        <a:effectStyle><a:effectLst/></a:effectStyle>
        <a:effectStyle><a:effectLst/></a:effectStyle>
        <a:effectStyle>
          <a:effectLst>
            <a:outerShdw blurRad="57150" dist="19050" dir="5400000" algn="ctr" rotWithShape="0">
              <a:srgbClr val="000000"><a:alpha val="63000"/></a:srgbClr>
            </a:outerShdw>
          </a:effectLst>
        </a:effectStyle>
      </a:effectStyleLst>
      <a:bgFillStyleLst>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"><a:tint val="95000"/><a:satMod val="170000"/></a:schemeClr></a:solidFill>
        <a:gradFill rotWithShape="1">
          <a:gsLst>
            <a:gs pos="0"><a:schemeClr val="phClr"><a:tint val="93000"/><a:satMod val="150000"/><a:shade val="98000"/><a:lumMod val="102000"/></a:schemeClr></a:gs>
            <a:gs pos="50000"><a:schemeClr val="phClr"><a:tint val="98000"/><a:satMod val="130000"/><a:shade val="90000"/><a:lumMod val="103000"/></a:schemeClr></a:gs>
            <a:gs pos="100000"><a:schemeClr val="phClr"><a:shade val="63000"/><a:satMod val="120000"/></a:schemeClr></a:gs>
          </a:gsLst>
          <a:lin ang="5400000" scaled="0"/>
        </a:gradFill>
      </a:bgFillStyleLst>
    </a:fmtScheme>
  </a:themeElements>
</a:theme>`;
}

async function buildThmxZip(tokens: ThemeTokens): Promise<Buffer> {
  const zip = new JSZip();
  const name = tokens.name || 'Custom Theme';

  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/theme/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
</Types>`);

  const rels = zip.folder('_rels');
  rels?.file('.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.microsoft.com/office/2006/relationships/ui/extensibility" Target="theme/theme/themeManager.xml"/>
</Relationships>`);

  const themeDir = zip.folder('theme');
  const themeThemeDir = themeDir?.folder('theme');
  const themeThemeRels = themeThemeDir?.folder('_rels');

  themeThemeDir?.file('themeManager.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Office:themeManager xmlns:Office="http://schemas.microsoft.com/office/drawing/2007/8/2/themeManager"/>`);

  themeThemeRels?.file('themeManager.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme1.xml"/>
</Relationships>`);

  themeThemeDir?.file('theme1.xml', buildTheme1Xml(name, tokens.slots));

  return zip.generateAsync({
    type: 'nodebuffer',
    mimeType: 'application/vnd.ms-officetheme',
  });
}

// ---------------------------------------------------------------------------
// LLM palette generation
// ---------------------------------------------------------------------------

const PALETTE_PROMPT_TEMPLATE = `Based on the following core colors, generate a palette of 39 colors suitable for clean and professional business report and chart designs.

* Core colors: {{seeds}}

Ensure the colors are not randomly mixed. Instead, organize them according to the following criteria:

- Neutral colors for backgrounds and text
- Lightness/saturation variations around the main theme color (tone-on-tone)
- Supporting and accent colors for data comparison

Provide the result as plain text in the format below so it is easy to copy.

List only the color names and HEX codes without grouping.

ColorName1 | #HEXCODE1
ColorName2 | #HEXCODE2
...`;

function parsePaletteResponse(text: string): PaletteColor[] {
  const normalized = text
    .replace(/```[a-zA-Z]*\n?/g, '')
    .replace(/```/g, '');
  const lines = normalized.split('\n');
  const colors: PaletteColor[] = [];
  const seenHex = new Set<string>();
  for (const line of lines) {
    const match = line.match(/^\s*(?:[-*•]\s*)?(?:\d+[.)]\s*)?(?:\|\s*)?(.+?)\s*\|\s*(#[0-9A-Fa-f]{6})\s*(?:\|.*)?$/);
    if (match) {
      const name = match[1].trim();
      const hex = match[2].toUpperCase();
      if (!name || /colorname/i.test(name) || seenHex.has(hex)) continue;
      seenHex.add(hex);
      colors.push({ name, hex });
    }
  }
  return colors;
}

function extractSessionText(result: unknown): string {
  const payload = result as {
    content?: string;
    data?: { content?: string };
    output_text?: string;
    output?: Array<{ content?: Array<{ text?: string }> }>;
  };

  const direct = payload?.content ?? payload?.data?.content ?? payload?.output_text;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();

  const parts: string[] = [];
  const output = Array.isArray(payload?.output) ? payload.output : [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      if (typeof part?.text === 'string' && part.text.trim()) parts.push(part.text.trim());
    }
  }
  return parts.join('\n').trim();
}

let clientInstance: CopilotClient | null = null;
const AZURE_OPENAI_SCOPE = 'https://cognitiveservices.azure.com/.default';
const PALETTE_TIMEOUT_MS = 180_000;

function getClient(): CopilotClient {
  if (!clientInstance) {
    const token = normalizeGitHubToken(process.env.GITHUB_TOKEN);
    const cliPath = resolveCopilotCliPath();
    clientInstance = new CopilotClient(
      token
        ? {
            cliPath,
            githubToken: token,
            useLoggedInUser: false,
          }
        : { cliPath },
    );
  }
  return clientInstance;
}

async function getPaletteSessionOptions(): Promise<Partial<SessionConfig>> {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT?.trim();
  const modelName = process.env.MODEL_NAME;
  const useAzureOpenAI = Boolean(endpoint);
  const useGitHubModels = !useAzureOpenAI;

  if (!modelName && !useAzureOpenAI) return { streaming: false };
  if (useGitHubModels) {
    return { ...(modelName ? { model: modelName } : {}), streaming: false };
  }

  if (useAzureOpenAI) {
    if (!endpoint || !modelName) {
      throw new Error('AZURE_OPENAI_ENDPOINT and MODEL_NAME are required to use Azure OpenAI / Foundry model serving');
    }

    const apiKey = process.env.AZURE_OPENAI_API_KEY;
    let auth: { apiKey?: string; bearerToken?: string };
    if (apiKey && apiKey.trim()) {
      auth = { apiKey: apiKey.trim() };
    } else {
      const { DefaultAzureCredential } = await import('@azure/identity');
      const tenantId = process.env.AZURE_TENANT_ID?.trim() || undefined;
      const credential = new DefaultAzureCredential(tenantId ? { tenantId } : undefined);
      const tokenResult = await credential.getToken(AZURE_OPENAI_SCOPE);
      if (!tokenResult) throw new Error('Failed to acquire Azure bearer token. Set AZURE_OPENAI_API_KEY or run "az login".');
      auth = { bearerToken: tokenResult.token };
    }

    return {
      model: modelName,
      streaming: false,
      provider: {
        type: 'openai',
        baseUrl: endpoint.replace(/\/$/, ''),
        ...auth,
        wireApi: 'completions',
      },
    };
  }

  throw new Error('Invalid model session configuration.');
}

async function generatePaletteWithLLM(seeds: string[]): Promise<PaletteColor[]> {
  const seedStr = seeds.join(',');
  const prompt = PALETTE_PROMPT_TEMPLATE.replace('{{seeds}}', seedStr);

  const copilot = getClient();
  const sessionOpts = await getPaletteSessionOptions();
  const session = await copilot.createSession({ ...sessionOpts, onPermissionRequest: approveAll });

  try {
    const result = await session.sendAndWait({ prompt }, PALETTE_TIMEOUT_MS);
    const text = extractSessionText(result);
    return parsePaletteResponse(text);
  } finally {
    await session.disconnect().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Handler registration
// ---------------------------------------------------------------------------

export function registerThemeHandlers(): void {
  onSettingsSaved(() => { clientInstance = null; });

  ipcMain.handle('theme:generatePalette', async (_event, seeds: string[]) => {
    try {
      const colors = await generatePaletteWithLLM(seeds);
      return colors;
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : 'Palette generation failed');
    }
  });

  ipcMain.handle('theme:autoAssign', async (_event, colors: PaletteColor[]) => {
    return autoAssignThemeColors(colors);
  });

  ipcMain.handle('theme:exportThmx', async (_event, tokens: ThemeTokens) => {
    try {
      const buffer = await buildThmxZip(tokens);
      const safeName = (tokens.name || 'theme').replace(/[^\w\s\-]/g, '_');
      const { filePath, canceled } = await dialog.showSaveDialog({
        title: 'Export PowerPoint Theme',
        defaultPath: `${safeName}.thmx`,
        filters: [{ name: 'PowerPoint Theme', extensions: ['thmx'] }],
      });
      if (canceled || !filePath) return { success: false, error: 'Cancelled' };
      await fs.writeFile(filePath, buffer);
      return { success: true, path: filePath };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Export failed' };
    }
  });
}
