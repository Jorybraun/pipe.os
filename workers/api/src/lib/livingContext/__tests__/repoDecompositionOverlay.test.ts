import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockD1, type BetterSqliteDb } from '../../../__tests__/helpers/mockD1';
import { loadRepoDecompositionOverlay } from '../repoDecompositionOverlay';
import type { D1Database } from '@cloudflare/workers-types';

const livingContextMigration = readFileSync(
  new URL('../../../../migrations/0082_living_context_graph.sql', import.meta.url),
  'utf8',
);
const repoGraphMigration = readFileSync(
  new URL('../../../../migrations/0083_repo_semantic_graph_and_match_runs.sql', import.meta.url),
  'utf8',
);
const conceptRegistryMigration = readFileSync(
  new URL('../../../../migrations/0094_concept_registry.sql', import.meta.url),
  'utf8',
);
const contextRecordsMigration = readFileSync(
  new URL('../../../../migrations/0095_context_records.sql', import.meta.url),
  'utf8',
);

const NOW = "datetime('now')";

function seedRepoAndPacket(sqlite: BetterSqliteDb): void {
  sqlite.exec(`
    INSERT INTO qualified_repos (id, full_name, url, default_branch, created_at, updated_at)
    VALUES (1, 'acme/backend', 'https://github.com/acme/backend', 'main', ${NOW}, ${NOW});

    INSERT INTO repo_snapshots (id, repo_id, commit_sha, extractor_version, created_at)
    VALUES ('snap-1', 1, 'abc123', '1.0.0', unixepoch());

    INSERT INTO repo_source_artifacts (id, repo_snapshot_id, artifact_type, path, created_at)
    VALUES ('art-1', 'snap-1', 'source', 'src/handler.ts', unixepoch()),
           ('art-2', 'snap-1', 'test', 'src/handler.test.ts', unixepoch());

    INSERT INTO repo_artifact_versions (id, artifact_id, content_hash, byte_length, created_at)
    VALUES ('ver-1', 'art-1', 'sha256:abc', 500, unixepoch()),
           ('ver-2', 'art-2', 'sha256:def', 300, unixepoch());

    INSERT INTO repo_source_spans (id, artifact_version_id, content_hash, path, byte_start, byte_end, line_start, line_end, exact_text, created_at)
    VALUES ('span-1', 'ver-1', 'sha256:s1', 'src/handler.ts', 0, 100, 1, 10, 'function handleRequest() {}', unixepoch()),
           ('span-2', 'ver-1', 'sha256:s2', 'src/handler.ts', 100, 200, 11, 20, 'function parseBody() {}', unixepoch()),
           ('span-3', 'ver-2', 'sha256:s3', 'src/handler.test.ts', 0, 150, 1, 15, 'describe("handler", () => {})', unixepoch());

    INSERT INTO repo_symbols (id, repo_snapshot_id, language, qualified_name, symbol_kind, defining_span_id, created_at)
    VALUES ('sym-1', 'snap-1', 'TypeScript', 'handleRequest', 'function', 'span-1', unixepoch()),
           ('sym-2', 'snap-1', 'TypeScript', 'parseBody', 'function', 'span-2', unixepoch());

    INSERT INTO repo_structural_facts (id, repo_snapshot_id, fact_type, subject_symbol_id, object_symbol_id, source_span_id, created_at)
    VALUES ('fact-1', 'snap-1', 'calls', 'sym-1', 'sym-2', 'span-1', unixepoch());
  `);

  const packet = JSON.stringify({
    id: 'pkt-1',
    pullRequest: { number: 42, title: 'Add request handling' },
    languageSupport: { language: 'TypeScript' },
    demands: [
      {
        id: 'demand-1',
        family: 'http_handling',
        narrative: 'Handle incoming HTTP requests with body parsing',
        conceptKeys: ['domain:http', 'skill:typescript'],
        weight: 1.0,
        sourceSpanIds: ['span-1', 'span-2'],
        changedSymbolIds: ['sym-1', 'sym-2'],
      },
      {
        id: 'demand-2',
        family: 'testing',
        narrative: 'Unit test coverage for handler',
        conceptKeys: ['skill:testing', 'tool:vitest'],
        weight: 0.5,
        sourceSpanIds: ['span-3'],
        changedSymbolIds: [],
      },
    ],
    changedFilePaths: ['src/handler.ts', 'src/handler.test.ts'],
  });

  sqlite.exec(`
    INSERT INTO review_challenge_packets (id, repo_snapshot_id, repo_id, pr_number, packet_version, source_hash, quality_score, demand_families_json, packet_json, created_at, updated_at)
    VALUES ('pkt-1', 'snap-1', 1, 42, '1.0.0', 'sha256:pkt', 0.8, '["http_handling","testing"]', '${packet.replace(/'/g, "''")}', unixepoch(), unixepoch());
  `);
}

function seedCandidateEvidence(sqlite: BetterSqliteDb): void {
  sqlite.exec(`
    INSERT INTO candidates (id, owner_id) VALUES ('cand-1', 'user-1');

    INSERT INTO people (id, ingestion_key, created_at, updated_at)
    VALUES ('person-1', 'ik-person-1', ${NOW}, ${NOW});
    INSERT INTO workspace_people (id, person_id, workspace_id, ingestion_key, context_json, created_at, updated_at)
    VALUES ('wp-1', 'person-1', 'ws-1', 'ik-wp-1', '{}', ${NOW}, ${NOW});
    INSERT INTO applications (id, workspace_person_id, legacy_candidate_id, ingestion_key, created_at, updated_at)
    VALUES ('app-1', 'wp-1', 'cand-1', 'ik-app-1', ${NOW}, ${NOW});
  `);

  sqlite.exec(`
    INSERT INTO concepts (id, ingestion_key, canonical_key, namespace, label, created_at, updated_at)
    VALUES ('concept-ts', 'ik-concept-ts', 'skill:typescript', 'skill', 'TypeScript', ${NOW}, ${NOW}),
           ('concept-http', 'ik-concept-http', 'domain:http', 'domain', 'HTTP', ${NOW}, ${NOW}),
           ('concept-testing', 'ik-concept-testing', 'skill:testing', 'skill', 'Testing', ${NOW}, ${NOW});

    INSERT INTO context_records (id, ingestion_key, scope_type, scope_id, record_type, predicate, narrative, qualifiers_json, observed_at, created_at, updated_at)
    VALUES ('cr-1', 'ik-cr-1', 'candidate', 'cand-1', 'resume_assertion', 'has_skill', 'TypeScript development', '{}', ${NOW}, ${NOW}, ${NOW}),
           ('cr-2', 'ik-cr-2', 'candidate', 'cand-1', 'interview_observation', 'demonstrated', 'HTTP handling knowledge', '{}', ${NOW}, ${NOW}, ${NOW});

    INSERT INTO context_record_concepts (context_record_id, concept_id, relationship, weight, created_at)
    VALUES ('cr-1', 'concept-ts', 'subject', 0.9, ${NOW}),
           ('cr-2', 'concept-http', 'subject', 0.8, ${NOW}),
           ('cr-2', 'concept-testing', 'subject', 0.6, ${NOW});
  `);
}

describe('repoDecompositionOverlay', () => {
  let sqlite: BetterSqliteDb;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec('PRAGMA foreign_keys = ON;');
    sqlite.exec(`
      CREATE TABLE candidates (id TEXT PRIMARY KEY, owner_id TEXT, pipeline_id TEXT);
      CREATE TABLE pipelines (id TEXT PRIMARY KEY, owner_id TEXT);
      CREATE TABLE qualified_repos (id INTEGER PRIMARY KEY, full_name TEXT, url TEXT, default_branch TEXT, created_at TEXT, updated_at TEXT);
    `);
    sqlite.exec(livingContextMigration);
    sqlite.exec(repoGraphMigration);
    sqlite.exec(conceptRegistryMigration);
    sqlite.exec(contextRecordsMigration);
  });

  afterEach(() => {
    sqlite.close();
  });

  it('returns null when packet does not exist', async () => {
    const db = createMockD1(sqlite) as unknown as D1Database;
    const result = await loadRepoDecompositionOverlay(db, 'nonexistent', 'cand-1');
    expect(result).toBeNull();
  });

  it('loads full decomposition overlay with candidate evidence mapped', async () => {
    seedRepoAndPacket(sqlite);
    seedCandidateEvidence(sqlite);
    const db = createMockD1(sqlite) as unknown as D1Database;

    const result = await loadRepoDecompositionOverlay(db, 'pkt-1', 'cand-1');
    expect(result).not.toBeNull();
    expect(result!.packetId).toBe('pkt-1');
    expect(result!.repoName).toBe('acme/backend');
    expect(result!.prNumber).toBe(42);
    expect(result!.prTitle).toBe('Add request handling');
    expect(result!.primaryLanguage).toBe('TypeScript');

    expect(result!.files.length).toBeGreaterThanOrEqual(2);
    const handlerFile = result!.files.find((f) => f.path === 'src/handler.ts');
    expect(handlerFile).toBeDefined();
    expect(handlerFile!.symbolCount).toBe(2);
    expect(handlerFile!.demandCount).toBe(1);

    expect(result!.symbols).toHaveLength(2);
    const sym1 = result!.symbols.find((s) => s.qualifiedName === 'handleRequest');
    expect(sym1).toBeDefined();
    expect(sym1!.kind).toBe('function');
    expect(sym1!.filePath).toBe('src/handler.ts');
    expect(sym1!.demandIds).toContain('demand-1');

    expect(result!.demands).toHaveLength(2);
    const demand1 = result!.demands.find((d) => d.id === 'demand-1');
    expect(demand1).toBeDefined();
    expect(demand1!.family).toBe('http_handling');
    expect(demand1!.candidateAlignmentScore).not.toBeNull();
    expect(demand1!.candidateAlignmentScore!).toBeGreaterThan(0);
    expect(demand1!.candidateEvidenceCount).toBeGreaterThan(0);

    expect(result!.structuralFacts).toHaveLength(1);
    expect(result!.structuralFacts[0].factType).toBe('calls');

    expect(result!.candidateEvidenceOverlay.length).toBeGreaterThanOrEqual(2);
    const tsEvidence = result!.candidateEvidenceOverlay.find((e) => e.conceptKey === 'skill:typescript');
    expect(tsEvidence).toBeDefined();
    expect(tsEvidence!.evidenceCount).toBeGreaterThan(0);
  });

  it('computes coverage summary correctly', async () => {
    seedRepoAndPacket(sqlite);
    seedCandidateEvidence(sqlite);
    const db = createMockD1(sqlite) as unknown as D1Database;

    const result = await loadRepoDecompositionOverlay(db, 'pkt-1', 'cand-1');
    expect(result).not.toBeNull();

    const { coverageSummary } = result!;
    expect(coverageSummary.totalDemands).toBe(2);
    expect(coverageSummary.coveredDemands + coverageSummary.partialDemands + coverageSummary.uncoveredDemands).toBe(2);
    expect(coverageSummary.overallScore).toBeGreaterThanOrEqual(0);
    expect(coverageSummary.overallScore).toBeLessThanOrEqual(1);
  });

  it('returns zero-coverage overlay for candidate without evidence', async () => {
    seedRepoAndPacket(sqlite);
    sqlite.exec(`INSERT INTO candidates (id, owner_id) VALUES ('cand-empty', 'user-1');`);
    const db = createMockD1(sqlite) as unknown as D1Database;

    const result = await loadRepoDecompositionOverlay(db, 'pkt-1', 'cand-empty');
    expect(result).not.toBeNull();
    expect(result!.coverageSummary.uncoveredDemands).toBe(2);
    expect(result!.coverageSummary.overallScore).toBe(0);
    expect(result!.candidateEvidenceOverlay).toHaveLength(0);
  });

  it('includes structural facts with file paths', async () => {
    seedRepoAndPacket(sqlite);
    sqlite.exec(`INSERT INTO candidates (id, owner_id) VALUES ('cand-2', 'user-1');`);
    const db = createMockD1(sqlite) as unknown as D1Database;

    const result = await loadRepoDecompositionOverlay(db, 'pkt-1', 'cand-2');
    expect(result).not.toBeNull();
    expect(result!.structuralFacts).toHaveLength(1);
    expect(result!.structuralFacts[0].sourceFilePath).toBe('src/handler.ts');
    expect(result!.structuralFacts[0].subjectSymbolId).toBe('sym-1');
    expect(result!.structuralFacts[0].objectSymbolId).toBe('sym-2');
  });
});
