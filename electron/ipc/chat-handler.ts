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
import { readdirSync, existsSync as fsExistsSync } from 'fs';
import path from 'path';
import { app } from 'electron';
import { onSettingsSaved } from './settings-handler.ts';
import { CopilotClient, defineTool, approveAll } from '@github/copilot-sdk';
import type { SessionConfig } from '@github/copilot-sdk';
import { getCopilotClient, getSessionOptions, resetCopilotClient, resolveWorkflowInstructionPath } from './copilot-runtime.ts';
import type { ThemeTokens } from '../../src/domain/entities/palette';
import type {
  SlideItem,
  DesignBrief,
  FrameworkType,
  ScenarioPayload,
  SlideUpdatePayload,
} from '../../src/domain/entities/slide-work';
import type { DataFile, ScrapeResult } from '../../src/domain/ports/ipc';
import { getAvailableIconChoices } from '../../src/domain/icons/iconify';
import type { IconifyCollectionId } from '../../src/domain/icons/iconify';
import { formatWorkflowForPrompt, getWorkflowConfig, type WorkflowConfig } from '../../src/domain/workflows/workflow-config';
import { executeGeneratedPythonCodeToFile, formatExecutionFailure, computeLayoutSpecs } from './pptx-handler.ts';
import { readWorkspaceDir } from './workspace-utils.ts';

const CHAT_REQUEST_TIMEOUT_MS = 10 * 60 * 1000;

/** Read all cached icon filenames from the local PNG cache directory. */
function readCachedIconNames(collectionId: string): string[] {
  let cacheRoot = path.join(app.getAppPath(), 'skills', 'iconfy-list', 'cache');
  if (!fsExistsSync(cacheRoot)) {
    cacheRoot = path.join(process.cwd(), 'skills', 'iconfy-list', 'cache');
  }
  const collections = collectionId === 'all'
    ? ['mdi', 'lucide', 'tabler', 'ph', 'fa6-solid', 'fluent']
    : [collectionId];
  const names: string[] = [];
  for (const col of collections) {
    const dir = path.join(cacheRoot, col);
    if (!fsExistsSync(dir)) continue;
    try {
      for (const file of readdirSync(dir)) {
        if (file.endsWith('.png')) names.push(`${col}:${file.slice(0, -4)}`);
      }
    } catch { /* ignore */ }
  }
  return names;
}

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
  designStyle: import('../../src/domain/entities/slide-work').DesignStyle | null;
  framework: FrameworkType | null;
  pptxBuildError: string | null;
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
  const skillsRoot = path.join(app.getAppPath(), 'skills');
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
  const stylesPath = path.join(app.getAppPath(), 'skills', 'pptx-design-styles', 'references', 'styles.md');
  let content: string;
  try {
    content = await fs.readFile(stylesPath, 'utf-8');
  } catch {
    // Fall back to cwd in dev mode
    try {
      content = await fs.readFile(path.join(process.cwd(), 'skills', 'pptx-design-styles', 'references', 'styles.md'), 'utf-8');
    } catch {
      return null;
    }
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

/** Sample N evenly-spaced icon names from the full list for prompt brevity. */
function sampleIconNames(names: string[], count: number): string[] {
  if (names.length <= count) return names;
  const step = names.length / count;
  const sampled: string[] = [];
  for (let i = 0; i < count; i++) {
    sampled.push(names[Math.floor(i * step)]);
  }
  return sampled;
}

async function formatFileSource(ds: DataFile): Promise<string[]> {
  const parts = [`- **${ds.name}** (${ds.type.toUpperCase()}): ${ds.summary}`];
  if (ds.consumed) {
    parts.push(`  Parsed source file: ${ds.consumed.markdownPath}`);
    const markdown = await readArtifactMarkdown(ds.consumed, 20_000);
    if (markdown) {
      parts.push('  Parsed content:');
      parts.push('```md');
      parts.push(markdown);
      parts.push('```');
    } else {
      parts.push(`  Summary file: ${ds.consumed.summaryPath}`);
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

async function formatUrlSource(entry: WorkspaceContext['urlSources'][number]): Promise<string[]> {
  const parts = [`- **${entry.url}** (${entry.status})`];
  if (entry.result?.error) {
    parts.push(`  Error: ${entry.result.error}`);
    return parts;
  }
  if (entry.result?.consumed) {
    parts.push(`  Parsed source file: ${entry.result.consumed.markdownPath}`);
    const markdown = await readArtifactMarkdown(entry.result.consumed, 20_000);
    if (markdown) {
      parts.push('  Parsed content:');
      parts.push('```md');
      parts.push(markdown);
      parts.push('```');
    } else {
      parts.push(`  Summary file: ${entry.result.consumed.summaryPath}`);
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
    if (workspace.designStyle) parts.push(`Design style: ${workspace.designStyle}`);
    if (workspace.slides.length > 0) {
      parts.push(`Slides: ${workspace.slides.length}`);
      for (const s of workspace.slides) {
        const imgParts: string[] = [];
        const selectedImages = s.selectedImages ?? [];
        const primaryImage = selectedImages[0] ?? null;
        const primaryImagePath = primaryImage?.imagePath ?? s.imagePath ?? null;

        if (primaryImagePath) imgParts.push(`imagePath: ${primaryImagePath}`);
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

  // Data sources
  if (workspace.dataSources.length > 0) {
    parts.push('## Available File Data Sources\n');
    for (const ds of workspace.dataSources) {
      parts.push(...await formatFileSource(ds));
    }
    parts.push('');
  }

  if (workspace.urlSources.length > 0) {
    parts.push('## Available URL Sources\n');
    for (const entry of workspace.urlSources) {
      parts.push(...await formatUrlSource(entry));
    }
    parts.push('');
  }

  if (workspace.theme) {
    parts.push('## Active Theme Palette\n');
    parts.push(`Theme name: ${workspace.theme.name}`);
    const slots = workspace.theme.slots;
    parts.push(`OOXML slots: dk1=#${slots.dk1}, lt1=#${slots.lt1}, dk2=#${slots.dk2}, lt2=#${slots.lt2}, accent1=#${slots.accent1}, accent2=#${slots.accent2}, accent3=#${slots.accent3}, accent4=#${slots.accent4}, accent5=#${slots.accent5}, accent6=#${slots.accent6}, hlink=#${slots.hlink}, folHlink=#${slots.folHlink}`);
    parts.push(`Semantic colors: PRIMARY=#${workspace.theme.C.PRIMARY}, SECONDARY=#${workspace.theme.C.SECONDARY}, BG=#${workspace.theme.C.BG}, TEXT=#${workspace.theme.C.TEXT}, ACCENT3=#${workspace.theme.C.ACCENT3}, ACCENT4=#${workspace.theme.C.ACCENT4}, ACCENT5=#${workspace.theme.C.ACCENT5}, ACCENT6=#${workspace.theme.C.ACCENT6}`);
    if (workspace.theme.colors.length > 0) {
      parts.push(`Palette colors: ${workspace.theme.colors.slice(0, 20).map((color) => `${color.name} ${color.hex}`).join(' | ')}`);
    }
    parts.push('Use the OOXML slot hex values as color constants in python-pptx code when generating slides.');
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
      parts.push('### Style Spec\n');
      parts.push(styleBlock);
    } else {
      parts.push('If the pptx-design-styles skill is available, use it for style details.');
    }
    parts.push('');
  }

  {
    const cachedIcons = readCachedIconNames('all');
    if (cachedIcons.length > 0) {
      parts.push('## Available Icons (locally cached)\n');
      parts.push(`Icon provider: ${workspace.iconProvider}`);
      parts.push(`Preferred icon set: ${workspace.iconCollection}`);
      parts.push(`Total icons available: ${cachedIcons.length}`);
      parts.push('ONLY use icon names from the exact list below — do NOT invent or guess icon names. fetch_icon() will return None for any name not in this list.');
      parts.push(cachedIcons.join(', '));
      parts.push('');
    }
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
  // Reset the Copilot client singleton whenever the user saves new settings
  // so the next chat:send picks up the updated token / endpoint.
  onSettingsSaved(() => { resetCopilotClient(); });

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
      const prompt = await buildPrompt(message, history, workspace, mode);

      // Pre-compute content-adaptive layout specs for PPTX generation workflows.
      // Uses PowerPoint COM AutoFit + kiwisolver constraint solver to produce
      // pixel-perfect coordinates injected into the Python runner env.
      let layoutSpecsJson: string | undefined;
      const workflow = resolveWorkflow(message, workspace);
      if (mode === 'pptx' && workspace.slides.length > 0) {
        try {
          const slidesInput = workspace.slides.map((s) => ({
            layout_type: s.layout,
            title_text: s.title,
            key_message_text: s.keyMessage,
            bullets: s.bullets,
            notes: s.notes || '',
            item_count: s.bullets.length,
            has_icon: !!s.icon,
            font_family: 'Calibri',
          }));
          const result = await computeLayoutSpecs(JSON.stringify(slidesInput));
          if (result.success && result.specs) {
            layoutSpecsJson = result.specs;
          }
        } catch (err) {
          console.log('[chat] Layout spec pre-computation failed (non-blocking):', err);
        }
      }

      let session: Awaited<ReturnType<CopilotClient['createSession']>> | null = null;
      let requestSettled = false;
      let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

      const clearRequestTimeout = () => {
        if (!timeoutHandle) return;
        clearTimeout(timeoutHandle);
        timeoutHandle = null;
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
            void session.disconnect().catch(() => {});
          }
        },
      };

      // Tool factories (close over win for IPC emission)
      const scenarioTool = defineTool('set_scenario', {
      description:
        'Set the slide scenario (outline) for the presentation workspace panel. ' +
        'Each slide must have a keyMessage (the "so what" / key takeaway), a layout hint, and optionally an icon hint. ' +
        'You may also include imageQuery when supporting images should later be searched for and selected on the slide. ' +
        'Available layouts: title, agenda, section, bullets, cards, stats, comparison, timeline, diagram, summary. ' +
        'The layout and icon are guidance for the later PPTX design step, not a rigid rendering contract. ' +
        'When helpful, include a designBrief describing tone, audience, visual style, density, and layout approach. ' +
        `Use Iconify icon IDs for icons. Supported examples and aliases: ${getAvailableIconChoices(workspace.iconCollection).join(', ')}.`,
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
        return { success: true, message: `Scenario "${args.title}" set with ${args.slides.length} slides.` };
      },
    });

      const updateSlideTool = defineTool('update_slide', {
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
    });

      // ---------- PPTX layout infrastructure tools ----------

      /** Resolve a scripts/*.py path safely (whitelist only). */
      const resolveInfraFile = (file: string): string | null => {
        const allowed: Record<string, string> = {
          layout_specs: 'layout_specs.py',
          layout_validator: 'layout_validator.py',
        };
        const basename = allowed[file];
        if (!basename) return null;
        const candidate = path.join(app.getAppPath(), 'scripts', 'layout', basename);
        if (fsExistsSync(candidate)) return candidate;
        return path.join(process.cwd(), 'scripts', 'layout', basename);
      };

      const patchLayoutInfrastructureTool = defineTool('patch_layout_infrastructure', {
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
      });

      const rerunPptxTool = defineTool('rerun_pptx', {
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
            await fs.unlink(outputPath).catch(() => {});

            await executeGeneratedPythonCodeToFile(code, theme, title, outputPath, {
              iconCollection: workspace.iconCollection,
              layoutSpecsJson,
            });

            return { success: true, message: 'PPTX re-generated successfully. Layout validation passed.' };
          } catch (err) {
            return { success: false, error: formatExecutionFailure(err) };
          }
        },
      });

      const suggestFrameworkTool = defineTool('suggest_framework', {
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
    });

      const buildSessionConfig = (
        opts: Partial<SessionConfig>,
        skillDirectories: string[],
        mode: SessionMode,
        workflow: WorkflowConfig | null,
        frameworkAlreadySet: boolean,
        workspaceAbsPath: string,
      ): SessionConfig => {
        const workflowDirective = workflow?.agentDirective ?? '';
        const pptxSystemMessage = [
          workflowDirective,
          'You are a PPTX code generation specialist.',
          'Always respond in the same language as the user.',
          'Use the current workspace slides, theme, data sources, and grounded image paths as the source of truth.',
          'The layout validator runs automatically after generation and catches overlap, out-of-bounds, and text-overflow issues. If validation fails, use patch_layout_infrastructure to fix layout_specs.py or layout_validator.py, then call rerun_pptx.',
          'Ensure contrast safety in the composition: avoid white-on-white, dark-on-dark, and mid-tone-on-mid-tone combinations. Add overlay panels when placing text over images.',
          'CRITICAL LAYOUT RULE: Never use literal float coordinates for positioning.',
          'Every x, y, w, h must reference a spec.* field from get_layout_spec() or be computed relative to one (e.g., spec.content_rect.y + idx * row_h).',
          'Use get_layout_spec(layout_type) from the runtime namespace for element positioning.',
          'For slides with title, key message, and body content, call flow_layout_spec(...) first so ALL zones (content, hero, chips, footer, sidebar) cascade when title text wraps.',
          'Available sub-zone rects: spec.hero_rect, spec.chips_rect, spec.footer_rect, spec.sidebar_rect — use these instead of hardcoding values like hero_y=1.20 or chip_y=4.85.',
          'Always enable MSO_AUTO_SIZE.TEXT_TO_FIT_SHAPE on text frames.',
          'There is no runtime geometry repair pass anymore, so the generated code must be overlap-safe on its own: reserve notes/footer space, reduce or split content instead of crowding, keep aligned layouts aligned, and proactively use estimate_text_height_in() to size every paragraph-bearing box before placement.',
          'If estimated text height consumes most of a box, the box is too small or the slide is too dense — use fewer boxes or split the slide.',
          'For image consistency, treat slide.imagePath as the primary approved preview image and use that same image in the exported PPTX whenever it is present.',
          'CRITICAL IMAGE RULE: When a slide has multiple images listed (image[0], image[1], …), use ALL of them in the slide composition — create a multi-image layout (e.g. side-by-side, grid, or collage) rather than picking just one. Each image must have its own safe_add_picture() call with non-overlapping coordinates.',
          'CRITICAL ICON RULE: Every slide MUST call fetch_icon() at least once to add a visual icon. fetch_icon(name, color_hex) is pre-injected in the execution namespace — do NOT redefine it. Place the icon using spec.icon_rect if available, otherwise in the upper-right area. A deck without icons is a wall of text and is not acceptable. ONLY use icon names from the Available Icons list in the prompt context — do NOT invent or guess icon names. If an icon name is not in the list, fetch_icon() returns None and the slide will have no icon.',
          'Focus only on producing a valid Python code block that uses python-pptx.',
          'FORMAT RULE: Return exactly one fenced code block. The opening fence must be exactly ```python on its own line, followed by a newline. Do not put any extra text on the fence line.',
          'FORMAT RULE: Preserve normal Python newlines and indentation. Do not compress multiple imports, defs, classes, or statements onto one line.',
          'Do not suggest frameworks.',
          'Do not call set_scenario.',
          'Do not call update_slide.',
          'Do not narrate status.',
          'Output only the final python code block.',
          'Use the runtime variables OUTPUT_PATH, PPTX_TITLE, and PPTX_THEME.',
          'PRECOMPUTED_LAYOUT_SPECS is a list of LayoutSpec objects (one per slide) computed by the hybrid layout engine using PowerPoint COM AutoFit + constraint solver. When available (not None), use PRECOMPUTED_LAYOUT_SPECS[slide_index] instead of calling get_layout_spec() or flow_layout_spec(). This gives pixel-perfect coordinates based on actual text measurements.',
          `WORKSPACE_DIR and IMAGES_DIR are pre-set absolute paths at runtime. WORKSPACE_DIR = "${workspaceAbsPath.replace(/\\/g, '\\\\')}", IMAGES_DIR = "${path.join(workspaceAbsPath, 'images').replace(/\\/g, '\\\\')}". When referencing slide images, use os.path.join(IMAGES_DIR, filename). ICON_CACHE_DIR is also pre-set — use fetch_icon() to load icons, do NOT construct icon paths manually.`,
          'FONT RULE: For non-English text (Japanese, Korean, Chinese, Thai, Arabic, etc.), use resolve_font(text, base_font) to select the correct Noto Sans variant. Example: run.font.name = resolve_font(slide_title, "Calibri"). ',
          'Never hardcode Yu Mincho or other CJK-specific fonts — resolve_font() handles script detection automatically. Noto Sans fonts are auto-downloaded if not installed.',
          'Prefer defining build_presentation(output_path, theme, title), and save the deck to output_path.',
          'LAYOUT FIX TOOLS: When layout validation fails with ERROR-level issues (overlap, text overflow, out-of-bounds), use patch_layout_infrastructure to read and patch layout_specs.py or layout_validator.py, then call rerun_pptx to re-execute the same code. This avoids regenerating the entire code block. Read the file first to understand the current values, then patch the specific dimension or threshold causing the error.',
        ].filter(Boolean).join(' ');

        const storyFrameworkInstruction = frameworkAlreadySet
          ? 'IMPORTANT: The user has already chosen a business framework — it is shown in the Current Workspace section. Apply it directly. Do NOT ask the user to choose a framework again or list framework options.'
          : 'When creating a presentation outline, the business framework is defined by the user. If the user has already specified a framework, apply it directly. If not, present the available options using suggest_framework and ask the user to choose before calling set_scenario.';

        const storySystemMessage = [
          workflowDirective,
          'You are an expert presentation designer and business consultant that helps create professional PowerPoint decks.',
          'Always respond in the same language as the user.',
          'Use the provided file contents, scraped URL contents, active theme palette, available icons, and any selectedImages already attached to slides as grounding context for slide creation and PPTX generation.',
          storyFrameworkInstruction,
          'Do not generate python-pptx code during prestaging or brainstorming workflows.',
          'Use the slide panel as the destination for preliminary content creation so the user can refine slides and attach images before PPTX generation.',
          'When generating PPTX later, treat slide layout and icon values as hints rather than rigid instructions, and choose a stronger visual composition when it communicates the approved story better.',
          'For image consistency, treat slide.imagePath as the primary approved preview image and use that same image in the exported PPTX whenever it is present.',
          'When a slide has multiple images listed (image[0], image[1], …), use ALL of them in the slide composition — create a multi-image layout (e.g. side-by-side, grid, or collage) rather than picking just one.',
          'When updating a single slide, use update_slide.',
          'Never output slide listings in the chat message itself.',
          'Keep chat messages short — action summaries only.',
          'Use strong action-title headlines for every slide.',
        ].filter(Boolean).join(' ');

        return {
          ...opts,
          tools: mode === 'pptx'
            ? [patchLayoutInfrastructureTool, rerunPptxTool]
            : frameworkAlreadySet
              ? [scenarioTool, updateSlideTool]
              : [scenarioTool, updateSlideTool, suggestFrameworkTool],
          skillDirectories,
          systemMessage: {
            mode: 'append' as const,
            content: mode === 'pptx' ? pptxSystemMessage : storySystemMessage,
          },
          onPermissionRequest: approveAll,
        };
      };

      const wireSession = (s: typeof session) => {
        s!.on('assistant.reasoning_delta', (event) => {
          const delta = event.data?.deltaContent ?? '';
          if (delta) sendToWindow(win, 'chat:stream', { thinking: delta });
        });
        s!.on('assistant.message_delta', (event) => {
          const delta = event.data?.deltaContent ?? '';
          if (delta) sendToWindow(win, 'chat:stream', { content: delta });
        });
        s!.on('session.error', (event) => {
          const msg = event.data?.message ?? 'Unknown error';
          failRequest(msg);
        });
      };

      try {
        const copilot = await getCopilotClient();
        const sessionOpts = await getSessionOptions({ streaming: true });
        const workflow = resolveWorkflow(message, workspace);
        const sessionMode: SessionMode = resolveSessionMode(message, workspace);
        const skillDirectories = await getSkillDirectories(sessionMode);

        const frameworkAlreadySet = !!workspace.framework;
        const wsDir = await readWorkspaceDir();
        session = await copilot.createSession(buildSessionConfig(sessionOpts, skillDirectories, sessionMode, workflow, frameworkAlreadySet, wsDir));
        wireSession(session);

        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(() => {
            if (session) {
              void session.disconnect().catch(() => {});
            }
            reject(new Error(`Generation timed out after ${Math.round(CHAT_REQUEST_TIMEOUT_MS / 60000)} minutes. Try a simpler prompt or run the request again.`));
          }, CHAT_REQUEST_TIMEOUT_MS);
        });

        await Promise.race([
          session.sendAndWait({ prompt }, 600_000),
          timeoutPromise,
        ]);

        completeRequest();
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        failRequest(msg);
      } finally {
        clearRequestTimeout();
        activeChatRequest = null;
        if (session) await session.disconnect().catch(() => {});
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
