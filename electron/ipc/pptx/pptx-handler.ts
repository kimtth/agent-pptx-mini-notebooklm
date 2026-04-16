import { ipcMain, dialog, BrowserWindow, shell } from 'electron'
import fs from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import type { ThemeTokens } from '../../../src/domain/entities/palette'
import type { TemplateMeta } from '../../../src/domain/entities/slide-work'
import { DEFAULT_THEME_C } from '../../../src/domain/theme/default-theme'
import { enforceIconCollection } from '../../../src/domain/icons/iconify'
import type { IconifyCollectionId } from '../../../src/domain/icons/iconify'
import { ensurePythonModule, pythonSetupHint, resolvePythonExecutable } from './python-runtime.ts'
import { readWorkspaceDir, resolveBundledPath } from '../project/workspace-utils.ts'

const execFileAsync = promisify(execFile)
let powerPointAutomationChain: Promise<void> = Promise.resolve()

function queuePowerPointAutomation<T>(task: () => Promise<T>): Promise<T> {
  const nextTask = powerPointAutomationChain.catch(() => undefined).then(task)
  powerPointAutomationChain = nextTask.then(() => undefined, () => undefined)
  return nextTask
}

function resolveThemeFontFamily(theme: ThemeTokens | null | undefined): string {
  const fontFamily = theme?.fontFamily?.trim()
  return fontFamily && fontFamily.length > 0 ? fontFamily : 'Calibri'
}

function resolveThemeColorTreatment(theme: ThemeTokens | null | undefined): 'solid' | 'gradient' | 'mixed' {
  const v = theme?.colorTreatment
  return v === 'solid' || v === 'gradient' || v === 'mixed' ? v : 'mixed'
}

function resolveThemeTextBoxStyle(theme: ThemeTokens | null | undefined): 'plain' | 'with-icons' | 'mixed' {
  const v = theme?.textBoxStyle
  return v === 'plain' || v === 'with-icons' || v === 'mixed' ? v : 'mixed'
}

function resolveThemeTextBoxCornerStyle(theme: ThemeTokens | null | undefined): 'square' | 'rounded' {
  const v = theme?.textBoxCornerStyle
  return v === 'rounded' ? v : 'square'
}

function resolveThemeShowSlideIcons(theme: ThemeTokens | null | undefined): string {
  return theme?.showSlideIcons === false ? '0' : '1'
}

function applyLayoutFontFamily(slides: LayoutInputSlide[], fontFamily?: string): LayoutInputSlide[] {
  const effectiveFontFamily = fontFamily?.trim() || 'Calibri'
  return slides.map((slide) => ({
    ...slide,
    font_family: slide.font_family?.trim() || effectiveFontFamily,
  }))
}

function normalizeLayoutSlides(
  slides: LayoutInputSourceSlide[] | string,
  fontFamily?: string,
): string {
  if (typeof slides !== 'string') {
    return JSON.stringify(buildLayoutInputSlides(slides, fontFamily), null, 2)
  }

  const parsed = JSON.parse(slides) as unknown
  if (!Array.isArray(parsed)) {
    throw new Error('Layout input must be a top-level array of slide entries.')
  }
  return JSON.stringify(applyLayoutFontFamily(parsed as LayoutInputSlide[], fontFamily), null, 2)
}

// ---------------------------------------------------------------------------
// Completion report — structured JSON emitted by Python scripts to stdout
// ---------------------------------------------------------------------------

export interface PptxQaReport {
  contrastFixes: number
  missingIcons: Array<{ icon: string; reason: string }>
  iconStats: { requested: number; missing: number; missingRatio: number }
  missingImages: string[]
  layoutIssues: Array<{ slide: number; type: string; severity: string; message: string }>
}

export interface PptxCompletionReport {
  status: 'success' | 'warning' | 'error'
  outputPath?: string
  fileExists?: boolean
  slideCount: number
  fileSizeBytes?: number
  partialCount?: number
  warnings: string[]
  error?: string
  qa?: PptxQaReport
}



function parsePptxCompletionReport(stdout: string | undefined): PptxCompletionReport | null {
  if (!stdout?.trim()) return null
  // The JSON report is the last non-empty line (other stdout may precede it)
  const lines = stdout.trim().split('\n').filter((l) => l.trim())
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    if (line.startsWith('{') && line.endsWith('}')) {
      try {
        return JSON.parse(line) as PptxCompletionReport
      } catch { /* not valid JSON, keep looking */ }
    }
  }
  return null
}

/**
 * Verify a completion report indicates true success.
 * Throws a descriptive Error when the report is missing or indicates failure.
 */
function assertCompletionSuccess(
  report: PptxCompletionReport | null,
  context: string,
  expectedSlides?: number,
): void {
  if (!report) {
    throw new Error(`${context}: No completion report received from Python. The script may have crashed before writing output.`)
  }
  if (report.status === 'error') {
    throw new Error(`${context}: ${report.error ?? 'Unknown error'}`)
  }
  if (!report.fileExists) {
    throw new Error(`${context}: Output file was not created at ${report.outputPath ?? 'unknown path'}`)
  }
  if (report.slideCount === 0) {
    throw new Error(`${context}: Output PPTX contains 0 slides`)
  }
  if (expectedSlides && expectedSlides > 0 && report.slideCount !== expectedSlides) {
    throw new Error(
      `${context}: Slide count mismatch — expected ${expectedSlides} but got ${report.slideCount}`,
    )
  }
}

type LayoutInputSourceSlide = {
  layout: string
  title: string
  keyMessage: string
  bullets: string[]
  notes: string
  icon?: string | null
  imagePath?: string | null
  selectedImages?: Array<{
    imagePath?: string | null
  }>
}

export interface LayoutInputSlide {
  layout_type: string
  title_text: string
  key_message_text: string
  bullets: string[]
  chip_labels: string[]
  footer_text: string
  notes: string
  item_count: number
  has_icon: boolean
  has_hero_image: boolean
  font_family: string
}

function hasApprovedImage(slide: LayoutInputSourceSlide): boolean {
  if (typeof slide.imagePath === 'string' && slide.imagePath.trim().length > 0) {
    return true
  }
  return (slide.selectedImages ?? []).some(
    (image) => typeof image.imagePath === 'string' && image.imagePath.trim().length > 0,
  )
}

type SlideAssetSourceSlide = {
  number: number
  title: string
  layout: string
  keyMessage?: string
  bullets?: string[]
  notes?: string
  icon?: string | null
  imageQuery?: string | null
  imageQueries?: string[]
  imagePath?: string | null
  selectedImages?: Array<{
    id: string
    imageQuery?: string | null
    imageUrl?: string | null
    imagePath?: string | null
    thumbnailUrl?: string | null
  }>
}

export interface SlideAssetMetadata {
  number: number
  title: string
  layout: string
  icon: string | null
  iconName: string | null
  iconCollection: string
  iconProvider: 'iconify'
  imageQuery: string | null
  imageQueries: string[]
  primaryImagePath: string | null
  selectedImages: Array<{
    id: string
    imageQuery: string | null
    imageUrl: string | null
    imagePath: string | null
    thumbnailUrl: string | null
  }>
}

function truncateProcessOutput(value: string, maxLen = 12000): string {
  const trimmed = value.trim()
  if (trimmed.length <= maxLen) return trimmed
  return `${trimmed.slice(0, maxLen)}\n\n[Truncated]`
}

export function formatExecutionFailure(error: unknown): string {
  if (!(error instanceof Error)) return 'PPTX code execution failed'

  const processError = error as Error & { stdout?: string; stderr?: string }
  const details = [processError.message]
  if (processError.stdout?.trim()) details.push(`Build output:\n${truncateProcessOutput(processError.stdout)}`)
  if (processError.stderr?.trim()) details.push(`Error output:\n${truncateProcessOutput(processError.stderr)}`)
  return details.join('\n\n')
}

function sanitizeWindowsFilenameStem(value: string, fallback: string): string {
  const cleaned = (value || fallback)
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, '-')
    .trim()
    .replace(/[. ]+$/g, '')

  return cleaned.length > 0 ? cleaned : fallback
}

async function savePresentationFile(filePath: string, title: string, win: BrowserWindow | null) {
  const safeTitle = sanitizeWindowsFilenameStem(title, 'presentation')
  const dialogOptions = {
    title: 'Save Presentation',
    defaultPath: `${safeTitle}.pptx`,
    filters: [{ name: 'PowerPoint', extensions: ['pptx'] }],
  }

  const { filePath: outputPath, canceled } = win
    ? await dialog.showSaveDialog(win, dialogOptions)
    : await dialog.showSaveDialog(dialogOptions)

  if (canceled || !outputPath) {
    return { success: false, error: 'Cancelled' }
  }

  await fs.copyFile(filePath, outputPath)
  return { success: true, path: outputPath }
}

async function removePreviewImages(dirPath: string): Promise<void> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isFile() && /\.(png|jpg|jpeg)$/i.test(entry.name)) {
        await fs.unlink(path.join(dirPath, entry.name)).catch(() => {})
      }
    }
  } catch { /* ignore */ }
}

/** Remove old timestamped PPTX copies so only the canonical file exists. */
async function removeStaleTimestampedPptx(dirPath: string, canonicalName: string): Promise<void> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true })
    const stem = canonicalName.replace(/\.pptx$/i, '')
    for (const entry of entries) {
      if (
        entry.isFile() &&
        /\.pptx$/i.test(entry.name) &&
        entry.name !== canonicalName &&
        entry.name.startsWith(stem)
      ) {
        await fs.unlink(path.join(dirPath, entry.name)).catch(() => {})
      }
    }
  } catch { /* ignore */ }
}

function buildLayoutArtifactPaths(workspaceDir: string) {
  const layoutDir = path.join(workspaceDir, 'previews')
  return {
    layoutDir,
    inputPath: path.join(layoutDir, 'layout-input.json'),
    outputPath: path.join(layoutDir, 'layout-specs.json'),
    slideAssetsPath: path.join(layoutDir, 'slide-assets.json'),
  }
}

async function clearWorkspaceArtifactsInternal(): Promise<void> {
  const workspaceDir = await readWorkspaceDir()
  const { layoutDir, inputPath, outputPath, slideAssetsPath } = buildLayoutArtifactPaths(workspaceDir)

  await Promise.all([
    fs.unlink(inputPath).catch(() => {}),
    fs.unlink(outputPath).catch(() => {}),
    fs.unlink(slideAssetsPath).catch(() => {}),
    fs.unlink(path.join(layoutDir, 'layout-meta.json')).catch(() => {}),
    fs.unlink(path.join(layoutDir, 'notebooklm-infographics.json')).catch(() => {}),
    fs.rm(path.join(layoutDir, 'charts'), { recursive: true, force: true }).catch(() => {}),
  ])

  try {
    const entries = await fs.readdir(layoutDir, { withFileTypes: true })
    await Promise.all(entries.map(async (entry) => {
      if (!entry.isFile()) return

      const fullPath = path.join(layoutDir, entry.name)

      if (/^presentation-preview(?:-\d+)?\.pptx$/i.test(entry.name)) {
        await fs.unlink(fullPath).catch(() => {})
        return
      }

      if (/\.(png|jpg|jpeg|json|py)$/i.test(entry.name)) {
        await fs.unlink(fullPath).catch(() => {})
      }
    }))
  } catch {
    // ignore missing previews directory
  }
}

async function assertValidLayoutInputArtifact(workspaceDir: string): Promise<void> {
  const { inputPath } = buildLayoutArtifactPaths(workspaceDir)

  let raw: string
  try {
    raw = await fs.readFile(inputPath, 'utf-8')
  } catch {
    throw new Error(
      `Required layout input file not found: ${inputPath}. Regenerate the storyboard before PPTX generation.`,
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown JSON parse error'
    throw new Error(`Invalid layout input JSON at ${inputPath}: ${message}`)
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`Invalid layout input JSON at ${inputPath}: expected a top-level array of slide layout entries.`)
  }
}

export function buildLayoutInputSlides(slides: LayoutInputSourceSlide[], fontFamily?: string): LayoutInputSlide[] {
  const effectiveFontFamily = fontFamily?.trim() || 'Calibri'
  return slides.map((slide) => ({
    layout_type: slide.layout,
    title_text: slide.title,
    key_message_text: slide.keyMessage,
    bullets: slide.bullets,
    chip_labels: slide.layout === 'title' ? slide.bullets : [],
    footer_text: '',
    notes: slide.notes || '',
    item_count: slide.bullets.length,
    has_icon: !!slide.icon,
    has_hero_image: hasApprovedImage(slide),
    font_family: effectiveFontFamily,
  }))
}

export async function persistLayoutInputToWorkspace(
  slides: LayoutInputSourceSlide[] | string,
  fontFamily?: string,
): Promise<{ success: boolean; slidesJson?: string; inputPath?: string; outputPath?: string; error?: string }> {
  try {
    const workspaceDir = await readWorkspaceDir()
    const { layoutDir, inputPath, outputPath } = buildLayoutArtifactPaths(workspaceDir)
    await fs.mkdir(layoutDir, { recursive: true })

    const slidesJson = normalizeLayoutSlides(slides, fontFamily)

    await fs.writeFile(inputPath, slidesJson, 'utf-8')
    return { success: true, slidesJson, inputPath, outputPath }
  } catch (err) {
    return { success: false, error: formatExecutionFailure(err) }
  }
}

export function buildSlideAssetMetadata(slides: SlideAssetSourceSlide[], iconCollection: string): SlideAssetMetadata[] {
  return slides.map((slide) => {
    const selectedImages = (slide.selectedImages ?? []).map((image) => ({
      id: image.id,
      imageQuery: image.imageQuery ?? null,
      imageUrl: image.imageUrl ?? null,
      imagePath: image.imagePath ?? null,
      thumbnailUrl: image.thumbnailUrl ?? null,
    }))

    const enforcedIcon = enforceIconCollection(slide.icon, iconCollection as IconifyCollectionId)

    return {
      number: slide.number,
      title: slide.title,
      layout: slide.layout,
      icon: enforcedIcon,
      iconName: enforcedIcon,
      iconCollection,
      iconProvider: 'iconify',
      imageQuery: slide.imageQuery ?? null,
      imageQueries: (slide.imageQueries ?? []).map((query) => query.trim()).filter(Boolean),
      primaryImagePath: selectedImages[0]?.imagePath ?? slide.imagePath ?? null,
      selectedImages,
    }
  })
}

export async function persistSlideAssetsToWorkspace(
  slides: SlideAssetSourceSlide[],
  iconCollection: string,
): Promise<{ success: boolean; slideAssetsJson?: string; assetPath?: string; error?: string }> {
  try {
    const workspaceDir = await readWorkspaceDir()
    const { layoutDir, slideAssetsPath } = buildLayoutArtifactPaths(workspaceDir)
    await fs.mkdir(layoutDir, { recursive: true })

    const slideAssetsJson = JSON.stringify(buildSlideAssetMetadata(slides, iconCollection), null, 2)
    await fs.writeFile(slideAssetsPath, slideAssetsJson, 'utf-8')
    return { success: true, slideAssetsJson, assetPath: slideAssetsPath }
  } catch (err) {
    return { success: false, error: formatExecutionFailure(err) }
  }
}

async function refreshPreviewArtifacts(
  slides: SlideAssetSourceSlide[] | undefined,
  iconCollection: string,
  fontFamily?: string,
): Promise<{ success: boolean; layoutSpecsJson?: string; error?: string }> {
  if (!slides || slides.length === 0) {
    return { success: true }
  }

  const slideAssetsResult = await persistSlideAssetsToWorkspace(slides, iconCollection)
  if (!slideAssetsResult.success) {
    return { success: false, error: slideAssetsResult.error ?? 'Failed to persist slide assets.' }
  }

  const layoutInput: LayoutInputSourceSlide[] = slides.map((slide) => ({
    layout: slide.layout,
    title: slide.title,
    keyMessage: slide.keyMessage ?? '',
    bullets: slide.bullets ?? [],
    notes: slide.notes ?? '',
    icon: slide.icon,
    imagePath: slide.imagePath,
    selectedImages: slide.selectedImages,
  }))

  const layoutSpecsResult = await computeLayoutSpecsInternal(layoutInput, fontFamily)
  if (!layoutSpecsResult.success || !layoutSpecsResult.specs?.trim()) {
    return { success: false, error: layoutSpecsResult.error ?? 'Failed to compute layout specs.' }
  }

  return { success: true, layoutSpecsJson: layoutSpecsResult.specs.trim() }
}

/**
 * Compute content-adaptive layout specs via the hybrid layout engine
 * (hybrid_layout.py + kiwisolver constraint solver).
 * Can be called from any IPC handler — does not depend on ipcMain.handle.
 */
async function computeLayoutSpecsInternal(
  slides: LayoutInputSourceSlide[] | string,
  fontFamily?: string,
): Promise<{ success: boolean; specs?: string; error?: string }> {
  try {
    const persisted = await persistLayoutInputToWorkspace(slides, fontFamily)
    if (!persisted.success || !persisted.inputPath || !persisted.outputPath) {
      return { success: false, error: persisted.error ?? 'Failed to persist layout input.' }
    }
    const { inputPath, outputPath } = persisted

    const hybridScript = resolveBundledPath('scripts', 'layout', 'hybrid_layout.py')

    const python = await resolvePythonExecutable()
    const { stdout, stderr } = await execFileAsync(
      python,
      [hybridScript, '--input', inputPath, '--output', outputPath],
      {
        windowsHide: true,
        timeout: 60_000,
        maxBuffer: 4 * 1024 * 1024,
        env: {
          ...process.env,
          PYTHONIOENCODING: 'utf-8',
        },
        cwd: path.dirname(hybridScript),
      },
    )

    if (stderr?.trim()) {
      console.log('[computeLayoutSpecs]', stderr.trim())
    }

    const specsJson = stdout?.trim() || await fs.readFile(outputPath, 'utf-8')
    return { success: true, specs: specsJson }
  } catch (err) {
    return { success: false, error: formatExecutionFailure(err) }
  }
}

export async function computeLayoutSpecs(
  slides: LayoutInputSourceSlide[] | string,
  fontFamily?: string,
): Promise<{ success: boolean; specs?: string; error?: string }> {
  return queuePowerPointAutomation(() => computeLayoutSpecsInternal(slides, fontFamily))
}

async function renderPresentationInternal(
  theme: ThemeTokens | null,
  title: string,
  outputPath: string,
  opts?: { renderDir?: string; iconCollection?: string; layoutSpecsJson?: string; templatePath?: string; templateMeta?: TemplateMeta | null; designStyle?: string; customBackgroundColor?: string | null },
): Promise<PptxCompletionReport> {
  const workDir = path.dirname(outputPath)
  const runnerScriptPath = resolveBundledPath('scripts', 'pptx-python-runner.py')

  if (!existsSync(runnerScriptPath)) {
    throw new Error(`Python PPTX runner not found at ${runnerScriptPath}`)
  }

  await fs.mkdir(workDir, { recursive: true })

  const python = await resolvePythonExecutable()
  await ensurePythonModule(
    python,
    'pptx',
    `Install python-pptx in the managed environment. ${pythonSetupHint()}`,
  )

  const themePayload = JSON.stringify(theme?.C ?? DEFAULT_THEME_C)
  const themeExplicit = theme?.C ? '1' : '0'
  const fontFamily = resolveThemeFontFamily(theme)
  const colorTreatment = resolveThemeColorTreatment(theme)
  const textBoxStyle = resolveThemeTextBoxStyle(theme)
  const textBoxCornerStyle = resolveThemeTextBoxCornerStyle(theme)
  const showSlideIcons = resolveThemeShowSlideIcons(theme)
  const workspaceDir = await readWorkspaceDir()
  await assertValidLayoutInputArtifact(workspaceDir)
  let layoutSpecsJson = opts?.layoutSpecsJson?.trim() ?? ''
  if (!layoutSpecsJson) {
    const { inputPath } = buildLayoutArtifactPaths(workspaceDir)
    const layoutInputJson = await fs.readFile(inputPath, 'utf-8')
    const computed = await computeLayoutSpecsInternal(layoutInputJson, fontFamily)
    if (!computed.success || !computed.specs?.trim()) {
      throw new Error(computed.error ?? 'Failed to compute hybrid layout specs.')
    }
    layoutSpecsJson = computed.specs.trim()
  }
  const { slideAssetsPath } = buildLayoutArtifactPaths(workspaceDir)
  const slideAssetsJson = existsSync(slideAssetsPath)
    ? await fs.readFile(slideAssetsPath, 'utf-8').catch(() => '')
    : ''

  // Only use the on-disk template when the user explicitly selected "Custom Template"
  let templatePath = opts?.templatePath
  if (!templatePath && opts?.designStyle === 'Custom Template') {
    const candidate = path.join(workspaceDir, 'template', 'template.pptx')
    if (existsSync(candidate)) templatePath = candidate
  }
  const templateMetaJson = opts?.templateMeta ? JSON.stringify(opts.templateMeta) : ''
  const customBackgroundColor = typeof opts?.customBackgroundColor === 'string' ? opts.customBackgroundColor.trim() : ''

  const infographicManifestPath = path.join(workspaceDir, 'previews', 'notebooklm-infographics.json')
  let notebookLMInfographicsJson = ''
  try {
    const raw = await fs.readFile(infographicManifestPath, 'utf-8')
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed) && parsed.length > 0) {
      notebookLMInfographicsJson = JSON.stringify(parsed)
    }
  } catch { /* no manifest or empty — skip */ }

  const designStyle = opts?.designStyle || 'Blank White'

  const args = [runnerScriptPath, outputPath, '--renderer-mode']
  if (opts?.renderDir) {
    args.push('--render-dir', opts.renderDir)
  }
  args.push('--workspace-dir', workspaceDir)

  const { stdout } = await execFileAsync(
    python,
    args,
    {
      windowsHide: true,
      timeout: 180_000,
      maxBuffer: 8 * 1024 * 1024,
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        PPTX_THEME_JSON: themePayload,
        PPTX_THEME_EXPLICIT: themeExplicit,
        PPTX_TITLE: title || 'Presentation',
        PPTX_FONT_FAMILY: fontFamily,
        PPTX_COLOR_TREATMENT: colorTreatment,
        PPTX_TEXT_BOX_STYLE: textBoxStyle,
        PPTX_TEXT_BOX_CORNER_STYLE: textBoxCornerStyle,
        PPTX_SHOW_SLIDE_ICONS: showSlideIcons,
        PPTX_DESIGN_STYLE: designStyle,
        ...(customBackgroundColor ? { PPTX_CUSTOM_BACKGROUND_COLOR: customBackgroundColor } : {}),
        PPTX_ICON_COLLECTION: opts?.iconCollection ?? 'all',
        ...(opts?.renderDir ? { PPTX_SKIP_TEXT_OVERFLOW_FIX: '1' } : {}),
        ...(slideAssetsJson.trim() ? { PPTX_SLIDE_ASSETS_JSON: slideAssetsJson } : {}),
        ...(templatePath ? { PPTX_TEMPLATE_PATH: templatePath } : {}),
        ...(templateMetaJson ? { PPTX_TEMPLATE_META_JSON: templateMetaJson } : {}),
        ...(notebookLMInfographicsJson ? { PPTX_NOTEBOOKLM_INFOGRAPHICS: notebookLMInfographicsJson } : {}),
        WORKSPACE_DIR: workspaceDir,
        PPTX_LAYOUT_SPECS_JSON: layoutSpecsJson,
      },
    },
  )

  const report = parsePptxCompletionReport(stdout)
  assertCompletionSuccess(report, 'PPTX generation')
  return report!
}

export async function renderPresentationToFile(
  theme: ThemeTokens | null,
  title: string,
  outputPath: string,
  opts?: { renderDir?: string; iconCollection?: string; layoutSpecsJson?: string; templatePath?: string; templateMeta?: TemplateMeta | null; designStyle?: string; customBackgroundColor?: string | null },
): Promise<PptxCompletionReport> {
  return queuePowerPointAutomation(() => renderPresentationInternal(theme, title, outputPath, opts))
}

function naturalSortPaths(paths: string[]): string[] {
  return [...paths].sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' }))
}

async function readPreviewImagePaths(renderDir: string): Promise<string[]> {
  try {
    const imageEntries = await fs.readdir(renderDir, { withFileTypes: true })
    return naturalSortPaths(
      imageEntries
        .filter((entry) => entry.isFile() && /\.(png|jpg|jpeg)$/i.test(entry.name))
        .map((entry) => path.join(renderDir, entry.name)),
    )
  } catch {
    return []
  }
}

/** Find the most recently modified PPTX in a directory, or null if none. */
async function findMostRecentPptx(dirPath: string): Promise<string | null> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true })
    let best: { path: string; mtime: number } | null = null
    for (const entry of entries) {
      if (!entry.isFile() || !/\.pptx$/i.test(entry.name) || entry.name.startsWith('~$')) continue
      const fullPath = path.join(dirPath, entry.name)
      const stat = await fs.stat(fullPath)
      if (!best || stat.mtimeMs > best.mtime) {
        best = { path: fullPath, mtime: stat.mtimeMs }
      }
    }
    return best?.path ?? null
  } catch {
    return null
  }
}

/** Render PNG preview images from an existing PPTX via PowerPoint COM (Windows). */
async function renderPngFromPptx(pptxPath: string, renderDir: string): Promise<void> {
  const python = await resolvePythonExecutable()
  const script = [
    'import sys, pathlib, subprocess, time',
    'pptx_path = sys.argv[1]',
    'render_dir = sys.argv[2]',
    'import pythoncom, win32com.client',
    'def _pids():',
    '    r = subprocess.run(["tasklist","/FI","IMAGENAME eq POWERPNT.EXE","/FO","CSV","/NH"], capture_output=True, text=True, timeout=5)',
    '    s = set()',
    '    for l in r.stdout.strip().splitlines():',
    '        p = l.replace(chr(34),"").split(",")',
    '        if len(p)>=2 and p[1].strip().isdigit(): s.add(int(p[1].strip()))',
    '    return s',
    'def _detect_new(before, timeout_s=2.0):',
    '    deadline = time.monotonic() + timeout_s',
    '    while time.monotonic() < deadline:',
    '        delta = _pids() - before',
    '        if delta: return delta',
    '        time.sleep(0.2)',
    '    return _pids() - before',
    'pythoncom.CoInitialize()',
    'before = _pids()',
    'pp = None; prs = None',
    'owned = set(); safe_to_quit = False',
    'try:',
    '    pp = win32com.client.DispatchEx("PowerPoint.Application")',
    '    pp.Visible = 1',
    '    owned = _detect_new(before)',
    '    safe_to_quit = bool(owned)',
    '    print(f"[powerpoint-com] created app safe_to_quit={safe_to_quit} before_pids={sorted(before)} owned_pids={sorted(owned)}", file=sys.stderr)',
    '    prs = pp.Presentations.Open(pptx_path, WithWindow=False, ReadOnly=True)',
    '    prs.Export(render_dir, "PNG", 1280, 720)',
    'finally:',
    '    if prs:',
    '        try: prs.Close()',
    '        except Exception: pass',
    '    if pp and safe_to_quit:',
    '        try:',
    '            pp.Quit()',
    '            print(f"[powerpoint-com] quit owned app owned_pids={sorted(owned)}", file=sys.stderr)',
    '        except Exception as exc:',
    '            print(f"[powerpoint-com] quit failed, leaving app running: {exc}", file=sys.stderr)',
    '    elif pp:',
    '        print(f"[powerpoint-com] skip quit — no owned PID detected", file=sys.stderr)',
    '    pythoncom.CoUninitialize()',
  ].join('\n')
  await execFileAsync(python, ['-c', script, pptxPath, renderDir], {
    windowsHide: true,
    timeout: 60_000,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  })
}

export function registerPptxHandlers(): void {
  const channels = [
    'pptx:generate',
    'pptx:readExistingPreviews',
    'pptx:rerenderPreview',
    'pptx:openPreviewPptx',
    'pptx:renderPreview',
    'pptx:computeLayout',
    'pptx:importTemplate',
    'pptx:removeTemplate',
    'pptx:clearWorkspaceArtifacts',
  ] as const

  for (const channel of channels) {
    ipcMain.removeHandler(channel)
  }

  ipcMain.handle('pptx:generate', async (_event, _code: string, _themeTokens: ThemeTokens | null, title: string) => {
    try {
      const win = BrowserWindow.fromWebContents(_event.sender)
      const workspaceDir = await readWorkspaceDir()
      const previewRoot = path.join(workspaceDir, 'previews')
      const previewPptxPath = await findMostRecentPptx(previewRoot)

      if (!previewPptxPath) {
        return {
          success: false,
          error: 'No preview PPTX was found in the workspace previews folder. Generate a preview first.',
        }
      }

      return await savePresentationFile(previewPptxPath, title, win)
    } catch (err) {
      return { success: false, error: formatExecutionFailure(err) }
    }
  })

  ipcMain.handle('pptx:readExistingPreviews', async () => {
    try {
      const workspaceDir = await readWorkspaceDir()
      const renderDir = path.join(workspaceDir, 'previews')
      const imagePaths = await readPreviewImagePaths(renderDir)
      return { success: imagePaths.length > 0, imagePaths }
    } catch {
      return { success: false, imagePaths: [] }
    }
  })

  ipcMain.handle('pptx:rerenderPreview', async () => {
    try {
      const workspaceDir = await readWorkspaceDir()
      const renderDir = path.join(workspaceDir, 'previews')
      const pptxPath = await findMostRecentPptx(renderDir)
      if (!pptxPath) {
        return { success: false, imagePaths: [], error: 'No PPTX file found in the previews folder.' }
      }

      await removePreviewImages(renderDir)
      await queuePowerPointAutomation(() => renderPngFromPptx(pptxPath, renderDir))

      const rendered = await readPreviewImagePaths(renderDir)
      return { success: rendered.length > 0, imagePaths: rendered }
    } catch (err) {
      console.log('[rerenderPreview] COM render failed:', err)
      return { success: false, imagePaths: [], error: 'Preview rendering failed. PowerPoint desktop may be required.' }
    }
  })

  ipcMain.handle('pptx:openPreviewPptx', async () => {
    try {
      const workspaceDir = await readWorkspaceDir()
      const previewDir = path.join(workspaceDir, 'previews')
      const pptxPath = await findMostRecentPptx(previewDir)
      if (!pptxPath) {
        return { success: false, error: 'No PPTX file found in the previews folder.' }
      }

      const openError = await shell.openPath(path.resolve(pptxPath))
      if (openError) {
        return { success: false, error: openError }
      }

      return { success: true, path: pptxPath }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to open the preview PPTX in PowerPoint.',
      }
    }
  })

  ipcMain.handle('pptx:renderPreview', async (_event, designStyle: string | null, themeTokens: ThemeTokens | null, title: string, iconCollection?: string, slides?: SlideAssetSourceSlide[], templateMeta?: TemplateMeta | null, customBackgroundColor?: string | null) => {
    try {
      return await queuePowerPointAutomation(async () => {
        const workspaceDir = await readWorkspaceDir()
        const previewRoot = path.join(workspaceDir, 'previews')
        const renderDir = previewRoot
        const outputPath = path.join(previewRoot, 'presentation-preview.pptx')

        try {
          const artifactRefresh = await refreshPreviewArtifacts(
            slides,
            iconCollection ?? 'all',
            resolveThemeFontFamily(themeTokens),
          )
          if (!artifactRefresh.success) {
            return { success: false, error: artifactRefresh.error ?? 'Failed to refresh preview artifacts.' }
          }

          await fs.unlink(outputPath).catch(() => {})
          await removeStaleTimestampedPptx(previewRoot, 'presentation-preview.pptx')
          await removePreviewImages(renderDir)
          await fs.mkdir(previewRoot, { recursive: true })
          const completionReport = await renderPresentationInternal(themeTokens, title, outputPath, {
            renderDir,
            iconCollection,
            templateMeta,
            customBackgroundColor,
            layoutSpecsJson: artifactRefresh.layoutSpecsJson,
            designStyle: designStyle ?? undefined,
          })

          let actualPptx: string | null = null
          try {
            const previewEntries = await fs.readdir(previewRoot, { withFileTypes: true })
            const pptxFile = previewEntries.find((e) => e.isFile() && /\.pptx$/i.test(e.name))
            if (pptxFile) actualPptx = path.join(previewRoot, pptxFile.name)
          } catch { /* ignore */ }

          // Render PNG previews from the generated PPTX via PowerPoint COM.
          // We're already inside queuePowerPointAutomation, so call directly.
          if (actualPptx) {
            try {
              await renderPngFromPptx(actualPptx, renderDir)
            } catch (err) {
              console.log('[renderPreview] COM preview render failed (PPTX was generated):', err)
            }
          }

          const imagePaths = await readPreviewImagePaths(renderDir)
          const qa = completionReport.qa ?? undefined

          if (imagePaths.length === 0) {
            return {
              success: !!actualPptx,
              imagePaths: [],
              qa,
              warning: actualPptx
                ? 'PPTX generated successfully but slide preview images could not be rendered. PowerPoint desktop may be required.'
                : 'Preview rendering completed but no output was generated.',
            }
          }

          const wasRenamed = actualPptx && path.basename(actualPptx) !== 'presentation-preview.pptx'
          return {
            success: true,
            imagePaths,
            qa,
            ...(wasRenamed ? { warning: `The previous PPTX was locked. New file saved as ${path.basename(actualPptx!)}.  Close the old file in PowerPoint to avoid mismatches.` } : {}),
          }
        } catch (error) {
          throw error
        }
      })
    } catch (err) {
      return { success: false, error: formatExecutionFailure(err) }
    }
  })

  ipcMain.handle('pptx:computeLayout', async (_event, slidesJson: string) => {
    return computeLayoutSpecs(slidesJson)
  })

  ipcMain.handle('pptx:importTemplate', async (_event) => {
    try {
      const win = BrowserWindow.getFocusedWindow()
      const dialogOptions = {
        title: 'Select PPTX Template',
        filters: [{ name: 'PowerPoint', extensions: ['pptx'] }],
        properties: ['openFile' as const],
      }
      const { filePaths, canceled } = win
        ? await dialog.showOpenDialog(win, dialogOptions)
        : await dialog.showOpenDialog(dialogOptions)

      if (canceled || filePaths.length === 0) {
        return { success: false, error: 'Cancelled' }
      }

      const sourcePath = filePaths[0]
      const workspaceDir = await readWorkspaceDir()
      const templateDir = path.join(workspaceDir, 'template')
      const templatePath = path.join(templateDir, 'template.pptx')
      const assetsDir = path.join(templateDir, 'assets')

      await fs.mkdir(templateDir, { recursive: true })
      await fs.copyFile(sourcePath, templatePath)

      // Extract metadata via Python script
      const python = await resolvePythonExecutable()
      const extractScript = resolveBundledPath('scripts', 'extract_template_meta.py')
      const { stdout, stderr } = await execFileAsync(
        python,
        [extractScript, templatePath, assetsDir],
        {
          windowsHide: true,
          timeout: 30_000,
          maxBuffer: 4 * 1024 * 1024,
          env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
        },
      )

      if (stderr?.trim()) {
        console.log('[importTemplate]', stderr.trim())
      }

      const meta = JSON.parse(stdout.trim())
      if (meta.error) {
        return { success: false, error: meta.error }
      }

      // Build warning if dimensions are not 16:9
      const { widthIn, heightIn } = meta.originalDimensions ?? {}
      const isWidescreen = Math.abs((widthIn ?? 13.333) - 13.333) < 0.1 && Math.abs((heightIn ?? 7.5) - 7.5) < 0.1
      const warning = isWidescreen
        ? undefined
        : `Template dimensions (${widthIn}\" \u00D7 ${heightIn}\") have been adjusted to 16:9 widescreen (13.333\" \u00D7 7.5\") for layout compatibility.`

      return { success: true, templatePath, meta, warning }
    } catch (err) {
      return { success: false, error: formatExecutionFailure(err) }
    }
  })

  ipcMain.handle('pptx:removeTemplate', async () => {
    try {
      const workspaceDir = await readWorkspaceDir()
      const templateDir = path.join(workspaceDir, 'template')
      await fs.rm(templateDir, { recursive: true, force: true }).catch(() => {})
      return { success: true }
    } catch {
      return { success: true } // Best-effort cleanup
    }
  })

  ipcMain.handle('pptx:clearWorkspaceArtifacts', async () => {
    try {
      await clearWorkspaceArtifactsInternal()
      return { success: true }
    } catch {
      return { success: true }
    }
  })

}
