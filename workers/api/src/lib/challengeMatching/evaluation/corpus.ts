import type {
  CandidatePersonEvidence,
  EvaluationCorpus,
  EvidenceReference,
  ExpectedChallengePacket,
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

export class ProductionCorpusValidationError extends Error {
  readonly failures: string[];

  constructor(failures: string[]) {
    super(`Production corpus validation failed: ${failures.join('; ')}`);
    this.name = 'ProductionCorpusValidationError';
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

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function sourceRefComplete(reference: EvidenceReference): boolean {
  return nonEmptyString(reference.artifactId)
    && nonEmptyString(reference.artifactVersion)
    && nonEmptyString(reference.contentHash)
    && nonEmptyString(reference.sourceRefType)
    && nonEmptyString(reference.sourceRefId)
    && nonEmptyString(reference.exactText)
    && Number.isInteger(reference.startOffset)
    && Number.isInteger(reference.endOffset)
    && reference.startOffset >= 0
    && reference.endOffset > reference.startOffset;
}

function roleSourceComplete(reference: RoleRequirements['sourceReferences'][number]): boolean {
  return nonEmptyString(reference.entityId)
    && nonEmptyString(reference.locator)
    && Array.isArray(reference.conceptKeys)
    && reference.conceptKeys.length > 0
    && nonEmptyString(reference.sourceRefType)
    && nonEmptyString(reference.sourceRefId)
    && nonEmptyString(reference.exactText)
    && nonEmptyString(reference.contentHash);
}

function positiveLabel(label: ExpertLabel): boolean {
  return label.relevanceGrade === 'highly_relevant' || label.relevanceGrade === 'relevant';
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
      if (!sourceRefComplete(reference)) {
        failures.push(`evidence reference missing exact immutable source provenance: ${evidence.evidenceId}`);
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
      continue;
    }
    for (const reference of role.sourceReferences) {
      if (!roleSourceComplete(reference)) {
        failures.push(`role source reference missing exact immutable source provenance: ${role.roleId}`);
      }
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
    if (label.negativeCandidateId !== undefined && !candidateIds.has(label.negativeCandidateId)) {
      failures.push(`label references unknown negative candidate: ${label.labelId}`);
    }
    if (
      label.minimumScoreSeparation !== undefined
      && (!Number.isFinite(label.minimumScoreSeparation) || label.minimumScoreSeparation < 0)
    ) {
      failures.push(`label minimumScoreSeparation must be a non-negative finite number: ${label.labelId}`);
    }
    if (label.negativeCandidateId !== undefined && label.minimumScoreSeparation === undefined) {
      failures.push(`label with negativeCandidateId requires minimumScoreSeparation: ${label.labelId}`);
    }
    if (label.minimumScoreSeparation !== undefined && label.negativeCandidateId === undefined) {
      failures.push(`label with minimumScoreSeparation requires negativeCandidateId: ${label.labelId}`);
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

  const expectedPackets = corpus.expectedPackets ?? [];
  const expectedPacketIds = new Set<string>();
  for (const packet of expectedPackets) {
    if (!packet.challengeId) {
      failures.push('expected packet is missing challengeId');
      continue;
    }
    if (expectedPacketIds.has(packet.challengeId)) {
      failures.push(`duplicate expected packet challengeId: ${packet.challengeId}`);
    }
    expectedPacketIds.add(packet.challengeId);
    if (!nonEmptyString(packet.repoId)) {
      failures.push(`expected packet is missing repoId: ${packet.challengeId}`);
    }
    if (packet.repoFullName !== undefined && !nonEmptyString(packet.repoFullName)) {
      failures.push(`expected packet repoFullName must be non-empty: ${packet.challengeId}`);
    }
    if (packet.repoUrl !== undefined && !nonEmptyString(packet.repoUrl)) {
      failures.push(`expected packet repoUrl must be non-empty: ${packet.challengeId}`);
    }
    if (!Number.isInteger(packet.prNumber) || packet.prNumber <= 0) {
      failures.push(`expected packet prNumber must be a positive integer: ${packet.challengeId}`);
    }
    if (packet.prUrl !== undefined && !nonEmptyString(packet.prUrl)) {
      failures.push(`expected packet prUrl must be non-empty: ${packet.challengeId}`);
    }
    if (packet.prTitle !== undefined && !nonEmptyString(packet.prTitle)) {
      failures.push(`expected packet prTitle must be non-empty: ${packet.challengeId}`);
    }
    if (!nonEmptyString(packet.sourceVersion)) {
      failures.push(`expected packet is missing sourceVersion: ${packet.challengeId}`);
    }
    if (packet.packetContentHash !== undefined && !nonEmptyString(packet.packetContentHash)) {
      failures.push(`expected packet packetContentHash must be non-empty: ${packet.challengeId}`);
    }
    if (!challengeIds.has(packet.challengeId)) {
      failures.push(`expected packet references unlabelled challenge: ${packet.challengeId}`);
    }
    if (Array.isArray(packet.demands)) {
      const demandIds = new Set<string>();
      for (const demand of packet.demands) {
        if (!nonEmptyString(demand.demandId)) {
          failures.push(`expected packet demand is missing demandId: ${packet.challengeId}`);
          continue;
        }
        if (demandIds.has(demand.demandId)) {
          failures.push(`duplicate expected packet demandId: ${packet.challengeId}/${demand.demandId}`);
        }
        demandIds.add(demand.demandId);
        if (!Array.isArray(demand.concepts)) {
          failures.push(`expected packet demand concepts must be an array: ${packet.challengeId}/${demand.demandId}`);
        }
        if (!Array.isArray(demand.sourceRefs) || demand.sourceRefs.length === 0) {
          failures.push(`expected packet demand must contain source references: ${packet.challengeId}/${demand.demandId}`);
          continue;
        }
        for (const reference of demand.sourceRefs) {
          if (!sourceRefComplete(reference)) {
            failures.push(`expected packet demand source reference missing exact immutable provenance: ${packet.challengeId}/${demand.demandId}`);
          }
        }
      }
    }
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
  if (
    corpus.metadata.totalExpectedPackets !== undefined
    && corpus.metadata.totalExpectedPackets !== expectedPackets.length
  ) {
    failures.push('metadata.totalExpectedPackets does not match expectedPackets');
  }
  if (failures.length > 0) throw new CorpusValidationError(failures);
}

export function productionCorpusFailures(corpus: EvaluationCorpus): string[] {
  const failures: string[] = [];
  if (corpus.expertLabels.length === 0) {
    failures.push('production corpus requires at least one expert label');
  }
  const draftLabels = corpus.expertLabels.filter((label) => label.labeledBy === 'corpus-seeder');
  const expertBackedLabels = corpus.expertLabels.filter(hasExpertLabelProvenance);
  if (draftLabels.length > 0) {
    failures.push(
      `production corpus contains ${draftLabels.length} draft corpus-seeder label(s); complete expert review before production evaluation`,
    );
  }
  if (corpus.expertLabels.length > 0 && expertBackedLabels.length === 0) {
    failures.push('production corpus requires at least one expert-reviewed label with reviewer/source provenance');
  }
  const positiveLabels = expertBackedLabels.filter(positiveLabel);
  const negativeLabels = expertBackedLabels.filter((label) => !positiveLabel(label));
  const contrastLabels = expertBackedLabels.filter((label) =>
    nonEmptyString(label.negativeCandidateId)
      && label.minimumScoreSeparation !== undefined
  );
  if (positiveLabels.length === 0) {
    failures.push('production corpus requires at least one highly_relevant or relevant positive expert label');
  }
  if (negativeLabels.length === 0) {
    failures.push('production corpus requires at least one insufficient-evidence or non-positive contrast label');
  }
  if (contrastLabels.length === 0) {
    failures.push('production corpus requires at least one explicit negativeCandidateId contrast label');
  }
  const syntheticLabels = corpus.expertLabels.filter(
    (label) => label.labeledBy === 'synthetic-fixture',
  );
  if (syntheticLabels.length > 0 || corpus.metadata.syntheticFixtureCount > 0) {
    failures.push('production corpus cannot contain synthetic fixture labels');
  }
  const sourceBackedExpectedPacketCount = new Set(
    (corpus.expectedPackets ?? [])
      .filter((packet) =>
        Number.isInteger(packet.prNumber)
        && packet.prNumber > 0
        && Array.isArray(packet.demands)
        && packet.demands.some((demand) =>
          Array.isArray(demand.sourceRefs)
          && demand.sourceRefs.some(sourceRefComplete)
        )
      )
      .map((packet) => packet.challengeId),
  ).size;
  if (sourceBackedExpectedPacketCount < 2) {
    failures.push('production corpus requires at least two source-backed expected PR challenge packets');
  }

  for (const label of corpus.expertLabels) {
    if (label.labeledBy === 'corpus-seeder') continue;
    const provenance = label.labelProvenance;
    if (!label.explanation || label.explanation.trim().length === 0) {
      failures.push(`expert label requires a human rationale: ${label.labelId}`);
    }
    if (
      positiveLabel(label)
      && (
        !nonEmptyString(label.negativeCandidateId)
        || label.minimumScoreSeparation === undefined
      )
    ) {
      failures.push(`positive expert label requires contrast candidate and minimum score separation: ${label.labelId}`);
    }
    if (!provenance) {
      failures.push(`expert label is missing reviewer/source provenance: ${label.labelId}`);
      continue;
    }
    if (
      !provenance.reviewerId
      || !provenance.reviewArtifactId
      || !provenance.reviewArtifactVersion
      || !provenance.contentHash
      || !provenance.locator
      || !provenance.rubricVersion
    ) {
      failures.push(`expert label provenance is incomplete: ${label.labelId}`);
    }
    if (!provenance.contentHash.startsWith('sha256:')) {
      failures.push(`expert label provenance must include an immutable sha256 content hash: ${label.labelId}`);
    }
  }
  return failures;
}

export function hasExpertLabelProvenance(label: ExpertLabel): boolean {
  const provenance = label.labelProvenance;
  if (!provenance) return false;
  return label.labeledBy !== 'synthetic-fixture'
    && label.labeledBy !== 'corpus-seeder'
    && Boolean(label.explanation?.trim())
    && Boolean(provenance.reviewerId)
    && Boolean(provenance.reviewArtifactId)
    && Boolean(provenance.reviewArtifactVersion)
    && Boolean(provenance.contentHash)
    && provenance.contentHash.startsWith('sha256:')
    && Boolean(provenance.locator)
    && Boolean(provenance.rubricVersion);
}

export function evaluationCorpusLabelCounts(
  corpus: EvaluationCorpus,
): { expertLabelCount: number; syntheticFixtureCount: number } {
  const syntheticFixtureCount = corpus.expertLabels.filter(
    (label) => label.labeledBy === 'synthetic-fixture',
  ).length;
  return {
    expertLabelCount: corpus.expertLabels.filter(hasExpertLabelProvenance).length,
    syntheticFixtureCount,
  };
}

export function validateProductionCorpus(corpus: EvaluationCorpus): void {
  const failures = productionCorpusFailures(corpus);
  if (failures.length > 0) throw new ProductionCorpusValidationError(failures);
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

export function getExpectedPackets(corpus: EvaluationCorpus): ExpectedChallengePacket[] {
  return corpus.expectedPackets ?? [];
}

export function getExpectedPacket(
  corpus: EvaluationCorpus,
  challengeId: string,
): ExpectedChallengePacket | undefined {
  return (corpus.expectedPackets ?? []).find(
    (packet) => packet.challengeId === challengeId,
  );
}
