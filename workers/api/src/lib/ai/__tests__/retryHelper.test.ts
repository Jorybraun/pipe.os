import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { retryWithBackoff, classifyError } from '../retryHelper';

describe('retryWithBackoff', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns immediately on success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const promise = retryWithBackoff(fn);
    await expect(promise).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries up to 3 times and succeeds on the last attempt', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockRejectedValueOnce(new Error('fail 3'))
      .mockResolvedValue('success');

    const onRetry = vi.fn();

    const promise = retryWithBackoff(fn, { maxRetries: 3, baseDelayMs: 1000, onRetry });

    await vi.advanceTimersByTimeAsync(0); // attempt 0
    await vi.advanceTimersByTimeAsync(2000); // attempt 1
    await vi.advanceTimersByTimeAsync(4000); // attempt 2
    await vi.advanceTimersByTimeAsync(8000); // attempt 3

    await expect(promise).resolves.toBe('success');
    expect(fn).toHaveBeenCalledTimes(4);
    expect(onRetry).toHaveBeenCalledTimes(3);
  });

  it('throws after exhausting maxRetries', async () => {
    const err = new Error('persistent failure');
    const fn = vi.fn().mockImplementation(async () => { throw err; });
    const onCircuitOpen = vi.fn();

    const promise = retryWithBackoff(fn, { maxRetries: 3, baseDelayMs: 1000, onCircuitOpen });

    await vi.runAllTimersAsync();

    await expect(promise).rejects.toThrow('persistent failure');
    expect(fn).toHaveBeenCalledTimes(4);
    expect(onCircuitOpen).toHaveBeenCalledTimes(1);
    expect(onCircuitOpen).toHaveBeenCalledWith(err);
  });

  it('backs off exponentially with jitter', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fail'));
    const onRetry = vi.fn();

    // Fix Math.random to a known value so jitter is deterministic
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const promise = retryWithBackoff(fn, { maxRetries: 3, baseDelayMs: 1000, onRetry });

    await vi.runAllTimersAsync();
    await expect(promise).rejects.toThrow('fail');

    expect(onRetry).toHaveBeenNthCalledWith(1, 1, 750);
    expect(onRetry).toHaveBeenNthCalledWith(2, 2, 1500);
    expect(onRetry).toHaveBeenNthCalledWith(3, 3, 3000);

    randomSpy.mockRestore();
  });

  it('applies jitter within [0.5x, 1.0x] of nominal delay', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fail'));
    const delays: number[] = [];

    const onRetry = (_attempt: number, delay: number) => {
      delays.push(delay);
    };

    const promise = retryWithBackoff(fn, { maxRetries: 3, baseDelayMs: 1000, onRetry });

    await vi.runAllTimersAsync();
    await expect(promise).rejects.toThrow('fail');

    // Nominal delays for attempts 0,1,2 are 1000, 2000, 4000
    expect(delays[0]).toBeGreaterThanOrEqual(500);
    expect(delays[0]).toBeLessThanOrEqual(1000);
    expect(delays[1]).toBeGreaterThanOrEqual(1000);
    expect(delays[1]).toBeLessThanOrEqual(2000);
    expect(delays[2]).toBeGreaterThanOrEqual(2000);
    expect(delays[2]).toBeLessThanOrEqual(4000);
  });

  it('logs retry attempts with standard format', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValue('ok');

    const promise = retryWithBackoff(fn, {
      maxRetries: 1,
      baseDelayMs: 1000,
      onRetry: (attempt, delay) =>
        console.warn(`[retry] attempt ${attempt} after ${delay}ms delay for myFunction`),
    });

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(2000);

    await expect(promise).resolves.toBe('ok');
    expect(consoleWarn).toHaveBeenCalledWith(
      expect.stringMatching(/^\[retry\] attempt \d+ after \d+ms delay for myFunction$/),
    );
    consoleWarn.mockRestore();
  });

  it('does not retry fatal errors (400)', async () => {
    const err = Object.assign(new Error('bad request'), { status: 400 });
    const fn = vi.fn().mockRejectedValue(err);
    const onCircuitOpen = vi.fn();

    await expect(retryWithBackoff(fn, { maxRetries: 3, onCircuitOpen })).rejects.toThrow('bad request');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(onCircuitOpen).toHaveBeenCalledTimes(1);
  });

  it('does not retry fatal errors (404)', async () => {
    const err = Object.assign(new Error('not found'), { status: 404 });
    const fn = vi.fn().mockRejectedValue(err);

    await expect(retryWithBackoff(fn, { maxRetries: 3 })).rejects.toThrow('not found');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('classifyError', () => {
  it('classifies 400/404/403 as fatal', () => {
    expect(classifyError({ status: 400 })).toBe('fatal');
    expect(classifyError({ status: 404 })).toBe('fatal');
    expect(classifyError({ statusCode: 404 })).toBe('fatal');
    expect(classifyError({ statusCode: '403' })).toBe('fatal');
    expect(classifyError({ code: '403' })).toBe('fatal');
  });

  it('classifies everything else as transient', () => {
    expect(classifyError({ status: 500 })).toBe('transient');
    expect(classifyError({ status: 429 })).toBe('transient');
    expect(classifyError(null)).toBe('transient');
    expect(classifyError(new Error('network'))).toBe('transient');
  });
});
