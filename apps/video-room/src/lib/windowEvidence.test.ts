import { describe, expect, it } from 'vitest';
import {
  buildWindowLifecycleEvidence,
  buildWindowStateUpdateEvidence,
} from './windowEvidence';

describe('window evidence', () => {
  it('builds direct source-backed evidence for opening a shared Win95 window', () => {
    expect(buildWindowLifecycleEvidence({
      kind: 'open',
      actor: 'guest',
      windowId: 'browser',
      windowType: 'browser',
      windowTitle: 'Microsoft Edge',
      source: 'win95_desktop_ui',
      surface: 'win95',
      roomPhase: 'connected',
    })).toEqual({
      text: 'Microsoft Edge',
      properties: {
        source: 'window_lifecycle_client_submit',
        lifecycleSource: 'win95_desktop_ui',
        lifecycleKind: 'open',
        actor: 'guest',
        windowId: 'browser',
        windowType: 'browser',
        windowTitle: 'Microsoft Edge',
        surface: 'win95',
        roomPhase: 'connected',
        durableObjectReplayExpected: true,
      },
    });
  });

  it('builds direct source-backed evidence for closing a shared Win95 window', () => {
    expect(buildWindowLifecycleEvidence({
      kind: 'close',
      actor: 'host',
      windowId: 'chat',
      windowType: 'chat',
      windowTitle: 'Room Chat',
      source: 'win95_window_chrome',
      surface: 'win95',
      roomPhase: 'connected',
    })).toMatchObject({
      text: 'Room Chat',
      properties: {
        source: 'window_lifecycle_client_submit',
        lifecycleKind: 'close',
        lifecycleSource: 'win95_window_chrome',
        actor: 'host',
        windowId: 'chat',
        windowTitle: 'Room Chat',
      },
    });
  });

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
        stateSource: 'win95_window_chrome',
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
