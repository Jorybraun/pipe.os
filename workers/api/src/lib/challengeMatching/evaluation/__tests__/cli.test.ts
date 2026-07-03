import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { runEvaluationCli, parseEvaluationArgs } from '../../../../../scripts/evaluateMatching';
import { createMockD1 } from '../../../../__tests__/helpers/mockD1';
import { runEvaluation } from '../cli';
import type { EvaluationCorpus, ExpertLabel } from '../types';

const evaluationMigration = readFileSync(
  new URL('../../../../../migrations/0093_matching_evaluation.sql', import.meta.url),
  'utf8',
);
const corpusFixture = new URL(
  '../../../../../fixtures/evaluation/sample-corpus.json',
  import.meta.url,
);

function expertCorpusJson(): string {
  const corpus = JSON.parse(readFileSync(corpusFixture, 'utf8')) as EvaluationCorpus;
  const negativeCandidateId = 'candidate-negative-1';
  corpus.corpusId = 'expert-corpus-v1';
  corpus.description = 'Test-only corpus with non-synthetic labels for persisted evaluation coverage';
  corpus.candidateEvidence = [
    ...corpus.candidateEvidence,
    {
      candidateId: negativeCandidateId,
      evidenceId: 'evidence-negative-1',
      episodeId: 'episode-negative-1',
      narrative: 'Operated analytics notebooks without cryptography design or source-backed PR review work.',
      concepts: ['term:analytics-notebooks'],
      mechanisms: ['term:notebook-automation'],
      domains: ['term:analytics'],
      businessObjects: ['term:reports'],
      ownershipActions: ['term:operated'],
      evidenceReferences: [sourceRef({
        artifactId: 'artifact-negative-1',
        sourceRefId: 'candidate-negative-source-span-1',
        sourceSpanId: 'candidate-negative-source-span-1',
        exactText: 'I operated analytics notebooks and did not design cryptography systems.',
      })],
    },
  ];
  corpus.expertLabels = corpus.expertLabels.map((label, index) => ({
    ...label,
    labelId: `expert-label-${index + 1}`,
    labeledBy: 'expert-reviewer-1',
    negativeCandidateId,
    minimumScoreSeparation: 0.25,
    explanation:
      'Expert reviewer confirmed the candidate evidence aligns with the declared repo challenge '
      + 'and that the selected PR is an appropriate source-backed assessment.',
    labelProvenance: {
      reviewerId: 'expert-reviewer-1',
      reviewerRole: 'senior-engineering-reviewer',
      reviewArtifactId: `expert-review-artifact-${index + 1}`,
      reviewArtifactVersion: `expert-review-version-${index + 1}`,
      contentHash: `sha256:expert-review-${index + 1}`,
      locator: `expert-review:${index + 1}`,
      rubricVersion: 'candidate-pr-match-rubric-v1',
    },
  }));
  const positiveLabel = corpus.expertLabels[0]!;
  positiveLabel.eligibleChallengeIds = [
    positiveLabel.challengeId,
    'challenge-2',
  ];
  const secondPositiveLabel: ExpertLabel = {
    ...positiveLabel,
    labelId: 'expert-label-2',
    challengeId: 'challenge-2',
    explanation:
      'Expert reviewer confirmed the candidate evidence also aligns with a second '
      + 'source-backed PR packet, proving the corpus is not a one-challenge gate.',
    labelProvenance: {
      reviewerId: 'expert-reviewer-1',
      reviewerRole: 'senior-engineering-reviewer',
      reviewArtifactId: 'expert-review-artifact-2',
      reviewArtifactVersion: 'expert-review-version-2',
      contentHash: 'sha256:expert-review-2',
      locator: 'expert-review:2',
      rubricVersion: 'candidate-pr-match-rubric-v1',
    },
  };
  const negativeLabel: ExpertLabel = {
    labelId: 'expert-label-negative-1',
    candidateId: negativeCandidateId,
    roleId: positiveLabel.roleId,
    challengeId: positiveLabel.challengeId,
    relevanceGrade: 'irrelevant',
    eligibleChallengeIds: [],
    explanation:
      'Expert reviewer rejected the same challenge for the contrast candidate because the '
      + 'evidence is analytics notebook operation, not cryptography design or PR review work.',
    labelVersion: '1.0.0',
    labeledAt: positiveLabel.labeledAt,
    labeledBy: 'expert-reviewer-1',
    labelProvenance: {
      reviewerId: 'expert-reviewer-1',
      reviewerRole: 'senior-engineering-reviewer',
      reviewArtifactId: 'expert-review-artifact-negative-1',
      reviewArtifactVersion: 'expert-review-version-negative-1',
      contentHash: 'sha256:expert-review-negative-1',
      locator: 'expert-review:negative-1',
      rubricVersion: 'candidate-pr-match-rubric-v1',
    },
  };
  corpus.expertLabels = [...corpus.expertLabels, secondPositiveLabel, negativeLabel];
  corpus.metadata.syntheticFixtureCount = 0;
  corpus.metadata.totalLabels = corpus.expertLabels.length;
  corpus.metadata.totalCandidates = corpus.candidateEvidence.length;
  // Declare expected packets matching the seeded match runs so the production
  // rollout gate's packet coverage requirement is satisfied.
  corpus.expectedPackets = [
    {
      challengeId: 'challenge-1',
      repoId: 'repo-1',
      prNumber: 42,
      sourceVersion: 'commit-abc',
      demands: [{
        demandId: 'demand-1',
        concepts: ['term:quantum-cryptography'],
        sourceRefs: [sourceRef({
          artifactId: 'repo-artifact-1',
          artifactVersion: 'commit-abc',
        })],
      }],
    },
    {
      challengeId: 'challenge-2',
      repoId: 'repo-2',
      prNumber: 84,
      sourceVersion: 'commit-def',
      demands: [{
        demandId: 'demand-2',
        concepts: ['term:quantum-cryptography'],
        sourceRefs: [sourceRef({
          artifactId: 'repo-artifact-2',
          artifactVersion: 'commit-def',
        })],
      }],
    },
  ];
  corpus.metadata.totalChallenges = 2;
  corpus.metadata.totalExpectedPackets = 2;
  return JSON.stringify(corpus);
}

function writeExpertCorpusFixture(directory: string): string {
  const corpusPath = join(directory, 'expert-corpus.json');
  writeFileSync(corpusPath, expertCorpusJson());
  return corpusPath;
}

function sourceRef(overrides?: Partial<Record<string, unknown>>) {
  const artifactId = typeof overrides?.artifactId === 'string' ? overrides.artifactId : 'artifact-1';
  return {
    artifactId,
    artifactVersion: 'version-1',
    contentHash: 'sha256:abc123',
    sourceRefType: artifactId.startsWith('repo-') ? 'repo_source_span' : 'source_span',
    sourceRefId: `${artifactId}-source-span`,
    sourceSpanId: artifactId.startsWith('repo-') ? undefined : `${artifactId}-source-span`,
    exactText: `Exact source text for ${artifactId}.`,
    startOffset: 0,
    endOffset: 10,
    ...overrides,
  };
}

function rankedResults(overrides?: Partial<Record<string, unknown>>): string {
  const first = {
    rank: 1,
    recallRank: 1,
    challengeId: 'challenge-1',
    repoId: 'repo-1',
    prNumber: 42,
    sourceVersion: 'commit-abc',
    score: 0.95,
    candidateEvidenceAlignment: 0.95,
    roleRelevance: 0.95,
    contextualSpecificity: 0.95,
    challengeQuality: 0.95,
    validationDeepeningValue: 0.95,
    alignedDemandCount: 1,
    stretchCount: 0,
    stretchDemandWeightRatio: 0,
    provenanceComplete: true,
    eligible: true,
    alignments: [{
      atomId: 'atom-1',
      demandId: 'demand-1',
      pairScore: 0.95,
      stretch: null,
      sharedConcepts: ['term:quantum-cryptography'],
      roleSourceRefs: [],
      candidateSourceRefs: [sourceRef()],
      challengeSourceRefs: [sourceRef({
        artifactId: 'repo-artifact-1',
        artifactVersion: 'commit-abc',
      })],
    }],
    rejectionReasons: [],
    ...overrides,
  };
  const second = {
    rank: 2,
    recallRank: 2,
    challengeId: 'challenge-2',
    repoId: 'repo-2',
    prNumber: 84,
    sourceVersion: 'commit-def',
    score: 0.8,
    candidateEvidenceAlignment: 0.8,
    roleRelevance: 0.8,
    contextualSpecificity: 0.8,
    challengeQuality: 0.8,
    validationDeepeningValue: 0.8,
    alignedDemandCount: 1,
    stretchCount: 0,
    stretchDemandWeightRatio: 0,
    provenanceComplete: true,
    eligible: true,
    alignments: [{
      atomId: 'atom-2',
      demandId: 'demand-2',
      pairScore: 0.8,
      stretch: null,
      sharedConcepts: ['term:quantum-cryptography'],
      roleSourceRefs: [],
      candidateSourceRefs: [sourceRef()],
      challengeSourceRefs: [sourceRef({
        artifactId: 'repo-artifact-2',
        artifactVersion: 'commit-def',
      })],
    }],
    rejectionReasons: [],
  };
  return JSON.stringify([first, second]);
}

function seedMatchRuns(db: InstanceType<typeof Database>): void {
  db.exec(`
    CREATE TABLE match_runs (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL,
      role_context_id TEXT,
      candidate_snapshot_id TEXT NOT NULL,
      role_snapshot_id TEXT NOT NULL,
      policy_version TEXT NOT NULL,
      model_version TEXT,
      status TEXT NOT NULL,
      ranked_results_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
  db.exec(evaluationMigration);
  const insert = db.prepare(
    `INSERT INTO match_runs (
       id, candidate_id, role_context_id, candidate_snapshot_id,
       role_snapshot_id, policy_version, model_version, status,
       ranked_results_json, created_at
     ) VALUES (?, ?, 'role-1', ?, 'role-snapshot-1',
               'candidate-pr-v1', NULL, ?, ?, ?)`,
  );
  insert.run('run-primary', 'candidate-1', 'candidate-snapshot-1', 'MATCHED', rankedResults(), 1);
  insert.run('run-comparison', 'candidate-1', 'candidate-snapshot-1', 'MATCHED', rankedResults(), 2);
  insert.run('run-primary-negative', 'candidate-negative-1', 'candidate-snapshot-negative-1', 'NO_MATCH', '[]', 3);
  insert.run('run-comparison-negative', 'candidate-negative-1', 'candidate-snapshot-negative-1', 'NO_MATCH', '[]', 4);
}

function insertEvaluationCorpus(
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
  };
  const syntheticFixtureCount = corpus.expertLabels.filter(
    (label) => label.labeledBy === 'synthetic-fixture',
  ).length;
  const expertLabelCount = corpus.expertLabels.filter((label) =>
    label.labeledBy !== 'synthetic-fixture'
    && label.labelProvenance?.contentHash?.startsWith('sha256:') === true
  ).length;
  db.prepare(
    `INSERT INTO evaluation_corpora (
       corpus_id, schema_version, corpus_hash, corpus_json,
       expert_label_count, synthetic_fixture_count, frozen_at, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch())`,
  ).run(
    corpus.corpusId,
    corpus.version,
    createHash('sha256').update(corpusJson).digest('hex'),
    corpusJson,
    expertLabelCount,
    syntheticFixtureCount,
    Math.floor(Date.parse(corpus.createdAt) / 1000),
  );
}

function persistedResultFixture(overrides?: {
  corpusId?: string;
  passed?: boolean;
  expertLabelCount?: number;
  syntheticFixtureCount?: number;
  requireExpertLabels?: boolean;
  expectedPacketCount?: number;
  packetCoverage?: number;
  pairCoverage?: number;
  comparisonCoverage?: number;
}) {
  const corpusId = overrides?.corpusId ?? 'expert-corpus-v1';
  const metrics = {
    corpusVersion: '1.0.0',
    corpusId,
    matchRunIds: ['run-primary', 'run-primary-negative'],
    comparisonMatchRunIds: ['run-comparison', 'run-comparison-negative'],
    evaluatedAt: '2026-06-14T00:00:00Z',
    recallAt50: 1,
    precisionAt3: 1,
    ndcgAt5: 1,
    guardrailViolationCount: 0,
    multiStretchViolationCount: 0,
    missingProvenanceCount: 0,
    missingMatchRunCount: 0,
    byteIdenticalRerun: true,
    rerunFingerprints: { 'candidate-1::role-1': 'fingerprint-1' },
    determinismComparisons: [{
      candidateId: 'candidate-1',
      roleId: 'role-1',
      matchRunId: 'run-primary',
      comparisonMatchRunId: 'run-comparison',
      identical: true,
      fingerprint: 'fingerprint-1',
      comparisonFingerprint: 'fingerprint-1',
    }],
    totalEvaluations: 2,
    evaluatedPairCount: 2,
    highlyRelevantInTop3: 1,
    relevantInTop3: 0,
    irrelevantInTop3: 0,
    forbiddenInResults: 0,
    syntheticFixtureCount: overrides?.syntheticFixtureCount ?? 0,
    expertLabelCount: overrides?.expertLabelCount ?? 3,
    labelResults: [],
    expectedPacketCount: overrides?.expectedPacketCount ?? 2,
    packetCoverage: overrides?.packetCoverage ?? 1,
    pairCoverage: overrides?.pairCoverage ?? 1,
    comparisonCoverage: overrides?.comparisonCoverage ?? 1,
    missingPacketIds: [],
    packetIdentityMismatches: [],
  };
  return {
    metrics,
    thresholds: {
      minRecallAt50: 0.95,
      minPrecisionAt3: 0.8,
      minNdcgAt5: 0.8,
      maxGuardrailViolations: 0,
      maxMultiStretchViolations: 0,
      maxMissingProvenance: 0,
      maxMissingMatchRuns: 0,
      requireByteIdenticalRerun: true,
      requireExpertLabels: overrides?.requireExpertLabels ?? true,
    },
    passed: overrides?.passed ?? true,
    failures: [],
    warnings: [],
  };
}

function insertEvaluationResult(
  db: InstanceType<typeof Database>,
  result: ReturnType<typeof persistedResultFixture>,
): void {
  db.prepare(
    `INSERT INTO evaluation_results (
       id, corpus_id, match_run_ids_json, comparison_match_run_ids_json,
       metrics_json, result_json, passed, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    `evaluation-${result.metrics.corpusId}`,
    result.metrics.corpusId,
    JSON.stringify(result.metrics.matchRunIds),
    JSON.stringify(result.metrics.comparisonMatchRunIds),
    JSON.stringify(result.metrics),
    JSON.stringify(result),
    result.passed ? 1 : 0,
    100,
  );
}

describe('matching evaluation CLI', () => {
  let directory: string | undefined;

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it('freezes a corpus, loads independent persisted runs, and stores the result', async () => {
    directory = await mkdtemp(join(tmpdir(), 'pipe-evaluation-'));
    const databasePath = join(directory, 'evaluation.sqlite');
    const jsonPath = join(directory, 'result.json');
    const reportPath = join(directory, 'result.txt');
    const expertCorpusPath = writeExpertCorpusFixture(directory);
    const sqlite = new Database(databasePath);
    seedMatchRuns(sqlite);
    sqlite.close();

    const exitCode = await runEvaluationCli([
      '--local',
      '--database-path',
      databasePath,
      '--corpus-id',
      'expert-corpus-v1',
      '--corpus-file',
      expertCorpusPath,
      '--match-run-id',
      'run-primary',
      '--match-run-id',
      'run-primary-negative',
      '--comparison-run-id',
      'run-comparison',
      '--comparison-run-id',
      'run-comparison-negative',
      '--json',
      jsonPath,
      '--report',
      reportPath,
      '--persist',
    ]);

    expect(exitCode).toBe(0);
    expect(JSON.parse(await readFile(jsonPath, 'utf8'))).toMatchObject({
      passed: true,
      metrics: {
        matchRunIds: ['run-primary', 'run-primary-negative'],
        comparisonMatchRunIds: ['run-comparison', 'run-comparison-negative'],
        recallAt50: 1,
        precisionAt3: 1,
        ndcgAt5: 1,
        byteIdenticalRerun: true,
      },
    });
    expect(await readFile(reportPath, 'utf8')).toContain('RESULT: PASS');

    const verification = new Database(databasePath);
    expect(verification.prepare(
      'SELECT COUNT(*) AS count FROM evaluation_corpora',
    ).get()).toEqual({ count: 1 });
    expect(verification.prepare(
      'SELECT passed FROM evaluation_results',
    ).get()).toEqual({ passed: 1 });
    expect(() => verification.prepare(
      `UPDATE evaluation_corpora SET schema_version = 'changed'
        WHERE corpus_id = 'expert-corpus-v1'`,
    ).run()).toThrow('evaluation corpora are frozen');
    verification.close();
  });

  it('auto-selects same-or-earlier pair runs for determinism comparison', async () => {
    directory = await mkdtemp(join(tmpdir(), 'pipe-evaluation-'));
    const databasePath = join(directory, 'evaluation.sqlite');
    const jsonPath = join(directory, 'result.json');
    const reportPath = join(directory, 'result.txt');
    const expertCorpusPath = writeExpertCorpusFixture(directory);
    const sqlite = new Database(databasePath);
    seedMatchRuns(sqlite);
    sqlite.close();

    const exitCode = await runEvaluationCli([
      '--local',
      '--database-path',
      databasePath,
      '--corpus-id',
      'expert-corpus-v1',
      '--corpus-file',
      expertCorpusPath,
      '--auto-comparison-runs',
      '--json',
      jsonPath,
      '--report',
      reportPath,
    ]);

    expect(exitCode).toBe(0);
    const result = JSON.parse(await readFile(jsonPath, 'utf8'));
    expect(result).toMatchObject({
      passed: true,
      metrics: {
        matchRunIds: ['run-comparison', 'run-comparison-negative'],
        comparisonMatchRunIds: ['run-primary', 'run-primary-negative'],
        byteIdenticalRerun: true,
        comparisonCoverage: 1,
      },
    });
    expect(await readFile(reportPath, 'utf8')).toContain(
      'run-comparison vs run-primary => PASS',
    );
  });

  it('refuses to persist fixture-mode synthetic evaluations', async () => {
    await expect(runEvaluationCli([
      '--local',
      '--database-path',
      '/tmp/unused-pipe-evaluation.sqlite',
      '--corpus-id',
      'sample-corpus-v1',
      '--corpus-file',
      corpusFixture.pathname,
      '--persist',
      '--allow-synthetic',
    ])).rejects.toThrow(
      '--allow-synthetic cannot be combined with --persist',
    );
  });

  it('passes the latest persisted production readiness gate for expert evidence', async () => {
    directory = await mkdtemp(join(tmpdir(), 'pipe-evaluation-'));
    const databasePath = join(directory, 'evaluation.sqlite');
    const jsonPath = join(directory, 'readiness.json');
    const reportPath = join(directory, 'readiness.txt');
    const evaluationJsonPath = join(directory, 'evaluation.json');
    const evaluationReportPath = join(directory, 'evaluation.txt');
    const expertCorpusPath = writeExpertCorpusFixture(directory);
    const sqlite = new Database(databasePath);
    seedMatchRuns(sqlite);
    sqlite.close();

    expect(await runEvaluationCli([
      '--local',
      '--database-path',
      databasePath,
      '--corpus-id',
      'expert-corpus-v1',
      '--corpus-file',
      expertCorpusPath,
      '--match-run-id',
      'run-primary',
      '--match-run-id',
      'run-primary-negative',
      '--comparison-run-id',
      'run-comparison',
      '--comparison-run-id',
      'run-comparison-negative',
      '--json',
      evaluationJsonPath,
      '--report',
      evaluationReportPath,
      '--persist',
    ])).toBe(0);

    const exitCode = await runEvaluationCli([
      '--local',
      '--database-path',
      databasePath,
      '--corpus-id',
      'expert-corpus-v1',
      '--check-latest-production-pass',
      '--json',
      jsonPath,
      '--report',
      reportPath,
    ]);

    expect(exitCode).toBe(0);
    expect(JSON.parse(await readFile(jsonPath, 'utf8'))).toMatchObject({
      ready: true,
      corpusId: 'expert-corpus-v1',
      metrics: {
        expertLabelCount: 3,
        syntheticFixtureCount: 0,
        byteIdenticalRerun: true,
      },
    });
  });

  it('fails the readiness gate for historically persisted synthetic results', async () => {
    directory = await mkdtemp(join(tmpdir(), 'pipe-evaluation-'));
    const databasePath = join(directory, 'evaluation.sqlite');
    const jsonPath = join(directory, 'readiness.json');
    const reportPath = join(directory, 'readiness.txt');
    const sqlite = new Database(databasePath);
    seedMatchRuns(sqlite);
    insertEvaluationCorpus(sqlite, readFileSync(corpusFixture, 'utf8'));
    insertEvaluationResult(sqlite, persistedResultFixture({
      corpusId: 'sample-corpus-v1',
      expertLabelCount: 0,
      syntheticFixtureCount: 1,
    }));
    sqlite.close();

    const exitCode = await runEvaluationCli([
      '--local',
      '--database-path',
      databasePath,
      '--corpus-id',
      'sample-corpus-v1',
      '--check-latest-production-pass',
      '--json',
      jsonPath,
      '--report',
      reportPath,
    ]);

    expect(exitCode).toBe(1);
    const readiness = JSON.parse(await readFile(jsonPath, 'utf8'));
    expect(readiness.ready).toBe(false);
    expect(readiness.failures).toEqual(
      expect.arrayContaining([
        'production rollout requires at least one expert label',
        'production rollout requires zero synthetic fixture labels',
      ]),
    );
  });

  it('fails the readiness gate for expert-looking labels without reviewer source provenance', async () => {
    directory = await mkdtemp(join(tmpdir(), 'pipe-evaluation-'));
    const databasePath = join(directory, 'evaluation.sqlite');
    const jsonPath = join(directory, 'readiness.json');
    const sqlite = new Database(databasePath);
    seedMatchRuns(sqlite);
    const corpus = JSON.parse(expertCorpusJson()) as {
      expertLabels: Array<{ labelProvenance?: unknown }>;
    };
    corpus.expertLabels = corpus.expertLabels.map((label) => {
      const { labelProvenance: _labelProvenance, ...rest } = label;
      return rest;
    });
    insertEvaluationCorpus(sqlite, JSON.stringify(corpus));
    insertEvaluationResult(sqlite, persistedResultFixture());
    sqlite.close();

    const exitCode = await runEvaluationCli([
      '--local',
      '--database-path',
      databasePath,
      '--corpus-id',
      'expert-corpus-v1',
      '--check-latest-production-pass',
      '--json',
      jsonPath,
    ]);

    expect(exitCode).toBe(1);
    const readiness = JSON.parse(await readFile(jsonPath, 'utf8'));
    expect(readiness.ready).toBe(false);
    expect(readiness.failures).toContain(
      'expert label is missing reviewer/source provenance: expert-label-1',
    );
  });

  it('refuses direct API persistence when expert-label gate is disabled', async () => {
    directory = await mkdtemp(join(tmpdir(), 'pipe-evaluation-'));
    const databasePath = join(directory, 'evaluation.sqlite');
    const sqlite = new Database(databasePath);
    seedMatchRuns(sqlite);
    insertEvaluationCorpus(sqlite, expertCorpusJson());

    await expect(runEvaluation(createMockD1(sqlite), {
      corpusId: 'expert-corpus-v1',
      matchRunIds: ['run-primary'],
      comparisonMatchRunIds: ['run-comparison'],
      persistResult: true,
      thresholds: { requireExpertLabels: false },
    })).rejects.toThrow('Persisted evaluations must keep the expert-label gate enabled');
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM evaluation_results').get())
      .toEqual({ count: 0 });
    sqlite.close();
  });

  it('refuses direct API persistence for synthetic corpora', async () => {
    directory = await mkdtemp(join(tmpdir(), 'pipe-evaluation-'));
    const databasePath = join(directory, 'evaluation.sqlite');
    const sqlite = new Database(databasePath);
    seedMatchRuns(sqlite);
    insertEvaluationCorpus(sqlite, readFileSync(corpusFixture, 'utf8'));

    await expect(runEvaluation(createMockD1(sqlite), {
      corpusId: 'sample-corpus-v1',
      matchRunIds: ['run-primary'],
      comparisonMatchRunIds: ['run-comparison'],
      persistResult: true,
    })).rejects.toThrow('Persisted evaluations require a fully expert-labelled corpus');
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM evaluation_results').get())
      .toEqual({ count: 0 });
    sqlite.close();
  });

  it('refuses direct API persistence for labels without reviewer source provenance', async () => {
    directory = await mkdtemp(join(tmpdir(), 'pipe-evaluation-'));
    const databasePath = join(directory, 'evaluation.sqlite');
    const sqlite = new Database(databasePath);
    seedMatchRuns(sqlite);
    const corpus = JSON.parse(expertCorpusJson()) as {
      expertLabels: Array<{ labelProvenance?: unknown }>;
    };
    corpus.expertLabels = corpus.expertLabels.map((label) => {
      const { labelProvenance: _labelProvenance, ...rest } = label;
      return rest;
    });
    insertEvaluationCorpus(sqlite, JSON.stringify(corpus));

    await expect(runEvaluation(createMockD1(sqlite), {
      corpusId: 'expert-corpus-v1',
      matchRunIds: ['run-primary'],
      comparisonMatchRunIds: ['run-comparison'],
      persistResult: true,
    })).rejects.toThrow('Persisted evaluations require a fully expert-labelled corpus');
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM evaluation_results').get())
      .toEqual({ count: 0 });
    sqlite.close();
  });

  it('rejects synthetic labels when --allow-synthetic is omitted', async () => {
    directory = await mkdtemp(join(tmpdir(), 'pipe-evaluation-'));
    const databasePath = join(directory, 'evaluation.sqlite');
    const jsonPath = join(directory, 'result.json');
    const sqlite = new Database(databasePath);
    seedMatchRuns(sqlite);
    sqlite.close();

    const exitCode = await runEvaluationCli([
      '--local',
      '--database-path',
      databasePath,
      '--corpus-id',
      'sample-corpus-v1',
      '--corpus-file',
      corpusFixture.pathname,
      '--match-run-id',
      'run-primary',
      '--comparison-run-id',
      'run-comparison',
      '--json',
      jsonPath,
    ]);

    expect(exitCode).toBe(1);
    const result = JSON.parse(await readFile(jsonPath, 'utf8'));
    expect(result.passed).toBe(false);
    expect(result.failures).toContain(
      'Production evaluation requires a fully expert-labelled corpus',
    );
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('synthetic fixture')]),
    );
  });

  it('detects forbidden label guardrail violation', async () => {
    directory = await mkdtemp(join(tmpdir(), 'pipe-evaluation-'));
    const databasePath = join(directory, 'evaluation.sqlite');
    const jsonPath = join(directory, 'result.json');

    const forbiddenCorpus = {
      version: '1.0.0',
      corpusId: 'forbidden-corpus-v1',
      createdAt: '2026-06-14T00:00:00Z',
      description: 'Corpus with a forbidden label to test guardrail detection',
      candidateEvidence: [{
        candidateId: 'candidate-1',
        evidenceId: 'evidence-1',
        episodeId: 'episode-1',
        narrative: 'Implemented quantum-resistant cryptography',
        concepts: ['term:quantum-cryptography'],
        evidenceReferences: [sourceRef()],
      }],
      roleRequirements: [{
        roleId: 'role-1',
        requiredLanguages: ['typescript'],
        sourceReferences: [{
          entityId: 'role-1',
          locator: 'technical_context',
          conceptKeys: ['term:quantum-cryptography'],
          sourceRefType: 'source_span',
          sourceRefId: 'role-source-span-1',
          sourceSpanId: 'role-source-span-1',
          exactText: 'Role source for quantum cryptography.',
          contentHash: 'sha256:role-source-1',
        }],
      }],
      expertLabels: [{
        labelId: 'label-forbidden-1',
        candidateId: 'candidate-1',
        roleId: 'role-1',
        challengeId: 'challenge-1',
        relevanceGrade: 'forbidden',
        eligibleChallengeIds: [],
        guardrailViolations: ['forbidden_concept'],
        labelVersion: '1.0.0',
        labeledAt: '2026-06-14T00:00:00Z',
        labeledBy: 'expert-reviewer-1',
      }],
      metadata: {
        totalLabels: 1,
        totalCandidates: 1,
        totalRoles: 1,
        totalChallenges: 1,
        syntheticFixtureCount: 0,
      },
    };

    const corpusPath = join(directory, 'forbidden-corpus.json');
    writeFileSync(corpusPath, JSON.stringify(forbiddenCorpus));

    const sqlite = new Database(databasePath);
    seedMatchRuns(sqlite);
    sqlite.close();

    const exitCode = await runEvaluationCli([
      '--local',
      '--database-path',
      databasePath,
      '--corpus-id',
      'forbidden-corpus-v1',
      '--corpus-file',
      corpusPath,
      '--match-run-id',
      'run-primary',
      '--json',
      jsonPath,
    ]);

    expect(exitCode).toBe(1);
    const result = JSON.parse(await readFile(jsonPath, 'utf8'));
    expect(result.passed).toBe(false);
    expect(result.metrics.guardrailViolationCount).toBeGreaterThan(0);
    const forbiddenLabel = result.metrics.labelResults.find(
      (label: Record<string, unknown>) => label.labelId === 'label-forbidden-1',
    );
    expect(forbiddenLabel).toBeDefined();
    expect(forbiddenLabel.passed).toBe(false);
    expect(forbiddenLabel.failureReason).toContain('expert-forbidden');
    expect(forbiddenLabel.guardrailViolations).toContain('forbidden_concept');
  });

  it('detects missing provenance in ranked results', async () => {
    directory = await mkdtemp(join(tmpdir(), 'pipe-evaluation-'));
    const databasePath = join(directory, 'evaluation.sqlite');
    const jsonPath = join(directory, 'result.json');
    const reportPath = join(directory, 'result.txt');

    const sqlite = new Database(databasePath);
    sqlite.exec(`
      CREATE TABLE match_runs (
        id TEXT PRIMARY KEY,
        candidate_id TEXT NOT NULL,
        role_context_id TEXT,
        candidate_snapshot_id TEXT NOT NULL,
        role_snapshot_id TEXT NOT NULL,
        policy_version TEXT NOT NULL,
        model_version TEXT,
        status TEXT NOT NULL,
        ranked_results_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
    sqlite.exec(evaluationMigration);

    const noProvenanceResults = rankedResults({
      provenanceComplete: false,
      alignments: [{
        atomId: 'atom-1',
        demandId: 'demand-1',
        pairScore: 0.95,
        stretch: null,
        sharedConcepts: ['term:quantum-cryptography'],
        roleSourceRefs: [],
        candidateSourceRefs: [],
        challengeSourceRefs: [],
      }],
    });
    sqlite.prepare(
      `INSERT INTO match_runs (
         id, candidate_id, role_context_id, candidate_snapshot_id,
         role_snapshot_id, policy_version, model_version, status,
         ranked_results_json, created_at
       ) VALUES (?, 'candidate-1', 'role-1', 'candidate-snapshot-1',
                 'role-snapshot-1', 'candidate-pr-v1', NULL, 'MATCHED', ?, ?)`,
    ).run('run-no-provenance', noProvenanceResults, 1);
    sqlite.close();

    const exitCode = await runEvaluationCli([
      '--local',
      '--database-path',
      databasePath,
      '--corpus-id',
      'sample-corpus-v1',
      '--corpus-file',
      corpusFixture.pathname,
      '--match-run-id',
      'run-no-provenance',
      '--json',
      jsonPath,
      '--report',
      reportPath,
      '--allow-synthetic',
    ]);

    expect(exitCode).toBe(1);
    const result = JSON.parse(await readFile(jsonPath, 'utf8'));
    expect(result.passed).toBe(false);
    expect(result.metrics.missingProvenanceCount).toBeGreaterThan(0);
    expect(result.failures).toEqual(
      expect.arrayContaining([expect.stringContaining('Missing provenance')]),
    );
    expect(await readFile(reportPath, 'utf8')).toContain(
      'drift: missing comparison run for primary top challenge-1 repo-1#42',
    );
  });

  it('passes the readiness gate at shadow stage even with incomplete coverage', async () => {
    directory = await mkdtemp(join(tmpdir(), 'pipe-evaluation-'));
    const databasePath = join(directory, 'evaluation.sqlite');
    const jsonPath = join(directory, 'readiness.json');
    const sqlite = new Database(databasePath);
    seedMatchRuns(sqlite);
    insertEvaluationCorpus(sqlite, readFileSync(corpusFixture, 'utf8'));
    // Insert a result with zero packet coverage and synthetic labels — would fail
    // production stage but should pass shadow stage.
    insertEvaluationResult(sqlite, persistedResultFixture({
      corpusId: 'sample-corpus-v1',
      expertLabelCount: 0,
      syntheticFixtureCount: 1,
      expectedPacketCount: 0,
      packetCoverage: 0,
      pairCoverage: 0,
      comparisonCoverage: 0,
      passed: true,
      requireExpertLabels: false,
    }));
    sqlite.close();

    const exitCode = await runEvaluationCli([
      '--local',
      '--database-path',
      databasePath,
      '--corpus-id',
      'sample-corpus-v1',
      '--check-latest-production-pass',
      '--stage',
      'shadow',
      '--json',
      jsonPath,
    ]);

    expect(exitCode).toBe(0);
    const readiness = JSON.parse(await readFile(jsonPath, 'utf8'));
    expect(readiness.ready).toBe(true);
    expect(readiness.stage).toBe('shadow');
  });

  it('fails the readiness gate at canary stage when packet coverage is missing', async () => {
    directory = await mkdtemp(join(tmpdir(), 'pipe-evaluation-'));
    const databasePath = join(directory, 'evaluation.sqlite');
    const jsonPath = join(directory, 'readiness.json');
    const sqlite = new Database(databasePath);
    seedMatchRuns(sqlite);
    insertEvaluationCorpus(sqlite, expertCorpusJson());
    insertEvaluationResult(sqlite, persistedResultFixture({
      expectedPacketCount: 0,
      packetCoverage: 0,
    }));
    sqlite.close();

    const exitCode = await runEvaluationCli([
      '--local',
      '--database-path',
      databasePath,
      '--corpus-id',
      'expert-corpus-v1',
      '--check-latest-production-pass',
      '--stage',
      'canary',
      '--json',
      jsonPath,
    ]);

    expect(exitCode).toBe(1);
    const readiness = JSON.parse(await readFile(jsonPath, 'utf8'));
    expect(readiness.ready).toBe(false);
    expect(readiness.stage).toBe('canary');
    expect(readiness.failures).toEqual(
      expect.arrayContaining([
        expect.stringContaining('corpus declares no expected packets'),
      ]),
    );
  });

  it('rejects an invalid --stage value', () => {
    expect(() => parseEvaluationArgs([
      '--corpus-id', 'test',
      '--stage', 'invalid',
    ])).toThrow('--stage must be one of');
  });

  it('parses a remote app-dev database id for evaluation readiness checks', () => {
    expect(parseEvaluationArgs([
      '--remote',
      '--database-id',
      'app-dev-d1',
      '--corpus-id',
      'expert-corpus-v1',
      '--check-latest-production-pass',
    ])).toEqual(expect.objectContaining({
      target: 'remote',
      databaseId: 'app-dev-d1',
      corpusId: 'expert-corpus-v1',
      checkLatestProductionPass: true,
    }));
  });

  it('rejects remote database ids in local evaluation mode', () => {
    expect(() => parseEvaluationArgs([
      '--database-id',
      'app-dev-d1',
      '--corpus-id',
      'expert-corpus-v1',
    ])).toThrow('--database-id requires --remote');
  });

  it('rejects combining explicit and automatic comparison runs', () => {
    expect(() => parseEvaluationArgs([
      '--corpus-id', 'test',
      '--comparison-run-id', 'run-1',
      '--auto-comparison-runs',
    ])).toThrow('--auto-comparison-runs cannot be combined with --comparison-run-id');
  });
});
