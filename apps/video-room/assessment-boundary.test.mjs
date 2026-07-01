import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, relative } from 'node:path';

const appRoot = process.cwd();
const repoRoot = join(appRoot, '..', '..');

const scannedRoomEntries = [
  'index.html',
  'public',
  'src',
];

const textFileExtensions = new Set([
  '',
  '.cjs',
  '.css',
  '.csv',
  '.html',
  '.js',
  '.json',
  '.jsonc',
  '.md',
  '.mjs',
  '.sh',
  '.sql',
  '.svg',
  '.ts',
  '.tsx',
  '.txt',
  '.xml',
  '.yaml',
  '.yml',
]);

const encodedRetiredProductPhrases = [
  [57, 53, 32, 117, 110, 116, 105, 108, 32, 105, 110, 102, 105, 110, 105, 116, 121],
  [57, 53, 32, 116, 111, 32, 105, 110, 102, 105, 110, 105, 116, 121],
  [57, 53, 32, 116, 105, 108, 32, 105, 110, 102, 105, 110, 105, 116, 121],
  [57, 53, 32, 116, 105, 108, 108, 32, 105, 110, 102, 105, 110, 105, 116, 121],
  [117, 110, 116, 105, 108, 32, 105, 110, 102, 105, 110, 105, 116, 121],
  [119, 105, 110, 100, 111, 119, 115, 32, 57, 53],
  [119, 105, 110, 100, 111, 119, 115, 32, 57, 53, 32, 109, 111, 100, 101],
  [119, 105, 110, 57, 53],
  [119, 105, 110, 57, 53, 32, 109, 111, 100, 101],
  [119, 105, 110, 100, 111, 119, 115, 57, 53],
  [99, 108, 105, 112, 112, 121],
  [112, 97, 112, 101, 114, 99, 108, 105, 112],
  [114, 101, 116, 114, 111, 32, 100, 101, 115, 107, 116, 111, 112],
  [100, 101, 115, 107, 116, 111, 112, 32, 115, 105, 109, 117, 108, 97, 116, 105, 111, 110],
  [116, 97, 115, 107, 98, 97, 114],
  [115, 116, 97, 114, 116, 32, 109, 101, 110, 117],
  [109, 115, 32, 112, 97, 105, 110, 116],
  [112, 97, 105, 110, 116, 32, 99, 108, 111, 110, 101],
  [109, 105, 99, 114, 111, 115, 111, 102, 116, 32, 101, 100, 103, 101],
  [115, 104, 97, 114, 101, 100, 32, 100, 101, 115, 107, 116, 111, 112],
  [115, 104, 97, 114, 101, 100, 32, 99, 117, 114, 115, 111, 114],
  [99, 117, 114, 115, 111, 114, 32, 116, 114, 97, 105, 108],
];

const encodedRetiredRoomPhrases = [
  [115, 116, 97, 114, 116, 32, 100, 101, 118, 105, 110, 32, 98, 114, 105, 100, 103, 101],
  [100, 101, 118, 105, 110, 32, 98, 114, 105, 100, 103, 101],
  [100, 101, 118, 105, 110, 32, 99, 104, 97, 116],
  [97, 105, 32, 97, 115, 115, 105, 115, 116, 97, 110, 116],
  [97, 115, 115, 101, 115, 115, 109, 101, 110, 116, 32, 97, 115, 115, 105, 115, 116, 97, 110, 116],
  [97, 115, 115, 105, 115, 116, 97, 110, 116, 32, 108, 97, 117, 110, 99, 104, 101, 114],
];

function regexFromPhrase(encodedPhrase) {
  const phrase = String.fromCharCode(...encodedPhrase);
  const escapedPhrase = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(escapedPhrase.replace(/\s+/g, '[\\s_-]+'), 'i');
}

const forbiddenProductPatterns = encodedRetiredProductPhrases.map(regexFromPhrase);
const forbiddenRoomPatterns = encodedRetiredRoomPhrases.map(regexFromPhrase);

function isTextFile(path) {
  const basename = path.split('/').at(-1) ?? path;
  if (basename === 'AGENTS.md' || basename === 'CLAUDE.md') return true;
  const dotIndex = basename.lastIndexOf('.');
  const extension = dotIndex === -1 ? '' : basename.slice(dotIndex).toLowerCase();
  return textFileExtensions.has(extension);
}

function collectTrackedTextFiles() {
  const output = execFileSync('git', ['ls-files', '-z'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  return output
    .split('\0')
    .filter(Boolean)
    .filter(isTextFile)
    .map((path) => join(repoRoot, path));
}

function collectRoomFilesFromTrackedFiles(files) {
  const normalizedRoot = `${relative(repoRoot, appRoot)}/`;
  return files.filter((file) => {
    const path = relative(repoRoot, file);
    if (!path.startsWith(normalizedRoot)) return false;
    const roomPath = path.slice(normalizedRoot.length);
    return scannedRoomEntries.some((entry) => roomPath === entry || roomPath.startsWith(`${entry}/`));
  });
}

function scanFiles(files, patterns, root) {
  const violations = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        violations.push(`${relative(root, file)}: ${pattern}`);
      }
    }
  }
  return violations;
}

describe('assessment room product boundary', () => {
  it('ships only the core assessment room experience', () => {
    const productFiles = collectTrackedTextFiles();
    const roomFiles = collectRoomFilesFromTrackedFiles(productFiles);
    const violations = [
      ...scanFiles(productFiles, forbiddenProductPatterns, repoRoot),
      ...scanFiles(roomFiles, forbiddenRoomPatterns, appRoot),
    ];

    expect(violations).toEqual([]);
  });
});
