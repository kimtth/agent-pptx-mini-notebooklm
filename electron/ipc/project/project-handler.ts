/**
 * IPC Handler: Project — workspace directory management and .pptapp save/load
 */

import { ipcMain, dialog, BrowserWindow, app } from 'electron';
import { existsSync } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { readWorkspaceDir, writeWorkspaceDir } from './workspace-utils.ts';
import { saveProjectAsZip, loadProjectFromZip } from './project-zip.ts';

// ---------------------------------------------------------------------------
// Safe dialog helpers — use parent window when available, fall back to modal-less
// ---------------------------------------------------------------------------

type OpenOpts = Parameters<typeof dialog.showOpenDialog>[0];
type SaveOpts = Parameters<typeof dialog.showSaveDialog>[0];

function openDialog(win: BrowserWindow | null, opts: OpenOpts) {
  return win ? dialog.showOpenDialog(win, opts) : dialog.showOpenDialog(opts);
}

function saveDialog(win: BrowserWindow | null, opts: SaveOpts) {
  return win ? dialog.showSaveDialog(win, opts) : dialog.showSaveDialog(opts);
}

function resolveBrandStyleSamplesPath(): string {
  const candidates = [
    path.join(app.getAppPath(), 'out', 'renderer', 'brand-style-samples.html'),
    path.join(process.cwd(), 'public', 'brand-style-samples.html'),
  ];

  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

// ---------------------------------------------------------------------------
// Handler registration
// ---------------------------------------------------------------------------

export function registerProjectHandlers(): void {
  /** Return the current workspace directory, initializing default if needed */
  ipcMain.handle('project:getWorkspaceDir', async () => {
    return readWorkspaceDir();
  });

  /** Show a folder picker and persist the chosen directory */
  ipcMain.handle('project:setWorkspaceDir', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const current = await readWorkspaceDir();
    const { filePaths, canceled } = await openDialog(win, {
      title: 'Select Workspace Folder',
      defaultPath: current,
      properties: ['openDirectory', 'createDirectory'],
    });
    if (canceled || filePaths.length === 0) return null;
    const chosen = filePaths[0];
    await writeWorkspaceDir(chosen);
    return chosen;
  });

  /** Save project data to a .pptapp file — shows native save dialog */
  ipcMain.handle('project:save', async (event, projectData: unknown, suggestedName: string) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const workspaceDir = await readWorkspaceDir();
    const safe = (suggestedName || 'project')
      .replace(/[<>:"/\\|?*]/g, '-')
      .trim()
      .slice(0, 80);

    const { filePath, canceled } = await saveDialog(win, {
      title: 'Save Project',
      defaultPath: path.join(workspaceDir, `${safe}.pptapp`),
      filters: [
        { name: 'PPTX Slide Agent Project', extensions: ['pptapp'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    if (canceled || !filePath) return { success: false };

    await saveProjectAsZip(projectData as any, filePath);
    return { success: true, path: filePath };
  });

  /** Show open dialog filtered to .pptapp, return parsed project data */
  ipcMain.handle('project:load', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const currentDir = await readWorkspaceDir();
    const { filePaths, canceled } = await openDialog(win, {
      title: 'Open Project',
      defaultPath: currentDir,
      filters: [
        { name: 'PPTX Slide Agent Project', extensions: ['pptapp'] },
        { name: 'All Files', extensions: ['*'] },
      ],
      properties: ['openFile'],
    });
    if (canceled || filePaths.length === 0) return null;

    // Switch workspace to the directory containing the .pptapp file
    const newWorkspaceDir = path.dirname(filePaths[0]);
    await writeWorkspaceDir(newWorkspaceDir);

    const parsed = await loadProjectFromZip(filePaths[0], newWorkspaceDir);
    return { data: parsed, path: filePaths[0] };
  });

  /** List all .pptapp files in the workspace dir */
  ipcMain.handle('project:listWorkspaceFiles', async () => {
    const workspaceDir = await readWorkspaceDir();
    try {
      const entries = await fs.readdir(workspaceDir, { withFileTypes: true });
      return entries
        .filter((e) => e.isFile() && e.name.endsWith('.pptapp'))
        .map((e) => ({ name: e.name, path: path.join(workspaceDir, e.name) }));
    } catch {
      return [];
    }
  });

  ipcMain.handle('project:openBrandStyleSamples', async () => {
    const samplePath = resolveBrandStyleSamplesPath();
    if (!existsSync(samplePath)) {
      return { success: false, path: samplePath, error: 'File not found' };
    }
    const win = new BrowserWindow({
      width: 1100,
      height: 800,
      title: 'Brand Style Samples',
      autoHideMenuBar: true,
    });
    win.loadFile(samplePath);
    return { success: true, path: samplePath };
  });
}
