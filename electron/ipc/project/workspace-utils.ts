import { app } from 'electron';
import { existsSync } from 'fs';
import fs from 'fs/promises';
import path from 'path';

export function getAppResourceRoots(): string[] {
  const roots = [
    app.isPackaged ? process.resourcesPath : '',
    app.getAppPath(),
    process.cwd(),
  ]

  return roots
    .filter(Boolean)
    .map((root) => path.resolve(root))
    .filter((root, index, values) => values.indexOf(root) === index)
}

export function resolveBundledPath(...segments: string[]): string {
  for (const root of getAppResourceRoots()) {
    const candidate = path.join(root, ...segments)
    if (existsSync(candidate)) return candidate
  }

  return path.join(getAppResourceRoots()[0] ?? process.cwd(), ...segments)
}

function workspaceConfigPath(): string {
  return path.join(app.getPath('userData'), 'workspace.json');
}

export async function readWorkspaceDir(): Promise<string> {
  try {
    const raw = await fs.readFile(workspaceConfigPath(), 'utf-8');
    const parsed = JSON.parse(raw) as { dir?: string };
    if (parsed.dir) return parsed.dir;
  } catch {
    // fall through to default
  }

  const defaultDir = path.join(app.getPath('documents'), 'PPTX Slide Agent');
  await fs.mkdir(defaultDir, { recursive: true });
  await writeWorkspaceDir(defaultDir);
  return defaultDir;
}

export async function writeWorkspaceDir(dir: string): Promise<void> {
  const cfg = workspaceConfigPath();
  await fs.mkdir(path.dirname(cfg), { recursive: true });
  await fs.writeFile(cfg, JSON.stringify({ dir }, null, 2), 'utf-8');
}
