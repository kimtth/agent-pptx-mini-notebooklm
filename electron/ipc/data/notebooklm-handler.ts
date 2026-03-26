/**
 * IPC handler: NotebookLM integration
 *
 * Manages a long-lived Python child process (stdio JSON-RPC server) to keep
 * a single NotebookLMClient session alive across requests, avoiding repeated
 * process spawn / auth overhead.
 */

import { ipcMain, app } from 'electron'
import path from 'path'
import { exec, spawn, ChildProcess } from 'child_process'
import { createInterface } from 'readline'
import fs from 'fs/promises'
import { ensurePythonModule, resolvePythonExecutable } from '../pptx/python-runtime.ts'
import { readWorkspaceDir, resolveBundledPath } from '../project/workspace-utils.ts'

// ---------------------------------------------------------------------------
// Persistent Python server process
// ---------------------------------------------------------------------------

let serverProcess: ChildProcess | null = null
let requestIdCounter = 0
const pendingRequests = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
let serverReady: Promise<void> | null = null

async function ensureServer(): Promise<void> {
  if (serverProcess && !serverProcess.killed) {
    await serverReady
    return
  }

  const python = await resolvePythonExecutable()
  await ensurePythonModule(
    python,
    'notebooklm',
    'Run the following inside the project .venv:\n' +
    '  pip install "notebooklm-py[browser]"\n' +
    '  npx playwright install chromium',
  )
  const scriptPath = resolveBundledPath('scripts/notebooklm_generate.py')

  const proc = spawn(python, [scriptPath], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  serverProcess = proc

  proc.stderr?.on('data', (d: Buffer) => {
    console.warn('[notebooklm-server] stderr:', d.toString().trim())
  })

  // Line-based stdout reader — each line is a JSON response
  const rl = createInterface({ input: proc.stdout!, crlfDelay: Infinity })
  rl.on('line', (line: string) => {
    if (!line.trim()) return
    try {
      const msg = JSON.parse(line)
      // Status messages (startup) don't have an id
      if (msg.status) {
        console.log('[notebooklm-server]', msg.status, msg.authenticated != null ? `(auth=${msg.authenticated})` : '')
        return
      }
      const id = msg.id as number | undefined
      if (id != null && pendingRequests.has(id)) {
        const { resolve, reject } = pendingRequests.get(id)!
        pendingRequests.delete(id)
        if (msg.error) {
          reject(new Error(msg.error))
        } else {
          resolve(msg.result)
        }
      }
    } catch {
      console.warn('[notebooklm-server] non-JSON line:', line.slice(0, 200))
    }
  })

  proc.on('close', (code) => {
    console.log('[notebooklm-server] process exited with code', code)
    serverProcess = null
    // Reject all pending requests
    for (const [, { reject }] of pendingRequests) {
      reject(new Error(`NotebookLM server exited unexpectedly (code ${code})`))
    }
    pendingRequests.clear()
  })

  // Wait for the "ready" message
  serverReady = new Promise<void>((resolve) => {
    const lineHandler = (line: string) => {
      try {
        const msg = JSON.parse(line)
        if (msg.status === 'ready') {
          rl.removeListener('line', lineHandler)
          resolve()
        }
      } catch { /* ignore non-JSON during startup */ }
    }
    rl.on('line', lineHandler)
  })

  await serverReady
}

function stopServer(): void {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.stdin?.end()
    serverProcess.kill()
    serverProcess = null
  }
}

async function sendCommand(command: string, args: Record<string, unknown> = {}): Promise<unknown> {
  await ensureServer()
  const id = ++requestIdCounter
  const request = JSON.stringify({ id, command, args }) + '\n'

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(id)
      reject(new Error(`notebooklm ${command}: timed out after 5 minutes`))
    }, 300_000)

    pendingRequests.set(id, {
      resolve: (v) => { clearTimeout(timeout); resolve(v) },
      reject: (e) => { clearTimeout(timeout); reject(e) },
    })

    try {
      serverProcess!.stdin!.write(request, 'utf-8')
    } catch (err) {
      pendingRequests.delete(id)
      clearTimeout(timeout)
      // Server died — kill it so next call respawns
      stopServer()
      reject(err instanceof Error ? err : new Error(String(err)))
    }
  })
}

export function registerNotebookLMHandlers(): void {
  // Shut down the persistent server when Electron quits
  app.on('will-quit', () => stopServer())

  ipcMain.handle('notebooklm:authStatus', async () => {
    return sendCommand('auth_status')
  })

  ipcMain.handle('notebooklm:setupAuth', async () => {
    // Kill the existing server so the next command spawns a fresh one
    // that picks up the new session after the user completes login.
    stopServer()
    try {
      const python = await resolvePythonExecutable()
      // On Windows, open a dedicated console window and run the login command
      // there so the user owns the CLI flow completely.
      if (process.platform === 'win32') {
        // `start` is a cmd.exe built-in that always opens a new visible window.
        // `exec` runs through cmd.exe by default, so `start` works directly.
        // `/k` keeps the console open for the interactive login flow.
        exec(`start "NotebookLM Login" cmd /k "${python}" -m notebooklm login`, (err) => {
          if (err) console.error('[notebooklm:setupAuth] exec error:', err)
        })
      } else {
        const proc = spawn(python, ['-m', 'notebooklm', 'login'], {
          detached: true,
          stdio: 'inherit',
          windowsHide: false,
        })
        proc.on('close', (code: number | null) => console.log('[notebooklm login] exited with code', code))
      }
      return {
        success: true,
        message:
          'A console window was opened and `python -m notebooklm login` was started there. ' +
          'Complete sign-in in the browser, then follow the CLI prompt in that console.\n\n' +
          'Prerequisites (run once in the project .venv if the browser does not open):\n' +
          '  pip install "notebooklm-py[browser]"\n' +
          '  npx playwright install chromium',
      }
    } catch (error) {
      console.error('[notebooklm:setupAuth] error:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        message: 'Could not open login window. Run python -m notebooklm login in a terminal.',
      }
    }
  })

  ipcMain.handle('notebooklm:list', async () => {
    return sendCommand('list')
  })

  ipcMain.handle('notebooklm:createNotebook', async (_, title: string) => {
    return sendCommand('create_notebook', { title })
  })

  ipcMain.handle('notebooklm:uploadSources', async (
    _,
    notebookId: string,
    sources: { files?: Array<{ path: string; mime?: string }>; texts?: Array<{ title: string; content: string }>; urls?: string[] },
  ) => {
    return sendCommand('upload_sources', {
      notebookId,
      files: sources.files ?? [],
      texts: sources.texts ?? [],
      urls: sources.urls ?? [],
    })
  })

  ipcMain.handle('notebooklm:generateInfographic', async (_, notebookId: string, options?: { orientation?: string; detailLevel?: string }) => {
    const workspaceDir = await readWorkspaceDir()
    const outputDir = path.join(workspaceDir, 'images')
    await fs.mkdir(outputDir, { recursive: true })
    const outputPath = path.join(outputDir, `notebooklm-infographic-${Date.now()}.png`)

    const result = await sendCommand('infographic', {
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

    return sendCommand('slide_deck', {
      notebookId,
      outputPath,
      format: fmt,
    })
  })

  ipcMain.handle('notebooklm:clearInfographics', async () => {
    const workspaceDir = await readWorkspaceDir()
    const manifestPath = path.join(workspaceDir, 'previews', 'notebooklm-infographics.json')
    await fs.writeFile(manifestPath, '[]', 'utf-8').catch(() => { })
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
