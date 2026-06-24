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

const evaluationMigration = readFileSync(
  new URL('../../../../../migrations/0093_matching_evaluation.sql', import.meta.url),
  'utf8',
);
const corpusFixture = new URL(
  '../../../../../fixtures/evaluation/sample-corpus.json',
  import.meta.url,
);

function expertCorpusJson(): string {
  const corpus = JSON.parse(readFileSync(corpusFixture, 'utf8')) as {
    corpusId: string;
    description: string;
    expertLabels: Array<{ labelId: string; labeledBy: string; challengeId: string }>;
    metadata: { syntheticFixtureCount: number; totalExpectedPackets?: number };
    expectedPackets?: unknown[];
  };
  corpus.corpusId = 'expert-corpus-v1';
  corpus.description = 'Test-only corpus with non-synthetic labels for persisted evaluation coverage';
  corpus.expertLabels = corpus.expertLabels.map((label, index) => ({
    ...label,
    labelId: `expert-label-${index + 1}`,
    labeledBy: 'expert-reviewer-1',
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
  corpus.metadata.syntheticFixtureCount = 0;
  // Declare expected packets matching the seeded match runs so the production
  // rollout gate's packet coverage requirement is satisfied.
  corpus.expectedPackets = [{
    challengeId: 'challenge-1',
    repoId: 'repo-1',
    prNumber: 42,
    sourceVersion: 'commit-abc',
  }];
  corpus.metadata.totalExpectedPackets = 1;
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
  return JSON.stringify([{
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
  }]);
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
     ) VALUES (?, 'candidate-1', 'role-1', 'candidate-snapshot-1',
               'role-snapshot-1', 'candidate-pr-v1', NULL, 'MATCHED', ?, ?)`,
  );
  insert.run('run-primary', rankedResults(), 1);
  insert.run('run-comparison', rankedResults(), 2);
}

function insertEvaluationCorpus(
  db: InstanceType<typeof Database>,
  corpusJson: string,
): void {
  const corpus = JSON.parse(corpusJson) as {
    corpusId: string;
    version: string;
    createdAt: string;
    expertLabels: Array<{ labeledBy: string }>;
  };
  const syntheticFixtureCount = corpus.expertLabels.filter(
    (label) => label.labeledBy === 'synthetic-fixture',
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
    corpus.expertLabels.length - syntheticFixtureCount,
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
    matchRunIds: ['run-primary'],
    comparisonMatchRunIds: ['run-comparison'],
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
    totalEvaluations: 1,
    evaluatedPairCount: 1,
    highlyRelevantInTop3: 1,
    relevantInTop3: 0,
    irrelevantInTop3: 0,
    forbiddenInResults: 0,
    syntheticFixtureCount: overrides?.syntheticFixtureCount ?? 0,
    expertLabelCount: overrides?.expertLabelCount ?? 1,
    labelResults: [],
    expectedPacketCount: overrides?.expectedPacketCount ?? 1,
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
      '--comparison-run-id',
      'run-comparison',
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
      '--comparison-run-id',
      'run-comparison',
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
        expertLabelCount: 1,
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
    })).rejects.toThrow('Production corpus validation failed');
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
      '--allow-synthetic',
    ]);

    expect(exitCode).toBe(1);
    const result = JSON.parse(await readFile(jsonPath, 'utf8'));
    expect(result.passed).toBe(false);
    expect(result.metrics.missingProvenanceCount).toBeGreaterThan(0);
    expect(result.failures).toEqual(
      expect.arrayContaining([expect.stringContaining('Missing provenance')]),
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
});
