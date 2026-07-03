import type { RoomWorkspaceChallengePacket } from '../types';

export interface ChallengePacketContract {
  task: string | null;
  matchProof: string[];
  successCriteria: string[];
  expectedEvidence: string[];
}

export interface ChallengePacketSummary extends ChallengePacketContract {
  repositoryUrl: string | null;
  baseCommitSha: string | null;
  githubPrNumber: number | null;
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
  let section: 'matchProof' | 'successCriteria' | 'expectedEvidence' | null = null;
  const contract: ChallengePacketContract = {
    task: null,
    matchProof: [],
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

export function summarizeChallengePacket(packet: RoomWorkspaceChallengePacket | null | undefined): ChallengePacketSummary {
  const contract = packet
    ? parseChallengePacketContract(packet.exactText)
    : {
        task: null,
        matchProof: [],
        successCriteria: [],
        expectedEvidence: [],
      };
  const locator = packet?.locator ?? {};

  return {
    ...contract,
    repositoryUrl: firstLocatorString(locator, ['repositoryUrl', 'githubRepoUrl', 'repoUrl']),
    baseCommitSha: firstLocatorString(locator, ['baseCommitSha', 'baseCommit']),
    githubPrNumber: firstLocatorNumber(locator, ['githubPrNumber', 'prNumber', 'pullRequestNumber']),
  };
}
