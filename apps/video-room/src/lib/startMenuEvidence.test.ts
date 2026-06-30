import { describe, expect, it } from 'vitest';
import { buildStartMenuStateEvidence } from './startMenuEvidence';

describe('buildStartMenuStateEvidence', () => {
  it('creates source-backed evidence for opening the Win95 Start menu', () => {
    const evidence = buildStartMenuStateEvidence({
      actor: 'guest',
      open: true,
      eventSource: 'win95_start_button',
      surface: 'win95',
      roomPhase: 'connected',
      capturedAtMs: 1782601600000,
    });

    expect(evidence).toEqual({
      text: 'Start menu opened',
      properties: {
        source: 'win95_start_menu_control',
        menuEventSource: 'win95_start_button',
        actor: 'guest',
        menuId: 'start',
        action: 'open',
        open: true,
        startMenuEventId: 'start-menu:guest:1782601600000:open:win95_start_button',
        capturedAtMs: 1782601600000,
        surface: 'win95',
        roomPhase: 'connected',
        durableObjectReplayExpected: true,
      },
    });
  });

  it('records close provenance separately from open provenance', () => {
    const evidence = buildStartMenuStateEvidence({
      actor: 'host',
      open: false,
      eventSource: 'win95_desktop_click',
      surface: 'win95',
      roomPhase: 'connected',
      capturedAtMs: 1782601605000,
    });

    expect(evidence.text).toBe('Start menu closed');
    expect(evidence.properties).toMatchObject({
      menuEventSource: 'win95_desktop_click',
      action: 'close',
      open: false,
      startMenuEventId: 'start-menu:host:1782601605000:close:win95_desktop_click',
    });
  });
});
