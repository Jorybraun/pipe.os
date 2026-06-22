import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockD1, type BetterSqliteDb } from '../src/__tests__/helpers/mockD1';
import { matchCandidateToReviewChallenge } from '../src/lib/challengeMatching/d1Matcher';
import type { GitHubDiffResult } from '../src/lib/fetchGitHubDiff';
import type { ChallengePacket as RepoChallengePacket } from '../src/lib/repoSemanticGraph';
import {
  backfillReviewChallengePackets,
  buildBackfillCliReport,
  checkGitHubApiConnectivity,
  type Options,
  type PullRequestRefs,
  type QueryClient,
  type SamplePullRequestRow,
} from './backfillReviewChallengePackets';

const repoGraphMigration = readFileSync(
  new URL('../migrations/0083_repo_semantic_graph_and_match_runs.sql', import.meta.url),
  'utf8',
);
const livingContextMigration = readFileSync(
  new URL('../migrations/0082_living_context_graph.sql', import.meta.url),
  'utf8',
);
const contextRecordMigration = readFileSync(
  new URL('../migrations/0095_context_records.sql', import.meta.url),
  'utf8',
);

interface CandidateConceptEvidence {
  conceptKey: string;
  exactText: string;
  predicate: string;
  evidenceLevel: 'implemented' | 'validated' | 'demonstrated';
  sourceKind: 'resume' | 'meeting' | 'assessment';
}

class BetterQueryClient implements QueryClient {
  constructor(private readonly sqlite: BetterSqliteDb) {}

  async query<T>(
    sql: string,
    params: Array<string | number | null> = [],
  ): Promise<T[]> {
    const statement = this.sqlite.prepare(sql);
    if (/^\s*(SELECT|WITH|PRAGMA)/i.test(sql)) {
      return statement.all(...params) as T[];
    }
    statement.run(...params);
    return [];
  }
}

function hunkLines(prefix: string, count: number): Array<{
  type: 'added';
  content: string;
  lineNumber: number;
}> {
  return Array.from({ length: count }, (_, index) => ({
    type: 'added',
    content: `${prefix} ${index + 1}`,
    lineNumber: index + 1,
  }));
}

function diffFixture(): GitHubDiffResult {
  return {
    metadata: {
      title: 'Add idempotent order retry flow',
      author: 'engineer',
      created_at: '2026-06-18T12:00:00Z',
      state: 'closed',
      base: 'main',
      head: 'retry-orders',
      base_sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      head_sha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      merged_at: '2026-06-19T12:00:00Z',
      description: 'Adds bounded retry behavior and source-backed tests.',
    },
    diff: {
      files: [
        {
          filename: 'src/orders/retry.ts',
          status: 'modified',
          additions: 8,
          deletions: 1,
          hunks: [{ header: '@@ -1,1 +1,8 @@', lines: hunkLines('retry order event', 8) }],
        },
        {
          filename: 'src/orders/idempotency.ts',
          status: 'added',
          additions: 8,
          deletions: 0,
          hunks: [{ header: '@@ -1,1 +1,8 @@', lines: hunkLines('idempotency key write', 8) }],
        },
        {
          filename: 'src/orders/crystallineQuorumLedger.ts',
          status: 'added',
          additions: 8,
          deletions: 0,
          hunks: [{ header: '@@ -1,1 +1,8 @@', lines: hunkLines('crystalline quorum ledger write', 8) }],
        },
        {
          filename: 'src/orders/__tests__/retry.test.ts',
          status: 'modified',
          additions: 8,
          deletions: 1,
          hunks: [{ header: '@@ -1,1 +1,8 @@', lines: hunkLines('expect retry once', 8) }],
        },
      ],
    },
  };
}

function sourceContent(path: string): string | null {
  switch (path) {
    case 'src/orders/retry.ts':
      return [
        'import { publishOrderEvent } from "./events";',
        'import { idempotencyKey } from "./idempotency";',
        '',
        'export function retryOrder(orderId: string) {',
        '  const key = idempotencyKey(orderId);',
        '  return publishOrderEvent(orderId, key);',
        '}',
      ].join('\n');
    case 'src/orders/idempotency.ts':
      return [
        'export function idempotencyKey(orderId: string) {',
        '  return `order:${orderId}`;',
        '}',
      ].join('\n');
    case 'src/orders/crystallineQuorumLedger.ts':
      return [
        'export function writeCrystallineQuorumLedger(orderId: string) {',
        '  const ledgerKey = `crystalline:${orderId}`;',
        '  return { ledgerKey, committed: true };',
        '}',
      ].join('\n');
    case 'src/orders/__tests__/retry.test.ts':
      return [
        'import { retryOrder } from "../retry";',
        '',
        'it("retries once", () => {',
        '  expect(retryOrder("ord_123")).toBeDefined();',
        '});',
      ].join('\n');
    default:
      return null;
  }
}

function mockContentFetch(): void {
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => {
    const href = String(url);
    const contentsMatch = href.match(/\/contents\/([^?]+)\?ref=/);
    if (contentsMatch) {
      const content = sourceContent(decodeURIComponent(contentsMatch[1] ?? ''));
      if (content !== null) {
        return new Response(content, {
          status: 200,
          headers: { 'Content-Type': 'text/plain' },
        });
      }
    }
    return new Response('not found', { status: 404 });
  }));
}

function sampleRow(): SamplePullRequestRow {
  return {
    repo_id: 77,
    full_name: 'pipe-labs/orders',
    github_url: 'https://github.com/pipe-labs/orders',
    primary_language: 'TypeScript',
    pr_number: 42,
    pr_url: 'https://github.com/pipe-labs/orders/pull/42',
    title: 'Add idempotent order retry flow',
    merged_at: '2026-06-19T12:00:00Z',
  };
}

function refs(): PullRequestRefs {
  return {
    baseSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    baseRef: 'main',
    headSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    mergedAt: '2026-06-19T12:00:00Z',
  };
}

function setupDb(): BetterSqliteDb {
  const sqlite = new Database(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  sqlite.exec(`
    CREATE TABLE qualified_repos (
      id INTEGER PRIMARY KEY,
      github_url TEXT UNIQUE NOT NULL,
      full_name TEXT NOT NULL,
      primary_language TEXT NOT NULL,
      test_framework TEXT,
      disqualified INTEGER NOT NULL DEFAULT 0
    );
    INSERT INTO qualified_repos (id, github_url, full_name, primary_language, test_framework, disqualified)
    VALUES
      (7, 'https://github.com/pipe/e2e-source-backed-local', 'pipe/e2e-source-backed-local', 'TypeScript', 'source-backed-fixture', 0),
      (77, 'https://github.com/pipe-labs/orders', 'pipe-labs/orders', 'TypeScript', NULL, 0);

    CREATE TABLE candidates (id TEXT PRIMARY KEY);
    CREATE TABLE repo_sample_prs (
      repo_id INTEGER NOT NULL,
      pr_number INTEGER NOT NULL,
      pr_url TEXT NOT NULL,
      title TEXT,
      merged_at TEXT NOT NULL,
      changed_file_count INTEGER NOT NULL,
      modifies_tests INTEGER NOT NULL DEFAULT 0,
      swe_bench_eligible INTEGER NOT NULL DEFAULT 0,
      additions INTEGER,
      deletions INTEGER,
      resolves_issue_number INTEGER,
      PRIMARY KEY (repo_id, pr_number)
    );
    INSERT INTO repo_sample_prs (
      repo_id, pr_number, pr_url, title, merged_at, changed_file_count,
      modifies_tests, swe_bench_eligible, additions, deletions, resolves_issue_number
    ) VALUES
      (
        7, 42, 'https://github.com/pipe/e2e-source-backed-local/pull/42',
        'Synthetic E2E source-backed fixture', '2026-06-19T12:00:00Z',
        3, 1, 1, 24, 2, NULL
      ),
      (
        77, 42, 'https://github.com/pipe-labs/orders/pull/42',
        'Add idempotent order retry flow', '2026-06-19T12:00:00Z',
        3, 1, 1, 24, 2, NULL
      );
  `);
  sqlite.exec(livingContextMigration);
  sqlite.exec(repoGraphMigration);
  sqlite.exec(contextRecordMigration);
  return sqlite;
}

function labelForConcept(conceptKey: string): string {
  const value = conceptKey.includes(':')
    ? conceptKey.slice(conceptKey.indexOf(':') + 1)
    : conceptKey;
  return value.replace(/[-_]+/g, ' ');
}

function seedCandidateEvidence(sqlite: BetterSqliteDb, evidence: CandidateConceptEvidence[]): void {
  const now = '2026-06-20T00:00:00.000Z';
  sqlite.exec(`
    INSERT OR IGNORE INTO candidates (id) VALUES ('candidate-1');
    INSERT INTO people (
      id, ingestion_key, display_name, primary_email, external_ids_json, created_at, updated_at
    ) VALUES (
      'person-1', 'person-1', 'Candidate One', 'candidate@example.com', '{}', '${now}', '${now}'
    );
    INSERT INTO workspace_people (
      id, ingestion_key, workspace_id, person_id, context_json, created_at, updated_at
    ) VALUES (
      'workspace-person-1', 'workspace-person-1', 'workspace-1', 'person-1', '{}', '${now}', '${now}'
    );
    INSERT INTO applications (
      id, ingestion_key, workspace_person_id, legacy_candidate_id, context_json, created_at, updated_at
    ) VALUES (
      'application-1', 'application-1', 'workspace-person-1', 'candidate-1', '{}', '${now}', '${now}'
    );
  `);

  for (const [index, item] of evidence.entries()) {
    const ordinal = index + 1;
    const start = 0;
    const end = item.exactText.length;
    const conceptLabel = labelForConcept(item.conceptKey);
    const candidateConceptId = `concept-${item.conceptKey.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')}`;
    const interactionType = item.sourceKind === 'meeting'
      ? 'video_meeting'
      : item.sourceKind === 'resume'
        ? 'resume'
        : 'assessment';
    const artifactType = item.sourceKind === 'meeting'
      ? 'meeting_transcript'
      : item.sourceKind === 'resume'
        ? 'resume'
        : 'assessment_response';
    sqlite.prepare(
      `INSERT INTO interactions (
         id, ingestion_key, workspace_person_id, application_id, interaction_type,
         metadata_json, created_at, updated_at
       ) VALUES (?, ?, 'workspace-person-1', 'application-1', ?, '{}', ?, ?)`,
    ).run(`interaction-${ordinal}`, `interaction-${ordinal}`, interactionType, now, now);
    sqlite.prepare(
      `INSERT INTO artifacts (
         id, ingestion_key, workspace_person_id, interaction_id, artifact_type,
         metadata_json, created_at, updated_at
       ) VALUES (?, ?, 'workspace-person-1', ?, ?, '{}', ?, ?)`,
    ).run(`artifact-${ordinal}`, `artifact-${ordinal}`, `interaction-${ordinal}`, artifactType, now, now);
    sqlite.prepare(
      `INSERT INTO artifact_versions (
         id, ingestion_key, artifact_id, version_number, content_hash, media_type,
         content_text, byte_length, metadata_json, created_at
       ) VALUES (?, ?, ?, 1, ?, 'text/plain', ?, ?, '{}', ?)`,
    ).run(
      `artifact-version-${ordinal}`,
      `artifact-version-${ordinal}`,
      `artifact-${ordinal}`,
      `sha256:candidate-backfill-${ordinal}`,
      item.exactText,
      item.exactText.length,
      now,
    );
    sqlite.prepare(
      `INSERT INTO source_spans (
         id, ingestion_key, artifact_version_id, byte_start, byte_end, char_start, char_end,
         line_start, line_end, exact_text, exact_text_hash, metadata_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, '{}', ?)`,
    ).run(
      `candidate-span-${ordinal}`,
      `candidate-span-${ordinal}`,
      `artifact-version-${ordinal}`,
      start,
      end,
      start,
      end,
      item.exactText,
      `sha256:candidate-span-${ordinal}`,
      now,
    );
    sqlite.prepare(
      `INSERT INTO episodes (
         id, ingestion_key, workspace_person_id, interaction_id, narrative, metadata_json, created_at, updated_at
       ) VALUES (?, ?, 'workspace-person-1', ?, ?, '{}', ?, ?)`,
    ).run(
      `episode-${ordinal}`,
      `episode-${ordinal}`,
      `interaction-${ordinal}`,
      `Candidate described ${item.exactText}.`,
      now,
      now,
    );
    sqlite.prepare(
      `INSERT OR IGNORE INTO concepts (
         id, ingestion_key, canonical_key, namespace, label, aliases_json, metadata_json, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, '[]', '{}', ?, ?)`,
    ).run(
      candidateConceptId,
      candidateConceptId,
      item.conceptKey,
      item.conceptKey.split(':', 1)[0] || 'term',
      conceptLabel,
      now,
      now,
    );
    const concept = sqlite.prepare(
      `SELECT id FROM concepts WHERE canonical_key = ?`,
    ).get(item.conceptKey) as { id: string };
    sqlite.prepare(
      `INSERT INTO semantic_assertions (
         id, ingestion_key, workspace_person_id, episode_id, subject_type, subject_id,
         predicate, object_type, object_value_json, narrative, qualifiers_json, confidence,
         polarity, extraction_version, observed_at, created_at, updated_at
       ) VALUES (?, ?, 'workspace-person-1', ?, 'person', 'person-1',
         ?, 'concept', json_object('value', ?), ?, '{}', 1, 1, 'test', ?, ?, ?)`,
    ).run(
      `assertion-${ordinal}`,
      `assertion-${ordinal}`,
      `episode-${ordinal}`,
      item.predicate,
      conceptLabel,
      `Candidate ${item.exactText}.`,
      now,
      now,
      now,
    );
    sqlite.prepare(
      `INSERT INTO assertion_source_spans (assertion_id, source_span_id, evidence_role, created_at)
       VALUES (?, ?, 'support', ?)`,
    ).run(`assertion-${ordinal}`, `candidate-span-${ordinal}`, now);
    sqlite.prepare(
      `INSERT INTO assertion_concepts (assertion_id, concept_id, relationship, weight, created_at)
       VALUES (?, ?, 'about', 1, ?)`,
    ).run(`assertion-${ordinal}`, concept.id, now);
    sqlite.prepare(
      `INSERT INTO signal_evidence (
         id, ingestion_key, workspace_person_id, interaction_id, assertion_id, concept_id,
         signal_key, evidence_level, strength, polarity, metadata_json, created_at, updated_at
       ) VALUES (?, ?, 'workspace-person-1', ?, ?, ?, ?, ?, 1, 1, '{}', ?, ?)`,
    ).run(
      `evidence-${ordinal}`,
      `evidence-${ordinal}`,
      `interaction-${ordinal}`,
      `assertion-${ordinal}`,
      concept.id,
      item.conceptKey,
      item.evidenceLevel,
      now,
      now,
    );
  }
}

describe('backfillReviewChallengePackets', () => {
  let sqlite: BetterSqliteDb;

  beforeEach(() => {
    sqlite = setupDb();
    mockContentFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sqlite.close();
  });

  it('fails write mode before fetching when graph/context tables are missing', async () => {
    sqlite.close();
    sqlite = new Database(':memory:');

    const options: Options = {
      target: 'local',
      dryRun: false,
      force: false,
      preflightGithub: false,
      batchSize: 10,
    };
    const fetchDiff = vi.fn();
    const fetchRefs = vi.fn();

    await expect(backfillReviewChallengePackets({
      client: new BetterQueryClient(sqlite),
      db: createMockD1(sqlite),
      options,
      fetchDiff,
      fetchRefs,
      log: {
        log: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    })).rejects.toThrow(
      'review challenge graph tables are missing: review_challenge_packets, context_records, context_record_source_refs, context_record_concepts; apply migrations 0082_living_context_graph.sql, 0083_repo_semantic_graph_and_match_runs.sql, 0095_context_records.sql before write mode',
    );
    expect(fetchDiff).not.toHaveBeenCalled();
    expect(fetchRefs).not.toHaveBeenCalled();
  });

  it('feeds backfilled source-backed PR packets into deterministic candidate matching', async () => {
    const options: Options = {
      target: 'local',
      dryRun: false,
      force: false,
      preflightGithub: false,
      batchSize: 10,
    };
    const result = await backfillReviewChallengePackets({
      client: new BetterQueryClient(sqlite),
      db: createMockD1(sqlite),
      options,
      fetchDiff: async (repoUrl, prNumber) => {
        expect(repoUrl).toBe(sampleRow().github_url);
        expect(prNumber).toBe(sampleRow().pr_number);
        return diffFixture();
      },
      fetchRefs: async (row) => {
        expect(row).toEqual(sampleRow());
        return refs();
      },
      log: {
        log: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    });

    expect(result.stats).toEqual({
      selected: 1,
      built: 1,
      persisted: 1,
      dryRun: 0,
      ineligible: 0,
      skippedExisting: 0,
      skippedFetch: 0,
      skippedNoHunks: 0,
      errors: 0,
    });
    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0]).toMatchObject({
      repoId: 77,
      repoFullName: 'pipe-labs/orders',
      repoUrl: 'https://github.com/pipe-labs/orders',
      prNumber: 42,
      prUrl: 'https://github.com/pipe-labs/orders/pull/42',
      title: 'Add idempotent order retry flow',
      status: 'persisted',
      eligible: true,
      demandCount: expect.any(Number),
      sourceSpanCount: expect.any(Number),
      changedFileCount: 4,
      structuralFactCount: expect.any(Number),
      error: null,
    });

    const persistedPacket = sqlite.prepare(
      'SELECT packet_json, production_ready FROM review_challenge_packets ORDER BY updated_at DESC LIMIT 1',
    ).get() as { packet_json: string; production_ready: number };
    const packet = JSON.parse(persistedPacket.packet_json) as RepoChallengePacket;
    expect(result.outcomes[0]).toMatchObject({
      packetId: packet.id,
      repoSnapshotId: packet.repoSnapshotId,
      packetContentHash: packet.contentHash,
      qualityScore: packet.quality.score,
    });

    expect(packet.quality.eligible).toBe(true);
    expect(packet.demands.length).toBeGreaterThanOrEqual(2);
    expect(packet.demands.flatMap((demand) => demand.conceptKeys)).toEqual(
      expect.arrayContaining(['term:retry', 'term:idempotency']),
    );
    expect(packet.demands.some((demand) =>
      demand.conceptKeys.includes('term:crystalline-quorum-ledger')
    )).toBe(true);
    expect(persistedPacket.production_ready).toBe(1);

    const packetContext = sqlite.prepare(
      `SELECT id, scope_type, scope_id, record_type
         FROM context_records
        WHERE record_type = 'repo_challenge_packet'
          AND scope_id = ?`,
    ).get(packet.repoSnapshotId) as {
      id: string;
      scope_type: string;
      scope_id: string;
      record_type: string;
    };
    expect(packetContext).toMatchObject({
      scope_type: 'repo_snapshot',
      scope_id: packet.repoSnapshotId,
      record_type: 'repo_challenge_packet',
    });
    const packetContextConcepts = sqlite.prepare(
      `SELECT c.canonical_key, crc.relationship, crc.weight
         FROM context_record_concepts crc
         JOIN concepts c ON c.id = crc.concept_id
        WHERE crc.context_record_id = ?
        ORDER BY c.canonical_key`,
    ).all(packetContext.id) as Array<{
      canonical_key: string;
      relationship: string;
      weight: number;
    }>;
    expect(packetContextConcepts).toEqual(expect.arrayContaining([
      {
        canonical_key: 'term:crystalline-quorum-ledger',
        relationship: 'concept',
        weight: 1,
      },
      {
        canonical_key: 'term:idempotency',
        relationship: 'concept',
        weight: 1,
      },
      {
        canonical_key: 'term:retry',
        relationship: 'concept',
        weight: 1,
      },
    ]));
    const packetContextSourceRefs = sqlite.prepare(
      `SELECT source_ref_type, source_ref_id, exact_text, evidence_role
         FROM context_record_source_refs
        WHERE context_record_id = ?`,
    ).all(packetContext.id) as Array<{
      source_ref_type: string;
      source_ref_id: string;
      exact_text: string | null;
      evidence_role: string;
    }>;
    expect(packetContextSourceRefs.some((ref) =>
      ref.source_ref_type === 'repo_source_span'
      && ref.evidence_role === 'source'
      && ref.exact_text?.includes('crystalline quorum ledger write')
    )).toBe(true);

    const candidateEvidence: CandidateConceptEvidence[] = [
      {
        conceptKey: 'term:crystalline-quorum-ledger',
        exactText: 'resume: implemented CrystallineQuorumLedger commits for order recovery',
        predicate: 'implemented',
        evidenceLevel: 'implemented',
        sourceKind: 'resume',
      },
      {
        conceptKey: 'term:crystalline-quorum-ledger',
        exactText: 'meeting: debugged CrystallineQuorumLedger replay during an outage',
        predicate: 'debugged',
        evidenceLevel: 'demonstrated',
        sourceKind: 'meeting',
      },
      {
        conceptKey: 'term:idempotency',
        exactText: 'implemented idempotency key handling',
        predicate: 'implemented',
        evidenceLevel: 'implemented',
        sourceKind: 'resume',
      },
      {
        conceptKey: 'term:retry',
        exactText: 'validated retry handling',
        predicate: 'validated',
        evidenceLevel: 'validated',
        sourceKind: 'assessment',
      },
      {
        conceptKey: 'term:retry-order',
        exactText: 'implemented retry order flow',
        predicate: 'implemented',
        evidenceLevel: 'implemented',
        sourceKind: 'assessment',
      },
      {
        conceptKey: 'term:publishorderevent',
        exactText: 'demonstrated publish order event call tracing',
        predicate: 'demonstrated',
        evidenceLevel: 'demonstrated',
        sourceKind: 'assessment',
      },
      {
        conceptKey: 'term:events',
        exactText: 'maintained events import boundary',
        predicate: 'demonstrated',
        evidenceLevel: 'demonstrated',
        sourceKind: 'assessment',
      },
      {
        conceptKey: 'term:test',
        exactText: 'validated source test coverage',
        predicate: 'validated',
        evidenceLevel: 'validated',
        sourceKind: 'assessment',
      },
    ];
    expect(candidateEvidence.every((item) =>
      packet.demands.some((demand) => demand.conceptKeys.includes(item.conceptKey)),
    )).toBe(true);
    seedCandidateEvidence(sqlite, candidateEvidence);

    const match = await matchCandidateToReviewChallenge(createMockD1(sqlite), 'candidate-1');

    expect(match.status).toBe('MATCHED');
    expect(match.repoId).toBe(77);
    expect(match.prNumber).toBe(42);
    expect(match.explanation?.selectedPr).toEqual({
      challengeId: packet.id,
      repoId: '77',
      prNumber: 42,
      sourceVersion: packet.repoSnapshotId,
    });
    expect(match.explanation?.evidence.length).toBeGreaterThanOrEqual(2);
    const queryRow = sqlite.prepare(
      'SELECT query_json FROM match_runs WHERE id = ?',
    ).get(match.matchRunId) as { query_json: string };
    const query = JSON.parse(queryRow.query_json) as {
      validationAtoms: Array<{
        concepts: string[];
        sourceRefs: Array<{ exactText?: string }>;
      }>;
    };
    const crystallineAtoms = query.validationAtoms.filter((atom) =>
      atom.concepts.includes('term:crystalline-quorum-ledger')
    );
    expect(crystallineAtoms.flatMap((atom) =>
      atom.sourceRefs.map((ref) => ref.exactText)
    )).toEqual(expect.arrayContaining([
      'resume: implemented CrystallineQuorumLedger commits for order recovery',
      'meeting: debugged CrystallineQuorumLedger replay during an outage',
    ]));
    expect(match.explanation?.evidence.some((entry) =>
      entry.candidateSourceRefs.some((ref) =>
        ref.exactText === 'resume: implemented CrystallineQuorumLedger commits for order recovery'
        || ref.exactText === 'meeting: debugged CrystallineQuorumLedger replay during an outage'
      )
      && entry.challengeSourceRefs.some((ref) =>
        ref.exactText?.includes('writeCrystallineQuorumLedger')
      )
    )).toBe(true);
    expect(match.explanation?.evidence.every((entry) =>
      entry.candidateSourceRefs.length > 0
      && entry.challengeSourceRefs.length > 0
      && entry.candidateSourceRefs.every((ref) =>
        ref.sourceRefType === 'source_span'
        && ref.exactText
        && ref.sourceRefId?.startsWith('candidate-span-')
      )
      && entry.challengeSourceRefs.every((ref) =>
        ref.sourceRefType === 'repo_source_span'
        && ref.exactText
        && ref.locator?.startsWith('src/orders/')
      ),
    )).toBe(true);
    expect(match.diagnostics?.evaluatedChallenges).toEqual([
      expect.objectContaining({
        challengeId: packet.id,
        repoId: '77',
        prNumber: 42,
        provenanceComplete: true,
        eligible: true,
      }),
    ]);

    const contextRecord = sqlite.prepare(
      `SELECT id
         FROM context_records
        WHERE scope_id = ?
          AND record_type = 'candidate_pr_match_decision'`,
    ).get(match.matchRunId) as { id: string };
    const contextRefs = sqlite.prepare(
      `SELECT source_ref_type, source_ref_id, exact_text, evidence_role
         FROM context_record_source_refs
        WHERE context_record_id = ?`,
    ).all(contextRecord.id) as Array<{
      source_ref_type: string;
      source_ref_id: string;
      exact_text: string | null;
      evidence_role: string;
    }>;
    expect(contextRefs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source_ref_type: 'review_challenge_packet',
        source_ref_id: packet.id,
        evidence_role: 'selected_packet',
      }),
      expect.objectContaining({
        source_ref_type: 'source_span',
        source_ref_id: 'candidate-span-1',
        exact_text: 'resume: implemented CrystallineQuorumLedger commits for order recovery',
        evidence_role: 'selected_candidate_evidence',
      }),
    ]));
    expect(contextRefs.some((ref) =>
      ref.evidence_role === 'selected_repo_evidence'
      && ref.source_ref_type === 'repo_source_span'
      && (
        ref.exact_text?.includes('retryOrder')
        || ref.exact_text?.includes('retry order event')
      ),
    )).toBe(true);
  });

  it('builds a structured rollout report from backfill stats and filters', () => {
    const options: Options = {
      target: 'remote',
      dryRun: true,
      force: true,
      preflightGithub: false,
      json: true,
      batchSize: 3,
      repo: 'mui/base-ui',
      prNumber: 973,
    };

    const report = buildBackfillCliReport({
      stats: {
        selected: 3,
        built: 2,
        persisted: 0,
        dryRun: 2,
        ineligible: 1,
        skippedExisting: 4,
        skippedFetch: 1,
        skippedNoHunks: 0,
        errors: 0,
      },
      outcomes: [
        {
          repoId: 77,
          repoFullName: 'mui/base-ui',
          repoUrl: 'https://github.com/mui/base-ui',
          prNumber: 973,
          prUrl: 'https://github.com/mui/base-ui/pull/973',
          title: 'Refactor menu focus handling',
          status: 'dry_run_ready',
          packetId: 'challenge_packet_123',
          repoSnapshotId: 'repo_snapshot_123',
          packetContentHash: 'sha256:packet',
          eligible: true,
          qualityScore: 0.92,
          demandCount: 4,
          sourceSpanCount: 12,
          changedFileCount: 3,
          structuralFactCount: 7,
          error: null,
        },
      ],
    }, options);

    expect(report).toEqual({
      status: 'completed',
      mode: 'dry-run',
      target: 'remote',
      filters: {
        repoId: null,
        repo: 'mui/base-ui',
        prNumber: 973,
        force: true,
      },
      batchSize: 3,
      stats: {
        selected: 3,
        built: 2,
        persisted: 0,
        dryRun: 2,
        ineligible: 1,
        skippedExisting: 4,
        skippedFetch: 1,
        skippedNoHunks: 0,
        errors: 0,
      },
      outcomes: [
        {
          repoId: 77,
          repoFullName: 'mui/base-ui',
          repoUrl: 'https://github.com/mui/base-ui',
          prNumber: 973,
          prUrl: 'https://github.com/mui/base-ui/pull/973',
          title: 'Refactor menu focus handling',
          status: 'dry_run_ready',
          packetId: 'challenge_packet_123',
          repoSnapshotId: 'repo_snapshot_123',
          packetContentHash: 'sha256:packet',
          eligible: true,
          qualityScore: 0.92,
          demandCount: 4,
          sourceSpanCount: 12,
          changedFileCount: 3,
          structuralFactCount: 7,
          error: null,
        },
      ],
    });
  });

  it('reports GitHub API preflight success with rate-limit visibility', async () => {
    const result = await checkGitHubApiConnectivity({
      fetchImpl: async () => new Response('{}', {
        status: 200,
        headers: { 'x-ratelimit-remaining': '42' },
      }),
    });

    expect(result).toEqual({
      ok: true,
      endpoint: 'https://api.github.com/rate_limit',
      status: 200,
      message: 'GitHub API reachable',
      rateLimitRemaining: '42',
    });
  });

  it('reports GitHub API preflight network causes', async () => {
    const cause = Object.assign(new Error('Connect Timeout Error'), {
      code: 'UND_ERR_CONNECT_TIMEOUT',
    });
    const result = await checkGitHubApiConnectivity({
      fetchImpl: async () => {
        throw new Error('fetch failed', { cause });
      },
    });

    expect(result).toEqual({
      ok: false,
      endpoint: 'https://api.github.com/rate_limit',
      status: null,
      message: 'fetch failed (cause: Connect Timeout Error; code=UND_ERR_CONNECT_TIMEOUT)',
      rateLimitRemaining: null,
    });
  });
});
