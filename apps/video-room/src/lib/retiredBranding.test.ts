import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const roomRoot = process.cwd();

const retiredPhrases = [
  ['95', ' Until ', 'Infinity'],
  ['Until ', 'Infinity'],
  ['Windows ', '95'],
  ['Win', '95'],
  ['Clip', 'py'],
  ['paper', 'clip'],
  ['retro ', 'desktop'],
  ['desktop ', 'simulation'],
  ['MS ', 'Paint'],
  ['Microsoft ', 'Edge'],
  ['Start ', 'menu'],
  ['start ', 'menu'],
  ['task', 'bar'],
].map((parts) => parts.join(''));

const scannedExtensions = new Set(['.css', '.html', '.js', '.json', '.ts', '.tsx']);

function hasScannedExtension(pathname: string): boolean {
  const lower = pathname.toLowerCase();
  return [...scannedExtensions].some((extension) => lower.endsWith(extension));
}

async function collectFiles(pathname: string): Promise<string[]> {
  const entries = await readdir(pathname, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const fullPath = join(pathname, entry.name);
    if (entry.isDirectory()) return collectFiles(fullPath);
    if (!entry.isFile() || !hasScannedExtension(fullPath)) return [];
    return [fullPath];
  }));
  return files.flat();
}

describe('retired assessment-room branding', () => {
  it('does not reintroduce the retired novelty room surface', async () => {
    const roots = ['index.html', 'public', 'src'];
    const files = (await Promise.all(roots.map(async (root) => {
      const fullPath = join(roomRoot, root);
      if (hasScannedExtension(fullPath)) return [fullPath];
      return collectFiles(fullPath);
    }))).flat();

    const matches: string[] = [];
    for (const file of files) {
      const contents = await readFile(file, 'utf8');
      for (const phrase of retiredPhrases) {
        if (contents.toLowerCase().includes(phrase.toLowerCase())) {
          matches.push(`${relative(roomRoot, file)}: ${phrase}`);
        }
      }
    }

    expect(matches).toEqual([]);
  });
});
