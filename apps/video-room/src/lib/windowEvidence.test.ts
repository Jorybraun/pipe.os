import { describe, expect, it } from 'vitest';
import {
  buildWindowDataUpdateEvidence,
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
      capturedAtMs: 1000,
    })).toEqual({
      text: 'Microsoft Edge',
      properties: {
        source: 'window_lifecycle_client_submit',
        lifecycleSource: 'win95_desktop_ui',
        lifecycleKind: 'open',
        windowLifecycleId: 'window-lifecycle:guest:1000:open:browser',
        capturedAtMs: 1000,
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
      capturedAtMs: 2000,
    })).toMatchObject({
      text: 'Room Chat',
      properties: {
        source: 'window_lifecycle_client_submit',
        lifecycleKind: 'close',
        lifecycleSource: 'win95_window_chrome',
        windowLifecycleId: 'window-lifecycle:host:2000:close:chat',
        capturedAtMs: 2000,
        actor: 'host',
        windowId: 'chat',
        windowTitle: 'Room Chat',
      },
    });
  });

  it('preserves Clippy as the initiator when an action opens a shared Win95 window', () => {
    expect(buildWindowLifecycleEvidence({
      kind: 'open',
      actor: 'host',
      windowId: 'terminal',
      windowType: 'terminal',
      windowTitle: 'Container terminal',
      source: 'clippy_action',
      surface: 'win95',
      roomPhase: 'connected',
      capturedAtMs: 2500,
    })).toMatchObject({
      text: 'Container terminal',
      properties: {
        source: 'window_lifecycle_client_submit',
        lifecycleKind: 'open',
        lifecycleSource: 'clippy_action',
        windowLifecycleId: 'window-lifecycle:host:2500:open:terminal',
        actor: 'host',
        windowId: 'terminal',
        windowType: 'terminal',
        windowTitle: 'Container terminal',
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
      capturedAtMs: 3000,
    })).toEqual({
      text: 'Window state updated: workspace',
      properties: {
        source: 'window_state_client_submit',
        stateSource: 'win95_window_chrome',
        actor: 'guest',
        windowId: 'workspace',
        action: 'move',
        windowStateChangeId: 'window-state:guest:3000:workspace:move',
        capturedAtMs: 3000,
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
      capturedAtMs: 4000,
    })).toMatchObject({
      properties: {
        action: 'minimize',
        windowStateChangeId: 'window-state:host:4000:chat:minimize',
        capturedAtMs: 4000,
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
      capturedAtMs: 5000,
    })).toBeNull();
  });

  it('builds bounded source-backed evidence for Notepad data changes', () => {
    expect(buildWindowDataUpdateEvidence({
      actor: 'guest',
      windowId: 'notepad',
      data: { text: 'Candidate writes a replay test plan.' },
      surface: 'win95',
      roomPhase: 'connected',
      capturedAtMs: 6000,
    })).toEqual({
      text: 'Window data updated: notepad',
      properties: {
        source: 'window_data_client_submit',
        dataSource: 'win95_window_data_sync',
        actor: 'guest',
        windowId: 'notepad',
        action: 'edit_text',
        windowDataUpdateId: 'window-data:guest:6000:notepad:edit_text',
        capturedAtMs: 6000,
        surface: 'win95',
        roomPhase: 'connected',
        dataKeys: ['text'],
        dataValueFingerprints: { text: 'data_81a94acf' },
        durableObjectReplayExpected: true,
      },
    });
  });

  it('builds bounded source-backed evidence for Paint data changes', () => {
    expect(buildWindowDataUpdateEvidence({
      actor: 'host',
      windowId: 'paint',
      data: {
        strokes: [{
          kind: 'rectangle',
          color: '#111111',
          size: 2,
          start: { x: 1, y: 2 },
          end: { x: 3, y: 4 },
        }],
      },
      surface: 'win95',
      roomPhase: 'connected',
      capturedAtMs: 7000,
    })).toMatchObject({
      text: 'Window data updated: paint',
      properties: {
        action: 'edit_paint',
        windowDataUpdateId: 'window-data:host:7000:paint:edit_paint',
        dataKeys: ['strokes'],
        dataValueFingerprints: { strokes: 'data_44b27bb4' },
      },
    });
  });

  it('returns null for empty window data patches', () => {
    expect(buildWindowDataUpdateEvidence({
      actor: 'host',
      windowId: 'paint',
      data: {},
      surface: 'win95',
      roomPhase: 'connected',
      capturedAtMs: 8000,
    })).toBeNull();
  });
});
