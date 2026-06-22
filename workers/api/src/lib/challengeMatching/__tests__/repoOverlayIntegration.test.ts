/**
 * Repo Overlay Integration — Criterion #7 data path proof.
 *
 * Proves that repo source spans flow through the challenge matcher
 * into MatchExplanation.evidence[].challengeSourceRefs with proper
 * file-path locators. The frontend RepoOverlayPanel splits locator
 * by ':' to group spans by file — this test verifies that contract.
 */
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockD1, type BetterSqliteDb } from '../../../__tests__/helpers/mockD1';
import { matchCandidateToReviewChallenge } from '../d1Matcher';
import type { ChallengePacket as RepoChallengePacket } from '../../repoSemanticGraph';

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

function seedMultiFileRepo(sqlite: BetterSqliteDb): void {
  const packet: RepoChallengePacket = {
    schemaVersion: '1.0.0',
    policyVersion: 'repo-challenge-v1',
    id: 'packet-overlay-test',
    repoSnapshotId: 'snapshot-overlay',
    repository: {
      provider: 'github',
      owner: 'acme',
      name: 'event-bus',
      canonicalUrl: 'https://github.com/acme/event-bus',
    },
    pullRequest: {
      number: 101,
      url: 'https://github.com/acme/event-bus/pull/101',
      title: 'Add distributed event sourcing with CQRS pattern',
      author: 'senior-eng',
      baseSha: 'aaaa'.repeat(10),
      headSha: 'bbbb'.repeat(10),
      mergedAt: '2026-06-15T10:00:00.000Z',
    },
    languageSupport: {
      language: 'TypeScript',
      normalizedLanguage: 'typescript',
      level: 'production',
      parser: 'typescript-compiler-api',
      challengePacketsAllowed: true,
      reason: 'typescript validated',
    },
    changedFilePaths: [
      'src/events/handler.ts',
      'src/cqrs/projector.ts',
      'src/persistence/eventStore.ts',
    ],
    changedSymbolIds: [],
    sourceSpanIds: ['span-handler', 'span-projector', 'span-store'],
    testChanges: [],
    demands: [
      {
        id: 'demand-event-handler',
        family: 'artifact:source',
        narrative: 'Review the event sourcing handler dispatch logic.',
        conceptKeys: ['term:event-sourcing', 'term:distributed-systems'],
        mechanisms: [],
        sourceSpanIds: ['span-handler'],
        changedSymbolIds: [],
        weight: 0.4,
        contentHash: 'sha256:demand-handler',
      },
      {
        id: 'demand-cqrs-projector',
        family: 'artifact:source',
        narrative: 'Review CQRS projection rebuild correctness.',
        conceptKeys: ['term:cqrs', 'term:event-sourcing'],
        mechanisms: [],
        sourceSpanIds: ['span-projector'],
        changedSymbolIds: [],
        weight: 0.35,
        contentHash: 'sha256:demand-projector',
      },
      {
        id: 'demand-event-store',
        family: 'verification:persistence',
        narrative: 'Review idempotent event store append-only semantics.',
        conceptKeys: ['term:event-sourcing', 'term:idempotency'],
        mechanisms: [],
        sourceSpanIds: ['span-store'],
        changedSymbolIds: [],
        weight: 0.25,
        contentHash: 'sha256:demand-store',
      },
    ],
    demandFamilies: ['artifact:source', 'verification:persistence'],
    quality: {
      score: 0.88,
      metrics: {
        provenanceCoverage: 1,
        reviewableSize: 0.85,
        testCoverage: 0.8,
        issueContext: 0.9,
        demandDiversity: 1,
      },
      gates: [],
      eligible: true,
    },
    contentHash: 'sha256:packet-overlay-test',
  };

  sqlite.exec(`
    INSERT INTO qualified_repos (id) VALUES (1);
    INSERT INTO repo_snapshots (id, repo_id, commit_sha, extractor_version)
    VALUES ('snapshot-overlay', 1, '${'bbbb'.repeat(10)}', '1.0.0');
    INSERT INTO repo_source_artifacts (id, repo_snapshot_id, artifact_type, path, external_reference)
    VALUES
      ('art-handler', 'snapshot-overlay', 'source', 'src/events/handler.ts', NULL),
      ('art-projector', 'snapshot-overlay', 'source', 'src/cqrs/projector.ts', NULL),
      ('art-store', 'snapshot-overlay', 'source', 'src/persistence/eventStore.ts', NULL);
    INSERT INTO repo_artifact_versions (id, artifact_id, content_hash, inline_content, byte_length, media_type)
    VALUES
      ('ver-handler', 'art-handler', 'sha256:handler-v1',
       'export class EventHandler { dispatch(event: DomainEvent) { /* pattern match on event type, route to aggregate */ } }', 118, 'text/plain'),
      ('ver-projector', 'art-projector', 'sha256:projector-v1',
       'export class CQRSProjector { rebuild(stream: EventStream) { /* replay all events into read model */ } }', 102, 'text/plain'),
      ('ver-store', 'art-store', 'sha256:store-v1',
       'export class EventStore { append(streamId: string, events: DomainEvent[]) { /* append-only, idempotent by eventId */ } }', 122, 'text/plain');
    INSERT INTO repo_source_spans (id, artifact_version_id, content_hash, path, byte_start, byte_end, line_start, line_end, pr_side, base_sha, head_sha, exact_text)
    VALUES
      ('span-handler', 'ver-handler', 'sha256:handler-v1', 'src/events/handler.ts', 0, 118, 1, 1, 'head',
       '${'aaaa'.repeat(10)}', '${'bbbb'.repeat(10)}',
       'export class EventHandler { dispatch(event: DomainEvent) { /* pattern match on event type, route to aggregate */ } }'),
      ('span-projector', 'ver-projector', 'sha256:projector-v1', 'src/cqrs/projector.ts', 0, 102, 1, 1, 'head',
       '${'aaaa'.repeat(10)}', '${'bbbb'.repeat(10)}',
       'export class CQRSProjector { rebuild(stream: EventStream) { /* replay all events into read model */ } }'),
      ('span-store', 'ver-store', 'sha256:store-v1', 'src/persistence/eventStore.ts', 0, 122, 1, 1, 'head',
       '${'aaaa'.repeat(10)}', '${'bbbb'.repeat(10)}',
       'export class EventStore { append(streamId: string, events: DomainEvent[]) { /* append-only, idempotent by eventId */ } }');
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

function seedCandidateWithOverlappingEvidence(sqlite: BetterSqliteDb): void {
  const now = '2026-06-15T12:00:00.000Z';
  // Each assertion maps 1:1 to a challenge demand (same concept keys), mirroring
  // real-world scenarios where a candidate's evidence directly covers a challenge area.
  sqlite.exec(`
    INSERT INTO people (
      id, ingestion_key, display_name, primary_email, external_ids_json, created_at, updated_at
    ) VALUES (
      'person-overlay', 'person-overlay', 'Overlay Test Candidate', 'overlay@test.dev', '{}', '${now}', '${now}'
    );
    INSERT INTO workspace_people (
      id, ingestion_key, workspace_id, person_id, context_json, created_at, updated_at
    ) VALUES (
      'wsp-overlay', 'wsp-overlay', 'workspace-1', 'person-overlay', '{}', '${now}', '${now}'
    );
    INSERT INTO applications (
      id, ingestion_key, workspace_person_id, legacy_candidate_id, context_json, created_at, updated_at
    ) VALUES (
      'app-overlay', 'app-overlay', 'wsp-overlay', 'candidate-overlay', '{}', '${now}', '${now}'
    );
    INSERT INTO interactions (
      id, ingestion_key, workspace_person_id, application_id, interaction_type, metadata_json, created_at, updated_at
    ) VALUES
      ('ix-overlay-interview', 'ix-overlay-interview', 'wsp-overlay', 'app-overlay', 'interview', '{}', '${now}', '${now}'),
      ('ix-overlay-resume', 'ix-overlay-resume', 'wsp-overlay', 'app-overlay', 'resume_upload', '{}', '${now}', '${now}'),
      ('ix-overlay-assessment', 'ix-overlay-assessment', 'wsp-overlay', 'app-overlay', 'assessment', '{}', '${now}', '${now}');

    INSERT INTO artifacts (
      id, ingestion_key, workspace_person_id, interaction_id, artifact_type, metadata_json, created_at, updated_at
    ) VALUES
      ('art-overlay-transcript', 'art-overlay-transcript', 'wsp-overlay', 'ix-overlay-interview', 'interview_transcript', '{}', '${now}', '${now}'),
      ('art-overlay-resume', 'art-overlay-resume', 'wsp-overlay', 'ix-overlay-resume', 'resume', '{}', '${now}', '${now}'),
      ('art-overlay-assessment', 'art-overlay-assessment', 'wsp-overlay', 'ix-overlay-assessment', 'assessment_response', '{}', '${now}', '${now}');

    INSERT INTO artifact_versions (
      id, ingestion_key, artifact_id, version_number, content_hash, media_type, content_text, byte_length, metadata_json, created_at
    ) VALUES
      ('av-overlay-transcript', 'av-overlay-transcript', 'art-overlay-transcript', 1, 'sha256:overlay-transcript',
       'text/plain', 'I built event-sourced systems for distributed platforms.', 58, '{}', '${now}'),
      ('av-overlay-resume', 'av-overlay-resume', 'art-overlay-resume', 1, 'sha256:overlay-resume',
       'text/plain', 'Built CQRS projections for event-sourced microservices.', 56, '{}', '${now}'),
      ('av-overlay-assessment', 'av-overlay-assessment', 'art-overlay-assessment', 1, 'sha256:overlay-assessment',
       'text/plain', 'Implemented idempotent event store consumers with exactly-once semantics.', 72, '{}', '${now}');

    INSERT INTO source_spans (
      id, ingestion_key, artifact_version_id, byte_start, byte_end, char_start, char_end,
      line_start, line_end, exact_text, exact_text_hash, metadata_json, created_at
    ) VALUES
      ('span-overlay-handler', 'span-overlay-handler', 'av-overlay-transcript', 0, 58, 0, 58, 1, 1,
       'I built event-sourced systems for distributed platforms', 'sha256:span-handler-ov', '{}', '${now}'),
      ('span-overlay-cqrs', 'span-overlay-cqrs', 'av-overlay-resume', 0, 56, 0, 56, 1, 1,
       'Built CQRS projections for event-sourced microservices', 'sha256:span-cqrs-ov', '{}', '${now}'),
      ('span-overlay-store', 'span-overlay-store', 'av-overlay-assessment', 0, 72, 0, 72, 1, 1,
       'Implemented idempotent event store consumers with exactly-once semantics', 'sha256:span-store-ov', '{}', '${now}');

    INSERT INTO episodes (
      id, ingestion_key, workspace_person_id, interaction_id, narrative, metadata_json, created_at, updated_at
    ) VALUES
      ('ep-overlay-interview', 'ep-overlay-interview', 'wsp-overlay', 'ix-overlay-interview',
       'Candidate described event sourcing and distributed systems experience.', '{}', '${now}', '${now}'),
      ('ep-overlay-resume', 'ep-overlay-resume', 'wsp-overlay', 'ix-overlay-resume',
       'Resume shows CQRS experience.', '{}', '${now}', '${now}'),
      ('ep-overlay-assessment', 'ep-overlay-assessment', 'wsp-overlay', 'ix-overlay-assessment',
       'Assessment confirms idempotent event store implementation.', '{}', '${now}', '${now}');

    INSERT INTO concepts (
      id, ingestion_key, canonical_key, namespace, label, aliases_json, metadata_json, created_at, updated_at
    ) VALUES
      ('c-event-sourcing', 'c-event-sourcing', 'term:event-sourcing', 'term', 'event sourcing', '[]', '{}', '${now}', '${now}'),
      ('c-cqrs', 'c-cqrs', 'term:cqrs', 'term', 'CQRS', '[]', '{}', '${now}', '${now}'),
      ('c-distributed', 'c-distributed', 'term:distributed-systems', 'term', 'distributed systems', '[]', '{}', '${now}', '${now}'),
      ('c-idempotency-ov', 'c-idempotency-ov', 'term:idempotency', 'term', 'idempotency', '[]', '{}', '${now}', '${now}');

    -- Assertion 1: covers demand-event-handler concepts (event-sourcing + distributed-systems)
    INSERT INTO semantic_assertions (
      id, ingestion_key, workspace_person_id, episode_id, subject_type, subject_id,
      predicate, object_type, object_value_json, narrative, qualifiers_json, confidence,
      polarity, extraction_version, observed_at, created_at, updated_at
    ) VALUES
      ('sa-overlay-handler', 'sa-overlay-handler', 'wsp-overlay', 'ep-overlay-interview', 'person', 'person-overlay',
       'demonstrated', 'concept', '{"value":"event-sourcing"}',
       'Built event-sourced systems for distributed platforms.', '{}', 1, 1, 'test', '${now}', '${now}', '${now}');

    -- Assertion 2: covers demand-cqrs-projector concepts (cqrs + event-sourcing)
    INSERT INTO semantic_assertions (
      id, ingestion_key, workspace_person_id, episode_id, subject_type, subject_id,
      predicate, object_type, object_value_json, narrative, qualifiers_json, confidence,
      polarity, extraction_version, observed_at, created_at, updated_at
    ) VALUES
      ('sa-overlay-cqrs', 'sa-overlay-cqrs', 'wsp-overlay', 'ep-overlay-resume', 'person', 'person-overlay',
       'demonstrated', 'concept', '{"value":"cqrs"}',
       'Built CQRS projections for event-sourced microservices.', '{}', 1, 1, 'test', '${now}', '${now}', '${now}');

    -- Assertion 3: covers demand-event-store concepts (event-sourcing + idempotency)
    INSERT INTO semantic_assertions (
      id, ingestion_key, workspace_person_id, episode_id, subject_type, subject_id,
      predicate, object_type, object_value_json, narrative, qualifiers_json, confidence,
      polarity, extraction_version, observed_at, created_at, updated_at
    ) VALUES
      ('sa-overlay-store', 'sa-overlay-store', 'wsp-overlay', 'ep-overlay-assessment', 'person', 'person-overlay',
       'implemented', 'concept', '{"value":"idempotency"}',
       'Implemented idempotent event store consumers with exactly-once semantics.', '{}', 1, 1, 'test', '${now}', '${now}', '${now}');

    INSERT INTO assertion_source_spans (assertion_id, source_span_id, evidence_role, created_at)
    VALUES
      ('sa-overlay-handler', 'span-overlay-handler', 'support', '${now}'),
      ('sa-overlay-cqrs', 'span-overlay-cqrs', 'support', '${now}'),
      ('sa-overlay-store', 'span-overlay-store', 'support', '${now}');

    -- Each assertion has exactly the same concept pair as the demand it targets
    INSERT INTO assertion_concepts (assertion_id, concept_id, relationship, weight, created_at)
    VALUES
      ('sa-overlay-handler', 'c-event-sourcing', 'about', 1, '${now}'),
      ('sa-overlay-handler', 'c-distributed', 'about', 1, '${now}'),
      ('sa-overlay-cqrs', 'c-cqrs', 'about', 1, '${now}'),
      ('sa-overlay-cqrs', 'c-event-sourcing', 'about', 1, '${now}'),
      ('sa-overlay-store', 'c-event-sourcing', 'about', 1, '${now}'),
      ('sa-overlay-store', 'c-idempotency-ov', 'about', 1, '${now}');

    INSERT INTO signal_evidence (
      id, ingestion_key, workspace_person_id, interaction_id, assertion_id, concept_id,
      signal_key, evidence_level, strength, polarity, metadata_json, created_at, updated_at
    ) VALUES
      ('ev-ov-handler-es', 'ev-ov-handler-es', 'wsp-overlay', 'ix-overlay-interview', 'sa-overlay-handler', 'c-event-sourcing',
       'term:event-sourcing', 'demonstrated', 1, 1, '{}', '${now}', '${now}'),
      ('ev-ov-handler-dist', 'ev-ov-handler-dist', 'wsp-overlay', 'ix-overlay-interview', 'sa-overlay-handler', 'c-distributed',
       'term:distributed-systems', 'demonstrated', 1, 1, '{}', '${now}', '${now}'),
      ('ev-ov-cqrs-cqrs', 'ev-ov-cqrs-cqrs', 'wsp-overlay', 'ix-overlay-resume', 'sa-overlay-cqrs', 'c-cqrs',
       'term:cqrs', 'demonstrated', 1, 1, '{}', '${now}', '${now}'),
      ('ev-ov-cqrs-es', 'ev-ov-cqrs-es', 'wsp-overlay', 'ix-overlay-resume', 'sa-overlay-cqrs', 'c-event-sourcing',
       'term:event-sourcing', 'demonstrated', 1, 1, '{}', '${now}', '${now}'),
      ('ev-ov-store-es', 'ev-ov-store-es', 'wsp-overlay', 'ix-overlay-assessment', 'sa-overlay-store', 'c-event-sourcing',
       'term:event-sourcing', 'implemented', 1, 1, '{}', '${now}', '${now}'),
      ('ev-ov-store-idemp', 'ev-ov-store-idemp', 'wsp-overlay', 'ix-overlay-assessment', 'sa-overlay-store', 'c-idempotency-ov',
       'term:idempotency', 'implemented', 1, 1, '{}', '${now}', '${now}');
  `);
}

describe('repo overlay integration — criterion #7 data path', () => {
  let sqlite: BetterSqliteDb;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE candidates (id TEXT PRIMARY KEY);
      CREATE TABLE qualified_repos (id INTEGER PRIMARY KEY);
      INSERT INTO candidates (id) VALUES ('candidate-overlay');
    `);
    sqlite.exec(livingMigration);
    sqlite.exec(matchingMigration);
    sqlite.exec(transcriptProjectionMigration);
    sqlite.exec(conceptRegistryMigration);
    db = createMockD1(sqlite);
    seedMultiFileRepo(sqlite);
    seedCandidateWithOverlappingEvidence(sqlite);
  });

  afterEach(() => {
    sqlite.close();
  });

  it('challengeSourceRefs carry file-path locators for RepoOverlayPanel', async () => {
    const result = await matchCandidateToReviewChallenge(db, 'candidate-overlay');

    expect(result.status).toBe('MATCHED');
    expect(result.explanation).toBeDefined();

    const explanation = result.explanation!;
    const allChallengeRefs = explanation.evidence.flatMap((e) => e.challengeSourceRefs);

    expect(allChallengeRefs.length).toBeGreaterThan(0);
    for (const ref of allChallengeRefs) {
      expect(ref.locator).toBeDefined();
      expect(ref.locator).toContain(':');
      const filePath = ref.locator!.split(':')[0];
      expect(filePath).toMatch(/^src\//);
    }
  });

  it('locators group into distinct file paths matching repo structure', async () => {
    const result = await matchCandidateToReviewChallenge(db, 'candidate-overlay');
    const explanation = result.explanation!;

    const filePaths = new Set(
      explanation.evidence
        .flatMap((e) => e.challengeSourceRefs)
        .map((ref) => ref.locator!.split(':')[0]),
    );

    expect(filePaths.size).toBeGreaterThanOrEqual(1);
    const knownPaths = [
      'src/events/handler.ts',
      'src/cqrs/projector.ts',
      'src/persistence/eventStore.ts',
    ];
    for (const path of filePaths) {
      expect(knownPaths).toContain(path);
    }
  });

  it('challengeSourceRefs carry exact text for inline display', async () => {
    const result = await matchCandidateToReviewChallenge(db, 'candidate-overlay');
    const explanation = result.explanation!;

    const allChallengeRefs = explanation.evidence.flatMap((e) => e.challengeSourceRefs);
    for (const ref of allChallengeRefs) {
      expect(ref.exactText).toBeDefined();
      expect(ref.exactText!.length).toBeGreaterThan(0);
      expect(ref.contentHash).toBeDefined();
      expect(ref.startOffset).toBeGreaterThanOrEqual(0);
      expect(ref.endOffset).toBeGreaterThan(ref.startOffset);
    }
  });

  it('candidateSourceRefs carry provenance back to interview transcript', async () => {
    const result = await matchCandidateToReviewChallenge(db, 'candidate-overlay');
    const explanation = result.explanation!;

    const allCandidateRefs = explanation.evidence.flatMap((e) => e.candidateSourceRefs);
    expect(allCandidateRefs.length).toBeGreaterThan(0);

    for (const ref of allCandidateRefs) {
      expect(ref.exactText).toBeDefined();
      expect(ref.exactText!.length).toBeGreaterThan(0);
      expect(ref.artifactId).toBeDefined();
      expect(ref.contentHash).toBeDefined();
    }
  });

  it('unmatchedDemands reference file paths via challengeSourceRefs', async () => {
    const result = await matchCandidateToReviewChallenge(db, 'candidate-overlay');
    const explanation = result.explanation!;

    if (explanation.unmatchedDemands.length > 0) {
      for (const demand of explanation.unmatchedDemands) {
        expect(demand.challengeSourceRefs.length).toBeGreaterThan(0);
        for (const ref of demand.challengeSourceRefs) {
          expect(ref.locator).toBeDefined();
          const filePath = ref.locator!.split(':')[0];
          expect(filePath).toMatch(/^src\//);
        }
      }
    }
  });

  it('match run persists ranked_results_json with overlay-compatible structure', async () => {
    await matchCandidateToReviewChallenge(db, 'candidate-overlay');

    const matchRun = sqlite.prepare(
      `SELECT ranked_results_json FROM match_runs WHERE candidate_id = ?`,
    ).get('candidate-overlay') as { ranked_results_json: string } | undefined;

    expect(matchRun).toBeDefined();
    const results = JSON.parse(matchRun!.ranked_results_json) as Array<{
      alignments?: Array<{
        challengeSourceRefs?: Array<{ locator?: string; exactText?: string }>;
      }>;
    }>;

    expect(results.length).toBeGreaterThan(0);
    const topResult = results[0];
    expect(topResult.alignments).toBeDefined();

    const locators = topResult.alignments!
      .flatMap((a) => a.challengeSourceRefs ?? [])
      .map((ref) => ref.locator)
      .filter(Boolean);

    expect(locators.length).toBeGreaterThan(0);
    for (const locator of locators) {
      expect(locator).toContain(':');
      expect(locator!.split(':')[0]).toMatch(/^src\//);
    }
  });
});
