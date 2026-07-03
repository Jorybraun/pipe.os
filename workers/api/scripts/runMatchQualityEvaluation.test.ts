import { describe, expect, it } from 'vitest';
import {
  assertStoredCorpusCanRunMatchQualityGate,
  matchQualityCasesFromEvaluationCorpus,
  parseOptions,
  parseMatchQualityCorpusJson,
  resolveLatestExpertCorpusId,
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
    });
    expect(() => validateOptions(options)).not.toThrow();
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
});
