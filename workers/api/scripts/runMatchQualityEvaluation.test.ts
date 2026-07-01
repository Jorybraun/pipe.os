import { describe, expect, it } from 'vitest';
import {
  matchQualityCasesFromEvaluationCorpus,
  parseMatchQualityCorpusJson,
} from './runMatchQualityEvaluation';
import type { EvaluationCorpus } from '../src/lib/challengeMatching/evaluation';

function evaluationCorpus(): EvaluationCorpus {
  return {
    version: '1.0.0',
    corpusId: 'stored-eval-corpus',
    createdAt: '2026-07-01T00:00:00.000Z',
    description: 'Stored corpus fixture',
    candidateEvidence: [{
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
    }],
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
        eligibleChallengeIds: ['packet-973'],
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
        eligibleChallengeIds: ['packet-973'],
        labelVersion: '1.0.0',
        labeledAt: '2026-07-01T00:00:00.000Z',
        labeledBy: 'expert-reviewer',
      },
    ],
    expectedPackets: [{
      challengeId: 'packet-973',
      repoId: 'mui/base-ui',
      prNumber: 973,
      sourceVersion: 'test',
    }],
    metadata: {
      totalLabels: 2,
      totalCandidates: 1,
      totalRoles: 1,
      totalChallenges: 2,
      syntheticFixtureCount: 0,
      totalExpectedPackets: 1,
    },
  };
}

describe('runMatchQualityEvaluation corpus loading', () => {
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
    ]);
  });

  it('parses frozen evaluation corpus JSON through validation before adapting', () => {
    const corpus = parseMatchQualityCorpusJson(JSON.stringify(evaluationCorpus()));

    expect(corpus.cases.map((testCase) => testCase.caseId)).toEqual([
      'label-positive',
      'label-negative',
    ]);
  });
});
