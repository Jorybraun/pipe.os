import type { RoomPhase } from '../types';
import type { RoomSurface } from '../hooks/useRoomConnection';

export type MediaControlKind = 'microphone' | 'camera';
export type MediaControlActor = 'host' | 'guest';

interface MediaControlEvidenceInput {
  actor: MediaControlActor;
  control: MediaControlKind;
  enabled: boolean;
  surface: RoomSurface;
  roomPhase: RoomPhase;
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

function controlSurface(surface: RoomSurface): string {
  return surface === 'win95' ? 'win95_video_window' : 'standard_video_call';
}

export function buildMediaControlEvidence(input: MediaControlEvidenceInput): MediaControlEvidence {
  const nextState = input.enabled ? 'on' : 'off';
  return {
    text: `${actorLabel(input.actor)} turned ${controlLabel(input.control)} ${nextState}`,
    properties: {
      source: 'video_room_media_controls',
      control: input.control,
      enabled: input.enabled,
      action: input.enabled ? 'enabled' : 'disabled',
      surface: input.surface,
      roomPhase: input.roomPhase,
      controlSurface: controlSurface(input.surface),
      mediaSource: 'local_media_stream',
      rawMediaStreamPersisted: false,
    },
  };
}
