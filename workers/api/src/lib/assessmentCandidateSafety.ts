import type {
  AssessmentProgressChallengeSummary,
  AssessmentProgressEvaluation,
} from './repoTaskInterviewSession';
import type { JsonObject, JsonValue } from './livingContext/types';

export type CandidateSafeAssessmentProgressEvaluation = Omit<
  AssessmentProgressEvaluation,
  'id' | 'claims' | 'diagnostics'
> & {
  claims: Array<Omit<AssessmentProgressEvaluation['claims'][number], 'id'>>;
  diagnostics: Array<Omit<AssessmentProgressEvaluation['diagnostics'][number], 'id'>>;
};

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

const CANDIDATE_HIDDEN_CHALLENGE_ALLOWED_LINE_LABELS = new Set([
  'repo',
  'repository',
  'base commit',
  'base commit sha',
  'base',
  'task',
  'title',
  'instructions',
  'verification command',
]);

const CANDIDATE_HIDDEN_CHALLENGE_ALLOWED_SECTIONS = new Set([
  'match proof',
  'assessment fit',
  'success criteria',
  'expected evidence',
  'demand families',
]);

const CANDIDATE_HIDDEN_CHALLENGE_BLOCKED_SECTIONS = new Set([
  'source-backed demands',
  'source backed demands',
  'source evidence',
  'solution evidence',
  'upstream pull request',
  'pull request',
  'pr',
  'head commit',
  'head commit sha',
  'head sha',
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

  return candidateSafeHiddenChallengeText(input.exactText);
}

function candidateSafeHiddenChallengeText(exactText: string): string {
  const normalized = exactText
    .replace(/\s+(?=(?:Repo|Repository|Base commit|Base commit SHA|Base|Task|Title|Instructions|Verification command|Match proof|Assessment fit|Success criteria|Expected evidence|Demand families|Source-backed demands|Source backed demands|Source evidence|Solution evidence|Upstream pull request|Pull request|PR|Head commit|Head commit SHA|Head SHA)\s*:)/gi, '\n');
  const safeLines: string[] = [];
  let keepSection = false;

  for (const rawLine of normalized.split(/\r?\n/)) {
    const line = sanitizeHiddenChallengeLine(rawLine);
    if (!line) continue;

    const labelMatch = line.match(/^([A-Za-z][A-Za-z\s-]{1,48})\s*:\s*(.*)$/);
    if (labelMatch?.[1]) {
      const label = labelMatch[1].trim().toLowerCase();
      const value = labelMatch[2]?.trim() ?? '';
      if (CANDIDATE_HIDDEN_CHALLENGE_BLOCKED_SECTIONS.has(label)) {
        keepSection = false;
        continue;
      }
      if (CANDIDATE_HIDDEN_CHALLENGE_ALLOWED_SECTIONS.has(label)) {
        keepSection = true;
        safeLines.push(value ? `${labelMatch[1].trim()}: ${value}` : `${labelMatch[1].trim()}:`);
        continue;
      }
      keepSection = false;
      if (CANDIDATE_HIDDEN_CHALLENGE_ALLOWED_LINE_LABELS.has(label)) {
        safeLines.push(value ? `${labelMatch[1].trim()}: ${value}` : `${labelMatch[1].trim()}:`);
      }
      continue;
    }

    if (!keepSection) continue;
    safeLines.push(line);
  }

  return safeLines.join('\n');
}

function sanitizeHiddenChallengeLine(value: string): string {
  return value
    .replace(/https:\/\/github\.com\/[^\s).]+\/pull\/\d+[^\s).]*/gi, '[hidden source-backed task]')
    .replace(/\bupstream\s+pull request\s+context\b/gi, 'source-backed task context')
    .replace(/\bpull request\s+context\b/gi, 'source-backed task context')
    .replace(/\bupstream\s+pull request\b/gi, 'source-backed task')
    .replace(/\b(?:pull request|pr)\s*#?\d+\b/gi, 'source-backed task')
    .replace(/\b(?:head commit|head commit sha|head sha)\s*:\s*[a-f0-9]{7,40}\b/gi, '')
    .trim();
}

export function candidateSafeEvaluation(input: {
  challengeSourceRefType?: string | null;
  evaluation: AssessmentProgressEvaluation;
}): CandidateSafeAssessmentProgressEvaluation {
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
    claims: input.evaluation.claims.map((claim) => ({
      polarity: claim.polarity,
      dimension: claim.dimension,
      narrative: claim.narrative,
      confidence: claim.confidence,
      sourceRefCount: claim.sourceRefCount,
      sourceRefTypes: claim.sourceRefTypes,
    })),
    diagnostics: input.evaluation.diagnostics.map((diagnostic) => ({
      code: diagnostic.code,
      severity: diagnostic.severity,
      message: diagnostic.message,
      sourceRefCount: diagnostic.sourceRefCount,
      sourceRefTypes: diagnostic.sourceRefTypes,
    })),
    reviewPacket,
  };
}
