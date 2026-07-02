import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seedCorpusFromMatchRuns, persistSeededCorpus } from '../corpusSeeder';
import { validateCorpus } from '../corpus';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const DatabaseSync = require('better-sqlite3') as new (path: string) => NodeSqliteDatabase;

interface NodeSqliteStatement {
  run(...values: unknown[]): unknown;
  get(...values: unknown[]): unknown;
  all(...values: unknown[]): unknown[];
}

interface NodeSqliteDatabase {
  prepare(sql: string): NodeSqliteStatement;
  exec(sql: string): void;
  close(): void;
}

type SqlValue = string | number | null;

function rewriteNumberedParams(
  sql: string,
  bindings: unknown[],
): { sql: string; args: unknown[] } {
  const numbered = /\?(\d+)/g;
  let match = numbered.exec(sql);
  if (!match) return { sql, args: bindings };

  const args: unknown[] = [];
  let output = '';
  let lastIndex = 0;
  while (match) {
    output += sql.slice(lastIndex, match.index) + '?';
    args.push(bindings[parseInt(match[1]!, 10) - 1]);
    lastIndex = match.index + match[0].length;
    match = numbered.exec(sql);
  }
  output += sql.slice(lastIndex);
  return { sql: output, args };
}

function createMockD1(sqlite: NodeSqliteDatabase): D1Database {
  return {
    prepare(sql: string) {
      let boundArgs: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          boundArgs = args;
          return stmt;
        },
        async first<T>(): Promise<T | null> {
          const { sql: rewritten, args } = rewriteNumberedParams(sql, boundArgs);
          const row = sqlite.prepare(rewritten).get(...args as SqlValue[]);
          return (row as T) ?? null;
        },
        async all<T>(): Promise<{ results: T[] }> {
          const { sql: rewritten, args } = rewriteNumberedParams(sql, boundArgs);
          const rows = sqlite.prepare(rewritten).all(...args as SqlValue[]);
          return { results: rows as T[] };
        },
        async run() {
          const { sql: rewritten, args } = rewriteNumberedParams(sql, boundArgs);
          sqlite.prepare(rewritten).run(...args as SqlValue[]);
          return { meta: {}, success: true, results: [] };
        },
      };
      return stmt;
    },
    async batch() { return []; },
    async dump() { return new ArrayBuffer(0); },
    async exec() { return { count: 0, duration: 0 }; },
  } as unknown as D1Database;
}

function setupSchema(sqlite: NodeSqliteDatabase): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS match_runs (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL,
      application_id TEXT,
      role_context_id TEXT,
      role_snapshot_id TEXT NOT NULL DEFAULT 'standalone-code-review-v1',
      candidate_snapshot_id TEXT NOT NULL,
      policy_version TEXT NOT NULL DEFAULT '1.0.0',
      model_version TEXT,
      status TEXT NOT NULL,
      selected_packet_id TEXT,
      excluded_packets_json TEXT DEFAULT '[]',
      ranked_results_json TEXT NOT NULL DEFAULT '[]',
      query_json TEXT DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS people (
      id TEXT PRIMARY KEY,
      display_name TEXT,
      primary_email TEXT,
      primary_phone TEXT,
      external_ids_json TEXT DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS workspace_people (
      id TEXT PRIMARY KEY,
      person_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL DEFAULT 'ws-1',
      relationship_summary TEXT,
      workspace_context_json TEXT DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS applications (
      id TEXT PRIMARY KEY,
      workspace_person_id TEXT NOT NULL,
      legacy_candidate_id TEXT,
      pipeline_id TEXT,
      status TEXT,
      context_json TEXT DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS interactions (
      id TEXT PRIMARY KEY,
      workspace_person_id TEXT NOT NULL,
      interaction_type TEXT NOT NULL,
      external_reference TEXT,
      started_at TEXT,
      ended_at TEXT,
      metadata_json TEXT DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY,
      interaction_id TEXT,
      artifact_type TEXT NOT NULL,
      logical_key TEXT,
      metadata_json TEXT DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS artifact_versions (
      id TEXT PRIMARY KEY,
      artifact_id TEXT NOT NULL,
      version_number INTEGER NOT NULL DEFAULT 1,
      content_hash TEXT NOT NULL,
      media_type TEXT NOT NULL DEFAULT 'text/plain',
      storage_key TEXT,
      byte_length INTEGER,
      metadata_json TEXT DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS source_spans (
      id TEXT PRIMARY KEY,
      artifact_version_id TEXT NOT NULL,
      stable_segment_id TEXT,
      byte_start INTEGER,
      byte_end INTEGER,
      char_start INTEGER,
      char_end INTEGER,
      line_start INTEGER,
      line_end INTEGER,
      timestamp_start_ms INTEGER,
      timestamp_end_ms INTEGER,
      exact_text TEXT NOT NULL,
      exact_text_hash TEXT NOT NULL DEFAULT '',
      metadata_json TEXT DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS episodes (
      id TEXT PRIMARY KEY,
      workspace_person_id TEXT NOT NULL,
      interaction_id TEXT,
      narrative TEXT,
      started_at TEXT,
      ended_at TEXT,
      metadata_json TEXT DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS semantic_assertions (
      id TEXT PRIMARY KEY,
      episode_id TEXT,
      subject_type TEXT NOT NULL DEFAULT 'person',
      subject_id TEXT,
      predicate TEXT NOT NULL DEFAULT 'demonstrates',
      object_type TEXT,
      object_id TEXT,
      object_value_json TEXT,
      narrative TEXT NOT NULL,
      qualifiers_json TEXT DEFAULT '{}',
      confidence REAL,
      polarity INTEGER NOT NULL DEFAULT 1,
      extraction_version TEXT,
      observed_at TEXT,
      source_span_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS assertion_source_spans (
      assertion_id TEXT NOT NULL,
      source_span_id TEXT NOT NULL,
      evidence_role TEXT NOT NULL DEFAULT 'primary',
      PRIMARY KEY (assertion_id, source_span_id)
    );

    CREATE TABLE IF NOT EXISTS concepts (
      id TEXT PRIMARY KEY,
      canonical_key TEXT NOT NULL UNIQUE,
      namespace TEXT NOT NULL DEFAULT 'open',
      label TEXT NOT NULL,
      description TEXT,
      aliases_json TEXT DEFAULT '[]',
      metadata_json TEXT DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS assertion_concepts (
      assertion_id TEXT NOT NULL,
      concept_id TEXT NOT NULL,
      relationship TEXT NOT NULL DEFAULT 'demonstrates',
      weight REAL NOT NULL DEFAULT 1.0,
      PRIMARY KEY (assertion_id, concept_id)
    );

    CREATE TABLE IF NOT EXISTS role_context_documents (
      id TEXT PRIMARY KEY,
      required_languages_json TEXT,
      relevant_concepts_json TEXT,
      required_concepts_json TEXT,
      forbidden_concepts_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS role_source_references (
      id TEXT PRIMARY KEY,
      role_context_id TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      locator TEXT NOT NULL,
      concept_keys_json TEXT NOT NULL DEFAULT '[]',
      source_ref_type TEXT NOT NULL,
      source_ref_id TEXT NOT NULL,
      exact_text TEXT NOT NULL,
      content_hash TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS review_challenge_packets (
      id TEXT PRIMARY KEY,
      repo_id TEXT NOT NULL,
      pr_number INTEGER NOT NULL,
      source_version TEXT NOT NULL,
      content_hash TEXT,
      demands_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS evaluation_corpora (
      corpus_id TEXT PRIMARY KEY,
      schema_version TEXT NOT NULL,
      corpus_hash TEXT NOT NULL UNIQUE,
      corpus_json TEXT NOT NULL,
      expert_label_count INTEGER NOT NULL CHECK(expert_label_count >= 0),
      synthetic_fixture_count INTEGER NOT NULL CHECK(synthetic_fixture_count >= 0),
      frozen_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TRIGGER IF NOT EXISTS evaluation_corpora_no_update
    BEFORE UPDATE ON evaluation_corpora
    BEGIN
      SELECT RAISE(ABORT, 'evaluation corpora are frozen');
    END;
  `);
}

function seedMatchData(sqlite: NodeSqliteDatabase): void {
  // Create person/identity chain
  sqlite.prepare(`INSERT INTO people (id, display_name, primary_email) VALUES (?, ?, ?)`).run(
    'person-1', 'Alice Dev', 'alice@test.io',
  );
  sqlite.prepare(`INSERT INTO workspace_people (id, person_id, workspace_id) VALUES (?, ?, ?)`).run(
    'wp-1', 'person-1', 'ws-1',
  );
  sqlite.prepare(`INSERT INTO applications (id, workspace_person_id, legacy_candidate_id) VALUES (?, ?, ?)`).run(
    'app-1', 'wp-1', 'candidate-1',
  );

  // Create interaction + artifact + source spans
  sqlite.prepare(`INSERT INTO interactions (id, workspace_person_id, interaction_type) VALUES (?, ?, ?)`).run(
    'int-1', 'wp-1', 'meeting',
  );
  sqlite.prepare(`INSERT INTO artifacts (id, interaction_id, artifact_type) VALUES (?, ?, ?)`).run(
    'art-1', 'int-1', 'transcript',
  );
  sqlite.prepare(`INSERT INTO artifact_versions (id, artifact_id, version_number, content_hash) VALUES (?, ?, ?, ?)`).run(
    'av-1', 'art-1', 1, 'sha256:abc123',
  );
  sqlite.prepare(`INSERT INTO source_spans (id, artifact_version_id, exact_text, exact_text_hash, char_start, char_end) VALUES (?, ?, ?, ?, ?, ?)`).run(
    'ss-1', 'av-1', 'Built distributed event sourcing with Kafka Streams', 'hash1', 0, 52,
  );

  // Create episode + assertion + assertion_source_span
  sqlite.prepare(`INSERT INTO episodes (id, workspace_person_id, interaction_id, narrative) VALUES (?, ?, ?, ?)`).run(
    'ep-1', 'wp-1', 'int-1', 'Technical discussion about distributed systems',
  );
  sqlite.prepare(`INSERT INTO semantic_assertions (id, episode_id, narrative) VALUES (?, ?, ?)`).run(
    'sa-1', 'ep-1', 'Demonstrates experience with distributed event sourcing using Kafka',
  );
  sqlite.prepare(`INSERT INTO assertion_source_spans (assertion_id, source_span_id) VALUES (?, ?)`).run(
    'sa-1', 'ss-1',
  );

  // Create concept + assertion_concept
  sqlite.prepare(`INSERT INTO concepts (id, canonical_key, namespace, label) VALUES (?, ?, ?, ?)`).run(
    'c-1', 'term:kafka-streams', 'open', 'Kafka Streams',
  );
  sqlite.prepare(`INSERT INTO assertion_concepts (assertion_id, concept_id, relationship, weight) VALUES (?, ?, ?, ?)`).run(
    'sa-1', 'c-1', 'demonstrates', 1.0,
  );

  // Create role context
  sqlite.prepare(`INSERT INTO role_context_documents (id, required_languages_json, relevant_concepts_json) VALUES (?, ?, ?)`).run(
    'role-1', '["typescript"]', '["term:kafka-streams","term:event-sourcing"]',
  );
  sqlite.prepare(`INSERT INTO role_source_references (id, role_context_id, entity_id, locator, concept_keys_json, source_ref_type, source_ref_id, exact_text, content_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    'rsr-1', 'role-1', 'role-1', 'requirements', '["term:kafka-streams"]', 'role_context', 'rsr-1', 'Must have Kafka Streams experience', 'sha256:role1',
  );

  // Create challenge packet
  sqlite.prepare(`INSERT INTO review_challenge_packets (id, repo_id, pr_number, source_version, content_hash) VALUES (?, ?, ?, ?, ?)`).run(
    'packet-1', 'repo-1', 42, 'v1.0.0', 'sha256:packet1',
  );

  // Create match run
  const rankedResults = JSON.stringify([{
    rank: 1,
    recallRank: 1,
    challengeId: 'packet-1',
    repoId: 'repo-1',
    prNumber: 42,
    sourceVersion: 'v1.0.0',
    score: 0.85,
    candidateEvidenceAlignment: 0.9,
    roleRelevance: 0.8,
    contextualSpecificity: 0.7,
    challengeQuality: 0.9,
    validationDeepeningValue: 0.6,
    alignedDemandCount: 3,
    stretchCount: 0,
    stretchDemandWeightRatio: 0,
    provenanceComplete: true,
    eligible: true,
    alignments: [],
    rejectionReasons: [],
  }]);

  sqlite.prepare(
    `INSERT INTO match_runs (id, candidate_id, role_context_id, candidate_snapshot_id, role_snapshot_id, policy_version, status, selected_packet_id, ranked_results_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    'mr-1', 'candidate-1', 'role-1', 'candidate:candidate-1:v1', 'standalone-code-review-v1', '1.0.0', 'MATCHED', 'packet-1', rankedResults,
  );
}

describe('corpusSeeder', () => {
  let sqlite: NodeSqliteDatabase;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new DatabaseSync(':memory:');
    setupSchema(sqlite);
    db = createMockD1(sqlite);
  });

  afterEach(() => {
    sqlite.close();
  });

  it('throws when no match runs exist', async () => {
    await expect(seedCorpusFromMatchRuns(db)).rejects.toThrow('No match runs found');
  });

  it('seeds a corpus from a single match run with full provenance', async () => {
    seedMatchData(sqlite);

    const result = await seedCorpusFromMatchRuns(db);

    expect(result.matchRunCount).toBe(1);
    expect(result.candidateCount).toBe(1);
    expect(result.roleCount).toBe(1);
    expect(result.challengeCount).toBe(1);

    const corpus = result.corpus;
    expect(corpus.version).toBe('1.0.0');
    expect(corpus.candidateEvidence.length).toBeGreaterThan(0);
    expect(corpus.roleRequirements).toHaveLength(1);
    expect(corpus.expertLabels).toHaveLength(1);
    expect(corpus.expectedPackets).toHaveLength(1);

    // Verify candidate evidence references
    const evidence = corpus.candidateEvidence[0]!;
    expect(evidence.candidateId).toBe('candidate-1');
    expect(evidence.narrative).toContain('Kafka');
    expect(evidence.concepts).toContain('term:kafka-streams');
    expect(evidence.evidenceReferences[0]!.sourceRefType).toBe('source_span');
    expect(evidence.evidenceReferences[0]!.exactText).toContain('Kafka Streams');

    // Verify role requirements
    const role = corpus.roleRequirements[0]!;
    expect(role.roleId).toBe('role-1');
    expect(role.requiredLanguages).toContain('typescript');
    expect(role.sourceReferences).toHaveLength(1);

    // Verify expert label is draft (corpus-seeder)
    const label = corpus.expertLabels[0]!;
    expect(label.labeledBy).toBe('corpus-seeder');
    expect(label.relevanceGrade).toBe('highly_relevant');
    expect(label.challengeId).toBe('packet-1');

    // Verify expected packets
    const packet = corpus.expectedPackets![0]!;
    expect(packet.repoId).toBe('repo-1');
    expect(packet.prNumber).toBe(42);

    // Verify metadata
    expect(corpus.metadata.totalLabels).toBe(1);
    expect(corpus.metadata.totalCandidates).toBe(1);
    expect(corpus.metadata.totalRoles).toBe(1);
  });

  it('persists draft corpus to the frozen evaluation_corpora schema without counting seeded labels as expert', async () => {
    seedMatchData(sqlite);

    const result = await seedCorpusFromMatchRuns(db);
    const persistResult = await persistSeededCorpus(db, result.corpus);

    expect(persistResult.persisted).toBe(true);

    const row = sqlite.prepare(
      `SELECT schema_version, corpus_hash, corpus_json, expert_label_count,
              synthetic_fixture_count, frozen_at
         FROM evaluation_corpora
        WHERE corpus_id = ?`,
    ).get(result.corpus.corpusId) as {
      schema_version: string;
      corpus_hash: string;
      corpus_json: string;
      expert_label_count: number;
      synthetic_fixture_count: number;
      frozen_at: number;
    } | undefined;
    expect(row).toBeDefined();
    const loaded = JSON.parse(row!.corpus_json);
    expect(loaded.corpusId).toBe(result.corpus.corpusId);
    expect(row!.schema_version).toBe('1.0.0');
    expect(row!.corpus_hash).toBe(createHash('sha256').update(row!.corpus_json).digest('hex'));
    expect(row!.expert_label_count).toBe(0);
    expect(row!.synthetic_fixture_count).toBe(0);
    expect(row!.frozen_at).toBe(Math.floor(Date.parse(result.corpus.createdAt) / 1000));

    const repeat = await persistSeededCorpus(db, result.corpus);
    expect(repeat.persisted).toBe(false);

    expect(() => sqlite.prepare(
      `UPDATE evaluation_corpora SET corpus_json = '{}'
        WHERE corpus_id = ?`,
    ).run(result.corpus.corpusId)).toThrow('evaluation corpora are frozen');
  });

  it('generates warnings when candidate has no living context', async () => {
    // Create match run without living context data
    sqlite.prepare(
      `INSERT INTO match_runs (id, candidate_id, role_context_id, candidate_snapshot_id, role_snapshot_id, policy_version, status, selected_packet_id, ranked_results_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'mr-orphan', 'candidate-orphan', 'role-orphan', 'snap-1', 'standalone-code-review-v1', '1.0.0', 'MATCHED', null,
      JSON.stringify([{ rank: 1, recallRank: 1, challengeId: 'ch-1', repoId: 'r-1', prNumber: 1, sourceVersion: 'v1', score: 0.5, candidateEvidenceAlignment: 0.5, roleRelevance: 0.5, contextualSpecificity: 0.5, challengeQuality: 0.5, validationDeepeningValue: 0.5, alignedDemandCount: 1, stretchCount: 0, stretchDemandWeightRatio: 0, provenanceComplete: true, eligible: true, alignments: [], rejectionReasons: [] }]),
    );

    const result = await seedCorpusFromMatchRuns(db);

    expect(result.warnings.some((w) => w.includes('candidate-orphan'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('role-orphan'))).toBe(true);
  });

  it('falls back to role snapshots when optional role-context tables are missing', async () => {
    seedMatchData(sqlite);
    sqlite.exec(`
      DROP TABLE role_source_references;
      DROP TABLE role_context_documents;
    `);

    const result = await seedCorpusFromMatchRuns(db);

    expect(result.matchRunCount).toBe(1);
    expect(result.roleCount).toBe(1);
    expect(result.corpus.roleRequirements).toHaveLength(1);
    expect(result.corpus.roleRequirements[0]).toMatchObject({
      roleId: 'role-1',
      requiredLanguages: [],
    });
    expect(result.corpus.roleRequirements[0]!.sourceReferences[0]).toMatchObject({
      sourceRefType: 'role_snapshot',
      sourceRefId: 'role-1',
    });
    expect(result.warnings).toContain(
      'role_context_documents table is unavailable; using role snapshot fallback for role requirements',
    );
    expect(result.warnings).toContain(
      'role_source_references table is unavailable; role source refs omitted',
    );
  });

  it('reads challenge packets from the deployed packet schema without source_version', async () => {
    seedMatchData(sqlite);
    sqlite.exec(`
      DROP TABLE review_challenge_packets;
      CREATE TABLE review_challenge_packets (
        id TEXT PRIMARY KEY,
        repo_snapshot_id TEXT NOT NULL,
        repo_id INTEGER NOT NULL,
        pr_number INTEGER NOT NULL,
        packet_version TEXT NOT NULL,
        source_hash TEXT NOT NULL,
        packet_json TEXT NOT NULL,
        production_ready INTEGER NOT NULL DEFAULT 1,
        quality_score REAL NOT NULL DEFAULT 1
      );
    `);
    sqlite.prepare(
      `INSERT INTO review_challenge_packets (
         id, repo_snapshot_id, repo_id, pr_number, packet_version,
         source_hash, packet_json, production_ready, quality_score
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'packet-1',
      'repo-snapshot-1',
      123,
      42,
      'packet-v1',
      'sha256:packet-from-source-hash',
      JSON.stringify({
        repository: {
          owner: 'mui',
          name: 'base-ui',
          canonicalUrl: 'https://github.com/mui/base-ui',
        },
        pullRequest: {
          url: 'https://github.com/mui/base-ui/pull/42',
          title: 'Repair Kafka Streams retry code',
        },
        demands: [{
          id: 'packet-demand-1',
          narrative: 'Review Kafka Streams retry code in the source-backed PR.',
          conceptKeys: ['term:kafka-streams'],
          sourceSpanIds: ['repo-span-1'],
          changedSymbolIds: ['symbol-1'],
          contentHash: 'sha256:repo-span',
        }],
      }),
      1,
      0.95,
    );

    const result = await seedCorpusFromMatchRuns(db);

    expect(result.corpus.expectedPackets).toHaveLength(1);
    expect(result.corpus.expectedPackets![0]).toMatchObject({
      challengeId: 'packet-1',
      repoId: 'repo-1',
      repoFullName: 'mui/base-ui',
      repoUrl: 'https://github.com/mui/base-ui',
      prNumber: 42,
      prUrl: 'https://github.com/mui/base-ui/pull/42',
      prTitle: 'Repair Kafka Streams retry code',
      sourceVersion: 'v1.0.0',
      packetContentHash: 'sha256:packet-from-source-hash',
    });
    expect(result.corpus.expectedPackets![0]!.demands[0]).toMatchObject({
      demandId: 'packet-demand-1',
      concepts: ['term:kafka-streams'],
    });
    expect(result.corpus.expectedPackets![0]!.demands[0]!.sourceRefs[0]).toMatchObject({
      sourceRefType: 'repo_source_span',
      sourceRefId: 'repo-span-1',
      sourceSpanId: 'repo-span-1',
      exactText: 'Review Kafka Streams retry code in the source-backed PR.',
    });
  });

  it('does not list low-scoring irrelevant seeded labels as eligible challenges', async () => {
    seedMatchData(sqlite);
    sqlite.prepare(
      `UPDATE match_runs
          SET ranked_results_json = ?
        WHERE id = 'mr-1'`,
    ).run(JSON.stringify([{
      rank: 1,
      recallRank: 1,
      challengeId: 'packet-1',
      repoId: 'repo-1',
      prNumber: 42,
      sourceVersion: 'v1.0.0',
      score: 0.3,
      candidateEvidenceAlignment: 0.3,
      roleRelevance: 0.3,
      contextualSpecificity: 0.3,
      challengeQuality: 0.9,
      validationDeepeningValue: 0.3,
      alignedDemandCount: 1,
      stretchCount: 0,
      stretchDemandWeightRatio: 0,
      provenanceComplete: true,
      eligible: true,
      alignments: [],
      rejectionReasons: [],
    }, {
      rank: 2,
      recallRank: 2,
      challengeId: 'packet-2',
      repoId: 'repo-2',
      prNumber: 43,
      sourceVersion: 'v2.0.0',
      score: 0.2,
      candidateEvidenceAlignment: 0.2,
      roleRelevance: 0.2,
      contextualSpecificity: 0.2,
      challengeQuality: 0.8,
      validationDeepeningValue: 0.2,
      alignedDemandCount: 1,
      stretchCount: 0,
      stretchDemandWeightRatio: 0,
      provenanceComplete: true,
      eligible: true,
      alignments: [],
      rejectionReasons: [],
    }]));

    const result = await seedCorpusFromMatchRuns(db);

    expect(result.corpus.expertLabels[0]).toMatchObject({
      challengeId: 'packet-1',
      relevanceGrade: 'irrelevant',
      eligibleChallengeIds: [],
    });
    expect(result.corpus.metadata.totalChallenges).toBe(1);
    expect(result.warnings.some((warning) =>
      warning.includes('metadata.totalChallenges does not match'),
    )).toBe(false);
  });

  it('respects statusFilter option', async () => {
    seedMatchData(sqlite);

    // Add a second match run with different status
    sqlite.prepare(
      `INSERT INTO match_runs (id, candidate_id, role_context_id, candidate_snapshot_id, role_snapshot_id, policy_version, status, ranked_results_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'mr-2', 'candidate-1', 'role-1', 'snap-2', 'standalone-code-review-v1', '1.0.0', 'NEEDS_MORE_EVIDENCE',
      JSON.stringify([]),
    );

    const matched = await seedCorpusFromMatchRuns(db, { statusFilter: 'MATCHED' });
    expect(matched.matchRunCount).toBe(1);

    // NEEDS_MORE_EVIDENCE filter should find the second run
    const needsMore = await seedCorpusFromMatchRuns(db, { statusFilter: 'NEEDS_MORE_EVIDENCE' });
    expect(needsMore.matchRunCount).toBe(1);
  });
});
