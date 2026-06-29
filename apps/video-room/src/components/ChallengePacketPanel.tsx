import { ClipboardCheck } from 'lucide-react';
import type { RoomWorkspaceChallengePacket } from '../types';

interface ChallengePacketPanelProps {
  packet: RoomWorkspaceChallengePacket;
  compact?: boolean;
}

function locatorString(locator: Record<string, unknown>, key: string): string | null {
  const value = locator[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function locatorNumber(locator: Record<string, unknown>, key: string): number | null {
  const value = locator[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function ChallengePacketPanel({
  packet,
  compact = false,
}: ChallengePacketPanelProps): JSX.Element {
  const repositoryUrl = locatorString(packet.locator, 'repositoryUrl');
  const baseCommitSha = locatorString(packet.locator, 'baseCommitSha');
  const githubPrNumber = locatorNumber(packet.locator, 'githubPrNumber');

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
