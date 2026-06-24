/**
 * Tests for the evaluation harness.
 *
 * These tests verify that the evaluation system can handle previously unseen
 * semantic concepts without hard-coded taxonomies, per ADR-043.
 */

import { describe, it, expect } from 'vitest';
import {
  loadCorpus,
  getLabelsForCandidateRole,
  getCandidateEvidence,
  getRoleRequirements,
  getAllChallengeIds,
  CorpusValidationError,
} from '../corpus';
import {
  evaluateMatchRuns,
  computeMatchRunFingerprint,
  verifyByteIdenticalRerun,
  checkAcceptanceThresholds,
} from '../metrics';
import {
  EVALUATION_CORPUS_VERSION,
  type EvaluationCorpus,
  type ExpertLabel,
  type RelevanceGrade,
  type PersistedMatchRun,
  type PersistedRankedChallenge,
  type RoleRequirements,
  DEFAULT_ACCEPTANCE_THRESHOLDS,
} from '../types';

function sourceRef(id: string, overrides: Record<string, unknown> = {}) {
  return {
    artifactId: `artifact-${id}`,
    artifactVersion: `version-${id}`,
    contentHash: `sha256:${id}`,
    sourceRefType: id.startsWith('challenge') ? 'repo_source_span' : 'source_span',
    sourceRefId: `source-ref-${id}`,
    sourceSpanId: id.startsWith('challenge') ? undefined : `source-ref-${id}`,
    exactText: `Exact source text for ${id}.`,
    startOffset: 0,
    endOffset: 100,
    ...overrides,
  };
}

function roleSource(
  id: string,
  conceptKeys: string[],
  overrides: Partial<RoleRequirements['sourceReferences'][number]> = {},
): RoleRequirements['sourceReferences'][number] {
  return {
    entityId: id,
    locator: `fixture:role:${id}`,
    conceptKeys,
    sourceRefType: 'source_span',
    sourceRefId: `role-source-span-${id}`,
    sourceSpanId: `role-source-span-${id}`,
    exactText: `Exact role source text for ${id}.`,
    contentHash: `sha256:role-${id}`,
    ...overrides,
  };
}

describe('Corpus Validation', () => {
  it('should accept a valid corpus with unseen concepts', () => {
    const corpus: EvaluationCorpus = {
      version: EVALUATION_CORPUS_VERSION,
      corpusId: 'test-corpus-1',
      createdAt: '2026-06-13T00:00:00Z',
      description: 'Test corpus with unseen concepts',
      candidateEvidence: [
        {
          candidateId: 'candidate-1',
          evidenceId: 'evidence-1',
          episodeId: 'episode-1',
          narrative: 'Implemented quantum-resistant cryptography using lattice-based schemes',
          concepts: ['term:quantum-cryptography', 'term:lattice-based-cryptography', 'term:post-quantum'],
          mechanisms: ['term:kyber-encapsulation', 'term:dilithium-signatures'],
          domains: ['term:security', 'term:cryptography'],
          businessObjects: ['term:encryption-keys', 'term:digital-signatures'],
          ownershipActions: ['term:implemented', 'term:designed'],
          evidenceReferences: [sourceRef('evidence-1')],
        },
      ],
      roleRequirements: [
        {
          roleId: 'role-1',
          requiredLanguages: ['typescript'],
          relevantConcepts: ['term:quantum-cryptography', 'term:post-quantum'],
          requiredConcepts: ['term:security'],
          sourceReferences: [roleSource('role-1', ['term:quantum-cryptography'], {
            locator: 'technical_context',
          })],
        },
      ],
      expertLabels: [
        {
          labelId: 'label-1',
          candidateId: 'candidate-1',
          roleId: 'role-1',
          challengeId: 'challenge-1',
          relevanceGrade: 'highly_relevant',
          eligibleChallengeIds: ['challenge-1', 'challenge-2'],
          labelVersion: '1.0.0',
          labeledAt: '2026-06-13T00:00:00Z',
          labeledBy: 'synthetic-fixture',
        },
      ],
      metadata: {
        totalLabels: 1,
        totalCandidates: 1,
        totalRoles: 1,
        totalChallenges: 2,
        syntheticFixtureCount: 1,
      },
    };

    expect(() => loadCorpus(JSON.stringify(corpus))).not.toThrow();
  });

  it('should reject corpus with version mismatch', () => {
    const corpus: EvaluationCorpus = {
      version: '0.0.0' as const,
      corpusId: 'test-corpus-2',
      createdAt: '2026-06-13T00:00:00Z',
      description: 'Invalid version',
      candidateEvidence: [],
      roleRequirements: [],
      expertLabels: [],
      metadata: {
        totalLabels: 0,
        totalCandidates: 0,
        totalRoles: 0,
        totalChallenges: 0,
        syntheticFixtureCount: 0,
      },
    };

    expect(() => loadCorpus(JSON.stringify(corpus))).toThrow(CorpusValidationError);
  });

  it('should reject corpus with duplicate evidence IDs', () => {
    const corpus: EvaluationCorpus = {
      version: EVALUATION_CORPUS_VERSION,
      corpusId: 'test-corpus-3',
      createdAt: '2026-06-13T00:00:00Z',
      description: 'Duplicate evidence IDs',
      candidateEvidence: [
        {
          candidateId: 'candidate-1',
          evidenceId: 'evidence-1',
          episodeId: 'episode-1',
          narrative: 'Test',
          concepts: [],
          evidenceReferences: [sourceRef('duplicate-1')],
        },
        {
          candidateId: 'candidate-1',
          evidenceId: 'evidence-1',  // Duplicate
          episodeId: 'episode-2',
          narrative: 'Test',
          concepts: [],
          evidenceReferences: [sourceRef('duplicate-2')],
        },
      ],
      roleRequirements: [],
      expertLabels: [],
      metadata: {
        totalLabels: 0,
        totalCandidates: 1,
        totalRoles: 0,
        totalChallenges: 0,
        syntheticFixtureCount: 0,
      },
    };

    expect(() => loadCorpus(JSON.stringify(corpus))).toThrow(CorpusValidationError);
  });

  it('should reject corpus with invalid evidence reference offsets', () => {
    const corpus: EvaluationCorpus = {
      version: EVALUATION_CORPUS_VERSION,
      corpusId: 'test-corpus-4',
      createdAt: '2026-06-13T00:00:00Z',
      description: 'Invalid offsets',
      candidateEvidence: [
        {
          candidateId: 'candidate-1',
          evidenceId: 'evidence-1',
          episodeId: 'episode-1',
          narrative: 'Test',
          concepts: [],
          evidenceReferences: [sourceRef('invalid-offsets', {
            startOffset: 100,  // Invalid: > endOffset
            endOffset: 50,
          })],
        },
      ],
      roleRequirements: [],
      expertLabels: [],
      metadata: {
        totalLabels: 0,
        totalCandidates: 1,
        totalRoles: 0,
        totalChallenges: 0,
        syntheticFixtureCount: 0,
      },
    };

    expect(() => loadCorpus(JSON.stringify(corpus))).toThrow(CorpusValidationError);
  });

  it('should reject corpus source references without exact immutable provenance', () => {
    const corpus: EvaluationCorpus = {
      version: EVALUATION_CORPUS_VERSION,
      corpusId: 'test-corpus-missing-exact-provenance',
      createdAt: '2026-06-13T00:00:00Z',
      description: 'Missing exact provenance',
      candidateEvidence: [
        {
          candidateId: 'candidate-1',
          evidenceId: 'evidence-1',
          episodeId: 'episode-1',
          narrative: 'Test',
          concepts: [],
          evidenceReferences: [sourceRef('missing-exact-text', { exactText: undefined })],
        },
      ],
      roleRequirements: [
        {
          roleId: 'role-1',
          requiredLanguages: ['typescript'],
          sourceReferences: [roleSource('missing-role-exact-text', ['term:test'], {
            exactText: undefined,
          })],
        },
      ],
      expertLabels: [],
      metadata: {
        totalLabels: 0,
        totalCandidates: 1,
        totalRoles: 1,
        totalChallenges: 0,
        syntheticFixtureCount: 0,
      },
    };

    expect(() => loadCorpus(JSON.stringify(corpus))).toThrow(CorpusValidationError);
  });
});

describe('Corpus Queries', () => {
  const corpus: EvaluationCorpus = {
    version: EVALUATION_CORPUS_VERSION,
    corpusId: 'test-corpus-queries',
    createdAt: '2026-06-13T00:00:00Z',
    description: 'Test corpus for queries',
    candidateEvidence: [
      {
        candidateId: 'candidate-1',
        evidenceId: 'evidence-1',
        episodeId: 'episode-1',
        narrative: 'Built edge computing infrastructure with wasm sandboxes',
        concepts: ['term:edge-computing', 'term:wasm-sandbox', 'term:serverless'],
        evidenceReferences: [sourceRef('query-evidence-1')],
      },
    ],
    roleRequirements: [
      {
        roleId: 'role-1',
        requiredLanguages: ['rust'],
        relevantConcepts: ['term:edge-computing'],
        sourceReferences: [roleSource('query-role-1', ['term:edge-computing'])],
      },
      {
        roleId: 'role-2',
        requiredLanguages: ['go'],
        relevantConcepts: ['term:serverless'],
        sourceReferences: [roleSource('query-role-2', ['term:serverless'])],
      },
    ],
    expertLabels: [
      {
        labelId: 'label-1',
        candidateId: 'candidate-1',
        roleId: 'role-1',
        challengeId: 'challenge-1',
        relevanceGrade: 'highly_relevant',
        eligibleChallengeIds: ['challenge-1', 'challenge-2'],
        labelVersion: '1.0.0',
        labeledAt: '2026-06-13T00:00:00Z',
        labeledBy: 'synthetic-fixture',
      },
      {
        labelId: 'label-2',
        candidateId: 'candidate-1',
        roleId: 'role-2',
        challengeId: 'challenge-2',
        relevanceGrade: 'relevant',
        eligibleChallengeIds: ['challenge-2', 'challenge-3'],
        labelVersion: '1.0.0',
        labeledAt: '2026-06-13T00:00:00Z',
        labeledBy: 'synthetic-fixture',
      },
    ],
    metadata: {
      totalLabels: 2,
      totalCandidates: 1,
      totalRoles: 2,
      totalChallenges: 3,
      syntheticFixtureCount: 2,
    },
  };

  it('should get labels for candidate-role pair', () => {
    const labels = getLabelsForCandidateRole(corpus, 'candidate-1', 'role-1');
    expect(labels).toHaveLength(1);
    expect(labels[0]?.labelId).toBe('label-1');
  });

  it('should get candidate evidence', () => {
    const evidence = getCandidateEvidence(corpus, 'candidate-1');
    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.evidenceId).toBe('evidence-1');
  });

  it('should get role requirements', () => {
    const role = getRoleRequirements(corpus, 'role-1');
    expect(role?.roleId).toBe('role-1');
    expect(role?.requiredLanguages).toEqual(['rust']);
  });

  it('should get all challenge IDs', () => {
    const challengeIds = getAllChallengeIds(corpus);
    expect(challengeIds).toEqual(['challenge-1', 'challenge-2', 'challenge-3']);
  });
});

describe('Evaluation Metrics', () => {
  it('should compute recall@50 correctly', () => {
    const corpus: EvaluationCorpus = {
      version: EVALUATION_CORPUS_VERSION,
      corpusId: 'test-metrics-recall',
      createdAt: '2026-06-13T00:00:00Z',
      description: 'Test recall metric',
      candidateEvidence: [],
      roleRequirements: [],
      expertLabels: [
        {
          labelId: 'label-1',
          candidateId: 'candidate-1',
          roleId: 'role-1',
          challengeId: 'challenge-1',
          relevanceGrade: 'highly_relevant',
          eligibleChallengeIds: ['challenge-1'],
          labelVersion: '1.0.0',
          labeledAt: '2026-06-13T00:00:00Z',
          labeledBy: 'synthetic-fixture',
        },
        {
          labelId: 'label-2',
          candidateId: 'candidate-1',
          roleId: 'role-1',
          challengeId: 'challenge-2',
          relevanceGrade: 'highly_relevant',
          eligibleChallengeIds: ['challenge-2'],
          labelVersion: '1.0.0',
          labeledAt: '2026-06-13T00:00:00Z',
          labeledBy: 'synthetic-fixture',
        },
      ],
      metadata: {
        totalLabels: 2,
        totalCandidates: 1,
        totalRoles: 1,
        totalChallenges: 2,
        syntheticFixtureCount: 2,
      },
    };

    const matchRun: PersistedMatchRun = {
      matchRunId: 'run-1',
      candidateId: 'candidate-1',
      roleId: 'role-1',
      candidateSnapshotId: 'snapshot-1',
      policyVersion: 'candidate-pr-v1',
      modelVersion: null,
      status: 'MATCHED',
      rankedChallenges: [
        {
          rank: 1,
          recallRank: 1,
          challengeId: 'challenge-1',
          repoId: 'repo-1',
          prNumber: 1,
          sourceVersion: 'v1',
          score: 0.9,
          candidateEvidenceAlignment: 0.8,
          roleRelevance: 0.9,
          contextualSpecificity: 0.85,
          challengeQuality: 0.9,
          validationDeepeningValue: 0.8,
          alignedDemandCount: 5,
          stretchCount: 0,
          stretchDemandWeightRatio: 0,
          provenanceComplete: true,
          eligible: true,
          alignments: [],
          rejectionReasons: [],
        },
      ],
    };

    const metrics = evaluateMatchRuns(corpus, [matchRun]);
    expect(metrics.recallAt50).toBe(0.5);  // 1 of 2 highly relevant in top 50
  });

  it('should detect guardrail violations', () => {
    const corpus: EvaluationCorpus = {
      version: EVALUATION_CORPUS_VERSION,
      corpusId: 'test-guardrails',
      createdAt: '2026-06-13T00:00:00Z',
      description: 'Test guardrail detection',
      candidateEvidence: [],
      roleRequirements: [],
      expertLabels: [
        {
          labelId: 'label-1',
          candidateId: 'candidate-1',
          roleId: 'role-1',
          challengeId: 'challenge-1',
          relevanceGrade: 'forbidden',
          eligibleChallengeIds: ['challenge-1'],
          guardrailViolations: ['language_requirement'],
          labelVersion: '1.0.0',
          labeledAt: '2026-06-13T00:00:00Z',
          labeledBy: 'synthetic-fixture',
        },
      ],
      metadata: {
        totalLabels: 1,
        totalCandidates: 1,
        totalRoles: 1,
        totalChallenges: 1,
        syntheticFixtureCount: 1,
      },
    };

    const matchRun: PersistedMatchRun = {
      matchRunId: 'run-1',
      candidateId: 'candidate-1',
      roleId: 'role-1',
      candidateSnapshotId: 'snapshot-1',
      policyVersion: 'candidate-pr-v1',
      modelVersion: null,
      status: 'MATCHED',
      rankedChallenges: [
        {
          rank: 1,
          recallRank: 1,
          challengeId: 'challenge-1',
          repoId: 'repo-1',
          prNumber: 1,
          sourceVersion: 'v1',
          score: 0.9,
          candidateEvidenceAlignment: 0.8,
          roleRelevance: 0.9,
          contextualSpecificity: 0.85,
          challengeQuality: 0.9,
          validationDeepeningValue: 0.8,
          alignedDemandCount: 5,
          stretchCount: 0,
          stretchDemandWeightRatio: 0,
          provenanceComplete: true,
          eligible: true,
          alignments: [],
          rejectionReasons: [],
        },
      ],
    };

    const metrics = evaluateMatchRuns(corpus, [matchRun]);
    expect(metrics.guardrailViolationCount).toBeGreaterThan(0);
    expect(metrics.labelResults[0]?.passed).toBe(false);
  });

  it('should flag eligible alignments that lack exact source text as missing provenance', () => {
    const corpus: EvaluationCorpus = {
      version: EVALUATION_CORPUS_VERSION,
      corpusId: 'test-missing-exact-provenance',
      createdAt: '2026-06-13T00:00:00Z',
      description: 'Test strict provenance metric',
      candidateEvidence: [],
      roleRequirements: [],
      expertLabels: [
        {
          labelId: 'label-1',
          candidateId: 'candidate-1',
          roleId: 'role-1',
          challengeId: 'challenge-1',
          relevanceGrade: 'highly_relevant',
          eligibleChallengeIds: ['challenge-1'],
          labelVersion: '1.0.0',
          labeledAt: '2026-06-13T00:00:00Z',
          labeledBy: 'synthetic-fixture',
        },
      ],
      metadata: {
        totalLabels: 1,
        totalCandidates: 1,
        totalRoles: 1,
        totalChallenges: 1,
        syntheticFixtureCount: 1,
      },
    };
    const matchRun: PersistedMatchRun = {
      matchRunId: 'run-1',
      candidateId: 'candidate-1',
      roleId: 'role-1',
      candidateSnapshotId: 'snapshot-1',
      policyVersion: 'candidate-pr-v1',
      modelVersion: null,
      status: 'MATCHED',
      rankedChallenges: [
        {
          rank: 1,
          recallRank: 1,
          challengeId: 'challenge-1',
          repoId: 'repo-1',
          prNumber: 1,
          sourceVersion: 'v1',
          score: 0.9,
          candidateEvidenceAlignment: 0.8,
          roleRelevance: 0.9,
          contextualSpecificity: 0.85,
          challengeQuality: 0.9,
          validationDeepeningValue: 0.8,
          alignedDemandCount: 1,
          stretchCount: 0,
          stretchDemandWeightRatio: 0,
          provenanceComplete: true,
          eligible: true,
          alignments: [{
            atomId: 'atom-1',
            demandId: 'demand-1',
            pairScore: 0.9,
            weightedScore: 0.9,
            stretch: null,
            sharedConcepts: ['term:kafka'],
            roleSourceRefs: [],
            candidateSourceRefs: [sourceRef('candidate-missing-exact', { exactText: undefined })],
            challengeSourceRefs: [sourceRef('challenge-with-exact')],
          }],
          rejectionReasons: [],
        },
      ],
    };

    const metrics = evaluateMatchRuns(corpus, [matchRun]);
    expect(metrics.missingProvenanceCount).toBe(1);
    expect(metrics.labelResults[0]?.guardrailViolations).toContain('missing_provenance');
    expect(metrics.labelResults[0]?.passed).toBe(false);
  });
});

describe('Determinism Verification', () => {
  function deterministicAlignment(
    sharedConcepts: string[] = ['term:kafka'],
  ): PersistedRankedChallenge['alignments'][number] {
    return {
      atomId: 'atom-1',
      demandId: 'demand-1',
      pairScore: 0.7,
      weightedScore: 0.7,
      stretch: null,
      sharedConcepts,
      roleSourceRefs: [],
      candidateSourceRefs: [sourceRef('candidate-deterministic', {
        artifactId: 'candidate-artifact',
        artifactVersion: 'candidate-version',
        contentHash: 'sha256:candidate',
        endOffset: 10,
      })],
      challengeSourceRefs: [sourceRef('challenge-deterministic', {
        artifactId: 'challenge-artifact',
        artifactVersion: 'challenge-version',
        contentHash: 'sha256:challenge',
        endOffset: 10,
      })],
    };
  }

  function deterministicRun(
    matchRunId: string,
    overrides: Partial<PersistedRankedChallenge> = {},
  ): PersistedMatchRun {
    return {
      matchRunId,
      candidateId: 'candidate-1',
      roleId: 'role-1',
      candidateSnapshotId: 'snapshot-1',
      policyVersion: 'candidate-pr-v1',
      modelVersion: null,
      status: 'MATCHED',
      rankedChallenges: [
        {
          rank: 1,
          recallRank: 1,
          challengeId: 'challenge-1',
          repoId: 'repo-1',
          prNumber: 1,
          sourceVersion: 'v1',
          score: 0.9,
          candidateEvidenceAlignment: 0.8,
          roleRelevance: 0.9,
          contextualSpecificity: 0.85,
          challengeQuality: 0.9,
          validationDeepeningValue: 0.8,
          alignedDemandCount: 1,
          stretchCount: 0,
          stretchDemandWeightRatio: 0,
          provenanceComplete: true,
          eligible: true,
          alignments: [],
          rejectionReasons: [],
          ...overrides,
        },
      ],
    };
  }

  const deterministicCorpus: EvaluationCorpus = {
    version: EVALUATION_CORPUS_VERSION,
    corpusId: 'test-determinism',
    createdAt: '2026-06-13T00:00:00Z',
    description: 'Test determinism comparison details',
    candidateEvidence: [],
    roleRequirements: [],
    expertLabels: [
      {
        labelId: 'label-1',
        candidateId: 'candidate-1',
        roleId: 'role-1',
        challengeId: 'challenge-1',
        relevanceGrade: 'highly_relevant',
        eligibleChallengeIds: ['challenge-1'],
        labelVersion: '1.0.0',
        labeledAt: '2026-06-13T00:00:00Z',
        labeledBy: 'synthetic-fixture',
      },
    ],
    metadata: {
      totalLabels: 1,
      totalCandidates: 1,
      totalRoles: 1,
      totalChallenges: 1,
      syntheticFixtureCount: 1,
    },
  };

  it('should verify byte-identical reruns', () => {
    const matchRun: PersistedMatchRun = {
      matchRunId: 'run-1',
      candidateId: 'candidate-1',
      roleId: 'role-1',
      candidateSnapshotId: 'snapshot-1',
      policyVersion: 'candidate-pr-v1',
      modelVersion: null,
      status: 'MATCHED',
      rankedChallenges: [
        {
          rank: 1,
          recallRank: 1,
          challengeId: 'challenge-1',
          repoId: 'repo-1',
          prNumber: 1,
          sourceVersion: 'v1',
          score: 0.9,
          candidateEvidenceAlignment: 0.8,
          roleRelevance: 0.9,
          contextualSpecificity: 0.85,
          challengeQuality: 0.9,
          validationDeepeningValue: 0.8,
          alignedDemandCount: 5,
          stretchCount: 0,
          stretchDemandWeightRatio: 0,
          provenanceComplete: true,
          eligible: true,
          alignments: [],
          rejectionReasons: [],
        },
      ],
    };

    const { identical, fingerprint } = verifyByteIdenticalRerun(matchRun, matchRun);
    expect(identical).toBe(true);
    expect(fingerprint).toBeDefined();
  });

  it('should detect non-identical reruns', () => {
    const firstRun: PersistedMatchRun = {
      matchRunId: 'run-1',
      candidateId: 'candidate-1',
      roleId: 'role-1',
      candidateSnapshotId: 'snapshot-1',
      policyVersion: 'candidate-pr-v1',
      modelVersion: null,
      status: 'MATCHED',
      rankedChallenges: [
        {
          rank: 1,
          recallRank: 1,
          challengeId: 'challenge-1',
          repoId: 'repo-1',
          prNumber: 1,
          sourceVersion: 'v1',
          score: 0.9,
          candidateEvidenceAlignment: 0.8,
          roleRelevance: 0.9,
          contextualSpecificity: 0.85,
          challengeQuality: 0.9,
          validationDeepeningValue: 0.8,
          alignedDemandCount: 5,
          stretchCount: 0,
          stretchDemandWeightRatio: 0,
          provenanceComplete: true,
          eligible: true,
          alignments: [],
          rejectionReasons: [],
        },
      ],
    };

    const secondRun: PersistedMatchRun = {
      ...firstRun,
      rankedChallenges: [
        {
          ...firstRun.rankedChallenges[0]!,
          score: 0.5,  // Different score
        },
      ],
    };

    const { identical } = verifyByteIdenticalRerun(firstRun, secondRun);
    expect(identical).toBe(false);
  });

  it('should report pair-level determinism comparisons for rollout evidence', () => {
    const metrics = evaluateMatchRuns(
      deterministicCorpus,
      [deterministicRun('run-primary')],
      [deterministicRun('run-comparison')],
    );

    expect(metrics.byteIdenticalRerun).toBe(true);
    expect(metrics.determinismComparisons).toEqual([
      expect.objectContaining({
        candidateId: 'candidate-1',
        roleId: 'role-1',
        matchRunId: 'run-primary',
        comparisonMatchRunId: 'run-comparison',
        identical: true,
      }),
    ]);
    expect(metrics.determinismComparisons[0]?.fingerprint).toBe(
      metrics.determinismComparisons[0]?.comparisonFingerprint,
    );
  });

  it('should identify missing comparison reruns by candidate-role pair', () => {
    const metrics = evaluateMatchRuns(
      deterministicCorpus,
      [deterministicRun('run-primary')],
      [],
    );

    expect(metrics.byteIdenticalRerun).toBe(false);
    expect(metrics.determinismComparisons).toEqual([
      expect.objectContaining({
        candidateId: 'candidate-1',
        roleId: 'role-1',
        matchRunId: 'run-primary',
        comparisonMatchRunId: null,
        identical: false,
        comparisonFingerprint: null,
      }),
    ]);
  });

  it('should fail comparison reruns when aligned demand count drifts', () => {
    const metrics = evaluateMatchRuns(
      deterministicCorpus,
      [deterministicRun('run-primary', { alignedDemandCount: 1 })],
      [deterministicRun('run-comparison', { alignedDemandCount: 2 })],
    );

    expect(metrics.byteIdenticalRerun).toBe(false);
    expect(metrics.determinismComparisons[0]).toEqual(
      expect.objectContaining({
        comparisonMatchRunId: 'run-comparison',
        identical: false,
      }),
    );
    expect(metrics.determinismComparisons[0]?.fingerprint).not.toBe(
      metrics.determinismComparisons[0]?.comparisonFingerprint,
    );
    expect(computeMatchRunFingerprint(deterministicRun('run-primary'))).toContain(
      '"alignedDemandCount":1',
    );
  });

  it('should fail comparison reruns when shared concepts drift', () => {
    const metrics = evaluateMatchRuns(
      deterministicCorpus,
      [
        deterministicRun('run-primary', {
          alignments: [deterministicAlignment(['term:kafka'])],
        }),
      ],
      [
        deterministicRun('run-comparison', {
          alignments: [deterministicAlignment(['term:redis'])],
        }),
      ],
    );

    expect(metrics.byteIdenticalRerun).toBe(false);
    expect(metrics.determinismComparisons[0]).toEqual(
      expect.objectContaining({
        comparisonMatchRunId: 'run-comparison',
        identical: false,
      }),
    );
    expect(metrics.determinismComparisons[0]?.fingerprint).toContain(
      '"sharedConcepts":["term:kafka"]',
    );
    expect(metrics.determinismComparisons[0]?.comparisonFingerprint).toContain(
      '"sharedConcepts":["term:redis"]',
    );
  });

  it('should fingerprint pair score breakdowns', () => {
    const firstRun: PersistedMatchRun = {
      matchRunId: 'run-1',
      candidateId: 'candidate-1',
      roleId: 'role-1',
      candidateSnapshotId: 'snapshot-1',
      policyVersion: 'candidate-pr-v1',
      modelVersion: null,
      status: 'MATCHED',
      rankedChallenges: [
        {
          rank: 1,
          recallRank: 1,
          challengeId: 'challenge-1',
          repoId: 'repo-1',
          prNumber: 1,
          sourceVersion: 'v1',
          score: 0.9,
          candidateEvidenceAlignment: 0.8,
          roleRelevance: 0.9,
          contextualSpecificity: 0.85,
          challengeQuality: 0.9,
          validationDeepeningValue: 0.8,
          alignedDemandCount: 1,
          stretchCount: 0,
          stretchDemandWeightRatio: 0,
          provenanceComplete: true,
          eligible: true,
          alignments: [
            {
              atomId: 'atom-1',
              demandId: 'demand-1',
              pairScore: 0.7,
              pairScoreBreakdown: {
                semanticNarrative: 0.2,
                conceptCorrespondence: 1,
                problemMechanismCorrespondence: 0.5,
                domainBusinessContext: 0.3,
                ownershipActionCorrespondence: 0.1,
                total: 0.7,
              },
              weightedScore: 0.7,
              stretch: null,
              sharedConcepts: ['term:kafka'],
              roleSourceRefs: [{
                entityId: 'context-record-role',
                locator: 'simple_job_description:source_span:jd-span-kafka',
                conceptKeys: ['term:kafka'],
              }],
              candidateSourceRefs: [sourceRef('candidate-fingerprint', {
                artifactId: 'candidate-artifact',
                artifactVersion: 'candidate-version',
                contentHash: 'sha256:candidate',
                endOffset: 10,
              })],
              challengeSourceRefs: [sourceRef('challenge-fingerprint', {
                artifactId: 'challenge-artifact',
                artifactVersion: 'challenge-version',
                contentHash: 'sha256:challenge',
                endOffset: 10,
              })],
            },
          ],
          rejectionReasons: [],
        },
      ],
    };
    const secondRun: PersistedMatchRun = {
      ...firstRun,
      rankedChallenges: [
        {
          ...firstRun.rankedChallenges[0]!,
          alignments: [
            {
              ...firstRun.rankedChallenges[0]!.alignments[0]!,
              pairScoreBreakdown: {
                ...firstRun.rankedChallenges[0]!.alignments[0]!.pairScoreBreakdown!,
                semanticNarrative: 0.4,
              },
            },
          ],
        },
      ],
    };

    const { identical, fingerprint } = verifyByteIdenticalRerun(firstRun, secondRun);
    expect(identical).toBe(false);
    expect(fingerprint).toContain('"roleSourceRefs":[{"entityId":"context-record-role"');
  });
});

describe('Acceptance Thresholds', () => {
  it('should pass when all thresholds met', () => {
    const metrics = {
      corpusVersion: EVALUATION_CORPUS_VERSION,
      corpusId: 'test',
      matchRunIds: ['run-1'],
      comparisonMatchRunIds: [],
      evaluatedAt: '2026-06-13T00:00:00Z',
      recallAt50: 0.96,
      precisionAt3: 0.85,
      ndcgAt5: 0.85,
      guardrailViolationCount: 0,
      multiStretchViolationCount: 0,
      missingProvenanceCount: 0,
      missingMatchRunCount: 0,
      byteIdenticalRerun: true,
      rerunFingerprints: {},
      determinismComparisons: [],
      totalEvaluations: 10,
      evaluatedPairCount: 1,
      highlyRelevantInTop3: 5,
      relevantInTop3: 3,
      irrelevantInTop3: 0,
      forbiddenInResults: 0,
      syntheticFixtureCount: 0,
      expertLabelCount: 10,
      labelResults: [],
    };

    const result = checkAcceptanceThresholds(metrics, DEFAULT_ACCEPTANCE_THRESHOLDS);
    expect(result.passed).toBe(true);
    expect(result.failures).toHaveLength(0);
  });

  it('should fail when recall below threshold', () => {
    const metrics = {
      corpusVersion: EVALUATION_CORPUS_VERSION,
      corpusId: 'test',
      matchRunIds: ['run-1'],
      comparisonMatchRunIds: [],
      evaluatedAt: '2026-06-13T00:00:00Z',
      recallAt50: 0.90,  // Below 0.95 threshold
      precisionAt3: 0.85,
      ndcgAt5: 0.85,
      guardrailViolationCount: 0,
      multiStretchViolationCount: 0,
      missingProvenanceCount: 0,
      missingMatchRunCount: 0,
      byteIdenticalRerun: true,
      rerunFingerprints: {},
      determinismComparisons: [],
      totalEvaluations: 10,
      evaluatedPairCount: 1,
      highlyRelevantInTop3: 5,
      relevantInTop3: 3,
      irrelevantInTop3: 0,
      forbiddenInResults: 0,
      syntheticFixtureCount: 0,
      expertLabelCount: 10,
      labelResults: [],
    };

    const result = checkAcceptanceThresholds(metrics, DEFAULT_ACCEPTANCE_THRESHOLDS);
    expect(result.passed).toBe(false);
    expect(result.failures.some(f => f.includes('Recall@50'))).toBe(true);
  });

  it('should fail when guardrail violations exceed threshold', () => {
    const metrics = {
      corpusVersion: EVALUATION_CORPUS_VERSION,
      corpusId: 'test',
      matchRunIds: ['run-1'],
      comparisonMatchRunIds: [],
      evaluatedAt: '2026-06-13T00:00:00Z',
      recallAt50: 0.96,
      precisionAt3: 0.85,
      ndcgAt5: 0.85,
      guardrailViolationCount: 1,  // Exceeds 0 threshold
      multiStretchViolationCount: 0,
      missingProvenanceCount: 0,
      missingMatchRunCount: 0,
      byteIdenticalRerun: true,
      rerunFingerprints: {},
      determinismComparisons: [],
      totalEvaluations: 10,
      evaluatedPairCount: 1,
      highlyRelevantInTop3: 5,
      relevantInTop3: 3,
      irrelevantInTop3: 0,
      forbiddenInResults: 0,
      syntheticFixtureCount: 0,
      expertLabelCount: 10,
      labelResults: [],
    };

    const result = checkAcceptanceThresholds(metrics, DEFAULT_ACCEPTANCE_THRESHOLDS);
    expect(result.passed).toBe(false);
    expect(result.failures.some(f => f.includes('Guardrail violations'))).toBe(true);
  });
});

describe('Unseen Semantic Concepts', () => {
  it('should handle completely novel concept namespaces', () => {
    const corpus: EvaluationCorpus = {
      version: EVALUATION_CORPUS_VERSION,
      corpusId: 'test-novel-concepts',
      createdAt: '2026-06-13T00:00:00Z',
      description: 'Test with completely novel concept namespaces',
      candidateEvidence: [
        {
          candidateId: 'candidate-1',
          evidenceId: 'evidence-1',
          episodeId: 'episode-1',
          narrative: 'Implemented neural interface using bio-digital signal processing',
          concepts: [
            'novel:neural-interface',
            'novel:bio-digital-processing',
            'novel:brain-computer-interface',
            'custom:thought-pattern-recognition',
          ],
          mechanisms: [
            'novel:synaptic-emulation',
            'custom:cognitive-load-balancing',
          ],
          domains: [
            'novel:neurotechnology',
            'custom:human-augmentation',
          ],
          evidenceReferences: [sourceRef('novel-concepts-evidence')],
        },
      ],
      roleRequirements: [
        {
          roleId: 'role-1',
          requiredLanguages: ['python'],
          relevantConcepts: ['novel:neural-interface', 'custom:thought-pattern-recognition'],
          requiredConcepts: ['novel:neurotechnology'],
          sourceReferences: [roleSource('novel-concepts', [
            'novel:neural-interface',
            'custom:thought-pattern-recognition',
            'novel:neurotechnology',
          ])],
        },
      ],
      expertLabels: [
        {
          labelId: 'label-1',
          candidateId: 'candidate-1',
          roleId: 'role-1',
          challengeId: 'challenge-1',
          relevanceGrade: 'highly_relevant',
          eligibleChallengeIds: ['challenge-1'],
          labelVersion: '1.0.0',
          labeledAt: '2026-06-13T00:00:00Z',
          labeledBy: 'synthetic-fixture',
        },
      ],
      metadata: {
        totalLabels: 1,
        totalCandidates: 1,
        totalRoles: 1,
        totalChallenges: 1,
        syntheticFixtureCount: 1,
      },
    };

    // Should load without errors despite completely novel concept namespaces
    expect(() => loadCorpus(JSON.stringify(corpus))).not.toThrow();
  });

  it('should handle concepts with unusual characters and formats', () => {
    const corpus: EvaluationCorpus = {
      version: EVALUATION_CORPUS_VERSION,
      corpusId: 'test-unusual-concepts',
      createdAt: '2026-06-13T00:00:00Z',
      description: 'Test with unusual concept formats',
      candidateEvidence: [
        {
          candidateId: 'candidate-1',
          evidenceId: 'evidence-1',
          episodeId: 'episode-1',
          narrative: 'Worked with C++20 modules and concepts',
          concepts: [
            'term:c++20-modules',
            'term:concept-based-generic-programming',
            'term:requires-clause',
            'custom:std::ranges',
          ],
          evidenceReferences: [sourceRef('unusual-concepts-evidence')],
        },
      ],
      roleRequirements: [
        {
          roleId: 'role-1',
          requiredLanguages: ['cpp'],
          relevantConcepts: ['term:c++20-modules'],
          sourceReferences: [roleSource('unusual-concepts', ['term:c++20-modules'])],
        },
      ],
      expertLabels: [
        {
          labelId: 'label-1',
          candidateId: 'candidate-1',
          roleId: 'role-1',
          challengeId: 'challenge-1',
          relevanceGrade: 'relevant',
          eligibleChallengeIds: ['challenge-1'],
          labelVersion: '1.0.0',
          labeledAt: '2026-06-13T00:00:00Z',
          labeledBy: 'synthetic-fixture',
        },
      ],
      metadata: {
        totalLabels: 1,
        totalCandidates: 1,
        totalRoles: 1,
        totalChallenges: 1,
        syntheticFixtureCount: 1,
      },
    };

    expect(() => loadCorpus(JSON.stringify(corpus))).not.toThrow();
  });
});
