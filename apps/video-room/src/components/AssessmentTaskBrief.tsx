import { ClipboardCheck, GitBranch, SquareTerminal, Upload } from 'lucide-react';
import { summarizeChallengePacket } from '../lib/challengePacketSummary';
import type { RoomAssessmentProgressSnapshot, RoomWorkspace, RoomWorkspaceChallengePacket } from '../types';

interface AssessmentTaskBriefProps {
  packet: RoomWorkspaceChallengePacket | null;
  workspace: RoomWorkspace | null;
  progress?: RoomAssessmentProgressSnapshot | null;
  workspaceReady?: boolean;
  onOpenWorkspace?: () => void;
  onOpenSubmission?: () => void;
}

function repoLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.hostname === 'github.com') {
      const [owner, repo] = parsed.pathname.split('/').filter(Boolean);
      if (owner && repo) return `${owner}/${repo}`;
    }
  } catch {
    // Keep the raw value below for non-URL repository labels.
  }
  return value.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

function shortSha(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, 10) : null;
}

export function AssessmentTaskBrief({
  packet,
  workspace,
  progress = null,
  workspaceReady = false,
  onOpenWorkspace,
  onOpenSubmission,
}: AssessmentTaskBriefProps): JSX.Element {
  const summary = summarizeChallengePacket(packet);
  const repositoryUrl = summary.repositoryUrl ?? workspace?.repoUrl ?? null;
  const baseCommitSha = summary.baseCommitSha ?? progress?.commit?.baseCommitSha ?? null;
  const currentStep = progress?.nextActionLabel
    ?? (workspaceReady ? 'Commit changes, then submit work.' : 'Launch the controlled workspace to begin.');
  const hasContract = Boolean(
    summary.task
    || summary.successCriteria.length > 0
    || summary.expectedEvidence.length > 0,
  );

  return (
    <aside
      className="assessment-task-brief"
      data-testid="assessment-task-brief"
      aria-label="Assessment task brief"
    >
      <div className="assessment-task-brief-header">
        <ClipboardCheck size={16} />
        <div>
          <h2>Assessment task</h2>
          <span>Open-source implementation</span>
        </div>
      </div>

      <dl className="assessment-task-brief-meta">
        {repositoryUrl && (
          <>
            <dt>Repo</dt>
            <dd title={repositoryUrl}>{repoLabel(repositoryUrl)}</dd>
          </>
        )}
        {summary.githubPrNumber && (
          <>
            <dt>PR</dt>
            <dd>#{summary.githubPrNumber}</dd>
          </>
        )}
        {baseCommitSha && (
          <>
            <dt>Base</dt>
            <dd title={baseCommitSha}>{shortSha(baseCommitSha)}</dd>
          </>
        )}
        {progress?.commit?.branchName && (
          <>
            <dt>Branch</dt>
            <dd>{progress.commit.branchName}</dd>
          </>
        )}
      </dl>

      <section className="assessment-task-brief-step">
        <strong>Current step</strong>
        <p>{currentStep}</p>
      </section>

      {hasContract ? (
        <div className="assessment-task-brief-contract">
          {summary.task && (
            <section>
              <strong>Task</strong>
              <p>{summary.task}</p>
            </section>
          )}
          {summary.successCriteria.length > 0 && (
            <section>
              <strong>Success criteria</strong>
              <ul>
                {summary.successCriteria.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </section>
          )}
          {summary.expectedEvidence.length > 0 && (
            <section>
              <strong>Expected evidence</strong>
              <ul>
                {summary.expectedEvidence.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </section>
          )}
        </div>
      ) : (
        <p className="assessment-task-brief-empty">
          The host still needs to attach a source-backed task packet before this assessment can be trusted.
        </p>
      )}

      <div className="assessment-task-brief-actions">
        {workspaceReady && onOpenWorkspace && (
          <button type="button" onClick={onOpenWorkspace} data-testid="assessment-brief-open-workspace">
            <SquareTerminal size={14} />
            Workspace
          </button>
        )}
        {workspaceReady && onOpenSubmission && (
          <button type="button" onClick={onOpenSubmission} data-testid="assessment-brief-open-submission">
            <Upload size={14} />
            Submit work
          </button>
        )}
        {progress?.commit?.commitSha && (
          <span className="assessment-task-brief-commit">
            <GitBranch size={13} />
            Commit {shortSha(progress.commit.commitSha)}
          </span>
        )}
      </div>
    </aside>
  );
}
