import type { RoomSurface } from '../hooks/useRoomConnection';
import type { RoomPhase } from '../types';

export type WindowEvidenceActor = 'host' | 'guest';

export interface WindowStateUpdateEvidence {
  text: string;
  properties: Record<string, unknown>;
}

function supportedWindowStateEntry(value: unknown): value is number | boolean {
  return typeof value === 'number' || typeof value === 'boolean';
}

function inferWindowStateAction(statePatch: Record<string, number | boolean>): string {
  if (statePatch.minimized === true) return 'minimize';
  if (statePatch.minimized === false && statePatch.focused === true) return 'restore_or_focus';
  if (statePatch.maximized === true) return 'maximize';
  if (statePatch.maximized === false) return 'restore_size';
  if ('x' in statePatch || 'y' in statePatch) return 'move';
  if ('width' in statePatch || 'height' in statePatch) return 'resize';
  if (statePatch.focused === true) return 'focus';
  return 'update';
}

export function buildWindowStateUpdateEvidence(input: {
  actor: WindowEvidenceActor;
  windowId: string;
  patch: Record<string, unknown>;
  surface: RoomSurface;
  roomPhase: RoomPhase;
}): WindowStateUpdateEvidence | null {
  const statePatch: Record<string, number | boolean> = {};
  for (const key of ['x', 'y', 'width', 'height', 'minimized', 'maximized', 'focused']) {
    const value = input.patch[key];
    if (supportedWindowStateEntry(value)) {
      statePatch[key] = value;
    }
  }

  const stateKeys = Object.keys(statePatch).sort();
  if (stateKeys.length === 0) return null;

  return {
    text: `Window state updated: ${input.windowId}`,
    properties: {
      source: 'window_state_client_submit',
      actor: input.actor,
      windowId: input.windowId,
      action: inferWindowStateAction(statePatch),
      surface: input.surface,
      roomPhase: input.roomPhase,
      statePatch,
      stateKeys,
      durableObjectReplayExpected: input.surface === 'win95',
    },
  };
}
