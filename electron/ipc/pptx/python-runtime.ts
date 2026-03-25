import fs from 'fs/promises'
import path from 'path'
import { existsSync } from 'fs'
import { app } from 'electron'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { getAppResourceRoots } from '../project/workspace-utils.ts'

const execFileAsync = promisify(execFile)

function localPythonCandidates(): string[] {
  const baseDirs = getAppResourceRoots().flatMap((root) => [
    path.join(root, '.venv'),
    path.join(root, 'venv'),
  ]).filter((baseDir, index, values) => values.indexOf(baseDir) === index)

  return process.platform === 'win32'
    ? baseDirs.map((baseDir) => path.join(baseDir, 'Scripts', 'python.exe'))
    : baseDirs.map((baseDir) => path.join(baseDir, 'bin', 'python'))
}

export function pythonSetupHint(): string {
  if (app.isPackaged) {
    return 'The packaged app needs a bundled .venv under the app resources directory. Rebuild with an existing .venv.'
  }

  return 'Run "pnpm setup:python-env" to prepare .venv.'
}

export async function resolvePythonExecutable(): Promise<string> {
  const candidates: string[] = []

  candidates.push(...localPythonCandidates())

  const uvPythonRoot = process.env.APPDATA
    ? path.join(process.env.APPDATA, 'uv', 'python')
    : ''

  if (uvPythonRoot) {
    try {
      const entries = await fs.readdir(uvPythonRoot, { withFileTypes: true })
      const versions = entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(uvPythonRoot, entry.name, 'python.exe'))
        .reverse()
      candidates.push(...versions)
    } catch {
      // ignore missing uv installs
    }
  }

  candidates.push('python')

  for (const candidate of candidates) {
    try {
      if (candidate.includes(path.sep) && !existsSync(candidate)) continue
      await execFileAsync(
        candidate,
        ['-c', 'import sys; assert sys.version_info >= (3, 10); print(sys.executable)'],
        { timeout: 30_000, windowsHide: true },
      )
      return candidate
    } catch {
      // try next
    }
  }

  throw new Error(`Python 3.10+ is required. ${pythonSetupHint()}`)
}

export async function ensurePythonModule(python: string, moduleName: string, installHint: string): Promise<void> {
  try {
    await execFileAsync(
      python,
      ['-c', `import ${moduleName}`],
      { timeout: 30_000, windowsHide: true },
    )
  } catch {
    throw new Error(`Python module "${moduleName}" is required. ${installHint}`)
  }
}
