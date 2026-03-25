import fs from 'fs/promises';
import path from 'path';
import { createHash } from 'crypto';
import { promisify } from 'util';
import { execFile } from 'child_process';
import type { DataFile, ScrapeResult, SourceArtifact } from '../../../src/domain/ports/ipc';
import { readWorkspaceDir } from '../project/workspace-utils.ts';
import { resolveBundledPath } from '../project/workspace-utils.ts';
import { resolvePythonExecutable } from '../pptx/python-runtime.ts';

const execFileAsync = promisify(execFile);
const MAX_SUMMARY_LEN = 1800;

interface ConversionResult {
  title: string;
  markdown: string;
}

interface FallbackSourceInput {
  title?: string;
  text: string;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'source';
}

function hashValue(value: string): string {
  return createHash('sha1').update(value).digest('hex').slice(0, 10);
}

function contentsDir(workspaceDir: string): string {
  return path.join(workspaceDir, 'contents');
}

function sourceArtifactsDir(workspaceDir: string): string {
  return path.join(contentsDir(workspaceDir), 'data-sources');
}

async function ensureArtifactsDir(): Promise<string> {
  const workspaceDir = await readWorkspaceDir();
  await fs.mkdir(contentsDir(workspaceDir), { recursive: true });
  const dir = sourceArtifactsDir(workspaceDir);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

function markitdownScriptPath(): string {
  return resolveBundledPath('scripts', 'markitdown_convert.py');
}

async function runMarkItDown(source: string): Promise<ConversionResult> {
  const python = await resolvePythonExecutable();
  const scriptPath = markitdownScriptPath();
  const { stdout } = await execFileAsync(
    python,
    [scriptPath, '--source', source],
    { timeout: 120_000, windowsHide: true, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } },
  );

  const parsed = JSON.parse(stdout) as { ok: boolean; markdown?: string; title?: string; error?: string };
  if (!parsed.ok || !parsed.markdown) {
    throw new Error(parsed.error || 'MarkItDown conversion failed');
  }

  return {
    title: parsed.title?.trim() || '',
    markdown: parsed.markdown,
  };
}

function truncateAsSummary(markdown: string): string {
  return markdown.replace(/\s+/g, ' ').trim().slice(0, MAX_SUMMARY_LEN);
}

async function writeArtifacts(sourceId: string, title: string, markdown: string, summaryText: string): Promise<SourceArtifact> {
  const dir = await ensureArtifactsDir();
  const baseName = `${slugify(title || sourceId)}-${hashValue(sourceId)}`;
  const markdownPath = path.join(dir, `${baseName}.source.md`);
  const summaryPath = path.join(dir, `${baseName}.summary.md`);
  await fs.writeFile(markdownPath, markdown, 'utf-8');
  await fs.writeFile(summaryPath, summaryText, 'utf-8');
  return { markdownPath, summaryPath, summaryText };
}

async function consumeSource(
  sourceId: string,
  sourceType: 'file' | 'url',
  fallback: FallbackSourceInput,
): Promise<{ artifact: SourceArtifact; title: string; markdown: string }> {
  await ensureArtifactsDir();

  let converted: ConversionResult;
  try {
    converted = await runMarkItDown(sourceId);
  } catch {
    converted = {
      title: fallback.title ?? '',
      markdown: fallback.text,
    };
  }

  const title = converted.title || fallback.title || path.basename(sourceId);
  const summaryText = truncateAsSummary(converted.markdown);
  const artifact = await writeArtifacts(sourceId, title, converted.markdown, summaryText);
  return { artifact, title, markdown: converted.markdown };
}

export async function consumeFileData(
  file: DataFile,
  fallbackText: string,
): Promise<DataFile> {
  const consumed = await consumeSource(file.path, 'file', { title: file.name, text: fallbackText });
  return {
    ...file,
    text: consumed.markdown.slice(0, 8192),
    summary: consumed.artifact.summaryText.replace(/\s+/g, ' ').slice(0, 300),
    consumed: consumed.artifact,
  };
}

export async function consumeUrlData(
  url: string,
  fallback: { title: string; text: string; lists: string[] },
): Promise<ScrapeResult> {
  const fallbackText = [fallback.title, fallback.text, ...fallback.lists].filter(Boolean).join('\n\n');
  const consumed = await consumeSource(url, 'url', { title: fallback.title || url, text: fallbackText });

  const listLines = consumed.artifact.summaryText
    .split('\n')
    .filter((line) => /^-\s+/.test(line))
    .map((line) => line.replace(/^-\s+/, '').trim())
    .slice(0, 10);

  return {
    url,
    title: consumed.title,
    text: consumed.markdown.slice(0, 8192),
    lists: listLines,
    consumed: consumed.artifact,
  };
}
