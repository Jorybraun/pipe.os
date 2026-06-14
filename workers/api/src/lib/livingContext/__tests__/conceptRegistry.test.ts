import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createConceptRegistry, type ConceptRegistry } from '../conceptRegistry';

interface SqliteStatement {
  run(...bindings: unknown[]): { changes: number | bigint };
  get(...bindings: unknown[]): unknown;
  all(...bindings: unknown[]): unknown[];
}

interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => SqliteDatabase;
};
const livingContextMigration = readFileSync(
  new URL('../../../../migrations/0082_living_context_graph.sql', import.meta.url),
  'utf8',
);
const conceptRegistryMigration = readFileSync(
  new URL('../../../../migrations/0094_concept_registry.sql', import.meta.url),
  'utf8',
);

function d1(sqlite: SqliteDatabase): D1Database {
  return {
    prepare(query: string) {
      let bindings: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) {
          bindings = values;
          return statement;
        },
        async run() {
          const result = sqlite.prepare(query).run(...bindings);
          return {
            success: true,
            results: [],
            meta: { changes: Number(result.changes) },
          };
        },
        async first<T>() {
          return (sqlite.prepare(query).get(...bindings) as T | undefined) ?? null;
        },
        async all<T>() {
          return {
            success: true,
            results: sqlite.prepare(query).all(...bindings) as T[],
            meta: {},
          };
        },
      };
      return statement;
    },
  } as unknown as D1Database;
}

const provenance = {
  evidenceEntityType: 'fixture',
  evidenceEntityId: 'fixture-1',
  evidenceLocator: 'fixture:line:1',
} as const;

describe('ConceptRegistry', () => {
  let sqlite: SqliteDatabase;
  let registry: ConceptRegistry;

  beforeEach(() => {
    sqlite = new DatabaseSync(':memory:');
    sqlite.exec('PRAGMA foreign_keys = ON;');
    sqlite.exec(livingContextMigration);
    sqlite.exec(conceptRegistryMigration);
    sqlite.exec(`
      CREATE TABLE role_nodes (
        id TEXT PRIMARY KEY,
        rcd_version TEXT NOT NULL,
        source_section TEXT,
        narrative_text TEXT NOT NULL,
        extracted_properties_json TEXT,
        superseded_at INTEGER
      );
    `);
    registry = createConceptRegistry(d1(sqlite));
  });

  afterEach(() => sqlite.close());

  it('persists a source-backed concept face using the existing concepts schema', async () => {
    const registered = await registry.registerConcept({
      canonicalKey: 'term:react',
      namespace: 'open',
      label: 'React',
      surface: 'React',
      resolverVersion: 'open-source-term-v1',
      ...provenance,
    });

    const concept = await registry.getConcept('term:react');
    const faces = await registry.getConceptFaces(registered.conceptId);
    expect(registered.isNewConcept).toBe(true);
    expect(concept).toMatchObject({
      canonicalKey: 'term:react',
      namespace: 'open',
      observationCount: 1,
    });
    expect(faces).toEqual([
      expect.objectContaining({
        surface: 'React',
        normalizedSurface: 'react',
        evidenceLocator: 'fixture:line:1',
      }),
    ]);
  });

  it('is idempotent for concept and face replays', async () => {
    const input = {
      canonicalKey: 'term:react',
      namespace: 'open',
      label: 'React',
      surface: 'React',
      resolverVersion: 'open-source-term-v1',
      observedAt: 1_700_000_000,
      ...provenance,
    };
    const first = await registry.registerConcept(input);
    const second = await registry.registerConcept(input);

    expect(second).toEqual({
      conceptId: first.conceptId,
      isNewConcept: false,
    });
    expect(await registry.getConceptFaces(first.conceptId)).toHaveLength(1);
    expect((await registry.getConcept('term:react'))?.observationCount).toBe(1);
  });

  it('keeps distinct source-backed surfaces as faces of one concept', async () => {
    const first = await registry.registerConcept({
      canonicalKey: 'term:react',
      namespace: 'open',
      label: 'React',
      surface: 'React',
      ...provenance,
    });
    await registry.registerConcept({
      canonicalKey: 'term:react',
      namespace: 'open',
      label: 'React',
      surface: 'React.js',
      ...provenance,
      evidenceLocator: 'fixture:line:2',
    });

    const faces = await registry.getConceptFaces(first.conceptId);
    expect(faces.map((face) => face.surface).sort()).toEqual(['React', 'React.js']);
  });

  it('resolves unknown concepts without fabricating confidence', async () => {
    const result = await registry.resolveConcept({
      surface: 'SomeNewTechnology',
      resolverVersion: 'open-source-term-v1',
      ...provenance,
    });

    expect(result.canonicalKey).toBe('term:somenewtechnology');
    expect(result.confidence).toBeNull();
    expect(await registry.getConcept(result.canonicalKey)).not.toBeNull();
  });

  it('records deterministic, replayable resolutions', async () => {
    const input = {
      surface: 'Temporal fanout',
      resolverVersion: 'open-source-term-v1',
      observedAt: 1_700_000_000,
      ...provenance,
    };
    const first = await registry.resolveConcept(input);
    const second = await registry.resolveConcept(input);
    const resolutions = await registry.getConceptResolutions(first.conceptId);

    expect(second).toEqual(first);
    expect(resolutions).toHaveLength(1);
    expect(resolutions[0]).toMatchObject({
      resolverVersion: 'open-source-term-v1',
      resolvedCanonicalKey: 'term:temporal-fanout',
      evidenceLocator: 'fixture:line:1',
    });
  });

  it('requires provenance for semantic observations', async () => {
    await expect(registry.registerConcept({
      canonicalKey: 'term:unproven',
      namespace: 'open',
      label: 'Unproven',
      surface: 'Unproven',
    })).rejects.toThrow('require sourceSpanId');
  });

  it('persists open relationship dimensions without a code-owned enum', async () => {
    const left = await registry.registerConcept({
      canonicalKey: 'term:event-stream',
      namespace: 'open',
      label: 'Event stream',
      surface: 'event stream',
      ...provenance,
    });
    const right = await registry.registerConcept({
      canonicalKey: 'term:order-lifecycle',
      namespace: 'open',
      label: 'Order lifecycle',
      surface: 'order lifecycle',
      ...provenance,
      evidenceLocator: 'fixture:line:2',
    });
    const adjacency = {
      fromConceptId: left.conceptId,
      toConceptId: right.conceptId,
      dimension: 'novel:causal-business-object-flow',
      stretchAllowed: false,
      confidence: 0.9,
      observedAt: 1_700_000_000,
      ...provenance,
    };
    const firstId = await registry.addAdjacency(adjacency);
    const secondId = await registry.addAdjacency(adjacency);
    const rows = await registry.getAdjacencies(left.conceptId);

    expect(secondId).toBe(firstId);
    expect(rows).toEqual([
      expect.objectContaining({
        dimension: 'novel:causal-business-object-flow',
        stretchAllowed: false,
        evidenceLocator: 'fixture:line:1',
      }),
    ]);
  });

  it('preserves invented concept namespaces and exact source surfaces', async () => {
    const registered = await registry.registerConcept({
      canonicalKey: 'future:bio-digital-scheduler',
      namespace: 'future',
      label: 'Bio-Digital Scheduler',
      surface: 'Bio-Digital Scheduler v7',
      ...provenance,
    });
    const faces = await registry.getConceptFaces(registered.conceptId);

    expect((await registry.getConcept('future:bio-digital-scheduler'))?.namespace)
      .toBe('future');
    expect(faces[0]).toMatchObject({
      surface: 'Bio-Digital Scheduler v7',
      normalizedSurface: 'bio digital scheduler v7',
    });
  });

  it('backfills only linked candidate concepts and explicit role semantic terms', async () => {
    sqlite.exec(`
      INSERT INTO people (
        id, ingestion_key, display_name, external_ids_json, created_at, updated_at
      ) VALUES ('person-1', 'person-1', 'Ada', '{}', '2026-01-01', '2026-01-01');
      INSERT INTO workspace_people (
        id, ingestion_key, workspace_id, person_id, context_json, created_at, updated_at
      ) VALUES (
        'workspace-person-1', 'workspace-person-1', 'workspace-1', 'person-1',
        '{}', '2026-01-01', '2026-01-01'
      );
      INSERT INTO artifacts (
        id, ingestion_key, workspace_person_id, artifact_type, metadata_json,
        created_at, updated_at
      ) VALUES (
        'artifact-1', 'artifact-1', 'workspace-person-1', 'resume', '{}',
        '2026-01-01', '2026-01-01'
      );
      INSERT INTO artifact_versions (
        id, ingestion_key, artifact_id, version_number, content_hash,
        media_type, content_text, metadata_json, created_at
      ) VALUES (
        'artifact-version-1', 'artifact-version-1', 'artifact-1', 1,
        'sha256:source', 'text/plain', 'Built event stream processing',
        '{}', '2026-01-01'
      );
      INSERT INTO source_spans (
        id, ingestion_key, artifact_version_id, char_start, char_end,
        exact_text, exact_text_hash, metadata_json, created_at
      ) VALUES (
        'source-span-1', 'source-span-1', 'artifact-version-1', 0, 29,
        'Built event stream processing', 'sha256:span', '{}', '2026-01-01'
      );
      INSERT INTO semantic_assertions (
        id, ingestion_key, workspace_person_id, subject_type, predicate,
        narrative, qualifiers_json, created_at, updated_at
      ) VALUES (
        'assertion-1', 'assertion-1', 'workspace-person-1', 'person',
        'demonstrated', 'Built event stream processing', '{}',
        '2026-01-01', '2026-01-01'
      );
      INSERT INTO assertion_source_spans (
        assertion_id, source_span_id, evidence_role, created_at
      ) VALUES ('assertion-1', 'source-span-1', 'support', '2026-01-01');
      INSERT INTO concepts (
        id, ingestion_key, canonical_key, namespace, label, aliases_json,
        metadata_json, observation_count, created_at, updated_at
      ) VALUES (
        'existing-concept-1', 'existing-concept-1', 'term:event-stream',
        'open', 'event stream', '[]', '{}', 0, '2026-01-01', '2026-01-01'
      );
      INSERT INTO assertion_concepts (
        assertion_id, concept_id, relationship, weight, created_at
      ) VALUES ('assertion-1', 'existing-concept-1', 'about', 1, '2026-01-01');
      INSERT INTO role_nodes (
        id, rcd_version, source_section, narrative_text,
        extracted_properties_json, superseded_at
      ) VALUES (
        'role-node-explicit', '1.0.0', 'technical_context.stack',
        'TechnicalContext: Construct: causal scheduler',
        '{"semantic_terms":[{"surface":"causal scheduler","canonical_key":"term:causal-scheduler"}]}',
        NULL
      );
      INSERT INTO role_nodes (
        id, rcd_version, source_section, narrative_text,
        extracted_properties_json, superseded_at
      ) VALUES (
        'role-node-prose', '1.0.0', 'domain_matrix.work',
        'Must attend many meetings because stakeholders prefer alignment.',
        '{}', NULL
      );
    `);

    const first = await registry.backfillOpenTerms();
    const firstCounts = sqlite.prepare(
      `SELECT
         (SELECT COUNT(*) FROM concept_surfaces) AS surfaces,
         (SELECT COUNT(*) FROM concepts WHERE canonical_key = 'term:causal-scheduler') AS role_terms,
         (SELECT COUNT(*) FROM concepts WHERE canonical_key LIKE '%meetings%') AS prose_terms`,
    ).get();
    const second = await registry.backfillOpenTerms();
    const secondCounts = sqlite.prepare(
      `SELECT
         (SELECT COUNT(*) FROM concept_surfaces) AS surfaces,
         (SELECT COUNT(*) FROM concepts WHERE canonical_key = 'term:causal-scheduler') AS role_terms,
         (SELECT COUNT(*) FROM concepts WHERE canonical_key LIKE '%meetings%') AS prose_terms`,
    ).get();

    expect(first.processed).toBe(2);
    expect(second.processed).toBe(2);
    expect(firstCounts).toEqual({
      surfaces: 2,
      role_terms: 1,
      prose_terms: 0,
    });
    expect(secondCounts).toEqual(firstCounts);
  });
});
