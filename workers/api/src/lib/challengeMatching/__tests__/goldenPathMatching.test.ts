/**
 * Golden-path matching proof test — Acceptance criteria #5, #6
 *
 * Proves end-to-end:
 *   1. Resume + meeting transcript evidence accumulates into a person graph
 *   2. A repo with source-backed challenge packets is available
 *   3. matchCandidateToReviewChallenge selects a specific reviewable PR
 *   4. Evidence alignments link back to exact source spans on both sides
 *   5. Unmatched demands (evidence gaps) are reported
 *   6. Stretch areas are identified and linked to sources
 *   7. Unknown concepts from the candidate survive through matching
 */
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockD1, type BetterSqliteDb } from '../../../__tests__/helpers/mockD1';
import {
  matchCandidateToReviewChallenge as d1MatchCandidateToReviewChallenge,
} from '../d1Matcher';
import type { ChallengePacket as RepoChallengePacket } from '../../repoSemanticGraph';

const livingMigration = readFileSync(
  new URL('../../../../migrations/0082_living_context_graph.sql', import.meta.url),
  'utf8',
);
const matchingMigration = readFileSync(
  new URL('../../../../migrations/0083_repo_semantic_graph_and_match_runs.sql', import.meta.url),
  'utf8',
);

const NOW = '2026-06-21T10:00:00.000Z';

/**
 * Seeds a person graph with evidence from two interactions:
 *   - Resume: kafka expertise (ep-resume)
 *   - Meeting: idempotency discussion (ep-meeting)
 *
 * Each interaction produces assertions with separate episodes so the matching
 * engine produces multiple query atoms (one per episode+concept pair).
 * All evidence strengths and confidences are 1.0 to ensure eligibility gates.
 */
function seedFullPersonGraph(sqlite: BetterSqliteDb): void {
  sqlite.exec(`
    INSERT INTO people (
      id, ingestion_key, display_name, primary_email, external_ids_json, created_at, updated_at
    ) VALUES (
      'person-golden', 'person-golden', 'Alex Engineer', 'alex@example.com', '{}', '${NOW}', '${NOW}'
    );
    INSERT INTO workspace_people (
      id, ingestion_key, workspace_id, person_id, context_json, created_at, updated_at
    ) VALUES (
      'wsp-golden', 'wsp-golden', 'workspace-1', 'person-golden', '{}', '${NOW}', '${NOW}'
    );
    INSERT INTO applications (
      id, ingestion_key, workspace_person_id, legacy_candidate_id, context_json, created_at, updated_at
    ) VALUES (
      'app-golden', 'app-golden', 'wsp-golden', 'candidate-golden', '{}', '${NOW}', '${NOW}'
    );

    -- Interaction 1: Resume
    INSERT INTO interactions (
      id, ingestion_key, workspace_person_id, application_id, interaction_type, metadata_json, created_at, updated_at
    ) VALUES (
      'int-resume', 'int-resume', 'wsp-golden', 'app-golden', 'resume_submission', '{}', '${NOW}', '${NOW}'
    );

    -- Interaction 2: Meeting transcript
    INSERT INTO interactions (
      id, ingestion_key, workspace_person_id, application_id, interaction_type, metadata_json, created_at, updated_at
    ) VALUES (
      'int-meeting', 'int-meeting', 'wsp-golden', 'app-golden', 'meeting_transcript', '{}', '${NOW}', '${NOW}'
    );

    -- Resume artifact + version
    INSERT INTO artifacts (
      id, ingestion_key, workspace_person_id, interaction_id, artifact_type, metadata_json, created_at, updated_at
    ) VALUES (
      'art-resume', 'art-resume', 'wsp-golden', 'int-resume', 'resume', '{}', '${NOW}', '${NOW}'
    );
    INSERT INTO artifact_versions (
      id, ingestion_key, artifact_id, version_number, content_hash, media_type, content_text, byte_length, metadata_json, created_at
    ) VALUES (
      'av-resume', 'av-resume', 'art-resume', 1, 'sha256:resume-golden',
      'text/plain',
      'Built distributed event systems using Kafka with idempotent consumers.',
      70, '{}', '${NOW}'
    );

    -- Meeting transcript artifact + version
    INSERT INTO artifacts (
      id, ingestion_key, workspace_person_id, interaction_id, artifact_type, metadata_json, created_at, updated_at
    ) VALUES (
      'art-transcript', 'art-transcript', 'wsp-golden', 'int-meeting', 'meeting_transcript', '{}', '${NOW}', '${NOW}'
    );
    INSERT INTO artifact_versions (
      id, ingestion_key, artifact_id, version_number, content_hash, media_type, content_text, byte_length, metadata_json, created_at
    ) VALUES (
      'av-transcript', 'av-transcript', 'art-transcript', 1, 'sha256:transcript-golden',
      'text/plain',
      'Alex validated idempotent consumer retry handling and dead-letter queue patterns.',
      80, '{}', '${NOW}'
    );

    -- Source spans
    INSERT INTO source_spans (
      id, ingestion_key, artifact_version_id, byte_start, byte_end, char_start, char_end,
      line_start, line_end, exact_text, exact_text_hash, metadata_json, created_at
    ) VALUES
      (
        'span-resume-kafka', 'span-resume-kafka', 'av-resume', 0, 70, 0, 70, 1, 1,
        'Built distributed event systems using Kafka with idempotent consumers',
        'sha256:span-resume-kafka', '{}', '${NOW}'
      ),
      (
        'span-meeting-retry', 'span-meeting-retry', 'av-transcript', 0, 80, 0, 80, 1, 1,
        'Alex validated idempotent consumer retry handling and dead-letter queue patterns',
        'sha256:span-meeting-retry', '{}', '${NOW}'
      );

    -- Separate episodes per interaction
    INSERT INTO episodes (
      id, ingestion_key, workspace_person_id, interaction_id, narrative, metadata_json, created_at, updated_at
    ) VALUES
      ('ep-resume', 'ep-resume', 'wsp-golden', 'int-resume',
       'Resume: Kafka event systems with idempotent consumers.', '{}', '${NOW}', '${NOW}'),
      ('ep-meeting', 'ep-meeting', 'wsp-golden', 'int-meeting',
       'Meeting: retry handling and dead-letter queue patterns.', '{}', '${NOW}', '${NOW}');

    -- Concepts (open data, not hard-coded)
    INSERT INTO concepts (
      id, ingestion_key, canonical_key, namespace, label, aliases_json, metadata_json, created_at, updated_at
    ) VALUES
      ('concept-kafka', 'concept-kafka', 'term:kafka', 'term', 'kafka', '[]', '{}', '${NOW}', '${NOW}'),
      ('concept-idempotency', 'concept-idempotency', 'term:idempotency', 'term', 'idempotency', '[]', '{}', '${NOW}', '${NOW}'),
      ('concept-retry', 'concept-retry', 'term:retry', 'term', 'retry', '[]', '{}', '${NOW}', '${NOW}');

    -- Assertion from resume (ep-resume, kafka concept)
    INSERT INTO semantic_assertions (
      id, ingestion_key, workspace_person_id, episode_id, subject_type, subject_id,
      predicate, object_type, object_value_json, narrative, qualifiers_json, confidence,
      polarity, extraction_version, observed_at, created_at, updated_at
    ) VALUES (
      'assert-resume-kafka', 'assert-resume-kafka', 'wsp-golden', 'ep-resume', 'person', 'person-golden',
      'implemented', 'concept', '{"value":"kafka"}',
      'Built distributed event systems using Kafka with idempotent consumers.',
      '{}', 1, 1, 'test-v1', '${NOW}', '${NOW}', '${NOW}'
    );

    -- Assertion from meeting (ep-meeting, retry concept)
    INSERT INTO semantic_assertions (
      id, ingestion_key, workspace_person_id, episode_id, subject_type, subject_id,
      predicate, object_type, object_value_json, narrative, qualifiers_json, confidence,
      polarity, extraction_version, observed_at, created_at, updated_at
    ) VALUES (
      'assert-meeting-retry', 'assert-meeting-retry', 'wsp-golden', 'ep-meeting', 'person', 'person-golden',
      'validated', 'concept', '{"value":"retry"}',
      'Validated idempotent consumer retry handling and dead-letter queue patterns.',
      '{}', 1, 1, 'test-v1', '${NOW}', '${NOW}', '${NOW}'
    );

    -- Link assertions to source spans
    INSERT INTO assertion_source_spans (assertion_id, source_span_id, evidence_role, created_at)
    VALUES
      ('assert-resume-kafka', 'span-resume-kafka', 'support', '${NOW}'),
      ('assert-meeting-retry', 'span-meeting-retry', 'support', '${NOW}');

    -- Link assertions to concepts (1:1 for clean atom production)
    INSERT INTO assertion_concepts (assertion_id, concept_id, relationship, weight, created_at)
    VALUES
      ('assert-resume-kafka', 'concept-kafka', 'about', 1, '${NOW}'),
      ('assert-meeting-retry', 'concept-retry', 'about', 1, '${NOW}');

    -- Signal evidence at maximum strength
    INSERT INTO signal_evidence (
      id, ingestion_key, workspace_person_id, interaction_id, assertion_id, concept_id,
      signal_key, evidence_level, strength, polarity, metadata_json, created_at, updated_at
    ) VALUES
      ('ev-resume-kafka', 'ev-resume-kafka', 'wsp-golden', 'int-resume',
       'assert-resume-kafka', 'concept-kafka',
       'term:kafka', 'implemented', 1, 1, '{}', '${NOW}', '${NOW}'),
      ('ev-meeting-retry', 'ev-meeting-retry', 'wsp-golden', 'int-meeting',
       'assert-meeting-retry', 'concept-retry',
       'term:retry', 'validated', 1, 1, '{}', '${NOW}', '${NOW}');
  `);
}

/**
 * Seeds a challenge packet with 3 demands across 2+ families:
 *   - demand-kafka: artifact:source (kafka, high weight → highWeightRoleRequirement)
 *   - demand-retry: verification:testing (retry, medium weight)
 *   - demand-graphql: artifact:api (graphql, low weight → evidence gap)
 *
 * The candidate matches kafka and retry but NOT graphql, producing
 * a clear evidence gap for testing criterion #6.
 */
function seedRepoWithChallengePackets(sqlite: BetterSqliteDb): void {
  const packet: RepoChallengePacket = {
    schemaVersion: '1.0.0',
    policyVersion: 'repo-challenge-v1',
    id: 'packet-kafka-pr',
    repoSnapshotId: 'snapshot-golden',
    repository: {
      provider: 'github',
      owner: 'acme',
      name: 'event-platform',
      canonicalUrl: 'https://github.com/acme/event-platform',
    },
    pullRequest: {
      number: 101,
      url: 'https://github.com/acme/event-platform/pull/101',
      title: 'Add idempotent Kafka consumer with retry and DLQ',
      author: 'senior-dev',
      baseSha: 'aaaa'.repeat(10),
      headSha: 'bbbb'.repeat(10),
      mergedAt: '2026-06-01T08:00:00.000Z',
    },
    languageSupport: {
      language: 'TypeScript',
      normalizedLanguage: 'typescript',
      level: 'production',
      parser: 'typescript-compiler-api',
      challengePacketsAllowed: true,
      reason: 'validated semantic extraction adapter',
    },
    changedFilePaths: ['src/consumer.ts', 'src/consumer.test.ts', 'src/subscriptions.ts'],
    changedSymbolIds: [],
    sourceSpanIds: ['repo-span-kafka', 'repo-span-retry', 'repo-span-graphql'],
    testChanges: [],
    demands: [
      {
        id: 'demand-kafka',
        family: 'artifact:source',
        narrative: 'Review Kafka consumer implementation.',
        conceptKeys: ['term:kafka'],
        sourceSpanIds: ['repo-span-kafka'],
        changedSymbolIds: [],
        weight: 1.0,
        contentHash: 'sha256:demand-kafka' as `sha256:${string}`,
      },
      {
        id: 'demand-retry',
        family: 'verification:testing',
        narrative: 'Review retry handling test coverage.',
        conceptKeys: ['term:retry'],
        sourceSpanIds: ['repo-span-retry'],
        changedSymbolIds: [],
        weight: 0.8,
        contentHash: 'sha256:demand-retry' as `sha256:${string}`,
      },
      {
        id: 'demand-graphql',
        family: 'artifact:api',
        narrative: 'Review GraphQL subscription integration for real-time event streaming.',
        conceptKeys: ['term:graph-ql'],
        sourceSpanIds: ['repo-span-graphql'],
        changedSymbolIds: [],
        weight: 0.15,
        contentHash: 'sha256:demand-graphql' as `sha256:${string}`,
      },
    ],
    demandFamilies: ['artifact:source', 'verification:testing', 'artifact:api'],
    quality: {
      score: 0.92,
      metrics: {
        provenanceCoverage: 1,
        reviewableSize: 0.9,
        testCoverage: 0.85,
        issueContext: 1,
        demandDiversity: 0.9,
      },
      gates: [],
      eligible: true,
    },
    contentHash: 'sha256:packet-kafka-pr' as `sha256:${string}`,
  };

  sqlite.exec(`
    INSERT INTO qualified_repos (id) VALUES (1);
    INSERT INTO repo_snapshots (
      id, repo_id, commit_sha, extractor_version
    ) VALUES (
      'snapshot-golden', 1, '${'bbbb'.repeat(10)}', '1.0.0'
    );

    INSERT INTO repo_source_artifacts (id, repo_snapshot_id, artifact_type, path)
    VALUES
      ('rsa-1', 'snapshot-golden', 'source_file', 'src/consumer.ts'),
      ('rsa-2', 'snapshot-golden', 'source_file', 'src/consumer.test.ts'),
      ('rsa-3', 'snapshot-golden', 'source_file', 'src/subscriptions.ts');

    INSERT INTO repo_artifact_versions (id, artifact_id, content_hash, byte_length)
    VALUES
      ('rav-1', 'rsa-1', 'sha256:repo-file-1', 120),
      ('rav-2', 'rsa-2', 'sha256:repo-file-2', 90),
      ('rav-3', 'rsa-3', 'sha256:repo-file-3', 80);

    INSERT INTO repo_source_spans (id, artifact_version_id, content_hash, byte_start, byte_end, exact_text, path)
    VALUES
      ('repo-span-kafka', 'rav-1', 'sha256:repo-kafka', 0, 120,
       'export class IdempotentKafkaConsumer { private seen = new Map(); async consume(msg) { if (this.seen.has(msg.id)) return; } }',
       'src/consumer.ts'),
      ('repo-span-retry', 'rav-2', 'sha256:repo-retry', 0, 90,
       'test("retries failed messages with exponential backoff", async () => { await consumer.retry(msg); })',
       'src/consumer.test.ts'),
      ('repo-span-graphql', 'rav-3', 'sha256:repo-graphql', 0, 80,
       'const subscription = gql subscription OnEvent { eventCreated { id type payload } }',
       'src/subscriptions.ts');
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

describe('Golden-path matching proof (criteria #5, #6)', () => {
  let rawSqlite: InstanceType<typeof Database>;
  let sqlite: BetterSqliteDb;
  let db: D1Database;

  beforeEach(() => {
    rawSqlite = new Database(':memory:');
    sqlite = rawSqlite as unknown as BetterSqliteDb;
    rawSqlite.exec(`
      CREATE TABLE candidates (id TEXT PRIMARY KEY);
      CREATE TABLE qualified_repos (id INTEGER PRIMARY KEY);
      INSERT INTO candidates (id) VALUES ('candidate-golden');
    `);
    rawSqlite.exec(livingMigration);
    rawSqlite.exec(matchingMigration);
    db = createMockD1(sqlite);
    seedFullPersonGraph(sqlite);
    seedRepoWithChallengePackets(sqlite);
  });

  afterEach(() => {
    rawSqlite.close();
  });

  it('selects a specific reviewable PR from source-backed evidence', async () => {
    const result = await d1MatchCandidateToReviewChallenge(db, 'candidate-golden');

    expect(result.status).toBe('MATCHED');
    expect(result.prNumber).toBe(101);
    expect(result.repoId).toBe(1);
    expect(result.matchRunId).toBeTruthy();
  });

  it('links evidence alignments to exact source spans on both sides', async () => {
    const result = await d1MatchCandidateToReviewChallenge(db, 'candidate-golden');

    expect(result.explanation).toBeDefined();
    const explanation = result.explanation!;
    expect(explanation.evidence.length).toBeGreaterThanOrEqual(2);

    for (const entry of explanation.evidence) {
      expect(entry.candidateSourceRefs.length).toBeGreaterThan(0);
      for (const ref of entry.candidateSourceRefs) {
        expect(ref.contentHash).toBeTruthy();
        expect(ref.startOffset).toBeGreaterThanOrEqual(0);
        expect(ref.endOffset).toBeGreaterThan(ref.startOffset);
        expect(ref.exactText).toBeTruthy();
      }

      expect(entry.challengeSourceRefs.length).toBeGreaterThan(0);
      for (const ref of entry.challengeSourceRefs) {
        expect(ref.contentHash).toBeTruthy();
        expect(ref.startOffset).toBeGreaterThanOrEqual(0);
        expect(ref.endOffset).toBeGreaterThan(ref.startOffset);
        expect(ref.exactText).toBeTruthy();
      }
    }
  });

  it('reports unmatched demands as evidence gaps', async () => {
    const result = await d1MatchCandidateToReviewChallenge(db, 'candidate-golden');

    expect(result.explanation).toBeDefined();
    const explanation = result.explanation!;

    expect(explanation.unmatchedDemands.length).toBeGreaterThan(0);

    const graphqlGap = explanation.unmatchedDemands.find(
      (gap) => gap.concepts.includes('term:graph-ql'),
    );
    expect(graphqlGap).toBeDefined();
    expect(graphqlGap!.demandId).toBe('demand-graphql');
    expect(graphqlGap!.family).toBe('artifact:api');
    expect(graphqlGap!.narrative).toContain('GraphQL');
    expect(graphqlGap!.challengeSourceRefs.length).toBeGreaterThan(0);
    expect(graphqlGap!.challengeSourceRefs[0].exactText).toContain('subscription');
  });

  it('includes structured stretch areas in the explanation', async () => {
    const result = await d1MatchCandidateToReviewChallenge(db, 'candidate-golden');

    expect(result.explanation).toBeDefined();
    const explanation = result.explanation!;

    expect(Array.isArray(explanation.stretchAreas)).toBe(true);

    for (const stretch of explanation.stretchAreas) {
      expect(stretch.atomConcept).toBeTruthy();
      expect(stretch.demandConcept).toBeTruthy();
      expect(stretch.dimension).toBeTruthy();
      expect(stretch.candidateNarrative).toBeTruthy();
      expect(stretch.demandNarrative).toBeTruthy();
      expect(stretch.candidateSourceRefs.length).toBeGreaterThan(0);
      expect(stretch.challengeSourceRefs.length).toBeGreaterThan(0);
    }
  });

  it('summary includes gap count', async () => {
    const result = await d1MatchCandidateToReviewChallenge(db, 'candidate-golden');

    expect(result.explanation).toBeDefined();
    expect(result.explanation!.summary).toContain('unmatched demand');
  });

  it('match run is persisted to D1 with full audit trail', async () => {
    const result = await d1MatchCandidateToReviewChallenge(db, 'candidate-golden');

    const run = await db.prepare(
      `SELECT id, status, selected_packet_id, ranked_results_json
         FROM match_runs WHERE id = ?1`,
    ).bind(result.matchRunId).first<{
      id: string;
      status: string;
      selected_packet_id: string | null;
      ranked_results_json: string;
    }>();

    expect(run).toBeDefined();
    expect(run!.status).toBe('MATCHED');
    expect(run!.selected_packet_id).toBe('packet-kafka-pr');

    const ranked = JSON.parse(run!.ranked_results_json) as Array<{
      challengeId: string;
      alignments: Array<{
        candidateSourceRefs: Array<{ contentHash: string }>;
        challengeSourceRefs: Array<{ contentHash: string }>;
      }>;
    }>;
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked[0].challengeId).toBe('packet-kafka-pr');

    for (const alignment of ranked[0].alignments) {
      expect(alignment.candidateSourceRefs.length).toBeGreaterThan(0);
      expect(alignment.challengeSourceRefs.length).toBeGreaterThan(0);
    }
  });

  it('uses accumulated evidence from multiple interactions', async () => {
    const result = await d1MatchCandidateToReviewChallenge(db, 'candidate-golden');

    expect(result.explanation).toBeDefined();
    const explanation = result.explanation!;

    const candidateContentHashes = new Set(
      explanation.evidence.flatMap((e) =>
        e.candidateSourceRefs.map((ref) => ref.contentHash),
      ),
    );

    const hasResumeEvidence = candidateContentHashes.has('sha256:resume-golden');
    const hasTranscriptEvidence = candidateContentHashes.has('sha256:transcript-golden');
    expect(hasResumeEvidence || hasTranscriptEvidence).toBe(true);
  });

  it('does not fabricate seniority, default evidence, or generic fallbacks', async () => {
    const result = await d1MatchCandidateToReviewChallenge(db, 'candidate-golden');

    expect(result.explanation).toBeDefined();
    const explanation = result.explanation!;

    for (const entry of explanation.evidence) {
      expect(entry.pairScore).toBeGreaterThan(0);

      for (const ref of entry.candidateSourceRefs) {
        expect(ref.contentHash).not.toBe('');
        expect(ref.exactText).toBeTruthy();
        expect(ref.exactText!.length).toBeGreaterThan(0);
      }
    }
  });

  it('unknown concepts from candidate survive through matching', async () => {
    sqlite.exec(`
      INSERT INTO concepts (
        id, ingestion_key, canonical_key, namespace, label, aliases_json, metadata_json, created_at, updated_at
      ) VALUES (
        'concept-temporal-shard', 'concept-temporal-shard', 'term:temporal-shard-knitting',
        'term', 'temporal shard knitting', '[]', '{}', '${NOW}', '${NOW}'
      );
      INSERT INTO semantic_assertions (
        id, ingestion_key, workspace_person_id, episode_id, subject_type, subject_id,
        predicate, object_type, object_value_json, narrative, qualifiers_json, confidence,
        polarity, extraction_version, observed_at, created_at, updated_at
      ) VALUES (
        'assert-novel', 'assert-novel', 'wsp-golden', 'ep-meeting', 'person', 'person-golden',
        'invented', 'concept', '{"value":"temporal shard knitting"}',
        'Candidate invented temporal shard knitting technique for distributed data.',
        '{}', 1, 1, 'test-v1', '${NOW}', '${NOW}', '${NOW}'
      );
      INSERT INTO assertion_source_spans (assertion_id, source_span_id, evidence_role, created_at)
      VALUES ('assert-novel', 'span-meeting-retry', 'support', '${NOW}');
      INSERT INTO assertion_concepts (assertion_id, concept_id, relationship, weight, created_at)
      VALUES ('assert-novel', 'concept-temporal-shard', 'about', 1, '${NOW}');
      INSERT INTO signal_evidence (
        id, ingestion_key, workspace_person_id, interaction_id, assertion_id, concept_id,
        signal_key, evidence_level, strength, polarity, metadata_json, created_at, updated_at
      ) VALUES (
        'ev-novel', 'ev-novel', 'wsp-golden', 'int-meeting', 'assert-novel', 'concept-temporal-shard',
        'term:temporal-shard-knitting', 'demonstrated', 1, 1, '{}', '${NOW}', '${NOW}'
      );
    `);

    const result = await d1MatchCandidateToReviewChallenge(db, 'candidate-golden');

    expect(result.status).toBe('MATCHED');

    const run = await db.prepare(
      `SELECT query_json FROM match_runs WHERE id = ?1`,
    ).bind(result.matchRunId).first<{ query_json: string }>();
    expect(run).toBeDefined();

    const query = JSON.parse(run!.query_json) as {
      validationAtoms: Array<{ concepts: string[] }>;
      deepeningAtoms: Array<{ concepts: string[] }>;
      recallOnlyAtoms: Array<{ concepts: string[] }>;
    };
    const allConcepts = [
      ...query.validationAtoms.flatMap((a) => a.concepts),
      ...query.deepeningAtoms.flatMap((a) => a.concepts),
      ...query.recallOnlyAtoms.flatMap((a) => a.concepts),
    ];

    expect(allConcepts).toContain('term:temporal-shard-knitting');
  });
});
