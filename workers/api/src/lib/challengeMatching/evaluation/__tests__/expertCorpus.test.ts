import { describe, expect, it } from 'vitest';
import {
  validateCorpus,
  loadCorpus,
  getLabelsForCandidateRole,
  getCandidateEvidence,
  getRoleRequirements,
  getAllChallengeIds,
  CorpusValidationError,
} from '../corpus';
import type {
  EvaluationCorpus,
  ExpertLabel,
  CandidatePersonEvidence,
  RoleRequirements,
} from '../types';
import { EVALUATION_CORPUS_VERSION, DEFAULT_ACCEPTANCE_THRESHOLDS } from '../types';

function sourceRef(id: string) {
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

function makeEvidence(candidateId: string, evidenceId: string, concepts: string[]): CandidatePersonEvidence {
  return {
    candidateId,
    evidenceId,
    episodeId: `episode-${evidenceId}`,
    narrative: `Built a ${concepts.join(' and ')} system with production observability.`,
    concepts,
    problems: ['scalability'],
    mechanisms: ['horizontal-scaling'],
    domains: ['cloud-infrastructure'],
    businessObjects: ['service'],
    ownershipActions: ['designed'],
    evidenceReferences: [sourceRef(evidenceId)],
  };
}

function makeRole(roleId: string, languages: string[]): RoleRequirements {
  return {
    roleId,
    requiredLanguages: languages,
    relevantConcepts: ['term:kafka', 'term:event-sourcing'],
    genericConcepts: ['term:javascript'],
    sourceReferences: [{
      entityId: `role-entity-${roleId}`,
      locator: `jd:${roleId}:line:1`,
      conceptKeys: ['term:kafka', 'term:event-sourcing'],
    }],
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
    labeledAt: '2026-06-21T10:00:00.000Z',
    labeledBy: 'expert-engineer-1',
  };
}

function makeMinimalCorpus(): EvaluationCorpus {
  const candidateEvidence = [
    makeEvidence('candidate-alice', 'ev-alice-1', ['term:kafka', 'term:event-sourcing']),
    makeEvidence('candidate-alice', 'ev-alice-2', ['term:react', 'term:typescript']),
    makeEvidence('candidate-bob', 'ev-bob-1', ['term:rust', 'term:systems-programming']),
  ];

  const roleRequirements = [
    makeRole('role-backend-sr', ['typescript']),
  ];

  const eligibleChallengeIds = ['challenge-kafka-pr', 'challenge-eventsource-pr'];
  const expertLabels = [
    makeLabel('candidate-alice', 'role-backend-sr', 'challenge-kafka-pr', 'highly_relevant', eligibleChallengeIds),
    makeLabel('candidate-alice', 'role-backend-sr', 'challenge-eventsource-pr', 'relevant', eligibleChallengeIds),
    makeLabel('candidate-bob', 'role-backend-sr', 'challenge-kafka-pr', 'irrelevant', []),
  ];

  return {
    version: EVALUATION_CORPUS_VERSION,
    corpusId: 'expert-corpus-v1-minimal',
    createdAt: '2026-06-21T10:00:00.000Z',
    description: 'Minimal expert-labelled corpus for acceptance criterion #8',
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
  };
}

describe('expert-labelled evaluation corpus — acceptance criterion #8', () => {
  it('minimal expert corpus passes validation', () => {
    const corpus = makeMinimalCorpus();
    expect(() => validateCorpus(corpus)).not.toThrow();
  });

  it('corpus round-trips through JSON serialization', () => {
    const corpus = makeMinimalCorpus();
    const json = JSON.stringify(corpus);
    const loaded = loadCorpus(json);
    expect(loaded.corpusId).toBe(corpus.corpusId);
    expect(loaded.expertLabels.length).toBe(corpus.expertLabels.length);
    expect(loaded.candidateEvidence.length).toBe(corpus.candidateEvidence.length);
  });

  it('rejects corpus with synthetic-only labels when expert labels are required', () => {
    const corpus = makeMinimalCorpus();
    for (const label of corpus.expertLabels) {
      label.labeledBy = 'synthetic-fixture';
    }
    corpus.metadata.syntheticFixtureCount = corpus.expertLabels.length;
    expect(() => validateCorpus(corpus)).not.toThrow();

    expect(DEFAULT_ACCEPTANCE_THRESHOLDS.requireExpertLabels).toBe(true);
  });

  it('rejects corpus with missing evidence source references', () => {
    const corpus = makeMinimalCorpus();
    corpus.candidateEvidence[0]!.evidenceReferences = [];
    expect(() => validateCorpus(corpus)).toThrow(CorpusValidationError);
  });

  it('rejects corpus with duplicate evidence IDs', () => {
    const corpus = makeMinimalCorpus();
    corpus.candidateEvidence.push({
      ...corpus.candidateEvidence[0]!,
    });
    expect(() => validateCorpus(corpus)).toThrow(CorpusValidationError);
  });

  it('rejects corpus with unknown candidate in label', () => {
    const corpus = makeMinimalCorpus();
    corpus.expertLabels.push(
      makeLabel('candidate-unknown', 'role-backend-sr', 'challenge-new', 'borderline', ['challenge-new']),
    );
    corpus.metadata.totalLabels = corpus.expertLabels.length;
    corpus.metadata.totalChallenges = 3;
    expect(() => validateCorpus(corpus)).toThrow(CorpusValidationError);
  });

  it('rejects forbidden label without guardrail violations', () => {
    const corpus = makeMinimalCorpus();
    const badLabel = makeLabel(
      'candidate-alice', 'role-backend-sr', 'challenge-forbidden', 'forbidden', [],
    );
    badLabel.guardrailViolations = [];
    corpus.expertLabels.push(badLabel);
    corpus.metadata.totalLabels = corpus.expertLabels.length;
    corpus.metadata.totalChallenges = 3;
    expect(() => validateCorpus(corpus)).toThrow(CorpusValidationError);
  });

  it('getLabelsForCandidateRole returns only matching labels', () => {
    const corpus = makeMinimalCorpus();
    const aliceLabels = getLabelsForCandidateRole(corpus, 'candidate-alice', 'role-backend-sr');
    expect(aliceLabels.length).toBe(2);
    const bobLabels = getLabelsForCandidateRole(corpus, 'candidate-bob', 'role-backend-sr');
    expect(bobLabels.length).toBe(1);
    expect(bobLabels[0]!.relevanceGrade).toBe('irrelevant');
  });

  it('getCandidateEvidence returns all evidence for a candidate', () => {
    const corpus = makeMinimalCorpus();
    const aliceEvidence = getCandidateEvidence(corpus, 'candidate-alice');
    expect(aliceEvidence.length).toBe(2);
    const bobEvidence = getCandidateEvidence(corpus, 'candidate-bob');
    expect(bobEvidence.length).toBe(1);
  });

  it('getRoleRequirements returns the correct role', () => {
    const corpus = makeMinimalCorpus();
    const role = getRoleRequirements(corpus, 'role-backend-sr');
    expect(role).toBeDefined();
    expect(role?.requiredLanguages).toContain('typescript');
    expect(getRoleRequirements(corpus, 'nonexistent')).toBeUndefined();
  });

  it('getAllChallengeIds returns all referenced challenges', () => {
    const corpus = makeMinimalCorpus();
    const ids = getAllChallengeIds(corpus);
    expect(ids).toContain('challenge-kafka-pr');
    expect(ids).toContain('challenge-eventsource-pr');
    expect(ids.length).toBe(2);
  });

  it('corpus metadata counts are validated against actual data', () => {
    const corpus = makeMinimalCorpus();
    corpus.metadata.totalLabels = 999;
    expect(() => validateCorpus(corpus)).toThrow(CorpusValidationError);
  });

  it('evidence references must have immutable source identity', () => {
    const corpus = makeMinimalCorpus();
    corpus.candidateEvidence[0]!.evidenceReferences = [{
      artifactId: '',
      artifactVersion: '',
      contentHash: '',
      startOffset: 0,
      endOffset: 10,
    }];
    expect(() => validateCorpus(corpus)).toThrow(CorpusValidationError);
  });

  it('role requirements must have persisted source references', () => {
    const corpus = makeMinimalCorpus();
    corpus.roleRequirements[0]!.sourceReferences = [];
    expect(() => validateCorpus(corpus)).toThrow(CorpusValidationError);
  });
});
