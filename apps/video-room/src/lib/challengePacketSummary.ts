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

const HIDDEN_CHALLENGE_ALLOWED_LINE_LABELS = new Set([
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

const HIDDEN_CHALLENGE_ALLOWED_SECTIONS = new Set([
  'match proof',
  'assessment fit',
  'success criteria',
  'expected evidence',
  'demand families',
]);

const HIDDEN_CHALLENGE_BLOCKED_SECTIONS = new Set([
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

export function candidateSafeChallengeExactText(input: {
  sourceRefType?: string | null;
  exactText: string;
}): string {
  if (!hidesCandidateSolutionPullRequest({ sourceRefType: input.sourceRefType })) {
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
      if (HIDDEN_CHALLENGE_BLOCKED_SECTIONS.has(label)) {
        keepSection = false;
        continue;
      }
      if (HIDDEN_CHALLENGE_ALLOWED_SECTIONS.has(label)) {
        keepSection = true;
        safeLines.push(value ? `${labelMatch[1].trim()}: ${value}` : `${labelMatch[1].trim()}:`);
        continue;
      }
      keepSection = false;
      if (HIDDEN_CHALLENGE_ALLOWED_LINE_LABELS.has(label)) {
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
