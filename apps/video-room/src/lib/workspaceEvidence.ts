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
  challengeStatus: string | null;
  challengeKind: string | null;
  challengeSource: string | null;
  challengeMessage: string | null;
  canLaunch: boolean;
  ttlSeconds: number | null;
  ttlSource: string | null;
  expiresAt: string | null;
  expiringSoon: boolean;
  source: 'browser_workspace_state_observer';
  workspaceEventSource: 'browser_workspace_state_observer';
  workspaceStateSource: 'initial_load' | 'launch' | 'refresh' | 'error';
  workspaceTelemetryPersisted: true;
  proxyUrlPersisted: false;
}

export function buildCodeEditorOpenEvidence(input: {
  workspace: RoomWorkspace | null;
  actor: RoomEvidenceActor;
  surface: RoomEvidenceSurface;
  roomPhase: RoomPhase;
  capturedAtMs: number;
}): CodeEditorOpenEvidence | null {
  const session = input.workspace?.session;
  if (!session) return null;

  const repoLabel = input.workspace?.repoUrl ?? 'workspace repository';
  const capturedAtMs = Number.isFinite(input.capturedAtMs) ? Math.max(0, Math.round(input.capturedAtMs)) : 0;
  return {
    text: `VS Code workspace opened for ${repoLabel}`,
    properties: {
      source: 'code_server_workspace',
      editorEventSource: 'browser_code_server_iframe',
      codeEditorOpenId: `code-editor-open:${input.actor}:${capturedAtMs}:${session.sessionId}`,
      editor: 'code-server',
      openStatus: 'loaded',
      actor: input.actor,
      capturedAtMs,
      surface: input.surface,
      roomPhase: input.roomPhase,
      workspaceSessionId: session.sessionId,
      workspaceStatus: session.status,
      repoUrl: input.workspace?.repoUrl ?? null,
      githubPrNumber: input.workspace?.githubPrNumber ?? null,
      matchedRepoId: input.workspace?.matchedRepoId ?? null,
      challengeStatus: input.workspace?.challenge?.status ?? null,
      challengeKind: input.workspace?.challenge?.kind ?? null,
      challengeSource: input.workspace?.challenge?.source ?? null,
      challengeMessage: input.workspace?.challenge?.message ?? null,
      proxyUrlPersisted: false,
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
    challengeStatus: input.workspace?.challenge?.status ?? null,
    challengeKind: input.workspace?.challenge?.kind ?? null,
    challengeSource: input.workspace?.challenge?.source ?? null,
    challengeMessage: input.workspace?.challenge?.message ?? null,
    canLaunch: Boolean(input.workspace?.canLaunch),
    ttlSeconds: session?.ttlSeconds ?? null,
    ttlSource: session?.ttlSource ?? null,
    expiresAt: session?.expiresAt ?? null,
    expiringSoon: Boolean(session?.expiringSoon),
    source: 'browser_workspace_state_observer',
    workspaceEventSource: 'browser_workspace_state_observer',
    workspaceStateSource: input.source,
    workspaceTelemetryPersisted: true,
    proxyUrlPersisted: false,
  };
}
