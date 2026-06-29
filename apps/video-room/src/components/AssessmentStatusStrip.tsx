import {
  AlertTriangle,
  ClipboardCheck,
  GitPullRequest,
  Loader2,
  Play,
  SquareTerminal,
  Upload,
  Video,
} from 'lucide-react';
import type { RoomWorkspace } from '../types';
import { summarizeChallengePacket } from '../lib/challengePacketSummary';

export type AssessmentRoomMode = 'standard_call' | 'code_review' | 'dev_container_assessment';

interface AssessmentStatusStripProps {
  meetingType: string | null | undefined;
  workspace: RoomWorkspace | null;
  workspaceLoading?: boolean;
  workspaceError?: string | null;
  canLaunchWorkspace?: boolean;
  onLaunchWorkspace?: () => void;
  onOpenWorkspace?: () => void;
  onOpenSubmission?: () => void;
}

function normalizedToken(value: string | null | undefined): string {
  return (value ?? '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_');
}

export function assessmentModeForRoom(input: {
  meetingType: string | null | undefined;
  workspaceEnabled: boolean;
}): AssessmentRoomMode {
  const meetingType = normalizedToken(input.meetingType);
  if (
    input.workspaceEnabled
    || meetingType.includes('DEV_CONTAINER')
    || meetingType.includes('CODE_IMPLEMENTATION')
    || meetingType.includes('OPEN_SOURCE')
  ) {
    return 'dev_container_assessment';
  }
  if (meetingType.includes('CODE_REVIEW')) return 'code_review';
  return 'standard_call';
}

export function assessmentModeLabel(mode: AssessmentRoomMode): string {
  switch (mode) {
    case 'dev_container_assessment':
      return 'Dev-container assessment';
    case 'code_review':
      return 'Code review';
    case 'standard_call':
    default:
      return 'Standard call';
  }
}

function compactRepoLabel(repositoryUrl: string): string {
  try {
    const parsed = new URL(repositoryUrl);
    if (parsed.hostname === 'github.com') {
      const [owner, repo] = parsed.pathname.split('/').filter(Boolean);
      if (owner && repo) return `${owner}/${repo}`;
    }
  } catch {
    // Fall through to readable trimming below.
  }
  return repositoryUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

function workspaceStatusInfo(workspace: RoomWorkspace | null, workspaceError: string | null | undefined): {
  label: string;
  state: 'ready' | 'starting' | 'waiting' | 'blocked' | 'none';
} {
  if (!workspace?.enabled) return { label: 'No dev workspace', state: 'none' };
  const status = workspace.session?.status ?? null;
  if (status === 'READY' || status === 'SLEEPING') return { label: 'Workspace ready', state: 'ready' };
  if (status === 'LAUNCHING') return { label: 'Container starting', state: 'starting' };
  if (status === 'ERROR') return { label: workspace.session?.errorMessage ?? workspaceError ?? 'Workspace failed', state: 'blocked' };
  if (status === 'STOPPED' || status === 'EXPIRED') return { label: 'Workspace stopped', state: 'blocked' };
  return { label: 'Workspace not launched', state: 'waiting' };
}

function modeIcon(mode: AssessmentRoomMode): typeof Video {
  if (mode === 'dev_container_assessment') return SquareTerminal;
  if (mode === 'code_review') return GitPullRequest;
  return Video;
}

export function AssessmentStatusStrip({
  meetingType,
  workspace,
  workspaceLoading = false,
  workspaceError = null,
  canLaunchWorkspace = false,
  onLaunchWorkspace,
  onOpenWorkspace,
  onOpenSubmission,
}: AssessmentStatusStripProps): JSX.Element {
  const mode = assessmentModeForRoom({
    meetingType,
    workspaceEnabled: Boolean(workspace?.enabled),
  });
  const ModeIcon = modeIcon(mode);
  const summary = summarizeChallengePacket(workspace?.challenge.packet ?? null);
  const repositoryUrl = summary.repositoryUrl ?? workspace?.repoUrl ?? null;
  const githubPrNumber = summary.githubPrNumber ?? workspace?.githubPrNumber ?? null;
  const baseCommit = summary.baseCommitSha;
  const statusInfo = workspaceStatusInfo(workspace, workspaceError);
  const workspaceReady = statusInfo.state === 'ready';
  const challengeNeedsAttention = workspace?.challenge.status === 'missing_reviewable_task';
  const nextAction = workspace?.enabled
    ? workspaceReady
      ? 'Commit changes, then submit work'
      : canLaunchWorkspace
        ? 'Launch the controlled workspace'
        : statusInfo.state === 'starting'
          ? 'Wait for the container'
          : 'Host launches the workspace'
    : mode === 'code_review'
      ? 'Review the assigned code with source-backed notes'
      : 'Use video, chat, and recording';

  return (
    <section
      className={`assessment-status-strip is-${mode.replace(/_/g, '-')}`}
      data-testid="assessment-status-strip"
      data-assessment-mode={mode}
      aria-label={`${assessmentModeLabel(mode)} status`}
    >
      <div className="assessment-status-main">
        <span className="assessment-status-mode">
          <ModeIcon size={14} />
          {assessmentModeLabel(mode)}
        </span>
        <span className={`assessment-status-pill is-${statusInfo.state}`} data-testid="assessment-workspace-status">
          {statusInfo.state === 'starting' && <Loader2 size={12} className="spin" />}
          {statusInfo.label}
        </span>
        {repositoryUrl && (
          <span className="assessment-status-repo" title={repositoryUrl} data-testid="assessment-repo">
            {compactRepoLabel(repositoryUrl)}
          </span>
        )}
        {githubPrNumber && (
          <span className="assessment-status-pill" data-testid="assessment-pr">
            PR #{githubPrNumber}
          </span>
        )}
        {baseCommit && (
          <span className="assessment-status-pill" title={baseCommit} data-testid="assessment-base-commit">
            Base {baseCommit.slice(0, 8)}
          </span>
        )}
      </div>

      {(summary.task || challengeNeedsAttention) && (
        <div className="assessment-status-detail">
          {challengeNeedsAttention && <AlertTriangle size={13} />}
          <span data-testid="assessment-next-action">
            {summary.task ?? workspace?.challenge.message ?? 'Challenge needs attention'}
          </span>
        </div>
      )}

      <div className="assessment-status-actions">
        <span className="assessment-status-next">{nextAction}</span>
        {workspace?.enabled && canLaunchWorkspace && onLaunchWorkspace && (
          <button
            type="button"
            className="assessment-status-action"
            onClick={onLaunchWorkspace}
            disabled={workspaceLoading}
            data-testid="assessment-launch-workspace"
          >
            {workspaceLoading ? <Loader2 size={13} className="spin" /> : <Play size={13} />}
            Launch
          </button>
        )}
        {workspace?.enabled && workspaceReady && onOpenWorkspace && (
          <button
            type="button"
            className="assessment-status-action"
            onClick={onOpenWorkspace}
            data-testid="assessment-open-workspace"
          >
            <SquareTerminal size={13} />
            Workspace
          </button>
        )}
        {workspace?.enabled && workspaceReady && onOpenSubmission && (
          <button
            type="button"
            className="assessment-status-action"
            onClick={onOpenSubmission}
            data-testid="assessment-open-submission"
          >
            <Upload size={13} />
            Submit
          </button>
        )}
        {mode !== 'standard_call' && summary.expectedEvidence.length > 0 && (
          <span className="assessment-status-evidence" title={summary.expectedEvidence.join('\n')}>
            <ClipboardCheck size={13} />
            {summary.expectedEvidence.length} evidence items
          </span>
        )}
      </div>
    </section>
  );
}
