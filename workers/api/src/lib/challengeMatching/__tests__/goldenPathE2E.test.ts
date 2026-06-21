import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockD1, type BetterSqliteDb } from '../../../__tests__/helpers/mockD1';
import {
  matchCandidateToReviewChallenge,
} from '../d1Matcher';
import type { ChallengePacket as RepoChallengePacket } from '../../repoSemanticGraph';
import type { MatchExplanation } from '../types';

const livingMigration = readFileSync(
  new URL('../../../../migrations/0082_living_context_graph.sql', import.meta.url),
  'utf8',
);
const matchingMigration = readFileSync(
  new URL('../../../../migrations/0083_repo_semantic_graph_and_match_runs.sql', import.meta.url),
  'utf8',
);
const transcriptProjectionMigration = readFileSync(
  new URL('../../../../migrations/0091_transcript_semantic_projections.sql', import.meta.url),
  'utf8',
);
const conceptRegistryMigration = readFileSync(
  new URL('../../../../migrations/0094_concept_registry.sql', import.meta.url),
  'utf8',
);

function seedEligiblePacket(sqlite: BetterSqliteDb): void {
  const packet: RepoChallengePacket = {
    schemaVersion: '1.0.0',
    policyVersion: 'repo-challenge-v1',
    id: 'packet-eligible-kafka',
    repoSnapshotId: 'snapshot-1',
    repository: {
      provider: 'github',
      owner: 'acme',
      name: 'payments',
      canonicalUrl: 'https://github.com/acme/payments',
    },
    pullRequest: {
      number: 99,
      url: 'https://github.com/acme/payments/pull/99',
      title: 'Idempotent Kafka consumer with retry semantics',
      author: 'engineer',
      baseSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      headSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      mergedAt: '2026-06-10T12:00:00.000Z',
    },
    languageSupport: {
      language: 'TypeScript',
      normalizedLanguage: 'typescript',
      level: 'production',
      parser: 'typescript-compiler-api',
      challengePacketsAllowed: true,
      reason: 'typescript has a validated semantic extraction adapter',
    },
    changedFilePaths: ['src/consumer.ts', 'src/retry.ts'],
    changedSymbolIds: [],
    sourceSpanIds: ['repo-span-kafka', 'repo-span-retry'],
    testChanges: [],
    demands: [
      {
        id: 'demand-kafka',
        family: 'artifact:source',
        narrative: 'Review idempotent Kafka consumer offset commit logic.',
        conceptKeys: ['term:kafka', 'term:idempotency'],
        mechanisms: [],
        sourceSpanIds: ['repo-span-kafka'],
        changedSymbolIds: [],
        weight: 0.6,
        contentHash: 'sha256:demand-kafka',
      },
      {
        id: 'demand-retry',
        family: 'verification:retry',
        narrative: 'Review exponential backoff retry strategy.',
        conceptKeys: ['term:retry', 'term:exponential-backoff'],
        mechanisms: [],
        sourceSpanIds: ['repo-span-retry'],
        changedSymbolIds: [],
        weight: 0.4,
        contentHash: 'sha256:demand-retry',
      },
    ],
    demandFamilies: ['artifact:source', 'verification:retry'],
    quality: {
      score: 0.92,
      metrics: {
        provenanceCoverage: 1,
        reviewableSize: 0.9,
        testCoverage: 0.85,
        issueContext: 0.9,
        demandDiversity: 1,
      },
      gates: [],
      eligible: true,
    },
    contentHash: 'sha256:packet-eligible-kafka',
  };

  sqlite.exec(`
    INSERT INTO qualified_repos (id) VALUES (1);
    INSERT INTO repo_snapshots (id, repo_id, commit_sha, extractor_version)
    VALUES ('snapshot-1', 1, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', '1.0.0');
    INSERT INTO repo_source_artifacts (id, repo_snapshot_id, artifact_type, path, external_reference)
    VALUES
      ('repo-art-consumer', 'snapshot-1', 'source', 'src/consumer.ts', 'https://github.com/acme/payments/blob/bbbb/src/consumer.ts'),
      ('repo-art-retry', 'snapshot-1', 'source', 'src/retry.ts', 'https://github.com/acme/payments/blob/bbbb/src/retry.ts');
    INSERT INTO repo_artifact_versions (id, artifact_id, content_hash, inline_content, byte_length, media_type)
    VALUES
      ('repo-ver-consumer', 'repo-art-consumer', 'sha256:consumer', 'export function processKafkaEvent(event: KafkaEvent) { /* idempotent offset commit */ }', 88, 'text/plain'),
      ('repo-ver-retry', 'repo-art-retry', 'sha256:retry', 'export function retryWithBackoff(fn: () => Promise<void>, maxRetries = 3) { /* exponential + jitter */ }', 100, 'text/plain');
    INSERT INTO repo_source_spans (id, artifact_version_id, content_hash, path, byte_start, byte_end, line_start, line_end, pr_side, base_sha, head_sha, exact_text)
    VALUES
      ('repo-span-kafka', 'repo-ver-consumer', 'sha256:consumer', 'src/consumer.ts', 0, 88, 1, 1, 'head', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
       'export function processKafkaEvent(event: KafkaEvent) { /* idempotent offset commit */ }'),
      ('repo-span-retry', 'repo-ver-retry', 'sha256:retry', 'src/retry.ts', 0, 100, 1, 1, 'head', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
       'export function retryWithBackoff(fn: () => Promise<void>, maxRetries = 3) { /* exponential + jitter */ }');
  `);
  sqlite.prepare(
    `INSERT INTO review_challenge_packets (
       id, repo_snapshot_id, repo_id, pr_number, packet_version, source_hash,
       language, production_ready, quality_score, demand_families_json, packet_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    packet.id,
    packet.repoSnapshotId,
    1,
    packet.pullRequest.number,
    packet.policyVersion,
    packet.contentHash,
    packet.languageSupport.normalizedLanguage,
    1,
    packet.quality.score,
    JSON.stringify(packet.demandFamilies),
    JSON.stringify(packet),
  );
}

function seedCandidateEvidence(sqlite: BetterSqliteDb): void {
  const now = '2026-06-14T08:00:00.000Z';
  sqlite.exec(`
    INSERT INTO people (
      id, ingestion_key, display_name, primary_email, external_ids_json, created_at, updated_at
    ) VALUES (
      'person-gp', 'person-gp', 'Golden Path Candidate', 'gp@example.com', '{}', '${now}', '${now}'
    );
    INSERT INTO workspace_people (
      id, ingestion_key, workspace_id, person_id, context_json, created_at, updated_at
    ) VALUES (
      'wsp-gp', 'wsp-gp', 'workspace-1', 'person-gp', '{}', '${now}', '${now}'
    );
    INSERT INTO applications (
      id, ingestion_key, workspace_person_id, legacy_candidate_id, context_json, created_at, updated_at
    ) VALUES (
      'app-gp', 'app-gp', 'wsp-gp', 'candidate-gp', '{}', '${now}', '${now}'
    );
    INSERT INTO interactions (
      id, ingestion_key, workspace_person_id, application_id, interaction_type, metadata_json, created_at, updated_at
    ) VALUES
      ('ix-meeting', 'ix-meeting', 'wsp-gp', 'app-gp', 'meeting', '{}', '${now}', '${now}'),
      ('ix-resume', 'ix-resume', 'wsp-gp', 'app-gp', 'resume_upload', '{}', '${now}', '${now}');

    INSERT INTO artifacts (
      id, ingestion_key, workspace_person_id, interaction_id, artifact_type, metadata_json, created_at, updated_at
    ) VALUES
      ('art-meeting', 'art-meeting', 'wsp-gp', 'ix-meeting', 'meeting_transcript', '{}', '${now}', '${now}'),
      ('art-resume', 'art-resume', 'wsp-gp', 'ix-resume', 'resume', '{}', '${now}', '${now}');

    INSERT INTO artifact_versions (
      id, ingestion_key, artifact_id, version_number, content_hash, media_type, content_text, byte_length, metadata_json, created_at
    ) VALUES
      ('av-meeting', 'av-meeting', 'art-meeting', 1, 'sha256:meeting-gp', 'text/plain',
       'I implemented idempotent Kafka consumers at scale and validated retry handling with exponential backoff.', 103, '{}', '${now}'),
      ('av-resume', 'av-resume', 'art-resume', 1, 'sha256:resume-gp', 'text/plain',
       'Built distributed payment processing with Apache Kafka, including consumer group rebalancing and dead-letter queues.', 116, '{}', '${now}');

    INSERT INTO source_spans (
      id, ingestion_key, artifact_version_id, byte_start, byte_end, char_start, char_end,
      line_start, line_end, exact_text, exact_text_hash, metadata_json, created_at
    ) VALUES
      ('span-kafka-meeting', 'span-kafka-meeting', 'av-meeting', 0, 50, 0, 50, 1, 1,
       'I implemented idempotent Kafka consumers at scale', 'sha256:span-kafka-m', '{}', '${now}'),
      ('span-retry-resume', 'span-retry-resume', 'av-resume', 0, 60, 0, 60, 1, 1,
       'validated retry handling with exponential backoff', 'sha256:span-retry-r', '{}', '${now}');

    INSERT INTO episodes (
      id, ingestion_key, workspace_person_id, interaction_id, narrative, metadata_json, created_at, updated_at
    ) VALUES
      ('ep-meeting', 'ep-meeting', 'wsp-gp', 'ix-meeting',
       'Candidate described implementing idempotent Kafka consumers.', '{}', '${now}', '${now}'),
      ('ep-resume', 'ep-resume', 'wsp-gp', 'ix-resume',
       'Resume shows retry handling with exponential backoff.', '{}', '${now}', '${now}');

    INSERT INTO concepts (
      id, ingestion_key, canonical_key, namespace, label, aliases_json, metadata_json, created_at, updated_at
    ) VALUES
      ('c-kafka', 'c-kafka', 'term:kafka', 'term', 'kafka', '[]', '{}', '${now}', '${now}'),
      ('c-retry', 'c-retry', 'term:retry', 'term', 'retry', '[]', '{}', '${now}', '${now}'),
      ('c-idempotency', 'c-idempotency', 'term:idempotency', 'term', 'idempotency', '[]', '{}', '${now}', '${now}'),
      ('c-exp-backoff', 'c-exp-backoff', 'term:exponential-backoff', 'term', 'exponential backoff', '[]', '{}', '${now}', '${now}');

    INSERT INTO semantic_assertions (
      id, ingestion_key, workspace_person_id, episode_id, subject_type, subject_id,
      predicate, object_type, object_value_json, narrative, qualifiers_json, confidence,
      polarity, extraction_version, observed_at, created_at, updated_at
    ) VALUES
      ('sa-kafka-impl', 'sa-kafka-impl', 'wsp-gp', 'ep-meeting', 'person', 'person-gp',
       'implemented', 'concept', '{"value":"kafka"}',
       'Implemented idempotent Kafka consumers at scale.', '{}', 1, 1, 'test', '${now}', '${now}', '${now}'),
      ('sa-retry-val', 'sa-retry-val', 'wsp-gp', 'ep-resume', 'person', 'person-gp',
       'validated', 'concept', '{"value":"retry"}',
       'Validated retry handling with exponential backoff.', '{}', 1, 1, 'test', '${now}', '${now}', '${now}');

    INSERT INTO assertion_source_spans (assertion_id, source_span_id, evidence_role, created_at)
    VALUES
      ('sa-kafka-impl', 'span-kafka-meeting', 'support', '${now}'),
      ('sa-retry-val', 'span-retry-resume', 'support', '${now}');

    INSERT INTO assertion_concepts (assertion_id, concept_id, relationship, weight, created_at)
    VALUES
      ('sa-kafka-impl', 'c-kafka', 'about', 1, '${now}'),
      ('sa-kafka-impl', 'c-idempotency', 'about', 1, '${now}'),
      ('sa-retry-val', 'c-retry', 'about', 1, '${now}'),
      ('sa-retry-val', 'c-exp-backoff', 'about', 1, '${now}');

    INSERT INTO signal_evidence (
      id, ingestion_key, workspace_person_id, interaction_id, assertion_id, concept_id,
      signal_key, evidence_level, strength, polarity, metadata_json, created_at, updated_at
    ) VALUES
      ('ev-kafka-impl', 'ev-kafka-impl', 'wsp-gp', 'ix-meeting', 'sa-kafka-impl', 'c-kafka',
       'term:kafka', 'implemented', 1, 1, '{}', '${now}', '${now}'),
      ('ev-idemp', 'ev-idemp', 'wsp-gp', 'ix-meeting', 'sa-kafka-impl', 'c-idempotency',
       'term:idempotency', 'implemented', 1, 1, '{}', '${now}', '${now}'),
      ('ev-retry', 'ev-retry', 'wsp-gp', 'ix-resume', 'sa-retry-val', 'c-retry',
       'term:retry', 'validated', 1, 1, '{}', '${now}', '${now}'),
      ('ev-backoff', 'ev-backoff', 'wsp-gp', 'ix-resume', 'sa-retry-val', 'c-exp-backoff',
       'term:exponential-backoff', 'validated', 1, 1, '{}', '${now}', '${now}');
  `);
}

describe('golden-path E2E — acceptance criteria #1, #2, #4, #5, #6, #8', () => {
  let sqlite: BetterSqliteDb;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE candidates (id TEXT PRIMARY KEY);
      CREATE TABLE qualified_repos (id INTEGER PRIMARY KEY);
      INSERT INTO candidates (id) VALUES ('candidate-gp');
    `);
    sqlite.exec(livingMigration);
    sqlite.exec(matchingMigration);
    sqlite.exec(transcriptProjectionMigration);
    sqlite.exec(conceptRegistryMigration);
    db = createMockD1(sqlite);
  });

  afterEach(() => sqlite.close());

  it('full pipeline: person graph → evidence → deterministic matching → explanation', async () => {
    seedCandidateEvidence(sqlite);
    seedEligiblePacket(sqlite);

    const result = await matchCandidateToReviewChallenge(db, 'candidate-gp');

    expect(result.status).toBe('MATCHED');
    expect(result.prNumber).toBe(99);
    expect(result.repoId).toBe(1);
    expect(result.explanation).toBeDefined();

    const explanation = result.explanation as MatchExplanation;
    expect(explanation.status).toBe('MATCHED');
    expect(explanation.challengeId).toBe('packet-eligible-kafka');
    expect(explanation.prNumber).toBe(99);
    expect(explanation.score).toBeGreaterThan(0);
    expect(explanation.score).toBeLessThanOrEqual(1);

    expect(explanation.evidence.length).toBeGreaterThan(0);
    for (const ev of explanation.evidence) {
      expect(ev.candidateSourceRefs.length).toBeGreaterThan(0);
      expect(ev.challengeSourceRefs.length).toBeGreaterThan(0);
      for (const ref of ev.candidateSourceRefs) {
        expect(ref.artifactId).toBeTruthy();
        expect(ref.contentHash).toBeTruthy();
        expect(ref.exactText).toBeTruthy();
        expect(ref.startOffset).toBeGreaterThanOrEqual(0);
        expect(ref.endOffset).toBeGreaterThan(ref.startOffset);
      }
      for (const ref of ev.challengeSourceRefs) {
        expect(ref.artifactId).toBeTruthy();
        expect(ref.contentHash).toBeTruthy();
        expect(ref.exactText).toBeTruthy();
        expect(ref.startOffset).toBeGreaterThanOrEqual(0);
        expect(ref.endOffset).toBeGreaterThan(ref.startOffset);
      }
    }

    expect(explanation.unmatchedDemands).toBeDefined();
    expect(Array.isArray(explanation.unmatchedDemands)).toBe(true);

    expect(explanation.stretchAreas).toBeDefined();
    expect(Array.isArray(explanation.stretchAreas)).toBe(true);

    expect(explanation.rejectionReasons).toEqual([]);
    expect(explanation.summary).toContain('source-backed');
  });

  it('match run is persisted deterministically in D1', async () => {
    seedCandidateEvidence(sqlite);
    seedEligiblePacket(sqlite);

    const result = await matchCandidateToReviewChallenge(db, 'candidate-gp');

    const matchRun = sqlite.prepare(
      `SELECT id, candidate_id, status, selected_packet_id, ranked_results_json
         FROM match_runs WHERE id = ?`,
    ).get(result.matchRunId) as {
      id: string;
      candidate_id: string;
      status: string;
      selected_packet_id: string | null;
      ranked_results_json: string;
    };

    expect(matchRun).toBeDefined();
    expect(matchRun.candidate_id).toBe('candidate-gp');
    expect(matchRun.status).toBe('MATCHED');
    expect(matchRun.selected_packet_id).toBe('packet-eligible-kafka');

    const rankedResults = JSON.parse(matchRun.ranked_results_json) as Array<{
      challengeId: string;
      score: number;
      eligible: boolean;
      alignedDemandCount: number;
      provenanceComplete: boolean;
    }>;
    expect(rankedResults.length).toBeGreaterThan(0);

    const topResult = rankedResults[0];
    expect(topResult.challengeId).toBe('packet-eligible-kafka');
    expect(topResult.eligible).toBe(true);
    expect(topResult.provenanceComplete).toBe(true);
    expect(topResult.alignedDemandCount).toBeGreaterThan(0);
  });

  it('idempotent re-run produces identical match run results', async () => {
    seedCandidateEvidence(sqlite);
    seedEligiblePacket(sqlite);

    const first = await matchCandidateToReviewChallenge(db, 'candidate-gp');
    const second = await matchCandidateToReviewChallenge(db, 'candidate-gp');

    expect(first.status).toBe(second.status);
    expect(first.prNumber).toBe(second.prNumber);
    expect(first.repoId).toBe(second.repoId);

    expect(first.explanation!.score).toBe(second.explanation!.score);
    expect(first.explanation!.evidence.length).toBe(second.explanation!.evidence.length);
    expect(first.explanation!.unmatchedDemands.length).toBe(second.explanation!.unmatchedDemands.length);

    for (let i = 0; i < first.explanation!.evidence.length; i++) {
      expect(first.explanation!.evidence[i].atomId).toBe(second.explanation!.evidence[i].atomId);
      expect(first.explanation!.evidence[i].demandId).toBe(second.explanation!.evidence[i].demandId);
      expect(first.explanation!.evidence[i].pairScore).toBe(second.explanation!.evidence[i].pairScore);
    }
  });

  it('person graph unifies contact and application evidence', async () => {
    seedCandidateEvidence(sqlite);

    const person = sqlite.prepare(
      `SELECT p.id, p.display_name, p.primary_email
         FROM people p
         JOIN workspace_people wp ON wp.person_id = p.id
         JOIN applications a ON a.workspace_person_id = wp.id
        WHERE a.legacy_candidate_id = 'candidate-gp'`,
    ).get() as { id: string; display_name: string; primary_email: string };

    expect(person).toBeDefined();
    expect(person.display_name).toBe('Golden Path Candidate');
    expect(person.primary_email).toBe('gp@example.com');

    const interactions = sqlite.prepare(
      `SELECT i.interaction_type, i.id
         FROM interactions i
         JOIN workspace_people wp ON wp.id = i.workspace_person_id
         JOIN applications a ON a.workspace_person_id = wp.id
        WHERE a.legacy_candidate_id = 'candidate-gp'
        ORDER BY i.interaction_type`,
    ).all() as Array<{ interaction_type: string; id: string }>;

    expect(interactions.length).toBe(2);
    const types = interactions.map((i) => i.interaction_type);
    expect(types).toContain('meeting');
    expect(types).toContain('resume_upload');

    const assertions = sqlite.prepare(
      `SELECT sa.id, sa.narrative, sa.predicate
         FROM semantic_assertions sa
         JOIN workspace_people wp ON wp.id = sa.workspace_person_id
         JOIN applications a ON a.workspace_person_id = wp.id
        WHERE a.legacy_candidate_id = 'candidate-gp'
        ORDER BY sa.id`,
    ).all() as Array<{ id: string; narrative: string; predicate: string }>;

    expect(assertions.length).toBe(2);
    const predicates = assertions.map((a) => a.predicate);
    expect(predicates).toContain('implemented');
    expect(predicates).toContain('validated');
  });

  it('every assertion links to exact source span with immutable provenance', async () => {
    seedCandidateEvidence(sqlite);

    const linkedAssertions = sqlite.prepare(
      `SELECT sa.narrative, ss.exact_text, ss.byte_start, ss.byte_end,
              ss.char_start, ss.char_end, ss.exact_text_hash,
              av.content_hash
         FROM semantic_assertions sa
         JOIN assertion_source_spans ass ON ass.assertion_id = sa.id
         JOIN source_spans ss ON ss.id = ass.source_span_id
         JOIN artifact_versions av ON av.id = ss.artifact_version_id
         JOIN workspace_people wp ON wp.id = sa.workspace_person_id
         JOIN applications a ON a.workspace_person_id = wp.id
        WHERE a.legacy_candidate_id = 'candidate-gp'
        ORDER BY sa.id`,
    ).all() as Array<{
      narrative: string;
      exact_text: string;
      byte_start: number;
      byte_end: number;
      char_start: number;
      char_end: number;
      exact_text_hash: string;
      content_hash: string;
    }>;

    expect(linkedAssertions.length).toBe(2);
    for (const row of linkedAssertions) {
      expect(row.exact_text.length).toBeGreaterThan(0);
      expect(row.byte_end).toBeGreaterThan(row.byte_start);
      expect(row.exact_text_hash).toBeTruthy();
      expect(row.content_hash).toBeTruthy();
    }
  });

  it('NEEDS_MORE_EVIDENCE when candidate has no signals', async () => {
    seedEligiblePacket(sqlite);

    const result = await matchCandidateToReviewChallenge(db, 'candidate-gp');
    expect(result.status).toBe('NEEDS_MORE_EVIDENCE');
    expect(result.explanation).toBeUndefined();
  });
});
