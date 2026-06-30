import type { RoomSurface } from '../hooks/useRoomConnection';
import type { RoomPhase } from '../types';

export type StartMenuEvidenceActor = 'host' | 'guest';
export type StartMenuEventSource =
  | 'win95_start_button'
  | 'win95_desktop_click'
  | 'win95_start_menu_item';

export interface StartMenuStateEvidence {
  text: string;
  properties: Record<string, unknown>;
}

function startMenuAction(open: boolean): 'open' | 'close' {
  return open ? 'open' : 'close';
}

export function buildStartMenuStateEvidence(input: {
  actor: StartMenuEvidenceActor;
  open: boolean;
  eventSource: StartMenuEventSource;
  surface: RoomSurface;
  roomPhase: RoomPhase;
  capturedAtMs: number;
}): StartMenuStateEvidence {
  const capturedAtMs = Number.isFinite(input.capturedAtMs)
    ? Math.max(0, Math.round(input.capturedAtMs))
    : 0;
  const action = startMenuAction(input.open);
  return {
    text: input.open ? 'Start menu opened' : 'Start menu closed',
    properties: {
      source: 'win95_start_menu_control',
      menuEventSource: input.eventSource,
      actor: input.actor,
      menuId: 'start',
      action,
      open: input.open,
      startMenuEventId: [
        'start-menu',
        input.actor,
        capturedAtMs,
        action,
        input.eventSource,
      ].join(':'),
      capturedAtMs,
      surface: input.surface,
      roomPhase: input.roomPhase,
      durableObjectReplayExpected: input.surface === 'win95',
    },
  };
}
