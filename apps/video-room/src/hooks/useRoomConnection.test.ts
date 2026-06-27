import { describe, expect, it } from 'vitest';
import { mergePeerCursorPresence, type RoomCursorPresence } from './useRoomConnection';

describe('mergePeerCursorPresence', () => {
  it('keeps one fresh cursor per role and uses receive time for presence expiry', () => {
    const previous: RoomCursorPresence[] = [
      {
        clientId: 'guest-stale',
        role: 'GUEST',
        x: 0.1,
        y: 0.1,
        updatedAt: 900,
      },
      {
        clientId: 'guest-reloaded',
        role: 'GUEST',
        x: 0.2,
        y: 0.2,
        updatedAt: 4900,
      },
      {
        clientId: 'host-live',
        role: 'HOST',
        x: 0.4,
        y: 0.5,
        updatedAt: 4900,
      },
    ];

    const next = mergePeerCursorPresence(
      previous,
      {
        clientId: 'guest-active',
        role: 'GUEST',
        x: 0.7,
        y: 0.8,
        updatedAt: 100,
      },
      5000,
      4000,
    );

    expect(next).toEqual([
      {
        clientId: 'host-live',
        role: 'HOST',
        x: 0.4,
        y: 0.5,
        updatedAt: 4900,
      },
      {
        clientId: 'guest-active',
        role: 'GUEST',
        x: 0.7,
        y: 0.8,
        updatedAt: 5000,
      },
    ]);
  });
});
