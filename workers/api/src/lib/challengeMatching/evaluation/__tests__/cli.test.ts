import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { runEvaluationCli } from '../../../../../scripts/evaluateMatching';
const evaluationMigration = readFileSync(
  new URL('../../../../../migrations/0093_matching_evaluation.sql', import.meta.url),
  'utf8',
);
const corpusFixture = new URL(
  '../../../../../fixtures/evaluation/sample-corpus.json',
  import.meta.url,
);

function sourceRef(overrides?: Partial<Record<string, unknown>>) {
  return {
    artifactId: 'artifact-1',
    artifactVersion: 'version-1',
    contentHash: 'sha256:abc123',
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
      '--report',
      reportPath,
      '--persist',
      '--allow-synthetic',
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
        WHERE corpus_id = 'sample-corpus-v1'`,
    ).run()).toThrow('evaluation corpora are frozen');
    verification.close();
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
    const { writeFileSync } = await import('node:fs');
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
});
