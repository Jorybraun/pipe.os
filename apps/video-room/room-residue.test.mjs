import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

const scannedEntries = [
  'index.html',
  'public',
  'src',
];

const encodedForbiddenPhrases = [
  [57, 53, 32, 117, 110, 116, 105, 108, 32, 105, 110, 102, 105, 110, 105, 116, 121],
  [117, 110, 116, 105, 108, 32, 105, 110, 102, 105, 110, 105, 116, 121],
  [119, 105, 110, 100, 111, 119, 115, 32, 57, 53],
  [119, 105, 110, 57, 53],
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

function regexFromPhrase(encodedPhrase) {
  const phrase = String.fromCharCode(...encodedPhrase);
  return new RegExp(phrase.replace(/\s+/g, '\\s+'), 'i');
}

const forbiddenPatterns = encodedForbiddenPhrases.map(regexFromPhrase);

function collectFiles(entry) {
  const absolutePath = join(root, entry);
  const stats = statSync(absolutePath);
  if (stats.isFile()) return [absolutePath];
  return readdirSync(absolutePath).flatMap((child) => collectFiles(join(entry, child)));
}

describe('video room product boundary', () => {
  it('does not ship removed novelty-room surfaces', () => {
    const violations = [];
    for (const entry of scannedEntries) {
      for (const file of collectFiles(entry)) {
        const text = readFileSync(file, 'utf8');
        for (const pattern of forbiddenPatterns) {
          if (pattern.test(text)) {
            violations.push(`${file.replace(`${root}/`, '')}: ${pattern}`);
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
