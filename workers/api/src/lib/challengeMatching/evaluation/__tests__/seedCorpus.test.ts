import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadCorpus, getAllChallengeIds, getLabelsForCandidateRole, getCandidateEvidence, getRoleRequirements } from '../corpus';
import type { EvaluationCorpus } from '../types';

const corpusJson = readFileSync(
  new URL('../fixtures/seed-corpus-v1.json', import.meta.url),
  'utf8',
);

describe('seed corpus v1 — production evaluation baseline', () => {
  let corpus: EvaluationCorpus;

  it('loads and validates without error', () => {
    corpus = loadCorpus(corpusJson);
    expect(corpus.corpusId).toBe('seed-corpus-v1-2026-06');
    expect(corpus.version).toBe('1.0.0');
  });

  it('contains expected candidate/role/challenge counts', () => {
    corpus = loadCorpus(corpusJson);
    expect(corpus.metadata.totalCandidates).toBe(3);
    expect(corpus.metadata.totalRoles).toBe(2);
    expect(corpus.metadata.totalChallenges).toBe(5);
    expect(corpus.metadata.totalLabels).toBe(9);
    expect(corpus.metadata.syntheticFixtureCount).toBe(0);
  });

  it('all evidence has immutable source identity', () => {
    corpus = loadCorpus(corpusJson);
    for (const evidence of corpus.candidateEvidence) {
      for (const ref of evidence.evidenceReferences) {
        expect(ref.artifactId).toBeTruthy();
        expect(ref.artifactVersion).toBeTruthy();
        expect(ref.contentHash).toMatch(/^sha256-/);
        expect(ref.endOffset).toBeGreaterThan(ref.startOffset);
      }
    }
  });

  it('role requirements have persisted source references', () => {
    corpus = loadCorpus(corpusJson);
    for (const role of corpus.roleRequirements) {
      expect(role.sourceReferences.length).toBeGreaterThan(0);
      for (const ref of role.sourceReferences) {
        expect(ref.entityId).toBeTruthy();
        expect(ref.locator).toBeTruthy();
        expect(ref.conceptKeys.length).toBeGreaterThan(0);
      }
    }
  });

  it('platform eng is highly relevant for kafka and k8s challenges', () => {
    corpus = loadCorpus(corpusJson);
    const labels = getLabelsForCandidateRole(corpus, 'cand-platform-eng-001', 'role-senior-platform-eng');
    const kafkaLabel = labels.find((l) => l.challengeId === 'challenge-kafka-consumer-pr-101');
    const k8sLabel = labels.find((l) => l.challengeId === 'challenge-k8s-operator-pr-202');
    expect(kafkaLabel?.relevanceGrade).toBe('highly_relevant');
    expect(k8sLabel?.relevanceGrade).toBe('highly_relevant');
  });

  it('frontend eng is irrelevant for kafka challenge', () => {
    corpus = loadCorpus(corpusJson);
    const labels = getLabelsForCandidateRole(corpus, 'cand-frontend-eng-002', 'role-staff-frontend-eng');
    const kafkaLabel = labels.find((l) => l.challengeId === 'challenge-kafka-consumer-pr-101');
    expect(kafkaLabel?.relevanceGrade).toBe('irrelevant');
  });

  it('data eng is borderline for kafka but irrelevant for k8s', () => {
    corpus = loadCorpus(corpusJson);
    const labels = getLabelsForCandidateRole(corpus, 'cand-data-eng-003', 'role-senior-platform-eng');
    const kafkaLabel = labels.find((l) => l.challengeId === 'challenge-kafka-consumer-pr-101');
    const k8sLabel = labels.find((l) => l.challengeId === 'challenge-k8s-operator-pr-202');
    expect(kafkaLabel?.relevanceGrade).toBe('borderline');
    expect(k8sLabel?.relevanceGrade).toBe('irrelevant');
  });

  it('retrieves candidate evidence with full provenance', () => {
    corpus = loadCorpus(corpusJson);
    const platformEvidence = getCandidateEvidence(corpus, 'cand-platform-eng-001');
    expect(platformEvidence).toHaveLength(3);
    expect(platformEvidence.every((e) => e.evidenceReferences.length > 0)).toBe(true);
    expect(platformEvidence.every((e) => e.concepts.length > 0)).toBe(true);
  });

  it('retrieves role requirements with concept keys', () => {
    corpus = loadCorpus(corpusJson);
    const platformRole = getRoleRequirements(corpus, 'role-senior-platform-eng');
    expect(platformRole).toBeDefined();
    expect(platformRole!.requiredLanguages).toContain('Go');
    expect(platformRole!.requiredConcepts).toContain('term:kafka');
  });

  it('identifies all challenge IDs from labels and eligible sets', () => {
    corpus = loadCorpus(corpusJson);
    const challenges = getAllChallengeIds(corpus);
    expect(challenges).toContain('challenge-kafka-consumer-pr-101');
    expect(challenges).toContain('challenge-k8s-operator-pr-202');
    expect(challenges).toContain('challenge-react-design-system-pr-303');
    expect(challenges).toContain('challenge-virtualized-list-pr-404');
    expect(challenges).toContain('challenge-schema-evolution-pr-505');
    expect(challenges).toHaveLength(5);
  });

  it('eligible challenge sets are consistent within candidate-role pairs', () => {
    corpus = loadCorpus(corpusJson);
    const pairs = [
      ['cand-platform-eng-001', 'role-senior-platform-eng'],
      ['cand-frontend-eng-002', 'role-staff-frontend-eng'],
      ['cand-data-eng-003', 'role-senior-platform-eng'],
    ] as const;
    for (const [candidateId, roleId] of pairs) {
      const labels = getLabelsForCandidateRole(corpus, candidateId, roleId);
      const eligibleSets = labels.map((l) => [...l.eligibleChallengeIds].sort());
      const first = JSON.stringify(eligibleSets[0]);
      for (const set of eligibleSets) {
        expect(JSON.stringify(set)).toBe(first);
      }
    }
  });
});
