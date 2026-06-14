import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  deriveCorpusGenericConcepts,
  matchCandidateToReviewChallenge,
} from '../d1Matcher';
import type { ChallengePacket } from '../types';
import type { ChallengePacket as RepoChallengePacket } from '../../repoSemanticGraph';
import { createMockD1, type BetterSqliteDb } from '../../../__tests__/helpers/mockD1';
const livingMigration = readFileSync(
  new URL('../../../../migrations/0082_living_context_graph.sql', import.meta.url),
  'utf8',
);
const matchingMigration = readFileSync(
  new URL('../../../../migrations/0083_repo_semantic_graph_and_match_runs.sql', import.meta.url),
  'utf8',
);



function seedCandidateEvidence(sqlite: BetterSqliteDb): void {
  const now = '2026-06-14T08:00:00.000Z';
  sqlite.exec(`
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
    INSERT INTO artifact_versions (
      id, ingestion_key, artifact_id, version_number, content_hash, media_type, content_text, byte_length, metadata_json, created_at
    ) VALUES (
      'artifact-version-1', 'artifact-version-1', 'artifact-1', 1, 'sha256:candidate', 'text/plain',
      'implemented kafka idempotency and validated retry handling', 57, '{}', '${now}'
    );
    INSERT INTO source_spans (
      id, ingestion_key, artifact_version_id, byte_start, byte_end, char_start, char_end,
      line_start, line_end, exact_text, exact_text_hash, metadata_json, created_at
    ) VALUES
      (
        'candidate-span-1', 'candidate-span-1', 'artifact-version-1', 0, 28, 0, 28, 1, 1,
        'implemented kafka idempotency', 'sha256:candidate-span-1', '{}', '${now}'
      ),
      (
        'candidate-span-2', 'candidate-span-2', 'artifact-version-1', 33, 57, 33, 57, 1, 1,
        'validated retry handling', 'sha256:candidate-span-2', '{}', '${now}'
      );
    INSERT INTO episodes (
      id, ingestion_key, workspace_person_id, interaction_id, narrative, metadata_json, created_at, updated_at
    ) VALUES (
      'episode-1', 'episode-1', 'workspace-person-1', 'interaction-1',
      'Candidate described implemented Kafka idempotency and retry validation.', '{}', '${now}', '${now}'
    );
    INSERT INTO concepts (
      id, ingestion_key, canonical_key, namespace, label, aliases_json, metadata_json, created_at, updated_at
    ) VALUES (
      'concept-kafka', 'concept-kafka', 'term:kafka', 'term', 'kafka', '[]', '{}', '${now}', '${now}'
    );
    INSERT INTO semantic_assertions (
      id, ingestion_key, workspace_person_id, episode_id, subject_type, subject_id,
      predicate, object_type, object_value_json, narrative, qualifiers_json, confidence,
      polarity, extraction_version, observed_at, created_at, updated_at
    ) VALUES
      (
        'assertion-1', 'assertion-1', 'workspace-person-1', 'episode-1', 'person', 'person-1',
        'implemented', 'concept', '{"value":"kafka"}',
        'Candidate implemented Kafka idempotency.', '{}', 1, 1, 'test', '${now}', '${now}', '${now}'
      ),
      (
        'assertion-2', 'assertion-2', 'workspace-person-1', 'episode-1', 'person', 'person-1',
        'validated', 'concept', '{"value":"kafka"}',
        'Candidate validated retry handling.', '{}', 1, 1, 'test', '${now}', '${now}', '${now}'
      );
    INSERT INTO assertion_source_spans (assertion_id, source_span_id, evidence_role, created_at)
    VALUES
      ('assertion-1', 'candidate-span-1', 'support', '${now}'),
      ('assertion-2', 'candidate-span-2', 'support', '${now}');
    INSERT INTO assertion_concepts (assertion_id, concept_id, relationship, weight, created_at)
    VALUES
      ('assertion-1', 'concept-kafka', 'about', 1, '${now}'),
      ('assertion-2', 'concept-kafka', 'about', 1, '${now}');
    INSERT INTO signal_evidence (
      id, ingestion_key, workspace_person_id, interaction_id, assertion_id, concept_id,
      signal_key, evidence_level, strength, polarity, metadata_json, created_at, updated_at
    ) VALUES
      (
        'evidence-1', 'evidence-1', 'workspace-person-1', 'interaction-1', 'assertion-1', 'concept-kafka',
        'term:kafka', 'implemented', 1, 1, '{}', '${now}', '${now}'
      ),
      (
        'evidence-2', 'evidence-2', 'workspace-person-1', 'interaction-1', 'assertion-2', 'concept-kafka',
        'term:kafka', 'validated', 1, 1, '{}', '${now}', '${now}'
      );
  `);
}

function seedPacketWithMissingDemandSpans(sqlite: BetterSqliteDb): void {
  const packet: RepoChallengePacket = {
    schemaVersion: '1.0.0',
    policyVersion: 'repo-challenge-v1',
    id: 'packet-missing-span',
    repoSnapshotId: 'snapshot-1',
    repository: {
      provider: 'github',
      owner: 'pipe',
      name: 'orders',
      canonicalUrl: 'https://github.com/pipe/orders',
    },
    pullRequest: {
      number: 42,
      url: 'https://github.com/pipe/orders/pull/42',
      title: 'Retry Kafka events idempotently',
      author: 'engineer',
      baseSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      headSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      mergedAt: '2026-06-14T08:00:00.000Z',
    },
    languageSupport: {
      language: 'TypeScript',
      normalizedLanguage: 'typescript',
      level: 'production',
      parser: 'typescript-compiler-api',
      challengePacketsAllowed: true,
      reason: 'typescript has a validated semantic extraction adapter',
    },
    changedFilePaths: ['src/orders.ts', 'src/orders.test.ts'],
    changedSymbolIds: [],
    sourceSpanIds: ['missing-repo-span-1', 'missing-repo-span-2'],
    testChanges: [],
    demands: [
      {
        id: 'demand-1',
        family: 'artifact:source',
        narrative: 'Review Kafka idempotency implementation.',
        conceptKeys: ['term:kafka'],
        mechanisms: ['term:kafka'],
        sourceSpanIds: ['missing-repo-span-1'],
        changedSymbolIds: [],
        weight: 0.5,
        contentHash: 'sha256:demand1',
      },
      {
        id: 'demand-2',
        family: 'verification:retry',
        narrative: 'Review retry validation coverage.',
        conceptKeys: ['term:kafka'],
        mechanisms: ['term:kafka'],
        sourceSpanIds: ['missing-repo-span-2'],
        changedSymbolIds: [],
        weight: 0.5,
        contentHash: 'sha256:demand2',
      },
    ],
    demandFamilies: ['artifact:source', 'verification:retry'],
    quality: {
      score: 1,
      metrics: {
        provenanceCoverage: 1,
        reviewableSize: 1,
        testCoverage: 1,
        issueContext: 1,
        demandDiversity: 1,
      },
      gates: [],
      eligible: true,
    },
    contentHash: 'sha256:packet',
  };

  sqlite.exec(`
    INSERT INTO qualified_repos (id) VALUES (1);
    INSERT INTO repo_snapshots (
      id, repo_id, commit_sha, extractor_version
    ) VALUES (
      'snapshot-1', 1, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', '1.0.0'
    );
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

function seedIneligiblePacket(sqlite: BetterSqliteDb): void {
  const packet: RepoChallengePacket = {
    schemaVersion: '1.0.0',
    policyVersion: 'repo-challenge-v1',
    id: 'packet-ineligible-smallest-pr',
    repoSnapshotId: 'snapshot-ineligible',
    repository: {
      provider: 'github',
      owner: 'pipe',
      name: 'orders',
      canonicalUrl: 'https://github.com/pipe/orders',
    },
    pullRequest: {
      number: 1,
      url: 'https://github.com/pipe/orders/pull/1',
      title: 'Rust retry implementation',
      author: 'engineer',
      baseSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      headSha: 'cccccccccccccccccccccccccccccccccccccccc',
      mergedAt: '2026-06-14T08:00:00.000Z',
    },
    languageSupport: {
      language: 'Rust',
      normalizedLanguage: 'rust',
      level: 'structural_only',
      parser: 'tree-sitter-rust',
      challengePacketsAllowed: false,
      reason: 'rust is searchable through structural extraction but is not validated for challenge packets',
    },
    changedFilePaths: ['src/orders.rs'],
    changedSymbolIds: [],
    sourceSpanIds: ['repo-span-ineligible'],
    testChanges: [],
    demands: [
      {
        id: 'demand-ineligible',
        family: 'artifact:source',
        narrative: 'Review Kafka idempotency implementation.',
        conceptKeys: ['term:kafka'],
        mechanisms: ['term:kafka'],
        sourceSpanIds: ['repo-span-ineligible'],
        changedSymbolIds: [],
        weight: 1,
        contentHash: 'sha256:demand-ineligible',
      },
    ],
    demandFamilies: ['artifact:source'],
    quality: {
      score: 0.4,
      metrics: {
        provenanceCoverage: 1,
        reviewableSize: 1,
        testCoverage: 0,
        issueContext: 0,
        demandDiversity: 0.25,
      },
      gates: [
        {
          gate: 'production_language',
          passed: false,
          reason: 'rust is searchable through structural extraction but is not validated for challenge packets',
        },
      ],
      eligible: false,
    },
    contentHash: 'sha256:packet-ineligible',
  };

  sqlite.exec(`
    INSERT INTO qualified_repos (id) VALUES (2);
    INSERT INTO repo_snapshots (
      id, repo_id, commit_sha, extractor_version
    ) VALUES (
      'snapshot-ineligible', 2, 'cccccccccccccccccccccccccccccccccccccccc', '1.0.0'
    );
    INSERT INTO repo_source_artifacts (
      id, repo_snapshot_id, artifact_type, path, external_reference
    ) VALUES (
      'repo-artifact-ineligible', 'snapshot-ineligible', 'source', 'src/orders.rs',
      'https://github.com/pipe/orders/blob/cccc/src/orders.rs'
    );
    INSERT INTO repo_artifact_versions (
      id, artifact_id, content_hash, inline_content, byte_length, media_type
    ) VALUES (
      'repo-version-ineligible', 'repo-artifact-ineligible', 'sha256:repo-ineligible',
      'fn process_kafka_retry() {}', 27, 'text/plain'
    );
    INSERT INTO repo_source_spans (
      id, artifact_version_id, content_hash, path, byte_start, byte_end,
      line_start, line_end, pr_side, base_sha, head_sha, exact_text
    ) VALUES (
      'repo-span-ineligible', 'repo-version-ineligible', 'sha256:repo-ineligible',
      'src/orders.rs', 0, 27, 1, 1, 'head',
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'cccccccccccccccccccccccccccccccccccccccc',
      'fn process_kafka_retry() {}'
    );
  `);
  sqlite.prepare(
    `INSERT INTO review_challenge_packets (
       id, repo_snapshot_id, repo_id, pr_number, packet_version, source_hash,
       language, production_ready, quality_score, demand_families_json, packet_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    packet.id,
    packet.repoSnapshotId,
    2,
    packet.pullRequest.number,
    packet.policyVersion,
    packet.contentHash,
    packet.languageSupport.normalizedLanguage,
    0,
    packet.quality.score,
    JSON.stringify(packet.demandFamilies),
    JSON.stringify(packet),
  );
}

describe('matchCandidateToReviewChallenge', () => {
  let sqlite: BetterSqliteDb;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE candidates (id TEXT PRIMARY KEY);
      CREATE TABLE qualified_repos (id INTEGER PRIMARY KEY);
      INSERT INTO candidates (id) VALUES ('candidate-1');
    `);
    sqlite.exec(livingMigration);
    sqlite.exec(matchingMigration);
  });

  afterEach(() => sqlite.close());

  it('records NEEDS_MORE_EVIDENCE instead of selecting a generic fallback PR', async () => {
    const result = await matchCandidateToReviewChallenge(createMockD1(sqlite), 'candidate-1');

    expect(result.status).toBe('NEEDS_MORE_EVIDENCE');
    expect(result.repoId).toBeUndefined();
    expect(sqlite.prepare(
      'SELECT status, selected_packet_id FROM match_runs WHERE id = ?',
    ).get(result.matchRunId)).toEqual({
      status: 'NEEDS_MORE_EVIDENCE',
      selected_packet_id: null,
    });
  });

  it('rejects production-ready packets whose demand spans are not persisted', async () => {
    seedCandidateEvidence(sqlite);
    seedPacketWithMissingDemandSpans(sqlite);

    const result = await matchCandidateToReviewChallenge(createMockD1(sqlite), 'candidate-1');

    expect(result.status).toBe('NO_ROLE_SAFE_CHALLENGE');
    expect(result.repoId).toBeUndefined();
    const row = sqlite.prepare(
      'SELECT selected_packet_id, ranked_results_json FROM match_runs WHERE id = ?',
    ).get(result.matchRunId) as {
      selected_packet_id: string | null;
      ranked_results_json: string;
    };
    expect(row.selected_packet_id).toBeNull();
    expect(JSON.parse(row.ranked_results_json)).toEqual([
      expect.objectContaining({
        challengeId: 'packet-missing-span',
        eligible: false,
        rejectionReasons: expect.arrayContaining(['INCOMPLETE_PROVENANCE']),
      }),
    ]);
  });

  it('returns NO_ROLE_SAFE_CHALLENGE instead of falling back to a persisted ineligible smallest PR', async () => {
    seedCandidateEvidence(sqlite);
    seedIneligiblePacket(sqlite);

    const result = await matchCandidateToReviewChallenge(createMockD1(sqlite), 'candidate-1');

    expect(result.status).toBe('NO_ROLE_SAFE_CHALLENGE');
    expect(result.repoId).toBeUndefined();
    const row = sqlite.prepare(
      'SELECT status, selected_packet_id, ranked_results_json FROM match_runs WHERE id = ?',
    ).get(result.matchRunId) as {
      status: string;
      selected_packet_id: string | null;
      ranked_results_json: string;
    };
    expect(row.status).toBe('NO_ROLE_SAFE_CHALLENGE');
    expect(row.selected_packet_id).toBeNull();
    expect(JSON.parse(row.ranked_results_json)).toEqual([]);
  });
});

describe('deriveCorpusGenericConcepts', () => {
  it('derives genericity from packet prevalence without a semantic vocabulary', () => {
    const packets = Array.from({ length: 5 }, (_, index) => ({
      id: `packet-${index}`,
      repoId: `repo-${index}`,
      prNumber: index,
      sourceVersion: `version-${index}`,
      challengeReady: true,
      languages: [],
      seniority: 'senior',
      concepts: [
        'term:shared-runtime-concept',
        ...(index === 0 ? ['term:never-before-seen-specific-concept'] : []),
      ],
      demands: [],
      quality: { deterministic: 1, contextualSpecificity: 1 },
    })) satisfies ChallengePacket[];

    expect(deriveCorpusGenericConcepts(packets)).toEqual([
      'term:shared-runtime-concept',
    ]);
  });

  it('derives genericity from packet prevalence without a semantic vocabulary (empty seniority)', () => {
    const packets = Array.from({ length: 5 }, (_, index) => ({
      id: `packet-${index}`,
      repoId: `repo-${index}`,
      prNumber: index,
      sourceVersion: `version-${index}`,
      challengeReady: true,
      languages: [],
      concepts: [
        'term:shared-runtime-concept',
        ...(index === 0 ? ['term:never-before-seen-specific-concept'] : []),
      ],
      demands: [],
      quality: { deterministic: 1, contextualSpecificity: 1 },
    })) satisfies ChallengePacket[];

    expect(deriveCorpusGenericConcepts(packets)).toEqual([
      'term:shared-runtime-concept',
    ]);
  });
});
