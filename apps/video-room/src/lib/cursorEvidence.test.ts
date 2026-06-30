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
        cursorEventSource: 'browser_win95_desktop_pointermove',
        actor: 'guest',
        cursorSampleId: 'cursor:guest:1000:123:988',
        sampledAtMs: 1000,
        surface: 'win95',
        roomPhase: 'connected',
        normalizedX: 0.123,
        normalizedY: 0.988,
        previousNormalizedX: null,
        previousNormalizedY: null,
        distanceFromPrevious: null,
        evidenceSampling: 'presence_sample',
        sampleIntervalMs: CURSOR_PRESENCE_EVIDENCE_INTERVAL_MS,
        movementThreshold: 0.03,
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

  it('captures movement provenance only after the sampling interval and movement threshold pass', () => {
    const previous = {
      capturedAtMs: 1000,
      x: 0.1,
      y: 0.1,
    };

    const evidence = buildCursorPresenceEvidence({
      actor: 'host',
      position: { x: 0.2, y: 0.2 },
      surface: 'win95',
      roomPhase: 'connected',
      capturedAtMs: 1000 + CURSOR_PRESENCE_EVIDENCE_INTERVAL_MS,
      previous,
    });

    expect(evidence).toMatchObject({
      state: {
        capturedAtMs: 1000 + CURSOR_PRESENCE_EVIDENCE_INTERVAL_MS,
        x: 0.2,
        y: 0.2,
      },
      properties: {
        actor: 'host',
        cursorSampleId: 'cursor:host:16000:200:200',
        sampledAtMs: 16000,
        previousNormalizedX: 0.1,
        previousNormalizedY: 0.1,
        distanceFromPrevious: 0.141,
      },
    });
  });
});
