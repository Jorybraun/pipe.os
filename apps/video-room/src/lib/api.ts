import type { RoomMetadata } from '../types';

const localApiBase = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:8787'
  : window.location.origin;
const API_BASE = import.meta.env.VITE_API_BASE_URL || localApiBase;

async function parseResponse<T>(response: Response): Promise<T> {
  if (response.ok) return response.json() as Promise<T>;
  const body = await response.json().catch(() => null) as {
    error?: { message?: string };
  } | null;
  throw new Error(body?.error?.message ?? `Request failed (${response.status})`);
}

export async function loadRoom(token: string): Promise<RoomMetadata> {
  const response = await fetch(`${API_BASE}/api/v1/meeting-rooms/${token}`);
  const body = await parseResponse<{ room: RoomMetadata }>(response);
  return body.room;
}

export async function postRoomEvent(
  token: string,
  event: 'JOINED' | 'LEFT' | 'STARTED' | 'ENDED',
): Promise<void> {
  const response = await fetch(`${API_BASE}/api/v1/meeting-rooms/${token}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event }),
  });
  await parseResponse<{ accepted: boolean }>(response);
}

export async function uploadRecording(token: string, recording: Blob): Promise<void> {
  const response = await fetch(`${API_BASE}/api/v1/meeting-rooms/${token}/recording`, {
    method: 'POST',
    headers: { 'Content-Type': recording.type || 'video/webm' },
    body: recording,
  });
  await parseResponse<{ accepted: boolean }>(response);
}

export async function getIceServers(token: string): Promise<RTCIceServer[]> {
  const response = await fetch(
    `${API_BASE}/api/v1/meeting-rooms/${token}/turn-credentials`,
  );
  const body = await parseResponse<{ iceServers: RTCIceServer[] }>(response);
  return body.iceServers;
}

export function roomWebSocketUrl(token: string): string {
  const wsBase = API_BASE.replace(/^http/, 'ws');
  return `${wsBase}/api/v1/meeting-rooms/${token}/ws`;
}
