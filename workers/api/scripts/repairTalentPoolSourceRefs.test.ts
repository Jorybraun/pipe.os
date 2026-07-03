import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import { createMockD1, type BetterSqliteDb } from '../src/__tests__/helpers/mockD1';
import { repairTalentPoolSourceRefs } from './repairTalentPoolSourceRefs';

let sqlite: BetterSqliteDb | null = null;

function createSchema(db: BetterSqliteDb): void {
  db.exec(`
    CREATE TABLE talent_pool_intakes (
      candidate_id TEXT PRIMARY KEY,
      profile_r2_key TEXT,
      submitted_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE artifact_versions (
      id TEXT PRIMARY KEY,
      storage_key TEXT,
      content_text TEXT
    );
    CREATE TABLE source_spans (
      id TEXT PRIMARY KEY,
      artifact_version_id TEXT,
      char_start INTEGER,
      char_end INTEGER,
      exact_text TEXT
    );
    CREATE TABLE candidate_nodes (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL,
      node_type TEXT NOT NULL,
      narrative_text TEXT NOT NULL,
      extracted_properties_json TEXT,
      embedding_json TEXT,
      source_type TEXT NOT NULL,
      source_reference TEXT,
      captured_at INTEGER NOT NULL,
      confidence REAL,
      supersedes TEXT,
      superseded_at INTEGER,
      decomposition_version TEXT,
      ingestion_key TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
}

function seedRepairFixture(db: BetterSqliteDb): void {
  db.exec(`
    INSERT INTO talent_pool_intakes (candidate_id, profile_r2_key, submitted_at, updated_at)
    VALUES
      ('candidate-repairable', 'talent-intake/candidate-repairable/profile.txt', '2026-07-03T00:00:00.000Z', '2026-07-03T00:00:00.000Z'),
      ('candidate-gap', 'talent-intake/candidate-gap/profile.txt', '2026-07-03T00:00:00.000Z', '2026-07-03T00:00:00.000Z');
    INSERT INTO artifact_versions (id, storage_key, content_text)
    VALUES
      ('artifact-version-repairable', 'talent-intake/candidate-repairable/profile.txt', 'Built source-backed Talent Pool ingestion.'),
      ('artifact-version-gap', 'talent-intake/candidate-gap/profile.txt', 'Source artifact exists but no matching source span.');
    INSERT INTO source_spans (id, artifact_version_id, char_start, char_end, exact_text)
    VALUES ('source-span-repairable', 'artifact-version-repairable', 0, 39, 'Built source-backed Talent Pool ingestion.');
    INSERT INTO candidate_nodes (
      id, candidate_id, node_type, narrative_text, extracted_properties_json,
      embedding_json, source_type, source_reference, captured_at, confidence,
      supersedes, superseded_at, decomposition_version, ingestion_key
    ) VALUES
    (
      'candidate-node-repairable', 'candidate-repairable', 'ReviewEvidence',
      'Candidate supplied review evidence for repair.',
      '{"source_quote":"Built source-backed Talent Pool ingestion.","source_quote_validated":true,"source_quote_char_start":0,"source_quote_char_end":39}',
      NULL, 'resume', 'resume:review-evidence:0', 100, 0.85,
      NULL, NULL, 'adr041-v1', 'candidate-node-repairable'
    ),
    (
      'candidate-node-gap', 'candidate-gap', 'ReviewEvidence',
      'Candidate supplied review evidence without a matching span.',
      '{"source_quote":"Missing span.","source_quote_validated":true,"source_quote_char_start":0,"source_quote_char_end":13}',
      NULL, 'resume', 'resume:review-evidence:0', 100, 0.85,
      NULL, NULL, 'adr041-v1', 'candidate-node-gap'
    );
  `);
}

function sourceRows(db: BetterSqliteDb): Array<{
  id: string;
  source_reference: string | null;
  source_span_id: string | null;
}> {
  return db.prepare(`
    SELECT id,
           source_reference,
           json_extract(extracted_properties_json, '$.source_span_id') AS source_span_id
      FROM candidate_nodes
     ORDER BY id
  `).all() as Array<{
    id: string;
    source_reference: string | null;
    source_span_id: string | null;
  }>;
}

describe('repairTalentPoolSourceRefs', () => {
  afterEach(() => {
    sqlite?.close();
    sqlite = null;
  });

  it('dry-runs and then idempotently repairs source refs from existing source spans', async () => {
    sqlite = new Database(':memory:');
    createSchema(sqlite);
    seedRepairFixture(sqlite);
    const db = createMockD1(sqlite) as unknown as D1Database;

    await expect(repairTalentPoolSourceRefs(db, { dryRun: true, batchSize: 1, maxBatches: 5 }))
      .resolves.toMatchObject({
        dryRun: true,
        beforeRepairableCount: 1,
        scanned: 0,
        repaired: 0,
        afterRepairableCount: 1,
      });
    expect(sourceRows(sqlite)).toEqual([
      {
        id: 'candidate-node-gap',
        source_reference: 'resume:review-evidence:0',
        source_span_id: null,
      },
      {
        id: 'candidate-node-repairable',
        source_reference: 'resume:review-evidence:0',
        source_span_id: null,
      },
    ]);

    await expect(repairTalentPoolSourceRefs(db, { batchSize: 1, maxBatches: 5 }))
      .resolves.toMatchObject({
        dryRun: false,
        beforeRepairableCount: 1,
        scanned: 1,
        repaired: 1,
        afterRepairableCount: 0,
      });
    expect(sourceRows(sqlite)).toEqual([
      {
        id: 'candidate-node-gap',
        source_reference: 'resume:review-evidence:0',
        source_span_id: null,
      },
      {
        id: 'candidate-node-repairable',
        source_reference: 'source_span:source-span-repairable',
        source_span_id: 'source-span-repairable',
      },
    ]);

    await expect(repairTalentPoolSourceRefs(db, { batchSize: 1, maxBatches: 5 }))
      .resolves.toMatchObject({
        beforeRepairableCount: 0,
        scanned: 0,
        repaired: 0,
        afterRepairableCount: 0,
      });
  });
});
