import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createConceptRegistry, type ConceptRegistry } from '../conceptRegistry';

interface NodeSqliteStatement {
  run(...values: SqlValue[]): unknown;
  get(...values: SqlValue[]): unknown;
  all(...values: SqlValue[]): unknown[];
}

interface NodeSqliteDatabase {
  prepare(sql: string): NodeSqliteStatement;
  exec(sql: string): void;
  close(): void;
}

const require = createRequire(import.meta.url);
const DatabaseSync = require('better-sqlite3') as new (path: string) => NodeSqliteDatabase;

const conceptRegistryMigration = readFileSync(
  new URL('../../../../migrations/0094_concept_registry.sql', import.meta.url),
  'utf8',
);

type SqlValue = string | number | null;

interface StatementState {
  values: SqlValue[];
}

function rewriteNumberedParams(
  sql: string,
  bindings: unknown[],
): { sql: string; args: unknown[] } {
  const numbered = /\?(\d+)/g;
  let match = numbered.exec(sql);
  if (!match) return { sql, args: bindings };

  const args: unknown[] = [];
  let rewritten = '';
  let lastIndex = 0;

  numbered.lastIndex = 0;
  while ((match = numbered.exec(sql)) !== null) {
    rewritten += sql.slice(lastIndex, match.index) + '?';
    args.push(bindings[parseInt(match[1]!, 10) - 1]);
    lastIndex = numbered.lastIndex;
  }
  rewritten += sql.slice(lastIndex);
  return { sql: rewritten, args };
}

function createNodeSqliteD1(sqlite: NodeSqliteDatabase): D1Database {
  return {
    prepare(query: string) {
      const state: StatementState = { values: [] };
      const prepared = {
        bind(...values: SqlValue[]) {
          state.values = values;
          return prepared;
        },
        async run() {
          const { sql, args } = rewriteNumberedParams(query, state.values);
          sqlite.prepare(sql).run(...args as SqlValue[]);
          return { success: true, results: [], meta: {} };
        },
        async first<T>() {
          const { sql, args } = rewriteNumberedParams(query, state.values);
          return (sqlite.prepare(sql).get(...args as SqlValue[]) as T | undefined) ?? null;
        },
        async all<T>() {
          const { sql, args } = rewriteNumberedParams(query, state.values);
          return {
            success: true,
            results: sqlite.prepare(sql).all(...args as SqlValue[]) as T[],
            meta: {},
          };
        },
      };
      return prepared;
    },
  } as unknown as D1Database;
}

function createSchema(sqlite: NodeSqliteDatabase): void {
  sqlite.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE concepts (
      id TEXT PRIMARY KEY,
      ingestion_key TEXT NOT NULL UNIQUE,
      canonical_key TEXT NOT NULL UNIQUE,
      namespace TEXT NOT NULL,
      label TEXT NOT NULL,
      description TEXT,
      aliases_json TEXT NOT NULL DEFAULT '[]',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE artifact_versions (id TEXT PRIMARY KEY);
    CREATE TABLE source_spans (
      id TEXT PRIMARY KEY,
      artifact_version_id TEXT REFERENCES artifact_versions(id)
    );
  `);
  sqlite.exec(conceptRegistryMigration);
  sqlite.exec(`
    CREATE TABLE semantic_assertions (id TEXT PRIMARY KEY);
    CREATE TABLE assertion_concepts (assertion_id TEXT, concept_id TEXT);
    CREATE TABLE assertion_source_spans (assertion_id TEXT, source_span_id TEXT);
    CREATE TABLE role_nodes (
      id TEXT PRIMARY KEY,
      rcd_version TEXT NOT NULL,
      source_section TEXT,
      narrative_text TEXT NOT NULL,
      extracted_properties_json TEXT,
      superseded_at INTEGER
    );
    CREATE TABLE repo_semantic_assertions (
      id TEXT PRIMARY KEY,
      repo_snapshot_id TEXT NOT NULL,
      qualifiers_json TEXT NOT NULL DEFAULT '{}',
      confidence REAL NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE repo_assertion_source_spans (
      assertion_id TEXT NOT NULL,
      source_span_id TEXT NOT NULL
    );
    CREATE TABLE repo_source_spans (
      id TEXT PRIMARY KEY,
      artifact_version_id TEXT NOT NULL,
      path TEXT,
      byte_start INTEGER,
      byte_end INTEGER,
      line_start INTEGER,
      line_end INTEGER,
      exact_text TEXT NOT NULL
    );
  `);
}

describe('ConceptRegistry repo concept backfill', () => {
  let sqlite: NodeSqliteDatabase;
  let registry: ConceptRegistry;

  beforeEach(() => {
    sqlite = new DatabaseSync(':memory:');
    createSchema(sqlite);
    registry = createConceptRegistry(createNodeSqliteD1(sqlite));
  });

  afterEach(() => sqlite.close());

  it('backfills repo assertion concepts with exact repo source-span provenance idempotently', async () => {
    sqlite.exec(`
      INSERT INTO repo_source_spans (
        id, artifact_version_id, path, byte_start, byte_end,
        line_start, line_end, exact_text
      ) VALUES (
        'repo-span-1', 'repo-artifact-version-1', 'src/ledger.ts',
        30, 90, 10, 12, 'reconcileQuantumLedger(order)'
      );
      INSERT INTO repo_semantic_assertions (
        id, repo_snapshot_id, qualifiers_json, confidence, created_at
      ) VALUES (
        'repo-assertion-1', 'repo-snapshot-1',
        '{"conceptKeys":["term:quantum-ledger","novel-namespace:temporal-compensation"]}',
        0.86, 1700000000
      );
      INSERT INTO repo_assertion_source_spans (assertion_id, source_span_id)
      VALUES ('repo-assertion-1', 'repo-span-1');
      INSERT INTO repo_semantic_assertions (
        id, repo_snapshot_id, qualifiers_json, confidence, created_at
      ) VALUES (
        'repo-assertion-prose', 'repo-snapshot-1', '{}', 0.5, 1700000001
      );
    `);

    const first = await registry.backfillOpenTerms();
    const second = await registry.backfillOpenTerms();
    const quantum = await registry.getConcept('term:quantum-ledger');
    const temporal = await registry.getConcept('novel-namespace:temporal-compensation');

    expect(first).toEqual({ processed: 2, created: 2, updated: 0 });
    expect(second).toEqual({ processed: 2, created: 0, updated: 2 });
    expect(quantum).toMatchObject({
      canonicalKey: 'term:quantum-ledger',
      namespace: 'term',
      label: 'quantum ledger',
      observationCount: 1,
    });
    expect(temporal).toMatchObject({
      canonicalKey: 'novel-namespace:temporal-compensation',
      namespace: 'novel-namespace',
      label: 'temporal compensation',
      observationCount: 1,
    });

    const faces = await registry.getConceptFaces(quantum!.id);
    expect(faces).toEqual([
      expect.objectContaining({
        surface: 'quantum ledger',
        evidenceEntityType: 'repo_source_span',
        evidenceEntityId: 'repo-span-1',
        evidenceLocator: 'src/ledger.ts:10-12#bytes=30-90@repo-span-1',
        sourceSpanId: undefined,
        artifactVersionId: undefined,
      }),
    ]);
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM concept_surfaces').get())
      .toEqual({ count: 2 });
    expect(sqlite.prepare(
      "SELECT COUNT(*) AS count FROM concepts WHERE canonical_key LIKE '%repo-assertion-prose%'",
    ).get()).toEqual({ count: 0 });
  });
});
