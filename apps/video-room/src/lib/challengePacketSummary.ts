import type { RoomWorkspaceChallengePacket } from '../types';

export interface ChallengePacketContract {
  task: string | null;
  verificationCommand: string | null;
  matchProof: string[];
  assessmentFit: string[];
  successCriteria: string[];
  expectedEvidence: string[];
}

export interface ChallengePacketSummary extends ChallengePacketContract {
  repositoryUrl: string | null;
  baseCommitSha: string | null;
  githubPrNumber: number | null;
  pullRequestUrl: string | null;
}

export function firstLocatorString(locator: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = locator[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return null;
}

export function firstLocatorNumber(locator: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = locator[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value.trim().replace(/^#/, ''));
      if (Number.isInteger(parsed) && parsed > 0) return parsed;
    }
  }
  return null;
}

function normalizePacketListItem(line: string): string {
  return line
    .trim()
    .replace(/^[-*]\s+/, '')
    .replace(/^\d+[.)]\s+/, '')
    .trim();
}

export function parseChallengePacketContract(exactText: string): ChallengePacketContract {
  const lines = exactText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  let section: 'matchProof' | 'assessmentFit' | 'successCriteria' | 'expectedEvidence' | null = null;
  const contract: ChallengePacketContract = {
    task: null,
    verificationCommand: null,
    matchProof: [],
    assessmentFit: [],
    successCriteria: [],
    expectedEvidence: [],
  };

  for (const line of lines) {
    const taskMatch = line.match(/^(?:task|title)\s*:\s*(.+)$/i);
    if (taskMatch?.[1]) {
      contract.task = taskMatch[1].trim();
      section = null;
      continue;
    }
    const verificationCommandMatch = line.match(/^verification command\s*:\s*(.+)$/i);
    if (verificationCommandMatch?.[1]) {
      contract.verificationCommand = verificationCommandMatch[1].trim();
      section = null;
      continue;
    }
    const successMatch = line.match(/^success\s*:\s*(.+)$/i);
    if (successMatch?.[1]) {
      contract.successCriteria.push(successMatch[1].trim());
      section = null;
      continue;
    }
    if (/^success criteria\s*:?\s*$/i.test(line)) {
      section = 'successCriteria';
      continue;
    }
    if (/^match proof\s*:?\s*$/i.test(line)) {
      section = 'matchProof';
      continue;
    }
    if (/^assessment fit\s*:?\s*$/i.test(line)) {
      section = 'assessmentFit';
      continue;
    }
    if (/^expected evidence\s*:?\s*$/i.test(line)) {
      section = 'expectedEvidence';
      continue;
    }
    if (/^[A-Za-z][A-Za-z\s-]{2,}:\s*$/.test(line)) {
      section = null;
      continue;
    }
    if (!section) continue;
    const item = normalizePacketListItem(line);
    if (item.length > 0) contract[section].push(item);
  }

  return contract;
}

function packetLineValue(exactText: string, labels: readonly string[]): string | null {
  const escapedLabels = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const match = exactText.match(new RegExp(`^\\s*(?:${escapedLabels.join('|')})\\s*:\\s*(.+)$`, 'im'));
  return match?.[1]?.trim() || null;
}

export function normalizeGitHubPullRequestUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'https:' || url.hostname !== 'github.com') return null;
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length < 4 || parts[2] !== 'pull') return null;
    const prNumber = Number.parseInt(parts[3] ?? '', 10);
    if (!Number.isInteger(prNumber) || prNumber <= 0) return null;
    return `https://github.com/${parts[0]}/${parts[1]}/pull/${prNumber}`;
  } catch {
    return null;
  }
}

export function hidesCandidateSolutionPullRequest(input: {
  sourceRefType?: string | null;
  assignmentTrustState?: string | null;
}): boolean {
  return input.sourceRefType === 'review_challenge_packet'
    || input.assignmentTrustState === 'matched_challenge';
}

export function candidateSafeChallengeExactText(input: {
  sourceRefType?: string | null;
  exactText: string;
}): string {
  if (!hidesCandidateSolutionPullRequest({ sourceRefType: input.sourceRefType })) {
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

function buildGitHubPullRequestUrl(repositoryUrl: string | null, githubPrNumber: number | null): string | null {
  if (!repositoryUrl || !githubPrNumber) return null;

  try {
    const url = new URL(repositoryUrl);
    if (url.protocol !== 'https:' || url.hostname !== 'github.com') return null;
    const parts = url.pathname.replace(/\.git$/i, '').split('/').filter(Boolean);
    if (parts.length < 2) return null;
    return `https://github.com/${parts[0]}/${parts[1]}/pull/${githubPrNumber}`;
  } catch {
    return null;
  }
}

export function summarizeChallengePacket(packet: RoomWorkspaceChallengePacket | null | undefined): ChallengePacketSummary {
  const contract = packet
    ? parseChallengePacketContract(packet.exactText)
    : {
        task: null,
        verificationCommand: null,
        matchProof: [],
        assessmentFit: [],
        successCriteria: [],
        expectedEvidence: [],
      };
  const locator = packet?.locator ?? {};
  const exactText = packet?.exactText ?? '';
  const repositoryUrl = firstLocatorString(locator, ['repositoryUrl', 'githubRepoUrl', 'repoUrl']);
  const githubPrNumber = firstLocatorNumber(locator, ['githubPrNumber', 'prNumber', 'pullRequestNumber']);
  const pullRequestUrl = normalizeGitHubPullRequestUrl(
    firstLocatorString(locator, ['pullRequestUrl', 'githubPullRequestUrl', 'prUrl'])
      ?? packetLineValue(exactText, ['Pull request URL', 'PR URL']),
  ) ?? buildGitHubPullRequestUrl(repositoryUrl, githubPrNumber);

  return {
    ...contract,
    repositoryUrl,
    baseCommitSha: firstLocatorString(locator, ['baseCommitSha', 'baseCommit']),
    githubPrNumber,
    pullRequestUrl,
  };
}
