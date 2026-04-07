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
  TemplateMeta,
  ScenarioPayload,
  SlideUpdatePayload,
} from '../../../src/domain/entities/slide-work';
import type { DataFile, ScrapeResult } from '../../../src/domain/ports/ipc';
import { getIconifyCollectionById } from '../../../src/domain/icons/iconify';
import type { IconifyCollectionId } from '../../../src/domain/icons/iconify';
import { formatWorkflowForPrompt, getWorkflowConfig, type WorkflowConfig } from '../../../src/domain/workflows/workflow-config';
import { executeGeneratedPythonCodeToFile, executeChunkedPptxGeneration, formatExecutionFailure, computeLayoutSpecs, persistSlideAssetsToWorkspace, persistLayoutMeta } from '../pptx/pptx-handler.ts';
import type { ChunkResult, PptxCompletionReport } from '../pptx/pptx-handler.ts';
import { buildManagedSystemPrompt } from './system-prompts.ts';
import { readWorkspaceDir, resolveBundledPath } from '../project/workspace-utils.ts';
import { chunkSlides } from './slide-chunker.ts';
import type { SlideGroup } from './slide-chunker.ts';
import { retrieveContext, hasRaptorTree } from '../data/raptor-handler.ts';
import type { RetrievedSection } from '../data/raptor-handler.ts';

const CHAT_REQUEST_TIMEOUT_MS = 120 * 60 * 1000;
const CHAT_INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000;

type ActiveChatRequest = {
  cancel: (reason?: string) => void;
};

let activeChatRequest: ActiveChatRequest | null = null;

/** Extract python-pptx code from a fenced code block in LLM output. */
function extractPptxCodeBlock(content: string): string | null {
  const blocks = [...content.matchAll(/```([^\r\n`]*)[ \t]*\r?\n([\s\S]*?)```/g)]
    .filter((m) => { const i = (m[1] ?? '').trim().toLowerCase(); return !i || i === 'python' || i === 'py'; });
  const preferred = blocks.find((m) => { const l = (m[1] ?? '').trim().toLowerCase(); return l === 'python' || l === 'py'; })
    ?? blocks.find((m) => /from\s+pptx\s+import|import\s+pptx|Presentation\(/i.test(m[2] ?? ''));
  return preferred?.[2]?.trim() || null;
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

interface WorkspaceContext {
  title: string;
  slides: SlideItem[];
  designBrief: DesignBrief | null;
  designStyle: import('../../../src/domain/entities/slide-work').DesignStyle | null;
  framework: FrameworkType | null;
  customFrameworkPrompt: string | null;
  templateMeta: TemplateMeta | null;
  pptxBuildError: string | null;
  theme: ThemeTokens | null;
  workflow: WorkflowConfig | null;
  dataSources: DataFile[];
  urlSources: Array<{ url: string; status: string; result?: ScrapeResult }>;
  iconProvider: 'iconify';
  iconCollection: IconifyCollectionId;
  availableIcons: string[];
  includeImagesInLayout?: boolean;
  chunkSize?: number;
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

function rankSkillDirectory(mode: SessionMode, skillName: string): number {
  const normalized = skillName.toLowerCase();

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

async function getSkillDirectories(mode: SessionMode): Promise<string[]> {
  const entries = await listSkillDirectories();
  if (entries.length === 0) return [];

  const ranked = entries
    .map((entry) => ({
      ...entry,
      rank: rankSkillDirectory(mode, entry.name),
    }))
    .filter((entry) => entry.rank < 10)
    .sort((left, right) => left.rank - right.rank || left.name.localeCompare(right.name));

  return ranked.map((entry) => entry.path);
}

function resolveWorkflow(message: string, workspace: WorkspaceContext): WorkflowConfig | null {
  if (workspace.workflow) return workspace.workflow
  if (isPptxGenerationRequest(message, workspace)) return getWorkflowConfig('create-pptx')
  return null
}

function resolveSessionMode(message: string, workspace: WorkspaceContext): SessionMode {
  const workflow = resolveWorkflow(message, workspace)
  if (workflow) return workflow.mode as SessionMode
  return isPptxGenerationRequest(message, workspace) ? 'pptx' : 'story'
}

function isPptxGenerationRequest(message: string, workspace: WorkspaceContext): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) return false;
  if (workspace.slides.length === 0) return false;
  return /\b(create|generate|build|export)\b.*\b(pptx|powerpoint|deck)\b|\bpython-pptx\b/.test(normalized);
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

  // Split by H2 headers (## NN. StyleName)
  const sections = content.split(/^(?=## \d+\.\s)/m);
  const normalizedQuery = styleName.toLowerCase().replace(/[-_\s]+/g, '');
  for (const section of sections) {
    const headerMatch = section.match(/^## \d+\.\s+(.+)/);
    if (!headerMatch) continue;
    const sectionName = headerMatch[1].toLowerCase().replace(/[-_\s]+/g, '');
    if (sectionName.includes(normalizedQuery) || normalizedQuery.includes(sectionName)) {
      return section.trim();
    }
  }
  return null;
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

async function buildPrompt(
  message: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  workspace: WorkspaceContext,
  mode: SessionMode,
): Promise<string> {
  const parts: string[] = [];
  const historyForPrompt = mode === 'pptx'
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
    // Signal to the AI when a custom template is active
    const wsTemplatePath = path.join(workspaceAbsPath, 'template', 'template.pptx');
    if (workspace.designStyle === 'Custom Template' && fsExistsSync(wsTemplatePath)) {
      parts.push('Custom PPTX template: ACTIVE — use TEMPLATE_PATH variable. See CUSTOM TEMPLATE RULES in system prompt.');
      if (workspace.templateMeta) {
        const bgImages = workspace.templateMeta.backgroundImages ?? [];
        parts.push(`Template metadata: blankLayoutIndex=${workspace.templateMeta.blankLayoutIndex}, fonts.major=${workspace.templateMeta.fonts.major}, fonts.minor=${workspace.templateMeta.fonts.minor}, extractedBackgroundImages=${bgImages.length}`);
        parts.push('Template runtime helpers available in Python: TEMPLATE_META, TEMPLATE_BACKGROUND_IMAGES, TEMPLATE_BLANK_LAYOUT_INDEX. Use the predefined font behavior unless explicitly required otherwise.');
        if (bgImages.length > 0) {
          parts.push(`Template background assets: ${bgImages.slice(0, 4).join(' | ')}`);
        }
      }
    }
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

  if (workspace.pptxBuildError) {
    parts.push('## Last PPTX Build Failure\n');
    parts.push('The previous generated python-pptx code failed to run. Apply a MINIMAL, targeted fix — only change the lines that caused the error. Output the full file but keep all working code unchanged. Do NOT redesign or regenerate slides that were not part of the failure.');
    if (/shape\.fill\._fill|_SolidFill|AttributeError:.*find\(/i.test(workspace.pptxBuildError)) {
      parts.push('For fill transparency or alpha fixes, do not use shape.fill._fill. Use set_fill_transparency(shape, value), or if you must edit OOXML directly, traverse shape._element.spPr instead.');
    }
    parts.push(workspace.pptxBuildError);

    // Include the failing generated-source.py so the LLM can make a surgical fix
    try {
      const wsDir = await readWorkspaceDir();
      const srcPath = path.join(wsDir, 'previews', 'generated-source.py');
      const lastCode = await fs.readFile(srcPath, 'utf-8');
      if (lastCode.trim()) {
        parts.push('\n### Previously Generated Code (fix only the broken parts)\n');
        parts.push('```python');
        parts.push(lastCode);
        parts.push('```');
      }
    } catch { /* generated-source.py not found — rely on conversation history */ }

    parts.push('');
  }

  // Data sources — extract slide queries for RAPTOR retrieval
  const slideQueries = workspace.slides.length > 0
    ? workspace.slides.map(s => `${s.title} ${s.keyMessage}`.trim()).filter(q => q.length > 0)
    : undefined;

  if (workspace.dataSources.length > 0) {
    parts.push('## Available File Data Sources\n');
    for (const ds of workspace.dataSources) {
      parts.push(...await formatFileSource(ds, slideQueries));
    }
    parts.push('');
  }

  if (workspace.urlSources.length > 0) {
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
    parts.push(`Color treatment: ${workspace.theme.colorTreatment || 'solid'} (${workspace.theme.colorTreatment === 'gradient' ? 'Prefer gradient fills on large cards, ribbons, and background panels.' : 'Prefer solid fills unless the chosen design style explicitly needs a gradient accent.'})`);
    const slots = workspace.theme.slots;
    parts.push(`OOXML slots: dk1=#${slots.dk1}, lt1=#${slots.lt1}, dk2=#${slots.dk2}, lt2=#${slots.lt2}, accent1=#${slots.accent1}, accent2=#${slots.accent2}, accent3=#${slots.accent3}, accent4=#${slots.accent4}, accent5=#${slots.accent5}, accent6=#${slots.accent6}, hlink=#${slots.hlink}, folHlink=#${slots.folHlink}`);
    parts.push(`Semantic colors: PRIMARY=#${workspace.theme.C.PRIMARY}, SECONDARY=#${workspace.theme.C.SECONDARY}, BG=#${workspace.theme.C.BG}, TEXT=#${workspace.theme.C.TEXT}, ACCENT3=#${workspace.theme.C.ACCENT3}, ACCENT4=#${workspace.theme.C.ACCENT4}, ACCENT5=#${workspace.theme.C.ACCENT5}, ACCENT6=#${workspace.theme.C.ACCENT6}`);
    if (workspace.theme.colors.length > 0) {
      parts.push(`Palette colors: ${workspace.theme.colors.slice(0, 20).map((color) => `${color.name} ${color.hex}`).join(' | ')}`);
    }
    parts.push('CRITICAL: The palette colors above are the ONLY color source for this deck. Use OOXML slot and palette hex values exclusively in python-pptx code. Do NOT use any hardcoded hex colors from the design style spec — those are overridden by this palette. Readability is mandatory: when text sits on any colored or image background, call ensure_contrast(fg_hex, bg_hex). If style conflicts with readability, readability wins.');
    parts.push('');
  }

  if (workspace.workflow) {
    parts.push('## Active Workflow\n');
    parts.push(formatWorkflowForPrompt(workspace.workflow));
    const workflowMarkdown = await readWorkflowMarkdown(workspace.workflow, 12_000);
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
    parts.push('If validation fails with ERROR-level issues, use patch_layout_infrastructure to read and fix layout_specs.py or layout_validator.py, then call rerun_pptx.');
    parts.push('');
  }

  if (workspace.designStyle) {
    parts.push('## Selected PPTX Design Style\n');
    parts.push(`Apply the "${workspace.designStyle}" style consistently across the deck.`);
    parts.push('Ensure contrast safety and readability when applying the design style — avoid mid-tone on mid-tone, and add overlay panels behind text over images.');
    const styleBlock = await readDesignStyleBlock(workspace.designStyle);
    if (styleBlock) {
      // When a palette is active, strip hardcoded hex colors from the style spec
      // so the LLM uses only palette colors for the design style's layout/composition.
      const hasActivePalette = workspace.theme && workspace.theme.colors.length > 0;
      const spec = hasActivePalette
        ? styleBlock.replace(/#[0-9A-Fa-f]{6}/g, '(use palette)').replace(/@ \d+[–-]\d+% opacity/g, '@ low opacity')
        : styleBlock;
      parts.push('### Style Spec\n');
      if (hasActivePalette) {
        parts.push('NOTE: A custom palette is active. Use ONLY the palette/theme colors from the Active Theme Palette section above. The hex values below have been replaced — apply only the layout, composition, and signature element rules from this style spec.');
      }
      parts.push(spec);
    } else {
      parts.push('If the pptx-design-styles skill is available, use it for style details.');
    }
    parts.push('');
  }

  {
    const collection = getIconifyCollectionById(workspace.iconCollection);
    parts.push('## Icon Constraints\n');
    parts.push(`Icon provider: ${workspace.iconProvider}`);
    parts.push(`Preferred icon set: ${collection.label} (${collection.id})`);
    if (workspace.availableIcons.length > 0) {
      parts.push(`Approved icon hints currently attached to the workspace: ${workspace.availableIcons.length}`);
    }
    parts.push('Use explicit Iconify IDs only. Prefer icon names already attached to slides or provided by slide_assets(slide_index). Do not invent icon names, and do not use icons outside the selected collection because fetch_icon() enforces that constraint at runtime.');
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
// Chunked LLM generation helpers
// ---------------------------------------------------------------------------

const MAX_CHUNK_RETRIES = 2; // 3 total attempts per chunk

/**
 * Build a prompt scoped to a single chunk's slides.
 * Re-uses buildPrompt with a modified workspace containing only the chunk's slides,
 * then appends chunk-specific instructions.
 */
async function buildChunkPrompt(
  message: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  workspace: WorkspaceContext,
  group: SlideGroup,
): Promise<string> {
  const chunkWorkspace: WorkspaceContext = {
    ...workspace,
    slides: group.slides.map((slide, i) => ({ ...slide, number: i + 1 })),
  };
  const prompt = await buildPrompt(message, history, chunkWorkspace, 'pptx');
  const originalRange = group.slideIndices.map((i) => i + 1).join(', ');

  const runtimeApiReminder = [
    '## Runtime API — Use ONLY These Names',
    'The following helpers are pre-injected by the runtime. Do NOT define, rename, or shadow them:',
    '- fetch_icon(icon_id, color_hex) → path_or_None',
    '- safe_add_picture(shapes, path, left_emu, top_emu, width_emu, height_emu)  [first arg = slide.shapes]',
    '- ensure_contrast(fg_hex, bg_hex) → hex_str',
    '- resolve_font(text, fallback) → PPTX_FONT_FAMILY   (always returns the base font — kept for backward compat)',
    '- apply_widescreen(prs) → prs',
    '- set_fill_transparency(shape, value)',
    '- apply_gradient_fill(shape, color_stops, angle_degrees=0)',
    '- PRECOMPUTED_LAYOUT_SPECS, OUTPUT_PATH, PPTX_TITLE, PPTX_THEME, PPTX_FONT_FAMILY, PPTX_COLOR_TREATMENT, WORKSPACE_DIR, IMAGES_DIR',
    'Do NOT invent helpers such as _txb, _rect, _oval, _shape, or any other shorthand.',
  ].join('\n');

  return prompt
    + `\n\n${runtimeApiReminder}`
    + `\n\n## Chunk Generation Instruction\n`
    + `Generate python-pptx code for slides ${originalRange} ONLY (in the original deck order).\n`
    + `PRECOMPUTED_LAYOUT_SPECS is indexed from 0 for your first slide (contains ${group.slides.length} entries).\n`
    + `layout-input.json and slide-assets.json contain only your slides.\n`
    + `The code must be a complete, self-contained python-pptx script starting from Presentation().`;
}

/**
 * Run parallel LLM sessions for each chunk, collecting generated code.
 * Each chunk retries up to MAX_CHUNK_RETRIES times on failure.
 */
async function generatePptxChunked(
  groups: SlideGroup[],
  message: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  workspace: WorkspaceContext,
  sessionConfig: LLMSessionConfig,
  win: BrowserWindow,
): Promise<ChunkResult[]> {
  const totalChunks = groups.length;
  const provider = getActiveProvider();

  const chunkPromises = groups.map(async (group): Promise<ChunkResult> => {
    const { chunkIndex, slideIndices } = group;
    const slideRange = `${slideIndices[0] + 1}-${slideIndices[slideIndices.length - 1] + 1}`;

    sendToWindow(win, 'chat:chunk-progress', { chunkIndex, totalChunks, status: 'generating', slideRange });
    sendToWindow(win, 'chat:stream', { content: `\n[Chunk ${chunkIndex + 1}/${totalChunks}] Generating slides ${slideRange}...\n` });

    const promptStart = Date.now();
    const prompt = await buildChunkPrompt(message, history, workspace, group);
    const promptMs = Date.now() - promptStart;
    console.log(`[perf] Chunk ${chunkIndex + 1} prompt built in ${promptMs}ms (${(prompt.length / 1024).toFixed(1)} KB)`);
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_CHUNK_RETRIES; attempt++) {
      let accumulated = '';
      const chunkDelta = (delta: LLMStreamDelta) => {
        if (delta.type === 'content') accumulated += delta.text;
      };

      let chunkSession: LLMSession | null = null;
      try {
        chunkSession = await provider.createSession(sessionConfig, chunkDelta);
        await chunkSession.sendAndWait(prompt, CHAT_REQUEST_TIMEOUT_MS);

        const code = extractPptxCodeBlock(accumulated);
        if (!code) throw new Error(`Chunk ${chunkIndex}: LLM response did not contain valid python-pptx code.`);

        return { chunkIndex, code, slideIndices };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < MAX_CHUNK_RETRIES) {
          sendToWindow(win, 'chat:stream', { content: `\n[Chunk ${chunkIndex + 1}] Retry ${attempt + 1}/${MAX_CHUNK_RETRIES}...\n` });
        }
      } finally {
        if (chunkSession) await chunkSession.disconnect().catch(() => {});
      }
    }

    throw lastError!;
  });

  const chunkGenStart = Date.now();
  const settled = await Promise.allSettled(chunkPromises);
  const chunkGenMs = Date.now() - chunkGenStart;
  console.log(`[perf] All ${totalChunks} chunks completed in ${(chunkGenMs / 1000).toFixed(1)}s`);
  const results: ChunkResult[] = [];
  const errors: string[] = [];

  for (let i = 0; i < settled.length; i++) {
    const r = settled[i];
    if (r.status === 'fulfilled') {
      results.push(r.value);
    } else {
      const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
      const g = groups[i];
      errors.push(`Chunk ${g.chunkIndex} (slides ${g.slideIndices[0] + 1}-${g.slideIndices[g.slideIndices.length - 1] + 1}): ${msg}`);
    }
  }

  if (errors.length > 0) throw new Error(`Chunked LLM generation failed:\n${errors.join('\n')}`);
  return results.sort((a, b) => a.chunkIndex - b.chunkIndex);
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

      const mode = resolveSessionMode(message, workspace);
      let prompt = await buildPrompt(message, history, workspace, mode);

      // Pre-compute content-adaptive layout specs for PPTX generation workflows.
      // Uses PowerPoint COM AutoFit + kiwisolver constraint solver to produce
      // pixel-perfect coordinates injected into the Python runner env.
      let layoutSpecsJson: string | undefined;
      let slideAssetsJson: string | undefined;
      let layoutSpecsPromise: Promise<void> | null = null;
      let slideAssetsPromise: Promise<void> | null = null;
      const workflow = resolveWorkflow(message, workspace);
      if (mode === 'pptx' && workspace.slides.length > 0) {
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
        persistLayoutMeta({ includeImagesInLayout: workspace.includeImagesInLayout ?? false }).catch(() => {});
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

      // Tool definitions (provider-neutral — close over win for IPC emission)
      const scenarioTool: LLMToolDefinition = {
        name: 'set_scenario',
        description:
          'Set the slide scenario (outline) for the presentation workspace panel. ' +
          'Each slide must have a keyMessage (the "so what" / key takeaway), a layout hint, and optionally an icon hint. ' +
          'You may also include imageQuery when supporting images should later be searched for and selected on the slide. ' +
          'Available layouts: title, agenda, section, bullets, cards, stats, comparison, timeline, diagram, summary. ' +
          'The layout and icon are guidance for the later PPTX design step, not a rigid rendering contract. ' +
          'When helpful, include a designBrief describing tone, audience, visual style, density, and layout approach. ' +
          `Use Iconify icon IDs for icons and stay within the selected collection (${workspace.iconCollection}). Prefer slide-specific icon hints over invented names.`,
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

      /** Resolve a scripts/*.py path safely (whitelist only). */
      const resolveInfraFile = (file: string): string | null => {
        const allowed: Record<string, string> = {
          layout_specs: 'layout_specs.py',
          layout_validator: 'layout_validator.py',
        };
        const basename = allowed[file];
        if (!basename) return null;
        return resolveBundledPath('scripts', 'layout', basename);
      };

      const patchLayoutInfrastructureTool: LLMToolDefinition = {
        name: 'patch_layout_infrastructure',
        description:
          'Read or patch the layout infrastructure files (layout_specs.py or layout_validator.py). ' +
          'Use this when layout validation errors occur and the layout spec coordinates or validator thresholds need adjustment. ' +
          'Action "read" returns the full file content so you can understand current values. ' +
          'Action "patch" performs a search-and-replace edit on the file. ' +
          'Only layout_specs and layout_validator are allowed targets.',
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
              description: 'Target file: "layout_specs" or "layout_validator".',
              enum: ['layout_specs', 'layout_validator'],
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
          const filePath = resolveInfraFile(args.file);
          if (!filePath) {
            return { success: false, error: `Unknown file "${args.file}". Allowed: layout_specs, layout_validator.` };
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
            await fs.writeFile(filePath, updated, 'utf-8');
            return { success: true, message: `Patched ${args.file}: replaced 1 occurrence.` };
          }

          return { success: false, error: `Unknown action "${args.action}". Use "read" or "patch".` };
        },
      };

      const rerunPptxTool: LLMToolDefinition = {
        name: 'rerun_pptx',
        description:
          'Re-execute the last generated python-pptx code after patching layout infrastructure files. ' +
          'This re-runs the previously written generated-source.py with the same theme and title. ' +
          'Use this after calling patch_layout_infrastructure to verify the fix resolves validation errors.',
        parameters: {
          type: 'object' as const,
          properties: {},
          required: [],
        },
        handler: async () => {
          try {
            // Wait for background layout spec computation if still in-flight
            if (layoutSpecsPromise) await layoutSpecsPromise;
            if (slideAssetsPromise) await slideAssetsPromise;

            const workspaceDir = await readWorkspaceDir();
            const previewRoot = path.join(workspaceDir, 'previews');
            const sourcePath = path.join(previewRoot, 'generated-source.py');
            const outputPath = path.join(previewRoot, 'presentation-preview.pptx');

            if (!fsExistsSync(sourcePath)) {
              return { success: false, error: 'No generated-source.py found. Generate PPTX code first.' };
            }

            const code = await fs.readFile(sourcePath, 'utf-8');
            const theme = workspace.theme;
            const title = workspace.title || 'Presentation';

            // Remove old output so we get fresh validation
            await fs.unlink(outputPath).catch(() => { });

            const report = await executeGeneratedPythonCodeToFile(code, theme, title, outputPath, {
              iconCollection: workspace.iconCollection,
              layoutSpecsJson,
              includeImagesInLayout: workspace.includeImagesInLayout,
            });

            return {
              success: true,
              message: `PPTX re-generated successfully (${report.slideCount} slides). Layout validation passed.`,
              slideCount: report.slideCount,
              warnings: report.warnings,
            };
          } catch (err) {
            return { success: false, error: formatExecutionFailure(err) };
          }
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
      ): LLMSessionConfig => {
        const workflowDirective = workflow?.agentDirective ?? '';
        const hasCustomFrameworkPrompt = workspace.framework === 'custom-prompt' && !!workspace.customFrameworkPrompt?.trim();
        const storyFrameworkInstruction = frameworkAlreadySet
          ? hasCustomFrameworkPrompt
            ? 'IMPORTANT: The user has already chosen a custom business framework. It is shown in the Current Workspace section under Custom framework prompt. Follow those instructions directly and do NOT ask the user to choose a framework again.'
            : 'IMPORTANT: The user has already chosen a business framework — it is shown in the Current Workspace section. Apply it directly. Do NOT ask the user to choose a framework again or list framework options.'
          : 'When creating a presentation outline, the business framework is defined by the user. If the user has already specified a framework, apply it directly. If not, present the available options using suggest_framework and ask the user to choose before calling set_scenario.';
        const pptxSystemMessage = buildManagedSystemPrompt('pptx', {
          workflowDirective,
          workspaceDir: workspaceAbsPath,
          imagesDir: path.join(workspaceAbsPath, 'images'),
        });

        const storySystemMessage = buildManagedSystemPrompt('story', {
          workflowDirective,
          storyFrameworkInstruction,
        });

        return {
          tools: mode === 'pptx'
            ? [patchLayoutInfrastructureTool, rerunPptxTool]
            : frameworkAlreadySet
              ? [scenarioTool, updateSlideTool]
              : [scenarioTool, updateSlideTool, suggestFrameworkTool],
          skillDirectories,
          systemMessage: mode === 'pptx' ? pptxSystemMessage : storySystemMessage,
          model: process.env.MODEL_NAME || undefined,
          streaming: true,
          reasoningEffort: (process.env.REASONING_EFFORT as 'low' | 'medium' | 'high') || undefined,
        };
      };

      try {
        const provider = getActiveProvider();
        const workflow = resolveWorkflow(message, workspace);
        const sessionMode: SessionMode = resolveSessionMode(message, workspace);
        const skillDirectories = await getSkillDirectories(sessionMode);

        const frameworkAlreadySet = !!workspace.framework;
        const wsDir = await readWorkspaceDir();
        const sessionConfig = buildSessionConfig(skillDirectories, sessionMode, workflow, frameworkAlreadySet, wsDir);

        // ---- Chunked PPTX generation path ----
        const chunkSize = parseInt(process.env.PPTX_CHUNK_SIZE || '0', 10);
        if (sessionMode === 'pptx' && chunkSize > 0 && workspace.slides.length > chunkSize && !workspace.pptxBuildError) {
          if (layoutSpecsPromise) await layoutSpecsPromise;
          if (slideAssetsPromise) await slideAssetsPromise;

          const groups = chunkSlides(workspace.slides, chunkSize);
          sendToWindow(win, 'chat:stream', {
            content: `\n🔀 Splitting ${workspace.slides.length} slides into ${groups.length} chunks for parallel generation...\n`,
          });

          const chunkResults = await generatePptxChunked(
            groups, message, history, workspace, sessionConfig, win,
          );

          sendToWindow(win, 'chat:stream', { content: '\n⚙️ Executing chunks and merging...\n' });

          const previewRoot = path.join(wsDir, 'previews');
          const outputPath = path.join(previewRoot, 'presentation-preview.pptx');
          await fs.mkdir(previewRoot, { recursive: true });
          await fs.unlink(outputPath).catch(() => {});

          try {
            const chunkReport = await executeChunkedPptxGeneration(chunkResults, workspace.theme, workspace.title, outputPath, {
              iconCollection: workspace.iconCollection,
              layoutSpecsJson,
              slideAssetsJson,
              templateMeta: workspace.templateMeta,
              includeImagesInLayout: workspace.includeImagesInLayout,
              onProgress: (progress) => sendToWindow(win, 'chat:chunk-progress', progress),
            });

            sendToWindow(win, 'chat:stream', {
              content: `\n✅ Verified: ${chunkReport.slideCount} slides, ${((chunkReport.fileSizeBytes ?? 0) / 1024).toFixed(0)} KB`
                + (chunkReport.warnings.length > 0 ? `\n⚠️ ${chunkReport.warnings.join('; ')}` : '') + '\n',
            });

            // Notify the renderer that the chunked PPTX is already generated and
            // merged.  The onDone handler must NOT re-execute via pptx:renderPreview
            // because the stitched code contains multiple build_presentation() calls
            // that would each overwrite the output, leaving only the last chunk.
            const stitchedCode = chunkResults
              .map((c) => c.code)
              .join('\n\n');
            sendToWindow(win, 'chat:chunked-pptx-ready', { code: stitchedCode });

            // Stream the stitched code for display in the chat history
            sendToWindow(win, 'chat:stream', { content: '\n\n```python\n' + stitchedCode + '\n```\n' });
            completeRequest();
            return;
          } catch (chunkExecErr) {
            // Chunk execution failed — fall through to LLM auto-fix session.
            // generated-source.py was already written by executeChunkedPptxGeneration
            // so rerun_pptx and the retry prompt can reference the failing code.
            const errMsg = chunkExecErr instanceof Error ? chunkExecErr.message : String(chunkExecErr);
            sendToWindow(win, 'chat:stream', {
              content: `\n⚠️ Chunked PPTX execution failed: ${errMsg}\n\n🔧 Attempting auto-fix via LLM...\n`,
            });

            // Read the failing generated-source.py so the LLM can make a surgical fix
            let failingCode = '';
            try {
              failingCode = await fs.readFile(path.join(previewRoot, 'generated-source.py'), 'utf-8');
            } catch { /* may not exist if generation itself failed */ }

            // Augment the prompt with error context so the single-shot LLM can fix it
            const autoFixParts = [
              '\n\n## Last PPTX Build Failure\n',
              'The previous generated python-pptx code failed to run. Apply a MINIMAL, targeted fix — only change the lines that caused the error. Output the full file but keep all working code unchanged. Do NOT redesign or regenerate slides that were not part of the failure.',
              errMsg,
            ];
            if (failingCode.trim()) {
              autoFixParts.push('\n### Previously Generated Code (fix only the broken parts)\n');
              autoFixParts.push('```python');
              autoFixParts.push(failingCode);
              autoFixParts.push('```');
            }
            prompt = prompt + autoFixParts.join('\n');
            // Fall through to single-shot LLM path below for auto-fix
          }
        }

        // ---- Single-shot path (unchanged) ----
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
