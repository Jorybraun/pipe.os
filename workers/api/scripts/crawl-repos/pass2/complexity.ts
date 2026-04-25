/**
 * Pass 2: Complexity metrics
 *
 * Runs scc (source code counter) and lizard (cyclomatic complexity) if available.
 * Falls back to counting source files when tools are not installed.
 *
 * Install scc:  https://github.com/boyter/scc (brew install scc)
 * Install lizard: pip install lizard
 */

import { execSync } from 'node:child_process';
import path from 'node:path';
import { logger } from '../shared/logger.js';

export interface ComplexityResult {
  sloc: number;
  fileCount: number;
  meanCcn: number;
}

const SOURCE_EXTS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mts', '.mjs',
  '.py', '.go', '.rs', '.java', '.kt',
  '.rb', '.php', '.cs', '.cpp', '.c',
  '.swift', '.scala', '.clj',
]);

/**
 * Counts SLOC using scc, or falls back to counting source files.
 */
export function measureComplexity(repoDir: string, filePaths: string[]): ComplexityResult {
  const sccResult = tryScc(repoDir);
  if (sccResult) {
    const ccnResult = tryLizard(repoDir);
    return {
      sloc: sccResult.sloc,
      fileCount: sccResult.fileCount,
      meanCcn: ccnResult ?? estimateCcn(filePaths),
    };
  }

  // Fallback: count source files and estimate SLOC
  return fallbackMetrics(filePaths);
}

// ─── scc ─────────────────────────────────────────────────────────────────────

interface SccResult {
  sloc: number;
  fileCount: number;
}

function tryScc(repoDir: string): SccResult | null {
  try {
    const output = execSync('scc --format json .', {
      cwd: repoDir,
      timeout: 30_000,
      stdio: 'pipe',
    }).toString();

    const data = JSON.parse(output) as Array<{
      Count: number;
      Code: number;
    }>;

    const sloc = data.reduce((sum, lang) => sum + (lang.Code ?? 0), 0);
    const fileCount = data.reduce((sum, lang) => sum + (lang.Count ?? 0), 0);
    return { sloc, fileCount };
  } catch {
    logger.debug('[pass2/complexity] scc not available or failed — using fallback');
    return null;
  }
}

// ─── lizard ──────────────────────────────────────────────────────────────────

function tryLizard(repoDir: string): number | null {
  try {
    // lizard outputs a summary line: "Total nloc 12345, ... CCN 2.34"
    const output = execSync('lizard -l javascript -l typescript -l python -l java -l cpp --csv .', {
      cwd: repoDir,
      timeout: 60_000,
      stdio: 'pipe',
    }).toString();

    const lines = output.split('\n').filter((l) => l.trim());
    if (lines.length === 0) return null;

    // Parse CSV: function_name,file,start,end,nloc,ccn,token,param
    let totalCcn = 0;
    let count = 0;
    for (const line of lines.slice(1)) { // skip header
      const cols = line.split(',');
      const ccn = parseFloat(cols[5] ?? '');
      if (!isNaN(ccn)) {
        totalCcn += ccn;
        count++;
      }
    }

    return count > 0 ? totalCcn / count : null;
  } catch {
    logger.debug('[pass2/complexity] lizard not available — estimating CCN');
    return null;
  }
}

// ─── Fallback metrics ─────────────────────────────────────────────────────────

function fallbackMetrics(filePaths: string[]): ComplexityResult {
  const sourceFiles = filePaths.filter((f) => SOURCE_EXTS.has(path.extname(f).toLowerCase()));
  // Rough estimate: 100 SLOC per source file on average
  return {
    sloc: sourceFiles.length * 100,
    fileCount: sourceFiles.length,
    meanCcn: estimateCcn(filePaths),
  };
}

/**
 * Very rough CCN estimate based on test presence and project type.
 * Used when lizard is not available.
 */
function estimateCcn(filePaths: string[]): number {
  const hasTests = filePaths.some((f) => /\.(test|spec)\.|__tests__|\/test\/|\/tests\//.test(f));
  return hasTests ? 3.5 : 5.0;
}
