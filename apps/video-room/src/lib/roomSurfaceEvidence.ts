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
}): RoomSurfaceChangeEvidence {
  const action = input.nextSurface === 'win95' ? 'enter_desktop' : 'exit_desktop';
  return {
    text: `Room surface changed to ${surfaceLabel(input.nextSurface)}`,
    properties: {
      source: 'room_surface_control',
      actor: input.actor,
      surface: input.nextSurface,
      previousSurface: input.previousSurface,
      action,
      roomPhase: input.roomPhase,
    },
  };
}
