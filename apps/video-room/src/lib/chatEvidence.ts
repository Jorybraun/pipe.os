import type { RoomChatMessage, RoomSurface } from '../hooks/useRoomConnection';
import type { RoomPhase } from '../types';

export type ChatEvidenceActor = 'host' | 'guest';

export interface RoomChatEvidence {
  text: string;
  properties: Record<string, unknown>;
}

const FNV_32_OFFSET = 0x811c9dc5;
const FNV_32_PRIME = 0x01000193;

export function roomChatMessageFingerprint(text: string): string {
  let hash = FNV_32_OFFSET;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, FNV_32_PRIME);
  }
  return `chat_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function buildRoomChatEvidence(input: {
  message: RoomChatMessage;
  actor: ChatEvidenceActor;
  surface: RoomSurface;
  roomPhase: RoomPhase;
}): RoomChatEvidence {
  const sourceEvidence = input.message.evidence ?? {};
  return {
    text: input.message.text,
    properties: {
      ...sourceEvidence,
      source: 'room_chat_client_submit',
      chatEventSource: 'browser_room_chat_window',
      actor: input.actor,
      roomMessageId: input.message.id,
      clientId: input.message.clientId,
      messageCreatedAt: input.message.createdAt,
      messageLength: input.message.text.length,
      messageFingerprint: roomChatMessageFingerprint(input.message.text),
      deliveryStatus: input.message.deliveryStatus ?? 'pending',
      surface: input.surface,
      roomPhase: input.roomPhase,
      durableObjectReplayExpected: true,
    },
  };
}
