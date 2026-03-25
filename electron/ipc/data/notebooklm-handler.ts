/**
 * IPC handler: NotebookLM integration
 * Calls scripts/notebooklm_generate.py through the shared Python runtime.
 */

import { ipcMain } from 'electron'
import path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import fs from 'fs/promises'
import { ensurePythonModule, resolvePythonExecutable } from '../pptx/python-runtime.ts'
import { readWorkspaceDir, resolveBundledPath } from '../project/workspace-utils.ts'

const execFileAsync = promisify(execFile)

async function runNotebookLM(command: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const python = await resolvePythonExecutable()
  await ensurePythonModule(python, 'notebooklm', 'Run "pip install notebooklm-py" inside the project .venv.')
  const scriptPath = resolveBundledPath('scripts/notebooklm_generate.py')

  const { stdout, stderr } = await execFileAsync(
    python,
    [scriptPath, command, JSON.stringify(args)],
    { timeout: 300_000, windowsHide: true, maxBuffer: 10 * 1024 * 1024 },
  )

  if (stderr?.trim()) {
    console.warn('[notebooklm] stderr:', stderr.trim())
  }

  return JSON.parse(stdout.trim())
}

export function registerNotebookLMHandlers(): void {
  ipcMain.handle('notebooklm:authStatus', async () => {
    return runNotebookLM('auth_status')
  })

  ipcMain.handle('notebooklm:list', async () => {
    return runNotebookLM('list')
  })

  ipcMain.handle('notebooklm:generateInfographic', async (_, notebookId: string, options?: { orientation?: string; detailLevel?: string }) => {
    const workspaceDir = await readWorkspaceDir()
    const outputDir = path.join(workspaceDir, 'images')
    await fs.mkdir(outputDir, { recursive: true })
    const outputPath = path.join(outputDir, `notebooklm-infographic-${Date.now()}.png`)

    const result = await runNotebookLM('infographic', {
      notebookId,
      outputPath,
      orientation: options?.orientation ?? 'landscape',
      detailLevel: options?.detailLevel ?? 'standard',
    }) as { success: boolean; path?: string }

    // Append to the infographic manifest so PPTX generation can include it
    if (result.success && result.path) {
      await appendToInfographicManifest(workspaceDir, result.path)
    }

    return result
  })

  ipcMain.handle('notebooklm:generateSlideDeck', async (_, notebookId: string, options?: { format?: string }) => {
    const workspaceDir = await readWorkspaceDir()
    const outputDir = path.join(workspaceDir, 'images')
    await fs.mkdir(outputDir, { recursive: true })
    const fmt = options?.format ?? 'pptx'
    const ext = fmt === 'pptx' ? 'pptx' : 'pdf'
    const outputPath = path.join(outputDir, `notebooklm-slides-${Date.now()}.${ext}`)

    return runNotebookLM('slide_deck', {
      notebookId,
      outputPath,
      format: fmt,
    })
  })

  ipcMain.handle('notebooklm:clearInfographics', async () => {
    const workspaceDir = await readWorkspaceDir()
    const manifestPath = path.join(workspaceDir, 'previews', 'notebooklm-infographics.json')
    await fs.writeFile(manifestPath, '[]', 'utf-8').catch(() => {})
    return { success: true }
  })

  ipcMain.handle('notebooklm:getInfographics', async () => {
    const workspaceDir = await readWorkspaceDir()
    return readInfographicManifest(workspaceDir)
  })
}

function manifestPath(workspaceDir: string): string {
  return path.join(workspaceDir, 'previews', 'notebooklm-infographics.json')
}

async function readInfographicManifest(workspaceDir: string): Promise<string[]> {
  try {
    const raw = await fs.readFile(manifestPath(workspaceDir), 'utf-8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((p: unknown) => typeof p === 'string') : []
  } catch {
    return []
  }
}

async function appendToInfographicManifest(workspaceDir: string, imagePath: string): Promise<void> {
  const previewsDir = path.join(workspaceDir, 'previews')
  await fs.mkdir(previewsDir, { recursive: true })
  const existing = await readInfographicManifest(workspaceDir)
  if (!existing.includes(imagePath)) {
    existing.push(imagePath)
  }
  await fs.writeFile(manifestPath(workspaceDir), JSON.stringify(existing, null, 2), 'utf-8')
}
