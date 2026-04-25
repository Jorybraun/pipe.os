/**
 * Unit tests for computeCallCost in pricing.ts
 */

import { describe, it, expect } from 'vitest';
import { computeCallCost } from '../pricing';

describe('computeCallCost', () => {
  // ── Gemma 4: token-based pricing ────────────────────────────────────────────

  it('computes cost for Gemma 4 with input and output tokens', () => {
    // 10_000 input at $0.10/M = 0.00001 * 0.10 = 0.000001
    // 5_000 output at $0.30/M = 0.000005 * 0.30 = 0.0000015
    // total = 0.0000025
    const expected = (10_000 / 1_000_000) * 0.10 + (5_000 / 1_000_000) * 0.30;
    const result = computeCallCost('@cf/google/gemma-4-26b-a4b-it', {
      inputTokens: 10_000,
      outputTokens: 5_000,
    });
    expect(result).toBeCloseTo(expected, 10);
  });

  it('returns 0 for Gemma 4 with empty usage object', () => {
    const result = computeCallCost('@cf/google/gemma-4-26b-a4b-it', {});
    expect(result).toBe(0);
  });

  it('handles only input tokens (no output)', () => {
    const expected = (100_000 / 1_000_000) * 0.10;
    const result = computeCallCost('@cf/google/gemma-4-26b-a4b-it', {
      inputTokens: 100_000,
    });
    expect(result).toBeCloseTo(expected, 10);
  });

  it('handles only output tokens (no input)', () => {
    const expected = (50_000 / 1_000_000) * 0.30;
    const result = computeCallCost('@cf/google/gemma-4-26b-a4b-it', {
      outputTokens: 50_000,
    });
    expect(result).toBeCloseTo(expected, 10);
  });

  it('handles missing inputTokens and outputTokens gracefully (empty object)', () => {
    // Same as empty usage — no tokens → zero cost
    const result = computeCallCost('@cf/google/gemma-4-26b-a4b-it', {});
    expect(result).toBe(0);
  });

  // ── Whisper: audio-based pricing ────────────────────────────────────────────

  it('computes cost for Whisper with exactly 60 audio seconds', () => {
    // 60 seconds / 60 = 1 minute * $0.0005 = $0.0005
    const expected = (60 / 60) * 0.0005;
    const result = computeCallCost('@cf/openai/whisper-large-v3-turbo', {
      audioSeconds: 60,
    });
    expect(result).toBeCloseTo(expected, 10);
    expect(result).toBeCloseTo(0.0005, 10);
  });

  it('computes cost for Whisper with 30 audio seconds', () => {
    const expected = (30 / 60) * 0.0005;
    const result = computeCallCost('@cf/openai/whisper-large-v3-turbo', {
      audioSeconds: 30,
    });
    expect(result).toBeCloseTo(expected, 10);
  });

  it('returns 0 for Whisper with no audioSeconds', () => {
    const result = computeCallCost('@cf/openai/whisper-large-v3-turbo', {});
    expect(result).toBe(0);
  });

  // ── Unknown model guard ──────────────────────────────────────────────────────

  it('throws for an unknown model', () => {
    expect(() =>
      computeCallCost('totally-unknown-model-xyz', { inputTokens: 100 }),
    ).toThrow('Unknown model');
  });

  it('throws with the model name in the error message', () => {
    const model = 'gpt-4-not-in-table';
    expect(() => computeCallCost(model, {})).toThrow(model);
  });

  it('throws with "add entry to MODEL_PRICING" hint', () => {
    expect(() =>
      computeCallCost('mystery-model', { inputTokens: 1000 }),
    ).toThrow('add entry to MODEL_PRICING');
  });
});
