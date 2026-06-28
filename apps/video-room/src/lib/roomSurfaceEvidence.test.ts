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
      capturedAtMs: 1000,
    })).toEqual({
      text: 'Room surface changed to 95 Until Infinity desktop',
      properties: {
        source: 'room_surface_control',
        surfaceControlEventSource: 'browser_room_surface_toggle',
        actor: 'guest',
        surfaceChangeId: 'surface:guest:1000:standard:win95',
        capturedAtMs: 1000,
        surface: 'win95',
        previousSurface: 'standard',
        action: 'enter_desktop',
        roomPhase: 'connected',
        durableObjectReplayExpected: true,
      },
    });
  });

  it('builds source-backed evidence for returning everyone to the standard call', () => {
    expect(buildRoomSurfaceChangeEvidence({
      actor: 'host',
      previousSurface: 'win95',
      nextSurface: 'standard',
      roomPhase: 'connected',
      capturedAtMs: 2000,
    })).toMatchObject({
      text: 'Room surface changed to standard call',
      properties: {
        source: 'room_surface_control',
        surfaceControlEventSource: 'browser_room_surface_toggle',
        actor: 'host',
        surfaceChangeId: 'surface:host:2000:win95:standard',
        capturedAtMs: 2000,
        surface: 'standard',
        previousSurface: 'win95',
        action: 'exit_desktop',
        durableObjectReplayExpected: true,
      },
    });
  });
});
