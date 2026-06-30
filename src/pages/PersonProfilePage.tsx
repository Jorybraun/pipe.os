import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
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
import { LivingContextGraph } from '../components/Candidate/LivingContextGraph';
import { useApiClient } from '../hooks/useApiClient';
import type {
  LivingContextArtifact,
  LivingContextInteraction,
  LivingContextReadModel,
  LivingContextRecord,
  LivingContextRecordSourceRef,
} from '../lib/api/types';
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

interface CodeReviewDecisionProjection {
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
      .map((entity) => entity.entityType === 'code_review_session' ? entity.entityId : null)
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
  return (
    <section data-testid="person-code-review-decision" style={CODE_REVIEW_DECISION}>
      <div style={CODE_REVIEW_DECISION_HEADER}>
        <div style={{ minWidth: 0 }}>
          <div style={DECISION_EYEBROW}>Code-review decision</div>
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

      <div style={DECISION_FACT_GRID}>
        {decision.scoreLabel && (
          <div style={DECISION_FACT}>
            <div style={DECISION_FACT_LABEL}>Candidate signal</div>
            <div style={DECISION_FACT_VALUE}>{decision.scoreLabel}</div>
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
  const navigate = useNavigate();
  const api = useApiClient();

  const [contact, setContact] = useState<PersonContact | null>(null);
  const [livingContext, setLivingContext] = useState<LivingContextReadModel | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSourceGraph, setShowSourceGraph] = useState(false);

  const contextEndpoint = personId ? `/api/v1/contacts/${personId}/living-context` : null;

  const load = useCallback(async (): Promise<void> => {
    if (!personId || !contextEndpoint) {
      setError('Missing person id for this profile.');
      setContact(null);
      setLivingContext(null);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const [contactResponse, contextResponse] = await Promise.all([
        api.get<{ contact: PersonContact }>(`/api/v1/contacts/${personId}`),
        api.get<LivingContextReadModel>(contextEndpoint),
      ]);
      setContact(contactResponse.contact);
      setLivingContext(contextResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load person profile.');
      setContact(null);
      setLivingContext(null);
    } finally {
      setIsLoading(false);
    }
  }, [api, contextEndpoint, personId]);

  useEffect(() => {
    void load();
  }, [load]);

  const displayName = contact?.name
    ?? livingContext?.person?.displayName
    ?? contact?.email
    ?? 'Person';
  const relationshipLabel = typeLabel(contact?.type);
  const roleContext = contact?.role ?? livingContext?.person?.roles[0]?.label ?? 'Relationship graph';
  const relationshipSummary = livingContext?.person?.relationshipSummary
    ?? contact?.notes
    ?? 'No relationship summary has been earned from evidence yet.';

  const recentInteractions = livingContext?.interactions.slice(0, 5) ?? [];
  const recentRecords = livingContext?.contextRecords.slice(0, 5) ?? [];
  const sourceBackedSignals = livingContext?.signals
    .filter((signal) => signal.evidence.some((evidence) => evidence.sources.length > 0))
    .slice(0, 5) ?? [];
  const evidenceArtifacts = livingContext?.artifacts.slice(0, 5) ?? [];
  const codeReviewDecision = deriveCodeReviewDecision(livingContext);

  if (isLoading) {
    return (
      <div style={{ padding: 32, color: 'var(--pipe-text-dim)' }}>
        Loading person context...
      </div>
    );
  }

  if (error || !contact) {
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
          <InfoRow icon={<Mail size={14} />} label="Email" value={contact.email} />
          <InfoRow icon={<Phone size={14} />} label="Phone" value={contact.phone ?? livingContext?.person?.primaryPhone} />
          <InfoRow icon={<Briefcase size={14} />} label="Role / context" value={roleContext} />
          <InfoRow icon={<Calendar size={14} />} label="Known since" value={formatDate(contact.created_at)} />
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
        decision={codeReviewDecision}
        livingContext={livingContext}
        onCreateNextInterview={() => navigate(nextInterviewPath(contact, codeReviewDecision))}
      />

      {codeReviewDecision && (
        <CodeReviewDecisionCard decision={codeReviewDecision} />
      )}

      <section style={EVIDENCE_GRID}>
        <Panel title="Relationship Timeline" icon={<Calendar size={15} />}>
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
      </section>

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
            onClick={() => setShowSourceGraph((value) => !value)}
            style={GRAPH_TOGGLE}
          >
            {showSourceGraph ? 'Hide graph' : 'Open graph'}
          </button>
        </div>
        {showSourceGraph && contextEndpoint ? (
          <LivingContextGraph
            candidateId={personId ?? contact.id}
            livingContextEndpoint={contextEndpoint}
            initialLivingContext={livingContext}
          />
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
