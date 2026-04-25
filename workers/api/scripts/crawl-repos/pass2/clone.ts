/**
 * Pass 2: Shallow clone
 *
 * Clones a repo to a temp directory using:
 *   git clone --depth 1 --filter=blob:limit=1m
 *
 * Guarantees cleanup via a finally block.
 * Returns the list of all relative file paths in the cloned repo.
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { logger } from '../shared/logger.js';

const CLONE_TIMEOUT_MS = 120_000; // 2 minutes per repo

/**
 * Clones a GitHub repo to a unique temp directory, runs `fn` with the dir,
 * then deletes the clone unconditionally.
 *
 * The temp dir path is `/tmp/pipe-crawl/{repoId}/`.
 */
export async function withClone<T>(
  fullName: string,
  repoId: number,
  fn: (cloneDir: string, filePaths: string[]) => Promise<T>,
): Promise<T> {
  const tmpBase = path.join(os.tmpdir(), 'pipe-crawl');
  const cloneDir = path.join(tmpBase, String(repoId));

  // Clean up any leftover from a previous run
  if (fs.existsSync(cloneDir)) {
    fs.rmSync(cloneDir, { recursive: true, force: true });
  }
  fs.mkdirSync(cloneDir, { recursive: true });

  try {
    const url = `https://github.com/${fullName}.git`;
    logger.debug('[pass2/clone] Cloning', { fullName, cloneDir });

    execSync(
      `git clone --depth 1 --filter=blob:limit=1m --quiet "${url}" .`,
      {
        cwd: cloneDir,
        timeout: CLONE_TIMEOUT_MS,
        stdio: 'pipe',
      },
    );

    logger.debug('[pass2/clone] Clone complete', { fullName });

    const filePaths = collectFilePaths(cloneDir);
    logger.debug('[pass2/clone] File paths collected', { fullName, count: filePaths.length });

    return await fn(cloneDir, filePaths);
  } finally {
    try {
      fs.rmSync(cloneDir, { recursive: true, force: true });
      logger.debug('[pass2/clone] Clone cleaned up', { fullName });
    } catch (err) {
      logger.warn('[pass2/clone] Cleanup failed', {
        fullName,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/**
 * Recursively collects all relative file paths in a directory.
 * Excludes `.git/` and binary-only extensions.
 */
function collectFilePaths(dir: string, relativeTo = dir): string[] {
  const results: string[] = [];
  const SKIP_DIRS = new Set(['.git', 'node_modules', '__pycache__', '.cache', 'vendor', '.venv', 'venv']);
  const SKIP_EXTS = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp',
    '.woff', '.woff2', '.ttf', '.eot',
    '.pdf', '.zip', '.tar', '.gz', '.bz2',
    '.exe', '.dll', '.so', '.dylib',
    '.mp4', '.mp3', '.mov', '.avi',
    '.lock',
  ]);

  function walk(current: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return; // Permission denied etc.
    }

    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;

      const full = path.join(current, entry.name);
      const rel = path.relative(relativeTo, full);

      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (!SKIP_EXTS.has(ext)) {
          results.push(rel);
        }
      }
    }
  }

  walk(dir);
  return results;
}
