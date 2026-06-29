import { ClipboardCheck } from 'lucide-react';
import type { RoomWorkspaceChallengePacket } from '../types';

interface ChallengePacketPanelProps {
  packet: RoomWorkspaceChallengePacket;
  compact?: boolean;
}

interface ChallengePacketContract {
  task: string | null;
  successCriteria: string[];
  expectedEvidence: string[];
}

function firstLocatorString(locator: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = locator[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return null;
}

function firstLocatorNumber(locator: Record<string, unknown>, keys: string[]): number | null {
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

function parseChallengePacketContract(exactText: string): ChallengePacketContract {
  const lines = exactText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  let section: 'successCriteria' | 'expectedEvidence' | null = null;
  const contract: ChallengePacketContract = {
    task: null,
    successCriteria: [],
    expectedEvidence: [],
  };

  for (const line of lines) {
    const taskMatch = line.match(/^task\s*:\s*(.+)$/i);
    if (taskMatch?.[1]) {
      contract.task = taskMatch[1].trim();
      section = null;
      continue;
    }
    if (/^success criteria\s*:?\s*$/i.test(line)) {
      section = 'successCriteria';
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

export function ChallengePacketPanel({
  packet,
  compact = false,
}: ChallengePacketPanelProps): JSX.Element {
  const repositoryUrl = firstLocatorString(packet.locator, ['repositoryUrl', 'githubRepoUrl', 'repoUrl']);
  const baseCommitSha = firstLocatorString(packet.locator, ['baseCommitSha', 'baseCommit']);
  const githubPrNumber = firstLocatorNumber(packet.locator, ['githubPrNumber', 'prNumber', 'pullRequestNumber']);
  const contract = parseChallengePacketContract(packet.exactText);
  const hasContract = Boolean(
    contract.task
    || contract.successCriteria.length > 0
    || contract.expectedEvidence.length > 0,
  );

  return (
    <section
      className={`challenge-packet-panel${compact ? ' is-compact' : ''}`}
      data-testid="challenge-packet-panel"
      aria-label="Open-source challenge packet"
    >
      <div className="challenge-packet-header">
        <ClipboardCheck size={16} />
        <div>
          <h4>Open-source challenge</h4>
          <span>{packet.evidenceRole.replace(/_/g, ' ')}</span>
        </div>
      </div>

      {(repositoryUrl || githubPrNumber || baseCommitSha) && (
        <dl className="challenge-packet-locator">
          {repositoryUrl && (
            <>
              <dt>Repo</dt>
              <dd>{repositoryUrl}</dd>
            </>
          )}
          {githubPrNumber && (
            <>
              <dt>PR</dt>
              <dd>#{githubPrNumber}</dd>
            </>
          )}
          {baseCommitSha && (
            <>
              <dt>Base</dt>
              <dd>{baseCommitSha}</dd>
            </>
          )}
        </dl>
      )}

      {hasContract && (
        <div className="challenge-packet-contract" data-testid="challenge-packet-contract">
          {contract.task && (
            <div className="challenge-packet-contract-section">
              <strong>Task</strong>
              <p>{contract.task}</p>
            </div>
          )}
          {contract.successCriteria.length > 0 && (
            <div className="challenge-packet-contract-section">
              <strong>Success criteria</strong>
              <ul>
                {contract.successCriteria.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
          {contract.expectedEvidence.length > 0 && (
            <div className="challenge-packet-contract-section">
              <strong>Expected evidence</strong>
              <ul>
                {contract.expectedEvidence.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <pre className="challenge-packet-exact-text" data-testid="challenge-packet-exact-text">
        {packet.exactText}
      </pre>

      <div className="challenge-packet-footer">
        <span>{packet.sourceRefType.replace(/_/g, ' ')}</span>
        <code>{packet.contentHash}</code>
      </div>
    </section>
  );
}
