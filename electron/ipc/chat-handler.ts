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
  TemplateMeta,
  ScenarioPayload,
  SlideUpdatePayload,
} from '../../src/domain/entities/slide-work';
import type { DataFile, ScrapeResult } from '../../src/domain/ports/ipc';
import { getIconifyCollectionById } from '../../src/domain/icons/iconify';
import type { IconifyCollectionId } from '../../src/domain/icons/iconify';
import { formatWorkflowForPrompt, getWorkflowConfig, type WorkflowConfig } from '../../src/domain/workflows/workflow-config';
import { executeGeneratedPythonCodeToFile, formatExecutionFailure, computeLayoutSpecs, persistLayoutInputToWorkspace, persistSlideAssetsToWorkspace } from './pptx-handler.ts';
import { buildManagedSystemPrompt } from './system-prompts.ts';
import { readWorkspaceDir, resolveBundledPath } from './workspace-utils.ts';

const CHAT_REQUEST_TIMEOUT_MS = 10 * 60 * 1000;

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
  templateMeta: TemplateMeta | null;
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
    parts.push('Use the OOXML slot hex values as color constants in python-pptx code when generating slides. Readability is mandatory: use theme colors first, and when text sits on any colored or image background, call ensure_contrast(fg_hex, bg_hex). If style conflicts with readability, readability wins.');
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
      let layoutSpecsPromise: Promise<void> | null = null;
      let slideAssetsPromise: Promise<void> | null = null;
      const workflow = resolveWorkflow(message, workspace);
      if (mode === 'pptx' && workspace.slides.length > 0) {
        layoutSpecsPromise = computeLayoutSpecs(workspace.slides)
          .then((result) => {
            if (result.success && result.specs) layoutSpecsJson = result.specs;
          })
          .catch((err) => {
            console.log('[chat] Layout spec pre-computation failed (non-blocking):', err);
          });
        slideAssetsPromise = persistSlideAssetsToWorkspace(workspace.slides, workspace.iconCollection)
          .then((result) => {
            if (!result.success) {
              console.log('[chat] Slide asset persistence failed (non-blocking):', result.error);
            }
          })
          .catch((err) => {
            console.log('[chat] Slide asset persistence failed (non-blocking):', err);
          });
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
            void session.disconnect().catch(() => { });
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
          // Fire-and-forget: persist layout input for later use without blocking the LLM
          computeLayoutSpecs(args.slides).catch((err) => {
            console.log('[chat] Failed to compute layout specs for storyboard (non-blocking):', err);
          });
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
        return resolveBundledPath('scripts', 'layout', basename);
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
        const storyFrameworkInstruction = frameworkAlreadySet
          ? 'IMPORTANT: The user has already chosen a business framework — it is shown in the Current Workspace section. Apply it directly. Do NOT ask the user to choose a framework again or list framework options.'
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
              void session.disconnect().catch(() => { });
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
