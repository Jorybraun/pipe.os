import { describe, expect, it } from 'vitest';
import { buildWindowStateUpdateEvidence } from './windowEvidence';

describe('window evidence', () => {
  it('builds direct source-backed evidence for Win95 window movement', () => {
    expect(buildWindowStateUpdateEvidence({
      actor: 'guest',
      windowId: 'workspace',
      patch: { x: 120, y: 80, ignored: 'nope' },
      surface: 'win95',
      roomPhase: 'connected',
    })).toEqual({
      text: 'Window state updated: workspace',
      properties: {
        source: 'window_state_client_submit',
        actor: 'guest',
        windowId: 'workspace',
        action: 'move',
        surface: 'win95',
        roomPhase: 'connected',
        statePatch: { x: 120, y: 80 },
        stateKeys: ['x', 'y'],
        durableObjectReplayExpected: true,
      },
    });
  });

  it('captures minimize/focus state without unsupported properties', () => {
    expect(buildWindowStateUpdateEvidence({
      actor: 'host',
      windowId: 'chat',
      patch: { minimized: true, focused: false, title: 'Chat' },
      surface: 'win95',
      roomPhase: 'connected',
    })).toMatchObject({
      properties: {
        action: 'minimize',
        statePatch: { minimized: true, focused: false },
        stateKeys: ['focused', 'minimized'],
      },
    });
  });

  it('returns null when there is no durable state patch', () => {
    expect(buildWindowStateUpdateEvidence({
      actor: 'host',
      windowId: 'chat',
      patch: { title: 'Chat' },
      surface: 'win95',
      roomPhase: 'connected',
    })).toBeNull();
  });
});
