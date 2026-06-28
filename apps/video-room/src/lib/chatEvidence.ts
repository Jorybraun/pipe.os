import type { RoomChatMessage, RoomSurface } from '../hooks/useRoomConnection';
import type { RoomPhase } from '../types';

export type ChatEvidenceActor = 'host' | 'guest';

export interface RoomChatEvidence {
  text: string;
  properties: Record<string, unknown>;
}

export function buildRoomChatEvidence(input: {
  message: RoomChatMessage;
  actor: ChatEvidenceActor;
  surface: RoomSurface;
  roomPhase: RoomPhase;
}): RoomChatEvidence {
  return {
    text: input.message.text,
    properties: {
      source: 'room_chat_client_submit',
      chatEventSource: 'browser_room_chat_window',
      actor: input.actor,
      roomMessageId: input.message.id,
      clientId: input.message.clientId,
      messageCreatedAt: input.message.createdAt,
      messageLength: input.message.text.length,
      deliveryStatus: input.message.deliveryStatus ?? 'pending',
      surface: input.surface,
      roomPhase: input.roomPhase,
      durableObjectReplayExpected: true,
    },
  };
}
