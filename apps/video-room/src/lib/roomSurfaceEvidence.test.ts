import { describe, expect, it } from 'vitest';
import {
  buildRoomSurfaceChangeEvidence,
  canControlSharedRoomSurface,
} from './roomSurfaceEvidence';

describe('room surface evidence', () => {
  it('allows both participants to control the shared room surface', () => {
    expect(canControlSharedRoomSurface('HOST')).toBe(true);
    expect(canControlSharedRoomSurface('GUEST')).toBe(true);
  });

  it('builds source-backed evidence for entering 95 Until Infinity', () => {
    expect(buildRoomSurfaceChangeEvidence({
      actor: 'guest',
      previousSurface: 'standard',
      nextSurface: 'win95',
      roomPhase: 'connected',
    })).toEqual({
      text: 'Room surface changed to 95 Until Infinity desktop',
      properties: {
        source: 'room_surface_control',
        actor: 'guest',
        surface: 'win95',
        previousSurface: 'standard',
        action: 'enter_desktop',
        roomPhase: 'connected',
      },
    });
  });

  it('builds source-backed evidence for returning everyone to the standard call', () => {
    expect(buildRoomSurfaceChangeEvidence({
      actor: 'host',
      previousSurface: 'win95',
      nextSurface: 'standard',
      roomPhase: 'connected',
    })).toMatchObject({
      text: 'Room surface changed to standard call',
      properties: {
        source: 'room_surface_control',
        actor: 'host',
        surface: 'standard',
        previousSurface: 'win95',
        action: 'exit_desktop',
      },
    });
  });
});
