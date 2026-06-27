import { describe, expect, it } from 'vitest';
import { buildCursorPresenceEvidence, CURSOR_PRESENCE_EVIDENCE_INTERVAL_MS } from './cursorEvidence';

describe('buildCursorPresenceEvidence', () => {
  it('captures the first cursor sample as source-backed presence evidence', () => {
    const evidence = buildCursorPresenceEvidence({
      actor: 'guest',
      position: { x: 0.12345, y: 0.98765 },
      surface: 'win95',
      roomPhase: 'connected',
      capturedAtMs: 1000,
      previous: null,
    });

    expect(evidence).toMatchObject({
      text: 'Guest cursor presence sampled on 95 Until Infinity desktop',
      state: {
        capturedAtMs: 1000,
        x: 0.123,
        y: 0.988,
      },
      properties: {
        source: 'win95_cursor_presence_client_sample',
        surface: 'win95',
        roomPhase: 'connected',
        normalizedX: 0.123,
        normalizedY: 0.988,
        evidenceSampling: 'presence_sample',
        rawCursorMovesPersisted: false,
      },
    });
  });

  it('does not turn high-frequency raw cursor moves into persisted evidence', () => {
    const previous = {
      capturedAtMs: 1000,
      x: 0.1,
      y: 0.1,
    };

    expect(buildCursorPresenceEvidence({
      actor: 'host',
      position: { x: 0.9, y: 0.9 },
      surface: 'win95',
      roomPhase: 'connected',
      capturedAtMs: 1000 + CURSOR_PRESENCE_EVIDENCE_INTERVAL_MS - 1,
      previous,
    })).toBeNull();

    expect(buildCursorPresenceEvidence({
      actor: 'host',
      position: { x: 0.11, y: 0.11 },
      surface: 'win95',
      roomPhase: 'connected',
      capturedAtMs: 1000 + CURSOR_PRESENCE_EVIDENCE_INTERVAL_MS,
      previous,
    })).toBeNull();
  });
});
