import { describe, expect, it } from 'vitest';
import { buildRoomChatEvidence, roomChatMessageFingerprint } from './chatEvidence';

describe('chat evidence', () => {
  it('builds source-backed room chat evidence from the shared message identity', () => {
    expect(buildRoomChatEvidence({
      actor: 'guest',
      surface: 'standard',
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
        chatEventSource: 'browser_room_chat_panel',
        actor: 'guest',
        roomMessageId: 'chat-message-1',
        clientId: 'browser-client-1',
        messageCreatedAt: 1782602000000,
        messageLength: 50,
        messageFingerprint: roomChatMessageFingerprint('I think the retry test should fail before the fix.'),
        deliveryStatus: 'pending',
        surface: 'standard',
        roomPhase: 'connected',
        durableObjectReplayExpected: true,
      },
    });
  });

  it('preserves accepted and rejected delivery outcomes as source-backed chat evidence', () => {
    const baseMessage = {
      id: 'chat-message-2',
      clientId: 'browser-client-2',
      createdAt: 1782603000000,
      role: 'HOST' as const,
      text: 'The patch is ready for review.',
      evidence: {
        source: 'room_chat_client_submit',
        chatEventSource: 'browser_room_chat_panel',
        actor: 'host',
        surface: 'standard',
        roomPhase: 'connected',
        durableObjectReplayExpected: true,
      },
    };

    expect(buildRoomChatEvidence({
      actor: 'host',
      surface: 'standard',
      roomPhase: 'connected',
      message: {
        ...baseMessage,
        deliveryStatus: 'accepted',
        evidence: {
          ...baseMessage.evidence,
          roomMessageId: baseMessage.id,
          clientId: baseMessage.clientId,
          messageCreatedAt: baseMessage.createdAt,
          messageLength: baseMessage.text.length,
          deliveryStatus: 'accepted',
        },
      },
    }).properties).toMatchObject({
      roomMessageId: 'chat-message-2',
      clientId: 'browser-client-2',
      messageCreatedAt: 1782603000000,
      messageLength: 'The patch is ready for review.'.length,
      messageFingerprint: roomChatMessageFingerprint('The patch is ready for review.'),
      deliveryStatus: 'accepted',
      durableObjectReplayExpected: true,
    });

    expect(buildRoomChatEvidence({
      actor: 'host',
      surface: 'standard',
      roomPhase: 'connected',
      message: {
        ...baseMessage,
        deliveryStatus: 'rejected',
        evidence: {
          ...baseMessage.evidence,
          deliveryStatus: 'rejected',
        },
      },
    }).properties).toMatchObject({
      roomMessageId: 'chat-message-2',
      clientId: 'browser-client-2',
      messageCreatedAt: 1782603000000,
      messageLength: 'The patch is ready for review.'.length,
      messageFingerprint: roomChatMessageFingerprint('The patch is ready for review.'),
      deliveryStatus: 'rejected',
      durableObjectReplayExpected: true,
    });
  });
});
