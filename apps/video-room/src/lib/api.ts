import type {
  IceServerProvider,
  RoomCommitSubmissionRequest,
  RoomCommitSubmissionResponse,
  RoomAssessmentProgressSnapshot,
  RecordingSpeakerMetadata,
  RoomMetadata,
  RoomWorkspace,
} from '../types';

const localApiBase = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:8787'
  : window.location.origin;
export const API_BASE = import.meta.env.VITE_API_BASE_URL || localApiBase;
const TURN_CREDENTIAL_ATTEMPTS = 3;
const TURN_RETRY_DELAY_MS = 350;

function apiUrl(path: string): string {
  return new URL(path, API_BASE).toString();
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (response.ok) return response.json() as Promise<T>;
  const body = await response.json().catch(() => null) as {
    error?: { message?: string };
  } | null;
  throw new Error(body?.error?.message ?? `Request failed (${response.status})`);
}

export async function loadRoom(token: string): Promise<RoomMetadata> {
  const response = await fetch(apiUrl(`/api/v1/meeting-rooms/${token}`));
  const body = await parseResponse<{ room: RoomMetadata }>(response);
  return body.room;
}

export async function postRoomEvent(
  token: string,
  event: 'JOINED' | 'LEFT' | 'STARTED' | 'RECORDING_STARTED' | 'ENDED',
): Promise<void> {
  const response = await fetch(apiUrl(`/api/v1/meeting-rooms/${token}/events`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event }),
  });
  await parseResponse<{ accepted: boolean }>(response);
}

export async function uploadRecording(
  token: string,
  recording: Blob,
  transcriptionAudio?: Blob,
  speakerMetadata?: RecordingSpeakerMetadata,
): Promise<{ accepted: boolean; transcriptStatus?: string }> {
  if (transcriptionAudio && transcriptionAudio.size > 0) {
    if (!speakerMetadata) {
      throw new Error('Speaker metadata is required when uploading transcription audio.');
    }
    const body = new FormData();
    body.append('recording', recording, 'recording.webm');
    body.append('transcriptionAudio', transcriptionAudio, 'transcription-audio.webm');
    body.append('speakerMetadata', JSON.stringify(speakerMetadata));
    const response = await fetch(apiUrl(`/api/v1/meeting-rooms/${token}/recording`), {
      method: 'POST',
      body,
    });
    return parseResponse<{ accepted: boolean; transcriptStatus?: string }>(response);
  }

  const response = await fetch(apiUrl(`/api/v1/meeting-rooms/${token}/recording`), {
    method: 'POST',
    headers: { 'Content-Type': recording.type || 'video/webm' },
    body: recording,
  });
  return parseResponse<{ accepted: boolean; transcriptStatus?: string }>(response);
}

export async function getIceServerConfig(token: string): Promise<{
  iceServers: RTCIceServer[];
  provider: IceServerProvider;
}> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= TURN_CREDENTIAL_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(
        apiUrl(`/api/v1/meeting-rooms/${token}/turn-credentials`),
        {
          cache: 'no-store',
          credentials: 'same-origin',
          headers: {
            Accept: 'application/json',
            'Cache-Control': 'no-store',
          },
        },
      );
      const body = await parseResponse<{
        iceServers: RTCIceServer[];
        provider?: IceServerProvider;
      }>(response);
      const result = {
        iceServers: body.iceServers,
        provider: body.provider ?? 'unknown',
      };
      console.log('[room/api] ICE server config', {
        provider: result.provider,
        serverCount: result.iceServers.length,
        hasTurn: result.iceServers.some((s) => {
          const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
          return urls.some((u) => u.startsWith('turn:') || u.startsWith('turns:'));
        }),
        attempt,
      });
      if (result.provider !== 'fallback' || attempt === TURN_CREDENTIAL_ATTEMPTS) {
        return result;
      }
      console.warn('[room/api] ICE provider is fallback, retrying', { attempt });
    } catch (error) {
      lastError = error;
      if (attempt === TURN_CREDENTIAL_ATTEMPTS) throw error;
    }
    await wait(TURN_RETRY_DELAY_MS * attempt);
  }

  throw lastError instanceof Error ? lastError : new Error('Unable to load ICE servers.');
}

export function roomWebSocketUrl(token: string): string {
  const url = new URL(`/api/v1/meeting-rooms/${token}/ws`, API_BASE);
  url.protocol = url.protocol.replace(/^http/, 'ws');
  return url.toString();
}

export async function getRoomWorkspace(token: string): Promise<RoomWorkspace> {
  const response = await fetch(apiUrl(`/api/v1/meeting-rooms/${token}/workspace`), {
    cache: 'no-store',
    credentials: 'same-origin',
  });
  const body = await parseResponse<{ workspace: RoomWorkspace }>(response);
  return body.workspace;
}

export async function launchRoomWorkspace(token: string, repoUrl?: string): Promise<RoomWorkspace> {
  const response = await fetch(apiUrl(`/api/v1/meeting-rooms/${token}/workspace/launch`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(repoUrl ? { repoUrl } : {}),
    cache: 'no-store',
    credentials: 'same-origin',
  });
  const body = await parseResponse<{ workspace: RoomWorkspace }>(response);
  return body.workspace;
}

export async function getRoomAssessmentProgress(token: string): Promise<RoomAssessmentProgressSnapshot | null> {
  const response = await fetch(apiUrl(`/api/v1/meeting-rooms/${token}/assessment/progress`), {
    cache: 'no-store',
    credentials: 'same-origin',
  });
  const body = await parseResponse<{ progress: RoomAssessmentProgressSnapshot | null }>(response);
  return body.progress;
}

export async function submitRoomAssessmentCommit(
  token: string,
  payload: RoomCommitSubmissionRequest,
): Promise<RoomCommitSubmissionResponse> {
  const response = await fetch(apiUrl(`/api/v1/meeting-rooms/${token}/assessment/commit-submission`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    cache: 'no-store',
    credentials: 'same-origin',
  });
  return parseResponse<RoomCommitSubmissionResponse>(response);
}

export function roomWorkspaceProxyUrl(token: string, sessionId: string): string {
  return apiUrl(
    `/api/v1/meeting-rooms/${encodeURIComponent(token)}/workspace/proxy/${encodeURIComponent(sessionId)}/`,
  );
}

export function roomAgentWsUrl(token: string, sessionId: string): string {
  const httpUrl = apiUrl(
    `/api/v1/meeting-rooms/${encodeURIComponent(token)}/agent/${encodeURIComponent(sessionId)}/ws`,
  );
  return httpUrl.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
}

export function roomTerminalWsUrl(token: string, sessionId: string): string {
  const httpUrl = apiUrl(
    `/api/v1/meeting-rooms/${encodeURIComponent(token)}/workspace/proxy/${encodeURIComponent(sessionId)}/terminal`,
  );
  return httpUrl.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
}

export function roomAgentAuthUrl(token: string, sessionId: string, path: string = '/start'): string {
  return apiUrl(
    `/api/v1/meeting-rooms/${encodeURIComponent(token)}/agent/${encodeURIComponent(sessionId)}/auth${path}`,
  );
}
