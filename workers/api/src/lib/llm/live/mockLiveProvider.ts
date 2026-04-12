/**
 * MockLiveProvider — deterministic in-memory LiveProvider for Vitest.
 *
 * No real network calls. Useful for unit-testing code that depends on
 * LiveProvider without spinning up a Gemini / OpenAI Realtime session.
 *
 * Behaviour of MockLiveSession:
 *  - sendAudio(chunk)    → after 200 ms: emit 32 silent PCM16 bytes via
 *                          onAudio handlers, then emit a scripted transcript
 *                          via onTranscript handlers.
 *  - triggerError(err)   → call every registered onError handler immediately.
 *  - close()             → clear all handler lists; subsequent calls are no-ops.
 */

import type { LiveProvider, LiveSession, LiveSessionConfig } from './types.js';

// ─── Silent PCM16 stub ────────────────────────────────────────────────────────

/** 32 zero bytes — valid (silent) PCM16 audio, cheap to allocate. */
function silentPcm16(): ArrayBuffer {
  return new ArrayBuffer(32);
}

// ─── Scripted transcript ──────────────────────────────────────────────────────

const MOCK_TRANSCRIPT_TEXT = 'I heard you. Tell me more about the role.';
const MOCK_TRANSCRIPT_ROLE = 'model' as const;

// ─── Session ──────────────────────────────────────────────────────────────────

export class MockLiveSession implements LiveSession {
  private audioHandlers: Array<(chunk: ArrayBuffer) => void> = [];
  private transcriptHandlers: Array<(text: string, role: 'user' | 'model') => void> = [];
  private errorHandlers: Array<(err: Error) => void> = [];

  /** Whether close() has been called. Prevents handlers being registered post-close. */
  private closed = false;

  // ─── LiveSession implementation ─────────────────────────────────────────────

  sendAudio(_chunk: ArrayBuffer): void {
    if (this.closed) return;

    setTimeout(() => {
      if (this.closed) return;

      const silent = silentPcm16();
      for (const handler of this.audioHandlers) {
        handler(silent);
      }

      for (const handler of this.transcriptHandlers) {
        handler(MOCK_TRANSCRIPT_TEXT, MOCK_TRANSCRIPT_ROLE);
      }
    }, 200);
  }

  onAudio(handler: (chunk: ArrayBuffer) => void): void {
    if (this.closed) return;
    this.audioHandlers.push(handler);
  }

  onTranscript(handler: (text: string, role: 'user' | 'model') => void): void {
    if (this.closed) return;
    this.transcriptHandlers.push(handler);
  }

  onError(handler: (err: Error) => void): void {
    if (this.closed) return;
    this.errorHandlers.push(handler);
  }

  close(): void {
    this.closed = true;
    this.audioHandlers = [];
    this.transcriptHandlers = [];
    this.errorHandlers = [];
  }

  // ─── Test-only escape hatch ──────────────────────────────────────────────────

  /**
   * Immediately invoke all registered onError handlers.
   * Use this in Vitest tests that need to exercise error paths.
   */
  triggerError(err: Error): void {
    for (const handler of this.errorHandlers) {
      handler(err);
    }
  }
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export class MockLiveProvider implements LiveProvider {
  readonly name = 'mock';

  openSession(_config: LiveSessionConfig): MockLiveSession {
    return new MockLiveSession();
  }
}
