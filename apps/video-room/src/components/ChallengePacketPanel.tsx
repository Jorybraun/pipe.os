import { ClipboardCheck } from 'lucide-react';
import type { RoomWorkspaceChallengePacket } from '../types';

interface ChallengePacketPanelProps {
  packet: RoomWorkspaceChallengePacket;
  compact?: boolean;
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

export function ChallengePacketPanel({
  packet,
  compact = false,
}: ChallengePacketPanelProps): JSX.Element {
  const repositoryUrl = firstLocatorString(packet.locator, ['repositoryUrl', 'githubRepoUrl', 'repoUrl']);
  const baseCommitSha = firstLocatorString(packet.locator, ['baseCommitSha', 'baseCommit']);
  const githubPrNumber = firstLocatorNumber(packet.locator, ['githubPrNumber', 'prNumber', 'pullRequestNumber']);

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
