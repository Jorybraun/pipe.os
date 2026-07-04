import type {
  AssessmentProgressChallengeSummary,
  AssessmentProgressEvaluation,
} from './repoTaskInterviewSession';
import type { JsonObject, JsonValue } from './livingContext/types';

const CANDIDATE_HIDDEN_CHALLENGE_SOURCE_REF_TYPES = new Set([
  'review_challenge_packet',
]);

const CANDIDATE_REVIEW_PACKET_HIDDEN_LOCATOR_KEYS = new Set([
  'githubPrNumber',
  'pullRequestNumber',
  'prNumber',
  'pullRequestUrl',
  'githubPullRequestUrl',
  'prUrl',
  'headCommitSha',
  'headCommit',
  'headSha',
]);

const CANDIDATE_SAFE_CHALLENGE_LOCATOR_KEYS = new Set([
  'repositoryUrl',
  'githubRepoUrl',
  'repoUrl',
  'githubPrNumber',
  'pullRequestNumber',
  'prNumber',
  'pullRequestUrl',
  'githubPullRequestUrl',
  'prUrl',
  'issueNumber',
  'githubIssueNumber',
  'issueUrl',
  'githubIssueUrl',
  'taskUrl',
  'sourceUrl',
  'baseCommitSha',
  'baseCommit',
  'headCommitSha',
  'headCommit',
  'headSha',
  'verificationCommand',
  'challengeTitle',
  'title',
  'taskTitle',
]);

export function shouldHideCandidateChallengeSolution(input: {
  sourceRefType?: string | null;
}): boolean {
  return CANDIDATE_HIDDEN_CHALLENGE_SOURCE_REF_TYPES.has(input.sourceRefType ?? '');
}

export function candidateSafeChallengeSummary(input: {
  sourceRefType?: string | null;
  summary: AssessmentProgressChallengeSummary;
}): AssessmentProgressChallengeSummary {
  if (!shouldHideCandidateChallengeSolution({ sourceRefType: input.sourceRefType })) {
    return input.summary;
  }

  return {
    ...input.summary,
    githubPrNumber: null,
    pullRequestUrl: null,
  };
}

export function candidateSafeChallengeLocator(input: {
  sourceRefType?: string | null;
  locator: JsonObject;
}): JsonObject {
  const safe: JsonObject = {};
  const hideSolution = shouldHideCandidateChallengeSolution({ sourceRefType: input.sourceRefType });

  for (const [key, value] of Object.entries(input.locator)) {
    if (!CANDIDATE_SAFE_CHALLENGE_LOCATOR_KEYS.has(key)) continue;
    if (hideSolution && CANDIDATE_REVIEW_PACKET_HIDDEN_LOCATOR_KEYS.has(key)) continue;
    if (
      typeof value === 'string'
      || typeof value === 'number'
      || typeof value === 'boolean'
      || value === null
    ) {
      safe[key] = value;
    }
  }

  return safe;
}

export function candidateSafeChallengeExactText(input: {
  sourceRefType?: string | null;
  exactText: string;
}): string {
  if (!shouldHideCandidateChallengeSolution({ sourceRefType: input.sourceRefType })) {
    return input.exactText;
  }

  const withoutInlineSolutionRefs = input.exactText
    .replace(/\s*(?:pull request url|pr url)\s*:\s*https:\/\/github\.com\/\S+/gi, '')
    .replace(/\s*(?:pull request|pr)\s*:\s*(?:#?\d+|https:\/\/github\.com\/\S+)/gi, '')
    .replace(/\s*(?:head commit|head commit sha|head sha)\s*:\s*[a-f0-9]{7,40}\b/gi, '');

  return withoutInlineSolutionRefs
    .split(/\r?\n/)
    .filter((line) => !/^\s*(?:pull request|pr|pull request url|pr url|head commit|head commit sha|head sha)\s*:/i.test(line))
    .join('\n');
}

export function candidateSafeEvaluation(input: {
  challengeSourceRefType?: string | null;
  evaluation: AssessmentProgressEvaluation;
}): Omit<AssessmentProgressEvaluation, 'id'> {
  const shouldHide = shouldHideCandidateChallengeSolution({
    sourceRefType: input.challengeSourceRefType,
  });
  const reviewPacket = input.evaluation.reviewPacket && shouldHide
    ? {
        ...input.evaluation.reviewPacket,
        challenge: {
          ...input.evaluation.reviewPacket.challenge,
          pullRequestUrl: null,
        },
      }
    : input.evaluation.reviewPacket;

  return {
    status: input.evaluation.status,
    summary: input.evaluation.summary,
    recommendation: input.evaluation.recommendation,
    createdAt: input.evaluation.createdAt,
    evidenceCoverage: input.evaluation.evidenceCoverage as JsonValue,
    claims: input.evaluation.claims,
    diagnostics: input.evaluation.diagnostics,
    reviewPacket,
  };
}
