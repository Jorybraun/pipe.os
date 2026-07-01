import type { RoomPhase } from '../types';
import type { RoomSurface } from '../hooks/useRoomConnection';

export type MediaControlKind = 'microphone' | 'camera';
export type MediaControlActor = 'host' | 'guest';

interface MediaControlEvidenceInput {
  actor: MediaControlActor;
  control: MediaControlKind;
  previousEnabled: boolean;
  enabled: boolean;
  surface: RoomSurface;
  roomPhase: RoomPhase;
  capturedAtMs: number;
}

interface MediaControlEvidence {
  text: string;
  properties: Record<string, unknown>;
}

function actorLabel(actor: MediaControlActor): string {
  return actor === 'host' ? 'Host' : 'Guest';
}

function controlLabel(control: MediaControlKind): string {
  return control === 'microphone' ? 'microphone' : 'camera';
}

function mediaControlId(input: MediaControlEvidenceInput, capturedAtMs: number): string {
  const action = input.enabled ? 'enabled' : 'disabled';
  return ['media', input.actor, input.control, capturedAtMs, action].join(':');
}

export function buildMediaControlEvidence(input: MediaControlEvidenceInput): MediaControlEvidence {
  const capturedAtMs = Number.isFinite(input.capturedAtMs)
    ? Math.max(0, Math.round(input.capturedAtMs))
    : 0;
  const nextState = input.enabled ? 'on' : 'off';
  const action = input.enabled ? 'enabled' : 'disabled';
  return {
    text: `${actorLabel(input.actor)} turned ${controlLabel(input.control)} ${nextState}`,
    properties: {
      source: 'video_room_media_controls',
      mediaControlEventSource: 'browser_video_control_button',
      actor: input.actor,
      mediaControlId: mediaControlId(input, capturedAtMs),
      capturedAtMs,
      control: input.control,
      previousEnabled: input.previousEnabled,
      enabled: input.enabled,
      action,
      surface: input.surface,
      roomPhase: input.roomPhase,
      controlSurface: 'standard_video_call',
      controlAction: 'toggle',
      mediaSource: 'local_media_stream',
      rawMediaStreamPersisted: false,
    },
  };
}
