/**
 * Pass 2 — README excerpt + root tree extractor.
 *
 * Runs inside the Pass 2 clone so we capture semantic repo signal once and
 * avoid re-cloning in Pass 3. README gives Gemma "what this repo is";
 * the root tree gives shape ("is this a monorepo", "has docs/", etc.).
 *
 * Best-effort — missing README is normal, not an error.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const README_CANDIDATES = [
  'README.md',
  'README.MD',
  'Readme.md',
  'readme.md',
  'README.rst',
  'README.txt',
  'README',
];

const README_MAX_CHARS = 3000;
const ROOT_TREE_MAX_ENTRIES = 60;

export function extractReadme(cloneDir: string): string | null {
  for (const name of README_CANDIDATES) {
    try {
      const raw = readFileSync(join(cloneDir, name), 'utf8');
      if (raw.trim().length === 0) continue;
      return raw.slice(0, README_MAX_CHARS);
    } catch {
      // not this one — keep trying
    }
  }
  return null;
}

export function extractRootTree(cloneDir: string): string {
  try {
    const entries = readdirSync(cloneDir, { withFileTypes: true })
      .filter((e) => !e.name.startsWith('.git'))
      .slice(0, ROOT_TREE_MAX_ENTRIES)
      .map((e) => {
        const isDir = e.isDirectory();
        if (!isDir) return e.name;
        // For directories, include one level of children to show shape.
        try {
          const childPath = join(cloneDir, e.name);
          const children = readdirSync(childPath, { withFileTypes: true })
            .filter((c) => !c.name.startsWith('.'))
            .slice(0, 6)
            .map((c) => c.name);
          return `${e.name}/ [${children.join(', ')}]`;
        } catch {
          return `${e.name}/`;
        }
      });
    return JSON.stringify(entries);
  } catch {
    return JSON.stringify([]);
  }
}
