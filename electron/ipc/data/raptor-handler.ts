/**
 * raptor-handler.ts — Thin IPC wrapper for RAPTOR Python scripts.
 *
 * Calls raptor_builder.py (at ingestion time) and raptor_retriever.py
 * (at generation time) via execFile, following the same pattern as
 * data-consumer.ts / image-handler.ts.
 */

import { promisify } from 'util';
import { execFile } from 'child_process';
import { resolveBundledPath } from '../project/workspace-utils.ts';
import { resolvePythonExecutable } from '../pptx/python-runtime.ts';

const execFileAsync = promisify(execFile);

const BUILDER_TIMEOUT_MS = 120_000; // 2 minutes for building RAPTOR index
const RETRIEVER_TIMEOUT_MS = 30_000; // 30 seconds for retrieval

// ---------------------------------------------------------------------------
// RAPTOR builder — called at document ingestion time
// ---------------------------------------------------------------------------

export interface RaptorBuildResult {
  ok: boolean;
  sections: number;
  path: string;
  error?: string;
}

/**
 * Build a RAPTOR tree from raw markdown and write the structured summary.
 *
 * @param markdownPath - Path to the .source.md file (from MarkItDown)
 * @param outputPath   - Path to write .structured-summary.json
 * @param title        - Document title
 */
export async function buildRaptorTree(
  markdownPath: string,
  outputPath: string,
  title: string,
): Promise<RaptorBuildResult> {
  const python = await resolvePythonExecutable();
  const scriptPath = resolveBundledPath('scripts', 'raptor', 'raptor_builder.py');

  const { stdout } = await execFileAsync(
    python,
    [scriptPath, '--markdown-path', markdownPath, '--output-path', outputPath, '--title', title],
    {
      timeout: BUILDER_TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    },
  );

  const result = JSON.parse(stdout) as RaptorBuildResult;
  return result;
}

// ---------------------------------------------------------------------------
// RAPTOR retriever — called at PPTX generation time (per chunk)
// ---------------------------------------------------------------------------

export interface RetrievedSection {
  heading: string;
  text: string;
  score: number;
  clusterContext: string[];
}

/**
 * Retrieve the top-K relevant sections for a set of query strings.
 *
 * @param summaryPath - Path to .structured-summary.json (with raptorTree)
 * @param queries     - Query strings (e.g., slide titles + keyMessages)
 * @param topK        - Number of sections to return
 */
export async function retrieveContext(
  summaryPath: string,
  queries: string[],
  topK: number = 8,
): Promise<RetrievedSection[]> {
  const python = await resolvePythonExecutable();
  const scriptPath = resolveBundledPath('scripts', 'raptor', 'raptor_retriever.py');

  const { stdout } = await execFileAsync(
    python,
    [
      scriptPath,
      '--summary-path', summaryPath,
      '--queries-json', JSON.stringify(queries),
      '--top-k', String(topK),
    ],
    {
      timeout: RETRIEVER_TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    },
  );

  return JSON.parse(stdout) as RetrievedSection[];
}

/**
 * Check if a structured summary has a RAPTOR tree (vs old format).
 */
export function hasRaptorTree(structuredSummary: Record<string, unknown>): boolean {
  return (
    structuredSummary != null
    && typeof structuredSummary === 'object'
    && 'raptorTree' in structuredSummary
    && structuredSummary.raptorTree != null
  );
}
