import { ipcMain, dialog, BrowserWindow } from 'electron'
import fs from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import type { ThemeTokens } from '../../../src/domain/entities/palette'
import type { TemplateMeta } from '../../../src/domain/entities/slide-work'
import { DEFAULT_THEME_C } from '../../../src/domain/theme/default-theme'
import { ensurePythonModule, pythonSetupHint, resolvePythonExecutable } from './python-runtime.ts'
import { readWorkspaceDir, resolveBundledPath } from '../project/workspace-utils.ts'
import type { SlideGroup } from '../llm/slide-chunker.ts'
import { sliceLayoutSpecs, sliceSlideAssets } from '../llm/slide-chunker.ts'

const execFileAsync = promisify(execFile)
const GENERATED_CODE_EXECUTION_ATTEMPTS = 2
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
  return v === 'gradient' || v === 'mixed' ? v : 'mixed'
}

function resolveThemeTextBoxStyle(theme: ThemeTokens | null | undefined): 'plain' | 'with-icons' | 'mixed' {
  const v = theme?.textBoxStyle
  return v === 'with-icons' || v === 'mixed' ? v : 'mixed'
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
// Syntax preflight — fast Python AST check before full execution
// ---------------------------------------------------------------------------

/**
 * Run a quick Python syntax check on a generated source file.
 * Raises if the file has a SyntaxError so we fail before attempting
 * chunk execution and producing a partial/corrupt PPTX.
 */
async function checkPythonSyntax(python: string, sourcePath: string): Promise<void> {
  const checkScript = `import ast, sys; ast.parse(open(sys.argv[1], encoding='utf-8').read(), sys.argv[1]); print('ok')`
  try {
    await execFileAsync(python, ['-c', checkScript, sourcePath], {
      windowsHide: true,
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`Syntax error in generated chunk ${sourcePath}:\n${msg}`)
  }
}

// ---------------------------------------------------------------------------
// Completion report — structured JSON emitted by Python scripts to stdout
// ---------------------------------------------------------------------------

export interface PptxQaReport {
  contrastFixes: number
  missingIcons: Array<{ icon: string; reason: string }>
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

/**
 * Detect calls to private helpers (names starting with `_`) that are called
 * but never defined in the same code block. These are cross-chunk references
 * that will produce NameErrors at runtime — e.g. calling `_txb(` or `_rect(`
 * that were defined in a different chunk.
 *
 * Returns the list of undeclared private helper names found.
 */
function detectUndeclaredHelperCalls(code: string): string[] {
  // Collect every function name defined in this file via `def name(` at any indent
  const defined = new Set(
    [...code.matchAll(/^\s*def\s+(_[a-z]\w*)\s*\(/gm)].map((m) => m[1]),
  )
  // Collect every private-helper call: `_name(` anywhere in the code
  const called = new Set(
    [...code.matchAll(/\b(_[a-z]\w*)\s*\(/g)].map((m) => m[1]),
  )
  // python-pptx internal underscore attrs that are safe to call
  const pptxInternals = new Set([
    '_element', '_p', '_tc', '_fill', '_txBody', '_r', '_tbl',
    '_fld', '_tr', '_spPr', '_nvSpPr', '_sp',
  ])
  return [...called].filter((name) => !defined.has(name) && !pptxInternals.has(name))
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
}

export interface LayoutInputSlide {
  layout_type: string
  title_text: string
  key_message_text: string
  bullets: string[]
  notes: string
  item_count: number
  has_icon: boolean
  font_family: string
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

function isLikelyPythonPptxCode(code: string): boolean {
  return /from\s+pptx\s+import|import\s+pptx|Presentation\(|python-pptx|def\s+build_presentation\s*\(/i.test(code)
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

async function removeDirectoryQuietly(dirPath: string | null): Promise<void> {
  if (!dirPath) return
  await fs.rm(dirPath, { recursive: true, force: true }).catch(() => {})
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

async function ensureCleanDirectory(dirPath: string): Promise<void> {
  await fs.rm(dirPath, { recursive: true, force: true }).catch(() => {})
  await fs.mkdir(dirPath, { recursive: true })
}

function buildLayoutArtifactPaths(workspaceDir: string) {
  const layoutDir = path.join(workspaceDir, 'previews')
  return {
    layoutDir,
    inputPath: path.join(layoutDir, 'layout-input.json'),
    outputPath: path.join(layoutDir, 'layout-specs.json'),
    slideAssetsPath: path.join(layoutDir, 'slide-assets.json'),
    layoutMetaPath: path.join(layoutDir, 'layout-meta.json'),
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
    notes: slide.notes || '',
    item_count: slide.bullets.length,
    has_icon: !!slide.icon,
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

export async function persistLayoutMeta(meta: { includeImagesInLayout?: boolean }): Promise<void> {
  const workspaceDir = await readWorkspaceDir()
  const { layoutDir, layoutMetaPath } = buildLayoutArtifactPaths(workspaceDir)
  await fs.mkdir(layoutDir, { recursive: true })
  await fs.writeFile(layoutMetaPath, JSON.stringify(meta, null, 2), 'utf-8')
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

    return {
      number: slide.number,
      title: slide.title,
      layout: slide.layout,
      icon: slide.icon ?? null,
      iconName: slide.icon ?? null,
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
  }))

  const layoutSpecsResult = await computeLayoutSpecsInternal(layoutInput, fontFamily)
  if (!layoutSpecsResult.success || !layoutSpecsResult.specs?.trim()) {
    return { success: false, error: layoutSpecsResult.error ?? 'Failed to compute layout specs.' }
  }

  return { success: true, layoutSpecsJson: layoutSpecsResult.specs.trim() }
}

/**
 * Compute content-adaptive layout specs via the hybrid layout engine
 * (PowerPoint COM AutoFit + kiwisolver constraint solver).
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
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
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

async function executeGeneratedPythonCodeToFileInternal(
  code: string,
  theme: ThemeTokens | null,
  title: string,
  outputPath: string,
  opts?: { renderDir?: string; iconCollection?: string; layoutSpecsJson?: string; templatePath?: string; templateMeta?: TemplateMeta | null; includeImagesInLayout?: boolean },
): Promise<PptxCompletionReport> {
  const workDir = path.dirname(outputPath)
  const sourcePath = path.join(workDir, 'generated-source.py')
  const runnerScriptPath = resolveBundledPath('scripts', 'pptx-python-runner.py')

  if (!existsSync(runnerScriptPath)) {
    throw new Error(`Python PPTX runner not found at ${runnerScriptPath}`)
  }

  await fs.mkdir(workDir, { recursive: true })
  await fs.writeFile(sourcePath, code, 'utf-8')

  const python = await resolvePythonExecutable()
  await ensurePythonModule(
    python,
    'pptx',
    `Install python-pptx in the managed environment. ${pythonSetupHint()}`,
  )

  const themePayload = JSON.stringify(theme?.C ?? DEFAULT_THEME_C)
  const fontFamily = resolveThemeFontFamily(theme)
  const colorTreatment = resolveThemeColorTreatment(theme)
  const textBoxStyle = resolveThemeTextBoxStyle(theme)
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

  // Auto-detect custom template from workspace if not explicitly provided
  let templatePath = opts?.templatePath
  if (!templatePath) {
    const candidate = path.join(workspaceDir, 'template', 'template.pptx')
    if (existsSync(candidate)) templatePath = candidate
  }
  const templateMetaJson = opts?.templateMeta ? JSON.stringify(opts.templateMeta) : ''

  // Read NotebookLM infographic manifest (if present, these will be appended as slides)
  const infographicManifestPath = path.join(workspaceDir, 'previews', 'notebooklm-infographics.json')
  let notebookLMInfographicsJson = ''
  try {
    const raw = await fs.readFile(infographicManifestPath, 'utf-8')
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed) && parsed.length > 0) {
      notebookLMInfographicsJson = JSON.stringify(parsed)
    }
  } catch { /* no manifest or empty — skip */ }

  const args = [runnerScriptPath, sourcePath, outputPath]
  if (opts?.renderDir) {
    args.push('--render-dir', opts.renderDir)
  }
  args.push('--workspace-dir', workspaceDir)

  let lastError: unknown
  for (let attempt = 1; attempt <= GENERATED_CODE_EXECUTION_ATTEMPTS; attempt++) {
    try {
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
            PPTX_TITLE: title || 'Presentation',
            PPTX_FONT_FAMILY: fontFamily,
            PPTX_COLOR_TREATMENT: colorTreatment,
            PPTX_TEXT_BOX_STYLE: textBoxStyle,
            PPTX_ICON_COLLECTION: opts?.iconCollection ?? 'all',
            ...(opts?.renderDir ? { PPTX_SKIP_TEXT_OVERFLOW_FIX: '1' } : {}),
            ...(slideAssetsJson.trim() ? { PPTX_SLIDE_ASSETS_JSON: slideAssetsJson } : {}),
            ...(templatePath ? { PPTX_TEMPLATE_PATH: templatePath } : {}),
            ...(templateMetaJson ? { PPTX_TEMPLATE_META_JSON: templateMetaJson } : {}),
            ...(notebookLMInfographicsJson ? { PPTX_NOTEBOOKLM_INFOGRAPHICS: notebookLMInfographicsJson } : {}),
            ...(opts?.includeImagesInLayout ? { PPTX_INCLUDE_IMAGES_IN_LAYOUT: '1' } : {}),
            WORKSPACE_DIR: workspaceDir,
            PPTX_LAYOUT_SPECS_JSON: layoutSpecsJson,
          },
        },
      )

      const report = parsePptxCompletionReport(stdout)
      assertCompletionSuccess(report, 'PPTX generation')
      return report!
    } catch (error) {
      lastError = error
      if (attempt < GENERATED_CODE_EXECUTION_ATTEMPTS) continue
    }
  }

  throw lastError
}

export async function executeGeneratedPythonCodeToFile(
  code: string,
  theme: ThemeTokens | null,
  title: string,
  outputPath: string,
  opts?: { renderDir?: string; iconCollection?: string; layoutSpecsJson?: string; templatePath?: string; templateMeta?: TemplateMeta | null; includeImagesInLayout?: boolean },
): Promise<PptxCompletionReport> {
  return queuePowerPointAutomation(() => executeGeneratedPythonCodeToFileInternal(code, theme, title, outputPath, opts))
}

// ---------------------------------------------------------------------------
// Chunked PPTX generation: parallel chunk execution + merge + post-process
// ---------------------------------------------------------------------------

export interface ChunkResult {
  chunkIndex: number
  code: string
  slideIndices: number[]
}

export async function executeChunkedPptxGeneration(
  chunks: ChunkResult[],
  theme: ThemeTokens | null,
  title: string,
  outputPath: string,
  opts: {
    iconCollection?: string
    layoutSpecsJson?: string
    slideAssetsJson?: string
    templatePath?: string
    templateMeta?: TemplateMeta | null
    includeImagesInLayout?: boolean
    onProgress?: (progress: { chunkIndex: number; totalChunks: number; status: string; slideRange: string }) => void
  },
): Promise<PptxCompletionReport> {
  const workDir = path.dirname(outputPath)
  const partialsDir = path.join(workDir, 'partials')
  await fs.mkdir(partialsDir, { recursive: true })

  const runnerScriptPath = resolveBundledPath('scripts', 'pptx-python-runner.py')
  const mergeScriptPath = resolveBundledPath('scripts', 'pptx_merge.py')
  if (!existsSync(runnerScriptPath)) throw new Error(`Python PPTX runner not found at ${runnerScriptPath}`)
  if (!existsSync(mergeScriptPath)) throw new Error(`Python merge script not found at ${mergeScriptPath}`)

  const python = await resolvePythonExecutable()
  await ensurePythonModule(python, 'pptx', `Install python-pptx. ${pythonSetupHint()}`)

  const themePayload = JSON.stringify(theme?.C ?? DEFAULT_THEME_C)
  const fontFamily = resolveThemeFontFamily(theme)
  const colorTreatment = resolveThemeColorTreatment(theme)
  const textBoxStyle = resolveThemeTextBoxStyle(theme)
  const workspaceDir = await readWorkspaceDir()
  let templatePath = opts.templatePath
  if (!templatePath) {
    const candidate = path.join(workspaceDir, 'template', 'template.pptx')
    if (existsSync(candidate)) templatePath = candidate
  }
  const templateMetaJson = opts.templateMeta ? JSON.stringify(opts.templateMeta) : ''

  let notebookLMInfographicsJson = ''
  try {
    const raw = await fs.readFile(path.join(workspaceDir, 'previews', 'notebooklm-infographics.json'), 'utf-8')
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed) && parsed.length > 0) notebookLMInfographicsJson = JSON.stringify(parsed)
  } catch { /* skip */ }

  // ---- Write combined generated-source.py BEFORE execution so it exists even on failure ----
  const combinedCode = chunks
    .map((c) => `# === Chunk ${c.chunkIndex} (slides ${c.slideIndices.map((i) => i + 1).join(', ')}) ===\n${c.code}`)
    .join('\n\n')
  await fs.writeFile(path.join(workDir, 'generated-source.py'), combinedCode, 'utf-8')

  const totalChunks = chunks.length
  const partialPathMap: Record<number, string> = {}

  // ---- Step 1: Execute each chunk in parallel ----
  const execResults = await Promise.allSettled(
    chunks.map(async (chunk) => {
      const { chunkIndex, code, slideIndices } = chunk
      const slideRange = `${slideIndices[0] + 1}-${slideIndices[slideIndices.length - 1] + 1}`
      opts.onProgress?.({ chunkIndex, totalChunks, status: 'executing', slideRange })

      const sourcePath = path.join(workDir, `generated-source-chunk-${chunkIndex}.py`)
      await fs.writeFile(sourcePath, code, 'utf-8')

      // ---- Static name check: catch cross-chunk private helper calls ----
      const undeclared = detectUndeclaredHelperCalls(code)
      if (undeclared.length > 0) {
        throw new Error(
          `Chunk ${chunkIndex} calls undefined private helpers: ${undeclared.join(', ')}. `
          + `Use the runtime-injected API instead: fetch_icon(), safe_add_picture().`,
        )
      }

      // ---- Syntax preflight: catch NameErrors / SyntaxErrors before full execution ----
      await checkPythonSyntax(python, sourcePath)

      const partialPath = path.join(partialsDir, `partial-${chunkIndex}.pptx`)
      partialPathMap[chunkIndex] = partialPath

      const group: SlideGroup = { chunkIndex, slideIndices, slides: [] as never[] }
      const chunkLayoutSpecs = opts.layoutSpecsJson ? sliceLayoutSpecs(opts.layoutSpecsJson, group) : ''
      const chunkSlideAssets = opts.slideAssetsJson ? sliceSlideAssets(opts.slideAssetsJson, group) : ''

      const { stdout } = await execFileAsync(python, [runnerScriptPath, sourcePath, partialPath, '--chunk-mode', '--workspace-dir', workspaceDir], {
        windowsHide: true,
        timeout: 180_000,
        maxBuffer: 8 * 1024 * 1024,
        env: {
          ...process.env,
          PYTHONIOENCODING: 'utf-8',
          PPTX_THEME_JSON: themePayload,
          PPTX_TITLE: title || 'Presentation',
          PPTX_FONT_FAMILY: fontFamily,
          PPTX_COLOR_TREATMENT: colorTreatment,
          PPTX_TEXT_BOX_STYLE: textBoxStyle,
          PPTX_ICON_COLLECTION: opts.iconCollection ?? 'all',
          PPTX_LAYOUT_SPECS_JSON: chunkLayoutSpecs,
          ...(chunkSlideAssets.trim() ? { PPTX_SLIDE_ASSETS_JSON: chunkSlideAssets } : {}),
          ...(templatePath ? { PPTX_TEMPLATE_PATH: templatePath } : {}),
          ...(templateMetaJson ? { PPTX_TEMPLATE_META_JSON: templateMetaJson } : {}),
          ...(opts.includeImagesInLayout ? { PPTX_INCLUDE_IMAGES_IN_LAYOUT: '1' } : {}),
          WORKSPACE_DIR: workspaceDir,
        },
      })

      // Verify chunk completion: parse report and confirm partial file exists
      const chunkReport = parsePptxCompletionReport(stdout)
      if (chunkReport && chunkReport.status === 'error') {
        throw new Error(`Chunk ${chunkIndex} verification failed: ${chunkReport.error}`)
      }
      if (!existsSync(partialPath)) {
        throw new Error(`Chunk ${chunkIndex} completed (exit 0) but partial file was not created: ${partialPath}`)
      }
      const stat = await fs.stat(partialPath)
      if (stat.size === 0) {
        throw new Error(`Chunk ${chunkIndex} produced an empty partial file (0 bytes): ${partialPath}`)
      }

      return chunkReport
    }),
  )

  const failures = execResults
    .map((r, i) => ({ result: r, chunk: chunks[i] }))
    .filter(({ result }) => result.status === 'rejected')
  if (failures.length > 0) {
    const errors = failures.map(({ result, chunk }) => {
      const reason = (result as PromiseRejectedResult).reason
      const range = `${chunk.slideIndices[0] + 1}-${chunk.slideIndices[chunk.slideIndices.length - 1] + 1}`
      return `Chunk ${chunk.chunkIndex} (slides ${range}): ${formatExecutionFailure(reason)}`
    })
    throw new Error(`Chunked PPTX execution failed:\n${errors.join('\n')}`)
  }

  // ---- Step 2: Merge partials with expected slide count verification (generated-source.py already written above) ----
  opts.onProgress?.({ chunkIndex: -1, totalChunks, status: 'merging', slideRange: 'all' })
  const orderedPartials = chunks.map((c) => partialPathMap[c.chunkIndex]).filter(Boolean)
  const expectedSlides = chunks.reduce((sum, c) => sum + c.slideIndices.length, 0)

  const { stdout: mergeStdout } = await execFileAsync(
    python,
    [mergeScriptPath, '--partials', orderedPartials.join(','), '--output', outputPath, '--expected-slides', String(expectedSlides)],
    {
      windowsHide: true,
      timeout: 60_000,
      maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    },
  )

  // Verify merge result
  const mergeReport = parsePptxCompletionReport(mergeStdout)
  assertCompletionSuccess(mergeReport, 'PPTX merge', expectedSlides)

  // ---- Step 3: Post-process the merged PPTX (validation only, no COM rendering) ----
  const combinedSourcePath = path.join(workDir, 'generated-source.py')
  const postArgs = [runnerScriptPath, combinedSourcePath, outputPath, '--post-process-only', '--workspace-dir', workspaceDir]

  const { stdout: postStdout } = await execFileAsync(python, postArgs, {
    windowsHide: true,
    timeout: 180_000,
    maxBuffer: 8 * 1024 * 1024,
    env: {
      ...process.env,
      PYTHONIOENCODING: 'utf-8',
      PPTX_SKIP_TEXT_OVERFLOW_FIX: '1',
      ...(opts.slideAssetsJson?.trim() ? { PPTX_SLIDE_ASSETS_JSON: opts.slideAssetsJson } : {}),
      ...(notebookLMInfographicsJson ? { PPTX_NOTEBOOKLM_INFOGRAPHICS: notebookLMInfographicsJson } : {}),
      WORKSPACE_DIR: workspaceDir,
    },
  })

  // Verify final output after post-processing
  const finalReport = parsePptxCompletionReport(postStdout)
  assertCompletionSuccess(finalReport, 'PPTX post-processing')

  // ---- Step 4: Render preview images from the merged PPTX ----
  try {
    await queuePowerPointAutomation(() => renderPngFromPptx(outputPath, workDir))
  } catch (err) {
    console.log('[chunked-pptx] Preview rendering failed (PPTX was generated):', err)
    if (finalReport) {
      finalReport.warnings.push('Preview images could not be rendered. PowerPoint desktop may be required.')
    }
  }

  // ---- Step 5: Clean up partials directory ----
  await removeDirectoryQuietly(partialsDir)
  opts.onProgress?.({ chunkIndex: -1, totalChunks, status: 'done', slideRange: 'all' })

  return finalReport!
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
  ipcMain.handle('pptx:generate', async (_event, code: string, themeTokens: ThemeTokens | null, title: string, iconCollection?: string, slides?: SlideAssetSourceSlide[], templateMeta?: TemplateMeta | null) => {
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

      // Fast path: images already exist — but verify they belong to the current
      // PPTX generation and are not stale previews from a prior run.
      if (imagePaths.length > 0) {
        const pptxPath = await findMostRecentPptx(renderDir)
        if (pptxPath) {
          try {
            const pptxMtime = (await fs.stat(pptxPath)).mtimeMs
            const imgMtime = (await fs.stat(imagePaths[0])).mtimeMs
            // Allow 5 s tolerance for COM export lag after PPTX is written
            if (imgMtime >= pptxMtime - 5000) {
              return { success: true, imagePaths }
            }
            // Images are stale — fall through to re-render
            console.log('[readExistingPreviews] Images are stale vs PPTX mtime, re-rendering')
          } catch {
            return { success: true, imagePaths } // stat failed, trust what we have
          }
        } else {
          return { success: true, imagePaths } // no PPTX to compare against
        }
      }

      // No images — try to render from an existing PPTX
      const pptxPath = await findMostRecentPptx(renderDir)
      if (!pptxPath) {
        return { success: false, imagePaths: [] }
      }

      try {
        await queuePowerPointAutomation(() => renderPngFromPptx(pptxPath, renderDir))
      } catch (err) {
        console.log('[readExistingPreviews] COM render failed:', err)
        return { success: false, imagePaths: [], warning: 'PPTX exists but preview rendering failed. PowerPoint desktop may be required.' }
      }

      const rendered = await readPreviewImagePaths(renderDir)
      return { success: rendered.length > 0, imagePaths: rendered }
    } catch {
      return { success: false, imagePaths: [] }
    }
  })

  ipcMain.handle('pptx:renderPreview', async (_event, code: string, themeTokens: ThemeTokens | null, title: string, iconCollection?: string, slides?: SlideAssetSourceSlide[], templateMeta?: TemplateMeta | null) => {
    try {
      if (!code || typeof code !== 'string' || code.trim().length === 0) {
        return { success: false, error: 'code must not be empty' }
      }
      if (!isLikelyPythonPptxCode(code)) {
        return { success: false, error: 'Only agent-generated python-pptx code is supported' }
      }

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
          const completionReport = await executeGeneratedPythonCodeToFileInternal(code, themeTokens, title, outputPath, {
            renderDir,
            iconCollection,
            templateMeta,
            layoutSpecsJson: artifactRefresh.layoutSpecsJson,
          })

          let actualPptx: string | null = null
          try {
            const previewEntries = await fs.readdir(previewRoot, { withFileTypes: true })
            const pptxFile = previewEntries.find((e) => e.isFile() && /\.pptx$/i.test(e.name))
            if (pptxFile) actualPptx = path.join(previewRoot, pptxFile.name)
          } catch { /* ignore */ }

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

}
