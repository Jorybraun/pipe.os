import {
  evaluationCorpusLabelCounts,
  getCandidateEvidence,
  getExpectedPacket,
  getRoleRequirements,
  productionCorpusFailures,
  validateCorpus,
} from './corpus';
import type {
  EvaluationCorpus,
  ExpectedChallengePacket,
  ExpertLabel,
  GuardrailViolation,
  RelevanceGrade,
  RoleRequirements,
  StretchPath,
} from './types';
import { sha256, stableJson } from '../../repoSemanticGraph/hash';

const REVIEWED_CORPUS_SUFFIX_LENGTH = 12;

export interface CorpusReviewPacketItem {
  labelId: string;
  candidateId: string;
  roleId: string;
  challengeId: string;
  draft: {
    relevanceGrade: RelevanceGrade;
    eligibleChallengeIds: string[];
    explanation: string | null;
    labeledBy: string;
    labelVersion: string;
  };
  candidateEvidence: ReturnType<typeof getCandidateEvidence>;
  roleRequirements: RoleRequirements | null;
  expectedPacket: ExpectedChallengePacket | null;
  reviewQuestions: string[];
}

export interface CorpusReviewPacket {
  corpusId: string;
  description: string;
  createdAt: string;
  labelCount: number;
  expertLabelCount: number;
  syntheticFixtureCount: number;
  productionReady: boolean;
  productionReadinessFailures: string[];
  instructions: string[];
  items: CorpusReviewPacketItem[];
}

export interface ExpertLabelReview {
  labelId: string;
  relevanceGrade: RelevanceGrade;
  explanation: string;
  eligibleChallengeIds?: string[];
  guardrailViolations?: GuardrailViolation[];
  permittedStretchPaths?: StretchPath[];
  forbiddenRoles?: string[];
}

export interface ApplyExpertCorpusReviewInput {
  reviewerId: string;
  reviewerRole?: string;
  reviewArtifactId: string;
  reviewArtifactVersion: string;
  rubricVersion: string;
  reviewedCorpusId?: string;
  labels: ExpertLabelReview[];
  reviewedAt?: string;
}

export interface ApplyExpertCorpusReviewResult {
  corpus: EvaluationCorpus;
  productionReady: boolean;
  productionReadinessFailures: string[];
  expertLabelCount: number;
  syntheticFixtureCount: number;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isEligibleGrade(grade: RelevanceGrade): boolean {
  return grade === 'highly_relevant' || grade === 'relevant' || grade === 'borderline';
}

function labelChallengeSet(labels: ExpertLabel[]): number {
  const challengeIds = new Set<string>();
  for (const label of labels) {
    challengeIds.add(label.challengeId);
    label.eligibleChallengeIds.forEach((id) => challengeIds.add(id));
  }
  return challengeIds.size;
}

function eligibleChallengeIdsForReview(
  existing: ExpertLabel,
  review: ExpertLabelReview,
): string[] {
  if (review.eligibleChallengeIds) {
    return Array.from(new Set(review.eligibleChallengeIds)).sort();
  }
  if (!isEligibleGrade(review.relevanceGrade)) return [];
  return Array.from(new Set([
    existing.challengeId,
    ...existing.eligibleChallengeIds,
  ])).sort();
}

function validateReviewInput(
  source: EvaluationCorpus,
  input: ApplyExpertCorpusReviewInput,
): void {
  const failures: string[] = [];
  if (!nonEmpty(input.reviewerId)) failures.push('reviewerId is required');
  if (!nonEmpty(input.reviewArtifactId)) failures.push('reviewArtifactId is required');
  if (!nonEmpty(input.reviewArtifactVersion)) failures.push('reviewArtifactVersion is required');
  if (!nonEmpty(input.rubricVersion)) failures.push('rubricVersion is required');
  if (!Array.isArray(input.labels) || input.labels.length === 0) {
    failures.push('at least one reviewed label is required');
  }

  const sourceLabelIds = new Set(source.expertLabels.map((label) => label.labelId));
  const reviewedLabelIds = new Set<string>();
  for (const review of input.labels ?? []) {
    if (!nonEmpty(review.labelId)) {
      failures.push('reviewed label is missing labelId');
      continue;
    }
    if (reviewedLabelIds.has(review.labelId)) {
      failures.push(`duplicate reviewed label: ${review.labelId}`);
    }
    reviewedLabelIds.add(review.labelId);
    if (!sourceLabelIds.has(review.labelId)) {
      failures.push(`reviewed label does not exist in source corpus: ${review.labelId}`);
    }
    if (!nonEmpty(review.explanation)) {
      failures.push(`reviewed label requires a human rationale: ${review.labelId}`);
    }
    if (
      review.relevanceGrade === 'forbidden'
      && (!review.guardrailViolations || review.guardrailViolations.length === 0)
    ) {
      failures.push(`forbidden reviewed label requires guardrailViolations: ${review.labelId}`);
    }
  }

  for (const labelId of sourceLabelIds) {
    if (!reviewedLabelIds.has(labelId)) {
      failures.push(`review is missing source label: ${labelId}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`Expert corpus review is invalid: ${failures.join('; ')}`);
  }
}

export function buildCorpusReviewPacket(corpus: EvaluationCorpus): CorpusReviewPacket {
  validateCorpus(corpus);
  const counts = evaluationCorpusLabelCounts(corpus);
  const productionReadinessFailures = productionCorpusFailures(corpus);
  return {
    corpusId: corpus.corpusId,
    description: corpus.description,
    createdAt: corpus.createdAt,
    labelCount: corpus.expertLabels.length,
    expertLabelCount: counts.expertLabelCount,
    syntheticFixtureCount: counts.syntheticFixtureCount,
    productionReady: productionReadinessFailures.length === 0,
    productionReadinessFailures,
    instructions: [
      'Review each candidate-role-challenge label against the source evidence below.',
      'Confirm the candidate evidence, role requirement, and repo PR demand are source-backed and appropriate.',
      'Submit one reviewed label for every draft label; production gates require human rationale plus reviewer/source provenance.',
    ],
    items: corpus.expertLabels.map((label) => ({
      labelId: label.labelId,
      candidateId: label.candidateId,
      roleId: label.roleId,
      challengeId: label.challengeId,
      draft: {
        relevanceGrade: label.relevanceGrade,
        eligibleChallengeIds: label.eligibleChallengeIds,
        explanation: label.explanation ?? null,
        labeledBy: label.labeledBy,
        labelVersion: label.labelVersion,
      },
      candidateEvidence: getCandidateEvidence(corpus, label.candidateId),
      roleRequirements: getRoleRequirements(corpus, label.roleId) ?? null,
      expectedPacket: getExpectedPacket(corpus, label.challengeId) ?? null,
      reviewQuestions: [
        'Does the candidate evidence actually support this challenge selection?',
        'Does the repo PR demand test the role-relevant skill rather than a generic adjacent skill?',
        'Should this challenge be eligible, borderline, irrelevant, or forbidden for this candidate?',
        'What source-backed reason should future rollout gates use for this label?',
      ],
    })),
  };
}

export async function applyExpertCorpusReview(
  source: EvaluationCorpus,
  input: ApplyExpertCorpusReviewInput,
): Promise<ApplyExpertCorpusReviewResult> {
  validateCorpus(source);
  validateReviewInput(source, input);

  const reviewByLabelId = new Map(input.labels.map((review) => [review.labelId, review]));
  const reviewedAt = input.reviewedAt ?? new Date().toISOString();
  const reviewedLabels: ExpertLabel[] = [];

  for (const existing of source.expertLabels) {
    const review = reviewByLabelId.get(existing.labelId);
    if (!review) {
      throw new Error(`review is missing source label: ${existing.labelId}`);
    }
    const eligibleChallengeIds = eligibleChallengeIdsForReview(existing, review);
    const contentHash = await sha256(stableJson({
      sourceCorpusId: source.corpusId,
      labelId: existing.labelId,
      reviewerId: input.reviewerId,
      reviewArtifactId: input.reviewArtifactId,
      reviewArtifactVersion: input.reviewArtifactVersion,
      rubricVersion: input.rubricVersion,
      review,
    }));
    reviewedLabels.push({
      ...existing,
      relevanceGrade: review.relevanceGrade,
      eligibleChallengeIds,
      forbiddenRoles: review.forbiddenRoles,
      guardrailViolations: review.guardrailViolations,
      permittedStretchPaths: review.permittedStretchPaths,
      explanation: review.explanation.trim(),
      labelVersion: input.rubricVersion,
      labeledAt: reviewedAt,
      labeledBy: input.reviewerId,
      labelProvenance: {
        reviewerId: input.reviewerId,
        reviewerRole: input.reviewerRole,
        reviewArtifactId: input.reviewArtifactId,
        reviewArtifactVersion: input.reviewArtifactVersion,
        contentHash,
        locator: `${input.reviewArtifactId}#${existing.labelId}`,
        rubricVersion: input.rubricVersion,
      },
    });
  }

  const reviewedCorpusId = input.reviewedCorpusId
    ?? `${source.corpusId}-expert-${(await sha256(stableJson({
      sourceCorpusId: source.corpusId,
      reviewedAt,
      reviewerId: input.reviewerId,
      reviewArtifactId: input.reviewArtifactId,
      labels: input.labels,
    }))).slice('sha256:'.length, 'sha256:'.length + REVIEWED_CORPUS_SUFFIX_LENGTH)}`;

  const corpus: EvaluationCorpus = {
    ...source,
    corpusId: reviewedCorpusId,
    createdAt: reviewedAt,
    description: `Expert-reviewed CODE_REVIEW matching corpus derived from ${source.corpusId}`,
    expertLabels: reviewedLabels,
    metadata: {
      ...source.metadata,
      totalLabels: reviewedLabels.length,
      totalChallenges: labelChallengeSet(reviewedLabels),
      syntheticFixtureCount: reviewedLabels.filter((label) => label.labeledBy === 'synthetic-fixture').length,
      totalExpectedPackets: source.expectedPackets?.length ?? 0,
    },
  };

  validateCorpus(corpus);
  const productionReadinessFailures = productionCorpusFailures(corpus);
  const counts = evaluationCorpusLabelCounts(corpus);
  return {
    corpus,
    productionReady: productionReadinessFailures.length === 0,
    productionReadinessFailures,
    expertLabelCount: counts.expertLabelCount,
    syntheticFixtureCount: counts.syntheticFixtureCount,
  };
}
