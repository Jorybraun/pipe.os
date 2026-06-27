import type { RoomPhase } from '../types';
import type { RoomSurface } from '../hooks/useRoomConnection';

export const CURSOR_PRESENCE_EVIDENCE_INTERVAL_MS = 15_000;
const CURSOR_PRESENCE_MIN_DISTANCE = 0.03;

export interface CursorPresenceEvidenceState {
  capturedAtMs: number;
  x: number;
  y: number;
}

interface CursorPresenceEvidenceInput {
  actor: 'host' | 'guest';
  position: { x: number; y: number };
  surface: RoomSurface;
  roomPhase: RoomPhase;
  capturedAtMs: number;
  previous: CursorPresenceEvidenceState | null;
}

interface CursorPresenceEvidence {
  text: string;
  properties: Record<string, unknown>;
  state: CursorPresenceEvidenceState;
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function roundUnit(value: number): number {
  return Math.round(clampUnit(value) * 1000) / 1000;
}

function movedEnough(
  previous: CursorPresenceEvidenceState,
  position: { x: number; y: number },
): boolean {
  const dx = previous.x - roundUnit(position.x);
  const dy = previous.y - roundUnit(position.y);
  return Math.hypot(dx, dy) >= CURSOR_PRESENCE_MIN_DISTANCE;
}

export function buildCursorPresenceEvidence(input: CursorPresenceEvidenceInput): CursorPresenceEvidence | null {
  const x = roundUnit(input.position.x);
  const y = roundUnit(input.position.y);
  const nextState = {
    capturedAtMs: input.capturedAtMs,
    x,
    y,
  };

  if (input.previous) {
    const intervalElapsed =
      input.capturedAtMs - input.previous.capturedAtMs >= CURSOR_PRESENCE_EVIDENCE_INTERVAL_MS;
    if (!intervalElapsed || !movedEnough(input.previous, input.position)) return null;
  }

  const label = input.actor === 'host' ? 'Host' : 'Guest';
  return {
    text: `${label} cursor presence sampled on 95 Until Infinity desktop`,
    state: nextState,
    properties: {
      source: 'win95_cursor_presence_client_sample',
      surface: input.surface,
      roomPhase: input.roomPhase,
      normalizedX: x,
      normalizedY: y,
      evidenceSampling: 'presence_sample',
      sampleIntervalMs: CURSOR_PRESENCE_EVIDENCE_INTERVAL_MS,
      rawCursorMovesPersisted: false,
    },
  };
}
