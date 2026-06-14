import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runEvaluationCli } from '../../../../../scripts/evaluateMatching';

interface SqliteStatement {
  run(...bindings: unknown[]): { changes: number | bigint };
  get(...bindings: unknown[]): unknown;
}

interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => SqliteDatabase;
};
const evaluationMigration = readFileSync(
  new URL('../../../../../migrations/0093_matching_evaluation.sql', import.meta.url),
  'utf8',
);
const corpusFixture = new URL(
  '../../../../../fixtures/evaluation/sample-corpus.json',
  import.meta.url,
);

function rankedResults(): string {
  const sourceRef = {
    artifactId: 'artifact-1',
    artifactVersion: 'version-1',
    contentHash: 'sha256:abc123',
    startOffset: 0,
    endOffset: 10,
  };
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
      candidateSourceRefs: [sourceRef],
      challengeSourceRefs: [{
        ...sourceRef,
        artifactId: 'repo-artifact-1',
        artifactVersion: 'commit-abc',
      }],
    }],
    rejectionReasons: [],
  }]);
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
    const sqlite = new DatabaseSync(databasePath);
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
    const insert = sqlite.prepare(
      `INSERT INTO match_runs (
         id, candidate_id, role_context_id, candidate_snapshot_id,
         role_snapshot_id, policy_version, model_version, status,
         ranked_results_json, created_at
       ) VALUES (?, 'candidate-1', 'role-1', 'candidate-snapshot-1',
                 'role-snapshot-1', 'candidate-pr-v1', NULL, 'MATCHED', ?, ?)`,
    );
    insert.run('run-primary', rankedResults(), 1);
    insert.run('run-comparison', rankedResults(), 2);
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

    const verification = new DatabaseSync(databasePath);
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
});
