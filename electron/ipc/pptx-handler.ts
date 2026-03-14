import { ipcMain, dialog, app, BrowserWindow } from 'electron'
import fs from 'fs/promises'
import { existsSync, readdirSync } from 'fs'
import path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import type { ThemeTokens } from '../../src/domain/entities/palette'
import { DEFAULT_THEME_C } from '../../src/domain/theme/default-theme'
import { ensurePythonModule, pythonSetupHint, resolvePythonExecutable } from './python-runtime.ts'
import { readWorkspaceDir } from './workspace-utils.ts'

const execFileAsync = promisify(execFile)
const GENERATED_CODE_EXECUTION_ATTEMPTS = 2

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

async function savePresentationFile(filePath: string, title: string, win: BrowserWindow | null) {
  const safeTitle = (title || 'presentation').replace(/[^\w\s\-]/g, '_')
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

async function ensureCleanDirectory(dirPath: string): Promise<void> {
  await fs.rm(dirPath, { recursive: true, force: true }).catch(() => {})
  await fs.mkdir(dirPath, { recursive: true })
}

/** Resolve the icon PNG cache directory inside the app bundle (single source of truth). */
function getAppIconCacheDir(): string {
  const appPathCandidate = path.join(app.getAppPath(), 'skills', 'iconfy-list', 'cache')
  if (existsSync(appPathCandidate)) return appPathCandidate
  // In dev mode app.getAppPath() resolves to out/main; fall back to project root
  return path.join(process.cwd(), 'skills', 'iconfy-list', 'cache')
}

/**
 * Compute content-adaptive layout specs via the hybrid layout engine
 * (PowerPoint COM AutoFit + kiwisolver constraint solver).
 * Can be called from any IPC handler — does not depend on ipcMain.handle.
 */
export async function computeLayoutSpecs(
  slidesJson: string,
): Promise<{ success: boolean; specs?: string; error?: string }> {
  try {
    const workspaceDir = await readWorkspaceDir()
    const layoutDir = path.join(workspaceDir, 'previews')
    await fs.mkdir(layoutDir, { recursive: true })
    const inputPath = path.join(layoutDir, 'layout-input.json')
    const outputPath = path.join(layoutDir, 'layout-specs.json')

    await fs.writeFile(inputPath, slidesJson, 'utf-8')

    let hybridScript = path.join(app.getAppPath(), 'scripts', 'layout', 'hybrid_layout.py')
    if (!existsSync(hybridScript)) {
      hybridScript = path.join(process.cwd(), 'scripts', 'layout', 'hybrid_layout.py')
    }

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

export async function executeGeneratedPythonCodeToFile(
  code: string,
  theme: ThemeTokens | null,
  title: string,
  outputPath: string,
  opts?: { renderDir?: string; iconCollection?: string; layoutSpecsJson?: string },
): Promise<void> {
  const workDir = path.dirname(outputPath)
  const sourcePath = path.join(workDir, 'generated-source.py')
  let runnerScriptPath = path.join(app.getAppPath(), 'scripts', 'pptx-python-runner.py')
  if (!existsSync(runnerScriptPath)) {
    runnerScriptPath = path.join(process.cwd(), 'scripts', 'pptx-python-runner.py')
  }

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
  const workspaceDir = await readWorkspaceDir()
  const iconCacheDir = getAppIconCacheDir()

  const args = [runnerScriptPath, sourcePath, outputPath]
  if (opts?.renderDir) {
    args.push('--render-dir', opts.renderDir)
  }
  args.push('--workspace-dir', workspaceDir)

  let lastError: unknown
  for (let attempt = 1; attempt <= GENERATED_CODE_EXECUTION_ATTEMPTS; attempt++) {
    try {
      await execFileAsync(
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
            ICON_CACHE_DIR: iconCacheDir,
            WORKSPACE_DIR: workspaceDir,
            ...(opts?.layoutSpecsJson ? { PPTX_LAYOUT_SPECS_JSON: opts.layoutSpecsJson } : {}),
          },
        },
      )
      return
    } catch (error) {
      lastError = error
      if (attempt < GENERATED_CODE_EXECUTION_ATTEMPTS) continue
    }
  }

  throw lastError
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

export function registerPptxHandlers(): void {
  ipcMain.handle('pptx:generate', async (_event, code: string, themeTokens: ThemeTokens | null, title: string, iconCollection?: string) => {
    try {
      const win = BrowserWindow.fromWebContents(_event.sender)
      if (!code || typeof code !== 'string' || code.trim().length === 0) {
        return { success: false, error: 'code must not be empty' }
      }
      if (!isLikelyPythonPptxCode(code)) {
        return { success: false, error: 'Only agent-generated python-pptx code is supported' }
      }

      const workspaceDir = await readWorkspaceDir()
      const previewRoot = path.join(workspaceDir, 'previews')
      await fs.mkdir(previewRoot, { recursive: true })
      const outputPath = path.join(previewRoot, 'presentation-preview.pptx')

      try {
        await executeGeneratedPythonCodeToFile(code, themeTokens, title, outputPath, { iconCollection })
        return await savePresentationFile(outputPath, title, win)
      } catch (err) {
        // Keep workDir for debugging — generated-source.py + error context
        throw err
      }
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

  ipcMain.handle('pptx:renderPreview', async (_event, code: string, themeTokens: ThemeTokens | null, title: string, iconCollection?: string) => {
    try {
      if (!code || typeof code !== 'string' || code.trim().length === 0) {
        return { success: false, error: 'code must not be empty' }
      }
      if (!isLikelyPythonPptxCode(code)) {
        return { success: false, error: 'Only agent-generated python-pptx code is supported' }
      }

      const workspaceDir = await readWorkspaceDir()
      const previewRoot = path.join(workspaceDir, 'previews')
      const renderDir = previewRoot
      const outputPath = path.join(previewRoot, 'presentation-preview.pptx')

      try {
        // Try to remove the old PPTX before regenerating; ignore if locked
        await fs.unlink(outputPath).catch(() => {})
        await removePreviewImages(renderDir)
        await fs.mkdir(previewRoot, { recursive: true })
        await executeGeneratedPythonCodeToFile(code, themeTokens, title, outputPath, { renderDir, iconCollection })

        // Find actual PPTX (may have a timestamped name if the original was locked)
        let actualPptx: string | null = null
        try {
          const previewEntries = await fs.readdir(previewRoot, { withFileTypes: true })
          const pptxFile = previewEntries.find((e) => e.isFile() && /\.pptx$/i.test(e.name))
          if (pptxFile) actualPptx = path.join(previewRoot, pptxFile.name)
        } catch { /* ignore */ }

        const imagePaths = await readPreviewImagePaths(renderDir)

        if (imagePaths.length === 0) {
          return {
            success: !!actualPptx,
            imagePaths: [],
            warning: actualPptx
              ? 'PPTX generated successfully but slide preview images could not be rendered. PowerPoint desktop may be required.'
              : 'Preview rendering completed but no output was generated.',
          }
        }

        return { success: true, imagePaths }
      } catch (error) {
        // Do NOT delete previewRoot — keep generated-source.py + PPTX for debugging
        throw error
      }
    } catch (err) {
      return { success: false, error: formatExecutionFailure(err) }
    }
  })

  ipcMain.handle('pptx:computeLayout', async (_event, slidesJson: string) => {
    return computeLayoutSpecs(slidesJson)
  })

}
