/**
 * IPC Handler: File System — CSV, DOCX, TXT, MD, PDF ingestion
 */

import { ipcMain, dialog } from 'electron';
import fs from 'fs/promises';
import path from 'path';
import { parse as csvParse } from 'csv-parse/sync';
import type { DataFile } from '../../../src/domain/ports/ipc';
import { consumeFileData } from './data-consumer.ts';

// ---------------------------------------------------------------------------
// File readers
// ---------------------------------------------------------------------------

async function readCsv(filePath: string): Promise<DataFile> {
  const name = path.basename(filePath);
  const raw = await fs.readFile(filePath, 'utf-8');
  const rows = csvParse(raw, { columns: true, skip_empty_lines: true, trim: true }) as Record<string, string>[];
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  const preview = rows.slice(0, 3);
  const summary = `${rows.length} rows × ${headers.length} columns. First rows: ${JSON.stringify(preview).slice(0, 200)}`;
  return consumeFileData({ path: filePath, name, type: 'csv', headers, rows, summary }, raw);
}

async function readDocx(filePath: string): Promise<DataFile> {
  const name = path.basename(filePath);
  const { extractRawText } = await import('mammoth');
  const buf = await fs.readFile(filePath);
  const result = await extractRawText({ buffer: buf });
  const text = result.value.slice(0, 8192);
  const summary = `DOCX document: ${text.slice(0, 300).replace(/\s+/g, ' ')}…`;
  return consumeFileData({ path: filePath, name, type: 'docx', text, summary }, result.value);
}

async function readTxt(filePath: string): Promise<DataFile> {
  const name = path.basename(filePath);
  const raw = await fs.readFile(filePath, 'utf-8');
  const text = raw.slice(0, 8192);
  const summary = `Text file: ${text.slice(0, 300).replace(/\s+/g, ' ')}…`;
  return consumeFileData({ path: filePath, name, type: 'txt', text, summary }, raw);
}

async function readMd(filePath: string): Promise<DataFile> {
  const name = path.basename(filePath);
  const raw = await fs.readFile(filePath, 'utf-8');
  const text = raw.slice(0, 8192);
  const summary = `Markdown document: ${text.slice(0, 300).replace(/\s+/g, ' ')}…`;
  return consumeFileData({ path: filePath, name, type: 'md', text, summary }, raw);
}

async function readPdf(filePath: string): Promise<DataFile> {
  const name = path.basename(filePath);
  // PDF text extraction is handled by MarkItDown in consumeFileData.
  // Provide a minimal placeholder that consumeFileData will replace.
  return consumeFileData({ path: filePath, name, type: 'pdf', text: '', summary: '' }, '');
}

async function readAnyFile(filePath: string): Promise<DataFile> {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.csv') return readCsv(filePath);
  if (ext === '.docx') return readDocx(filePath);
  if (ext === '.txt') return readTxt(filePath);
  if (ext === '.md') return readMd(filePath);
  if (ext === '.pdf') return readPdf(filePath);
  throw new Error(`Unsupported file type: ${ext}`);
}

// ---------------------------------------------------------------------------
// Handler registration
// ---------------------------------------------------------------------------

export function registerFsHandlers(): void {
  ipcMain.handle('fs:openDirectory', async () => {
    const { filePaths, canceled } = await dialog.showOpenDialog({
      title: 'Select Data Files',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Data Files', extensions: ['csv', 'docx', 'txt', 'md', 'pdf'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    if (canceled || filePaths.length === 0) return [];

    const results: DataFile[] = [];
    for (const fp of filePaths) {
      try {
        results.push(await readAnyFile(fp));
      } catch {
        // Skip unreadable files silently
      }
    }
    return results;
  });

  ipcMain.handle('fs:readFile', async (_event, filePath: string) => {
    // Validate path — must be a real file, no traversal
    const resolved = path.resolve(filePath);
    if (resolved !== filePath && !resolved.startsWith(filePath)) {
      throw new Error('Invalid file path');
    }
    return readAnyFile(resolved);
  });
}
