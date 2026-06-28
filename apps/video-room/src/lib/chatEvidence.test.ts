import { describe, expect, it } from 'vitest';
import { buildRoomChatEvidence } from './chatEvidence';

describe('chat evidence', () => {
  it('builds source-backed room chat evidence from the shared message identity', () => {
    expect(buildRoomChatEvidence({
      actor: 'guest',
      surface: 'win95',
      roomPhase: 'connected',
      message: {
        id: 'chat-message-1',
        clientId: 'browser-client-1',
        createdAt: 1782602000000,
        role: 'GUEST',
        text: 'I think the retry test should fail before the fix.',
        deliveryStatus: 'pending',
      },
    })).toEqual({
      text: 'I think the retry test should fail before the fix.',
      properties: {
        source: 'room_chat_client_submit',
        chatEventSource: 'browser_room_chat_window',
        actor: 'guest',
        roomMessageId: 'chat-message-1',
        clientId: 'browser-client-1',
        messageCreatedAt: 1782602000000,
        messageLength: 50,
        deliveryStatus: 'pending',
        surface: 'win95',
        roomPhase: 'connected',
        durableObjectReplayExpected: true,
      },
    });
  });
});
