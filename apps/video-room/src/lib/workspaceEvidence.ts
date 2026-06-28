import type { RoomPhase, RoomWorkspace } from '../types';

export type RoomEvidenceActor = 'host' | 'guest';
export type RoomEvidenceSurface = 'standard' | 'win95';

export interface CodeEditorOpenEvidence {
  text: string;
  properties: Record<string, unknown>;
}

export interface CodeServerFileChangeEvidence {
  eventType: 'code_editor_save' | 'file_change';
  text: string;
  properties: Record<string, unknown>;
}

export interface WorkspaceStateDesktopEvent {
  kind: 'WORKSPACE_STATE_CHANGED';
  actor: RoomEvidenceActor;
  workspaceStateEventId: string;
  capturedAtMs: number;
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

export function buildCodeServerFileChangeEvidence(input: {
  filePath: string;
  actionName: string;
  source?: string | null;
  observedAt?: string | null;
  sizeBytes?: number | null;
  contentHash?: string | null;
  contentPreview?: string | null;
  persisted?: boolean;
  workspace: RoomWorkspace | null;
  surface: RoomEvidenceSurface;
  roomPhase: RoomPhase;
}): CodeServerFileChangeEvidence | null {
  if (input.persisted) return null;
  if (input.source !== 'code_server_workspace') return null;
  const filePath = input.filePath.trim();
  const actionName = input.actionName.trim();
  if (!filePath || !actionName) return null;
  const session = input.workspace?.session ?? null;
  return {
    eventType: actionName === 'deleted' ? 'file_change' : 'code_editor_save',
    text: filePath,
    properties: {
      source: 'code_server_workspace',
      observedBy: 'clippy_agent_bridge',
      bridgeEventType: 'FILE_CHANGED',
      editorSurface: 'code-server',
      action: actionName,
      surface: input.surface,
      roomPhase: input.roomPhase,
      workspaceStatus: session?.status ?? null,
      workspaceSessionId: session?.sessionId ?? null,
      repoUrl: input.workspace?.repoUrl ?? null,
      path: filePath,
      observedAt: input.observedAt ?? null,
      contentHash: input.contentHash ?? null,
      sizeBytes: input.sizeBytes ?? null,
      contentPreview: input.contentPreview ?? null,
      bridgePersisted: false,
    },
  };
}

export function buildWorkspaceStateDesktopEvent(input: {
  workspace: RoomWorkspace | null;
  actor: RoomEvidenceActor;
  source: 'initial_load' | 'launch' | 'refresh' | 'error';
  capturedAtMs: number;
  fallbackRepoUrl?: string | null;
  errorMessage?: string | null;
}): WorkspaceStateDesktopEvent {
  const session = input.workspace?.session ?? null;
  const errorMessage = session?.errorMessage ?? input.errorMessage ?? null;
  const status = session?.status ?? (errorMessage ? 'ERROR' : null);
  const workspaceSessionId = session?.sessionId ?? null;
  const capturedAtMs = Number.isFinite(input.capturedAtMs) ? Math.max(0, Math.round(input.capturedAtMs)) : 0;
  const stateIdSession = workspaceSessionId ?? 'no-session';
  const stateIdStatus = status ?? 'unknown';
  return {
    kind: 'WORKSPACE_STATE_CHANGED',
    actor: input.actor,
    workspaceStateEventId: `workspace-state:${input.actor}:${capturedAtMs}:${input.source}:${stateIdSession}:${stateIdStatus}`,
    capturedAtMs,
    status,
    workspaceSessionId,
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
