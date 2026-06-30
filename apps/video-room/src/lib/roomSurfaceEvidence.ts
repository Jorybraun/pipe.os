import type { RoomPhase, RoomRole } from '../types';
import type { RoomSurface } from '../hooks/useRoomConnection';

export type RoomEvidenceActor = 'host' | 'guest';

export interface RoomSurfaceChangeEvidence {
  text: string;
  properties: Record<string, unknown>;
}

export function canControlSharedRoomSurface(role: RoomRole): boolean {
  return role === 'HOST' || role === 'GUEST';
}

function surfaceLabel(surface: RoomSurface): string {
  return surface === 'win95' ? '95 Until Infinity desktop' : 'standard call';
}

export function buildRoomSurfaceChangeEvidence(input: {
  actor: RoomEvidenceActor;
  previousSurface: RoomSurface;
  nextSurface: RoomSurface;
  roomPhase: RoomPhase;
  capturedAtMs: number;
}): RoomSurfaceChangeEvidence {
  const capturedAtMs = Number.isFinite(input.capturedAtMs)
    ? Math.max(0, Math.round(input.capturedAtMs))
    : 0;
  const action = input.nextSurface === 'win95' ? 'enter_desktop' : 'exit_desktop';
  return {
    text: `Room surface changed to ${surfaceLabel(input.nextSurface)}`,
    properties: {
      source: 'room_surface_control',
      surfaceControlEventSource: 'browser_room_surface_toggle',
      actor: input.actor,
      surfaceChangeId: [
        'surface',
        input.actor,
        capturedAtMs,
        input.previousSurface,
        input.nextSurface,
      ].join(':'),
      capturedAtMs,
      surface: input.nextSurface,
      previousSurface: input.previousSurface,
      action,
      roomPhase: input.roomPhase,
      durableObjectReplayExpected: true,
    },
  };
}
