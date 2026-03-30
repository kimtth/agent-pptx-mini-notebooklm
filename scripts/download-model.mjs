/**
 * Download the multilingual-e5-small ONNX embedding model.
 *
 * Called automatically during `pnpm dist` (before electron-builder) and can
 * also be invoked standalone via `pnpm setup:models`.
 *
 * The script delegates to the Python download_model.py which fetches the
 * INT8-quantized ONNX model (~118 MB) and tokenizer from HuggingFace.
 * If the model already exists locally it is skipped (idempotent).
 */

import { access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modelDir = path.join(projectRoot, 'resources', 'models', 'embed');
const modelFile = path.join(modelDir, 'model.onnx');

const venvDir = path.join(projectRoot, '.venv');
const pythonPath = process.platform === 'win32'
  ? path.join(venvDir, 'Scripts', 'python.exe')
  : path.join(venvDir, 'bin', 'python');

const downloadScript = path.join(projectRoot, 'scripts', 'raptor', 'download_model.py');

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      stdio: 'inherit',
      shell: false,
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) return resolve();
      reject(new Error(`${command} ${args.join(' ')} exited with code ${code ?? 'unknown'}`));
    });
  });
}

async function fileExists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  // Quick check — skip if model already downloaded
  if (await fileExists(modelFile)) {
    const { statSync } = await import('node:fs');
    const size = statSync(modelFile).size;
    if (size > 1_000_000) {
      console.log(`Embedding model already exists (${(size / 1024 / 1024).toFixed(1)} MB) — skipping download.`);
      return;
    }
  }

  console.log('Downloading embedding model (multilingual-e5-small, ~118 MB)...');

  // Prefer .venv Python if available, else fall back to uv run
  if (await fileExists(pythonPath)) {
    await run(pythonPath, [downloadScript]);
  } else {
    await run('uv', ['run', 'python', downloadScript]);
  }

  console.log('Embedding model ready.');
}

main().catch((error) => {
  console.error('Model download failed:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
