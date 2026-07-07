import { describe, expect, it } from 'vitest';
import {
  assertStoredCorpusCanRunMatchQualityGate,
  matchQualityCasesFromEvaluationCorpus,
  parseOptions,
  parseMatchQualityCorpusJson,
  resolveLatestExpertCorpusId,
  resolveRemoteDatabaseId,
  summarizeMatchQualityResult,
  validateOptions,
} from './runMatchQualityEvaluation';
import type { EvaluationCorpus } from '../src/lib/challengeMatching/evaluation';
import type { D1Database } from '@cloudflare/workers-types';

function evaluationCorpus(): EvaluationCorpus {
  return {
    version: '1.0.0',
    corpusId: 'stored-eval-corpus',
    createdAt: '2026-07-01T00:00:00.000Z',
    description: 'Stored corpus fixture',
    candidateEvidence: [
      {
        candidateId: 'candidate-fit',
        evidenceId: 'evidence-1',
        episodeId: 'episode-1',
        narrative: 'Reviewed TypeScript retry logic with test coverage.',
        concepts: ['term:typescript', 'term:retry-handling'],
        evidenceReferences: [{
          artifactId: 'artifact-1',
          artifactVersion: 'artifact-version-1',
          contentHash: 'sha256:evidence',
          sourceRefType: 'source_span',
          sourceRefId: 'span-1',
          sourceSpanId: 'span-1',
          exactText: 'Reviewed TypeScript retry logic with test coverage.',
          startOffset: 0,
          endOffset: 51,
        }],
      },
      {
        candidateId: 'candidate-negative',
        evidenceId: 'evidence-2',
        episodeId: 'episode-2',
        narrative: 'Reviewed Python data pipeline operations.',
        concepts: ['term:python', 'term:data-pipeline'],
        evidenceReferences: [{
          artifactId: 'artifact-2',
          artifactVersion: 'artifact-version-2',
          contentHash: 'sha256:evidence-negative',
          sourceRefType: 'source_span',
          sourceRefId: 'span-2',
          sourceSpanId: 'span-2',
          exactText: 'Reviewed Python data pipeline operations.',
          startOffset: 0,
          endOffset: 41,
        }],
      },
    ],
    roleRequirements: [{
      roleId: 'role-frontend',
      requiredLanguages: ['typescript'],
      relevantConcepts: ['term:retry-handling'],
      sourceReferences: [{
        entityId: 'role-frontend',
        locator: 'jd:1',
        conceptKeys: ['term:retry-handling'],
        sourceRefType: 'source_span',
        sourceRefId: 'role-span-1',
        sourceSpanId: 'role-span-1',
        exactText: 'Needs retry handling review experience.',
        contentHash: 'sha256:role',
      }],
    }],
    expertLabels: [
      {
        labelId: 'label-positive',
        candidateId: 'candidate-fit',
        roleId: 'role-frontend',
        challengeId: 'packet-973',
        relevanceGrade: 'highly_relevant',
        eligibleChallengeIds: ['packet-973', 'packet-adjacent'],
        negativeCandidateId: 'candidate-negative',
        minimumScoreSeparation: 0.12,
        labelVersion: '1.0.0',
        labeledAt: '2026-07-01T00:00:00.000Z',
        labeledBy: 'expert-reviewer',
        explanation: 'Candidate evidence aligns with retry review demands.',
      },
      {
        labelId: 'label-negative',
        candidateId: 'candidate-fit',
        roleId: 'role-frontend',
        challengeId: 'packet-unrelated',
        relevanceGrade: 'irrelevant',
        eligibleChallengeIds: ['packet-973', 'packet-adjacent'],
        labelVersion: '1.0.0',
        labeledAt: '2026-07-01T00:00:00.000Z',
        labeledBy: 'expert-reviewer',
      },
      {
        labelId: 'label-borderline',
        candidateId: 'candidate-fit',
        roleId: 'role-frontend',
        challengeId: 'packet-adjacent',
        relevanceGrade: 'borderline',
        eligibleChallengeIds: ['packet-973', 'packet-adjacent'],
        labelVersion: '1.0.0',
        labeledAt: '2026-07-01T00:00:00.000Z',
        labeledBy: 'expert-reviewer',
        explanation: 'Candidate is adjacent but the challenge should be more specific.',
      },
    ],
    expectedPackets: [{
      challengeId: 'packet-973',
      repoId: 'mui/base-ui',
      prNumber: 973,
      sourceVersion: 'test',
    }],
    metadata: {
      totalLabels: 3,
      totalCandidates: 2,
      totalRoles: 1,
      totalChallenges: 3,
      syntheticFixtureCount: 0,
      totalExpectedPackets: 1,
    },
  };
}

function fakeEvaluationCorpusDb(rows: Array<{
  corpus_id: string;
  expert_label_count: number;
  synthetic_fixture_count: number;
  created_at: number;
}>): D1Database {
  return {
    prepare(sql: string) {
      return {
        all: async () => {
          const source = sql.includes('expert_label_count > 0')
            ? rows.filter((row) => row.expert_label_count > 0 && row.synthetic_fixture_count === 0)
            : rows;
          return {
            success: true,
            results: [...source].sort((left, right) =>
              right.created_at - left.created_at || right.corpus_id.localeCompare(left.corpus_id),
            ).slice(0, 1),
          };
        },
      };
    },
  } as unknown as D1Database;
}

describe('runMatchQualityEvaluation corpus loading', () => {
  it('parses remote app-dev D1 options for stored corpus evaluation', () => {
    const options = parseOptions([
      '--remote',
      '--database-id',
      'app-dev-db-id',
      '--corpus-id',
      'reviewed-code-review-corpus',
      '--require-pass',
      '--json',
    ]);

    expect(options).toEqual({
      databasePath: undefined,
      databaseId: 'app-dev-db-id',
      corpusFile: undefined,
      corpusId: 'reviewed-code-review-corpus',
      latestExpertCorpus: false,
      remote: true,
      requirePass: true,
      allowDraftCorpus: false,
      json: true,
      summaryJson: false,
    });
    expect(() => validateOptions(options)).not.toThrow();
  });

  it('parses compact summary JSON output for readiness artifacts', () => {
    const options = parseOptions([
      '--remote',
      '--database-id',
      'app-dev-db-id',
      '--latest-expert-corpus',
      '--require-pass',
      '--summary-json',
    ]);

    expect(options).toEqual(expect.objectContaining({
      latestExpertCorpus: true,
      requirePass: true,
      json: false,
      summaryJson: true,
    }));
    expect(() => validateOptions(options)).not.toThrow();
  });

  it('rejects ambiguous JSON output modes', () => {
    const options = parseOptions([
      '--remote',
      '--database-id',
      'app-dev-db-id',
      '--latest-expert-corpus',
      '--json',
      '--summary-json',
    ]);

    expect(() => validateOptions(options)).toThrow('pass only one output mode: --json or --summary-json');
  });

  it('prefers the dedicated matching-evaluation D1 over the generic app D1', () => {
    expect(resolveRemoteDatabaseId(undefined, {
      MATCHING_EVALUATION_D1_DATABASE_ID: 'eval-db-id',
      CLOUDFLARE_D1_DATABASE_ID: 'app-db-id',
    })).toBe('eval-db-id');
  });

  it('lets explicit database id override remote D1 env defaults', () => {
    expect(resolveRemoteDatabaseId('explicit-db-id', {
      MATCHING_EVALUATION_D1_DATABASE_ID: 'eval-db-id',
      CLOUDFLARE_D1_DATABASE_ID: 'app-db-id',
    })).toBe('explicit-db-id');
  });

  it('rejects ambiguous local and remote database options', () => {
    const options = parseOptions([
      '--remote',
      '--database-path',
      './local.sqlite',
      '--corpus-id',
      'corpus-1',
    ]);

    expect(() => validateOptions(options)).toThrow('pass only one of --remote or --database-path');
  });

  it('requires a corpus source for remote match-quality evaluation', () => {
    const options = parseOptions([
      '--remote',
      '--database-id=app-dev-db-id',
    ]);

    expect(() => validateOptions(options)).toThrow('--corpus-file, --corpus-id, or --latest-expert-corpus is required');
  });

  it('parses latest expert corpus auto-selection', () => {
    const options = parseOptions([
      '--remote',
      '--database-id=app-dev-db-id',
      '--latest-expert-corpus',
      '--require-pass',
    ]);

    expect(options).toEqual(expect.objectContaining({
      latestExpertCorpus: true,
      corpusId: undefined,
      corpusFile: undefined,
      requirePass: true,
    }));
    expect(() => validateOptions(options)).not.toThrow();
  });

  it('rejects ambiguous latest expert corpus sources', () => {
    const options = parseOptions([
      '--remote',
      '--database-id=app-dev-db-id',
      '--latest-expert-corpus',
      '--corpus-id',
      'explicit-corpus',
    ]);

    expect(() => validateOptions(options)).toThrow('pass only one corpus source');
  });

  it('rejects stored draft corpora before running the production match-quality gate', () => {
    expect(() => assertStoredCorpusCanRunMatchQualityGate({
      corpusId: 'draft-corpus',
      expertLabelCount: 0,
      syntheticFixtureCount: 0,
      allowDraftCorpus: false,
    })).toThrow('draft-corpus has 0 expert labels');
  });

  it('rejects stored synthetic corpora before running the production match-quality gate', () => {
    expect(() => assertStoredCorpusCanRunMatchQualityGate({
      corpusId: 'synthetic-corpus',
      expertLabelCount: 3,
      syntheticFixtureCount: 1,
      allowDraftCorpus: false,
    })).toThrow('synthetic-corpus has 1 synthetic fixture labels');
  });

  it('rejects expert-labelled corpora that still fail production-readiness checks', () => {
    expect(() => assertStoredCorpusCanRunMatchQualityGate({
      corpusId: 'expert-one-packet-corpus',
      expertLabelCount: 3,
      syntheticFixtureCount: 0,
      allowDraftCorpus: false,
      productionReadinessFailures: [
        'production corpus requires at least two source-backed expected PR challenge packets',
      ],
    })).toThrow(
      'expert-one-packet-corpus is not production-ready for the match-quality gate: production corpus requires at least two source-backed expected PR challenge packets',
    );
  });

  it('requires draft corpus inspection to stay out of require-pass gates', () => {
    const options = parseOptions([
      '--remote',
      '--database-id=app-dev-db-id',
      '--corpus-id',
      'draft-corpus',
      '--allow-draft-corpus',
      '--require-pass',
    ]);

    expect(options.allowDraftCorpus).toBe(true);
    expect(() => validateOptions(options)).toThrow('--allow-draft-corpus cannot be combined with --require-pass');
  });

  it('resolves the latest expert-labelled stored corpus', async () => {
    await expect(resolveLatestExpertCorpusId(fakeEvaluationCorpusDb([
      {
        corpus_id: 'draft-newer',
        expert_label_count: 0,
        synthetic_fixture_count: 0,
        created_at: 300,
      },
      {
        corpus_id: 'expert-older',
        expert_label_count: 3,
        synthetic_fixture_count: 0,
        created_at: 200,
      },
      {
        corpus_id: 'synthetic-newest',
        expert_label_count: 3,
        synthetic_fixture_count: 1,
        created_at: 400,
      },
    ]))).resolves.toBe('expert-older');
  });

  it('reports the latest draft when no expert-labelled stored corpus exists', async () => {
    await expect(resolveLatestExpertCorpusId(fakeEvaluationCorpusDb([{
      corpus_id: 'draft-only',
      expert_label_count: 0,
      synthetic_fixture_count: 0,
      created_at: 300,
    }]))).rejects.toThrow('No expert-labelled CODE_REVIEW match-quality corpus found; latest frozen corpus draft-only has 0 expert labels and 0 synthetic fixture labels.');
  });

  it('keeps compact match-quality corpus files unchanged', () => {
    const corpus = parseMatchQualityCorpusJson(JSON.stringify({
      corpusId: 'compact-corpus',
      cases: [{
        candidateId: 'candidate-1',
        challengePacketId: 'packet-1',
        expectedVerdict: 'strong_match',
      }],
      thresholds: {
        minAccuracy: 1,
      },
    }));

    expect(corpus).toEqual(expect.objectContaining({
      corpusId: 'compact-corpus',
      thresholds: expect.objectContaining({ minAccuracy: 1 }),
    }));
    expect(corpus.cases).toEqual([
      expect.objectContaining({
        candidateId: 'candidate-1',
        challengePacketId: 'packet-1',
        expectedVerdict: 'strong_match',
      }),
    ]);
  });

  it('adapts frozen evaluation corpora into compact match-quality cases', () => {
    const corpus = matchQualityCasesFromEvaluationCorpus(evaluationCorpus());

    expect(corpus.corpusId).toBe('stored-eval-corpus');
    expect(corpus.cases).toEqual([
      expect.objectContaining({
        caseId: 'label-positive',
        candidateId: 'candidate-fit',
        challengePacketId: 'packet-973',
        expectedVerdict: 'strong_match',
        expectedReasonCategory: 'aligned',
        negativeCandidateId: 'candidate-negative',
        minimumScoreSeparation: 0.12,
        requireCandidateEvidence: true,
        requireRepoEvidence: true,
        requireSourceBackedPr: true,
      }),
      expect.objectContaining({
        caseId: 'label-negative',
        challengePacketId: 'packet-unrelated',
        expectedVerdict: 'insufficient_evidence',
        expectedReasonCategory: 'insufficient_evidence',
        requireCandidateEvidence: false,
      }),
      expect.objectContaining({
        caseId: 'label-borderline',
        challengePacketId: 'packet-adjacent',
        expectedVerdict: 'needs_review',
        expectedReasonCategory: 'needs_challenge_design',
        requireCandidateEvidence: false,
      }),
    ]);
  });

  it('parses frozen evaluation corpus JSON through validation before adapting', () => {
    const corpus = parseMatchQualityCorpusJson(JSON.stringify(evaluationCorpus()));

    expect(corpus.cases.map((testCase) => testCase.caseId)).toEqual([
      'label-positive',
      'label-negative',
      'label-borderline',
    ]);
  });

  it('summarizes match-quality results without nested evidence reports', () => {
    const summary = summarizeMatchQualityResult({
      batchId: 'batch-1',
      corpusId: 'corpus-1',
      passed: true,
      thresholds: {
        minAccuracy: 0.9,
        maxFalsePositiveCount: 0,
        maxFalseNegativeCount: 0,
        minAverageScoreSeparation: 0.08,
        minUsableChallengeRate: 0.95,
        minNegativeCaseCount: 1,
        minInsufficientEvidenceCaseCount: 1,
        minContrastCaseCount: 1,
        minReasonCategoryExpectationCount: 1,
      },
      gateFailures: [],
      metrics: {
        totalPairs: 1,
        successfulPairs: 1,
        failedPairs: 0,
        negativeCaseCount: 0,
        insufficientEvidenceCaseCount: 0,
        contrastCaseCount: 1,
        reasonCategoryExpectationCount: 1,
        verdictAccuracy: 1,
        falsePositiveCount: 0,
        falseNegativeCount: 0,
        averageConfidence: 0.91,
        averageScoreSeparation: 0.22,
        usableChallengeRate: 1,
        verdictDistribution: {
          strong_match: 1,
          likely_match: 0,
          needs_review: 0,
          weak_match: 0,
          insufficient_evidence: 0,
        },
        evaluatedAt: '2026-07-03T00:00:00.000Z',
      },
      failedCases: [],
      pairResults: [{
        caseId: 'case-1',
        candidateId: 'candidate-1',
        challengePacketId: 'packet-1',
        negativeCandidateId: 'candidate-2',
        confidenceReport: null,
        unifiedReport: null,
        compactReport: null,
        computedVerdict: 'strong_match',
        expectedVerdict: 'strong_match',
        verdictMatch: true,
        reasonCategory: 'aligned',
        scoreSeparation: 0.22,
        minimumScoreSeparation: 0.1,
        sourceBackedPr: true,
        candidateEvidencePresent: true,
        repoEvidencePresent: true,
        usableChallenge: true,
        failedReasons: [],
        error: null,
        durationMs: 12,
      }],
    });

    expect(summary).toEqual(expect.objectContaining({
      corpusId: 'corpus-1',
      passed: true,
      caseResults: [expect.objectContaining({
        caseId: 'case-1',
        sourceBackedPr: true,
        candidateEvidencePresent: true,
        repoEvidencePresent: true,
      })],
    }));
    expect(JSON.stringify(summary)).not.toContain('confidenceReport');
    expect(JSON.stringify(summary)).not.toContain('compactReport');
    expect(JSON.stringify(summary)).not.toContain('unifiedReport');
  });
});
