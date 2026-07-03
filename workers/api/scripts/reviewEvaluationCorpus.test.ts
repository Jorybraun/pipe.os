import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildExpertReviewTemplate,
  parseCorpusReviewArgs,
  runCorpusReviewCli,
  type ExpertReviewFile,
} from './reviewEvaluationCorpus';
import {
  buildCorpusReviewPacket,
  EVALUATION_CORPUS_VERSION,
  loadCorpus,
  type EvaluationCorpus,
} from '../src/lib/challengeMatching/evaluation';

const evaluationMigration = readFileSync(
  new URL('../migrations/0093_matching_evaluation.sql', import.meta.url),
  'utf8',
);
const corpusFixture = new URL(
  '../fixtures/evaluation/sample-corpus.json',
  import.meta.url,
);

function loadFixtureCorpus(): EvaluationCorpus {
  return loadCorpus(readFileSync(corpusFixture, 'utf8'));
}

function loadFixtureCorpusWithContrast(): EvaluationCorpus {
  const corpus = structuredClone(loadFixtureCorpus());
  const fitEvidence = corpus.candidateEvidence[0]!;
  corpus.candidateEvidence.push({
    ...fitEvidence,
    candidateId: 'candidate-negative',
    evidenceId: 'evidence-negative',
    episodeId: 'episode-negative',
    narrative: 'Negative contrast candidate with unrelated backend operations evidence.',
    concepts: ['term:python', 'term:data-pipeline'],
  });
  corpus.expertLabels[0] = {
    ...corpus.expertLabels[0]!,
    negativeCandidateId: 'candidate-negative',
    minimumScoreSeparation: 0.12,
  };
  corpus.metadata = {
    ...corpus.metadata,
    totalCandidates: 2,
  };
  return corpus;
}

function loadFixtureCorpusWithUnlabelledContrastCandidate(): EvaluationCorpus {
  const corpus = structuredClone(loadFixtureCorpus());
  const fitEvidence = corpus.candidateEvidence[0]!;
  corpus.candidateEvidence.push({
    ...fitEvidence,
    candidateId: 'candidate-negative',
    evidenceId: 'evidence-negative',
    episodeId: 'episode-negative',
    narrative: 'Contrast candidate has unrelated data platform operations evidence.',
    concepts: ['term:python', 'term:data-pipeline'],
  });
  corpus.metadata = {
    ...corpus.metadata,
    totalCandidates: 2,
  };
  return corpus;
}

function sourceBackedSinglePacketCorpus(): EvaluationCorpus {
  return {
    version: EVALUATION_CORPUS_VERSION,
    corpusId: 'single-packet-source-backed-corpus',
    createdAt: '2026-07-02T21:00:00.000Z',
    description: 'Source-backed corpus that still needs challenge packet breadth.',
    candidateEvidence: [
      {
        candidateId: 'candidate-fit',
        evidenceId: 'evidence-fit-react',
        episodeId: 'episode-fit-react',
        narrative: 'Candidate owns React interaction state and accessibility regressions.',
        concepts: ['term:react', 'term:accessibility', 'term:interaction-state'],
        evidenceReferences: [
          {
            artifactId: 'resume-fit',
            artifactVersion: 'resume-fit-v1',
            sourceRefType: 'resume',
            sourceRefId: 'resume-fit-span-1',
            contentHash: 'sha256:fit-source',
            exactText: 'Owned React interaction state and accessibility regressions.',
            startOffset: 0,
            endOffset: 58,
          },
        ],
      },
      {
        candidateId: 'candidate-negative',
        evidenceId: 'evidence-negative-data',
        episodeId: 'episode-negative-data',
        narrative: 'Candidate has unrelated data platform operations evidence.',
        concepts: ['term:python', 'term:data-pipeline'],
        evidenceReferences: [
          {
            artifactId: 'resume-negative',
            artifactVersion: 'resume-negative-v1',
            sourceRefType: 'resume',
            sourceRefId: 'resume-negative-span-1',
            contentHash: 'sha256:negative-source',
            exactText: 'Maintained unrelated data platform operations.',
            startOffset: 0,
            endOffset: 45,
          },
        ],
      },
    ],
    roleRequirements: [
      {
        roleId: 'role-frontend',
        requiredLanguages: ['TypeScript'],
        relevantConcepts: ['term:react', 'term:accessibility'],
        sourceReferences: [
          {
            entityId: 'role-frontend-doc',
            locator: 'roles/frontend.md#L1-L3',
            conceptKeys: ['term:react', 'term:accessibility'],
            sourceRefType: 'role_description',
            sourceRefId: 'role-frontend-span-1',
            exactText: 'Frontend engineer for React accessibility interaction systems.',
            contentHash: 'sha256:role-source',
          },
        ],
      },
    ],
    expectedPackets: [
      {
        challengeId: 'challenge-react-accessibility',
        repoId: 'mui/base-ui',
        repoFullName: 'mui/base-ui',
        repoUrl: 'https://github.com/mui/base-ui',
        prNumber: 973,
        prUrl: 'https://github.com/mui/base-ui/pull/973',
        prTitle: 'Fix interaction state regression',
        sourceVersion: 'test-source-v1',
        packetContentHash: 'sha256:packet-source',
        demands: [
          {
            demandId: 'demand-react-accessibility',
            concepts: ['term:react', 'term:accessibility'],
            sourceRefs: [
              {
                artifactId: 'repo-packet-973',
                artifactVersion: 'repo-packet-973-v1',
                sourceRefType: 'github_pr_diff',
                sourceRefId: 'mui-base-ui-973-diff',
                contentHash: 'sha256:repo-demand-source',
                exactText: 'Fix interaction state regression in accessibility behavior.',
                startOffset: 0,
                endOffset: 61,
              },
            ],
          },
        ],
      },
    ],
    expertLabels: [
      {
        labelId: 'label-fit-positive',
        candidateId: 'candidate-fit',
        roleId: 'role-frontend',
        challengeId: 'challenge-react-accessibility',
        relevanceGrade: 'highly_relevant',
        eligibleChallengeIds: ['challenge-react-accessibility'],
        negativeCandidateId: 'candidate-negative',
        minimumScoreSeparation: 0.12,
        explanation: 'Human reviewer confirmed this PR tests the candidate evidence.',
        labelVersion: '1.0.0',
        labeledAt: '2026-07-02T21:05:00.000Z',
        labeledBy: 'expert-reviewer-1',
        labelProvenance: {
          reviewerId: 'expert-reviewer-1',
          reviewerRole: 'senior-engineering-reviewer',
          reviewArtifactId: 'review-artifact-single-packet',
          reviewArtifactVersion: 'v1',
          contentHash: 'sha256:positive-label-source',
          locator: 'review-artifact-single-packet#label-fit-positive',
          rubricVersion: 'candidate-pr-match-rubric-v1',
        },
      },
      {
        labelId: 'label-negative-contrast',
        candidateId: 'candidate-negative',
        roleId: 'role-frontend',
        challengeId: 'challenge-react-accessibility',
        relevanceGrade: 'irrelevant',
        eligibleChallengeIds: [],
        explanation: 'Human reviewer confirmed the contrast candidate should not match this PR.',
        labelVersion: '1.0.0',
        labeledAt: '2026-07-02T21:06:00.000Z',
        labeledBy: 'expert-reviewer-1',
        labelProvenance: {
          reviewerId: 'expert-reviewer-1',
          reviewerRole: 'senior-engineering-reviewer',
          reviewArtifactId: 'review-artifact-single-packet',
          reviewArtifactVersion: 'v1',
          contentHash: 'sha256:negative-label-source',
          locator: 'review-artifact-single-packet#label-negative-contrast',
          rubricVersion: 'candidate-pr-match-rubric-v1',
        },
      },
    ],
    metadata: {
      totalLabels: 2,
      totalCandidates: 2,
      totalRoles: 1,
      totalChallenges: 1,
      syntheticFixtureCount: 0,
      totalExpectedPackets: 1,
    },
  };
}

function completedReview(
  template: ExpertReviewFile,
  overrides?: Partial<ExpertReviewFile>,
): ExpertReviewFile {
  return {
    ...template,
    reviewerId: 'expert-reviewer-1',
    reviewerRole: 'senior-engineering-reviewer',
    reviewArtifactId: 'expert-review-artifact-1',
    reviewArtifactVersion: 'artifact-version-1',
    rubricVersion: 'candidate-pr-match-rubric-v1',
    reviewedAt: '2026-07-02T20:00:00.000Z',
    reviewedCorpusId: 'sample-corpus-v1-expert-reviewed',
    labels: template.labels.map((label) => {
      const suggestedNegativeCandidateId = label.suggestedNegativeCandidateIds?.[0];
      return {
        ...label,
        ...(label.negativeCandidateId === undefined && suggestedNegativeCandidateId
          ? { negativeCandidateId: suggestedNegativeCandidateId }
          : {}),
        ...(label.minimumScoreSeparation === undefined && suggestedNegativeCandidateId
          ? { minimumScoreSeparation: label.suggestedMinimumScoreSeparation ?? 0.1 }
          : {}),
        explanation:
          'Human reviewer confirmed the candidate evidence, role requirement, '
          + 'and selected source-backed challenge are appropriate for this CODE_REVIEW gate.',
      };
    }),
    ...overrides,
  };
}

function insertCorpus(
  db: InstanceType<typeof Database>,
  corpusJson: string,
): void {
  const corpus = JSON.parse(corpusJson) as {
    corpusId: string;
    version: string;
    createdAt: string;
    expertLabels: Array<{
      labeledBy: string;
      labelProvenance?: { contentHash?: string };
    }>;
    metadata: { syntheticFixtureCount: number };
  };
  const expertLabelCount = corpus.expertLabels.filter((label) =>
    label.labeledBy !== 'synthetic-fixture'
    && label.labelProvenance?.contentHash?.startsWith('sha256:') === true
  ).length;
  const corpusHash = createHash('sha256').update(corpusJson).digest('hex');
  db.prepare(
    `INSERT INTO evaluation_corpora (
       corpus_id, schema_version, corpus_hash, corpus_json,
       expert_label_count, synthetic_fixture_count, frozen_at, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch())`,
  ).run(
    corpus.corpusId,
    corpus.version,
    corpusHash,
    corpusJson,
    expertLabelCount,
    corpus.metadata.syntheticFixtureCount,
    Math.floor(Date.parse(corpus.createdAt) / 1000),
  );
}

function setupSeedSchema(db: InstanceType<typeof Database>): void {
  db.exec(`
    CREATE TABLE match_runs (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL,
      role_context_id TEXT,
      role_snapshot_id TEXT NOT NULL DEFAULT 'standalone-code-review-v1',
      candidate_snapshot_id TEXT NOT NULL,
      policy_version TEXT NOT NULL DEFAULT '1.0.0',
      model_version TEXT,
      status TEXT NOT NULL,
      selected_packet_id TEXT,
      ranked_results_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE people (
      id TEXT PRIMARY KEY,
      display_name TEXT,
      primary_email TEXT
    );

    CREATE TABLE workspace_people (
      id TEXT PRIMARY KEY,
      person_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL DEFAULT 'ws-1'
    );

    CREATE TABLE applications (
      id TEXT PRIMARY KEY,
      workspace_person_id TEXT NOT NULL,
      legacy_candidate_id TEXT
    );

    CREATE TABLE interactions (
      id TEXT PRIMARY KEY,
      workspace_person_id TEXT NOT NULL,
      interaction_type TEXT NOT NULL
    );

    CREATE TABLE artifacts (
      id TEXT PRIMARY KEY,
      interaction_id TEXT,
      artifact_type TEXT NOT NULL
    );

    CREATE TABLE artifact_versions (
      id TEXT PRIMARY KEY,
      artifact_id TEXT NOT NULL,
      version_number INTEGER NOT NULL DEFAULT 1,
      content_hash TEXT NOT NULL
    );

    CREATE TABLE source_spans (
      id TEXT PRIMARY KEY,
      artifact_version_id TEXT NOT NULL,
      byte_start INTEGER,
      byte_end INTEGER,
      char_start INTEGER,
      char_end INTEGER,
      line_start INTEGER,
      line_end INTEGER,
      exact_text TEXT NOT NULL,
      exact_text_hash TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE episodes (
      id TEXT PRIMARY KEY,
      workspace_person_id TEXT NOT NULL,
      interaction_id TEXT,
      narrative TEXT
    );

    CREATE TABLE semantic_assertions (
      id TEXT PRIMARY KEY,
      episode_id TEXT,
      narrative TEXT NOT NULL
    );

    CREATE TABLE assertion_source_spans (
      assertion_id TEXT NOT NULL,
      source_span_id TEXT NOT NULL,
      PRIMARY KEY (assertion_id, source_span_id)
    );

    CREATE TABLE concepts (
      id TEXT PRIMARY KEY,
      canonical_key TEXT NOT NULL UNIQUE,
      namespace TEXT NOT NULL DEFAULT 'open',
      label TEXT NOT NULL
    );

    CREATE TABLE assertion_concepts (
      assertion_id TEXT NOT NULL,
      concept_id TEXT NOT NULL,
      relationship TEXT NOT NULL DEFAULT 'demonstrates',
      weight REAL NOT NULL DEFAULT 1.0,
      PRIMARY KEY (assertion_id, concept_id)
    );

    CREATE TABLE role_context_documents (
      id TEXT PRIMARY KEY,
      required_languages_json TEXT,
      relevant_concepts_json TEXT,
      required_concepts_json TEXT,
      forbidden_concepts_json TEXT
    );

    CREATE TABLE role_source_references (
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

    CREATE TABLE review_challenge_packets (
      id TEXT PRIMARY KEY,
      repo_id TEXT NOT NULL,
      pr_number INTEGER NOT NULL,
      source_version TEXT NOT NULL,
      content_hash TEXT,
      demands_json TEXT
    );
  `);
  db.exec(evaluationMigration);
}

function seedSourceBackedMatchRun(db: InstanceType<typeof Database>): void {
  db.prepare('INSERT INTO people (id, display_name, primary_email) VALUES (?, ?, ?)').run(
    'person-1',
    'Alice Review',
    'alice@example.test',
  );
  db.prepare('INSERT INTO workspace_people (id, person_id, workspace_id) VALUES (?, ?, ?)').run(
    'wp-1',
    'person-1',
    'ws-1',
  );
  db.prepare('INSERT INTO applications (id, workspace_person_id, legacy_candidate_id) VALUES (?, ?, ?)').run(
    'app-1',
    'wp-1',
    'candidate-1',
  );
  db.prepare('INSERT INTO interactions (id, workspace_person_id, interaction_type) VALUES (?, ?, ?)').run(
    'interaction-1',
    'wp-1',
    'resume',
  );
  db.prepare('INSERT INTO artifacts (id, interaction_id, artifact_type) VALUES (?, ?, ?)').run(
    'artifact-1',
    'interaction-1',
    'resume',
  );
  db.prepare('INSERT INTO artifact_versions (id, artifact_id, version_number, content_hash) VALUES (?, ?, ?, ?)').run(
    'artifact-version-1',
    'artifact-1',
    1,
    'sha256:candidate-source',
  );
  db.prepare('INSERT INTO source_spans (id, artifact_version_id, char_start, char_end, exact_text, exact_text_hash) VALUES (?, ?, ?, ?, ?, ?)').run(
    'source-span-1',
    'artifact-version-1',
    0,
    58,
    'Reviewed React accessibility state and TypeScript event logic.',
    'sha256:span',
  );
  db.prepare('INSERT INTO episodes (id, workspace_person_id, interaction_id, narrative) VALUES (?, ?, ?, ?)').run(
    'episode-1',
    'wp-1',
    'interaction-1',
    'Candidate source-backed resume evidence',
  );
  db.prepare('INSERT INTO semantic_assertions (id, episode_id, narrative) VALUES (?, ?, ?)').run(
    'assertion-1',
    'episode-1',
    'Demonstrates React accessibility state review with TypeScript event handling.',
  );
  db.prepare('INSERT INTO assertion_source_spans (assertion_id, source_span_id) VALUES (?, ?)').run(
    'assertion-1',
    'source-span-1',
  );
  db.prepare('INSERT INTO concepts (id, canonical_key, namespace, label) VALUES (?, ?, ?, ?)').run(
    'concept-1',
    'term:react-accessibility-state',
    'open',
    'React accessibility state',
  );
  db.prepare('INSERT INTO assertion_concepts (assertion_id, concept_id) VALUES (?, ?)').run(
    'assertion-1',
    'concept-1',
  );
  db.prepare(
    'INSERT INTO role_context_documents (id, required_languages_json, relevant_concepts_json) VALUES (?, ?, ?)',
  ).run(
    'role-1',
    '["typescript"]',
    '["term:react-accessibility-state"]',
  );
  db.prepare(
    `INSERT INTO role_source_references (
       id, role_context_id, entity_id, locator, concept_keys_json,
       source_ref_type, source_ref_id, exact_text, content_hash
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    'role-ref-1',
    'role-1',
    'role-1',
    'role:requirements',
    '["term:react-accessibility-state"]',
    'role_context',
    'role-ref-1',
    'Needs TypeScript accessibility state review experience.',
    'sha256:role',
  );
  db.prepare(
    'INSERT INTO review_challenge_packets (id, repo_id, pr_number, source_version, content_hash, demands_json) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(
    'packet-1',
    'mui/base-ui',
    973,
    'commit-sha-1',
    'sha256:packet',
    JSON.stringify([{
      demandId: 'demand-1',
      concepts: ['term:react-accessibility-state'],
      sourceRefs: [{
        artifactId: 'packet-1',
        artifactVersion: 'commit-sha-1',
        contentHash: 'sha256:packet',
        sourceRefType: 'repo_source_span',
        sourceRefId: 'repo-span-1',
        sourceSpanId: 'repo-span-1',
        exactText: 'Review the popover state transition and accessibility semantics.',
        startOffset: 0,
        endOffset: 62,
      }],
    }]),
  );
  db.prepare(
    `INSERT INTO match_runs (
       id, candidate_id, role_context_id, role_snapshot_id,
       candidate_snapshot_id, policy_version, status, selected_packet_id,
       ranked_results_json, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    'match-run-1',
    'candidate-1',
    'role-1',
    'standalone-code-review-v1',
    'candidate-snapshot-1',
    'candidate-pr-v1',
    'MATCHED',
    'packet-1',
    JSON.stringify([{
      rank: 1,
      recallRank: 1,
      challengeId: 'packet-1',
      repoId: 'mui/base-ui',
      prNumber: 973,
      sourceVersion: 'commit-sha-1',
      score: 0.88,
      candidateEvidenceAlignment: 0.9,
      roleRelevance: 0.86,
      contextualSpecificity: 0.82,
      challengeQuality: 0.91,
      validationDeepeningValue: 0.72,
      alignedDemandCount: 1,
      stretchCount: 0,
      stretchDemandWeightRatio: 0,
      provenanceComplete: true,
      eligible: true,
      alignments: [],
      rejectionReasons: [],
    }]),
    '2026-07-02T21:30:00.000Z',
  );
}

describe('evaluation corpus review CLI', () => {
  let directory: string | undefined;

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = undefined;
  });

  it('parses source and output options for an export-only review workflow', () => {
    expect(parseCorpusReviewArgs([
      '--source-corpus-file',
      corpusFixture.pathname,
      '--review-packet',
      '/tmp/review-packet.json',
      '--review-template',
      '/tmp/review-template.json',
    ])).toEqual(expect.objectContaining({
      sourceCorpusFile: corpusFixture.pathname,
      reviewPacketPath: '/tmp/review-packet.json',
      reviewTemplatePath: '/tmp/review-template.json',
      persist: false,
    }));
  });

  it('parses a remote app-dev database id for stored corpus review exports', () => {
    expect(parseCorpusReviewArgs([
      '--remote',
      '--database-id',
      'app-dev-d1',
      '--source-corpus-id',
      'seeded-corpus-1',
      '--review-packet',
      '/tmp/review-packet.json',
    ])).toEqual(expect.objectContaining({
      target: 'remote',
      databaseId: 'app-dev-d1',
      sourceCorpusId: 'seeded-corpus-1',
      reviewPacketPath: '/tmp/review-packet.json',
    }));
  });

  it('rejects remote database ids in local corpus review mode', () => {
    expect(() => parseCorpusReviewArgs([
      '--database-id',
      'app-dev-d1',
      '--source-corpus-file',
      corpusFixture.pathname,
      '--review-packet',
      '/tmp/review-packet.json',
    ])).toThrow('--database-id requires --remote');
  });

  it('parses seed-from-match-runs options for draft corpus review exports', () => {
    expect(parseCorpusReviewArgs([
      '--database-path',
      '/tmp/evaluation.sqlite',
      '--seed-from-match-runs',
      '--seed-limit',
      '3',
      '--seed-selection-pool-limit',
      '25',
      '--seed-status',
      'MATCHED',
      '--persist-draft',
      '--review-packet',
      '/tmp/review-packet.json',
    ])).toEqual(expect.objectContaining({
      databasePath: '/tmp/evaluation.sqlite',
      seedFromMatchRuns: true,
      seedLimit: 3,
      seedSelectionPoolLimit: 25,
      seedStatusFilter: 'MATCHED',
      persistDraft: true,
      reviewPacketPath: '/tmp/review-packet.json',
    }));
  });

  it('seeds a draft corpus from real match runs and exports review artifacts', async () => {
    directory = await mkdtemp(join(tmpdir(), 'pipe-corpus-review-'));
    const databasePath = join(directory, 'evaluation.sqlite');
    const reviewPacketPath = join(directory, 'seeded-review-packet.json');
    const reviewTemplatePath = join(directory, 'seeded-review-template.json');
    const summaryPath = join(directory, 'seeded-summary.json');
    const sqlite = new Database(databasePath);
    setupSeedSchema(sqlite);
    seedSourceBackedMatchRun(sqlite);
    sqlite.close();

    const exitCode = await runCorpusReviewCli([
      '--database-path',
      databasePath,
      '--seed-from-match-runs',
      '--seed-limit',
      '1',
      '--seed-description',
      'Draft CODE_REVIEW corpus seeded from app-dev-style match runs',
      '--persist-draft',
      '--review-packet',
      reviewPacketPath,
      '--review-template',
      reviewTemplatePath,
      '--json',
      summaryPath,
    ]);

    expect(exitCode).toBe(0);
    const summary = JSON.parse(await readFile(summaryPath, 'utf8')) as {
      sourceCorpusId: string;
      draftPersisted: boolean;
      readinessSummary: {
        nextAction: string;
        labelsNeedingHumanReview: string[];
        labelsMissingExpectedPacket: string[];
        labelsMissingRepoDemandEvidence: string[];
      };
      seeded: {
        matchRunCount: number;
        labelCount: number;
        draftLabelCount: number;
        expertLabelCount: number;
        expectedPacketCount: number;
        warnings: string[];
      };
      nextAction: string;
    };
    expect(summary.sourceCorpusId).toMatch(/^seeded-/);
    expect(summary.draftPersisted).toBe(true);
    expect(summary.seeded).toEqual(expect.objectContaining({
      matchRunCount: 1,
      labelCount: 1,
      draftLabelCount: 1,
      expertLabelCount: 0,
      expectedPacketCount: 1,
      warnings: [],
    }));
    expect(summary.readinessSummary).toEqual(expect.objectContaining({
      nextAction: 'expand_corpus_packet_breadth',
      labelsNeedingHumanReview: ['seeded-match-run-1-packet-1'],
      labelsMissingExpectedPacket: [],
      labelsMissingRepoDemandEvidence: [],
    }));
    expect(summary.nextAction).toBe('expand_corpus_packet_breadth');

    const packet = JSON.parse(await readFile(reviewPacketPath, 'utf8')) as {
      readinessSummary: {
        nextAction: string;
        labelsNeedingHumanReview: string[];
        labelsMissingExpectedPacket: string[];
        labelsMissingRepoDemandEvidence: string[];
      };
      items: Array<{
        candidateEvidence: Array<{ evidenceReferences: Array<{ exactText: string }> }>;
        expectedPacket: { repoId: string; prNumber: number };
      }>;
    };
    expect(packet.readinessSummary).toEqual(expect.objectContaining({
      nextAction: 'expand_corpus_packet_breadth',
      labelsNeedingHumanReview: ['seeded-match-run-1-packet-1'],
      labelsMissingExpectedPacket: [],
      labelsMissingRepoDemandEvidence: [],
    }));
    expect(packet.items[0]?.candidateEvidence[0]?.evidenceReferences[0]?.exactText)
      .toContain('Reviewed React accessibility state');
    expect(packet.items[0]?.expectedPacket).toEqual(expect.objectContaining({
      repoId: 'mui/base-ui',
      prNumber: 973,
    }));

    const template = JSON.parse(await readFile(reviewTemplatePath, 'utf8')) as ExpertReviewFile;
    expect(template.sourceCorpusId).toBe(summary.sourceCorpusId);
    expect(template.labels[0]).toEqual(expect.objectContaining({
      labelId: 'seeded-match-run-1-packet-1',
      explanation: expect.stringContaining('TODO'),
    }));

    const verification = new Database(databasePath);
    expect(verification.prepare(
      `SELECT expert_label_count, synthetic_fixture_count
         FROM evaluation_corpora
        WHERE corpus_id = ?`,
    ).get(summary.sourceCorpusId)).toEqual({
      expert_label_count: 0,
      synthetic_fixture_count: 0,
    });
    verification.close();
  });

  it('builds a source-backed expert review template with explicit placeholders', () => {
    const packet = buildCorpusReviewPacket(loadFixtureCorpus());
    const template = buildExpertReviewTemplate(packet);

    expect(template).toEqual(expect.objectContaining({
      sourceCorpusId: 'sample-corpus-v1',
      reviewerId: 'TODO_REVIEWER_ID',
      reviewArtifactId: 'sample-corpus-v1-expert-review',
      rubricVersion: 'candidate-pr-match-rubric-v1',
    }));
    expect(template.labels).toEqual([
      expect.objectContaining({
        labelId: 'label-1',
        relevanceGrade: 'highly_relevant',
        eligibleChallengeIds: ['challenge-1', 'challenge-2'],
        explanation: expect.stringContaining('TODO: replace'),
      }),
    ]);
  });

  it('preserves expert-reviewed contrast fields in review packets and templates', () => {
    const packet = buildCorpusReviewPacket(loadFixtureCorpusWithContrast());
    const template = buildExpertReviewTemplate(packet);

    expect(packet.readinessSummary).toEqual(expect.objectContaining({
      contrastLabelCount: 1,
      labelsMissingContrastCandidate: [],
    }));
    expect(packet.items[0]).toEqual(expect.objectContaining({
      draft: expect.objectContaining({
        negativeCandidateId: 'candidate-negative',
        minimumScoreSeparation: 0.12,
      }),
      reviewQuestions: expect.arrayContaining([
        expect.stringContaining('negative candidate'),
      ]),
    }));
    expect(template.labels[0]).toEqual(expect.objectContaining({
      negativeCandidateId: 'candidate-negative',
      minimumScoreSeparation: 0.12,
    }));
  });

  it('suggests contrast candidates in review packets and templates', () => {
    const packet = buildCorpusReviewPacket(loadFixtureCorpusWithUnlabelledContrastCandidate());
    const template = buildExpertReviewTemplate(packet);

    expect(packet.items[0]).toEqual(expect.objectContaining({
      suggestedContrastCandidates: [
        expect.objectContaining({
          candidateId: 'candidate-negative',
          evidenceCount: 1,
          reason: expect.stringContaining('no label for this role'),
        }),
      ],
    }));
    expect(template.labels[0]).toEqual(expect.objectContaining({
      suggestedNegativeCandidateIds: ['candidate-negative'],
      suggestedMinimumScoreSeparation: 0.1,
    }));
  });

  it('points source-backed one-packet corpora at packet breadth expansion', () => {
    const packet = buildCorpusReviewPacket(sourceBackedSinglePacketCorpus());

    expect(packet.productionReady).toBe(false);
    expect(packet.productionReadinessFailures).toEqual([
      'production corpus requires at least two source-backed expected PR challenge packets',
    ]);
    expect(packet.readinessSummary).toEqual(expect.objectContaining({
      nextAction: 'expand_corpus_packet_breadth',
      labelsNeedingHumanReview: [],
      labelsMissingCandidateEvidence: [],
      labelsMissingRoleRequirements: [],
      labelsMissingExpectedPacket: [],
      labelsMissingRepoDemandEvidence: [],
      negativeLabelCount: 1,
      contrastLabelCount: 1,
    }));
  });

  it('exports review packets and editable review templates from a corpus file', async () => {
    directory = await mkdtemp(join(tmpdir(), 'pipe-corpus-review-'));
    const reviewPacketPath = join(directory, 'review-packet.json');
    const reviewTemplatePath = join(directory, 'review-template.json');
    const summaryPath = join(directory, 'summary.json');

    const exitCode = await runCorpusReviewCli([
      '--source-corpus-file',
      corpusFixture.pathname,
      '--review-packet',
      reviewPacketPath,
      '--review-template',
      reviewTemplatePath,
      '--json',
      summaryPath,
    ]);

    expect(exitCode).toBe(0);
    const packet = JSON.parse(await readFile(reviewPacketPath, 'utf8')) as {
      corpusId: string;
      readinessSummary: {
        nextAction: string;
        draftLabelCount: number;
        labelsNeedingHumanReview: string[];
        labelsMissingExpectedPacket: string[];
        labelsMissingRepoDemandEvidence: string[];
      };
      items: Array<{ labelId: string; reviewQuestions: string[] }>;
    };
    expect(packet.corpusId).toBe('sample-corpus-v1');
    expect(packet.readinessSummary).toEqual(expect.objectContaining({
      nextAction: 'fix_corpus_source_evidence',
      draftLabelCount: 1,
      labelsNeedingHumanReview: ['label-1'],
      labelsMissingExpectedPacket: ['label-1'],
      labelsMissingRepoDemandEvidence: ['label-1'],
    }));
    expect(packet.items[0]).toEqual(expect.objectContaining({
      labelId: 'label-1',
      reviewQuestions: expect.arrayContaining([
        expect.stringContaining('candidate evidence'),
      ]),
    }));
    const template = JSON.parse(await readFile(reviewTemplatePath, 'utf8')) as ExpertReviewFile;
    expect(template.sourceCorpusId).toBe('sample-corpus-v1');
    expect(template.labels[0]?.explanation).toContain('TODO');
    expect(JSON.parse(await readFile(summaryPath, 'utf8'))).toEqual(expect.objectContaining({
      sourceCorpusId: 'sample-corpus-v1',
      readinessSummary: expect.objectContaining({
        nextAction: 'fix_corpus_source_evidence',
        labelsMissingExpectedPacket: ['label-1'],
        labelsMissingRepoDemandEvidence: ['label-1'],
      }),
      nextAction: 'fix_corpus_source_evidence',
    }));
  });

  it('rejects unedited template placeholders before creating expert labels', async () => {
    directory = await mkdtemp(join(tmpdir(), 'pipe-corpus-review-'));
    const reviewTemplatePath = join(directory, 'review-template.json');
    const reviewedCorpusPath = join(directory, 'reviewed-corpus.json');
    const template = buildExpertReviewTemplate(buildCorpusReviewPacket(loadFixtureCorpus()));
    writeFileSync(reviewTemplatePath, JSON.stringify(template, null, 2));

    await expect(runCorpusReviewCli([
      '--source-corpus-file',
      corpusFixture.pathname,
      '--review-file',
      reviewTemplatePath,
      '--reviewed-corpus',
      reviewedCorpusPath,
    ])).rejects.toThrow('Expert review file is incomplete');
  });

  it('rejects positive expert reviews without contrast candidate and score separation', async () => {
    directory = await mkdtemp(join(tmpdir(), 'pipe-corpus-review-'));
    const reviewFilePath = join(directory, 'review.json');
    const reviewedCorpusPath = join(directory, 'reviewed-corpus.json');
    const template = buildExpertReviewTemplate(buildCorpusReviewPacket(loadFixtureCorpus()));
    writeFileSync(reviewFilePath, JSON.stringify(completedReview(template), null, 2));

    await expect(runCorpusReviewCli([
      '--source-corpus-file',
      corpusFixture.pathname,
      '--review-file',
      reviewFilePath,
      '--reviewed-corpus',
      reviewedCorpusPath,
    ])).rejects.toThrow(
      'reviewed positive label requires contrast candidate and minimum score separation: label-1',
    );
  });

  it('applies a completed expert review and keeps the corpus blocked until source and contrast evidence are complete', async () => {
    directory = await mkdtemp(join(tmpdir(), 'pipe-corpus-review-'));
    const sourceCorpusPath = join(directory, 'source-corpus.json');
    const reviewFilePath = join(directory, 'review.json');
    const reviewedCorpusPath = join(directory, 'reviewed-corpus.json');
    const summaryPath = join(directory, 'summary.json');
    const sourceCorpus = loadFixtureCorpusWithUnlabelledContrastCandidate();
    writeFileSync(sourceCorpusPath, JSON.stringify(sourceCorpus, null, 2));
    const template = buildExpertReviewTemplate(buildCorpusReviewPacket(sourceCorpus));
    writeFileSync(reviewFilePath, JSON.stringify(completedReview(template), null, 2));

    const exitCode = await runCorpusReviewCli([
      '--source-corpus-file',
      sourceCorpusPath,
      '--review-file',
      reviewFilePath,
      '--reviewed-corpus',
      reviewedCorpusPath,
      '--json',
      summaryPath,
    ]);

    expect(exitCode).toBe(1);
    const reviewed = JSON.parse(await readFile(reviewedCorpusPath, 'utf8')) as EvaluationCorpus;
    expect(reviewed.corpusId).toBe('sample-corpus-v1-expert-reviewed');
    expect(reviewed.metadata.syntheticFixtureCount).toBe(0);
    expect(reviewed.expertLabels[0]).toEqual(expect.objectContaining({
      labeledBy: 'expert-reviewer-1',
      labelProvenance: expect.objectContaining({
        reviewArtifactId: 'expert-review-artifact-1',
        contentHash: expect.stringMatching(/^sha256:/),
      }),
    }));
    expect(JSON.parse(await readFile(summaryPath, 'utf8'))).toEqual(expect.objectContaining({
      reviewedCorpusId: 'sample-corpus-v1-expert-reviewed',
      productionReady: false,
      productionReadinessFailures: expect.arrayContaining([
        'production corpus requires at least one insufficient-evidence or non-positive contrast label',
        'production corpus requires at least two source-backed expected PR challenge packets',
      ]),
      readinessSummary: expect.objectContaining({
        nextAction: 'fix_corpus_source_evidence',
        labelsNeedingHumanReview: [],
        labelsMissingContrastCandidate: [],
        labelsMissingExpectedPacket: ['label-1'],
        labelsMissingRepoDemandEvidence: ['label-1'],
      }),
      nextAction: 'fix_corpus_source_evidence',
    }));
  });

  it('idempotently persists a completed review to a local frozen corpus database', async () => {
    directory = await mkdtemp(join(tmpdir(), 'pipe-corpus-review-'));
    const databasePath = join(directory, 'evaluation.sqlite');
    const reviewFilePath = join(directory, 'review.json');
    const firstSummaryPath = join(directory, 'summary-first.json');
    const secondSummaryPath = join(directory, 'summary-second.json');
    const sourceCorpus = loadFixtureCorpusWithUnlabelledContrastCandidate();
    const sourceCorpusJson = JSON.stringify(sourceCorpus, null, 2);
    const sqlite = new Database(databasePath);
    sqlite.exec(evaluationMigration);
    insertCorpus(sqlite, sourceCorpusJson);
    sqlite.close();

    const template = buildExpertReviewTemplate(buildCorpusReviewPacket(sourceCorpus));
    writeFileSync(reviewFilePath, JSON.stringify(completedReview(template), null, 2));

    const firstExit = await runCorpusReviewCli([
      '--database-path',
      databasePath,
      '--source-corpus-id',
      sourceCorpus.corpusId,
      '--review-file',
      reviewFilePath,
      '--persist',
      '--json',
      firstSummaryPath,
    ]);
    const secondExit = await runCorpusReviewCli([
      '--database-path',
      databasePath,
      '--source-corpus-id',
      sourceCorpus.corpusId,
      '--review-file',
      reviewFilePath,
      '--persist',
      '--json',
      secondSummaryPath,
    ]);

    expect(firstExit).toBe(1);
    expect(secondExit).toBe(1);
    expect(JSON.parse(await readFile(firstSummaryPath, 'utf8'))).toEqual(expect.objectContaining({
      persisted: true,
      expertLabelCount: 1,
      syntheticFixtureCount: 0,
      productionReady: false,
    }));
    expect(JSON.parse(await readFile(secondSummaryPath, 'utf8'))).toEqual(expect.objectContaining({
      persisted: false,
    }));
    const verification = new Database(databasePath);
    expect(verification.prepare(
      `SELECT corpus_id, expert_label_count, synthetic_fixture_count
         FROM evaluation_corpora
        ORDER BY corpus_id`,
    ).all()).toEqual([
      {
        corpus_id: sourceCorpus.corpusId,
        expert_label_count: 0,
        synthetic_fixture_count: 1,
      },
      {
        corpus_id: 'sample-corpus-v1-expert-reviewed',
        expert_label_count: 1,
        synthetic_fixture_count: 0,
      },
    ]);
    verification.close();
  });
});
