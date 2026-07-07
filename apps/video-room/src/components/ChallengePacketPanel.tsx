import { ClipboardCheck } from 'lucide-react';
import type { RoomWorkspaceChallengePacket } from '../types';
import {
  candidateSafeChallengeExactText,
  hidesCandidateSolutionPullRequest,
  summarizeChallengePacket,
} from '../lib/challengePacketSummary';

interface ChallengePacketPanelProps {
  packet: RoomWorkspaceChallengePacket;
  compact?: boolean;
}

export function ChallengePacketPanel({
  packet,
  compact = false,
}: ChallengePacketPanelProps): JSX.Element {
  const summary = summarizeChallengePacket(packet);
  const hideSolutionPullRequest = hidesCandidateSolutionPullRequest({
    sourceRefType: packet.sourceRefType,
  });
  const visibleGithubPrNumber = hideSolutionPullRequest ? null : summary.githubPrNumber;
  const visiblePullRequestUrl = hideSolutionPullRequest ? null : summary.pullRequestUrl;
  const candidateSafeExactText = candidateSafeChallengeExactText({
    sourceRefType: packet.sourceRefType,
    exactText: packet.exactText,
  });
  const hasContract = Boolean(
    summary.task
    || summary.verificationCommand
    || summary.matchProof.length > 0
    || summary.assessmentFit.length > 0
    || summary.successCriteria.length > 0
    || summary.expectedEvidence.length > 0,
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

      {(summary.repositoryUrl || hideSolutionPullRequest || visibleGithubPrNumber || summary.baseCommitSha) && (
        <dl className="challenge-packet-locator">
          {summary.repositoryUrl && (
            <>
              <dt>Repo</dt>
              <dd>{summary.repositoryUrl}</dd>
            </>
          )}
          {hideSolutionPullRequest && (
            <>
              <dt>Source</dt>
              <dd>Source-backed replay</dd>
            </>
          )}
          {visibleGithubPrNumber && (
            <>
              <dt>PR</dt>
              <dd>
                {visiblePullRequestUrl ? (
                  <a href={visiblePullRequestUrl} target="_blank" rel="noopener noreferrer">
                    #{visibleGithubPrNumber}
                  </a>
                ) : (
                  <>#{visibleGithubPrNumber}</>
                )}
              </dd>
            </>
          )}
          {summary.baseCommitSha && (
            <>
              <dt>Base</dt>
              <dd>{summary.baseCommitSha}</dd>
            </>
          )}
        </dl>
      )}

      {hasContract && (
        <div className="challenge-packet-contract" data-testid="challenge-packet-contract">
          {summary.task && (
            <div className="challenge-packet-contract-section">
              <strong>Task</strong>
              <p>{summary.task}</p>
            </div>
          )}
          {summary.verificationCommand && (
            <div className="challenge-packet-contract-section">
              <strong>Verification command</strong>
              <p><code>{summary.verificationCommand}</code></p>
            </div>
          )}
          {summary.matchProof.length > 0 && (
            <div className="challenge-packet-contract-section">
              <strong>Match proof</strong>
              <ul>
                {summary.matchProof.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
          {summary.assessmentFit.length > 0 && (
            <div className="challenge-packet-contract-section">
              <strong>Assessment fit</strong>
              <ul>
                {summary.assessmentFit.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
          {summary.successCriteria.length > 0 && (
            <div className="challenge-packet-contract-section">
              <strong>Success criteria</strong>
              <ul>
                {summary.successCriteria.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
          {summary.expectedEvidence.length > 0 && (
            <div className="challenge-packet-contract-section">
              <strong>Expected evidence</strong>
              <ul>
                {summary.expectedEvidence.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <pre className="challenge-packet-exact-text" data-testid="challenge-packet-exact-text">
        {candidateSafeExactText}
      </pre>

      <div className="challenge-packet-footer">
        <span>{packet.sourceRefType.replace(/_/g, ' ')}</span>
        <code>{packet.contentHash}</code>
      </div>
    </section>
  );
}
