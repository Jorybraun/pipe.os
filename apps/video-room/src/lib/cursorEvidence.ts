import type { RoomPhase } from '../types';
import type { RoomSurface } from '../hooks/useRoomConnection';

export const CURSOR_PRESENCE_EVIDENCE_INTERVAL_MS = 15_000;
export const CURSOR_PRESENCE_MIN_DISTANCE = 0.03;
const CURSOR_SAMPLE_COORDINATE_SCALE = 1000;

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

function roundDistance(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function getMovementDistance(previous: CursorPresenceEvidenceState, x: number, y: number): number {
  return Math.hypot(previous.x - x, previous.y - y);
}

function buildCursorSampleId(actor: 'host' | 'guest', capturedAtMs: number, x: number, y: number): string {
  return [
    'cursor',
    actor,
    capturedAtMs,
    Math.round(x * CURSOR_SAMPLE_COORDINATE_SCALE),
    Math.round(y * CURSOR_SAMPLE_COORDINATE_SCALE),
  ].join(':');
}

export function buildCursorPresenceEvidence(input: CursorPresenceEvidenceInput): CursorPresenceEvidence | null {
  const capturedAtMs = Number.isFinite(input.capturedAtMs)
    ? Math.max(0, Math.round(input.capturedAtMs))
    : 0;
  const x = roundUnit(input.position.x);
  const y = roundUnit(input.position.y);
  const nextState = {
    capturedAtMs,
    x,
    y,
  };
  const distanceFromPrevious = input.previous
    ? getMovementDistance(input.previous, x, y)
    : null;

  if (input.previous) {
    const intervalElapsed =
      capturedAtMs - input.previous.capturedAtMs >= CURSOR_PRESENCE_EVIDENCE_INTERVAL_MS;
    if (!intervalElapsed || distanceFromPrevious === null || distanceFromPrevious < CURSOR_PRESENCE_MIN_DISTANCE) {
      return null;
    }
  }

  const label = input.actor === 'host' ? 'Host' : 'Guest';
  const cursorSampleId = buildCursorSampleId(input.actor, capturedAtMs, x, y);
  return {
    text: `${label} cursor presence sampled on 95 Until Infinity desktop`,
    state: nextState,
    properties: {
      source: 'win95_cursor_presence_client_sample',
      cursorEventSource: 'browser_win95_desktop_pointermove',
      actor: input.actor,
      cursorSampleId,
      sampledAtMs: capturedAtMs,
      surface: input.surface,
      roomPhase: input.roomPhase,
      normalizedX: x,
      normalizedY: y,
      previousNormalizedX: input.previous?.x ?? null,
      previousNormalizedY: input.previous?.y ?? null,
      distanceFromPrevious: distanceFromPrevious === null ? null : roundDistance(distanceFromPrevious),
      evidenceSampling: 'presence_sample',
      sampleIntervalMs: CURSOR_PRESENCE_EVIDENCE_INTERVAL_MS,
      movementThreshold: CURSOR_PRESENCE_MIN_DISTANCE,
      rawCursorMovesPersisted: false,
    },
  };
}
