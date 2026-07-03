import type { AssessmentProgressSnapshot, AssessmentSetupProjection } from './types';

export interface AssessmentChallengeSource {
  exactText?: string | null;
  locator: Record<string, unknown>;
  summary?: Partial<AssessmentChallengeSummary> | null;
}

export interface AssessmentChallengeSummary {
  repositoryUrl: string | null;
  githubPrNumber: number | null;
  baseCommitSha: string | null;
  task: string | null;
  matchProof: string[];
  successCriteria: string[];
  expectedEvidence: string[];
}

export interface AssessmentAssignmentSummary {
  label: string;
  detail: string;
  tone: 'matched' | 'manual' | 'waiting' | 'blocked' | 'neutral';
}

type AssessmentAssignmentTrust = NonNullable<AssessmentProgressSnapshot['assignmentTrust']>;

function locatorString(locator: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = locator[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return null;
}

function locatorNumber(locator: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = locator[key];
    if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
    if (typeof value === 'string') {
      const parsed = Number.parseInt(value.trim(), 10);
      if (Number.isInteger(parsed) && parsed > 0) return parsed;
    }
  }
  return null;
}

function cleanListItem(line: string): string | null {
  const cleaned = line.replace(/^[-*]\s*/, '').trim();
  return cleaned.length > 0 ? cleaned : null;
}

function collectSectionItems(lines: string[], header: 'match proof' | 'success criteria' | 'expected evidence'): string[] {
  const items: string[] = [];
  let collecting = false;

  for (const line of lines) {
    const normalized = line.replace(/:$/, '').toLowerCase();
    if (normalized === header) {
      collecting = true;
      continue;
    }
    if (collecting && /^[a-z][a-z\s]+:$/i.test(line)) break;
    if (!collecting) continue;

    const item = cleanListItem(line);
    if (item) items.push(item);
  }

  return items;
}

export function summarizeAssessmentChallenge(
  challenge: AssessmentChallengeSource | null | undefined,
): AssessmentChallengeSummary | null {
  if (!challenge) return null;
  const summaryInput = challenge.summary ?? {};
  const lines = (challenge.exactText ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const summary: AssessmentChallengeSummary = {
    repositoryUrl: summaryInput.repositoryUrl
      ?? locatorString(challenge.locator, ['repositoryUrl', 'githubRepoUrl', 'repoUrl']),
    githubPrNumber: summaryInput.githubPrNumber
      ?? locatorNumber(challenge.locator, ['githubPrNumber', 'prNumber']),
    baseCommitSha: summaryInput.baseCommitSha
      ?? locatorString(challenge.locator, ['baseCommitSha', 'baseCommit']),
    task: summaryInput.task ?? null,
    matchProof: summaryInput.matchProof?.length
      ? [...summaryInput.matchProof]
      : collectSectionItems(lines, 'match proof'),
    successCriteria: summaryInput.successCriteria?.length
      ? [...summaryInput.successCriteria]
      : collectSectionItems(lines, 'success criteria'),
    expectedEvidence: summaryInput.expectedEvidence?.length
      ? [...summaryInput.expectedEvidence]
      : collectSectionItems(lines, 'expected evidence'),
  };

  for (const line of lines) {
    const repoMatch = line.match(/^repo(?:sitory)?\s*:\s*(.+)$/i);
    if (repoMatch?.[1] && !summary.repositoryUrl) {
      summary.repositoryUrl = repoMatch[1].trim();
      continue;
    }
    const prMatch = line.match(/^(?:pull request|pr)\s*:\s*#?(\d+)$/i);
    if (prMatch?.[1] && !summary.githubPrNumber) {
      summary.githubPrNumber = Number.parseInt(prMatch[1], 10);
      continue;
    }
    const baseCommitMatch = line.match(/^base commit\s*:\s*([a-f0-9]{7,40})$/i);
    if (baseCommitMatch?.[1] && !summary.baseCommitSha) {
      summary.baseCommitSha = baseCommitMatch[1].trim();
      continue;
    }
    const taskMatch = line.match(/^task\s*:\s*(.+)$/i);
    if (taskMatch?.[1] && !summary.task) {
      summary.task = taskMatch[1].trim();
    }
  }

  return summary.repositoryUrl
    || summary.githubPrNumber
    || summary.baseCommitSha
    || summary.task
    || summary.matchProof.length > 0
    || summary.successCriteria.length > 0
    || summary.expectedEvidence.length > 0
    ? summary
    : null;
}

export function summarizeAssessmentAssignment(
  setup: AssessmentSetupProjection | null | undefined,
): AssessmentAssignmentSummary | null {
  if (!setup || setup.status === 'not_applicable') return null;

  if (
    setup.source === 'matched_repo_id'
    || setup.source === 'candidate_challenge_assignment'
    || setup.kind === 'auto_match'
  ) {
    if (setup.status === 'reviewable_task_assigned') {
      return {
        label: 'PIPE-matched challenge',
        detail: setup.message ?? 'Repo task was selected from source-backed candidate evidence and an approved challenge packet.',
        tone: 'matched',
      };
    }

    return {
      label: 'Waiting for PIPE match',
      detail: setup.message ?? 'PIPE needs source-backed candidate evidence before selecting a fair repo task.',
      tone: setup.blocksPositiveAssessment ? 'blocked' : 'waiting',
    };
  }

  if (setup.source === 'recruiter_manual_override' || setup.kind === 'manual_open_source_task') {
    return {
      label: 'Manual task assignment',
      detail: setup.message ?? 'Recruiter supplied the task; evaluate the work product separately from repo-fit proof.',
      tone: 'manual',
    };
  }

  if (setup.status === 'waiting_for_candidate_evidence') {
    return {
      label: 'Evidence needed for matching',
      detail: setup.message ?? 'Capture source-backed candidate evidence, then rerun repo matching.',
      tone: setup.blocksPositiveAssessment ? 'blocked' : 'waiting',
    };
  }

  if (setup.status === 'waiting_for_source_backed_match') {
    return {
      label: 'Waiting for source-backed match',
      detail: setup.message ?? 'PIPE has evidence, but no quality-gated repo task has been selected yet.',
      tone: setup.blocksPositiveAssessment ? 'blocked' : 'waiting',
    };
  }

  if (setup.status === 'missing_reviewable_task') {
    return {
      label: 'No reviewable task yet',
      detail: setup.message ?? 'Assign a concrete repo task before this can become an assessment.',
      tone: 'blocked',
    };
  }

  if (setup.status === 'reviewable_task_assigned') {
    return {
      label: 'Reviewable task assigned',
      detail: setup.message ?? 'A concrete source-backed assessment task is ready.',
      tone: 'neutral',
    };
  }

  return {
    label: 'Assessment setup',
    detail: setup.message ?? 'Assessment setup state is available.',
    tone: setup.blocksPositiveAssessment ? 'blocked' : 'neutral',
  };
}

export function summarizeAssessmentAssignmentTrust(
  trust: AssessmentAssignmentTrust | null | undefined,
): AssessmentAssignmentSummary | null {
  if (!trust) return null;
  return {
    label: trust.label,
    detail: trust.detail,
    tone: trust.tone,
  };
}

export function summarizeResolvedAssessmentAssignment(input: {
  setup: AssessmentSetupProjection | null | undefined;
  assignmentTrust: AssessmentAssignmentTrust | null | undefined;
}): AssessmentAssignmentSummary | null {
  const progressAssignment = summarizeAssessmentAssignmentTrust(input.assignmentTrust);
  const setupAssignment = summarizeAssessmentAssignment(input.setup);
  if (input.assignmentTrust?.state === 'matched_challenge') {
    if (
      progressAssignment
      && setupAssignment?.tone === 'matched'
      && setupAssignment.detail !== progressAssignment.detail
    ) {
      return {
        ...progressAssignment,
        detail: `${progressAssignment.detail} ${setupAssignment.detail}`,
      };
    }
    return progressAssignment;
  }
  return setupAssignment ?? progressAssignment;
}
