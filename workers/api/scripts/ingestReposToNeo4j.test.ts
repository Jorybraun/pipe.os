import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { discoverLocalDatabase, parseArgs } from './ingestReposToNeo4j';

describe('ingestReposToNeo4j CLI helpers', () => {
  it('parses dry-run, batch, limit, and database path options', () => {
    expect(parseArgs([
      '--dry-run',
      '--limit',
      '3',
      '--batch-size=2',
      '--database-path',
      '.wrangler/test.sqlite',
    ])).toEqual({
      dryRun: true,
      limit: 3,
      batchSize: 2,
      databasePath: '.wrangler/test.sqlite',
    });
  });

  it('discovers the single local D1 sqlite database while ignoring metadata.sqlite', () => {
    const root = mkdtempSync(join(tmpdir(), 'pipe-d1-'));
    try {
      const d1Dir = join(root, '.wrangler/state/v3/d1/miniflare-D1DatabaseObject');
      mkdirSync(d1Dir, { recursive: true });
      writeFileSync(join(d1Dir, 'metadata.sqlite'), '');
      writeFileSync(join(d1Dir, 'local-db.sqlite'), '');

      expect(discoverLocalDatabase(undefined, root)).toBe(join(d1Dir, 'local-db.sqlite'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('requires an explicit database path when discovery is ambiguous', () => {
    const root = mkdtempSync(join(tmpdir(), 'pipe-d1-'));
    try {
      const d1Dir = join(root, '.wrangler/state/v3/d1/miniflare-D1DatabaseObject');
      mkdirSync(d1Dir, { recursive: true });
      writeFileSync(join(d1Dir, 'one.sqlite'), '');
      writeFileSync(join(d1Dir, 'two.sqlite'), '');

      expect(() => discoverLocalDatabase(undefined, root)).toThrow(/Expected one local D1 database/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
