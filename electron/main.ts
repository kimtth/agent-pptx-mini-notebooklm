/**
 * Electron Main Process
 */

// Suppress Node.js experimental warnings (e.g. SQLite) in CLI subprocesses
process.env.NODE_NO_WARNINGS = '1';

import { app, BrowserWindow, shell } from 'electron';
import { net, protocol } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { pathToFileURL } from 'url';
import { registerChatHandlers } from './ipc/llm/chat-handler.ts';
import { registerPptxHandlers } from './ipc/pptx/pptx-handler.ts';
import { registerThemeHandlers } from './ipc/config/theme-handler.ts';
import { registerFsHandlers } from './ipc/data/fs-handler.ts';
import { registerScrapeHandlers } from './ipc/data/scrape-handler.ts';
import { registerImageHandlers } from './ipc/data/image-handler.ts';
import { registerSettingsHandlers, applySettingsToEnv } from './ipc/config/settings-handler.ts';
import { registerProjectHandlers } from './ipc/project/project-handler.ts';
import { registerNotebookLMHandlers } from './ipc/data/notebooklm-handler.ts';
import { readWorkspaceDir } from './ipc/project/workspace-utils.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;

function registerLocalImageProtocol(): void {
  protocol.handle('pptx-local', async (request) => {
    const url = new URL(request.url)
    const filePath = url.searchParams.get('path')
    if (!filePath) {
      return new Response('Missing path', { status: 400 })
    }

    const workspaceDir = await readWorkspaceDir()
    const resolvedPath = path.resolve(filePath)
    const allowedRoots = [
      path.resolve(path.join(workspaceDir, 'previews')),
      path.resolve(path.join(workspaceDir, 'images')),
    ]
    const isAllowed = allowedRoots.some((root) => resolvedPath === root || resolvedPath.startsWith(`${root}${path.sep}`))

    if (!isAllowed) {
      return new Response('Forbidden path', { status: 403 })
    }

    return net.fetch(pathToFileURL(resolvedPath).toString())
  })
}

process.on('unhandledRejection', (reason) => {
  console.error('[main] Unhandled promise rejection', reason);
});

process.on('uncaughtException', (error) => {
  console.error('[main] Uncaught exception', error);
});

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    backgroundColor: '#f4f5f7',
    titleBarStyle: 'hiddenInset',
    frame: process.platform !== 'darwin',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Load app
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // Open external links in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });
}

app.whenReady()
  .then(async () => {
    // Apply persisted settings to process.env before creating handlers
    await applySettingsToEnv();
    registerLocalImageProtocol();

    // Register all IPC handlers (pass mainWindow getter for streaming)
    const getWindow = () => mainWindow;
    registerSettingsHandlers();
    registerProjectHandlers();
    registerChatHandlers(getWindow);
    registerPptxHandlers();
    registerThemeHandlers();
    registerFsHandlers();
    registerScrapeHandlers();
    registerImageHandlers();
    registerNotebookLMHandlers();

    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  })
  .catch((error) => {
    console.error('[main] Failed during app bootstrap', error);
    app.quit();
  });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
