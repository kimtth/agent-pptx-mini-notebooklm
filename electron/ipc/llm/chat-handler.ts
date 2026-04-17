/**
 * IPC Handler: Chat — Copilot SDK integration
 * Ported from ref/copilot-sdk-pptx-agent/src/infrastructure/copilot/client.ts
 * and ref/copilot-sdk-pptx-agent/src/app/api/chat/route.ts
 *
 * SSE is replaced with win.webContents.send() IPC events.
 */

import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import fs from 'fs/promises';
import { existsSync as fsExistsSync } from 'fs';
import path from 'path';
import { onSettingsSaved } from '../config/settings-handler.ts';
import type { LLMToolDefinition, LLMSessionConfig } from './llm-provider.ts';
import { getActiveProvider, resetAllProviders, registerProvider } from './llm-provider.ts';
import type { LLMSession, LLMStreamDelta } from './llm-provider.ts';
import { resolveWorkflowInstructionPath } from './copilot-runtime.ts';
import { copilotProvider } from './copilot-adapter.ts';
import { openaiProvider, azureOpenAIProvider, claudeProvider } from './aisdk-adapter.ts';
import type { ThemeTokens } from '../../../src/domain/entities/palette';
import type {
  SlideItem,
  DesignBrief,
  FrameworkType,
  ScenarioPayload,
  SlideUpdatePayload,
} from '../../../src/domain/entities/slide-work';
import type { ChatToolEvent, DataFile, ScrapeResult } from '../../../src/domain/ports/ipc';
import { getIconifyCollectionById } from '../../../src/domain/icons/iconify';
import type { IconifyCollectionId } from '../../../src/domain/icons/iconify';
import { formatCatalogForPrompt } from '../../../src/domain/icons/icon-catalog';
import { formatWorkflowForPrompt, getWorkflowConfig, type WorkflowConfig } from '../../../src/domain/workflows/workflow-config';
import { renderPresentationToFile, formatExecutionFailure, computeLayoutSpecs, persistSlideAssetsToWorkspace } from '../pptx/pptx-handler.ts';
import type { RenderConfig } from '../pptx/pptx-handler.ts';
import { buildManagedSystemPrompt } from './system-prompts.ts';
import { readWorkspaceDir, resolveBundledPath } from '../project/workspace-utils.ts';
import { retrieveContext, hasRaptorTree } from '../data/raptor-handler.ts';
import type { RetrievedSection } from '../data/raptor-handler.ts';

const CHAT_REQUEST_TIMEOUT_MS = 120 * 60 * 1000;
const CHAT_INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000;

type ActiveChatRequest = {
  cancel: (reason?: string) => void;
};

let activeChatRequest: ActiveChatRequest | null = null;



// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

interface WorkspaceContext {
  title: string;
  slides: SlideItem[];
  designBrief: DesignBrief | null;
  designStyle: import('../../../src/domain/entities/slide-work').DesignStyle | null;
  customBackgroundColor: string | null;
  framework: FrameworkType | null;
  customFrameworkPrompt: string | null;
  theme: ThemeTokens | null;
  workflow: WorkflowConfig | null;
  dataSources: DataFile[];
  urlSources: Array<{ url: string; status: string; result?: ScrapeResult }>;
  iconProvider: 'iconify';
  iconCollection: IconifyCollectionId;
  availableIcons: string[];
}

type SessionMode = 'story' | 'pptx';

type SkillDirectoryEntry = {
  name: string;
  path: string;
};

async function listSkillDirectories(): Promise<SkillDirectoryEntry[]> {
  const skillsRoot = resolveBundledPath('skills');
  try {
    const entries = await fs.readdir(skillsRoot, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({
        name: entry.name,
        path: path.join(skillsRoot, entry.name),
      }));
  } catch {
    return [];
  }
}

function isTargetedPptxRepair(workflow: WorkflowConfig | null): boolean {
  return workflow?.id === 'poststaging'
}

function rankSkillDirectory(mode: SessionMode, skillName: string, workflow: WorkflowConfig | null): number {
  const normalized = skillName.toLowerCase();

  if (isTargetedPptxRepair(workflow)) {
    if (/manipulation|review|qa|validation|final/.test(normalized)) return 0;
    if (/design|style|designer/.test(normalized)) return 5;
    return 10;
  }

  if (mode === 'pptx') {
    if (/manipulation|python-pptx|generate-pptx/.test(normalized)) return 0;
    if (/design|style|designer/.test(normalized)) return 1;
    if (/review|qa|validation|final/.test(normalized)) return 2;
    if (/story|storyboard|framework|summarize/.test(normalized)) return 10;
    return 10;
  }

  if (/slide-story|story|framework/.test(normalized)) return 0;
  if (/summarize/.test(normalized)) return 1;
  if (/design|style|designer/.test(normalized)) return 2;
  if (/review|qa|validation|final/.test(normalized)) return 3;
  if (/manipulation|python-pptx|generate-pptx/.test(normalized)) return 4;
  return 10;
}

async function getSkillDirectories(mode: SessionMode, workflow: WorkflowConfig | null): Promise<string[]> {
  const entries = await listSkillDirectories();
  if (entries.length === 0) return [];

  const ranked = entries
    .map((entry) => ({
      ...entry,
      rank: rankSkillDirectory(mode, entry.name, workflow),
    }))
    .filter((entry) => entry.rank < 10)
    .sort((left, right) => left.rank - right.rank || left.name.localeCompare(right.name));

  return ranked.map((entry) => entry.path);
}

async function resolveWorkflow(_message: string, workspace: WorkspaceContext): Promise<WorkflowConfig | null> {
  // Workflow is determined by workspace state set via UI buttons, not by
  // regex-parsing the user's message (which would only work for English).
  if (workspace.workflow) return workspace.workflow
  return null
}

function resolveSessionMode(_message: string, _workspace: WorkspaceContext, workflow: WorkflowConfig | null): SessionMode {
  if (workflow) return workflow.mode as SessionMode
  return 'story'
}

function truncateText(value: string, maxLen: number): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  if (compact.length <= maxLen) return compact;
  return `${compact.slice(0, maxLen)}...`;
}

function truncateMarkdown(value: string, maxLen: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen)}\n\n[Truncated]`;
}

async function readGeneratedArtifactExcerpt(filePath: string, maxLen: number): Promise<string | null> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const trimmed = content.trim();
    return trimmed ? truncateMarkdown(trimmed, maxLen) : null;
  } catch {
    return null;
  }
}

async function readArtifactMarkdown(artifact: { markdownPath: string } | undefined, maxLen: number): Promise<string | null> {
  if (!artifact?.markdownPath) return null;
  try {
    const markdown = await fs.readFile(artifact.markdownPath, 'utf-8');
    const trimmed = markdown.trim();
    return trimmed ? truncateMarkdown(trimmed, maxLen) : null;
  } catch {
    return null;
  }
}

async function readWorkflowMarkdown(workflow: WorkflowConfig | null, maxLen: number): Promise<string | null> {
  if (!workflow?.instructionFile) return null;
  try {
    const markdown = await fs.readFile(resolveWorkflowInstructionPath(workflow.instructionFile), 'utf-8');
    const trimmed = markdown.trim();
    return trimmed ? truncateMarkdown(trimmed, maxLen) : null;
  } catch {
    return null;
  }
}

/**
 * Extract only the matching style block from references/styles.md instead of loading all 30 specs.
 * Matches by style number prefix or fuzzy name match. Returns null if not found.
 */
async function readDesignStyleBlock(styleName: string): Promise<string | null> {
  const stylesPath = resolveBundledPath('skills', 'pptx-design-styles', 'references', 'styles.md');
  let content: string;
  try {
    content = await fs.readFile(stylesPath, 'utf-8');
  } catch {
    return null;
  }

  // Split by H2 headers (## NN. StyleName or ## M1. MotifName)
  const sections = content.split(/^(?=## (?:\d+|M\d+)\.\s)/m);
  const normalizedQuery = styleName.toLowerCase().replace(/[-_\s]+/g, '');
  for (const section of sections) {
    const headerMatch = section.match(/^## (?:\d+|M\d+)\.\s+(.+)/);
    if (!headerMatch) continue;
    const sectionName = headerMatch[1].toLowerCase().replace(/[-_\s]+/g, '');
    if (sectionName.includes(normalizedQuery) || normalizedQuery.includes(sectionName)) {
      return section.trim();
    }
  }
  return null;
}

/**
 * Extract the CSS + HTML preview block for a design style from the
 * HTML reference file.  Returns a combined string with both the CSS
 * rules and the HTML markup for the selected style, giving the LLM a
 * concrete visual reference to translate into python-pptx shapes.
 */
async function readDesignStyleHtml(styleName: string): Promise<string | null> {
  const htmlPath = resolveBundledPath('skills', 'pptx-design-styles', 'preview', 'modern-pptx-designs-30.html');
  let content: string;
  try {
    content = await fs.readFile(htmlPath, 'utf-8');
  } catch {
    return null;
  }

  // Word-overlap matching: if ≥2 significant words match, it's a hit.
  // Handles reorderings like "SciFi Holographic Data" vs "SCIFI DATA / HOLOGRAPHIC".
  const queryWords = styleName.toLowerCase().replace(/[-_/]+/g, ' ').split(/\s+/).filter(w => w.length > 1);

  function wordsMatch(headerText: string): boolean {
    const headerWords = headerText.toLowerCase().replace(/[-_/]+/g, ' ').split(/\s+/).filter(w => w.length > 1);
    const overlap = queryWords.filter(w => headerWords.some(hw => hw.includes(w) || w.includes(hw)));
    // Require at least 2 words overlap, or all query words if query is short
    return overlap.length >= Math.min(2, queryWords.length);
  }

  // ── Extract CSS block ──
  // CSS sections start with  /* NN STYLE_NAME */
  const cssSections = content.split(/(?=\/\* \d{2} )/);
  let cssBlock = '';
  for (const section of cssSections) {
    const header = section.match(/^\/\* (\d{2}) ([^*]+)\*\//);
    if (!header) continue;
    if (wordsMatch(header[2])) {
      cssBlock = section.trim();
      break;
    }
  }

  // ── Extract HTML block ──
  // HTML sections start with  <!-- NN Style Name -->
  const htmlSections = content.split(/(?=<!-- \d{2} )/);
  let htmlBlock = '';
  for (const section of htmlSections) {
    const header = section.match(/^<!-- (\d{2}) ([^-]+)-->/);
    if (!header) continue;
    if (wordsMatch(header[2])) {
      // Take the first <div class="card">...</div> block
      const cardEnd = section.indexOf('</div>\n\n');
      htmlBlock = cardEnd > 0 ? section.substring(0, cardEnd + 6).trim() : section.trim();
      break;
    }
  }

  if (!cssBlock && !htmlBlock) return null;

  const parts: string[] = [];
  if (cssBlock) {
    parts.push('```css');
    parts.push(cssBlock);
    parts.push('```');
  }
  if (htmlBlock) {
    parts.push('```html');
    parts.push(htmlBlock);
    parts.push('```');
  }
  return parts.join('\n');
}

/**
 * Check if a structured summary file has a RAPTOR tree.
 * Returns the parsed JSON or null.
 */
async function readStructuredSummaryMeta(artifact: { structuredSummaryPath?: string } | undefined): Promise<{ path: string; hasRaptor: boolean; globalSummary?: { mainTheme?: string } } | null> {
  if (!artifact?.structuredSummaryPath) return null;
  try {
    const raw = await fs.readFile(artifact.structuredSummaryPath, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      path: artifact.structuredSummaryPath,
      hasRaptor: hasRaptorTree(parsed),
      globalSummary: (parsed.globalSummary ?? undefined) as { mainTheme?: string } | undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Format retrieved RAPTOR sections into concise prompt context.
 */
function formatRetrievedContext(sections: RetrievedSection[], documentTitle: string): string {
  const parts: string[] = [];
  parts.push(`### Relevant Context from: ${documentTitle}\n`);
  for (const sec of sections) {
    parts.push(`#### ${sec.heading}`);
    // Cap each section text to keep prompt tight
    const text = sec.text.length > 1500 ? sec.text.slice(0, 1500) + '...' : sec.text;
    parts.push(text);
    if (sec.clusterContext.length > 0) {
      parts.push(`_Topics: ${sec.clusterContext.slice(0, 2).join('; ')}_`);
    }
    parts.push('');
  }
  return parts.join('\n');
}

async function formatFileSource(ds: DataFile, slideQueries?: string[]): Promise<string[]> {
  const parts = [`- **${ds.name}** (${ds.type.toUpperCase()}): ${ds.summary}`];
  if (ds.consumed) {
    const meta = await readStructuredSummaryMeta(ds.consumed);

    // RAPTOR retrieval path: if tree available and we have slide queries, retrieve targeted context
    if (meta?.hasRaptor && slideQueries && slideQueries.length > 0) {
      try {
        const retrieved = await retrieveContext(meta.path, slideQueries, 8);
        if (retrieved.length > 0) {
          parts.push(formatRetrievedContext(retrieved, ds.name));
          return parts;
        }
      } catch (err) {
        console.warn('[chat] RAPTOR retrieval failed, falling back:', err);
      }
    }

    // RAPTOR global summary path: for storyboard (no slide queries yet)
    if (meta?.hasRaptor && meta.globalSummary?.mainTheme) {
      try {
        // Broad retrieval with document title as query
        const retrieved = await retrieveContext(meta.path, [ds.name, meta.globalSummary.mainTheme], 12);
        if (retrieved.length > 0) {
          parts.push(formatRetrievedContext(retrieved, ds.name));
          return parts;
        }
      } catch (err) {
        console.warn('[chat] RAPTOR broad retrieval failed, falling back:', err);
      }
    }

    // Fallback: raw markdown (truncated)
    parts.push(`  Parsed source file: ${ds.consumed.markdownPath}`);
    const markdown = await readArtifactMarkdown(ds.consumed, 20_000);
    if (markdown) {
      parts.push('  Parsed content:');
      parts.push('```md');
      parts.push(markdown);
      parts.push('```');
    } else {
      parts.push(ds.consumed.summaryText);
    }
    return parts;
  }
  if (ds.headers && ds.headers.length > 0) {
    parts.push(`  Columns: ${ds.headers.join(', ')}`);
  }
  if (Array.isArray(ds.rows) && ds.rows.length > 0) {
    parts.push(`  Sample rows: ${JSON.stringify(ds.rows.slice(0, 3))}`);
  }
  if (typeof ds.text === 'string' && ds.text.trim()) {
    parts.push(`  Excerpt: ${truncateText(ds.text, 1000)}`);
  }
  return parts;
}

async function formatUrlSource(entry: WorkspaceContext['urlSources'][number], slideQueries?: string[]): Promise<string[]> {
  const parts = [`- **${entry.url}** (${entry.status})`];
  if (entry.result?.error) {
    parts.push(`  Error: ${entry.result.error}`);
    return parts;
  }
  if (entry.result?.consumed) {
    const meta = await readStructuredSummaryMeta(entry.result.consumed);

    // RAPTOR retrieval path
    if (meta?.hasRaptor && slideQueries && slideQueries.length > 0) {
      try {
        const retrieved = await retrieveContext(meta.path, slideQueries, 8);
        if (retrieved.length > 0) {
          parts.push(formatRetrievedContext(retrieved, entry.url));
          return parts;
        }
      } catch (err) {
        console.warn('[chat] RAPTOR retrieval failed for URL, falling back:', err);
      }
    }

    if (meta?.hasRaptor && meta.globalSummary?.mainTheme) {
      try {
        const retrieved = await retrieveContext(meta.path, [entry.url, meta.globalSummary.mainTheme], 12);
        if (retrieved.length > 0) {
          parts.push(formatRetrievedContext(retrieved, entry.url));
          return parts;
        }
      } catch (err) {
        console.warn('[chat] RAPTOR broad retrieval failed for URL, falling back:', err);
      }
    }

    // Fallback: raw markdown
    parts.push(`  Parsed source file: ${entry.result.consumed.markdownPath}`);
    const markdown = await readArtifactMarkdown(entry.result.consumed, 20_000);
    if (markdown) {
      parts.push('  Parsed content:');
      parts.push('```md');
      parts.push(markdown);
      parts.push('```');
    } else {
      parts.push(entry.result.consumed.summaryText);
    }
    return parts;
  }
  if (entry.result?.title) {
    parts.push(`  Title: ${entry.result.title}`);
  }
  if (entry.result?.text) {
    parts.push(`  Excerpt: ${truncateText(entry.result.text, 1000)}`);
  }
  if (entry.result?.lists?.length) {
    parts.push(`  Key list items: ${entry.result.lists.slice(0, 8).join(' | ')}`);
  }
  return parts;
}

async function buildGeneratedArtifactContext(workspaceAbsPath: string): Promise<string[]> {
  const previewDir = path.join(workspaceAbsPath, 'previews');
  const artifacts = [
    { label: 'Generated PPTX', path: path.join(previewDir, 'presentation-preview.pptx'), kind: 'binary' as const },
    { label: 'Layout input JSON', path: path.join(previewDir, 'layout-input.json'), kind: 'json' as const },
    { label: 'Layout specs JSON', path: path.join(previewDir, 'layout-specs.json'), kind: 'json' as const },
    { label: 'Slide assets JSON', path: path.join(previewDir, 'slide-assets.json'), kind: 'json' as const },
  ];

  const parts = [
    '## Generated PPTX Repair Scope\n',
    'This is a targeted post-generation repair pass.',
    'Only inspect and modify the generated PPTX and preview JSON artifacts below.',
    'Do NOT inspect application source files, bundled skills, or unrelated workspace data sources unless the user explicitly asks for app-code changes.',
  ];

  for (const artifact of artifacts) {
    const exists = fsExistsSync(artifact.path);
    parts.push(`- ${artifact.label}: ${artifact.path}${exists ? '' : ' (missing)'}`);
    if (!exists || artifact.kind !== 'json') continue;
    const excerpt = await readGeneratedArtifactExcerpt(artifact.path, 4_000);
    if (!excerpt) continue;
    parts.push(`  Current content (${path.basename(artifact.path)}):`);
    parts.push('```json');
    parts.push(excerpt);
    parts.push('```');
  }

  parts.push('');
  return parts;
}

async function buildPrompt(
  message: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  workspace: WorkspaceContext,
  mode: SessionMode,
  workflow: WorkflowConfig | null,
): Promise<string> {
  const parts: string[] = [];
  const effectiveWorkflow = workflow ?? workspace.workflow;
  const targetedRepairMode = isTargetedPptxRepair(effectiveWorkflow);
  const historyForPrompt = targetedRepairMode
    ? history.filter((msg) => msg.role === 'user').slice(-3)
    : mode === 'pptx'
      ? history.filter((msg) => msg.role === 'user')
    : history;

  // Chat history
  if (historyForPrompt.length > 0) {
    parts.push('## Conversation History\n');
    for (const msg of historyForPrompt.slice(-10)) {
      parts.push(`**${msg.role === 'user' ? 'User' : 'Assistant'}**: ${msg.content}`);
    }
    parts.push('');
  }

  // Workspace state — include the absolute workspace path so generated code resolves paths correctly
  const workspaceAbsPath = await readWorkspaceDir();

  if (workspace.title || workspace.slides.length > 0) {
    parts.push('## Current Workspace\n');
    parts.push(`Workspace directory (absolute): ${workspaceAbsPath}`);
    parts.push(`Images directory (absolute): ${path.join(workspaceAbsPath, 'images')}`);
    if (workspace.title) parts.push(`Presentation: "${workspace.title}"`);
    if (workspace.framework) parts.push(`Framework: ${workspace.framework}`);
    if (workspace.framework === 'custom-prompt' && workspace.customFrameworkPrompt?.trim()) {
      parts.push(`Custom framework prompt: ${workspace.customFrameworkPrompt.trim()}`);
    }
    if (workspace.designStyle) parts.push(`Design style: ${workspace.designStyle}`);
    if (workspace.slides.length > 0) {
      parts.push(`Slides: ${workspace.slides.length}`);
      for (const s of workspace.slides) {
        const imgParts: string[] = [];
        const selectedImages = s.selectedImages ?? [];
        const primaryImage = selectedImages[0] ?? null;
        const primaryImagePath = primaryImage?.imagePath ?? s.imagePath ?? null;

        if (primaryImagePath) imgParts.push(`imagePath: ${primaryImagePath}`);
        if ((s.imageQueries ?? []).length > 0) imgParts.push(`imageQueries: ${(s.imageQueries ?? []).join(' | ')}`);
        if (selectedImages.length > 0) {
          for (let idx = 0; idx < selectedImages.length; idx++) {
            const img = selectedImages[idx];
            const imgRef = img.imagePath ?? img.imageUrl ?? img.id;
            imgParts.push(`image[${idx}]: ${imgRef}`);
          }
        }
        parts.push(`  ${s.number}. [${s.layout}] ${s.title}`);
        parts.push(`     keyMessage: ${s.keyMessage}`);
        if (s.bullets.length > 0) parts.push(`     bullets: ${s.bullets.join(' | ')}`);
        if (s.icon) parts.push(`     icon: ${s.icon}`);
        parts.push(`     requiredIconCollection: ${workspace.iconCollection}`);
        if (imgParts.length > 0) parts.push(`     ${imgParts.join('; ')}`);
      }
    }
    if (workspace.theme) {
      parts.push(`Theme: "${workspace.theme.name}" — Primary: #${workspace.theme.C.PRIMARY}, Accent: #${workspace.theme.C.ACCENT1}`);
    }
    parts.push('');
  }

  if (targetedRepairMode) {
    parts.push(...await buildGeneratedArtifactContext(workspaceAbsPath));
  }

  // Data sources — extract slide queries for RAPTOR retrieval
  const slideQueries = workspace.slides.length > 0
    ? workspace.slides.map(s => `${s.title} ${s.keyMessage}`.trim()).filter(q => q.length > 0)
    : undefined;

  if (!targetedRepairMode && workspace.dataSources.length > 0) {
    parts.push('## Available File Data Sources\n');
    for (const ds of workspace.dataSources) {
      parts.push(...await formatFileSource(ds, slideQueries));
    }
    parts.push('');
  }

  if (!targetedRepairMode && workspace.urlSources.length > 0) {
    parts.push('## Available URL Sources\n');
    for (const entry of workspace.urlSources) {
      parts.push(...await formatUrlSource(entry, slideQueries));
    }
    parts.push('');
  }

  if (workspace.theme) {
    parts.push('## Active Theme Palette\n');
    parts.push(`Theme name: ${workspace.theme.name}`);
    parts.push(`Font family: ${workspace.theme.fontFamily || 'Calibri'} (this is the ONLY font for the deck. Set run.font.name = PPTX_FONT_FAMILY on every text run. PowerPoint handles glyph substitution for non-Latin scripts automatically. Do NOT introduce any other font families in generated code.)`);
    const colorTreatmentHint = workspace.theme.colorTreatment === 'gradient'
      ? 'Use visible gradient fills on major text-bearing panels, ribbons, or hero/background surfaces. Do not leave the deck effectively solid.'
      : workspace.theme.colorTreatment === 'solid'
        ? 'Use solid fills for text-bearing panels and cards. Do not apply decorative gradients to core reading surfaces.'
        : 'Adaptive: prefer gradient fills on hero, title, and large visual surfaces for dramatic effect; prefer solid fills on dense reading surfaces, data cards, and small panels for clarity. Decide per-slide based on the panel role.';
    parts.push(`Color treatment: ${workspace.theme.colorTreatment || 'mixed'} (${colorTreatmentHint})`);
    const textBoxStyleHint = workspace.theme.textBoxStyle === 'with-icons'
      ? 'Text panels and cards should visibly pair text with readable side icons, icon chips, or icon badges when space allows. Choose the icon from each text box or card heading/body meaning; do not reuse one slide-level icon across every box. Avoid tiny decorative icons that read as visual noise.'
      : workspace.theme.textBoxStyle === 'plain'
        ? 'Keep text panels plain and text-led. Avoid decorative icon chips embedded inside text boxes unless the slide explicitly needs one.'
        : 'Adaptive: use icon companions on cards, callouts, and feature panels where the icon adds semantic anchoring; keep dense prose panels, narrow sidebars, and minimalist reading surfaces plain. Decide per-panel based on whether an icon genuinely aids comprehension.';
    parts.push(`Text box style: ${workspace.theme.textBoxStyle || 'mixed'} (${textBoxStyleHint})`);
    const slots = workspace.theme.slots;
    parts.push(`OOXML slots: dk1=#${slots.dk1}, lt1=#${slots.lt1}, dk2=#${slots.dk2}, lt2=#${slots.lt2}, accent1=#${slots.accent1}, accent2=#${slots.accent2}, accent3=#${slots.accent3}, accent4=#${slots.accent4}, accent5=#${slots.accent5}, accent6=#${slots.accent6}, hlink=#${slots.hlink}, folHlink=#${slots.folHlink}`);
    parts.push(`Semantic colors: PRIMARY=#${workspace.theme.C.PRIMARY}, SECONDARY=#${workspace.theme.C.SECONDARY}, BG=#${workspace.theme.C.BG}, TEXT=#${workspace.theme.C.TEXT}, ACCENT3=#${workspace.theme.C.ACCENT3}, ACCENT4=#${workspace.theme.C.ACCENT4}, ACCENT5=#${workspace.theme.C.ACCENT5}, ACCENT6=#${workspace.theme.C.ACCENT6}`);
    if (workspace.theme.colors.length > 0) {
      parts.push(`Palette colors: ${workspace.theme.colors.slice(0, 20).map((color) => `${color.name} ${color.hex}`).join(' | ')}`);
    }
    parts.push('CRITICAL: The palette colors above are the ONLY color source for this deck. Use OOXML slot and palette hex values exclusively. Do NOT use any hardcoded hex colors from the design style spec — those are overridden by this palette. Readability is mandatory: when text sits on any colored or image background, ensure adequate contrast. If style conflicts with readability, readability wins.');
    parts.push('CRITICAL: The renderer uses PPTX_THEME for role colors and PPTX_THEME_SLOTS for OOXML slot values. Slide background comes from the selected design style or template background logic. Use BG only as the runtime-provided slide surface color. Do NOT invent blended or averaged hex colors. Only use gradients or tints when the selected style explicitly calls for them on accent or decorative surfaces.');
    parts.push('CRITICAL: These style controls are not advisory only. They affect the deterministic renderer output. PPTX_COLOR_TREATMENT controls fill style (solid, gradient, or mixed). PPTX_TEXT_BOX_STYLE controls icon companions on text panels (plain, with-icons, or mixed). These are applied automatically by the renderer.');
    parts.push('CRITICAL: Horizontally aligned card/stat/process/comparison rows MUST stay within slide bounds. Use the pre-computed spec geometry (spec.cards.card_rect, spec.stats.box_rect, spec.comparison.left/right) without adding offsets that push the last item past the right edge. If content exceeds the available width, reduce copy instead of widening boxes.');
    parts.push('');
  }

  if (effectiveWorkflow) {
    parts.push('## Active Workflow\n');
    parts.push(formatWorkflowForPrompt(effectiveWorkflow));
    const workflowMarkdown = await readWorkflowMarkdown(effectiveWorkflow, 12_000);
    if (workflowMarkdown) {
      parts.push('Workflow instruction file:');
      parts.push('```md');
      parts.push(workflowMarkdown);
      parts.push('```');
    }
    parts.push('');
  }

  if (workspace.slides.length > 0) {
    parts.push('## PPTX Preflight\n');
    parts.push('The layout validator automatically checks overlap, out-of-bounds, and text overflow after generation.');
    if (targetedRepairMode) {
      parts.push('For post-generation fixes, patch only previews/layout-input.json, previews/layout-specs.json, or previews/slide-assets.json with the available repair tool, then rerun the render.');
    } else {
      parts.push('If validation fails with ERROR-level issues, patch the generated preview artifacts with the available app tooling, then rerun the render.');
    }
    parts.push('');
  }

  if (workspace.designStyle && !targetedRepairMode) {
    parts.push('## Selected PPTX Design Style\n');
    parts.push(`Apply the "${workspace.designStyle}" style consistently across the deck.`);
    parts.push('Ensure contrast safety and readability when applying the design style — avoid mid-tone on mid-tone, and add overlay panels behind text over images.');

    // ── StyleConfig field reference ──
    // The LLM must know exactly what fields exist so it reads them
    // programmatically instead of guessing from the markdown spec.
    parts.push([
      '',
      '### PPTX_STYLE_CONFIG — MANDATORY Runtime Object',
      '`PPTX_STYLE_CONFIG` is a pre-populated `StyleConfig` dataclass injected by the runtime.',
      'You MUST read its fields to drive every visual decision. Do NOT hardcode style values.',
      '',
      '#### Field Reference',
      '| Field | Type | Example values |',
      '|-------|------|----------------|',
      '| `title_accent_bar` | bool | Thin vertical bar left of the title |',
      '| `title_accent_rule` | bool | Thin horizontal rule above the title |',
      '| `title_centered` | bool | Center-align title text |',
      '| `title_font_scale` | float | 1.0 / 1.2 / 0.85 |',
      '| `key_message_band` | bool | Semi-transparent band behind key-message |',
      '| `key_message_band_opacity` | float | 0.0–1.0 |',
      '| `panel_fill` | str | "transparent" / "tinted" / "solid" / "frosted" |',
      '| `panel_fill_opacity` | float | 0.0–1.0 |',
      '| `panel_border` | bool | Draw border around panels |',
      '| `panel_border_weight_pt` | float | 0.5 / 1.0 / 2.0 |',
      '| `panel_stripe` | bool | Vertical color stripe on panel left edge |',
      '| `panel_shadow` | str | "none" / "hard" / "accent" |',
      '| `decorative_circle` | bool | Small hollow circle near bottom-right |',
      '| `decorative_blob` | bool | Organic background blob |',
      '| `background_grid` | str | "none" / "fine" / "perspective" |',
      '| `frame_outline` | str | "none" / "single" / "double" |',
      '| `corner_brackets` | bool | Angular corner bracket marks |',
      '| `accent_rings` | bool | Concentric outline rings |',
      '| `color_treatment` | str | "solid" / "gradient" / "mixed" |',
      '| `gradient_angle` | int | 0–180 degrees |',
      '| `bullet_marker` | str | "•" / "—" / "✔" / "▸" |',
      '| `bullet_marker_bold` | bool | Render bullet marker in bold |',
      '| `content_density` | str | "compact" / "normal" / "spacious" |',
      '| `dark_mode` | bool | Swap BG↔TEXT color roles |',
      '| `rainbow_stripe_bars` | bool | Full-spectrum rainbow bars at top and bottom |',
      '| `sparkle_stars` | bool | Small star/sparkle motifs in corners |',
      '| `scan_lines` | bool | Thin horizontal scan-line overlay |',
      '',
      '#### Required Usage Pattern',
      'At the start of your generated code, read the config into local variables:',
      '```python',
      'SC = PPTX_STYLE_CONFIG  # pre-injected StyleConfig instance',
      '# Then use SC.field_name throughout:',
      '# SC.panel_fill, SC.panel_border, SC.title_accent_bar, etc.',
      '```',
      '',
      'Concrete examples:',
      '```python',
      '# Panel fill driven by style config',
      'if SC.panel_fill == "tinted":',
      '    shape.fill.solid()',
      '    shape.fill.fore_color.rgb = RGBColor.from_string(C["ACCENT1"])',
      '    set_fill_transparency(shape, 1 - SC.panel_fill_opacity)',
      'elif SC.panel_fill == "frosted":',
      '    shape.fill.solid()',
      '    shape.fill.fore_color.rgb = RGBColor.from_string(C["WHITE"])',
      '    set_fill_transparency(shape, 1 - SC.panel_fill_opacity)',
      'elif SC.panel_fill == "solid":',
      '    shape.fill.solid()',
      '    shape.fill.fore_color.rgb = RGBColor.from_string(C["LIGHT2"])',
      'else:  # transparent',
      '    shape.fill.background()',
      '',
      '# Border driven by style config',
      'if SC.panel_border:',
      '    shape.line.width = Pt(SC.panel_border_weight_pt)',
      '    shape.line.color.rgb = RGBColor.from_string(C["BORDER"])',
      '',
      '# Title accent bar',
      'if SC.title_accent_bar:',
      '    bar = add_design_shape(slide.shapes, MSO_SHAPE.RECTANGLE,',
      '        left, top, Inches(0.06), title_h)',
      '    bar.fill.solid()',
      '    bar.fill.fore_color.rgb = RGBColor.from_string(C["ACCENT1"])',
      '',
      '# Gradient fill',
      'if SC.color_treatment == "gradient":',
      '    apply_gradient_fill(shape, [(C["ACCENT1"], 0), (C["ACCENT2"], 100)], SC.gradient_angle)',
      '',
      '# Decorative circle',
      'if SC.decorative_circle:',
      '    circ = add_design_shape(slide.shapes, MSO_SHAPE.OVAL,',
      '        Inches(9.0), Inches(6.0), Inches(0.5), Inches(0.5))',
      '    circ.fill.background()',
      '    circ.line.width = Pt(1.5)',
      '    circ.line.color.rgb = RGBColor.from_string(C["ACCENT1"])',
      '```',
      '',
      'CRITICAL: Every panel, card, title decoration, bullet character, and decorative',
      'element MUST be driven by reading `PPTX_STYLE_CONFIG` fields — NOT by guessing',
      'from the style name or hardcoding values. This is how different style selections',
      'produce visually distinct slides.',
    ].join('\n'));

     const styleBlock = await readDesignStyleBlock(workspace.designStyle);
    if (styleBlock) {
      // When a palette is active, strip hardcoded hex colors from the style spec
      // so the LLM uses only palette colors for the design style's layout/composition.
      const hasActivePalette = workspace.theme && workspace.theme.colors.length > 0;
      const spec = hasActivePalette
        ? styleBlock.replace(/#[0-9A-Fa-f]{6}/g, '(use palette)').replace(/@ \d+[–-]\d+% opacity/g, '@ low opacity')
        : styleBlock;
      parts.push('### Style Spec (Layout & Composition Reference)\n');
      parts.push('Use the layout and composition guidance below for slide arrangement and signature elements.');
      parts.push('All concrete visual parameters (fills, borders, decorations) come from `PPTX_STYLE_CONFIG` — do NOT extract numeric values from this spec.');
      if (hasActivePalette) {
        parts.push('NOTE: A custom palette is active. Use ONLY the palette/theme colors from the Active Theme Palette section above. The hex values below have been replaced — apply only the layout, composition, and signature element rules from this style spec.');
      }
      parts.push(spec);
    } else {
      parts.push('If the pptx-design-styles skill is available, use it for style details.');
    }

    // ── Inject CSS+HTML visual reference for this style ──
    // This gives the LLM the exact visual implementation (gradients, shadows,
    // shapes, colors) to translate into python-pptx equivalents.
    const styleHtml = await readDesignStyleHtml(workspace.designStyle);
    if (styleHtml) {
      parts.push('### Visual Reference (CSS + HTML)\n');
      parts.push('Below is the CSS and HTML that renders this style as a preview card.');
      parts.push('Translate these visual effects (gradients, shadows, shapes, colors, stripes, decorations) into python-pptx equivalents.');
      parts.push('Map CSS `background`, `linear-gradient`, `box-shadow`, `text-shadow`, `border` to python-pptx fills, gradient stops, shape shadows, and line properties.');
      parts.push('Use theme palette colors (C dict) instead of the hardcoded hex values in the CSS.\n');
      parts.push(styleHtml);
    }
    parts.push('');
  }

  {
    const collection = getIconifyCollectionById(workspace.iconCollection);
    const collectionId = collection.id as IconifyCollectionId;
    parts.push('## Icon Constraints\n');
    parts.push(`Icon provider: ${workspace.iconProvider}`);
    parts.push(`Selected icon set: ${collection.label} (\`${collectionId}\`)\n`);
    if (targetedRepairMode) {
      parts.push('Preserve the selected collection when repairing slide-assets.json. Do not switch collections during post-generation QA.');
      parts.push('');
    } else {
      parts.push('**Pick icons ONLY from the catalog below.** Do not invent icon names or use IDs from other collections.');
      parts.push('Each icon must be a full Iconify ID with the collection prefix (e.g., `fluent:database-24-regular`).');
      parts.push('If no icon in the catalog fits a slide, omit the icon field.\n');
      const catalogText = formatCatalogForPrompt(collectionId);
      if (catalogText) {
        parts.push('### Icon Catalog\n');
        parts.push(catalogText);
      }
    }
    parts.push('');
  }

  parts.push(`## User Message\n${message}`);
  return parts.join('\n');
}

function sendToWindow(win: BrowserWindow, channel: string, ...args: unknown[]): void {
  if (win.isDestroyed() || win.webContents.isDestroyed()) return;
  win.webContents.send(channel, ...args);
}

// ---------------------------------------------------------------------------
// IPC handler registration
// ---------------------------------------------------------------------------

export function registerChatHandlers(getWindow: () => BrowserWindow | null): void {
  // Register all LLM providers
  registerProvider('copilot', copilotProvider);
  registerProvider('openai', openaiProvider);
  registerProvider('azure-openai', azureOpenAIProvider);
  registerProvider('claude', claudeProvider);

  // Reset all provider clients whenever the user saves new settings
  onSettingsSaved(() => { resetAllProviders(); });

  ipcMain.on('chat:cancel', () => {
    activeChatRequest?.cancel('Generation cancelled.');
  });

  ipcMain.on('chat:send', (_event, payload: {
    message: string;
    history: Array<{ role: 'user' | 'assistant'; content: string }>;
    workspace: WorkspaceContext;
  }) => {
    void (async () => {
      const win = getWindow();
      if (!win) return;

      if (activeChatRequest) {
        sendToWindow(win, 'chat:error', 'Another generation is already in progress. Cancel it before starting a new one.');
        return;
      }

      const { message, history, workspace } = payload;

      // Validate
      if (!message || typeof message !== 'string' || message.trim().length === 0) {
        sendToWindow(win, 'chat:error', 'Message must not be empty');
        return;
      }

      const workflow = await resolveWorkflow(message, workspace);
      const mode = resolveSessionMode(message, workspace, workflow);
      const prompt = await buildPrompt(message, history, workspace, mode, workflow);

      // Pre-compute content-adaptive layout specs for PPTX generation workflows.
      // Uses Pillow text measurement + kiwisolver constraint solver to produce
      // content-aware coordinates injected into the Python runner env.
      let layoutSpecsJson: string | undefined;
      let slideAssetsJson: string | undefined;
      let layoutSpecsPromise: Promise<void> | null = null;
      let slideAssetsPromise: Promise<void> | null = null;
      if (mode === 'pptx' && workspace.slides.length > 0 && !isTargetedPptxRepair(workflow)) {
        layoutSpecsPromise = computeLayoutSpecs(workspace.slides, workspace.theme?.fontFamily)
          .then((result) => {
            if (result.success && result.specs) layoutSpecsJson = result.specs;
          })
          .catch((err) => {
            console.log('[chat] Layout spec pre-computation failed (non-blocking):', err);
          });
        slideAssetsPromise = persistSlideAssetsToWorkspace(workspace.slides, workspace.iconCollection)
          .then((result) => {
            if (result.success && result.slideAssetsJson) {
              slideAssetsJson = result.slideAssetsJson;
            } else {
              console.log('[chat] Slide asset persistence failed (non-blocking):', result.error);
            }
          })
          .catch((err) => {
            console.log('[chat] Slide asset persistence failed (non-blocking):', err);
          });
      }

      let session: LLMSession | null = null;
      let requestSettled = false;
      let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
      let lastActivityTime = Date.now();

      const clearRequestTimeout = () => {
        if (!timeoutHandle) return;
        clearTimeout(timeoutHandle);
        timeoutHandle = null;
      };

      /** Reset inactivity timer — call whenever the LLM streams or a tool executes */
      const resetInactivityTimeout = () => {
        lastActivityTime = Date.now();
      };

      const completeRequest = () => {
        if (requestSettled) return;
        requestSettled = true;
        sendToWindow(win, 'chat:done');
      };

      const failRequest = (messageText: string) => {
        if (requestSettled) return;
        requestSettled = true;
        sendToWindow(win, 'chat:error', messageText);
      };

      activeChatRequest = {
        cancel: (reason = 'Generation cancelled.') => {
          if (requestSettled) return;
          clearRequestTimeout();
          activeChatRequest = null;
          failRequest(reason);
          if (session) {
            void session.disconnect().catch(() => { });
          }
        },
      };

      const previewToolValue = (value: unknown, maxLen = 260): string | undefined => {
        if (value === undefined) return undefined;
        try {
          const serialized = typeof value === 'string' ? value : JSON.stringify(value);
          return truncateText(serialized, maxLen);
        } catch {
          return truncateText(String(value), maxLen);
        }
      };

      const emitToolEvent = (event: ChatToolEvent): void => {
        sendToWindow(win, 'chat:tool', event);
      };

      const withToolLogging = (tool: LLMToolDefinition): LLMToolDefinition => ({
        ...tool,
        handler: async (args: any) => {
          const eventId = `${tool.name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          const startedAt = Date.now();
          resetInactivityTimeout();
          emitToolEvent({
            id: eventId,
            toolName: tool.name,
            status: 'running',
            argsPreview: previewToolValue(args),
            startedAt,
          });
          try {
            const result = await tool.handler(args);
            resetInactivityTimeout();
            emitToolEvent({
              id: eventId,
              toolName: tool.name,
              status: result.success ? 'success' : 'error',
              argsPreview: previewToolValue(args),
              resultPreview: previewToolValue(result.success ? (result.message ?? result.content ?? result) : (result.error ?? result)),
              startedAt,
              finishedAt: Date.now(),
              durationMs: Date.now() - startedAt,
            });
            return result;
          } catch (err) {
            resetInactivityTimeout();
            emitToolEvent({
              id: eventId,
              toolName: tool.name,
              status: 'error',
              argsPreview: previewToolValue(args),
              resultPreview: previewToolValue(formatExecutionFailure(err)),
              startedAt,
              finishedAt: Date.now(),
              durationMs: Date.now() - startedAt,
            });
            throw err;
          }
        },
      });

      // Tool definitions (provider-neutral — close over win for IPC emission)
      const scenarioTool: LLMToolDefinition = {
        name: 'set_scenario',
        description:
          'Set the slide scenario (outline) for the presentation workspace panel. ' +
          'Each slide must have a keyMessage (the "so what" / key takeaway), a layout hint, and optionally an icon hint. ' +
          'For data-driven slides, you may include analysisMeta to describe chart type, caption, source, unit, aggregation, confidence, or a short analysis summary. ' +
          'You may also include imageQuery when supporting images should later be searched for and selected on the slide. ' +
          'Available layouts: title, agenda, section, bullets, cards, stats, comparison, timeline, diagram, summary, chart, table. ' +
          'For chart layout, encode data as pipe-delimited bullets. Preferred format: first bullet is the category header row (for example "Metric | Q1 | Q2 | Q3"), following bullets are named series rows (for example "Revenue | 12 | 18 | 21"). ' +
          'Prefer analysisMeta.chartType for chart selection, but you may also add a metadata bullet like "chart:type=bar", "chart:type=line", "chart:type=column", "chart:type=pie", or "chart:type=doughnut" before the data rows for backward compatibility. ' +
          'For table layout, encode rows as pipe-delimited bullets: first bullet is the header row (e.g. "Region | Q1 | Q2 | Q3"), subsequent bullets are data rows. ' +
          'The layout and icon are guidance for the later PPTX design step, not a rigid rendering contract. ' +
          'When helpful, include a designBrief describing tone, audience, visual style, density, and layout approach. ' +
          `Use full Iconify icon IDs for icons and stay within the selected collection (${workspace.iconCollection}). Never emit bare icon names without the collection prefix. Prefer slide-specific icon hints over invented names.`,
        parameters: {
          type: 'object' as const,
          properties: {
            title: { type: 'string', description: 'Presentation title' },
            slides: {
              type: 'array',
              description: 'Array of slide definitions',
              items: {
                type: 'object',
                properties: {
                  number: { type: 'number' },
                  title: { type: 'string' },
                  keyMessage: { type: 'string' },
                  layout: { type: 'string' },
                  bullets: { type: 'array', items: { type: 'string' } },
                  notes: { type: 'string' },
                  analysisMeta: {
                    type: 'object',
                    properties: {
                      chartType: { type: 'string' },
                      caption: { type: 'string' },
                      source: { type: 'string' },
                      unit: { type: 'string' },
                      aggregation: { type: 'string' },
                      confidence: { type: 'string' },
                      analysisSummary: { type: 'string' },
                    },
                  },
                  icon: { type: 'string' },
                  imageQuery: { type: 'string' },
                },
                required: ['number', 'title', 'keyMessage', 'layout', 'bullets', 'notes'],
              },
            },
            designBrief: {
              type: 'object',
              properties: {
                objective: { type: 'string' },
                audience: { type: 'string' },
                tone: { type: 'string' },
                visualStyle: { type: 'string' },
                colorMood: { type: 'string' },
                density: { type: 'string' },
                layoutApproach: { type: 'string' },
                directions: { type: 'array', items: { type: 'string' } },
              },
              required: ['objective', 'audience', 'tone', 'visualStyle', 'colorMood', 'density', 'layoutApproach', 'directions'],
            },
            framework: { type: 'string' },
          },
          required: ['title', 'slides'],
        },
        handler: async (args: ScenarioPayload) => {
          win.webContents.send('chat:scenario', args);
          computeLayoutSpecs(args.slides, workspace.theme?.fontFamily).catch((err) => {
            console.log('[chat] Failed to compute layout specs for storyboard (non-blocking):', err);
          });
          return { success: true, message: `Scenario "${args.title}" set with ${args.slides.length} slides.` };
        },
      };

      const updateSlideTool: LLMToolDefinition = {
        name: 'update_slide',
        description: 'Update a single slide in the existing scenario. Use when the user asks to change a specific slide. You may also update imageQuery to change the image search keywords used for that slide.',
        parameters: {
          type: 'object' as const,
          properties: {
            number: { type: 'number' },
            title: { type: 'string' },
            keyMessage: { type: 'string' },
            layout: { type: 'string' },
            bullets: { type: 'array', items: { type: 'string' } },
            notes: { type: 'string' },
            analysisMeta: {
              type: 'object',
              properties: {
                chartType: { type: 'string' },
                caption: { type: 'string' },
                source: { type: 'string' },
                unit: { type: 'string' },
                aggregation: { type: 'string' },
                confidence: { type: 'string' },
                analysisSummary: { type: 'string' },
              },
            },
            icon: { type: 'string' },
            imageQuery: { type: 'string' },
          },
          required: ['number', 'title', 'keyMessage', 'layout', 'bullets', 'notes'],
        },
        handler: async (args: SlideUpdatePayload) => {
          win.webContents.send('chat:slide-update', args);
          return { success: true, message: `Slide ${args.number} updated.` };
        },
      };

      // ---------- PPTX layout infrastructure tools ----------

      const artifactRepairDirty = new Set<string>();

      /** Resolve a previews/*.json path safely (whitelist only). */
      const resolveInfraFile = async (file: string): Promise<string | null> => {
        const allowed: Record<string, string> = {
          layout_input: 'layout-input.json',
          layout_specs: 'layout-specs.json',
          slide_assets: 'slide-assets.json',
          render_config: 'render-config.json',
        };
        const basename = allowed[file];
        if (!basename) return null;
        const workspaceDir = await readWorkspaceDir();
        return path.join(workspaceDir, 'previews', basename);
      };

      const patchLayoutInfrastructureTool: LLMToolDefinition = {
        name: 'patch_layout_infrastructure',
        description:
          'Read or patch the generated preview artifact files. ' +
          'Targets: layout_input (slide content), layout_specs (geometry), slide_assets (icons/images), render_config (theme, font, style, colors). ' +
          'Use render_config to change design style, font family, color treatment, panel fill behavior, text box style, or slide icons. ' +
          'Action "read" returns the full file content so you can understand current values. ' +
          'Action "patch" performs a search-and-replace edit on the file. ' +
          'After patching, call rerun_pptx to re-render the deck with the updated settings.',
        parameters: {
          type: 'object' as const,
          properties: {
            action: {
              type: 'string',
              description: 'Either "read" to view the file, or "patch" to search-and-replace.',
              enum: ['read', 'patch'],
            },
            file: {
              type: 'string',
              description: 'Target file: "layout_input", "layout_specs", "slide_assets", or "render_config".',
              enum: ['layout_input', 'layout_specs', 'slide_assets', 'render_config'],
            },
            search: {
              type: 'string',
              description: 'The exact string to find in the file (required for action="patch").',
            },
            replace: {
              type: 'string',
              description: 'The replacement string (required for action="patch").',
            },
          },
          required: ['action', 'file'],
        },
        handler: async (args: { action: string; file: string; search?: string; replace?: string }) => {
          const filePath = await resolveInfraFile(args.file);
          if (!filePath) {
            return { success: false, error: `Unknown file "${args.file}". Allowed: layout_input, layout_specs, slide_assets, render_config.` };
          }
          if (!fsExistsSync(filePath)) {
            return { success: false, error: `File not found: ${filePath}` };
          }

          if (args.action === 'read') {
            const content = await fs.readFile(filePath, 'utf-8');
            return { success: true, content };
          }

          if (args.action === 'patch') {
            if (!args.search || args.replace === undefined) {
              return { success: false, error: '"search" and "replace" are required for action="patch".' };
            }
            const content = await fs.readFile(filePath, 'utf-8');
            if (!content.includes(args.search)) {
              return { success: false, error: 'Search string not found in file. Use action="read" first to inspect the current content.' };
            }
            const occurrences = content.split(args.search).length - 1;
            if (occurrences > 1) {
              return { success: false, error: `Search string matches ${occurrences} locations. Provide a more specific search string.` };
            }
            const updated = content.replace(args.search, args.replace);
            try {
              JSON.parse(updated);
            } catch (err) {
              return { success: false, error: `Patched content is not valid JSON: ${formatExecutionFailure(err)}` };
            }
            await fs.writeFile(filePath, updated, 'utf-8');
            artifactRepairDirty.add(args.file);
            return { success: true, message: `Patched ${args.file}: replaced 1 occurrence.` };
          }

          return { success: false, error: `Unknown action "${args.action}". Use "read" or "patch".` };
        },
      };

      const runPptxRerender = async (): Promise<{
        success: boolean;
        message?: string;
        slideCount?: number;
        warnings?: string[];
        error?: string;
      }> => {
        try {
          // Wait for background layout spec computation if still in-flight
          if (layoutSpecsPromise) await layoutSpecsPromise;
          if (slideAssetsPromise) await slideAssetsPromise;

          const workspaceDir = await readWorkspaceDir();
          const previewRoot = path.join(workspaceDir, 'previews');
          const outputPath = path.join(previewRoot, 'presentation-preview.pptx');
          const layoutInputPath = path.join(previewRoot, 'layout-input.json');
          const layoutSpecsPath = path.join(previewRoot, 'layout-specs.json');
          const renderConfigPath = path.join(previewRoot, 'render-config.json');

          // Load render config overrides when the agent patched render-config.json
          let renderConfigOverrides: RenderConfig | undefined;
          if (artifactRepairDirty.has('render_config') && fsExistsSync(renderConfigPath)) {
            try {
              renderConfigOverrides = JSON.parse(await fs.readFile(renderConfigPath, 'utf-8')) as RenderConfig;
            } catch {
              // fall through to workspace defaults
            }
          }

          const theme = workspace.theme;
          const title = renderConfigOverrides?.title ?? workspace.title ?? 'Presentation';
          const fontFamily = renderConfigOverrides?.fontFamily ?? theme?.fontFamily ?? undefined;

          let rerunLayoutSpecsJson = '';
          if (artifactRepairDirty.has('layout_specs') && fsExistsSync(layoutSpecsPath)) {
            rerunLayoutSpecsJson = (await fs.readFile(layoutSpecsPath, 'utf-8')).trim();
          } else if (artifactRepairDirty.has('layout_input') && fsExistsSync(layoutInputPath)) {
            const layoutInputJson = await fs.readFile(layoutInputPath, 'utf-8');
            const computed = await computeLayoutSpecs(layoutInputJson, fontFamily);
            if (!computed.success || !computed.specs?.trim()) {
              return { success: false, error: computed.error ?? 'Failed to recompute layout specs from layout-input.json.' };
            }
            rerunLayoutSpecsJson = computed.specs.trim();
          } else if (fsExistsSync(layoutSpecsPath)) {
            rerunLayoutSpecsJson = (await fs.readFile(layoutSpecsPath, 'utf-8')).trim();
          }

          // Remove old output so we get fresh validation
          await fs.unlink(outputPath).catch(() => { });

          const report = await renderPresentationToFile(theme, title, outputPath, {
            iconCollection: renderConfigOverrides?.iconCollection ?? workspace.iconCollection,
            layoutSpecsJson: rerunLayoutSpecsJson || undefined,
            designStyle: renderConfigOverrides?.designStyle ?? workspace.designStyle ?? undefined,
            customBackgroundColor: renderConfigOverrides?.customBackgroundColor ?? workspace.customBackgroundColor,
            renderConfigOverrides,
          });
          artifactRepairDirty.clear();

          return {
            success: true,
            message: `PPTX re-generated successfully (${report.slideCount} slides). Click Rerender in the preview pane to refresh the slide images.`,
            slideCount: report.slideCount,
            warnings: report.warnings,
          };
        } catch (err) {
          return { success: false, error: formatExecutionFailure(err) };
        }
      };

      const rerunPptxTool: LLMToolDefinition = {
        name: 'rerun_pptx',
        description:
          'Re-render the PPTX presentation using the deterministic renderer after patching generated preview artifacts. ' +
          'Use this after calling patch_layout_infrastructure to apply the changes.',
        parameters: {
          type: 'object' as const,
          properties: {},
          required: [],
        },
        handler: runPptxRerender,
      };

      /** Navigate a dot-separated property path on an object. */
      const getNestedValue = (obj: Record<string, unknown>, dotPath: string): unknown => {
        let cur: unknown = obj;
        for (const key of dotPath.split('.')) {
          if (cur == null || typeof cur !== 'object') return undefined;
          cur = (cur as Record<string, unknown>)[key];
        }
        return cur;
      };

      /** Set a value at a dot-separated property path. Creates intermediate objects if needed. */
      const setNestedValue = (obj: Record<string, unknown>, dotPath: string, value: unknown): boolean => {
        const parts = dotPath.split('.');
        let cur: Record<string, unknown> = obj;
        for (let i = 0; i < parts.length - 1; i++) {
          const next = cur[parts[i]];
          if (next == null || typeof next !== 'object') {
            const child: Record<string, unknown> = {};
            cur[parts[i]] = child;
            cur = child;
          } else {
            cur = next as Record<string, unknown>;
          }
        }
        cur[parts[parts.length - 1]] = value;
        return true;
      };

      const tweakSlideTool: LLMToolDefinition = {
        name: 'tweak_slide',
        description:
          'Read or modify a specific object/zone on a specific slide. Always call with action="read" first to see current state before patching. ' +
          'Action "read": returns all properties for the given slide from layout-input (content + shape_overrides), layout-specs (geometry), and slide-assets (icons/images). ' +
          'Action "patch": updates a single property on a specific slide. Use dot notation for nested properties (e.g. "title_rect.x", "title_rect.h"). ' +
          'Action "set_text": updates title_text, key_message_text, notes, footer_text, bullets[index], or chip_labels[index]. ' +
          'Action "set_array_item": updates one item inside bullets, chip_labels, imageQueries, or selectedImages by index. ' +
          'Action "set_zone_geometry": updates x/y/w/h for one layout-spec rect such as title_rect, key_message_rect, content_rect, chips_rect, hero_rect, icon_rect, footer_rect, summary_box, sidebar_rect, or nested zones like comparison.left. ' +
          'Action "set_icon": updates the slide icon metadata in slide-assets. ' +
          'Action "set_image": updates the primary image path and selectedImages[0] in slide-assets. ' +
          'Action "set_override": add or update a per-shape color override on a slide. The renderer applies these overrides to named shapes. ' +
          'Action "remove_override": removes a per-shape color override and restores default renderer styling for that shape. ' +
          'Shape names: chip_0, chip_1, chip_2 (chip panels), card_0..card_N (card panels), stat_0..stat_N (stat boxes), title_panel, content_panel, key_message_panel. ' +
          'Override properties: fill_color (6-digit hex without #, e.g. "ED7D31"), border_color (6-digit hex). ' +
          'After any write action, call rerun_pptx to re-render the deck. ' +
          'Examples: ' +
          'change chip color → set_override shape_name="chip_0" fill_color="ED7D31"; ' +
          'remove chip override → remove_override shape_name="chip_0"; ' +
          'change slide title → set_text field="title_text" text="New title"; ' +
          'change first bullet → set_text field="bullets" index=0 text="New bullet"; ' +
          'swap icon → set_icon icon="lucide:database"; ' +
          'swap image → set_image image_path="D:/.../hero.png"; ' +
          'move title down → patch layout_specs title_rect.y; ' +
          'enlarge content → set_zone_geometry zone="content_rect" h=1.8; ' +
          'change bullet text → set_text field="bullets" index=0 text="Updated bullet".',
        parameters: {
          type: 'object' as const,
          properties: {
            action: {
              type: 'string',
              description: 'Structured slide repair action.',
              enum: ['read', 'patch', 'set_text', 'set_array_item', 'set_zone_geometry', 'set_icon', 'set_image', 'set_override', 'remove_override'],
            },
            slide_index: {
              type: 'number',
              description: '0-based slide index.',
            },
            file: {
              type: 'string',
              description: 'Target artifact file (required for "patch"). "layout_input" for content, "layout_specs" for geometry, "slide_assets" for icons/images.',
              enum: ['layout_input', 'layout_specs', 'slide_assets'],
            },
            property: {
              type: 'string',
              description: 'Dot-separated property path within the slide entry, e.g. "title_rect.h", "bullets", "icon". Required for "patch".',
            },
            value: {
              description: 'New value to set (string, number, boolean, array, object, or null). Required for "patch".',
            },
            field: {
              type: 'string',
              description: 'Field for "set_text": title_text, key_message_text, notes, footer_text, bullets, or chip_labels.',
            },
            text: {
              type: 'string',
              description: 'Text value for "set_text".',
            },
            index: {
              type: 'number',
              description: '0-based index for bullets/chip_labels or for "set_array_item".',
            },
            array_field: {
              type: 'string',
              description: 'Array field for "set_array_item", e.g. bullets, chip_labels, imageQueries, selectedImages.',
            },
            zone: {
              type: 'string',
              description: 'Layout spec zone for "set_zone_geometry", e.g. title_rect, content_rect, comparison.left.',
            },
            x: {
              type: 'number',
              description: 'New x position for "set_zone_geometry".',
            },
            y: {
              type: 'number',
              description: 'New y position for "set_zone_geometry".',
            },
            w: {
              type: 'number',
              description: 'New width for "set_zone_geometry".',
            },
            h: {
              type: 'number',
              description: 'New height for "set_zone_geometry".',
            },
            icon: {
              type: 'string',
              description: 'Full icon ID for "set_icon", e.g. "lucide:database".',
            },
            image_path: {
              type: 'string',
              description: 'Absolute or workspace-resolved image path for "set_image".',
            },
            shape_name: {
              type: 'string',
              description: 'Shape name for "set_override" or "remove_override", e.g. "chip_0", "card_1", "title_panel".',
            },
            fill_color: {
              type: 'string',
              description: '6-digit hex color for shape fill (no # prefix), e.g. "ED7D31". Used with "set_override".',
            },
            border_color: {
              type: 'string',
              description: '6-digit hex color for shape border (no # prefix). Used with "set_override".',
            },
          },
          required: ['action', 'slide_index'],
        },
        handler: async (args: {
          action: string;
          slide_index: number;
          file?: string;
          property?: string;
          value?: unknown;
          field?: string;
          text?: string;
          index?: number;
          array_field?: string;
          zone?: string;
          x?: number;
          y?: number;
          w?: number;
          h?: number;
          icon?: string;
          image_path?: string;
          shape_name?: string;
          fill_color?: string;
          border_color?: string;
        }) => {
          const workspaceDir = await readWorkspaceDir();
          const previewRoot = path.join(workspaceDir, 'previews');
          const fileMap: Record<string, string> = {
            layout_input: path.join(previewRoot, 'layout-input.json'),
            layout_specs: path.join(previewRoot, 'layout-specs.json'),
            slide_assets: path.join(previewRoot, 'slide-assets.json'),
          };

          const readJsonArray = async (filePath: string): Promise<unknown[] | null> => {
            if (!fsExistsSync(filePath)) return null;
            try {
              const parsed = JSON.parse(await fs.readFile(filePath, 'utf-8'));
              return Array.isArray(parsed) ? parsed : null;
            } catch {
              return null;
            }
          };

          const writeJsonArray = async (filePath: string, arr: unknown[]): Promise<{ success: boolean; error?: string }> => {
            const updated = JSON.stringify(arr, null, 2);
            try {
              JSON.parse(updated);
            } catch (err) {
              return { success: false, error: `Resulting JSON is invalid: ${formatExecutionFailure(err)}` };
            }
            await fs.writeFile(filePath, updated, 'utf-8');
            return { success: true };
          };

          const validateSlideIndex = (arr: unknown[]): string | null => {
            if (args.slide_index < 0 || args.slide_index >= arr.length) {
              return `slide_index ${args.slide_index} out of range (0..${arr.length - 1}).`;
            }
            return null;
          };

          const getSlideEntry = async (fileKey: keyof typeof fileMap): Promise<{ arr?: unknown[]; slide?: Record<string, unknown>; error?: string }> => {
            const filePath = fileMap[fileKey];
            const arr = await readJsonArray(filePath);
            if (!arr) {
              return { error: `File not found or not a JSON array: ${filePath}` };
            }
            const idxErr = validateSlideIndex(arr);
            if (idxErr) return { error: idxErr };
            return { arr, slide: arr[args.slide_index] as Record<string, unknown> };
          };

          const persist = async (fileKey: keyof typeof fileMap, arr: unknown[]) => {
            const result = await writeJsonArray(fileMap[fileKey], arr);
            if (!result.success) return result;
            artifactRepairDirty.add(fileKey);
            return { success: true };
          };

          if (args.action === 'read') {
            const result: Record<string, unknown> = { slide_index: args.slide_index };
            for (const [key, filePath] of Object.entries(fileMap)) {
              const arr = await readJsonArray(filePath);
              if (!arr) { result[key] = null; continue; }
              const err = validateSlideIndex(arr);
              if (err) { result[key] = err; } else { result[key] = arr[args.slide_index]; }
            }
            return { success: true, slide: result };
          }

          if (args.action === 'set_text') {
            if (!args.field || args.text === undefined) {
              return { success: false, error: '"field" and "text" are required for action="set_text".' };
            }
            const validScalarFields = new Set(['title_text', 'key_message_text', 'notes', 'footer_text']);
            const validArrayFields = new Set(['bullets', 'chip_labels']);
            const result = await getSlideEntry('layout_input');
            if (result.error || !result.arr || !result.slide) return { success: false, error: result.error };

            if (validScalarFields.has(args.field)) {
              const oldValue = result.slide[args.field];
              result.slide[args.field] = args.text;
              const writeResult = await persist('layout_input', result.arr);
              if (!writeResult.success) return writeResult;
              return {
                success: true,
                message: `Slide ${args.slide_index}: ${args.field} updated.`,
                old_value: oldValue ?? null,
                new_value: args.text,
              };
            }

            if (validArrayFields.has(args.field)) {
              if (!Number.isInteger(args.index)) {
                return { success: false, error: '"index" is required for array text fields like bullets or chip_labels.' };
              }
              const arrValue = result.slide[args.field];
              if (!Array.isArray(arrValue)) {
                return { success: false, error: `Field "${args.field}" is not an array on this slide.` };
              }
              if ((args.index as number) < 0 || (args.index as number) >= arrValue.length) {
                return { success: false, error: `index ${args.index} out of range for ${args.field} (0..${arrValue.length - 1}).` };
              }
              const oldValue = arrValue[args.index as number];
              arrValue[args.index as number] = args.text;
              const writeResult = await persist('layout_input', result.arr);
              if (!writeResult.success) return writeResult;
              return {
                success: true,
                message: `Slide ${args.slide_index}: ${args.field}[${args.index}] updated.`,
                old_value: oldValue ?? null,
                new_value: args.text,
              };
            }

            return { success: false, error: `Unsupported field "${args.field}" for set_text.` };
          }

          if (args.action === 'set_array_item') {
            if (!args.array_field || !Number.isInteger(args.index) || args.value === undefined) {
              return { success: false, error: '"array_field", "index", and "value" are required for action="set_array_item".' };
            }
            const result = await getSlideEntry('layout_input');
            if (result.error || !result.arr || !result.slide) return { success: false, error: result.error };
            const arrValue = result.slide[args.array_field];
            if (!Array.isArray(arrValue)) {
              return { success: false, error: `Field "${args.array_field}" is not an array on this slide.` };
            }
            if ((args.index as number) < 0 || (args.index as number) >= arrValue.length) {
              return { success: false, error: `index ${args.index} out of range for ${args.array_field} (0..${arrValue.length - 1}).` };
            }
            const oldValue = arrValue[args.index as number];
            arrValue[args.index as number] = args.value;
            const writeResult = await persist('layout_input', result.arr);
            if (!writeResult.success) return writeResult;
            return {
              success: true,
              message: `Slide ${args.slide_index}: ${args.array_field}[${args.index}] updated.`,
              old_value: oldValue ?? null,
              new_value: args.value,
            };
          }

          if (args.action === 'set_zone_geometry') {
            if (!args.zone) {
              return { success: false, error: '"zone" is required for action="set_zone_geometry".' };
            }
            if ([args.x, args.y, args.w, args.h].every((value) => value === undefined)) {
              return { success: false, error: 'At least one of "x", "y", "w", or "h" is required for action="set_zone_geometry".' };
            }
            const result = await getSlideEntry('layout_specs');
            if (result.error || !result.arr || !result.slide) return { success: false, error: result.error };
            const zoneValue = getNestedValue(result.slide, args.zone);
            if (!zoneValue || typeof zoneValue !== 'object') {
              return { success: false, error: `Zone "${args.zone}" was not found on this slide.` };
            }
            const zoneRect = zoneValue as Record<string, unknown>;
            const oldValue = { x: zoneRect.x ?? null, y: zoneRect.y ?? null, w: zoneRect.w ?? null, h: zoneRect.h ?? null };
            if (args.x !== undefined) zoneRect.x = args.x;
            if (args.y !== undefined) zoneRect.y = args.y;
            if (args.w !== undefined) zoneRect.w = args.w;
            if (args.h !== undefined) zoneRect.h = args.h;
            const writeResult = await persist('layout_specs', result.arr);
            if (!writeResult.success) return writeResult;
            return {
              success: true,
              message: `Slide ${args.slide_index}: geometry updated for ${args.zone}.`,
              old_value: oldValue,
              new_value: { x: zoneRect.x ?? null, y: zoneRect.y ?? null, w: zoneRect.w ?? null, h: zoneRect.h ?? null },
            };
          }

          if (args.action === 'set_icon') {
            if (!args.icon) {
              return { success: false, error: '"icon" is required for action="set_icon".' };
            }
            const result = await getSlideEntry('slide_assets');
            if (result.error || !result.arr || !result.slide) return { success: false, error: result.error };
            const oldValue = { icon: result.slide.icon ?? null, iconName: result.slide.iconName ?? null };
            result.slide.icon = args.icon;
            result.slide.iconName = args.icon;
            const writeResult = await persist('slide_assets', result.arr);
            if (!writeResult.success) return writeResult;
            return {
              success: true,
              message: `Slide ${args.slide_index}: icon updated.`,
              old_value: oldValue,
              new_value: { icon: args.icon, iconName: args.icon },
            };
          }

          if (args.action === 'set_image') {
            if (!args.image_path) {
              return { success: false, error: '"image_path" is required for action="set_image".' };
            }
            const result = await getSlideEntry('slide_assets');
            if (result.error || !result.arr || !result.slide) return { success: false, error: result.error };
            const oldValue = {
              primaryImagePath: result.slide.primaryImagePath ?? null,
              selectedImages: Array.isArray(result.slide.selectedImages) ? result.slide.selectedImages : null,
            };
            result.slide.primaryImagePath = args.image_path;
            if (!Array.isArray(result.slide.selectedImages)) {
              result.slide.selectedImages = [];
            }
            const selectedImages = result.slide.selectedImages as Array<Record<string, unknown>>;
            if (selectedImages.length === 0) {
              selectedImages.push({ id: 'manual-selection', imagePath: args.image_path });
            } else {
              selectedImages[0] = { ...selectedImages[0], imagePath: args.image_path };
            }
            const writeResult = await persist('slide_assets', result.arr);
            if (!writeResult.success) return writeResult;
            return {
              success: true,
              message: `Slide ${args.slide_index}: primary image updated.`,
              old_value: oldValue,
              new_value: {
                primaryImagePath: args.image_path,
                selectedImages: selectedImages,
              },
            };
          }

          if (args.action === 'set_override') {
            if (!args.shape_name) {
              return { success: false, error: '"shape_name" is required for action="set_override". Use names like "chip_0", "card_1", "title_panel".' };
            }
            if (!args.fill_color && !args.border_color) {
              return { success: false, error: 'At least one of "fill_color" or "border_color" is required for "set_override".' };
            }
            const hexPattern = /^[0-9A-Fa-f]{6}$/;
            if (args.fill_color && !hexPattern.test(args.fill_color)) {
              return { success: false, error: `Invalid fill_color "${args.fill_color}". Must be 6-digit hex without # prefix.` };
            }
            if (args.border_color && !hexPattern.test(args.border_color)) {
              return { success: false, error: `Invalid border_color "${args.border_color}". Must be 6-digit hex without # prefix.` };
            }

            const filePath = fileMap.layout_input;
            const arr = await readJsonArray(filePath);
            if (!arr) {
              return { success: false, error: `layout-input.json not found or not a JSON array.` };
            }
            const idxErr = validateSlideIndex(arr);
            if (idxErr) return { success: false, error: idxErr };

            const slideEntry = arr[args.slide_index] as Record<string, unknown>;

            // Get or create shape_overrides array
            let overrides = slideEntry.shape_overrides as Array<Record<string, string>> | undefined;
            if (!Array.isArray(overrides)) {
              overrides = [];
              slideEntry.shape_overrides = overrides;
            }

            // Find existing entry for this shape or create new
            let entry = overrides.find((o) => (o.name || o.shapeName) === args.shape_name);
            if (!entry) {
              entry = { name: args.shape_name! };
              overrides.push(entry);
            }

            const oldFill = entry.fill_color || entry.fillColor;
            const oldBorder = entry.border_color || entry.borderColor;

            if (args.fill_color) entry.fill_color = args.fill_color.toUpperCase();
            if (args.border_color) entry.border_color = args.border_color.toUpperCase();

            const writeResult = await writeJsonArray(filePath, arr);
            if (!writeResult.success) return writeResult;
            artifactRepairDirty.add('layout_input');

            return {
              success: true,
              message: `Slide ${args.slide_index}: shape "${args.shape_name}" override set.`,
              old: { fill_color: oldFill ?? null, border_color: oldBorder ?? null },
              new: { fill_color: args.fill_color?.toUpperCase() ?? null, border_color: args.border_color?.toUpperCase() ?? null },
            };
          }

          if (args.action === 'remove_override') {
            if (!args.shape_name) {
              return { success: false, error: '"shape_name" is required for action="remove_override".' };
            }
            const result = await getSlideEntry('layout_input');
            if (result.error || !result.arr || !result.slide) return { success: false, error: result.error };
            const overrides = result.slide.shape_overrides;
            if (!Array.isArray(overrides)) {
              return { success: false, error: 'This slide has no shape_overrides array.' };
            }
            const existingIndex = overrides.findIndex((item) => {
              if (!item || typeof item !== 'object') return false;
              const override = item as Record<string, unknown>;
              return (override.name || override.shapeName) === args.shape_name;
            });
            if (existingIndex < 0) {
              return { success: false, error: `No override found for shape "${args.shape_name}".` };
            }
            const [removed] = overrides.splice(existingIndex, 1);
            const writeResult = await persist('layout_input', result.arr);
            if (!writeResult.success) return writeResult;
            return {
              success: true,
              message: `Slide ${args.slide_index}: shape override removed for "${args.shape_name}".`,
              old_value: removed,
            };
          }

          if (args.action === 'patch') {
            if (!args.file || !args.property || args.value === undefined) {
              return { success: false, error: '"file", "property", and "value" are required for action="patch".' };
            }
            const filePath = fileMap[args.file];
            if (!filePath) {
              return { success: false, error: `Unknown file "${args.file}". Allowed: layout_input, layout_specs, slide_assets.` };
            }
            const arr = await readJsonArray(filePath);
            if (!arr) {
              return { success: false, error: `File not found or not a JSON array: ${filePath}` };
            }
            const idxErr = validateSlideIndex(arr);
            if (idxErr) return { success: false, error: idxErr };

            const slideEntry = arr[args.slide_index] as Record<string, unknown>;
            const oldValue = getNestedValue(slideEntry, args.property);
            setNestedValue(slideEntry, args.property, args.value);

            const writeResult = await writeJsonArray(filePath, arr);
            if (!writeResult.success) return writeResult;
            artifactRepairDirty.add(args.file);

            return {
              success: true,
              message: `Slide ${args.slide_index}: ${args.property} updated.`,
              old_value: oldValue,
              new_value: args.value,
            };
          }

          return { success: false, error: `Unknown action "${args.action}". Use "read", "patch", "set_text", "set_array_item", "set_zone_geometry", "set_icon", "set_image", "set_override", or "remove_override".` };
        },
      };

      const suggestFrameworkTool: LLMToolDefinition = {
        name: 'suggest_framework',
        description:
          'Present available business frameworks to the user for selection. ' +
          'The user defines the framework — do not auto-select one. ' +
          'If the user has already specified a framework, use it directly without calling this tool. ' +
          'Available frameworks: mckinsey (executive recommendation deck), scqa (situation-complication-question-answer), ' +
          'pyramid (top-down argument), mece (problem decomposition), action-title (conclusion-first slides), ' +
          'assertion-evidence (claim + supporting data), exec-summary-first (decision-maker deck).',
        parameters: {
          type: 'object' as const,
          properties: {
            primary: { type: 'string', description: 'Framework name chosen by the user' },
            reasoning: { type: 'string', description: 'Why the user chose this framework, or context for the selection' },
          },
          required: ['primary', 'reasoning'],
        },
        handler: async (args: { primary: string; reasoning: string }) => {
          win.webContents.send('chat:framework-suggested', args);
          return { success: true, message: `Framework "${args.primary}" suggested.` };
        },
      };

      const buildSessionConfig = (
        skillDirectories: string[],
        mode: SessionMode,
        workflow: WorkflowConfig | null,
        frameworkAlreadySet: boolean,
        workspaceAbsPath: string,
        deckExists: boolean,
      ): LLMSessionConfig => {
        const workflowDirective = workflow?.agentDirective ?? '';
        const hasCustomFrameworkPrompt = workspace.framework === 'custom-prompt' && !!workspace.customFrameworkPrompt?.trim();
        const storyFrameworkInstruction = frameworkAlreadySet
          ? hasCustomFrameworkPrompt
            ? 'IMPORTANT: The user has already chosen a custom business framework. It is shown in the Current Workspace section under Custom framework prompt. Follow those instructions directly and do NOT ask the user to choose a framework again.'
            : 'IMPORTANT: The user has already chosen a business framework — it is shown in the Current Workspace section. Apply it directly. Do NOT ask the user to choose a framework again or list framework options.'
          : 'When creating a presentation outline, the business framework is defined by the user. If the user has already specified a framework, apply it directly. If not, present the available options and ask the user to choose before writing the slide scenario to the workspace panel.';
        const pptxSystemMessage = buildManagedSystemPrompt('pptx', {
          workflowDirective,
          workspaceDir: workspaceAbsPath,
          imagesDir: path.join(workspaceAbsPath, 'images'),
        });

        const storySystemMessage = buildManagedSystemPrompt('story', {
          workflowDirective,
          storyFrameworkInstruction,
          // When a deck exists, inject workspace paths so the LLM can use repair tools
          ...(deckExists ? { workspaceDir: workspaceAbsPath, imagesDir: path.join(workspaceAbsPath, 'images') } : {}),
        });

        // Tool selection: additive based on workspace state
        const storyTools = frameworkAlreadySet
          ? [scenarioTool, updateSlideTool]
          : [scenarioTool, updateSlideTool, suggestFrameworkTool];
        const repairTools = [patchLayoutInfrastructureTool, tweakSlideTool, rerunPptxTool];

        let tools: LLMToolDefinition[];
        if (mode === 'pptx') {
          // Explicit PPTX workflow (create-pptx or poststaging QA)
          tools = repairTools;
        } else if (deckExists) {
          // Story mode but a rendered deck exists — include repair tools so the
          // LLM can handle visual tweaks without explicit workflow routing.
          tools = [...storyTools, ...repairTools];
        } else {
          tools = storyTools;
        }

        return {
          tools: tools.map(withToolLogging),
          skillDirectories,
          systemMessage: mode === 'pptx' ? pptxSystemMessage : storySystemMessage,
          model: process.env.MODEL_NAME || undefined,
          streaming: true,
          reasoningEffort: isTargetedPptxRepair(workflow)
            ? 'low'
            : (process.env.REASONING_EFFORT as 'low' | 'medium' | 'high') || undefined,
        };
      };

      try {
        const provider = getActiveProvider();
        const sessionMode: SessionMode = resolveSessionMode(message, workspace, workflow);
        const skillDirectories = await getSkillDirectories(sessionMode, workflow);

        const frameworkAlreadySet = !!workspace.framework;
        const wsDir = await readWorkspaceDir();
        const deckExists = fsExistsSync(path.join(wsDir, 'previews', 'render-config.json'));
        const sessionConfig = buildSessionConfig(skillDirectories, sessionMode, workflow, frameworkAlreadySet, wsDir, deckExists);

        // ---- Single-shot path ----
        const onDelta = (delta: LLMStreamDelta) => {
          resetInactivityTimeout();
          if (delta.type === 'content') {
            sendToWindow(win, 'chat:stream', { content: delta.text });
          } else if (delta.type === 'thinking') {
            sendToWindow(win, 'chat:stream', { thinking: delta.text });
          } else if (delta.type === 'error') {
            failRequest(delta.message);
          }
        };

        session = await provider.createSession(sessionConfig, onDelta);

        const timeoutPromise = new Promise<never>((_, reject) => {
          const startTime = Date.now();
          const check = () => {
            const elapsed = Date.now() - startTime;
            const idle = Date.now() - lastActivityTime;
            if (elapsed >= CHAT_REQUEST_TIMEOUT_MS) {
              if (session) void session.disconnect().catch(() => { });
              reject(new Error(`Generation timed out after ${Math.round(CHAT_REQUEST_TIMEOUT_MS / 60000)} minutes. Try a simpler prompt or run the request again.`));
            } else if (idle >= CHAT_INACTIVITY_TIMEOUT_MS) {
              if (session) void session.disconnect().catch(() => { });
              reject(new Error(`Generation stalled — no activity for ${Math.round(CHAT_INACTIVITY_TIMEOUT_MS / 60000)} minutes. The LLM may be unresponsive. Try again.`));
            } else {
              timeoutHandle = setTimeout(check, 30_000);
            }
          };
          timeoutHandle = setTimeout(check, 30_000);
        });

        await Promise.race([
          session.sendAndWait(prompt, CHAT_REQUEST_TIMEOUT_MS),
          timeoutPromise,
        ]);

        if (artifactRepairDirty.size > 0) {
          const syncEventId = `rerun_pptx-auto-${Date.now()}`;
          const dirtyArtifacts = Array.from(artifactRepairDirty);
          emitToolEvent({
            id: syncEventId,
            toolName: 'rerun_pptx',
            status: 'running',
            argsPreview: previewToolValue({ autoSync: true, dirtyArtifacts }),
            startedAt: Date.now(),
          });
          sendToWindow(win, 'chat:stream', {
            thinking: `Syncing updated deck after artifact edits (${dirtyArtifacts.join(', ')})...`,
          });
          const syncStartedAt = Date.now();
          const rerunResult = await runPptxRerender();
          if (!rerunResult.success) {
            emitToolEvent({
              id: syncEventId,
              toolName: 'rerun_pptx',
              status: 'error',
              argsPreview: previewToolValue({ autoSync: true, dirtyArtifacts }),
              resultPreview: previewToolValue(rerunResult.error),
              startedAt: syncStartedAt,
              finishedAt: Date.now(),
              durationMs: Date.now() - syncStartedAt,
            });
            failRequest(rerunResult.error ?? 'Failed to sync updated PPTX after artifact edits.');
            return;
          }
          emitToolEvent({
            id: syncEventId,
            toolName: 'rerun_pptx',
            status: 'success',
            argsPreview: previewToolValue({ autoSync: true, dirtyArtifacts }),
            resultPreview: previewToolValue(rerunResult.message),
            startedAt: syncStartedAt,
            finishedAt: Date.now(),
            durationMs: Date.now() - syncStartedAt,
          });
          sendToWindow(win, 'chat:stream', {
            content: `\n\n[PPTX synced: ${rerunResult.slideCount ?? 0} slides rendered${rerunResult.warnings?.length ? `, warnings: ${rerunResult.warnings.length}` : ''}. Click Rerender in the preview pane to refresh images.]`,
          });
        }

        completeRequest();
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        failRequest(msg);
      } finally {
        clearRequestTimeout();
        activeChatRequest = null;
        if (session) await session.disconnect().catch(() => { });
      }
    })().catch((err) => {
      const win = getWindow();
      const msg = err instanceof Error ? err.message : 'Unknown error';
      if (win) {
        sendToWindow(win, 'chat:error', msg);
      }
      activeChatRequest = null;
      console.error('[chat:send] Unhandled error', err);
    });
  });
}
