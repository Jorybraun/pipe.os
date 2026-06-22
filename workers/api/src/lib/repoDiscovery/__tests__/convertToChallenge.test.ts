import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockD1, type BetterSqliteDb } from '../../../__tests__/helpers/mockD1';
import type { DiscoveredRepoRow } from '../../../types';
import { matchCandidateToReviewChallenge } from '../../challengeMatching/d1Matcher';
import type { ChallengePacket as RepoChallengePacket } from '../../repoSemanticGraph';
import {
  assertPacketProductionReady,
  convertRepoToChallenge,
  packetGateFailures,
} from '../convertToChallenge';

const repoGraphMigration = readFileSync(
  new URL('../../../../migrations/0083_repo_semantic_graph_and_match_runs.sql', import.meta.url),
  'utf8',
);
const livingContextMigration = readFileSync(
  new URL('../../../../migrations/0082_living_context_graph.sql', import.meta.url),
  'utf8',
);
const contextRecordMigration = readFileSync(
  new URL('../../../../migrations/0095_context_records.sql', import.meta.url),
  'utf8',
);

function changedPatch(label: string, lines = 8): string {
  return [
    `@@ -1,1 +1,${lines} @@`,
    ...Array.from({ length: lines }, (_, index) => `+${label} ${index + 1}`),
  ].join('\n');
}

function prResponse() {
  return {
    title: 'Add idempotent order retry flow',
    body: 'Adds bounded retry behavior and source-backed tests.',
    state: 'closed',
    user: { login: 'engineer' },
    created_at: '2026-06-18T12:00:00Z',
    merged_at: '2026-06-19T12:00:00Z',
    base: { ref: 'main', sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
    head: { ref: 'retry-orders', sha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
  };
}

function fileResponse(includeTest: boolean) {
  return [
    {
      filename: 'src/orders/retry.ts',
      status: 'modified',
      additions: 8,
      deletions: 1,
      patch: changedPatch('retry order event'),
    },
    {
      filename: 'src/orders/idempotency.ts',
      status: 'added',
      additions: 8,
      deletions: 0,
      patch: changedPatch('idempotency key write'),
    },
    {
      filename: includeTest ? 'src/orders/__tests__/retry.test.ts' : 'src/orders/audit.ts',
      status: 'modified',
      additions: 8,
      deletions: 1,
      patch: changedPatch(includeTest ? 'expect retry once' : 'audit retry evidence'),
    },
  ];
}

function headContentResponse(path: string): string | null {
  switch (path) {
    case 'src/orders/retry.ts':
      return [
        'import { publishOrderEvent } from "./events";',
        '',
        'export function retryOrder(orderId: string) {',
        '  return publishOrderEvent(orderId);',
        '}',
      ].join('\n');
    case 'src/orders/idempotency.ts':
      return [
        'export function idempotencyKey(orderId: string) {',
        '  return `order:${orderId}`;',
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
    case 'src/orders/audit.ts':
      return [
        'export function auditRetry(orderId: string) {',
        '  return orderId;',
        '}',
      ].join('\n');
    default:
      return null;
  }
}

function mockGitHubFetch(includeTest: boolean): void {
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => {
    const href = String(url);
    if (href.endsWith('/pulls/42')) {
      return new Response(JSON.stringify(prResponse()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (href.endsWith('/pulls/42/files?per_page=100')) {
      return new Response(JSON.stringify(fileResponse(includeTest)), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const contentsMatch = href.match(/\/contents\/([^?]+)\?ref=/);
    if (contentsMatch) {
      const content = headContentResponse(decodeURIComponent(contentsMatch[1] ?? ''));
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

function discoveredRepo(): DiscoveredRepoRow {
  return {
    id: 'discovered-1',
    pipeline_id: 'pipeline-1',
    role_context_id: null,
    owner_id: 'user-1',
    github_owner: 'pipe-labs',
    github_repo: 'orders',
    github_url: 'https://github.com/pipe-labs/orders',
    default_branch: 'main',
    discovery_source: 'MANUAL',
    discovery_query: null,
    stars: 100,
    last_pushed_at: null,
    license: null,
    is_archived: 0,
    is_fork: 0,
    has_ci: 1,
    primary_language: 'TypeScript',
    topics: null,
    detected_stack: null,
    stack_match_score: null,
    sloc: null,
    mean_cyclomatic_complexity: null,
    source_file_count: null,
    seniority_band: 'SENIOR',
    quality_score: null,
    quality_details: null,
    status: 'ACCEPTED',
    rejection_reason: null,
    error_message: null,
    challenge_template_id: null,
    created_at: '2026-06-20T00:00:00.000Z',
    updated_at: '2026-06-20T00:00:00.000Z',
  };
}

function setupDb(): BetterSqliteDb {
  const sqlite = new Database(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  sqlite.exec(`
    CREATE TABLE discovered_repos (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      error_message TEXT,
      challenge_template_id TEXT,
      updated_at TEXT
    );
    INSERT INTO discovered_repos (id, status, error_message, challenge_template_id, updated_at)
    VALUES ('discovered-1', 'ACCEPTED', NULL, NULL, '2026-06-20T00:00:00.000Z');

    CREATE TABLE qualified_repos (
      id INTEGER PRIMARY KEY,
      github_url TEXT UNIQUE NOT NULL,
      full_name TEXT NOT NULL
    );
    INSERT INTO qualified_repos (id, github_url, full_name)
    VALUES (99, 'https://github.com/pipe-labs/orders', 'pipe-labs/orders');

    CREATE TABLE challenge_templates (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      instructions TEXT,
      difficulty TEXT,
      primary_skill TEXT,
      config TEXT,
      server_config TEXT,
      source TEXT,
      is_published INTEGER,
      created_by TEXT,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE candidates (id TEXT PRIMARY KEY);
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

interface CandidateConceptEvidence {
  conceptKey: string;
  exactText: string;
  predicate: string;
  evidenceLevel: 'implemented' | 'validated' | 'demonstrated';
}

function seedCandidateEvidenceForConcepts(
  sqlite: BetterSqliteDb,
  evidence: CandidateConceptEvidence[],
): void {
  const now = '2026-06-20T00:00:00.000Z';
  const content = evidence.map((item) => item.exactText).join('\n');
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
    INSERT INTO interactions (
      id, ingestion_key, workspace_person_id, application_id, interaction_type, metadata_json, created_at, updated_at
    ) VALUES (
      'interaction-1', 'interaction-1', 'workspace-person-1', 'application-1', 'assessment', '{}', '${now}', '${now}'
    );
    INSERT INTO artifacts (
      id, ingestion_key, workspace_person_id, interaction_id, artifact_type, metadata_json, created_at, updated_at
    ) VALUES (
      'artifact-1', 'artifact-1', 'workspace-person-1', 'interaction-1', 'assessment_response', '{}', '${now}', '${now}'
    );
  `);
  sqlite.prepare(
    `INSERT INTO artifact_versions (
       id, ingestion_key, artifact_id, version_number, content_hash, media_type,
       content_text, byte_length, metadata_json, created_at
     ) VALUES (
       'artifact-version-1', 'artifact-version-1', 'artifact-1', 1, 'sha256:candidate-retry',
       'text/plain', ?, ?, '{}', ?
     )`,
  ).run(content, content.length, now);

  let searchFrom = 0;
  for (const [index, item] of evidence.entries()) {
    const ordinal = index + 1;
    const conceptLabel = labelForConcept(item.conceptKey);
    const start = content.indexOf(item.exactText, searchFrom);
    const end = start + item.exactText.length;
    searchFrom = end;
    sqlite.prepare(
      `INSERT INTO source_spans (
         id, ingestion_key, artifact_version_id, byte_start, byte_end, char_start, char_end,
         line_start, line_end, exact_text, exact_text_hash, metadata_json, created_at
       ) VALUES (?, ?, 'artifact-version-1', ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?)`,
    ).run(
      `candidate-span-${ordinal}`,
      `candidate-span-${ordinal}`,
      start,
      end,
      start,
      end,
      ordinal,
      ordinal,
      item.exactText,
      `sha256:candidate-span-${ordinal}`,
      now,
    );
    sqlite.prepare(
      `INSERT INTO episodes (
         id, ingestion_key, workspace_person_id, interaction_id, narrative, metadata_json, created_at, updated_at
       ) VALUES (?, ?, 'workspace-person-1', 'interaction-1', ?, '{}', ?, ?)`,
    ).run(
      `episode-${ordinal}`,
      `episode-${ordinal}`,
      `Candidate described ${item.exactText}.`,
      now,
      now,
    );
    const existingConcept = sqlite.prepare(
      'SELECT id FROM concepts WHERE canonical_key = ?',
    ).get(item.conceptKey) as { id: string } | undefined;
    const conceptId = existingConcept?.id ?? `concept-${ordinal}`;
    if (!existingConcept) {
      sqlite.prepare(
        `INSERT INTO concepts (
           id, ingestion_key, canonical_key, namespace, label, aliases_json, metadata_json, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, '[]', '{}', ?, ?)`,
      ).run(
        conceptId,
        `concept-${ordinal}`,
        item.conceptKey,
        item.conceptKey.split(':', 1)[0] || 'term',
        conceptLabel,
        now,
        now,
      );
    }
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
    ).run(`assertion-${ordinal}`, conceptId, now);
    sqlite.prepare(
      `INSERT INTO signal_evidence (
         id, ingestion_key, workspace_person_id, interaction_id, assertion_id, concept_id,
         signal_key, evidence_level, strength, polarity, metadata_json, created_at, updated_at
       ) VALUES (?, ?, 'workspace-person-1', 'interaction-1', ?, ?, ?, ?, 1, 1, '{}', ?, ?)`,
    ).run(
      `evidence-${ordinal}`,
      `evidence-${ordinal}`,
      `assertion-${ordinal}`,
      conceptId,
      item.conceptKey,
      item.evidenceLevel,
      now,
      now,
    );
  }
}

describe('convertRepoToChallenge packet readiness guard', () => {
  let sqlite: BetterSqliteDb | null = null;

  beforeEach(() => {
    sqlite = setupDb();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sqlite?.close();
    sqlite = null;
  });

  it('reports failed gates from a review challenge packet', () => {
    const failures = packetGateFailures({
      quality: {
        eligible: false,
        score: 0.52,
        metrics: {
          provenanceCoverage: 1,
          reviewableSize: 1,
          testCoverage: 0,
          issueContext: 0,
          demandDiversity: 0.5,
        },
        gates: [
          { gate: 'complete_provenance', passed: true, reason: 'all evidence resolves to exact source spans' },
          { gate: 'contains_tests', passed: false, reason: '0 normalized test changes available' },
          { gate: 'minimum_quality', passed: false, reason: 'quality score 0.52; minimum 0.7' },
        ],
      },
    });

    expect(failures).toEqual([
      'contains_tests: 0 normalized test changes available',
      'minimum_quality: quality score 0.52; minimum 0.7',
    ]);
  });

  it('throws before legacy challenge-template creation when packet is not production-ready', () => {
    expect(() => assertPacketProductionReady({
      id: 'packet-not-ready',
      quality: {
        eligible: false,
        score: 0.45,
        metrics: {
          provenanceCoverage: 1,
          reviewableSize: 1,
          testCoverage: 0,
          issueContext: 0,
          demandDiversity: 0.5,
        },
        gates: [
          { gate: 'contains_tests', passed: false, reason: '0 normalized test changes available' },
        ],
      },
    })).toThrow(
      'Review challenge packet packet-not-ready is not production-ready. Failed gates: contains_tests: 0 normalized test changes available',
    );
  });

  it('persists an eligible source-backed packet before creating the legacy challenge template', async () => {
    mockGitHubFetch(true);

    const result = await convertRepoToChallenge(createMockD1(sqlite!), discoveredRepo(), {
      prNumber: 42,
    });

    expect(result).toMatchObject({
      prNumber: 42,
      packetEligible: true,
      packetGateFailures: [],
    });
    expect(result.packetId).toMatch(/^challenge_packet_/);
    expect(sqlite!.prepare('SELECT COUNT(*) AS count FROM review_challenge_packets').get()).toEqual({ count: 1 });
    expect(sqlite!.prepare('SELECT production_ready AS ready FROM review_challenge_packets').get()).toEqual({ ready: 1 });
    expect((sqlite!.prepare('SELECT COUNT(*) AS count FROM repo_source_spans').get() as { count: number }).count)
      .toBeGreaterThan(4);
    expect(sqlite!.prepare(
      "SELECT COUNT(*) AS count FROM repo_source_artifacts WHERE external_reference LIKE '%/contents/src/orders/%'",
    ).get()).toEqual({ count: 3 });
    expect((sqlite!.prepare(
      "SELECT COUNT(*) AS count FROM repo_structural_facts WHERE fact_type = 'calls'",
    ).get() as { count: number }).count).toBeGreaterThan(0);
    expect(sqlite!.prepare('SELECT COUNT(*) AS count FROM challenge_templates').get()).toEqual({ count: 1 });
    expect(sqlite!.prepare('SELECT status FROM discovered_repos WHERE id = ?').get('discovered-1')).toEqual({
      status: 'CHALLENGE_READY',
    });
  });

  it('feeds fetched GitHub PR packets into deterministic candidate matching with provenance', async () => {
    mockGitHubFetch(true);

    const conversion = await convertRepoToChallenge(createMockD1(sqlite!), discoveredRepo(), {
      prNumber: 42,
    });
    const packetRow = sqlite!.prepare(
      'SELECT packet_json FROM review_challenge_packets WHERE id = ?',
    ).get(conversion.packetId) as { packet_json: string };
    const packet = JSON.parse(packetRow.packet_json) as RepoChallengePacket;
    const commonSourceTerms = packet.demands
      .map((demand) => new Set(demand.conceptKeys.filter((key) => key.startsWith('term:'))))
      .reduce<string[]>((common, terms, index) => {
        if (index === 0) return [...terms];
        return common.filter((term) => terms.has(term));
      }, []);

    expect(packet.quality.eligible).toBe(true);
    expect(packet.demands.length).toBeGreaterThanOrEqual(2);
    expect(commonSourceTerms).toContain('term:retry');

    const candidateEvidence: CandidateConceptEvidence[] = [
      {
        conceptKey: 'term:idempotency',
        exactText: 'implemented idempotency key handling',
        predicate: 'implemented',
        evidenceLevel: 'implemented',
      },
      {
        conceptKey: 'term:retry',
        exactText: 'validated retry handling',
        predicate: 'validated',
        evidenceLevel: 'validated',
      },
      {
        conceptKey: 'term:retry-order',
        exactText: 'implemented retry order flow',
        predicate: 'implemented',
        evidenceLevel: 'implemented',
      },
      {
        conceptKey: 'term:publishorderevent',
        exactText: 'demonstrated publish order event call tracing',
        predicate: 'demonstrated',
        evidenceLevel: 'demonstrated',
      },
      {
        conceptKey: 'term:events',
        exactText: 'maintained events import boundary',
        predicate: 'demonstrated',
        evidenceLevel: 'demonstrated',
      },
      {
        conceptKey: 'term:test',
        exactText: 'validated source test coverage',
        predicate: 'validated',
        evidenceLevel: 'validated',
      },
    ];
    expect(candidateEvidence.every((item) =>
      packet.demands.some((demand) => demand.conceptKeys.includes(item.conceptKey)),
    )).toBe(true);
    seedCandidateEvidenceForConcepts(sqlite!, candidateEvidence);

    const match = await matchCandidateToReviewChallenge(createMockD1(sqlite!), 'candidate-1');

    expect(match.status).toBe('MATCHED');
    expect(match.repoId).toBe(99);
    expect(match.prNumber).toBe(42);
    expect(match.explanation?.selectedPr).toEqual({
      challengeId: conversion.packetId,
      repoId: '99',
      prNumber: 42,
      sourceVersion: packet.repoSnapshotId,
    });
    expect(match.explanation?.evidence.length).toBeGreaterThanOrEqual(2);
    expect(match.explanation?.missingEvidence).toEqual([
      expect.objectContaining({
        scope: 'candidate',
        reason: 'NO_SOURCE_BACKED_CANDIDATE_ALIGNMENT',
        challengeId: conversion.packetId,
        sourceRefs: expect.arrayContaining([
          expect.objectContaining({
            sourceRefType: 'repo_source_span',
            exactText: expect.stringContaining('idempotencyKey'),
          }),
        ]),
      }),
    ]);
    expect(match.explanation?.rejectedPackets).toEqual([]);
    expect(match.diagnostics?.evaluatedChallenges).toEqual([
      expect.objectContaining({
        challengeId: conversion.packetId,
        repoId: '99',
        prNumber: 42,
        provenanceComplete: true,
        eligible: true,
      }),
    ]);
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

    const matchRow = sqlite!.prepare(
      'SELECT selected_packet_id, ranked_results_json FROM match_runs WHERE id = ?',
    ).get(match.matchRunId) as {
      selected_packet_id: string;
      ranked_results_json: string;
    };
    expect(matchRow.selected_packet_id).toBe(conversion.packetId);
    const [rankedResult] = JSON.parse(matchRow.ranked_results_json) as Array<{
      challengeId: string;
      alignments: Array<{
        sharedConcepts: string[];
        candidateSourceRefs: Array<{ sourceRefType?: string; exactText?: string }>;
        challengeSourceRefs: Array<{ sourceRefType?: string; exactText?: string }>;
      }>;
    }>;
    expect(rankedResult).toEqual(expect.objectContaining({
      challengeId: conversion.packetId,
    }));
    expect(rankedResult.alignments.every((alignment) =>
      alignment.sharedConcepts.length > 0
      && alignment.candidateSourceRefs.some((ref) => ref.sourceRefType === 'source_span' && ref.exactText)
      && alignment.challengeSourceRefs.some((ref) => ref.sourceRefType === 'repo_source_span' && ref.exactText),
    )).toBe(true);
    expect(rankedResult.alignments.some((alignment) =>
      alignment.sharedConcepts.includes('term:retry'),
    )).toBe(true);

    const contextRecord = sqlite!.prepare(
      `SELECT id
         FROM context_records
        WHERE scope_id = ?
          AND record_type = 'candidate_pr_match_decision'`,
    ).get(match.matchRunId) as { id: string };
    const contextRefs = sqlite!.prepare(
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
        source_ref_id: conversion.packetId,
        evidence_role: 'selected_packet',
      }),
      expect.objectContaining({
        source_ref_type: 'source_span',
        source_ref_id: 'candidate-span-1',
        exact_text: 'implemented idempotency key handling',
        evidence_role: 'selected_candidate_evidence',
      }),
      expect.objectContaining({
        source_ref_type: 'source_span',
        source_ref_id: 'candidate-span-2',
        exact_text: 'validated retry handling',
        evidence_role: 'selected_candidate_evidence',
      }),
    ]));
    expect(contextRefs.some((ref) =>
      ref.evidence_role === 'selected_repo_evidence'
      && ref.source_ref_type === 'repo_source_span'
      && ref.exact_text?.includes('retry order event'),
    )).toBe(true);
  });

  it('keeps ineligible packet diagnostics but does not create a legacy challenge template', async () => {
    mockGitHubFetch(false);

    await expect(convertRepoToChallenge(createMockD1(sqlite!), discoveredRepo(), {
      prNumber: 42,
    })).rejects.toThrow('is not production-ready');

    expect(sqlite!.prepare('SELECT COUNT(*) AS count FROM review_challenge_packets').get()).toEqual({ count: 1 });
    expect(sqlite!.prepare('SELECT production_ready AS ready FROM review_challenge_packets').get()).toEqual({ ready: 0 });
    expect(sqlite!.prepare('SELECT COUNT(*) AS count FROM challenge_templates').get()).toEqual({ count: 0 });
    const failed = sqlite!.prepare(
      'SELECT status, error_message FROM discovered_repos WHERE id = ?',
    ).get('discovered-1') as { status: string; error_message: string };
    expect(failed.status).toBe('FAILED');
    expect(failed.error_message).toContain('contains_tests');
  });

  it('does not auto-select undersized fallback PRs when no reviewable PR is listed', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.includes('/pulls?state=closed')) {
        return new Response(JSON.stringify([
          {
            number: 7,
            title: 'Tiny typo fix',
            body: null,
            state: 'closed',
            merged_at: '2026-06-19T12:00:00Z',
            changed_files: 1,
            additions: 1,
            deletions: 0,
          },
        ]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('unexpected fetch', { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(convertRepoToChallenge(createMockD1(sqlite!), discoveredRepo(), {}))
      .rejects.toThrow('No suitable merged PRs found in this repo for a review challenge packet');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sqlite!.prepare('SELECT COUNT(*) AS count FROM review_challenge_packets').get()).toEqual({ count: 0 });
    expect(sqlite!.prepare('SELECT COUNT(*) AS count FROM challenge_templates').get()).toEqual({ count: 0 });
    const failed = sqlite!.prepare(
      'SELECT status, error_message FROM discovered_repos WHERE id = ?',
    ).get('discovered-1') as { status: string; error_message: string };
    expect(failed.status).toBe('FAILED');
    expect(failed.error_message).toContain('Automatic selection requires a merged PR with 3-50 changed files');
  });
});
