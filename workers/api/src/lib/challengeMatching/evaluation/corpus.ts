import type {
  CandidatePersonEvidence,
  EvaluationCorpus,
  ExpertLabel,
  RelevanceGrade,
  RoleRequirements,
} from './types';
import { EVALUATION_CORPUS_VERSION } from './types';

export class CorpusValidationError extends Error {
  readonly failures: string[];

  constructor(failures: string[]) {
    super(`Corpus validation failed: ${failures.join('; ')}`);
    this.name = 'CorpusValidationError';
    this.failures = failures;
  }
}

function pairKey(candidateId: string, roleId: string): string {
  return JSON.stringify([candidateId, roleId]);
}

function sameStringSet(left: string[], right: string[]): boolean {
  const normalize = (values: string[]) => Array.from(new Set(values)).sort();
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

export function validateCorpus(corpus: EvaluationCorpus): void {
  const failures: string[] = [];
  if (!corpus || typeof corpus !== 'object') {
    throw new CorpusValidationError(['corpus must be an object']);
  }
  if (corpus.version !== EVALUATION_CORPUS_VERSION) {
    failures.push(`version mismatch: expected ${EVALUATION_CORPUS_VERSION}, got ${String(corpus.version)}`);
  }
  if (!corpus.corpusId) failures.push('corpusId is required');
  if (!corpus.createdAt) failures.push('createdAt is required');
  if (!Array.isArray(corpus.candidateEvidence)) failures.push('candidateEvidence must be an array');
  if (!Array.isArray(corpus.roleRequirements)) failures.push('roleRequirements must be an array');
  if (!Array.isArray(corpus.expertLabels)) failures.push('expertLabels must be an array');
  if (failures.length > 0) throw new CorpusValidationError(failures);

  const evidenceIds = new Set<string>();
  const candidateIds = new Set<string>();
  for (const evidence of corpus.candidateEvidence) {
    candidateIds.add(evidence.candidateId);
    if (!evidence.candidateId || !evidence.evidenceId || !evidence.episodeId) {
      failures.push(`candidate evidence is missing required IDs: ${evidence.evidenceId || '(unknown)'}`);
    }
    if (evidenceIds.has(evidence.evidenceId)) {
      failures.push(`duplicate evidenceId: ${evidence.evidenceId}`);
    }
    evidenceIds.add(evidence.evidenceId);
    if (!Array.isArray(evidence.concepts)) {
      failures.push(`evidence concepts must be an array: ${evidence.evidenceId}`);
    }
    if (!Array.isArray(evidence.evidenceReferences) || evidence.evidenceReferences.length === 0) {
      failures.push(`evidence must contain source references: ${evidence.evidenceId}`);
      continue;
    }
    for (const reference of evidence.evidenceReferences) {
      if (!reference.artifactId || !reference.artifactVersion || !reference.contentHash) {
        failures.push(`evidence reference missing immutable source identity: ${evidence.evidenceId}`);
      }
      if (
        !Number.isInteger(reference.startOffset)
        || !Number.isInteger(reference.endOffset)
        || reference.startOffset < 0
        || reference.endOffset <= reference.startOffset
      ) {
        failures.push(`evidence reference offsets invalid: ${evidence.evidenceId}`);
      }
    }
  }

  const roleIds = new Set<string>();
  for (const role of corpus.roleRequirements) {
    if (!role.roleId) failures.push('role requirement is missing roleId');
    if (roleIds.has(role.roleId)) failures.push(`duplicate roleId: ${role.roleId}`);
    roleIds.add(role.roleId);
    if (!Array.isArray(role.requiredLanguages)) {
      failures.push(`role requiredLanguages must be an array: ${role.roleId}`);
    }
    if (!Array.isArray(role.sourceReferences) || role.sourceReferences.length === 0) {
      failures.push(`role must contain persisted source references: ${role.roleId}`);
    }
  }

  const validGrades = new Set<RelevanceGrade>([
    'highly_relevant',
    'relevant',
    'borderline',
    'irrelevant',
    'forbidden',
  ]);
  const labelIds = new Set<string>();
  const labeledTriples = new Set<string>();
  const challengeIds = new Set<string>();
  const eligibleByPair = new Map<string, string[]>();
  for (const label of corpus.expertLabels) {
    if (!label.labelId || !label.candidateId || !label.roleId || !label.challengeId) {
      failures.push(`expert label is missing required IDs: ${label.labelId || '(unknown)'}`);
    }
    if (labelIds.has(label.labelId)) failures.push(`duplicate labelId: ${label.labelId}`);
    labelIds.add(label.labelId);
    const triple = JSON.stringify([label.candidateId, label.roleId, label.challengeId]);
    if (labeledTriples.has(triple)) {
      failures.push(`duplicate candidate-role-challenge label: ${triple}`);
    }
    labeledTriples.add(triple);
    if (!candidateIds.has(label.candidateId)) {
      failures.push(`label references unknown candidate: ${label.candidateId}`);
    }
    if (!roleIds.has(label.roleId)) {
      failures.push(`label references unknown role: ${label.roleId}`);
    }
    if (!validGrades.has(label.relevanceGrade)) {
      failures.push(`label has invalid relevanceGrade: ${String(label.relevanceGrade)}`);
    }
    if (!label.labeledBy || !label.labelVersion || !label.labeledAt) {
      failures.push(`label is missing labeling provenance: ${label.labelId}`);
    }
    if (!Array.isArray(label.eligibleChallengeIds)) {
      failures.push(`eligibleChallengeIds must be an array: ${label.labelId}`);
      continue;
    }
    const pair = pairKey(label.candidateId, label.roleId);
    const priorEligible = eligibleByPair.get(pair);
    if (priorEligible && !sameStringSet(priorEligible, label.eligibleChallengeIds)) {
      failures.push(`eligible challenge set is inconsistent for ${pair}`);
    } else {
      eligibleByPair.set(pair, label.eligibleChallengeIds);
    }
    const shouldBeEligible = label.relevanceGrade === 'highly_relevant'
      || label.relevanceGrade === 'relevant'
      || label.relevanceGrade === 'borderline';
    if (shouldBeEligible !== label.eligibleChallengeIds.includes(label.challengeId)) {
      failures.push(`label eligibility contradicts relevance grade: ${label.labelId}`);
    }
    if (
      label.relevanceGrade === 'forbidden'
      && (!label.guardrailViolations || label.guardrailViolations.length === 0)
    ) {
      failures.push(`forbidden label must specify guardrail violations: ${label.labelId}`);
    }
    challengeIds.add(label.challengeId);
    label.eligibleChallengeIds.forEach((id) => challengeIds.add(id));
  }

  const syntheticCount = corpus.expertLabels.filter(
    (label) => label.labeledBy === 'synthetic-fixture',
  ).length;
  if (corpus.metadata.totalLabels !== corpus.expertLabels.length) {
    failures.push('metadata.totalLabels does not match expertLabels');
  }
  if (corpus.metadata.totalCandidates !== candidateIds.size) {
    failures.push('metadata.totalCandidates does not match candidate evidence');
  }
  if (corpus.metadata.totalRoles !== roleIds.size) {
    failures.push('metadata.totalRoles does not match role requirements');
  }
  if (corpus.metadata.totalChallenges !== challengeIds.size) {
    failures.push('metadata.totalChallenges does not match labeled and eligible challenges');
  }
  if (corpus.metadata.syntheticFixtureCount !== syntheticCount) {
    failures.push('metadata.syntheticFixtureCount does not match labeling provenance');
  }
  if (failures.length > 0) throw new CorpusValidationError(failures);
}

export function loadCorpus(json: string): EvaluationCorpus {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new Error(
      `Failed to parse corpus JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  validateCorpus(parsed as EvaluationCorpus);
  return parsed as EvaluationCorpus;
}

export function getLabelsForCandidateRole(
  corpus: EvaluationCorpus,
  candidateId: string,
  roleId: string,
): ExpertLabel[] {
  return corpus.expertLabels.filter(
    (label) => label.candidateId === candidateId && label.roleId === roleId,
  );
}

export function getCandidateEvidence(
  corpus: EvaluationCorpus,
  candidateId: string,
): CandidatePersonEvidence[] {
  return corpus.candidateEvidence.filter((evidence) => evidence.candidateId === candidateId);
}

export function getRoleRequirements(
  corpus: EvaluationCorpus,
  roleId: string,
): RoleRequirements | undefined {
  return corpus.roleRequirements.find((role) => role.roleId === roleId);
}

export function getAllChallengeIds(corpus: EvaluationCorpus): string[] {
  const challengeSet = new Set(
    corpus.expertLabels.flatMap((label) => [
      label.challengeId,
      ...label.eligibleChallengeIds,
    ]),
  );
  return Array.from(challengeSet).sort();
}
