export interface AssessmentChallengeSource {
  exactText: string;
  locator: Record<string, unknown>;
}

export interface AssessmentChallengeSummary {
  repositoryUrl: string | null;
  githubPrNumber: number | null;
  baseCommitSha: string | null;
  task: string | null;
}

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

export function summarizeAssessmentChallenge(
  challenge: AssessmentChallengeSource | null | undefined,
): AssessmentChallengeSummary | null {
  if (!challenge) return null;
  const lines = challenge.exactText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const summary: AssessmentChallengeSummary = {
    repositoryUrl: locatorString(challenge.locator, ['repositoryUrl', 'githubRepoUrl', 'repoUrl']),
    githubPrNumber: locatorNumber(challenge.locator, ['githubPrNumber', 'prNumber']),
    baseCommitSha: locatorString(challenge.locator, ['baseCommitSha', 'baseCommit']),
    task: null,
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

  return summary.repositoryUrl || summary.githubPrNumber || summary.baseCommitSha || summary.task
    ? summary
    : null;
}
