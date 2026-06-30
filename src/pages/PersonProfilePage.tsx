import { Suspense, lazy, useCallback, useEffect, useState, type CSSProperties, type ReactNode, type SyntheticEvent } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Briefcase,
  Calendar,
  CheckCircle,
  FileText,
  GitPullRequest,
  Mail,
  Network,
  Phone,
  Signal,
  UserRound,
} from 'lucide-react';
import { useApiClient } from '../hooks/useApiClient';
import type {
  LivingContextArtifact,
  LivingContextInteraction,
  LivingContextReadModel,
  LivingContextRecord,
  LivingContextRecordSourceRef,
} from '../lib/api/types';
import type { AssessmentProgressSnapshot } from '../lib/scheduling/types';

const LivingContextGraph = lazy(() =>
  import('../components/Candidate/LivingContextGraph').then((module) => ({
    default: module.LivingContextGraph,
  }))
);
import {
  contextRecordTitle,
  contextRecordTypeLabel,
} from '../lib/livingContextDisplay';
import {
  RECRUITER_FONT as FONT,
  recruiterBackButtonStyle,
  recruiterEyebrowStyle,
  recruiterFieldLabelStyle,
  recruiterFieldValueStyle,
  recruiterHeaderStyle,
  recruiterInsetCardStyle,
  recruiterPageStyle,
  recruiterSectionStyle,
  recruiterSectionTitleStyle,
  recruiterSubtitleStyle,
  recruiterTitleStyle,
} from '../styles/recruiterSurface';

interface PersonContact {
  id: string;
  email: string;
  name: string | null;
  company: string | null;
  role: string | null;
  phone: string | null;
  linkedin: string | null;
  notes: string | null;
  type: string;
  created_at: string;
  updated_at: string;
}

interface CodeReviewScoreProjection {
  score: number | null;
  band: string | null;
  narrative: string | null;
  strengths: string[];
  growthAreas: string[];
}

interface CodeReviewChallengeProjection {
  repoLabel: string | null;
  repoUrl: string | null;
  prNumber: number | null;
  matchStatus: string | null;
}

interface CodeReviewProofItem {
  id: string;
  label: string;
  text: string | null;
}

interface CodeReviewBasisItem {
  label: string;
  value: string;
  satisfied: boolean;
}

interface InteractionCoverageItem {
  label: string;
  count: number;
}

interface InteractionCoverageCounts {
  codeReviews: number;
  calls: number;
  resumes: number;
  messages: number;
  other: number;
}

interface EvidenceMixReadout {
  headline: string;
  detail: string;
  nextSource: string;
}

interface CodeReviewDecisionProjection {
  decisionLabel: string;
  sessionId: string | null;
  outcome: string | null;
  recommendation: string;
  recommendationDetail: string;
  uncertainty: string;
  uncertaintyDetail: string;
  missingContext: string[];
  assessmentValidity: string;
  assessmentValidityDetail: string;
  nextAction: string;
  nextActionDetail: string;
  scoreLabel: string | null;
  scoreProvenanceLabel?: string | null;
  challengeLabel: string | null;
  challengeUrl: string | null;
  narrative: string | null;
  strengths: string[];
  probes: string[];
  proofCount: number;
  proofItems: CodeReviewProofItem[];
  basisItems: CodeReviewBasisItem[];
}

function formatDate(value: string | null | undefined): string {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function contactFromLivingContext(
  livingContext: LivingContextReadModel | null,
  fallbackId: string | undefined,
): PersonContact | null {
  if (!livingContext?.person) return null;
  const person = livingContext.person;
  return {
    id: fallbackId ?? person.personId,
    email: person.primaryEmail ?? '',
    name: person.displayName,
    company: null,
    role: person.roles[0]?.label ?? null,
    phone: person.primaryPhone,
    linkedin: null,
    notes: person.relationshipSummary,
    type: 'candidate',
    created_at: '',
    updated_at: '',
  };
}

function livingContextFromNavigationState(state: unknown): LivingContextReadModel | null {
  if (!isRecord(state) || !isRecord(state.livingContext) || !isRecord(state.livingContext.person)) {
    return null;
  }
  return state.livingContext as unknown as LivingContextReadModel;
}

function candidateIdFromNavigationState(state: unknown): string | null {
  if (!isRecord(state) || typeof state.candidateId !== 'string' || state.candidateId.trim().length === 0) {
    return null;
  }
  return state.candidateId.trim();
}

function selectedAssessmentFromNavigationState(state: unknown): AssessmentProgressSnapshot | null {
  if (!isRecord(state) || !isRecord(state.selectedAssessment) || !isRecord(state.selectedAssessment.session)) {
    return null;
  }
  return state.selectedAssessment as unknown as AssessmentProgressSnapshot;
}

function codeReviewDecisionFromNavigationState(state: unknown): CodeReviewDecisionProjection | null {
  if (!isRecord(state) || !isRecord(state.selectedCodeReviewDecision)) return null;
  const decision = state.selectedCodeReviewDecision;
  if (
    typeof decision.decisionLabel !== 'string'
    || typeof decision.recommendation !== 'string'
    || typeof decision.recommendationDetail !== 'string'
    || typeof decision.uncertainty !== 'string'
    || typeof decision.uncertaintyDetail !== 'string'
    || typeof decision.assessmentValidity !== 'string'
    || typeof decision.assessmentValidityDetail !== 'string'
    || typeof decision.nextAction !== 'string'
    || typeof decision.nextActionDetail !== 'string'
  ) {
    return null;
  }
  return decision as unknown as CodeReviewDecisionProjection;
}

function livingContextFromCandidateResponse(response: unknown): LivingContextReadModel | null {
  if (isRecord(response) && isRecord(response.livingContext) && isRecord(response.livingContext.person)) {
    return response.livingContext as unknown as LivingContextReadModel;
  }
  if (isRecord(response) && isRecord(response.person)) {
    return response as unknown as LivingContextReadModel;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function optionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function optionalNumericValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function githubRepoIdentityFromText(value: unknown): Pick<CodeReviewChallengeProjection, 'repoLabel' | 'repoUrl'> | null {
  if (typeof value !== 'string') return null;
  const match = value.match(/https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/);
  if (!match?.[1]) return null;
  return {
    repoLabel: match[1],
    repoUrl: `https://github.com/${match[1]}`,
  };
}

function githubRepoIdentityFromSources(
  sources: LivingContextRecordSourceRef[],
): Pick<CodeReviewChallengeProjection, 'repoLabel' | 'repoUrl'> | null {
  for (const source of sources) {
    const identity = githubRepoIdentityFromText(source.exactText);
    if (identity) return identity;
  }
  return null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function titleCaseToken(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function typeLabel(value: string | null | undefined): string {
  if (!value) return 'person';
  return value.replace(/[_-]+/g, ' ').toLowerCase();
}

function countWithLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function metadataSummary(metadata: Record<string, unknown>): string | null {
  const summary = metadata.summary ?? metadata.title ?? metadata.description ?? metadata.event;
  if (typeof summary === 'string' && summary.trim()) return summary;
  return null;
}

function scheduledInterviewPathFromInteraction(interaction: LivingContextInteraction): string | null {
  const scheduledInterviewId = optionalString(interaction.metadata.scheduledInterviewId)
    ?? optionalString(interaction.metadata.originalInterviewId)
    ?? optionalString(interaction.metadata.contextCallInterviewId);
  if (scheduledInterviewId) return `/interviews/${scheduledInterviewId}`;

  const externalReference = optionalString(interaction.externalReference);
  const interactionType = interaction.interactionType.toLowerCase();
  if (
    externalReference
    && interactionType.includes('scheduled_interview')
    && !externalReference.startsWith('review-session')
    && !externalReference.startsWith('resume:')
  ) {
    return `/interviews/${externalReference}`;
  }
  return null;
}

function evidenceSummaryText(livingContext: LivingContextReadModel | null): string {
  const summary = livingContext?.summary;
  if (!summary || summary.interactionCount === 0) {
    return 'This profile is ready for evidence. Invites, calls, transcripts, notes, resumes, and assessments will grow the graph without fabricating meaning.';
  }
  const parts = [
    `${summary.interactionCount} ${summary.interactionCount === 1 ? 'interaction' : 'interactions'}`,
    `${summary.contextRecordCount} learned ${summary.contextRecordCount === 1 ? 'context record' : 'context records'}`,
    `${summary.sourceSpanCount} exact source ${summary.sourceSpanCount === 1 ? 'span' : 'spans'}`,
  ];
  return `PIPE currently knows this relationship from ${parts.join(', ')}.`;
}

function interactionCoverageCounts(interactions: LivingContextInteraction[]): InteractionCoverageCounts {
  const counts = {
    codeReviews: 0,
    calls: 0,
    resumes: 0,
    messages: 0,
    other: 0,
  };

  for (const interaction of interactions) {
    const interactionType = interaction.interactionType.toLowerCase();
    const reference = optionalString(interaction.externalReference)?.toLowerCase() ?? '';
    if (interactionType.includes('code_review') || reference.startsWith('review-session')) {
      counts.codeReviews += 1;
    } else if (
      interactionType.includes('meeting')
      || interactionType.includes('interview')
      || interactionType.includes('phone')
      || interactionType.includes('call')
      || reference.includes('meeting')
    ) {
      counts.calls += 1;
    } else if (interactionType.includes('resume') || reference.startsWith('resume:')) {
      counts.resumes += 1;
    } else if (interactionType.includes('invite') || interactionType.includes('message') || reference.includes('invite')) {
      counts.messages += 1;
    } else {
      counts.other += 1;
    }
  }

  return counts;
}

function interactionCoverageItems(interactions: LivingContextInteraction[]): InteractionCoverageItem[] {
  const counts = interactionCoverageCounts(interactions);

  return [
    { label: countWithLabel(counts.codeReviews, 'code review'), count: counts.codeReviews },
    { label: countWithLabel(counts.calls, 'call or meeting', 'calls or meetings'), count: counts.calls },
    { label: countWithLabel(counts.resumes, 'resume'), count: counts.resumes },
    { label: countWithLabel(counts.messages, 'message or invite', 'messages or invites'), count: counts.messages },
    { label: countWithLabel(counts.other, 'other evidence record'), count: counts.other },
  ].filter((item) => item.count > 0);
}

function evidenceMixReadout(
  interactions: LivingContextInteraction[],
  decision: CodeReviewDecisionProjection | null,
): EvidenceMixReadout {
  const counts = interactionCoverageCounts(interactions);
  if (interactions.length === 0) {
    return {
      headline: 'No source mix yet',
      detail: 'Start with one durable source: resume, invite, call transcript, or assessment evidence.',
      nextSource: 'Collect first source-backed evidence',
    };
  }

  if (decision && counts.codeReviews > 0 && counts.resumes > 0 && counts.calls === 0) {
    return {
      headline: 'Technical signal exists; conversation context is missing',
      detail: 'Use the code review and resume as source-backed signal, then add a focused call only for the calibration gaps.',
      nextSource: decision.nextAction,
    };
  }

  if (decision && counts.codeReviews > 0 && counts.calls > 0) {
    return {
      headline: 'Cross-interaction signal is forming',
      detail: 'The person profile has both technical assessment and conversation evidence. Keep the meeting page scoped and use this view for the rollup.',
      nextSource: decision.nextAction,
    };
  }

  if (counts.calls > 0 && counts.codeReviews === 0) {
    return {
      headline: 'Conversation context exists; technical assessment is missing',
      detail: 'Use the call evidence to pick a specific code-review or workspace challenge, but do not present technical fit yet.',
      nextSource: 'Assign a source-backed technical assessment',
    };
  }

  return {
    headline: 'Evidence mix is still narrow',
    detail: 'The profile has source-backed records, but it needs another evidence type before the recommendation becomes robust.',
    nextSource: decision?.nextAction ?? 'Schedule targeted context gathering',
  };
}

function interactionCoverageSummary(interactions: LivingContextInteraction[]): string {
  if (interactions.length === 0) {
    return 'No evidence-producing interactions are attached to this person yet.';
  }
  return `Person-level rollup from ${countWithLabel(interactions.length, 'evidence-producing interaction')}. Open a row only when you need the single-meeting source record.`;
}

function quietEvidenceText(value: string): string {
  return value
    .replace(/\breview-session-[A-Za-z0-9_-]+\b/g, 'review session')
    .replace(/\bresume:review-evidence:\d+\b/g, 'resume evidence')
    .replace(/\bcandidate_node_[A-Za-z0-9_-]+\b/g, 'candidate evidence')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, 'source reference');
}

function contextRecordDisplayTitle(record: LivingContextRecord): string {
  return quietEvidenceText(contextRecordTitle(record));
}

function contextRecordDisplayNarrative(record: LivingContextRecord): string | null {
  const narrative = optionalString(record.narrative);
  if (!narrative) return null;
  const quietNarrative = quietEvidenceText(narrative);
  return quietNarrative !== contextRecordDisplayTitle(record) ? quietNarrative : null;
}

function interactionSourceLabel(interaction: LivingContextInteraction): string | null {
  const externalReference = optionalString(interaction.externalReference);
  if (!externalReference) return null;
  const interactionType = interaction.interactionType.toLowerCase();
  const reference = externalReference.toLowerCase();

  if (reference.startsWith('resume:') || interactionType.includes('resume')) {
    return 'Resume evidence attached';
  }
  if (interactionType.includes('code_review') || reference.startsWith('review-session')) {
    return 'Code-review assessment evidence';
  }
  if (interactionType.includes('meeting') || interactionType.includes('interview') || reference.includes('meeting')) {
    return 'Meeting evidence attached';
  }
  if (interactionType.includes('phone') || interactionType.includes('call')) {
    return 'Call evidence attached';
  }
  if (interactionType.includes('invite') || reference.includes('invite')) {
    return 'Invite evidence attached';
  }
  return 'Source evidence attached';
}

function sourceArtifactTitle(artifact: LivingContextArtifact): string {
  const artifactType = artifact.artifactType.toLowerCase();
  const logicalKey = artifact.logicalKey?.toLowerCase() ?? '';

  if (artifactType === 'legacy_candidate_node') return 'Candidate evidence';
  if (artifactType.includes('resume') || logicalKey.startsWith('resume:')) return 'Resume evidence';
  if (artifactType.includes('code_review_score')) return 'Code-review score report';
  if (artifactType.includes('code_review_transcript')) return 'Code-review transcript';
  if (artifactType.includes('code_review')) return 'Code-review evidence';
  if (artifactType.includes('meeting_transcript')) return 'Meeting transcript';
  if (artifactType.includes('phone_call')) return 'Call evidence';
  if (artifactType.includes('scheduled_interview_invite')) return 'Interview invite';
  return titleCaseToken(artifact.artifactType);
}

function sourceArtifactDetail(artifact: LivingContextArtifact): string {
  const artifactType = artifact.artifactType.toLowerCase();
  const logicalKey = artifact.logicalKey?.toLowerCase() ?? '';
  const summary = metadataSummary(artifact.metadata);
  if (
    summary
    && !summary.includes('candidate_node_')
    && !summary.includes('resume:')
    && !summary.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i)
  ) {
    return summary;
  }

  if (artifactType === 'legacy_candidate_node' || logicalKey.startsWith('resume:')) {
    return 'Imported from resume decomposition';
  }
  if (artifactType.includes('code_review')) {
    return 'Captured during code-review assessment';
  }
  if (artifactType.includes('meeting_transcript')) {
    return 'Captured from meeting transcript';
  }
  if (artifactType.includes('phone_call')) {
    return 'Captured from call evidence';
  }
  if (artifactType.includes('scheduled_interview_invite')) {
    return 'Preserved from interview invite delivery';
  }
  return 'Original source preserved';
}

function recordTimestamp(record: LivingContextRecord): number {
  const value = record.observedAt ?? '';
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function sessionIdFromRecord(record: LivingContextRecord | null): string | null {
  if (!record) return null;
  return optionalString(record.qualifiers.sessionId)
    ?? record.entities
      .map((entity) =>
        entity.entityType === 'code_review_session' || entity.entityType === 'assessment_session'
          ? entity.entityId
          : null
      )
      .find((value): value is string => typeof value === 'string' && value.length > 0)
    ?? null;
}

function parseScoreProjection(record: LivingContextRecord | null): CodeReviewScoreProjection | null {
  if (!record) return null;
  const scoreSource = record.sources.find((source) =>
    source.evidenceRole === 'score_report'
    && typeof source.exactText === 'string'
    && source.exactText.trim().length > 0,
  );
  if (!scoreSource || typeof scoreSource.exactText !== 'string') return null;

  try {
    const parsed = JSON.parse(scoreSource.exactText) as unknown;
    if (!isRecord(parsed)) return null;
    const overall = isRecord(parsed.overall) ? parsed.overall : parsed;
    return {
      score: optionalNumber(overall.score),
      band: optionalString(overall.band),
      narrative: optionalString(overall.narrative),
      strengths: stringArray(overall.strengths),
      growthAreas: stringArray(overall.growth_areas ?? overall.growthAreas),
    };
  } catch {
    return null;
  }
}

function readChallengeProjection(record: LivingContextRecord | null): CodeReviewChallengeProjection | null {
  if (!record) return null;
  const selected = record.qualifiers.selectedReviewChallenge;
  if (isRecord(selected)) {
    const repoUrl = optionalString(selected.repoUrl) ?? optionalString(selected.githubRepoUrl);
    const repoLabel = optionalString(selected.repoFullName)
      ?? optionalString(selected.fullName)
      ?? (repoUrl ? repoUrl.replace(/^https:\/\/github\.com\//, '') : null);
    return {
      repoLabel,
      repoUrl,
      prNumber: optionalNumericValue(selected.prNumber),
      matchStatus: optionalString(selected.matchStatus),
    };
  }

  if (record.recordType === 'candidate_pr_match_decision' || record.predicate === 'selects review challenge') {
    const selectedPacketId = optionalString(record.qualifiers.selectedPacketId);
    const evaluatedChallenges = Array.isArray(record.qualifiers.evaluatedChallenges)
      ? record.qualifiers.evaluatedChallenges.filter(isRecord)
      : [];
    const selectedEvaluation = evaluatedChallenges.find((challenge) =>
      selectedPacketId && optionalString(challenge.challengeId) === selectedPacketId,
    ) ?? evaluatedChallenges.find((challenge) =>
      optionalNumericValue(challenge.rank) === 1 || challenge.eligible === true,
    ) ?? null;
    const validatorAgent = isRecord(record.qualifiers.validatorAgent) ? record.qualifiers.validatorAgent : null;
    const sourceBridge = validatorAgent && isRecord(validatorAgent.sourceBridge) ? validatorAgent.sourceBridge : null;
    const selectedEntity = record.entities.find((entity) =>
      entity.relationship === 'selected_pull_request'
      || entity.relationship === 'selected_packet'
      || entity.relationship === 'selected_evaluation',
    ) ?? null;
    const entityMetadata = selectedEntity?.metadata ?? {};
    const prNumber = optionalNumericValue(selectedEvaluation?.prNumber)
      ?? optionalNumericValue(sourceBridge?.prNumber)
      ?? optionalNumericValue(entityMetadata.prNumber);
    const repoId = optionalString(selectedEvaluation?.repoId)
      ?? optionalString(sourceBridge?.repoId)
      ?? optionalString(entityMetadata.repoId);
    const sourceIdentity = githubRepoIdentityFromSources(record.sources);
    if (sourceIdentity || prNumber !== null || repoId) {
      return {
        repoLabel: sourceIdentity?.repoLabel ?? (repoId ? `repo ${repoId}` : null),
        repoUrl: sourceIdentity?.repoUrl ?? null,
        prNumber,
        matchStatus: optionalString(record.qualifiers.status)
          ?? optionalString(sourceBridge?.status)
          ?? optionalString(selectedEntity?.value),
      };
    }
  }

  for (const source of record.sources) {
    if (!('locator' in source) || !isRecord(source.locator)) continue;
    const repoUrl = optionalString(source.locator.repoUrl) ?? optionalString(source.locator.githubRepoUrl);
    const repoLabel = optionalString(source.locator.repoFullName)
      ?? optionalString(source.locator.fullName)
      ?? optionalString(source.locator.repo)
      ?? (repoUrl ? repoUrl.replace(/^https:\/\/github\.com\//, '') : null);
    const prNumber = optionalNumericValue(source.locator.prNumber ?? source.locator.githubPrNumber);
    if (!repoLabel && !repoUrl && prNumber === null) continue;
    return {
      repoLabel,
      repoUrl,
      prNumber,
      matchStatus: optionalString(source.locator.matchStatus) ?? optionalString(source.metadata.status),
    };
  }

  return null;
}

function challengeUrlForProjection(challenge: CodeReviewChallengeProjection | null): string | null {
  if (!challenge?.repoUrl) return null;
  const repoUrl = challenge.repoUrl.replace(/\/$/, '');
  return challenge.prNumber !== null ? `${repoUrl}/pull/${challenge.prNumber}` : repoUrl;
}

function hasMatchedReviewChallenge(challenge: CodeReviewChallengeProjection | null): boolean {
  if (!challenge) return false;
  const status = challenge.matchStatus?.toUpperCase();
  if (status && status !== 'MATCHED') return false;
  return Boolean(challenge.repoLabel || challenge.repoUrl || challenge.prNumber !== null);
}

function verdictLabel(verdict: string | null): string | null {
  if (!verdict) return null;
  switch (verdict.toLowerCase()) {
    case 'request_changes':
    case 'changes_requested':
      return 'Candidate requested changes';
    case 'approve':
    case 'approved':
      return 'Candidate approved the PR';
    case 'comment':
    case 'commented':
      return 'Candidate left review comments';
    default:
      return `Candidate submitted ${titleCaseToken(verdict)}`;
  }
}

function recommendationForScore(
  score: CodeReviewScoreProjection | null,
  challenge: CodeReviewChallengeProjection | null,
): { value: string; detail: string } {
  if (!hasMatchedReviewChallenge(challenge)) {
    return {
      value: 'Collect missing evidence',
      detail: 'PIPE has not proven a source-backed repo challenge match yet, so any score should stay out of the hiring recommendation.',
    };
  }
  if (score?.score !== null && score?.score !== undefined) {
    if (score.score >= 80) {
      return {
        value: 'Advance with focused probe',
        detail: 'Treat this as a positive technical signal, then use the next conversation to pressure-test the remaining uncertainty.',
      };
    }
    if (score.score >= 60) {
      return {
        value: 'Advance only with calibration',
        detail: 'The review is usable evidence, but the next step should target the weak areas before a confident hiring decision.',
      };
    }
    return {
      value: 'Do not advance from this signal yet',
      detail: 'The review did not produce enough positive technical evidence. Confirm whether the assignment was fair before rejecting.',
    };
  }
  return {
    value: 'Wait for review signal',
    detail: 'The code-review assignment has source-backed context, but no score report has been captured yet.',
  };
}

function assessmentValidityForDecision(input: {
  score: CodeReviewScoreProjection | null;
  challenge: CodeReviewChallengeProjection | null;
  proofCount: number;
  hasTranscript: boolean;
  hasMatchProvenance: boolean;
}): { value: string; detail: string } {
  const scoreValue = input.score?.score;
  const hasScore = scoreValue !== null && scoreValue !== undefined;
  const hasMatchedChallenge = hasMatchedReviewChallenge(input.challenge);
  if (hasScore && hasMatchedChallenge && input.hasTranscript && input.hasMatchProvenance && input.proofCount >= 4) {
    return {
      value: 'Usable source-backed signal',
      detail: 'Score, review transcript, selected PR, and match provenance are all present. Use it as evidence, not as an automatic decision.',
    };
  }
  if (hasScore && input.proofCount > 0) {
    return {
      value: 'Partial source-backed signal',
      detail: 'A score exists, but the supporting transcript, selected PR, or match provenance is incomplete. Calibrate before relying on it.',
    };
  }
  if (hasMatchedChallenge && input.hasMatchProvenance) {
    return {
      value: 'Assignment ready, score missing',
      detail: 'The PR challenge and match provenance are source-backed, but the candidate review has not produced a score report yet.',
    };
  }
  if (hasMatchedChallenge) {
    return {
      value: 'Match provenance incomplete',
      detail: 'A repo or PR is visible, but PIPE has not attached the source-backed match decision proof yet.',
    };
  }
  return {
    value: 'Needs more evidence',
    detail: 'PIPE should collect more candidate or role evidence before treating this as a fair code-review assessment.',
  };
}

function nextActionForDecision(
  recommendation: string,
  score: CodeReviewScoreProjection | null,
): { value: string; detail: string } {
  if (recommendation === 'Collect missing evidence') {
    return {
      value: 'Schedule evidence-gathering call',
      detail: 'Ask targeted background questions before assigning or refreshing the repo match.',
    };
  }
  if (recommendation === 'Wait for review signal') {
    return {
      value: 'Wait for candidate submission',
      detail: 'Do not make a hiring call until the code-review transcript or score report exists.',
    };
  }
  if (score?.score !== null && score?.score !== undefined && score.score < 60) {
    return {
      value: 'Review assignment fairness before rejecting',
      detail: 'Check whether the repo challenge was well matched before treating the weak score as candidate signal.',
    };
  }
  return {
    value: 'Schedule focused technical calibration',
    detail: 'Use the next conversation to probe the weakest review dimension and confirm the signal generalizes.',
  };
}

function nextInterviewCtaLabel(decision: CodeReviewDecisionProjection | null): string {
  const nextAction = decision?.nextAction.toLowerCase() ?? '';
  if (nextAction.includes('evidence')) return 'Create evidence interview';
  if (nextAction.includes('calibration')) return 'Create calibration interview';
  if (nextAction.includes('fairness')) return 'Create fairness review';
  return 'Create context interview';
}

function nextInterviewRecruiterNotes(decision: CodeReviewDecisionProjection | null): string {
  if (!decision) {
    return [
      'PIPE person-profile next action',
      'Recommendation: Collect source-backed context',
      'Next action: Schedule targeted context gathering',
      'Reason: Use this interview to collect missing evidence before treating the profile as hiring signal.',
      'Uncertainty: Decision not ready',
      'Missing context: first source-backed evidence',
    ].join('\n');
  }

  const missingContext = decision.missingContext
    .filter((item) => item.trim().length > 0)
    .slice(0, 4);

  return [
    'PIPE person-profile next action',
    `Recommendation: ${decision.recommendation}`,
    `Next action: ${decision.nextAction}`,
    `Reason: ${decision.nextActionDetail}`,
    `Uncertainty: ${decision.uncertainty} - ${decision.uncertaintyDetail}`,
    missingContext.length > 0
      ? `Missing context: ${missingContext.join('; ')}`
      : 'Missing context: no blocking evidence gap recorded',
    `Source proof: ${decision.proofCount} source-backed proof ${decision.proofCount === 1 ? 'item' : 'items'}`,
  ].join('\n');
}

function nextInterviewPath(contact: PersonContact, decision: CodeReviewDecisionProjection | null): string {
  const params = new URLSearchParams({
    new: '1',
    interviewType: 'VIDEO',
  });
  const name = contact.name?.trim();
  const email = contact.email?.trim();
  if (name) params.set('recipientName', name);
  if (email) params.set('recipientEmail', email);
  if (!name && email) params.set('recipientName', email);
  const action = decision?.nextAction.toLowerCase() ?? '';
  if (action.includes('code review') || action.includes('review signal')) {
    params.set('interviewType', 'CODE_REVIEW');
  }
  params.set('recruiterNotes', nextInterviewRecruiterNotes(decision));
  return `/interviews?${params.toString()}`;
}

function missingContextCardForDecision(
  decision: CodeReviewDecisionProjection | null,
  hasEvidence: boolean,
): { value: string; detail: string } {
  if (!decision) {
    return {
      value: hasEvidence ? 'Assessment evidence incomplete' : 'First source evidence missing',
      detail: hasEvidence
        ? 'Add a scored code review, source-backed repo match, or targeted context call before treating this as a hiring signal.'
        : 'Start with an invite, resume, recorded call, or assessment so the profile can earn claims from source evidence.',
    };
  }
  const blockingItems = decision.missingContext.filter((item) =>
    !item.toLowerCase().startsWith('probe:')
      && !item.toLowerCase().startsWith('no blocking evidence gap')
  );
  if (blockingItems.length > 0) {
    const firstItem = blockingItems[0] ?? 'Source-backed evidence';
    const remainingCount = Math.max(blockingItems.length - 1, 0);
    return {
      value: firstItem,
      detail: remainingCount > 0
        ? `${remainingCount} more blocking ${remainingCount === 1 ? 'gap' : 'gaps'} need evidence before the profile is reliable.`
        : 'This is the main blocking gap before the profile can support a reliable decision.',
    };
  }
  const probe = decision.missingContext.find((item) => item.toLowerCase().startsWith('probe:'));
  if (probe) {
    return {
      value: 'Calibration probe recommended',
      detail: probe.replace(/^probe:\s*/i, ''),
    };
  }
  return {
    value: 'No blocking evidence gap',
    detail: 'The decision can be used as source-backed signal; confirm it transfers beyond this PR.',
  };
}

function uncertaintyForDecision(input: {
  score: CodeReviewScoreProjection | null;
  challenge: CodeReviewChallengeProjection | null;
  proofCount: number;
  hasTranscript: boolean;
  hasMatchProvenance: boolean;
  probes: string[];
}): { value: string; detail: string } {
  const scoreValue = input.score?.score;
  const hasScore = scoreValue !== null && scoreValue !== undefined;
  const hasMatchedChallenge = hasMatchedReviewChallenge(input.challenge);
  if (!hasMatchedChallenge) {
    return {
      value: 'Repo fit unknown',
      detail: 'PIPE has not proven that the assigned repo or PR is a fair test of this person yet.',
    };
  }
  if (!input.hasMatchProvenance) {
    return {
      value: 'Repo-match proof incomplete',
      detail: 'PIPE has a visible repo challenge, but the source-backed match decision record is missing from the person graph.',
    };
  }
  if (!hasScore) {
    return {
      value: 'Performance not scored',
      detail: 'The assessment has not produced a durable score report, so the profile should not imply technical strength yet.',
    };
  }
  if (!input.hasTranscript || input.proofCount < 4) {
    return {
      value: 'Evidence chain incomplete',
      detail: 'A score exists, but the supporting transcript, challenge, or source proof is not complete enough to treat as high-confidence signal.',
    };
  }
  if (scoreValue !== null && scoreValue !== undefined && scoreValue < 60) {
    return {
      value: 'Assignment fairness risk',
      detail: 'The weak signal may reflect the candidate, the selected PR, or incomplete context. Check fit before rejecting from this result.',
    };
  }
  if (input.probes.length > 0) {
    return {
      value: 'Focused calibration needed',
      detail: input.probes[0] ?? 'Use the next conversation to calibrate the remaining code-review uncertainty.',
    };
  }
  return {
    value: 'Low remaining uncertainty',
    detail: 'The main remaining question is whether this signal generalizes beyond the selected PR.',
  };
}

function missingContextForDecision(input: {
  score: CodeReviewScoreProjection | null;
  challenge: CodeReviewChallengeProjection | null;
  proofCount: number;
  hasTranscript: boolean;
  hasMatchProvenance: boolean;
  probes: string[];
}): string[] {
  const items: string[] = [];
  const hasScore = input.score?.score !== null && input.score?.score !== undefined;
  const hasMatchedChallenge = hasMatchedReviewChallenge(input.challenge);
  if (!hasMatchedChallenge) items.push('Source-backed repo challenge selection');
  if (!input.hasMatchProvenance) items.push('Source-backed repo match decision provenance');
  if (!hasScore) items.push('Completed code-review score report');
  if (!input.hasTranscript) items.push('Candidate review transcript or review conversation');
  if (input.proofCount < 4) items.push('Complete candidate/repo provenance chain');
  for (const probe of input.probes.slice(0, 2)) {
    items.push(`Probe: ${probe}`);
  }
  return items.length > 0
    ? items.slice(0, 4)
    : ['No blocking evidence gap; confirm the signal transfers beyond this PR.'];
}

function sourceProofLabel(source: LivingContextRecordSourceRef): string {
  return (source.evidenceRole ?? source.sourceRefType ?? 'source')
    .replace(/[_-]+/g, ' ')
    .toLowerCase();
}

function sourceProofText(source: LivingContextRecordSourceRef): string | null {
  if (typeof source.exactText === 'string' && source.exactText.trim()) {
    return source.exactText.length > 180 ? `${source.exactText.slice(0, 180)}...` : source.exactText;
  }
  if ('locator' in source && isRecord(source.locator)) {
    const repo = optionalString(source.locator.repoFullName)
      ?? optionalString(source.locator.fullName)
      ?? optionalString(source.locator.repoUrl);
    const pr = optionalNumber(source.locator.prNumber);
    if (repo && pr !== null) return `${repo} PR #${pr}`;
    if (repo) return repo;
  }
  return 'Source reference preserved';
}

function deriveCodeReviewDecision(
  livingContext: LivingContextReadModel | null,
): CodeReviewDecisionProjection | null {
  if (!livingContext) return null;
  const codeReviewRecords = livingContext.contextRecords
    .filter((record) => record.recordType === 'code_review_score_report' || record.recordType === 'code_review_transcript')
    .sort((a, b) => recordTimestamp(b) - recordTimestamp(a));
  if (codeReviewRecords.length === 0) return null;

  const scoreRecord = codeReviewRecords.find((record) => record.recordType === 'code_review_score_report') ?? null;
  const score = parseScoreProjection(scoreRecord);
  const sessionId = sessionIdFromRecord(scoreRecord) ?? sessionIdFromRecord(codeReviewRecords[0] ?? null);
  const transcriptRecord = codeReviewRecords.find((record) =>
    record.recordType === 'code_review_transcript'
    && (!sessionId || sessionIdFromRecord(record) === sessionId),
  ) ?? codeReviewRecords.find((record) => record.recordType === 'code_review_transcript') ?? null;
  const matchRecord = livingContext.contextRecords
    .filter((record) => record.recordType === 'candidate_pr_match_decision' || record.predicate === 'selects review challenge')
    .sort((a, b) => recordTimestamp(b) - recordTimestamp(a))[0] ?? null;
  const matchChallenge = readChallengeProjection(matchRecord);
  const challenge = matchChallenge
    ?? readChallengeProjection(scoreRecord)
    ?? readChallengeProjection(transcriptRecord)
    ?? readChallengeProjection(codeReviewRecords[0] ?? null);
  const hasMatchProvenance = Boolean(matchRecord && matchRecord.sources.length > 0 && hasMatchedReviewChallenge(matchChallenge));
  const recommendation = recommendationForScore(score, challenge);
  const scoreLabel = score?.score !== null && score?.score !== undefined
    ? `${Math.round(score.score)}/100${score.band ? ` ${titleCaseToken(score.band)}` : ''}`
    : null;
  const challengeLabel = challenge?.repoLabel
    ? `${challenge.repoLabel}${challenge.prNumber !== null ? ` PR #${challenge.prNumber}` : ''}`
    : null;
  const proofSources = [scoreRecord, transcriptRecord, matchRecord]
    .filter((record): record is LivingContextRecord => record !== null)
    .flatMap((record) => record.sources.map((source) => ({ record, source })));
  const proofItems = proofSources.slice(0, 6).map(({ record, source }, index) => ({
    id: `${record.id}:${index}:${source.sourceRefId ?? source.sourceSpanId ?? 'source'}`,
    label: sourceProofLabel(source),
    text: sourceProofText(source),
  }));
  const assessmentValidity = assessmentValidityForDecision({
    score,
    challenge,
    proofCount: proofSources.length,
    hasTranscript: Boolean(transcriptRecord),
    hasMatchProvenance,
  });
  const probes = score?.growthAreas ?? [];
  const uncertainty = uncertaintyForDecision({
    score,
    challenge,
    proofCount: proofSources.length,
    hasTranscript: Boolean(transcriptRecord),
    hasMatchProvenance,
    probes,
  });
  const missingContext = missingContextForDecision({
    score,
    challenge,
    proofCount: proofSources.length,
    hasTranscript: Boolean(transcriptRecord),
    hasMatchProvenance,
    probes,
  });
  const nextAction = nextActionForDecision(recommendation.value, score);
  const basisItems: CodeReviewBasisItem[] = [
    {
      label: 'Score report',
      value: scoreLabel ?? 'Missing',
      satisfied: Boolean(scoreLabel),
    },
    {
      label: 'Review transcript',
      value: transcriptRecord ? 'Captured' : 'Missing',
      satisfied: Boolean(transcriptRecord),
    },
    {
      label: 'Repo challenge',
      value: challengeLabel ?? 'Missing',
      satisfied: hasMatchedReviewChallenge(challenge),
    },
    {
      label: 'Match proof',
      value: hasMatchProvenance && matchRecord
        ? 'Source-backed match'
        : 'Missing',
      satisfied: hasMatchProvenance,
    },
  ];

  return {
    decisionLabel: 'Code-review decision',
    sessionId,
    outcome: verdictLabel(optionalString(transcriptRecord?.qualifiers.finalVerdictDecision)),
    recommendation: recommendation.value,
    recommendationDetail: recommendation.detail,
    uncertainty: uncertainty.value,
    uncertaintyDetail: uncertainty.detail,
    missingContext,
    assessmentValidity: assessmentValidity.value,
    assessmentValidityDetail: assessmentValidity.detail,
    nextAction: nextAction.value,
    nextActionDetail: nextAction.detail,
    scoreLabel,
    challengeLabel,
    challengeUrl: challengeUrlForProjection(challenge),
    narrative: score?.narrative ?? transcriptRecord?.narrative ?? scoreRecord?.narrative ?? null,
    strengths: score?.strengths ?? [],
    probes,
    proofCount: proofItems.length,
    proofItems,
    basisItems,
  };
}

function isAssessmentEvaluationRecord(record: LivingContextRecord): boolean {
  return record.recordType.startsWith('evaluation:');
}

function isAssessmentScopedRecord(record: LivingContextRecord): boolean {
  return record.recordType.startsWith('assessment:')
    || record.entities.some((entity) => entity.entityType.startsWith('assessment_'))
    || record.sources.some((source) => optionalString(source.sourceRefType)?.startsWith('assessment_') === true);
}

function isHumanAssessmentDecisionRecord(record: LivingContextRecord): boolean {
  return record.recordType === 'assessment:human_assessment_decision'
    || record.predicate === 'human_assessment_decision'
    || (optionalString(record.qualifiers.decision) !== null && isAssessmentScopedRecord(record));
}

function deriveWorkspaceAssessmentDecision(
  livingContext: LivingContextReadModel | null,
): CodeReviewDecisionProjection | null {
  if (!livingContext) return null;
  const assessmentRecords = livingContext.contextRecords
    .filter((record) => isAssessmentEvaluationRecord(record) || isHumanAssessmentDecisionRecord(record))
    .sort((a, b) => recordTimestamp(b) - recordTimestamp(a));
  if (assessmentRecords.length === 0) return null;

  const humanDecisionRecord = assessmentRecords.find(isHumanAssessmentDecisionRecord) ?? null;
  const sessionId = sessionIdFromRecord(humanDecisionRecord)
    ?? assessmentRecords.map(sessionIdFromRecord).find((value): value is string => Boolean(value))
    ?? null;
  const evaluationRecords = assessmentRecords.filter((record) =>
    isAssessmentEvaluationRecord(record)
      && (!sessionId || sessionIdFromRecord(record) === sessionId)
  );
  if (evaluationRecords.length === 0 && !humanDecisionRecord) return null;

  const proofSources = [humanDecisionRecord, ...evaluationRecords]
    .filter((record): record is LivingContextRecord => record !== null)
    .flatMap((record) => record.sources.map((source) => ({ record, source })));
  const proofItems = proofSources.slice(0, 6).map(({ record, source }, index) => ({
    id: `${record.id}:${index}:${source.sourceRefId ?? source.sourceSpanId ?? 'source'}`,
    label: sourceProofLabel(source),
    text: sourceProofText(source),
  }));
  const positiveClaims = evaluationRecords.filter((record) => record.polarity > 0 || record.predicate === 'positive');
  const negativeClaims = evaluationRecords.filter((record) => record.polarity < 0 || record.predicate === 'negative');
  const reportSummary = evaluationRecords
    .map((record) => optionalString(record.qualifiers.reportSummary))
    .find((value): value is string => Boolean(value))
    ?? humanDecisionRecord?.narrative
    ?? evaluationRecords[0]?.narrative
    ?? null;
  const humanDecision = optionalString(humanDecisionRecord?.qualifiers.decision)
    ?? optionalString(humanDecisionRecord?.predicate);
  const hasHumanAdvance = humanDecision?.toLowerCase() === 'advance';
  const hasHumanDecision = humanDecisionRecord !== null;

  const recommendation = hasHumanAdvance
    ? {
        value: 'Advance from human-reviewed assessment',
        detail: humanDecisionRecord?.narrative
          ?? 'A human reviewer advanced this person from source-backed assessment evidence.',
      }
    : hasHumanDecision
      ? {
          value: 'Use human assessment decision',
          detail: humanDecisionRecord?.narrative
            ?? 'A human reviewer recorded a source-backed assessment decision.',
        }
      : {
          value: 'Review workspace assessment',
          detail: reportSummary
            ?? 'Source-backed workspace assessment claims exist and need hiring-team review.',
        };
  const assessmentValidity = proofItems.length >= 3 && evaluationRecords.length > 0
    ? {
        value: 'Usable workspace assessment signal',
        detail: 'Evaluation claims, source refs, and assessment evidence are present. Use this as person-level signal, not an automatic decision.',
      }
    : {
        value: 'Partial workspace assessment signal',
        detail: 'Assessment evidence exists, but the source chain is incomplete. Review the underlying interaction before relying on it.',
      };
  const uncertainty = negativeClaims.length > 0
    ? {
        value: 'Assessment has cautions',
        detail: 'The workspace assessment includes negative or cautionary claims that need calibration before a hiring decision.',
      }
    : hasHumanDecision && proofItems.length >= 3
      ? {
          value: 'Low remaining uncertainty',
          detail: 'A human reviewer and source-backed evaluator evidence both support this assessment signal.',
        }
      : {
          value: 'Human calibration needed',
          detail: 'Use a recruiter or hiring-manager review to decide whether the assessment signal generalizes.',
        };
  const missingContext = negativeClaims.length > 0
    ? ['Review evaluator cautions before using this as final hiring signal']
    : ['No blocking evidence gap; confirm the signal transfers beyond this task.'];
  const nextAction = hasHumanDecision
    ? {
        value: 'Review with hiring team',
        detail: 'Use the human decision, evaluator claims, and source proof to calibrate the hiring recommendation.',
      }
    : {
        value: 'Record human assessment decision',
        detail: 'Have a reviewer inspect the source-backed evidence and record advance, hold, reject, or needs-more-evidence.',
      };
  const basisItems: CodeReviewBasisItem[] = [
    {
      label: 'Evaluation claims',
      value: positiveClaims.length > 0 ? `${positiveClaims.length} positive` : 'Missing',
      satisfied: positiveClaims.length > 0,
    },
    {
      label: 'Human decision',
      value: humanDecisionRecord ? titleCaseToken(humanDecision ?? 'recorded') : 'Missing',
      satisfied: humanDecisionRecord !== null,
    },
    {
      label: 'Source proof',
      value: proofItems.length > 0 ? `${proofItems.length} refs` : 'Missing',
      satisfied: proofItems.length > 0,
    },
    {
      label: 'Assessment mode',
      value: optionalString(evaluationRecords[0]?.qualifiers.mode)
        ?? optionalString(humanDecisionRecord?.qualifiers.mode)
        ?? 'Workspace assessment',
      satisfied: true,
    },
  ];

  return {
    decisionLabel: 'Workspace assessment decision',
    sessionId,
    outcome: hasHumanDecision ? `Human: ${titleCaseToken(humanDecision ?? 'recorded')}` : null,
    recommendation: recommendation.value,
    recommendationDetail: recommendation.detail,
    uncertainty: uncertainty.value,
    uncertaintyDetail: uncertainty.detail,
    missingContext,
    assessmentValidity: assessmentValidity.value,
    assessmentValidityDetail: assessmentValidity.detail,
    nextAction: nextAction.value,
    nextActionDetail: nextAction.detail,
    scoreLabel: null,
    challengeLabel: null,
    challengeUrl: null,
    narrative: reportSummary,
    strengths: positiveClaims.map((record) => record.narrative).slice(0, 3),
    probes: negativeClaims.map((record) => record.narrative).slice(0, 2),
    proofCount: proofItems.length,
    proofItems,
    basisItems,
  };
}

function humanAssessmentDecisionLabel(decision: string): string {
  switch (decision) {
    case 'advance':
      return 'Advance';
    case 'hold':
      return 'Hold';
    case 'reject':
      return 'Reject';
    case 'needs_more_evidence':
      return 'Needs more evidence';
    default:
      return titleCaseToken(decision);
  }
}

function assessmentEvaluationRecommendationLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  switch (value) {
    case 'advance':
      return 'Advance';
    case 'hold':
      return 'Hold';
    case 'reject':
      return 'Reject';
    case 'needs_more_evidence':
      return 'Needs more evidence';
    default:
      return titleCaseToken(value);
  }
}

function deriveSelectedWorkspaceAssessmentDecision(
  progress: AssessmentProgressSnapshot | null,
): CodeReviewDecisionProjection | null {
  if (!progress?.humanDecision && !progress?.evaluation) return null;

  const sourceRefCount = progress.humanDecision?.sourceRefCount
    ?? progress.evaluation?.evidenceCoverage?.sourceRefCount
    ?? progress.sourceRefCounts.reduce((total, item) => total + item.count, 0)
    ?? 0;
  const proofItems = progress.evidenceSnippets?.slice(0, 6).map((snippet, index) => ({
    id: `${progress.session.id}:${index}:${snippet.sourceRefType}:${snippet.occurredAt}`,
    label: snippet.sourceRefType.replace(/[_-]+/g, ' ').toLowerCase(),
    text: snippet.exactText.length > 180 ? `${snippet.exactText.slice(0, 180)}...` : snippet.exactText,
  })) ?? [];
  const positiveClaims = progress.evaluation?.claims?.filter((claim) => claim.polarity === 'positive') ?? [];
  const negativeClaims = progress.evaluation?.claims?.filter((claim) => claim.polarity === 'negative') ?? [];
  const humanDecision = progress.humanDecision?.decision ?? null;
  const recommendation = progress.humanDecision
    ? humanAssessmentDecisionLabel(progress.humanDecision.decision)
    : assessmentEvaluationRecommendationLabel(progress.evaluation?.recommendation) ?? 'Review selected assessment';
  const recommendationDetail = progress.humanDecision?.summary
    ?? progress.evaluation?.summary
    ?? 'The selected interview has source-backed assessment evidence, but the accumulated person graph has not absorbed it yet.';
  const hasCompleteProof = sourceRefCount >= 3 && Boolean(progress.evaluation);
  const assessmentValidity = hasCompleteProof
    ? {
        value: 'Usable workspace assessment signal',
        detail: 'The selected interview includes evaluator evidence and source references. Treat this as selected-interaction signal until the person graph rollup catches up.',
      }
    : {
        value: 'Partial workspace assessment signal',
        detail: 'The selected interview has assessment evidence, but the source chain is not complete enough for high confidence.',
      };
  const uncertainty = negativeClaims.length > 0
    ? {
        value: 'Assessment has cautions',
        detail: negativeClaims[0]?.narrative ?? 'The evaluator raised a caution that needs hiring-team calibration.',
      }
    : progress.humanDecision && hasCompleteProof
      ? {
          value: 'Low remaining uncertainty',
          detail: 'The selected assessment has a human decision and source-backed evaluator evidence.',
        }
      : {
          value: 'Graph rollup pending',
          detail: 'The assessment is visible from the selected interview, but the person-level graph still needs to ingest the full decision evidence.',
        };
  const missingContext = negativeClaims.length > 0
    ? ['Review evaluator cautions before using this as final hiring signal']
    : progress.humanDecision
      ? ['Persist this selected assessment into the person graph rollup']
      : ['Record a human assessment decision after reviewing the selected interview evidence'];
  const nextAction = progress.humanDecision
    ? {
        value: 'Review with hiring team',
        detail: 'Use this selected-interview assessment with the profile evidence while the graph rollup catches up.',
      }
    : {
        value: 'Record human assessment decision',
        detail: 'Have a reviewer inspect the selected assessment evidence and record advance, hold, reject, or needs-more-evidence.',
      };

  return {
    decisionLabel: 'Workspace assessment decision',
    sessionId: progress.session.id,
    outcome: humanDecision ? `Human: ${humanAssessmentDecisionLabel(humanDecision)}` : null,
    recommendation,
    recommendationDetail,
    uncertainty: uncertainty.value,
    uncertaintyDetail: uncertainty.detail,
    missingContext,
    assessmentValidity: assessmentValidity.value,
    assessmentValidityDetail: assessmentValidity.detail,
    nextAction: nextAction.value,
    nextActionDetail: nextAction.detail,
    scoreLabel: null,
    challengeLabel: progress.challenge?.locator.repositoryUrl
      ? String(progress.challenge.locator.repositoryUrl).replace(/^https:\/\/github\.com\//, '')
      : null,
    challengeUrl: typeof progress.challenge?.locator.repositoryUrl === 'string'
      ? progress.challenge.locator.repositoryUrl
      : null,
    narrative: progress.evaluation?.summary ?? progress.humanDecision?.summary ?? null,
    strengths: positiveClaims.map((claim) => claim.narrative).slice(0, 3),
    probes: negativeClaims.map((claim) => claim.narrative).slice(0, 2),
    proofCount: Math.max(sourceRefCount, proofItems.length),
    proofItems,
    basisItems: [
      {
        label: 'Selected interview',
        value: 'Assessment evidence',
        satisfied: true,
      },
      {
        label: 'Evaluation claims',
        value: positiveClaims.length > 0 ? `${positiveClaims.length} positive` : progress.evaluation ? 'Recorded' : 'Missing',
        satisfied: Boolean(progress.evaluation),
      },
      {
        label: 'Human decision',
        value: humanDecision ? humanAssessmentDecisionLabel(humanDecision) : 'Missing',
        satisfied: humanDecision !== null,
      },
      {
        label: 'Source proof',
        value: sourceRefCount > 0 ? `${sourceRefCount} refs` : 'Missing',
        satisfied: sourceRefCount > 0,
      },
    ],
  };
}

function Metric({ label, value }: { label: string; value: number }): JSX.Element {
  return (
    <div style={METRIC_CARD}>
      <div style={METRIC_VALUE}>
        {value}
      </div>
      <div style={FIELD_LABEL}>
        {label}
      </div>
    </div>
  );
}

function InfoRow({ icon, label, value }: { icon: JSX.Element; label: string; value: string | null | undefined }): JSX.Element {
  return (
    <div style={INFO_ROW}>
      <div style={{ color: 'var(--pipe-text-dim)', marginTop: 1 }}>{icon}</div>
      <div style={{ minWidth: 0 }}>
        <div style={FIELD_LABEL}>{label}</div>
        <div style={FIELD_VALUE}>
          {value || 'Not recorded'}
        </div>
      </div>
    </div>
  );
}

function EmptyPanel({ children }: { children: string }): JSX.Element {
  return (
    <div style={{
      border: '1px dashed var(--pipe-border)',
      borderRadius: 6,
      color: 'var(--pipe-text-dim)',
      padding: 24,
      textAlign: 'center',
      fontSize: 12,
    }}>
      {children}
    </div>
  );
}

function ProfileDecisionCockpit({
  decision,
  livingContext,
  onCreateNextInterview,
}: {
  decision: CodeReviewDecisionProjection | null;
  livingContext: LivingContextReadModel | null;
  onCreateNextInterview: () => void;
}): JSX.Element {
  const hasEvidence = (livingContext?.summary.interactionCount ?? 0) > 0
    || (livingContext?.summary.contextRecordCount ?? 0) > 0
    || (livingContext?.summary.artifactCount ?? 0) > 0;
  const proofCount = decision?.proofCount ?? livingContext?.summary.sourceSpanCount ?? 0;
  const proofLabel = decision
    ? `source proof ${proofCount === 1 ? 'item' : 'items'}`
    : `source ${proofCount === 1 ? 'span' : 'spans'}`;
  const missingContextCard = missingContextCardForDecision(decision, hasEvidence);
  const cards = decision
    ? [
        {
          label: 'Current recommendation',
          value: decision.recommendation,
          detail: decision.recommendationDetail,
        },
        {
          label: 'Assessment validity',
          value: decision.assessmentValidity,
          detail: decision.assessmentValidityDetail,
        },
        {
          label: 'Uncertainty',
          value: decision.uncertainty,
          detail: decision.uncertaintyDetail,
        },
        {
          label: 'Missing context',
          value: missingContextCard.value,
          detail: missingContextCard.detail,
        },
        {
          label: 'Next action',
          value: decision.nextAction,
          detail: decision.nextActionDetail,
        },
      ]
    : [
        {
          label: 'Current recommendation',
          value: hasEvidence ? 'Keep collecting source-backed signal' : 'Collect first source-backed evidence',
          detail: hasEvidence
            ? 'The profile has relationship evidence, but no complete code-review decision yet.'
            : 'Start with an invite, resume, call, or assessment before presenting a hiring recommendation.',
        },
        {
          label: 'Assessment validity',
          value: hasEvidence ? 'Profile evidence accumulating' : 'No assessment signal yet',
          detail: 'PIPE should not imply technical fit until a score, transcript, or repo challenge is attached.',
        },
        {
          label: 'Uncertainty',
          value: 'Decision not ready',
          detail: 'The profile needs role, candidate, or assessment evidence before a hiring manager can rely on it.',
        },
        {
          label: 'Missing context',
          value: missingContextCard.value,
          detail: missingContextCard.detail,
        },
        {
          label: 'Next action',
          value: 'Schedule targeted context gathering',
          detail: 'Use the missing evidence to decide whether the next step should be a call, resume review, or code review.',
        },
      ];

  return (
    <section data-testid="person-decision-cockpit" style={PROFILE_COCKPIT}>
      <div style={PROFILE_COCKPIT_HEADER}>
        <div style={{ minWidth: 0 }}>
          <div style={{ ...SECTION_TITLE, marginBottom: 8 }}>
            <Signal size={15} />
            Decision cockpit
          </div>
          <p style={BODY_COPY}>
            Person-level view of recommendation, uncertainty, next action, and source proof. Meeting pages stay scoped to the individual interaction.
          </p>
        </div>
        <div style={PROFILE_COCKPIT_PROOF}>
          <div style={FIELD_LABEL}>Proof trail</div>
          <div style={PROFILE_COCKPIT_PROOF_VALUE}>
            {proofCount} {proofLabel}
          </div>
        </div>
      </div>
      <div style={PROFILE_COCKPIT_GRID}>
        {cards.map((card) => (
          <div key={card.label} style={PROFILE_COCKPIT_CARD}>
            <div style={FIELD_LABEL}>{card.label}</div>
            <div style={PROFILE_COCKPIT_VALUE}>{card.value}</div>
            <p style={PROFILE_COCKPIT_DETAIL}>{card.detail}</p>
          </div>
        ))}
      </div>
      <div style={PROFILE_COCKPIT_ACTION_ROW}>
        <button
          type="button"
          data-testid="person-next-action-cta"
          onClick={onCreateNextInterview}
          style={PROFILE_COCKPIT_ACTION}
        >
          <Calendar size={14} />
          {nextInterviewCtaLabel(decision)}
        </button>
      </div>
    </section>
  );
}

function CodeReviewDecisionCard({ decision }: { decision: CodeReviewDecisionProjection }): JSX.Element {
  const signalSummary = [
    decision.scoreLabel,
    decision.challengeLabel,
    decision.outcome,
  ].filter((item): item is string => Boolean(item)).join(' · ') || decision.recommendationDetail;
  const trustSummary = [
    decision.assessmentValidity,
    `${decision.proofCount} source-backed proof ${decision.proofCount === 1 ? 'item' : 'items'}`,
  ].join(' · ');
  const calibrationSummary = [
    decision.uncertainty,
    decision.nextAction,
  ].join(' · ');

  return (
    <section data-testid="person-code-review-decision" style={CODE_REVIEW_DECISION}>
      <div style={CODE_REVIEW_DECISION_HEADER}>
        <div style={{ minWidth: 0 }}>
          <div style={DECISION_EYEBROW}>{decision.decisionLabel}</div>
          <h2 style={DECISION_TITLE}>{decision.recommendation}</h2>
          <p style={DECISION_COPY}>{decision.recommendationDetail}</p>
        </div>
        <CheckCircle size={24} color="var(--pipe-accent)" />
      </div>

      <div data-testid="person-code-review-decision-basis" style={DECISION_BASIS}>
        <div style={DECISION_BASIS_TITLE}>Decision basis</div>
        <div style={DECISION_BASIS_GRID}>
          {decision.basisItems.map((item) => (
            <div
              key={item.label}
              style={item.satisfied ? DECISION_BASIS_ITEM_OK : DECISION_BASIS_ITEM_MISSING}
            >
              <div style={DECISION_FACT_LABEL}>{item.label}</div>
              <div style={DECISION_BASIS_VALUE}>{item.value}</div>
            </div>
          ))}
        </div>
      </div>

      <div data-testid="person-code-review-rationale" style={DECISION_RATIONALE}>
        <div style={DECISION_BASIS_TITLE}>Why this recommendation</div>
        <div style={DECISION_RATIONALE_GRID}>
          <div style={DECISION_RATIONALE_ITEM}>
            <div style={DECISION_FACT_LABEL}>Signal</div>
            <div style={DECISION_COPY}>{signalSummary}</div>
          </div>
          <div style={DECISION_RATIONALE_ITEM}>
            <div style={DECISION_FACT_LABEL}>Trust</div>
            <div style={DECISION_COPY}>{trustSummary}</div>
          </div>
          <div style={DECISION_RATIONALE_ITEM}>
            <div style={DECISION_FACT_LABEL}>Calibrate</div>
            <div style={DECISION_COPY}>{calibrationSummary}</div>
          </div>
        </div>
      </div>

      <div style={DECISION_FACT_GRID}>
        {decision.scoreLabel && (
          <div style={DECISION_FACT}>
            <div style={DECISION_FACT_LABEL}>Candidate signal</div>
            <div style={DECISION_FACT_VALUE}>{decision.scoreLabel}</div>
          </div>
        )}
        {decision.scoreProvenanceLabel && (
          <div style={DECISION_FACT}>
            <div style={DECISION_FACT_LABEL}>Score provenance</div>
            <div style={DECISION_FACT_VALUE}>{decision.scoreProvenanceLabel}</div>
          </div>
        )}
        {decision.challengeLabel && (
          <div style={DECISION_FACT}>
            <div style={DECISION_FACT_LABEL}>Repo challenge</div>
            {decision.challengeUrl ? (
              <a href={decision.challengeUrl} target="_blank" rel="noreferrer" style={DECISION_LINK}>
                <GitPullRequest size={14} />
                {decision.challengeLabel}
              </a>
            ) : (
              <div style={DECISION_FACT_VALUE}>{decision.challengeLabel}</div>
            )}
          </div>
        )}
        {decision.outcome && (
          <div style={DECISION_FACT}>
            <div style={DECISION_FACT_LABEL}>Review outcome</div>
            <div style={DECISION_FACT_VALUE}>{decision.outcome}</div>
          </div>
        )}
        <div style={DECISION_FACT}>
          <div style={DECISION_FACT_LABEL}>Proof</div>
          <div style={DECISION_FACT_VALUE}>{decision.proofCount} source-backed proof items</div>
        </div>
        <div style={DECISION_FACT}>
          <div style={DECISION_FACT_LABEL}>Assessment validity</div>
          <div style={DECISION_FACT_VALUE}>{decision.assessmentValidity}</div>
          <p style={DECISION_FACT_DETAIL}>{decision.assessmentValidityDetail}</p>
        </div>
        <div style={DECISION_FACT}>
          <div style={DECISION_FACT_LABEL}>Uncertainty</div>
          <div style={DECISION_FACT_VALUE}>{decision.uncertainty}</div>
          <p style={DECISION_FACT_DETAIL}>{decision.uncertaintyDetail}</p>
        </div>
        <div style={DECISION_FACT}>
          <div style={DECISION_FACT_LABEL}>Missing context</div>
          <ul style={DECISION_LIST}>
            {decision.missingContext.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        <div style={DECISION_FACT}>
          <div style={DECISION_FACT_LABEL}>Next action</div>
          <div style={DECISION_FACT_VALUE}>{decision.nextAction}</div>
          <p style={DECISION_FACT_DETAIL}>{decision.nextActionDetail}</p>
        </div>
      </div>

      {decision.narrative && (
        <p style={DECISION_NARRATIVE}>{decision.narrative}</p>
      )}

      {(decision.strengths.length > 0 || decision.probes.length > 0) && (
        <div style={DECISION_COLUMNS}>
          {decision.strengths.length > 0 && (
            <div>
              <div style={DECISION_FACT_LABEL}>Why it matters</div>
              {decision.strengths.slice(0, 2).map((strength) => (
                <p key={strength} style={DECISION_COPY}>{strength}</p>
              ))}
            </div>
          )}
          {decision.probes.length > 0 && (
            <div>
              <div style={DECISION_FACT_LABEL}>What to probe</div>
              {decision.probes.slice(0, 2).map((probe) => (
                <p key={probe} style={DECISION_COPY}>{probe}</p>
              ))}
            </div>
          )}
        </div>
      )}

      <details data-testid="person-code-review-source-proof" style={DECISION_PROOF}>
        <summary style={DECISION_PROOF_SUMMARY}>
          <span>Source proof</span>
          <span style={DECISION_PROOF_HINT}>candidate, repo, and scoring provenance</span>
        </summary>
        <div style={DECISION_PROOF_LIST}>
          {decision.proofItems.map((item) => (
            <div key={item.id} style={DECISION_PROOF_ITEM}>
              <div style={DECISION_FACT_LABEL}>{item.label}</div>
              {item.text && <div style={DECISION_PROOF_TEXT}>{item.text}</div>}
            </div>
          ))}
        </div>
      </details>
    </section>
  );
}

export default function PersonProfilePage(): JSX.Element {
  const { personId } = useParams<{ personId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const api = useApiClient();
  const navigationLivingContext = livingContextFromNavigationState(location.state);
  const navigationCandidateId = candidateIdFromNavigationState(location.state);
  const selectedAssessment = selectedAssessmentFromNavigationState(location.state);
  const selectedCodeReviewDecision = codeReviewDecisionFromNavigationState(location.state);
  const hasInitialLivingContext = navigationLivingContext !== null;

  const [contact, setContact] = useState<PersonContact | null>(null);
  const [livingContext, setLivingContext] = useState<LivingContextReadModel | null>(navigationLivingContext);
  const [isLoading, setIsLoading] = useState(!hasInitialLivingContext);
  const [error, setError] = useState<string | null>(null);
  const [showSourceGraph, setShowSourceGraph] = useState(false);
  const [hasRequestedFullContext, setHasRequestedFullContext] = useState(false);

  const contextEndpoint = personId ? `/api/v1/contacts/${personId}/living-context` : null;
  const summaryEndpoint = contextEndpoint ? `${contextEndpoint}/summary` : null;
  const candidateContextEndpoint = navigationCandidateId
    ? `/api/v1/candidates/${navigationCandidateId}/living-context`
    : null;

  const hydrateFullContext = useCallback(async (): Promise<void> => {
    if (!contextEndpoint || hasRequestedFullContext) return;
    setHasRequestedFullContext(true);
    try {
      const fullContext = await api.get<LivingContextReadModel>(contextEndpoint);
      if (fullContext) setLivingContext(fullContext);
    } catch (err) {
      if (candidateContextEndpoint) {
        try {
          const candidateContext = await api.get<unknown>(candidateContextEndpoint);
          const parsedCandidateContext = livingContextFromCandidateResponse(candidateContext);
          if (parsedCandidateContext) setLivingContext(parsedCandidateContext);
          return;
        } catch (candidateErr) {
          console.error('[PersonProfilePage] Background candidate profile hydration failed:', candidateErr);
        }
      }
      console.error('[PersonProfilePage] Background profile hydration failed:', err);
      setHasRequestedFullContext(false);
    }
  }, [api, candidateContextEndpoint, contextEndpoint, hasRequestedFullContext]);

  const handleSourceAuditToggle = useCallback((event: SyntheticEvent<HTMLDetailsElement>): void => {
    if (event.currentTarget.open) {
      void hydrateFullContext();
    }
  }, [hydrateFullContext]);

  const handleSourceGraphToggle = useCallback((): void => {
    setShowSourceGraph((value) => {
      const nextValue = !value;
      if (nextValue) {
        void hydrateFullContext();
      }
      return nextValue;
    });
  }, [hydrateFullContext]);

  const load = useCallback(async (): Promise<void> => {
    if (!personId || !contextEndpoint || !summaryEndpoint) {
      setError('Missing person id for this profile.');
      setContact(null);
      setLivingContext(null);
      setIsLoading(false);
      return;
    }
    setError(null);

    if (hasInitialLivingContext) {
      try {
        const contactResult = await api.get<{ contact: PersonContact }>(`/api/v1/contacts/${personId}`);
        setContact(contactResult.contact);
      } catch (err) {
        console.error('[PersonProfilePage] Profile contact refresh failed:', err);
      } finally {
        setIsLoading(false);
      }
      return;
    }

    setIsLoading(true);
    try {
      const [contactResult, summaryResult] = await Promise.allSettled([
        api.get<{ contact: PersonContact }>(`/api/v1/contacts/${personId}`),
        api.get<LivingContextReadModel>(summaryEndpoint),
      ]);
      const loadedContact = contactResult.status === 'fulfilled' ? contactResult.value.contact : null;
      let loadedContext = summaryResult.status === 'fulfilled' ? summaryResult.value : navigationLivingContext;
      let candidateContextError: unknown = null;
      if (!loadedContext && candidateContextEndpoint) {
        try {
          const candidateContext = await api.get<unknown>(candidateContextEndpoint);
          loadedContext = livingContextFromCandidateResponse(candidateContext);
        } catch (err) {
          candidateContextError = err;
        }
      }
      if (!loadedContact && !loadedContext) {
        const reason = candidateContextError
          ?? (summaryResult.status === 'rejected' ? summaryResult.reason : null)
          ?? (contactResult.status === 'rejected' ? contactResult.reason : null);
        throw reason instanceof Error ? reason : new Error('Unable to load person profile.');
      }
      setContact(loadedContact);
      setLivingContext(loadedContext ?? navigationLivingContext);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load person profile.');
      setContact(null);
      setLivingContext(null);
    } finally {
      setIsLoading(false);
    }
  }, [
    api,
    candidateContextEndpoint,
    contextEndpoint,
    hasInitialLivingContext,
    navigationLivingContext,
    personId,
    summaryEndpoint,
  ]);

  useEffect(() => {
    void load();
  }, [load]);

  const profileContact = contact ?? contactFromLivingContext(livingContext, personId);
  const displayName = profileContact?.name
    ?? livingContext?.person?.displayName
    ?? profileContact?.email
    ?? 'Person';
  const relationshipLabel = typeLabel(profileContact?.type);
  const roleContext = profileContact?.role ?? livingContext?.person?.roles[0]?.label ?? 'Relationship graph';
  const relationshipSummary = livingContext?.person?.relationshipSummary
    ?? profileContact?.notes
    ?? 'No relationship summary has been earned from evidence yet.';

  const recentInteractions = livingContext?.interactions.slice(0, 5) ?? [];
  const interactionCoverage = interactionCoverageItems(livingContext?.interactions ?? []);
  const recentRecords = livingContext?.contextRecords.slice(0, 5) ?? [];
  const sourceBackedSignals = livingContext?.signals
    .filter((signal) => signal.evidence.some((evidence) => evidence.sources.length > 0))
    .slice(0, 5) ?? [];
  const evidenceArtifacts = livingContext?.artifacts.slice(0, 5) ?? [];
  const codeReviewDecision = deriveCodeReviewDecision(livingContext);
  const decision = codeReviewDecision
    ?? selectedCodeReviewDecision
    ?? deriveWorkspaceAssessmentDecision(livingContext)
    ?? deriveSelectedWorkspaceAssessmentDecision(selectedAssessment);
  const evidenceMix = evidenceMixReadout(livingContext?.interactions ?? [], decision);

  if (isLoading) {
    return (
      <div style={{ padding: 32, color: 'var(--pipe-text-dim)' }}>
        Loading person context...
      </div>
    );
  }

  if (error || !profileContact) {
    return (
      <div style={{ padding: 32 }}>
        <button onClick={() => navigate('/people')} style={backButtonStyle}>
          <ArrowLeft size={14} /> PEOPLE
        </button>
        <EmptyPanel>{error ?? 'Person not found.'}</EmptyPanel>
      </div>
    );
  }

  return (
    <div style={PAGE}>
      <header style={HEADER}>
        <div style={HEADER_PRIMARY}>
          <button onClick={() => navigate('/people')} style={backButtonStyle}>
            <ArrowLeft size={13} /> PEOPLE
          </button>
          <div style={PROFILE_TITLE_ROW}>
            <div style={PROFILE_ICON}>
              <UserRound size={22} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={EYEBROW}>PERSON CONTEXT</div>
              <h1 style={TITLE}>{displayName}</h1>
              <div style={SUBTITLE}>
                {relationshipLabel} · {roleContext}
              </div>
            </div>
          </div>
          <p style={PROFILE_SUMMARY}>{relationshipSummary}</p>
        </div>

        <div style={PROFILE_META_PANEL}>
          <div style={PROFILE_META_HEADER}>
            <div style={{ ...SECTION_TITLE, marginBottom: 0 }}>
              <UserRound size={15} />
              Profile record
            </div>
          </div>
          <InfoRow icon={<Mail size={14} />} label="Email" value={profileContact.email} />
          <InfoRow icon={<Phone size={14} />} label="Phone" value={profileContact.phone ?? livingContext?.person?.primaryPhone} />
          <InfoRow icon={<Briefcase size={14} />} label="Role / context" value={roleContext} />
          <InfoRow icon={<Calendar size={14} />} label="Known since" value={formatDate(profileContact.created_at)} />
        </div>
      </header>

      <section style={EVIDENCE_STRIP}>
        <div style={EVIDENCE_STRIP_COPY}>
          <div style={SECTION_TITLE}>
            <Network size={15} />
            Source-backed profile
          </div>
          <div style={BODY_COPY}>{evidenceSummaryText(livingContext)}</div>
        </div>
        <div style={METRIC_GRID}>
          <Metric label="Interactions" value={livingContext?.summary.interactionCount ?? 0} />
          <Metric label="Learned context" value={livingContext?.summary.contextRecordCount ?? 0} />
          <Metric label="Original spans" value={livingContext?.summary.sourceSpanCount ?? 0} />
          <Metric label="Source artifacts" value={livingContext?.summary.artifactCount ?? 0} />
        </div>
      </section>

      <ProfileDecisionCockpit
        decision={decision}
        livingContext={livingContext}
        onCreateNextInterview={() => navigate(nextInterviewPath(profileContact, decision))}
      />

      {decision && (
        <CodeReviewDecisionCard decision={decision} />
      )}

      <section style={EVIDENCE_GRID}>
        <Panel title="Relationship Timeline" icon={<Calendar size={15} />}>
          <div data-testid="person-interaction-coverage" style={INTERACTION_COVERAGE}>
            <div style={INTERACTION_COVERAGE_HEADER}>
              <div>
                <div style={FIELD_LABEL}>Evidence coverage</div>
                <p style={INTERACTION_COVERAGE_COPY}>
                  {interactionCoverageSummary(livingContext?.interactions ?? [])}
                </p>
              </div>
            </div>
            {interactionCoverage.length > 0 && (
              <div style={INTERACTION_COVERAGE_CHIPS}>
                {interactionCoverage.map((item) => (
                  <span key={item.label} style={INTERACTION_COVERAGE_CHIP}>
                    {item.label}
                  </span>
                ))}
              </div>
            )}
            <div data-testid="person-evidence-mix" style={EVIDENCE_MIX}>
              <div style={FIELD_LABEL}>Evidence mix</div>
              <div style={EVIDENCE_MIX_HEADLINE}>{evidenceMix.headline}</div>
              <p style={INTERACTION_COVERAGE_COPY}>{evidenceMix.detail}</p>
              <div style={EVIDENCE_MIX_NEXT}>
                <span style={FIELD_LABEL}>Next best source</span>
                <span>{evidenceMix.nextSource}</span>
              </div>
            </div>
          </div>
          {recentInteractions.length === 0 ? (
            <EmptyPanel>No interactions have been captured yet.</EmptyPanel>
          ) : recentInteractions.map((interaction) => {
            const scheduledInterviewPath = scheduledInterviewPathFromInteraction(interaction);

            return (
              <article key={interaction.id} style={listItemStyle}>
                <div style={INTERACTION_HEADER_ROW}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: 'var(--pipe-text)', fontWeight: 700 }}>
                      {typeLabel(interaction.interactionType)}
                    </div>
                    <div style={{ marginTop: 5, fontSize: 10, color: 'var(--pipe-text-dim)' }}>
                      {formatDate(interaction.startedAt ?? interaction.createdAt)}
                    </div>
                  </div>
                  {scheduledInterviewPath && (
                    <button
                      type="button"
                      onClick={() => navigate(scheduledInterviewPath)}
                      style={INTERACTION_LINK_BUTTON}
                    >
                      Open interaction
                    </button>
                  )}
                </div>
                {interactionSourceLabel(interaction) && (
                  <div style={{ marginTop: 6, fontSize: 10, color: 'var(--pipe-text-dim)', overflowWrap: 'anywhere' }}>
                    {interactionSourceLabel(interaction)}
                  </div>
                )}
                {metadataSummary(interaction.metadata) && (
                  <p style={{ margin: '8px 0 0', color: 'var(--pipe-text-muted)', fontSize: 12, lineHeight: 1.45 }}>
                    {quietEvidenceText(metadataSummary(interaction.metadata) ?? '')}
                  </p>
                )}
              </article>
            );
          })}
        </Panel>
      </section>

      <details data-testid="person-source-audit" style={SOURCE_AUDIT} onToggle={handleSourceAuditToggle}>
        <summary style={SOURCE_AUDIT_SUMMARY}>
          <span style={SOURCE_AUDIT_TITLE}>
            <FileText size={15} />
            Evidence audit trail
          </span>
          <span style={SOURCE_AUDIT_META}>
            {livingContext?.summary.contextRecordCount ?? 0} records · {livingContext?.summary.artifactCount ?? 0} artifacts
          </span>
        </summary>
        <div style={SOURCE_AUDIT_GRID}>
        <Panel title="Performance Signals" icon={<Signal size={15} />}>
          {sourceBackedSignals.length === 0 ? (
            <EmptyPanel>No source-backed performance evidence yet.</EmptyPanel>
          ) : sourceBackedSignals.map((signal) => (
            <article key={signal.signalKey} style={listItemStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ fontSize: 12, color: 'var(--pipe-text)', fontWeight: 700 }}>
                  {signal.label}
                </div>
                <div style={{ fontSize: 10, color: 'var(--pipe-text-dim)' }}>
                  {signal.evidenceCount} evidence
                </div>
              </div>
              <div style={{ marginTop: 8, fontSize: 11, color: 'var(--pipe-text-muted)', lineHeight: 1.45 }}>
                {Math.round(signal.totalScore * 100)}% accumulated from {signal.sourceDiversity} source{signal.sourceDiversity === 1 ? '' : 's'}.
              </div>
            </article>
          ))}
        </Panel>

        <Panel title="Learned Context" icon={<Network size={15} />}>
          {recentRecords.length === 0 ? (
            <EmptyPanel>No context records yet.</EmptyPanel>
          ) : recentRecords.map((record) => (
            <article key={record.id} style={listItemStyle}>
              <div style={{ fontSize: 10, color: 'var(--pipe-text-dim)', marginBottom: 6 }}>
                {contextRecordTypeLabel(record)}
              </div>
              <div style={{ fontSize: 12, color: 'var(--pipe-text)', fontWeight: 700 }}>
                {contextRecordDisplayTitle(record)}
              </div>
              {contextRecordDisplayNarrative(record) && (
                <p style={{ margin: '8px 0 0', color: 'var(--pipe-text-muted)', fontSize: 12, lineHeight: 1.45 }}>
                  {contextRecordDisplayNarrative(record)}
                </p>
              )}
              <div style={{ marginTop: 8, fontSize: 10, color: 'var(--pipe-text-dim)' }}>
                {record.sources.length} source {record.sources.length === 1 ? 'span' : 'spans'}
              </div>
            </article>
          ))}
        </Panel>

        <Panel title="Original Sources" icon={<FileText size={15} />}>
          {evidenceArtifacts.length === 0 ? (
            <EmptyPanel>No source artifacts have been attached yet.</EmptyPanel>
          ) : evidenceArtifacts.map((artifact) => (
            <article key={artifact.id} style={listItemStyle}>
              <div style={{ fontSize: 12, color: 'var(--pipe-text)', fontWeight: 700 }}>
                {sourceArtifactTitle(artifact)}
              </div>
              <div style={{ marginTop: 6, fontSize: 10, color: 'var(--pipe-text-dim)', overflowWrap: 'anywhere' }}>
                {sourceArtifactDetail(artifact)}
              </div>
              <div style={{ marginTop: 8, fontSize: 10, color: 'var(--pipe-text-dim)' }}>
                {artifact.sourceSpans.length} exact {artifact.sourceSpans.length === 1 ? 'span' : 'spans'}
              </div>
            </article>
          ))}
        </Panel>
        </div>
      </details>

      <section style={GRAPH_SECTION}>
        <div style={GRAPH_HEADER}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <Network size={16} color="var(--pipe-accent)" />
            <div>
              <h2 style={{ margin: 0, fontSize: 18, color: 'var(--pipe-text)', letterSpacing: 0 }}>
                Living Context Graph
              </h2>
              <p style={GRAPH_SUBTITLE}>
                See how conversations, interviews, source artifacts, context records, and evidence-backed signals accumulate around this person.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleSourceGraphToggle}
            style={GRAPH_TOGGLE}
          >
            {showSourceGraph ? 'Hide graph' : 'Open graph'}
          </button>
        </div>
        {showSourceGraph && contextEndpoint ? (
          <Suspense fallback={<div style={SOURCE_GRAPH_PLACEHOLDER}>Loading graph...</div>}>
            <LivingContextGraph
              candidateId={personId ?? profileContact.id}
              livingContextEndpoint={contextEndpoint}
              initialLivingContext={livingContext}
            />
          </Suspense>
        ) : (
          <div style={SOURCE_GRAPH_PLACEHOLDER}>
            This profile is summarized from source-backed context. Open the graph when you need provenance, exact source text, or accumulated relationship evidence.
          </div>
        )}
      </section>
    </div>
  );
}

function Panel({ title, icon, children }: { title: string; icon: JSX.Element; children: ReactNode }): JSX.Element {
  return (
    <section style={SECTION}>
      <div style={SECTION_TITLE}>
        <span style={{ color: 'var(--pipe-text-dim)' }}>{icon}</span>
        {title}
      </div>
      <div style={PANEL_BODY}>
        {children}
      </div>
    </section>
  );
}

const PAGE: CSSProperties = recruiterPageStyle;

const HEADER: CSSProperties = recruiterHeaderStyle;

const HEADER_PRIMARY: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
  minWidth: 280,
  flex: '1 1 440px',
};

const PROFILE_TITLE_ROW: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 14,
  minWidth: 0,
};

const PROFILE_ICON: CSSProperties = {
  flex: '0 0 auto',
  width: 44,
  height: 44,
  border: '1px solid var(--pipe-accent-border)',
  borderRadius: 8,
  background: 'var(--pipe-accent-surface)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'var(--pipe-accent)',
};

const PROFILE_SUMMARY: CSSProperties = {
  maxWidth: 760,
  margin: 0,
  color: 'var(--pipe-text-muted)',
  fontSize: 13,
  lineHeight: 1.55,
};

const PROFILE_META_PANEL: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: 14,
  minWidth: 280,
  flex: '1 1 380px',
  padding: 14,
  border: '1px solid var(--pipe-border)',
  borderRadius: 8,
  background: 'var(--pipe-surface-solid)',
};

const PROFILE_META_HEADER: CSSProperties = {
  gridColumn: '1 / -1',
  paddingBottom: 10,
  borderBottom: '1px solid var(--pipe-border-light)',
};

const EVIDENCE_STRIP: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
  gap: 14,
  alignItems: 'stretch',
  border: '1px solid var(--pipe-border)',
  borderRadius: 8,
  background: 'var(--pipe-surface-solid)',
  padding: 18,
};

const EVIDENCE_STRIP_COPY: CSSProperties = {
  minWidth: 0,
};

const METRIC_GRID: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
  gap: 10,
  minWidth: 0,
};

const METRIC_CARD: CSSProperties = {
  display: 'grid',
  alignContent: 'start',
  gap: 8,
  minWidth: 0,
  minHeight: 82,
  border: '1px solid var(--pipe-border)',
  borderRadius: 6,
  background: 'rgba(255,255,255,0.03)',
  padding: 12,
};

const METRIC_VALUE: CSSProperties = {
  color: 'var(--pipe-text)',
  fontFamily: FONT,
  fontSize: 22,
  fontWeight: 800,
  lineHeight: 1,
};

const INFO_ROW: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 10,
  minWidth: 0,
};

const EVIDENCE_GRID: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
  gap: 14,
  minWidth: 0,
};

const SOURCE_AUDIT: CSSProperties = {
  border: '1px solid var(--pipe-border)',
  borderRadius: 8,
  background: 'var(--pipe-surface-solid)',
  overflow: 'hidden',
};

const SOURCE_AUDIT_SUMMARY: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 14,
  minHeight: 48,
  padding: '14px 16px',
  cursor: 'pointer',
  listStyle: 'none',
  borderBottom: '1px solid var(--pipe-border-light)',
};

const SOURCE_AUDIT_TITLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 9,
  minWidth: 0,
  color: 'var(--pipe-text)',
  fontFamily: FONT,
  fontSize: 12,
  fontWeight: 800,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
};

const SOURCE_AUDIT_META: CSSProperties = {
  flex: '0 0 auto',
  color: 'var(--pipe-text-dim)',
  fontFamily: FONT,
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
};

const SOURCE_AUDIT_GRID: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
  gap: 14,
  minWidth: 0,
  padding: 14,
};

const SECTION: CSSProperties = {
  ...recruiterSectionStyle,
  minHeight: 240,
};

const SECTION_TITLE: CSSProperties = recruiterSectionTitleStyle;

const PANEL_BODY: CSSProperties = {
  display: 'grid',
  gap: 10,
};

const FIELD_LABEL: CSSProperties = recruiterFieldLabelStyle;

const FIELD_VALUE: CSSProperties = recruiterFieldValueStyle;

const BODY_COPY: CSSProperties = {
  color: 'var(--pipe-text-muted)',
  fontSize: 12,
  lineHeight: 1.55,
};

const PROFILE_COCKPIT: CSSProperties = {
  display: 'grid',
  gap: 14,
  border: '1px solid var(--pipe-border)',
  borderRadius: 8,
  background: 'var(--pipe-surface-solid)',
  padding: 18,
};

const PROFILE_COCKPIT_HEADER: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 16,
  minWidth: 0,
};

const PROFILE_COCKPIT_PROOF: CSSProperties = {
  flex: '0 0 auto',
  minWidth: 150,
  padding: 12,
  border: '1px solid var(--pipe-border-light)',
  borderRadius: 6,
  background: 'var(--pipe-surface)',
};

const PROFILE_COCKPIT_PROOF_VALUE: CSSProperties = {
  color: 'var(--pipe-text)',
  fontFamily: FONT,
  fontSize: 14,
  fontWeight: 800,
  lineHeight: 1.3,
};

const PROFILE_COCKPIT_GRID: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
  gap: 10,
  minWidth: 0,
};

const PROFILE_COCKPIT_CARD: CSSProperties = {
  display: 'grid',
  alignContent: 'start',
  gap: 7,
  minWidth: 0,
  minHeight: 112,
  border: '1px solid var(--pipe-border-light)',
  borderRadius: 6,
  background: 'rgba(255,255,255,0.03)',
  padding: 12,
};

const PROFILE_COCKPIT_VALUE: CSSProperties = {
  color: 'var(--pipe-text)',
  fontSize: 14,
  fontWeight: 800,
  lineHeight: 1.3,
  overflowWrap: 'anywhere',
};

const PROFILE_COCKPIT_DETAIL: CSSProperties = {
  margin: 0,
  color: 'var(--pipe-text-muted)',
  fontSize: 11,
  lineHeight: 1.5,
};

const PROFILE_COCKPIT_ACTION_ROW: CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  borderTop: '1px solid var(--pipe-border-light)',
  paddingTop: 12,
};

const PROFILE_COCKPIT_ACTION: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  minHeight: 38,
  border: '1px solid var(--pipe-accent-border)',
  borderRadius: 6,
  background: 'var(--pipe-text)',
  color: 'var(--pipe-bg)',
  cursor: 'pointer',
  fontFamily: FONT,
  fontSize: 10,
  fontWeight: 800,
  letterSpacing: '0.08em',
  padding: '10px 14px',
  textTransform: 'uppercase',
};

const EYEBROW: CSSProperties = recruiterEyebrowStyle;

const TITLE: CSSProperties = recruiterTitleStyle;

const SUBTITLE: CSSProperties = recruiterSubtitleStyle;

const backButtonStyle: CSSProperties = recruiterBackButtonStyle;

const listItemStyle: CSSProperties = recruiterInsetCardStyle;

const INTERACTION_HEADER_ROW: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 12,
  minWidth: 0,
};

const INTERACTION_LINK_BUTTON: CSSProperties = {
  flex: '0 0 auto',
  border: '1px solid var(--pipe-border-light)',
  borderRadius: 6,
  background: 'rgba(108,195,255,0.08)',
  color: 'var(--pipe-accent)',
  fontFamily: FONT,
  fontSize: 10,
  fontWeight: 800,
  lineHeight: 1,
  padding: '8px 10px',
  cursor: 'pointer',
};

const INTERACTION_COVERAGE: CSSProperties = {
  display: 'grid',
  gap: 10,
  border: '1px solid var(--pipe-border-light)',
  borderRadius: 6,
  background: 'rgba(108,195,255,0.06)',
  padding: 12,
  marginBottom: 12,
};

const INTERACTION_COVERAGE_HEADER: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 12,
};

const INTERACTION_COVERAGE_COPY: CSSProperties = {
  margin: '6px 0 0',
  color: 'var(--pipe-text-muted)',
  fontSize: 11,
  lineHeight: 1.5,
};

const INTERACTION_COVERAGE_CHIPS: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
};

const INTERACTION_COVERAGE_CHIP: CSSProperties = {
  border: '1px solid var(--pipe-border-light)',
  borderRadius: 999,
  background: 'rgba(255,255,255,0.04)',
  color: 'var(--pipe-text)',
  fontSize: 10,
  fontWeight: 800,
  lineHeight: 1,
  padding: '7px 9px',
};

const EVIDENCE_MIX: CSSProperties = {
  display: 'grid',
  gap: 6,
  border: '1px solid rgba(96,165,250,0.22)',
  borderRadius: 6,
  background: 'rgba(96,165,250,0.06)',
  padding: 10,
};

const EVIDENCE_MIX_HEADLINE: CSSProperties = {
  color: 'var(--pipe-text)',
  fontSize: 13,
  fontWeight: 800,
  lineHeight: 1.35,
  overflowWrap: 'anywhere',
};

const EVIDENCE_MIX_NEXT: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 10,
  color: 'var(--pipe-text)',
  fontSize: 11,
  fontWeight: 800,
  lineHeight: 1.35,
  flexWrap: 'wrap',
};

const CODE_REVIEW_DECISION: CSSProperties = {
  border: '1px solid var(--pipe-accent-border)',
  borderRadius: 8,
  background: 'var(--pipe-surface-solid)',
  padding: 18,
  display: 'grid',
  gap: 14,
};

const CODE_REVIEW_DECISION_HEADER: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 16,
};

const DECISION_EYEBROW: CSSProperties = {
  color: 'var(--pipe-accent)',
  fontSize: 10,
  fontWeight: 800,
  marginBottom: 7,
};

const DECISION_TITLE: CSSProperties = {
  margin: 0,
  color: 'var(--pipe-text)',
  fontSize: 22,
  lineHeight: 1.15,
  letterSpacing: 0,
};

const DECISION_COPY: CSSProperties = {
  margin: '7px 0 0',
  color: 'var(--pipe-text-muted)',
  fontSize: 12,
  lineHeight: 1.55,
};

const DECISION_FACT_GRID: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
  gap: 10,
};

const DECISION_BASIS: CSSProperties = {
  display: 'grid',
  gap: 8,
  padding: 12,
  border: '1px solid var(--pipe-border-light)',
  borderRadius: 6,
  background: 'var(--pipe-surface)',
};

const DECISION_BASIS_TITLE: CSSProperties = {
  color: 'var(--pipe-text-dim)',
  fontSize: 10,
  fontWeight: 800,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
};

const DECISION_BASIS_GRID: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
  gap: 8,
};

const DECISION_BASIS_ITEM_OK: CSSProperties = {
  display: 'grid',
  gap: 5,
  minWidth: 0,
  padding: 10,
  border: '1px solid rgba(74,222,128,0.26)',
  borderRadius: 5,
  background: 'rgba(74,222,128,0.08)',
};

const DECISION_BASIS_ITEM_MISSING: CSSProperties = {
  display: 'grid',
  gap: 5,
  minWidth: 0,
  padding: 10,
  border: '1px solid rgba(251,191,36,0.32)',
  borderRadius: 5,
  background: 'rgba(251,191,36,0.08)',
};

const DECISION_BASIS_VALUE: CSSProperties = {
  color: 'var(--pipe-text)',
  fontSize: 12,
  fontWeight: 800,
  lineHeight: 1.35,
  overflowWrap: 'anywhere',
};

const DECISION_RATIONALE: CSSProperties = {
  display: 'grid',
  gap: 8,
  padding: 12,
  border: '1px solid rgba(96,165,250,0.24)',
  borderRadius: 6,
  background: 'rgba(96,165,250,0.07)',
};

const DECISION_RATIONALE_GRID: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
  gap: 8,
  minWidth: 0,
};

const DECISION_RATIONALE_ITEM: CSSProperties = {
  display: 'grid',
  gap: 4,
  minWidth: 0,
};

const DECISION_FACT: CSSProperties = {
  border: '1px solid var(--pipe-border-light)',
  borderRadius: 6,
  background: 'var(--pipe-surface)',
  padding: 12,
  minHeight: 70,
};

const DECISION_FACT_LABEL: CSSProperties = {
  color: 'var(--pipe-text-dim)',
  fontSize: 10,
  fontWeight: 800,
  marginBottom: 7,
};

const DECISION_FACT_VALUE: CSSProperties = {
  color: 'var(--pipe-text)',
  fontSize: 13,
  fontWeight: 800,
  overflowWrap: 'anywhere',
};

const DECISION_FACT_DETAIL: CSSProperties = {
  margin: '8px 0 0',
  color: 'var(--pipe-text-muted)',
  fontSize: 11,
  lineHeight: 1.45,
};

const DECISION_LIST: CSSProperties = {
  margin: 0,
  paddingLeft: 16,
  color: 'var(--pipe-text-muted)',
  fontSize: 11,
  lineHeight: 1.45,
};

const DECISION_LINK: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 7,
  color: 'var(--pipe-accent)',
  fontSize: 13,
  fontWeight: 800,
  textDecoration: 'none',
  overflowWrap: 'anywhere',
};

const DECISION_NARRATIVE: CSSProperties = {
  margin: 0,
  color: 'var(--pipe-text)',
  fontSize: 13,
  lineHeight: 1.6,
};

const DECISION_COLUMNS: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: 14,
};

const DECISION_PROOF: CSSProperties = {
  border: '1px solid var(--pipe-border-light)',
  borderRadius: 6,
  background: 'var(--pipe-surface)',
  padding: 12,
};

const DECISION_PROOF_SUMMARY: CSSProperties = {
  color: 'var(--pipe-text)',
  cursor: 'pointer',
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
};

const DECISION_PROOF_HINT: CSSProperties = {
  display: 'block',
  marginTop: 5,
  color: 'var(--pipe-text-dim)',
  fontSize: 10,
  fontWeight: 500,
  letterSpacing: 0,
  textTransform: 'none',
};

const DECISION_PROOF_LIST: CSSProperties = {
  display: 'grid',
  gap: 8,
  marginTop: 12,
};

const DECISION_PROOF_ITEM: CSSProperties = {
  borderTop: '1px solid var(--pipe-border-light)',
  paddingTop: 8,
};

const DECISION_PROOF_TEXT: CSSProperties = {
  color: 'var(--pipe-text-muted)',
  fontSize: 11,
  lineHeight: 1.45,
  overflowWrap: 'anywhere',
};

const GRAPH_SECTION: CSSProperties = {
  border: '1px solid var(--pipe-border)',
  borderRadius: 8,
  background: 'var(--pipe-surface-solid)',
  padding: 18,
};

const GRAPH_HEADER: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 16,
  marginBottom: 12,
};

const GRAPH_SUBTITLE: CSSProperties = {
  maxWidth: 680,
  margin: '6px 0 0',
  color: 'var(--pipe-text-dim)',
  fontSize: 12,
  lineHeight: 1.5,
};

const GRAPH_TOGGLE: CSSProperties = {
  flex: '0 0 auto',
  border: '1px solid var(--pipe-border)',
  background: 'var(--pipe-surface)',
  color: 'var(--pipe-text)',
  cursor: 'pointer',
  padding: '9px 12px',
  fontSize: 11,
  fontWeight: 700,
};

const SOURCE_GRAPH_PLACEHOLDER: CSSProperties = {
  border: '1px dashed var(--pipe-border)',
  background: 'var(--pipe-surface-solid)',
  color: 'var(--pipe-text-dim)',
  padding: 18,
  fontSize: 12,
  lineHeight: 1.6,
};
