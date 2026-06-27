import type { RoomPhase, RoomWorkspace } from '../types';

export type RoomEvidenceActor = 'host' | 'guest';
export type RoomEvidenceSurface = 'standard' | 'win95';

export interface CodeEditorOpenEvidence {
  text: string;
  properties: Record<string, unknown>;
}

export interface WorkspaceStateDesktopEvent {
  kind: 'WORKSPACE_STATE_CHANGED';
  status: string | null;
  workspaceSessionId: string | null;
  errorMessage: string | null;
  repoUrl: string | null;
  githubPrNumber: number | null;
  matchedRepoId: number | null;
  canLaunch: boolean;
  ttlSeconds: number | null;
  ttlSource: string | null;
  expiresAt: string | null;
  expiringSoon: boolean;
  source: string;
}

export function buildCodeEditorOpenEvidence(input: {
  workspace: RoomWorkspace | null;
  actor: RoomEvidenceActor;
  surface: RoomEvidenceSurface;
  roomPhase: RoomPhase;
}): CodeEditorOpenEvidence | null {
  const session = input.workspace?.session;
  if (!session) return null;

  const repoLabel = input.workspace?.repoUrl ?? 'workspace repository';
  return {
    text: `VS Code workspace opened for ${repoLabel}`,
    properties: {
      source: 'code_server_workspace',
      editor: 'code-server',
      actor: input.actor,
      surface: input.surface,
      roomPhase: input.roomPhase,
      workspaceSessionId: session.sessionId,
      workspaceStatus: session.status,
      repoUrl: input.workspace?.repoUrl ?? null,
      githubPrNumber: input.workspace?.githubPrNumber ?? null,
      matchedRepoId: input.workspace?.matchedRepoId ?? null,
    },
  };
}

export function buildWorkspaceStateDesktopEvent(input: {
  workspace: RoomWorkspace | null;
  source: 'initial_load' | 'launch' | 'refresh' | 'error';
  fallbackRepoUrl?: string | null;
  errorMessage?: string | null;
}): WorkspaceStateDesktopEvent {
  const session = input.workspace?.session ?? null;
  const errorMessage = session?.errorMessage ?? input.errorMessage ?? null;
  return {
    kind: 'WORKSPACE_STATE_CHANGED',
    status: session?.status ?? (errorMessage ? 'ERROR' : null),
    workspaceSessionId: session?.sessionId ?? null,
    errorMessage,
    repoUrl: input.workspace?.repoUrl ?? input.fallbackRepoUrl ?? null,
    githubPrNumber: input.workspace?.githubPrNumber ?? null,
    matchedRepoId: input.workspace?.matchedRepoId ?? null,
    canLaunch: Boolean(input.workspace?.canLaunch),
    ttlSeconds: session?.ttlSeconds ?? null,
    ttlSource: session?.ttlSource ?? null,
    expiresAt: session?.expiresAt ?? null,
    expiringSoon: Boolean(session?.expiringSoon),
    source: input.source,
  };
}
