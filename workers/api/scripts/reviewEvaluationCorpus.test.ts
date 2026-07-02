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
import { buildCorpusReviewPacket, loadCorpus, type EvaluationCorpus } from '../src/lib/challengeMatching/evaluation';

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
    labels: template.labels.map((label) => ({
      ...label,
      explanation:
        'Human reviewer confirmed the candidate evidence, role requirement, '
        + 'and selected source-backed challenge are appropriate for this CODE_REVIEW gate.',
    })),
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
      items: Array<{ labelId: string; reviewQuestions: string[] }>;
    };
    expect(packet.corpusId).toBe('sample-corpus-v1');
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
      nextAction: 'complete_expert_review',
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

  it('applies a completed expert review and writes a production-ready corpus', async () => {
    directory = await mkdtemp(join(tmpdir(), 'pipe-corpus-review-'));
    const reviewFilePath = join(directory, 'review.json');
    const reviewedCorpusPath = join(directory, 'reviewed-corpus.json');
    const summaryPath = join(directory, 'summary.json');
    const template = buildExpertReviewTemplate(buildCorpusReviewPacket(loadFixtureCorpus()));
    writeFileSync(reviewFilePath, JSON.stringify(completedReview(template), null, 2));

    const exitCode = await runCorpusReviewCli([
      '--source-corpus-file',
      corpusFixture.pathname,
      '--review-file',
      reviewFilePath,
      '--reviewed-corpus',
      reviewedCorpusPath,
      '--json',
      summaryPath,
    ]);

    expect(exitCode).toBe(0);
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
      productionReady: true,
      nextAction: 'run_evaluation',
    }));
  });

  it('idempotently persists a completed review to a local frozen corpus database', async () => {
    directory = await mkdtemp(join(tmpdir(), 'pipe-corpus-review-'));
    const databasePath = join(directory, 'evaluation.sqlite');
    const reviewFilePath = join(directory, 'review.json');
    const firstSummaryPath = join(directory, 'summary-first.json');
    const secondSummaryPath = join(directory, 'summary-second.json');
    const sqlite = new Database(databasePath);
    sqlite.exec(evaluationMigration);
    insertCorpus(sqlite, readFileSync(corpusFixture, 'utf8'));
    sqlite.close();

    const template = buildExpertReviewTemplate(buildCorpusReviewPacket(loadFixtureCorpus()));
    writeFileSync(reviewFilePath, JSON.stringify(completedReview(template), null, 2));

    const firstExit = await runCorpusReviewCli([
      '--database-path',
      databasePath,
      '--source-corpus-id',
      'sample-corpus-v1',
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
      'sample-corpus-v1',
      '--review-file',
      reviewFilePath,
      '--persist',
      '--json',
      secondSummaryPath,
    ]);

    expect(firstExit).toBe(0);
    expect(secondExit).toBe(0);
    expect(JSON.parse(await readFile(firstSummaryPath, 'utf8'))).toEqual(expect.objectContaining({
      persisted: true,
      expertLabelCount: 1,
      syntheticFixtureCount: 0,
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
        corpus_id: 'sample-corpus-v1',
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
