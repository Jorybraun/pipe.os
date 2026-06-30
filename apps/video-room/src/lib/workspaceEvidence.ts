import type { RoomPhase, RoomWorkspace } from '../types';

export type RoomEvidenceActor = 'host' | 'guest';
export type RoomEvidenceSurface = 'standard' | 'assessment';

const SHA256_HEX_RE = /^[a-f0-9]{64}$/i;
const WORKSPACE_DIAGNOSTIC_LIMIT = 500;
const WORKSPACE_REDACTED_SECRET = '[REDACTED_SECRET]';
const BARE_SECRET_RE = /\b(?:cog|ghp|gho|ghu|ghs|ghr|devin)_[A-Za-z0-9_-]{20,}\b/g;
const GITHUB_PAT_RE = /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g;
const OPENAI_KEY_RE = /\bsk-[A-Za-z0-9_-]{8,}\b/g;
const BEARER_TOKEN_RE = /\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi;
const ENV_SECRET_ASSIGNMENT_RE = /\b([A-Za-z0-9_]*(?:API_KEY|AUTH_TOKEN|ACCESS_TOKEN|REFRESH_TOKEN|TOKEN|SECRET|PASSWORD))=([^\s"'`]+)/gi;
const SECRET_QUERY_RE = /([?&](?:api_key|key|token|secret|password)=)[^&\s]+/gi;
const ROOM_TOKEN_PATH_RE = /(\/api\/v1\/meeting-rooms\/)[^/\s]+/g;
const FNV_32_OFFSET = 0x811c9dc5;
const FNV_32_PRIME = 0x01000193;

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
  challengePacketSourceRefType: string | null;
  challengePacketEvidenceRole: string | null;
  challengePacketContentHash: string | null;
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

export function redactWorkspaceDiagnostic(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) return null;
  const redacted = trimmed
    .replace(ENV_SECRET_ASSIGNMENT_RE, (_match, name: string) => `${name}=${WORKSPACE_REDACTED_SECRET}`)
    .replace(BEARER_TOKEN_RE, (_match, prefix: string) => `${prefix}${WORKSPACE_REDACTED_SECRET}`)
    .replace(GITHUB_PAT_RE, WORKSPACE_REDACTED_SECRET)
    .replace(OPENAI_KEY_RE, WORKSPACE_REDACTED_SECRET)
    .replace(BARE_SECRET_RE, WORKSPACE_REDACTED_SECRET)
    .replace(SECRET_QUERY_RE, (_match, prefix: string) => `${prefix}${WORKSPACE_REDACTED_SECRET}`)
    .replace(ROOM_TOKEN_PATH_RE, (_match, prefix: string) => `${prefix}${WORKSPACE_REDACTED_SECRET}`);
  return redacted.slice(0, WORKSPACE_DIAGNOSTIC_LIMIT);
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
      challengePacketSourceRefType: input.workspace?.challenge?.packet?.sourceRefType ?? null,
      challengePacketEvidenceRole: input.workspace?.challenge?.packet?.evidenceRole ?? null,
      challengePacketContentHash: input.workspace?.challenge?.packet?.contentHash ?? null,
      proxyUrlPersisted: false,
    },
  };
}

function safeWorkspaceEvidenceIdPart(value: string, maxLength = 80): string {
  const normalized = value
    .trim()
    .replace(/[^a-zA-Z0-9:_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return (normalized || 'none').slice(0, maxLength);
}

function workspaceTextFingerprint(prefix: string, text: string): string {
  let hash = FNV_32_OFFSET;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, FNV_32_PRIME);
  }
  return `${prefix}_${(hash >>> 0).toString(16).padStart(8, '0')}`;
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
  if (!session?.status || !session.sessionId) return null;
  const observedAt = input.observedAt?.trim() ?? '';
  if (!observedAt) return null;
  if (
    typeof input.sizeBytes !== 'number'
    || !Number.isFinite(input.sizeBytes)
    || input.sizeBytes < 0
  ) {
    return null;
  }
  const contentHash = input.contentHash?.trim() ?? '';
  if (!SHA256_HEX_RE.test(contentHash)) return null;
  const observedAtMs = Date.parse(observedAt);
  if (!Number.isFinite(observedAtMs)) return null;
  const codeServerFileChangeId = [
    'code-server-file',
    safeWorkspaceEvidenceIdPart(session.sessionId, 48),
    Math.max(0, Math.round(observedAtMs)),
    safeWorkspaceEvidenceIdPart(actionName, 24),
    workspaceTextFingerprint('path', filePath),
    contentHash.slice(0, 16).toLowerCase(),
  ].join(':');
  return {
    eventType: actionName === 'deleted' ? 'file_change' : 'code_editor_save',
    text: filePath,
    properties: {
      source: 'code_server_workspace',
      observedBy: 'agent_bridge',
      bridgeEventType: 'FILE_CHANGED',
      editorSurface: 'code-server',
      codeServerFileChangeId,
      action: actionName,
      surface: input.surface,
      roomPhase: input.roomPhase,
      workspaceStatus: session.status,
      workspaceSessionId: session.sessionId,
      repoUrl: input.workspace?.repoUrl ?? null,
      path: filePath,
      observedAt,
      contentHash,
      sizeBytes: input.sizeBytes,
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
  const errorMessage = redactWorkspaceDiagnostic(session?.errorMessage ?? input.errorMessage ?? null);
  const status = session?.status ?? (errorMessage ? 'ERROR' : input.workspace?.enabled ? 'NOT_LAUNCHED' : null);
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
    challengePacketSourceRefType: input.workspace?.challenge?.packet?.sourceRefType ?? null,
    challengePacketEvidenceRole: input.workspace?.challenge?.packet?.evidenceRole ?? null,
    challengePacketContentHash: input.workspace?.challenge?.packet?.contentHash ?? null,
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
