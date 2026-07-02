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
  productionCorpusFailures,
  CorpusValidationError,
} from '../corpus';
import {
  evaluateMatchRuns,
  computeMatchRunFingerprint,
  verifyByteIdenticalRerun,
  checkAcceptanceThresholds,
  checkStagedRolloutGate,
  checkRolloutGate,
} from '../metrics';
import {
  EVALUATION_CORPUS_VERSION,
  type EvaluationCorpus,
  type EvaluationMetrics,
  type ExpertLabel,
  type RelevanceGrade,
  type PersistedMatchRun,
  type PersistedRankedChallenge,
  type RoleRequirements,
  DEFAULT_ACCEPTANCE_THRESHOLDS,
  STAGED_ROLLOUT_THRESHOLDS,
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

  it('requires production expert labels to include human rationale', () => {
    const corpus: EvaluationCorpus = {
      version: EVALUATION_CORPUS_VERSION,
      corpusId: 'production-corpus-missing-rationale',
      createdAt: '2026-06-13T00:00:00Z',
      description: 'Production corpus with expert metadata but no rationale',
      candidateEvidence: [
        {
          candidateId: 'candidate-1',
          evidenceId: 'evidence-1',
          episodeId: 'episode-1',
          narrative: 'Built durable task queues for delayed retries.',
          concepts: ['term:durable-task-queues'],
          evidenceReferences: [sourceRef('candidate-queue')],
        },
      ],
      roleRequirements: [
        {
          roleId: 'role-1',
          requiredLanguages: ['typescript'],
          relevantConcepts: ['term:durable-task-queues'],
          sourceReferences: [roleSource('queue-role', ['term:durable-task-queues'])],
        },
      ],
      expertLabels: [
        {
          labelId: 'expert-label-without-rationale',
          candidateId: 'candidate-1',
          roleId: 'role-1',
          challengeId: 'challenge-1',
          relevanceGrade: 'highly_relevant',
          eligibleChallengeIds: ['challenge-1'],
          labelVersion: '1.0.0',
          labeledAt: '2026-06-13T00:00:00Z',
          labeledBy: 'expert-reviewer-1',
          labelProvenance: {
            reviewerId: 'expert-reviewer-1',
            reviewerRole: 'senior-engineering-reviewer',
            reviewArtifactId: 'expert-review-artifact-1',
            reviewArtifactVersion: 'v1',
            contentHash: 'sha256:expert-review-artifact-1',
            locator: 'expert-review:artifact-1',
            rubricVersion: 'candidate-pr-match-rubric-v1',
          },
        },
      ],
      metadata: {
        totalLabels: 1,
        totalCandidates: 1,
        totalRoles: 1,
        totalChallenges: 1,
        syntheticFixtureCount: 0,
      },
    };

    expect(productionCorpusFailures(corpus)).toContain(
      'expert label requires a human rationale: expert-label-without-rationale',
    );
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
        drift: expect.objectContaining({
          reason: 'missing_comparison',
          firstDifference: expect.stringContaining('missing comparison run'),
        }),
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
        drift: expect.objectContaining({
          reason: 'ranked_result_changed',
          firstDifference: 'challenge-1.alignedDemandCount: 1 -> 2',
        }),
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
        drift: expect.objectContaining({
          reason: 'ranked_result_changed',
          firstDifference: 'challenge-1.sharedConcepts: term:kafka -> term:redis',
        }),
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

/**
 * Helper: build a fully-passing metrics object for rollout gate tests.
 */
function passingMetrics(overrides: Partial<EvaluationMetrics> = {}): EvaluationMetrics {
  return {
    corpusVersion: EVALUATION_CORPUS_VERSION,
    corpusId: 'rollout-test-corpus',
    matchRunIds: ['run-1'],
    comparisonMatchRunIds: ['run-2'],
    evaluatedAt: '2026-06-24T00:00:00Z',
    recallAt50: 1,
    precisionAt3: 1,
    ndcgAt5: 1,
    guardrailViolationCount: 0,
    multiStretchViolationCount: 0,
    missingProvenanceCount: 0,
    missingMatchRunCount: 0,
    byteIdenticalRerun: true,
    rerunFingerprints: { '["candidate-1","role-1"]': 'fp-1' },
    determinismComparisons: [{
      candidateId: 'candidate-1',
      roleId: 'role-1',
      matchRunId: 'run-1',
      comparisonMatchRunId: 'run-2',
      identical: true,
      fingerprint: 'fp-1',
      comparisonFingerprint: 'fp-1',
    }],
    totalEvaluations: 1,
    evaluatedPairCount: 1,
    highlyRelevantInTop3: 1,
    relevantInTop3: 0,
    irrelevantInTop3: 0,
    forbiddenInResults: 0,
    syntheticFixtureCount: 0,
    expertLabelCount: 1,
    labelResults: [],
    expectedPacketCount: 1,
    packetCoverage: 1,
    pairCoverage: 1,
    comparisonCoverage: 1,
    missingPacketIds: [],
    packetIdentityMismatches: [],
    ...overrides,
  };
}

describe('Staged Rollout Gate', () => {
  it('shadow stage passes with zero coverage and synthetic fixtures', () => {
    const metrics = passingMetrics({
      recallAt50: 0,
      precisionAt3: 0,
      ndcgAt5: 0,
      guardrailViolationCount: 5,
      multiStretchViolationCount: 3,
      missingProvenanceCount: 2,
      missingMatchRunCount: 1,
      byteIdenticalRerun: false,
      syntheticFixtureCount: 1,
      expertLabelCount: 0,
      pairCoverage: 0,
      comparisonCoverage: 0,
      packetCoverage: 0,
      expectedPacketCount: 0,
      determinismComparisons: [],
    });
    const result = checkStagedRolloutGate(metrics, 'shadow');
    expect(result.stage).toBe('shadow');
    expect(result.ready).toBe(true);
    expect(result.failures).toHaveLength(0);
  });

  it('canary stage fails when packet coverage is incomplete', () => {
    const metrics = passingMetrics({
      packetCoverage: 0.5,
      missingPacketIds: ['challenge-missing-1'],
    });
    const result = checkStagedRolloutGate(metrics, 'canary');
    expect(result.ready).toBe(false);
    expect(result.failures.some((f) => f.includes('Packet coverage'))).toBe(true);
  });

  it('canary stage fails when expected packets are not declared', () => {
    const metrics = passingMetrics({
      expectedPacketCount: 0,
      packetCoverage: 0,
    });
    const result = checkStagedRolloutGate(metrics, 'canary');
    expect(result.ready).toBe(false);
    expect(result.failures.some((f) => f.includes('declare expected packets'))).toBe(true);
  });

  it('canary stage fails when pair coverage is incomplete', () => {
    const metrics = passingMetrics({
      pairCoverage: 0.5,
    });
    const result = checkStagedRolloutGate(metrics, 'canary');
    expect(result.ready).toBe(false);
    expect(result.failures.some((f) => f.includes('Pair coverage'))).toBe(true);
  });

  it('canary stage fails when comparison rerun coverage is incomplete', () => {
    const metrics = passingMetrics({
      comparisonCoverage: 0,
    });
    const result = checkStagedRolloutGate(metrics, 'canary');
    expect(result.ready).toBe(false);
    expect(result.failures.some((f) => f.includes('Comparison rerun coverage'))).toBe(true);
  });

  it('canary stage fails when packet identity mismatches exist', () => {
    const metrics = passingMetrics({
      packetIdentityMismatches: [{
        challengeId: 'challenge-1',
        field: 'repoId',
        expected: 'repo-expected',
        actual: 'repo-actual',
        matchRunId: 'run-1',
      }],
    });
    const result = checkStagedRolloutGate(metrics, 'canary');
    expect(result.ready).toBe(false);
    expect(result.failures.some((f) => f.includes('identity mismatch'))).toBe(true);
  });

  it('canary stage fails when recall@50 is below threshold', () => {
    const metrics = passingMetrics({
      recallAt50: 0.80,
    });
    const result = checkStagedRolloutGate(metrics, 'canary');
    expect(result.ready).toBe(false);
    expect(result.failures.some((f) => f.includes('Recall@50'))).toBe(true);
  });

  it('canary stage passes when all coverage and quality thresholds are met', () => {
    const metrics = passingMetrics();
    const result = checkStagedRolloutGate(metrics, 'canary');
    expect(result.ready).toBe(true);
    expect(result.failures).toHaveLength(0);
  });

  it('production stage fails when synthetic fixtures are present', () => {
    const metrics = passingMetrics({
      syntheticFixtureCount: 1,
      expertLabelCount: 0,
    });
    const result = checkStagedRolloutGate(metrics, 'production');
    expect(result.ready).toBe(false);
    expect(result.failures.some((f) => f.includes('expert-labelled'))).toBe(true);
  });

  it('production stage fails when byte-identical rerun is not proven', () => {
    const metrics = passingMetrics({
      byteIdenticalRerun: false,
    });
    const result = checkStagedRolloutGate(metrics, 'production');
    expect(result.ready).toBe(false);
    expect(result.failures.some((f) => f.includes('Byte-identical'))).toBe(true);
  });

  it('production stage fails when guardrail violations exist', () => {
    const metrics = passingMetrics({
      guardrailViolationCount: 1,
    });
    const result = checkStagedRolloutGate(metrics, 'production');
    expect(result.ready).toBe(false);
    expect(result.failures.some((f) => f.includes('Guardrail violations'))).toBe(true);
  });

  it('production stage fails when missing provenance exists', () => {
    const metrics = passingMetrics({
      missingProvenanceCount: 1,
    });
    const result = checkStagedRolloutGate(metrics, 'production');
    expect(result.ready).toBe(false);
    expect(result.failures.some((f) => f.includes('Missing provenance'))).toBe(true);
  });

  it('production stage passes when all thresholds are met', () => {
    const metrics = passingMetrics();
    const result = checkStagedRolloutGate(metrics, 'production');
    expect(result.stage).toBe('production');
    expect(result.ready).toBe(true);
    expect(result.failures).toHaveLength(0);
  });

  it('checkRolloutGate accepts custom threshold overrides', () => {
    const metrics = passingMetrics({ recallAt50: 0.85 });
    const result = checkRolloutGate(metrics, {
      ...STAGED_ROLLOUT_THRESHOLDS.production,
      minRecallAt50: 0.80,
    });
    expect(result.ready).toBe(true);
  });

  it('checkRolloutGate reports missing packets as warnings when coverage threshold is > 0', () => {
    const metrics = passingMetrics({
      packetCoverage: 0.5,
      missingPacketIds: ['challenge-missing-1'],
    });
    const result = checkRolloutGate(metrics, STAGED_ROLLOUT_THRESHOLDS.production);
    expect(result.ready).toBe(false);
    expect(result.warnings.some((w) => w.includes('challenge-missing-1'))).toBe(true);
  });

  it('staged thresholds are strictly increasing from shadow to production', () => {
    const shadow = STAGED_ROLLOUT_THRESHOLDS.shadow;
    const canary = STAGED_ROLLOUT_THRESHOLDS.canary;
    const production = STAGED_ROLLOUT_THRESHOLDS.production;
    expect(canary.minRecallAt50).toBeGreaterThan(shadow.minRecallAt50);
    expect(production.minRecallAt50).toBeGreaterThanOrEqual(canary.minRecallAt50);
    expect(canary.minPairCoverage).toBeGreaterThan(shadow.minPairCoverage);
    expect(production.minPairCoverage).toBeGreaterThanOrEqual(canary.minPairCoverage);
    expect(canary.requireExpectedPackets).toBe(true);
    expect(production.requireExpectedPackets).toBe(true);
    expect(shadow.requireExpectedPackets).toBe(false);
  });
});

/**
 * Full E2E scenario: roleless person + simple JD + real repo packet + explained
 * candidate-to-PR match.
 *
 * This test exercises the complete evaluation pipeline end-to-end:
 *   1. A candidate with evidence but no pre-assigned role (roleless person)
 *   2. A simple JD / role context with minimal requirements
 *   3. A real repo packet declared as an expected challenge (repo + PR + commit)
 *   4. A match run with alignments that explain the candidate-to-PR match via
 *      exact source references linking candidate evidence, JD, and PR content
 *   5. An expert label marking the challenge as highly relevant
 *   6. An independent comparison rerun for byte-identical determinism proof
 *
 * The test verifies that all metrics pass and the production rollout gate opens.
 */
describe('E2E: roleless person + simple JD + real repo packet + explained match', () => {
  const candidateId = 'person-alice';
  const roleId = 'role-simple-backend-jd';
  const challengeId = 'challenge-real-pr-247';
  const repoId = 'github.com/acme/payments-service';
  const prNumber = 247;
  const sourceVersion = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
  const evidenceId = 'evidence-alice-kafka-pipeline';
  const episodeId = 'episode-alice-kafka-pipeline';

  function e2eSourceRef(
    id: string,
    artifactId: string,
    artifactVersion: string,
    exactText: string,
    overrides: Record<string, unknown> = {},
  ) {
    return {
      artifactId,
      artifactVersion,
      contentHash: `sha256:${id}`,
      sourceRefType: artifactId.startsWith('repo-') ? 'repo_source_span' : 'source_span',
      sourceRefId: `source-ref-${id}`,
      sourceSpanId: artifactId.startsWith('repo-') ? undefined : `source-ref-${id}`,
      exactText,
      startOffset: 0,
      endOffset: exactText.length,
      ...overrides,
    };
  }

  function e2eRoleSource(
    id: string,
    conceptKeys: string[],
    exactText: string,
  ): RoleRequirements['sourceReferences'][number] {
    return {
      entityId: id,
      locator: `simple_job_description:source_span:jd-${id}`,
      conceptKeys,
      sourceRefType: 'source_span',
      sourceRefId: `role-source-span-${id}`,
      sourceSpanId: `role-source-span-${id}`,
      exactText,
      contentHash: `sha256:role-${id}`,
    };
  }

  function e2eCorpus(): EvaluationCorpus {
    return {
      version: EVALUATION_CORPUS_VERSION,
      corpusId: 'e2e-roleless-person-corpus-v1',
      createdAt: '2026-06-24T00:00:00Z',
      description: 'E2E: roleless person matched to a real PR via a simple JD',
      candidateEvidence: [
        {
          candidateId,
          evidenceId,
          episodeId,
          narrative:
            'Built a high-throughput Kafka consumer pipeline that processes payment events '
            + 'with exactly-once semantics and dead-letter queue handling.',
          concepts: ['term:kafka', 'term:event-driven-architecture', 'term:exactly-once-semantics'],
          mechanisms: ['term:consumer-group-rebalancing', 'term:idempotent-producer'],
          domains: ['term:payments', 'term:message-streaming'],
          businessObjects: ['term:payment-event', 'term:dead-letter-queue'],
          ownershipActions: ['term:implemented', 'term:owned'],
          evidenceReferences: [
            e2eSourceRef(
              'alice-evidence-1',
              'candidate-episode-transcript',
              'v1',
              'I built a Kafka consumer pipeline for payment events with exactly-once semantics.',
            ),
          ],
        },
      ],
      roleRequirements: [
        {
          roleId,
          requiredLanguages: ['typescript'],
          relevantConcepts: ['term:kafka', 'term:event-driven-architecture'],
          requiredConcepts: ['term:message-streaming'],
          sourceReferences: [
            e2eRoleSource(
              'jd-kafka',
              ['term:kafka', 'term:event-driven-architecture'],
              'We need someone to build event-driven services using Kafka for our payments platform.',
            ),
          ],
        },
      ],
      expertLabels: [
        {
          labelId: 'expert-label-e2e-1',
          candidateId,
          roleId,
          challengeId,
          relevanceGrade: 'highly_relevant',
          eligibleChallengeIds: [challengeId],
          explanation:
            'Alice has source-backed Kafka/payment-event experience that maps directly to the '
            + 'repo packet demand for exactly-once payment event processing.',
          labelVersion: '1.0.0',
          labeledAt: '2026-06-24T00:00:00Z',
          labeledBy: 'expert-reviewer-1',
          labelProvenance: {
            reviewerId: 'expert-reviewer-1',
            reviewerRole: 'senior-engineering-reviewer',
            reviewArtifactId: 'expert-review-e2e-1',
            reviewArtifactVersion: 'v1',
            contentHash: 'sha256:expert-review-e2e-1',
            locator: 'expert-review:e2e-1',
            rubricVersion: 'candidate-pr-match-rubric-v1',
          },
        },
      ],
      expectedPackets: [
        {
          challengeId,
          repoId,
          prNumber,
          sourceVersion,
          demands: [
            {
              demandId: 'demand-kafka-consumer',
              concepts: ['term:kafka', 'term:event-driven-architecture'],
              sourceRefs: [
                e2eSourceRef(
                  'pr-demand-1',
                  `repo-${repoId}`,
                  sourceVersion,
                  'Add Kafka consumer for payment events with exactly-once processing.',
                ),
              ],
            },
          ],
        },
      ],
      metadata: {
        totalLabels: 1,
        totalCandidates: 1,
        totalRoles: 1,
        totalChallenges: 1,
        syntheticFixtureCount: 0,
        totalExpectedPackets: 1,
      },
    };
  }

  function e2eRankedChallenge(): PersistedRankedChallenge {
    return {
      rank: 1,
      recallRank: 1,
      challengeId,
      repoId,
      prNumber,
      sourceVersion,
      score: 0.92,
      candidateEvidenceAlignment: 0.90,
      roleRelevance: 0.88,
      contextualSpecificity: 0.85,
      challengeQuality: 0.95,
      validationDeepeningValue: 0.80,
      alignedDemandCount: 1,
      stretchCount: 0,
      stretchDemandWeightRatio: 0,
      provenanceComplete: true,
      eligible: true,
      alignments: [
        {
          atomId: 'atom-alice-kafka',
          demandId: 'demand-kafka-consumer',
          pairScore: 0.92,
          pairScoreBreakdown: {
            semanticNarrative: 0.85,
            conceptCorrespondence: 1.0,
            problemMechanismCorrespondence: 0.90,
            domainBusinessContext: 0.88,
            ownershipActionCorrespondence: 0.95,
            total: 0.92,
          },
          weightedScore: 0.92,
          stretch: null,
          sharedConcepts: ['term:kafka', 'term:event-driven-architecture'],
          roleSourceRefs: [
            {
              entityId: 'jd-kafka',
              locator: 'simple_job_description:source_span:jd-jd-kafka',
              conceptKeys: ['term:kafka', 'term:event-driven-architecture'],
              sourceRefType: 'source_span',
              sourceRefId: 'role-source-span-jd-kafka',
              sourceSpanId: 'role-source-span-jd-kafka',
              exactText:
                'We need someone to build event-driven services using Kafka for our payments platform.',
              contentHash: 'sha256:role-jd-kafka',
            },
          ],
          candidateSourceRefs: [
            e2eSourceRef(
              'alice-evidence-1',
              'candidate-episode-transcript',
              'v1',
              'I built a Kafka consumer pipeline for payment events with exactly-once semantics.',
            ),
          ],
          challengeSourceRefs: [
            e2eSourceRef(
              'pr-247-diff',
              `repo-${repoId}`,
              sourceVersion,
              'Add Kafka consumer for payment events with exactly-once processing.',
            ),
          ],
        },
      ],
      rejectionReasons: [],
    };
  }

  function e2eMatchRun(runId: string): PersistedMatchRun {
    return {
      matchRunId: runId,
      candidateId,
      roleId,
      candidateSnapshotId: 'snapshot-alice-v1',
      policyVersion: 'candidate-pr-v1',
      modelVersion: null,
      status: 'MATCHED',
      rankedChallenges: [e2eRankedChallenge()],
    };
  }

  it('produces a valid corpus that loads without errors', () => {
    expect(() => loadCorpus(JSON.stringify(e2eCorpus()))).not.toThrow();
  });

  it('computes passing metrics with complete provenance and determinism', () => {
    const corpus = e2eCorpus();
    const primaryRun = e2eMatchRun('run-e2e-primary');
    const comparisonRun = e2eMatchRun('run-e2e-comparison');
    const metrics = evaluateMatchRuns(corpus, [primaryRun], [comparisonRun]);

    expect(metrics.recallAt50).toBe(1);
    expect(metrics.precisionAt3).toBe(1);
    expect(metrics.ndcgAt5).toBe(1);
    expect(metrics.guardrailViolationCount).toBe(0);
    expect(metrics.multiStretchViolationCount).toBe(0);
    expect(metrics.missingProvenanceCount).toBe(0);
    expect(metrics.missingMatchRunCount).toBe(0);
    expect(metrics.byteIdenticalRerun).toBe(true);
    expect(metrics.expertLabelCount).toBe(1);
    expect(metrics.syntheticFixtureCount).toBe(0);
  });

  it('surfaces the expected real repo packet with matching identity', () => {
    const corpus = e2eCorpus();
    const metrics = evaluateMatchRuns(corpus, [e2eMatchRun('run-e2e-primary')]);

    expect(metrics.expectedPacketCount).toBe(1);
    expect(metrics.packetCoverage).toBe(1);
    expect(metrics.missingPacketIds).toHaveLength(0);
    expect(metrics.packetIdentityMismatches).toHaveLength(0);
  });

  it('does not compare expected packet hashes to individual source span hashes', () => {
    const corpus = e2eCorpus();
    corpus.expectedPackets![0] = {
      ...corpus.expectedPackets![0]!,
      packetContentHash: 'sha256:whole-packet-hash-not-a-source-span-hash',
    };
    const metrics = evaluateMatchRuns(corpus, [e2eMatchRun('run-e2e-primary')]);

    expect(metrics.packetCoverage).toBe(1);
    expect(metrics.missingPacketIds).toHaveLength(0);
    expect(metrics.packetIdentityMismatches).toHaveLength(0);
  });

  it('detects packet identity drift when a persisted ranked result carries a different packet hash', () => {
    const corpus = e2eCorpus();
    corpus.expectedPackets![0] = {
      ...corpus.expectedPackets![0]!,
      packetContentHash: 'sha256:expected-whole-packet-hash',
    };
    const driftedRun: PersistedMatchRun = {
      ...e2eMatchRun('run-e2e-packet-hash-drift'),
      rankedChallenges: [{
        ...e2eRankedChallenge(),
        packetContentHash: 'sha256:actual-other-packet-hash',
      }],
    };
    const metrics = evaluateMatchRuns(corpus, [driftedRun]);

    expect(metrics.packetIdentityMismatches).toHaveLength(1);
    expect(metrics.packetIdentityMismatches[0]).toMatchObject({
      field: 'packetContentHash',
      expected: 'sha256:expected-whole-packet-hash',
      actual: 'sha256:actual-other-packet-hash',
    });
    expect(metrics.packetCoverage).toBe(0);
    expect(metrics.missingPacketIds).toContain(challengeId);
  });

  it('explains the candidate-to-PR match via alignment source references', () => {
    const corpus = e2eCorpus();
    const metrics = evaluateMatchRuns(corpus, [e2eMatchRun('run-e2e-primary')]);
    const labelResult = metrics.labelResults.find((r) => r.labelId === 'expert-label-e2e-1');
    expect(labelResult).toBeDefined();
    expect(labelResult?.passed).toBe(true);
    expect(labelResult?.actualRank).toBe(1);
    expect(labelResult?.provenanceComplete).toBe(true);
    expect(labelResult?.guardrailViolations).toHaveLength(0);

    // The match explanation links candidate evidence, JD, and PR content
    const run = e2eMatchRun('run-e2e-primary');
    const alignment = run.rankedChallenges[0]?.alignments[0];
    expect(alignment).toBeDefined();
    expect(alignment?.sharedConcepts).toEqual(
      expect.arrayContaining(['term:kafka', 'term:event-driven-architecture']),
    );
    expect(alignment?.candidateSourceRefs).toHaveLength(1);
    expect(alignment?.candidateSourceRefs[0]?.exactText).toContain('Kafka consumer pipeline');
    expect(alignment?.challengeSourceRefs).toHaveLength(1);
    expect(alignment?.challengeSourceRefs[0]?.exactText).toContain('Kafka consumer for payment events');
    expect(alignment?.roleSourceRefs).toHaveLength(1);
    expect(alignment?.roleSourceRefs[0]?.exactText).toContain('event-driven services using Kafka');
    expect(alignment?.pairScoreBreakdown).toBeDefined();
    expect(alignment?.pairScoreBreakdown?.conceptCorrespondence).toBe(1.0);
  });

  it('passes the production rollout gate', () => {
    const corpus = e2eCorpus();
    const primaryRun = e2eMatchRun('run-e2e-primary');
    const comparisonRun = e2eMatchRun('run-e2e-comparison');
    const metrics = evaluateMatchRuns(corpus, [primaryRun], [comparisonRun]);

    const gate = checkStagedRolloutGate(metrics, 'production');
    expect(gate.stage).toBe('production');
    expect(gate.ready).toBe(true);
    expect(gate.failures).toHaveLength(0);
  });

  it('detects packet identity drift when the PR number changes', () => {
    const corpus = e2eCorpus();
    const driftedRun: PersistedMatchRun = {
      ...e2eMatchRun('run-e2e-drift'),
      rankedChallenges: [{
        ...e2eRankedChallenge(),
        prNumber: 999,
      }],
    };
    const metrics = evaluateMatchRuns(corpus, [driftedRun]);

    expect(metrics.packetIdentityMismatches).toHaveLength(1);
    expect(metrics.packetIdentityMismatches[0]?.field).toBe('prNumber');
    expect(metrics.packetCoverage).toBe(0);
    expect(metrics.missingPacketIds).toContain(challengeId);
  });

  it('fails determinism when the comparison rerun has a different score', () => {
    const corpus = e2eCorpus();
    const primaryRun = e2eMatchRun('run-e2e-primary');
    const driftedComparison: PersistedMatchRun = {
      ...e2eMatchRun('run-e2e-comparison'),
      rankedChallenges: [{
        ...e2eRankedChallenge(),
        score: 0.50,
      }],
    };
    const metrics = evaluateMatchRuns(corpus, [primaryRun], [driftedComparison]);

    expect(metrics.byteIdenticalRerun).toBe(false);
    expect(metrics.determinismComparisons[0]?.identical).toBe(false);
  });
});
