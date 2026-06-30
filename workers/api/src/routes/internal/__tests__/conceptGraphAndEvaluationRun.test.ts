import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockD1, type BetterSqliteDb } from '../../../__tests__/helpers/mockD1';
import livingContextHealth from '../livingContextHealth';
import { Hono } from 'hono';

const livingContextMigration = readFileSync(
  new URL('../../../../migrations/0082_living_context_graph.sql', import.meta.url),
  'utf8',
);
const contextRecordsMigration = readFileSync(
  new URL('../../../../migrations/0095_context_records.sql', import.meta.url),
  'utf8',
);
const conceptRegistryMigration = readFileSync(
  new URL('../../../../migrations/0094_concept_registry.sql', import.meta.url),
  'utf8',
);
const repoGraphMigration = readFileSync(
  new URL('../../../../migrations/0083_repo_semantic_graph_and_match_runs.sql', import.meta.url),
  'utf8',
);
const evaluationMigration = readFileSync(
  new URL('../../../../migrations/0093_matching_evaluation.sql', import.meta.url),
  'utf8',
);
const checkpointMigration = readFileSync(
  new URL('../../../../migrations/0106_backfill_checkpoints.sql', import.meta.url),
  'utf8',
);
const gatesMigration = readFileSync(
  new URL('../../../../migrations/0107_rollout_gates.sql', import.meta.url),
  'utf8',
);

function createApp(sqlite: BetterSqliteDb): { app: InstanceType<typeof Hono>; db: D1Database } {
  const db = createMockD1(sqlite);
  const app = new Hono();
  app.route('/', livingContextHealth);
  return { app, db };
}

describe('GET /concept-graph — criterion #3: expose learned concepts as open data', () => {
  let sqlite: BetterSqliteDb;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec('PRAGMA foreign_keys = ON;');
    sqlite.exec(livingContextMigration);
    sqlite.exec(contextRecordsMigration);
    sqlite.exec(conceptRegistryMigration);
    sqlite.exec(checkpointMigration);
    sqlite.exec(gatesMigration);
  });

  afterEach(() => {
    sqlite.close();
  });

  it('returns empty list when no concepts exist', async () => {
    const { app, db } = createApp(sqlite);
    const res = await app.request('/concept-graph', undefined, { DB: db });
    expect(res.status).toBe(200);
    const body = await res.json() as { totalConcepts: number; concepts: unknown[] };
    expect(body.totalConcepts).toBe(0);
    expect(body.concepts).toEqual([]);
  });

  it('returns concepts ordered by observation count', async () => {
    const now = Math.floor(Date.now() / 1000);
    sqlite.exec(`
      INSERT INTO concepts (id, ingestion_key, canonical_key, namespace, label, aliases_json, metadata_json, observation_count, first_observed_at, last_observed_at, created_at, updated_at)
      VALUES
        ('c1', 'ik-c1', 'typescript', 'language', 'TypeScript', '["ts"]', '{}', 5, ${now - 100}, ${now}, datetime('now'), datetime('now')),
        ('c2', 'ik-c2', 'react', 'framework', 'React', '["reactjs"]', '{}', 3, ${now - 50}, ${now}, datetime('now'), datetime('now')),
        ('c3', 'ik-c3', 'rust', 'language', 'Rust', '[]', '{}', 1, ${now}, ${now}, datetime('now'), datetime('now'));
    `);

    const { app, db } = createApp(sqlite);
    const res = await app.request('/concept-graph?limit=10', undefined, { DB: db });
    expect(res.status).toBe(200);
    const body = await res.json() as { totalConcepts: number; concepts: Array<{ canonicalKey: string; observationCount: number }> };
    expect(body.totalConcepts).toBe(3);
    expect(body.concepts[0].canonicalKey).toBe('typescript');
    expect(body.concepts[0].observationCount).toBe(5);
    expect(body.concepts[1].canonicalKey).toBe('react');
    expect(body.concepts[2].canonicalKey).toBe('rust');
  });

  it('filters by namespace', async () => {
    const now = Math.floor(Date.now() / 1000);
    sqlite.exec(`
      INSERT INTO concepts (id, ingestion_key, canonical_key, namespace, label, aliases_json, metadata_json, observation_count, first_observed_at, last_observed_at, created_at, updated_at)
      VALUES
        ('c1', 'ik-c1', 'typescript', 'language', 'TypeScript', '[]', '{}', 5, ${now}, ${now}, datetime('now'), datetime('now')),
        ('c2', 'ik-c2', 'react', 'framework', 'React', '[]', '{}', 3, ${now}, ${now}, datetime('now'), datetime('now'));
    `);

    const { app, db } = createApp(sqlite);
    const res = await app.request('/concept-graph?namespace=language', undefined, { DB: db });
    expect(res.status).toBe(200);
    const body = await res.json() as { totalConcepts: number; concepts: Array<{ canonicalKey: string }> };
    expect(body.totalConcepts).toBe(1);
    expect(body.concepts[0].canonicalKey).toBe('typescript');
  });

  it('filters by query string', async () => {
    const now = Math.floor(Date.now() / 1000);
    sqlite.exec(`
      INSERT INTO concepts (id, ingestion_key, canonical_key, namespace, label, aliases_json, metadata_json, observation_count, first_observed_at, last_observed_at, created_at, updated_at)
      VALUES
        ('c1', 'ik-c1', 'typescript', 'language', 'TypeScript', '[]', '{}', 5, ${now}, ${now}, datetime('now'), datetime('now')),
        ('c2', 'ik-c2', 'react', 'framework', 'React', '[]', '{}', 3, ${now}, ${now}, datetime('now'), datetime('now'));
    `);

    const { app, db } = createApp(sqlite);
    const res = await app.request('/concept-graph?q=type', undefined, { DB: db });
    expect(res.status).toBe(200);
    const body = await res.json() as { totalConcepts: number; concepts: Array<{ canonicalKey: string }> };
    expect(body.totalConcepts).toBe(1);
    expect(body.concepts[0].canonicalKey).toBe('typescript');
  });

  it('filters by minimum observation count', async () => {
    const now = Math.floor(Date.now() / 1000);
    sqlite.exec(`
      INSERT INTO concepts (id, ingestion_key, canonical_key, namespace, label, aliases_json, metadata_json, observation_count, first_observed_at, last_observed_at, created_at, updated_at)
      VALUES
        ('c1', 'ik-c1', 'typescript', 'language', 'TypeScript', '[]', '{}', 5, ${now}, ${now}, datetime('now'), datetime('now')),
        ('c2', 'ik-c2', 'react', 'framework', 'React', '[]', '{}', 1, ${now}, ${now}, datetime('now'), datetime('now'));
    `);

    const { app, db } = createApp(sqlite);
    const res = await app.request('/concept-graph?minObs=3', undefined, { DB: db });
    expect(res.status).toBe(200);
    const body = await res.json() as { totalConcepts: number; concepts: Array<{ canonicalKey: string }> };
    expect(body.totalConcepts).toBe(1);
    expect(body.concepts[0].canonicalKey).toBe('typescript');
  });

  it('includes adjacency edges when withAdj=true', async () => {
    const now = Math.floor(Date.now() / 1000);
    sqlite.exec(`
      INSERT INTO concepts (id, ingestion_key, canonical_key, namespace, label, aliases_json, metadata_json, observation_count, first_observed_at, last_observed_at, created_at, updated_at)
      VALUES
        ('c1', 'ik-c1', 'typescript', 'language', 'TypeScript', '[]', '{}', 5, ${now}, ${now}, datetime('now'), datetime('now')),
        ('c2', 'ik-c2', 'react', 'framework', 'React', '[]', '{}', 3, ${now}, ${now}, datetime('now'), datetime('now'));
      INSERT INTO concept_adjacency (id, ingestion_key, from_concept_id, to_concept_id, dimension, stretch_allowed, confidence, observed_at, created_at)
      VALUES ('adj-1', 'ik-adj-1', 'c1', 'c2', 'co-occurrence', 1, 0.8, ${now}, ${now});
    `);

    const { app, db } = createApp(sqlite);
    const res = await app.request('/concept-graph?withAdj=true', undefined, { DB: db });
    expect(res.status).toBe(200);
    const body = await res.json() as {
      totalConcepts: number;
      concepts: unknown[];
      adjacencies: Array<{ fromConceptKey: string; toConceptKey: string; dimension: string; stretchAllowed: boolean }>;
    };
    expect(body.totalConcepts).toBe(2);
    expect(body.adjacencies).toHaveLength(1);
    expect(body.adjacencies[0].fromConceptKey).toBe('typescript');
    expect(body.adjacencies[0].toConceptKey).toBe('react');
    expect(body.adjacencies[0].dimension).toBe('co-occurrence');
    expect(body.adjacencies[0].stretchAllowed).toBe(true);
  });

  it('omits adjacencies by default', async () => {
    const now = Math.floor(Date.now() / 1000);
    sqlite.exec(`
      INSERT INTO concepts (id, ingestion_key, canonical_key, namespace, label, aliases_json, metadata_json, observation_count, first_observed_at, last_observed_at, created_at, updated_at)
      VALUES ('c1', 'ik-c1', 'typescript', 'language', 'TypeScript', '[]', '{}', 5, ${now}, ${now}, datetime('now'), datetime('now'));
    `);

    const { app, db } = createApp(sqlite);
    const res = await app.request('/concept-graph', undefined, { DB: db });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).not.toHaveProperty('adjacencies');
  });
});

describe('POST /evaluation-run — criterion #8: run evaluation pipeline from API', () => {
  let sqlite: BetterSqliteDb;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec('PRAGMA foreign_keys = ON;');
    sqlite.exec(livingContextMigration);
    sqlite.exec(repoGraphMigration);
    sqlite.exec(contextRecordsMigration);
    sqlite.exec(evaluationMigration);
    sqlite.exec(checkpointMigration);
    sqlite.exec(gatesMigration);
  });

  afterEach(() => {
    sqlite.close();
  });

  it('returns 400 when corpusId is missing', async () => {
    const { app, db } = createApp(sqlite);
    const res = await app.request('/evaluation-run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }, { DB: db });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('corpusId is required');
  });

  it('returns 422 when corpus does not exist', async () => {
    const { app, db } = createApp(sqlite);
    const res = await app.request('/evaluation-run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ corpusId: 'nonexistent' }),
    }, { DB: db });
    expect(res.status).toBe(422);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('nonexistent');
  });

  it('runs evaluation against a seeded corpus and returns metrics', async () => {
    // Use the sample-corpus fixture which has proper source references
    const sampleCorpusPath = new URL(
      '../../../../fixtures/evaluation/sample-corpus.json',
      import.meta.url,
    );
    const sampleCorpus = JSON.parse(readFileSync(sampleCorpusPath, 'utf8')) as {
      corpusId: string;
      metadata: { syntheticFixtureCount: number };
    };

    const corpusJson = JSON.stringify(sampleCorpus).replace(/'/g, "''");
    const corpusHash = `sha256:test-eval-${Date.now()}`;
    sqlite.exec(`
      INSERT INTO evaluation_corpora (corpus_id, schema_version, corpus_hash, corpus_json, expert_label_count, synthetic_fixture_count, frozen_at, created_at)
      VALUES ('${sampleCorpus.corpusId}', '1.0.0', '${corpusHash}', '${corpusJson}', 0, ${sampleCorpus.metadata.syntheticFixtureCount}, unixepoch(), unixepoch());
    `);

    const { app, db } = createApp(sqlite);
    const res = await app.request('/evaluation-run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ corpusId: sampleCorpus.corpusId }),
    }, { DB: db });
    expect(res.status).toBe(200);
    const body = await res.json() as {
      passed: boolean;
      metrics: { corpusId: string; missingMatchRunCount: number };
      humanReadableReport: string;
    };
    expect(body.metrics.corpusId).toBe(sampleCorpus.corpusId);
    expect(body.humanReadableReport).toContain('Matching Evaluation Report');
  });
});
