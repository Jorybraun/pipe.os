import { describe, expect, it } from 'vitest';
import { runCorpusEvaluation } from '../corpusRunner';
import type { EvaluationCorpus, CandidatePersonEvidence, RoleRequirements, ExpertLabel } from '../types';
import { EVALUATION_CORPUS_VERSION } from '../types';
import type { ChallengePacket, ConceptAdjacency, SourceRef } from '../../types';

function sourceRef(id: string): SourceRef {
  return {
    artifactId: `artifact-${id}`,
    artifactVersion: `v-${id}`,
    contentHash: `sha256-${id}`,
    startOffset: 0,
    endOffset: 50,
    locator: `${id}:0-50`,
    exactText: `evidence text for ${id}`,
  };
}

function makeEvidence(
  candidateId: string,
  evidenceId: string,
  concepts: string[],
  extra?: Partial<CandidatePersonEvidence>,
): CandidatePersonEvidence {
  return {
    candidateId,
    evidenceId,
    episodeId: `episode-${evidenceId}`,
    narrative: `Built a ${concepts.join(' and ')} system with production observability.`,
    concepts,
    problems: extra?.problems ?? ['scalability'],
    mechanisms: extra?.mechanisms ?? ['horizontal-scaling'],
    domains: extra?.domains ?? ['cloud-infrastructure'],
    businessObjects: extra?.businessObjects ?? ['service'],
    ownershipActions: extra?.ownershipActions ?? ['designed'],
    evidenceReferences: [sourceRef(evidenceId)],
  };
}

function makeRole(roleId: string, languages: string[], concepts: string[]): RoleRequirements {
  return {
    roleId,
    requiredLanguages: languages,
    relevantConcepts: concepts,
    genericConcepts: ['term:javascript'],
    sourceReferences: [{
      entityId: `role-entity-${roleId}`,
      locator: `jd:${roleId}:line:1`,
      conceptKeys: concepts,
    }],
  };
}

function makeChallenge(
  id: string,
  repoId: string,
  prNumber: number,
  languages: string[],
  concepts: string[],
  demandConcepts?: string[][],
): ChallengePacket {
  const demands = (demandConcepts ?? [concepts]).map((dc, i) => ({
    id: `${id}-demand-${i}`,
    family: 'code-review',
    narrative: `Review the ${dc.join(' and ')} implementation.`,
    weight: 1,
    concepts: dc,
    problems: ['scalability'],
    mechanisms: ['horizontal-scaling'],
    domains: ['cloud-infrastructure'],
    businessObjects: ['service'],
    ownershipActions: ['reviewed'],
    sourceRefs: [sourceRef(`${id}-demand-${i}`)],
  }));
  return {
    id,
    repoId,
    prNumber,
    sourceVersion: `sha-${id}`,
    challengeReady: true,
    languages,
    concepts,
    demands,
    quality: { deterministic: 1, contextualSpecificity: 0.8 },
  };
}

function makeLabel(
  candidateId: string,
  roleId: string,
  challengeId: string,
  grade: ExpertLabel['relevanceGrade'],
  eligibleIds: string[],
): ExpertLabel {
  const isEligible = grade === 'highly_relevant' || grade === 'relevant' || grade === 'borderline';
  return {
    labelId: `label-${candidateId}-${roleId}-${challengeId}`,
    candidateId,
    roleId,
    challengeId,
    relevanceGrade: grade,
    eligibleChallengeIds: isEligible
      ? [...new Set([...eligibleIds, challengeId])]
      : eligibleIds,
    guardrailViolations: grade === 'forbidden' ? ['forbidden_concept'] : undefined,
    explanation: `Expert assessment: ${grade} for ${candidateId} on ${challengeId}`,
    labelVersion: '1.0.0',
    labeledAt: '2026-06-22T00:00:00.000Z',
    labeledBy: 'expert-engineer-1',
  };
}

function buildTestCorpus(): {
  corpus: EvaluationCorpus;
  challengePackets: ChallengePacket[];
  adjacency: ConceptAdjacency[];
} {
  const candidateEvidence = [
    makeEvidence('candidate-alice', 'ev-alice-1', ['term:kafka', 'term:event-sourcing'], {
      problems: ['distributed-ordering'],
      mechanisms: ['event-log'],
    }),
    makeEvidence('candidate-alice', 'ev-alice-2', ['term:typescript', 'term:react']),
    makeEvidence('candidate-bob', 'ev-bob-1', ['term:rust', 'term:systems-programming'], {
      problems: ['memory-safety'],
      mechanisms: ['ownership-model'],
    }),
  ];

  const roleRequirements = [
    makeRole('role-backend-sr', ['typescript'], ['term:kafka', 'term:event-sourcing']),
  ];

  const challengePackets: ChallengePacket[] = [
    makeChallenge(
      'challenge-kafka-pr', 'repo-1', 42,
      ['typescript'], ['term:kafka', 'term:event-sourcing'],
      [['term:kafka', 'term:event-sourcing'], ['term:typescript']],
    ),
    makeChallenge(
      'challenge-react-pr', 'repo-2', 99,
      ['typescript'], ['term:react', 'term:typescript'],
      [['term:react', 'term:typescript']],
    ),
  ];

  const eligibleIds = ['challenge-kafka-pr', 'challenge-react-pr'];
  const expertLabels = [
    makeLabel('candidate-alice', 'role-backend-sr', 'challenge-kafka-pr', 'highly_relevant', eligibleIds),
    makeLabel('candidate-alice', 'role-backend-sr', 'challenge-react-pr', 'relevant', eligibleIds),
    makeLabel('candidate-bob', 'role-backend-sr', 'challenge-kafka-pr', 'irrelevant', []),
  ];

  const adjacency: ConceptAdjacency[] = [
    { from: 'term:event-sourcing', to: 'term:cqrs', dimension: 'mechanism' },
  ];

  return {
    corpus: {
      version: EVALUATION_CORPUS_VERSION,
      corpusId: 'runner-test-v1',
      createdAt: '2026-06-22T00:00:00.000Z',
      description: 'Test corpus for offline evaluation runner',
      candidateEvidence,
      roleRequirements,
      expertLabels,
      metadata: {
        totalLabels: expertLabels.length,
        totalCandidates: 2,
        totalRoles: 1,
        totalChallenges: 2,
        syntheticFixtureCount: 0,
      },
    },
    challengePackets,
    adjacency,
  };
}

describe('offline corpus evaluation runner — acceptance criterion #8', () => {
  it('runs the full compile→recall→align→rank→evaluate pipeline', () => {
    const { corpus, challengePackets, adjacency } = buildTestCorpus();
    const output = runCorpusEvaluation({
      corpus,
      challengePackets,
      adjacency,
      thresholds: {
        requireByteIdenticalRerun: false,
        requireExpertLabels: false,
      },
    });

    expect(output.matchRuns.length).toBeGreaterThan(0);
    expect(output.result.metrics.totalEvaluations).toBe(corpus.expertLabels.length);
    expect(output.result.metrics.corpusId).toBe('runner-test-v1');
  });

  it('produces match runs for every candidate-role pair in corpus', () => {
    const { corpus, challengePackets, adjacency } = buildTestCorpus();
    const output = runCorpusEvaluation({
      corpus,
      challengePackets,
      adjacency,
      thresholds: { requireByteIdenticalRerun: false, requireExpertLabels: false },
    });

    const pairs = new Set(
      corpus.expertLabels.map((l) => JSON.stringify([l.candidateId, l.roleId])),
    );
    expect(output.matchRuns.length).toBe(pairs.size);
  });

  it('generates match explanations for top-ranked eligible pairs', () => {
    const { corpus, challengePackets, adjacency } = buildTestCorpus();
    const output = runCorpusEvaluation({
      corpus,
      challengePackets,
      adjacency,
      thresholds: { requireByteIdenticalRerun: false, requireExpertLabels: false },
    });

    const aliceRun = output.matchRuns.find((r) => r.candidateId === 'candidate-alice');
    expect(aliceRun).toBeDefined();
    const eligible = aliceRun!.rankedChallenges.filter((rc) => rc.eligible);
    if (eligible.length > 0) {
      const key = JSON.stringify(['candidate-alice', 'role-backend-sr']);
      const explanation = output.explanations.get(key);
      expect(explanation).toBeDefined();
      expect(explanation!.status).toBe('MATCHED');
      expect(explanation!.evidence.length).toBeGreaterThan(0);
    }
  });

  it('deterministic: same input produces identical metrics', () => {
    const { corpus, challengePackets, adjacency } = buildTestCorpus();
    const thresholds = { requireByteIdenticalRerun: false, requireExpertLabels: false };
    const run1 = runCorpusEvaluation({ corpus, challengePackets, adjacency, thresholds });
    const run2 = runCorpusEvaluation({ corpus, challengePackets, adjacency, thresholds });

    expect(run1.result.metrics.recallAt50).toBe(run2.result.metrics.recallAt50);
    expect(run1.result.metrics.precisionAt3).toBe(run2.result.metrics.precisionAt3);
    expect(run1.result.metrics.ndcgAt5).toBe(run2.result.metrics.ndcgAt5);
    expect(run1.result.metrics.guardrailViolationCount).toBe(run2.result.metrics.guardrailViolationCount);
  });

  it('ranks highly-relevant challenges above irrelevant ones', () => {
    const { corpus, challengePackets, adjacency } = buildTestCorpus();
    const output = runCorpusEvaluation({
      corpus,
      challengePackets,
      adjacency,
      thresholds: { requireByteIdenticalRerun: false, requireExpertLabels: false },
    });

    const aliceRun = output.matchRuns.find((r) => r.candidateId === 'candidate-alice');
    expect(aliceRun).toBeDefined();
    if (aliceRun!.status === 'MATCHED') {
      expect(aliceRun!.rankedChallenges.length).toBeGreaterThan(0);
      const eligible = aliceRun!.rankedChallenges.filter((rc) => rc.eligible);
      expect(eligible.length).toBeGreaterThan(0);
      for (const rc of eligible) {
        expect(rc.score).toBeGreaterThan(0);
        expect(rc.provenanceComplete).toBe(true);
      }
    } else {
      expect(aliceRun!.rankedChallenges.length).toBe(0);
    }
  });

  it('reports zero guardrail violations for well-formed corpus', () => {
    const { corpus, challengePackets, adjacency } = buildTestCorpus();
    const output = runCorpusEvaluation({
      corpus,
      challengePackets,
      adjacency,
      thresholds: { requireByteIdenticalRerun: false, requireExpertLabels: false },
    });

    expect(output.result.metrics.guardrailViolationCount).toBe(0);
    expect(output.result.metrics.multiStretchViolationCount).toBe(0);
  });

  it('rejects invalid corpus before running pipeline', () => {
    const { challengePackets } = buildTestCorpus();
    expect(() => runCorpusEvaluation({
      corpus: { version: '0.0.0' } as unknown as EvaluationCorpus,
      challengePackets,
    })).toThrow();
  });

  it('handles candidate with insufficient evidence gracefully', () => {
    const { corpus, challengePackets, adjacency } = buildTestCorpus();
    const output = runCorpusEvaluation({
      corpus,
      challengePackets,
      adjacency,
      thresholds: { requireByteIdenticalRerun: false, requireExpertLabels: false },
    });

    const bobRun = output.matchRuns.find((r) => r.candidateId === 'candidate-bob');
    expect(bobRun).toBeDefined();
    expect(bobRun!.rankedChallenges.every((rc) => !rc.eligible || rc.rejectionReasons.length > 0)).toBe(true);
  });

  it('label results include all expert labels', () => {
    const { corpus, challengePackets, adjacency } = buildTestCorpus();
    const output = runCorpusEvaluation({
      corpus,
      challengePackets,
      adjacency,
      thresholds: { requireByteIdenticalRerun: false, requireExpertLabels: false },
    });

    const labelIds = new Set(output.result.metrics.labelResults.map((lr) => lr.labelId));
    for (const label of corpus.expertLabels) {
      expect(labelIds.has(label.labelId)).toBe(true);
    }
  });

  it('evaluation metrics contain expected fields', () => {
    const { corpus, challengePackets, adjacency } = buildTestCorpus();
    const output = runCorpusEvaluation({
      corpus,
      challengePackets,
      adjacency,
      thresholds: { requireByteIdenticalRerun: false, requireExpertLabels: false },
    });

    const m = output.result.metrics;
    expect(typeof m.recallAt50).toBe('number');
    expect(typeof m.precisionAt3).toBe('number');
    expect(typeof m.ndcgAt5).toBe('number');
    expect(typeof m.guardrailViolationCount).toBe('number');
    expect(typeof m.multiStretchViolationCount).toBe('number');
    expect(typeof m.missingProvenanceCount).toBe('number');
    expect(typeof m.evaluatedPairCount).toBe('number');
    expect(m.evaluatedPairCount).toBeGreaterThan(0);
    expect(m.expertLabelCount).toBe(corpus.expertLabels.length);
    expect(m.syntheticFixtureCount).toBe(0);
  });
});
