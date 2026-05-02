import { describe, it, expect, vi } from 'vitest';
import { retryWithBackoff, classifyError } from '../retryHelper';

describe('classifyError', () => {
  it('classifies network errors as transient', () => {
    expect(classifyError(new Error('Network error'))).toBe('transient');
    expect(classifyError(new Error('Connection timeout'))).toBe('transient');
    expect(classifyError(new Error('fetch failed'))).toBe('transient');
    expect(classifyError(new Error('ECONNREFUSED'))).toBe('transient');
    expect(classifyError(new Error('ETIMEDOUT'))).toBe('transient');
    expect(classifyError(new Error('ENOTFOUND'))).toBe('transient');
  });

  it('classifies 5xx and 429 as transient', () => {
    expect(classifyError({ status: 500 })).toBe('transient');
    expect(classifyError({ status: 503 })).toBe('transient');
    expect(classifyError({ statusCode: 429 })).toBe('transient');
    expect(classifyError({ code: '502' })).toBe('transient');
  });

  it('classifies 4xx as fatal', () => {
    expect(classifyError({ status: 400 })).toBe('fatal');
    expect(classifyError({ status: 404 })).toBe('fatal');
    expect(classifyError({ statusCode: '403' })).toBe('fatal');
  });

  it('classifies unknown errors as transient', () => {
    expect(classifyError(new Error('Something went wrong'))).toBe('transient');
    expect(classifyError(null)).toBe('transient');
    expect(classifyError(undefined)).toBe('transient');
  });
});

describe('retryWithBackoff', () => {
  it('returns result on first success', async () => {
    const result = await retryWithBackoff(() => 'ok');
    expect(result).toBe('ok');
  });

  it('retries until success', async () => {
    let calls = 0;
    const result = await retryWithBackoff(() => {
      calls++;
      if (calls < 3) throw new Error('fail');
      return 'ok';
    }, { baseDelayMs: 5, maxRetries: 3 });
    expect(calls).toBe(3);
    expect(result).toBe('ok');
  });

  it('throws after maxRetries exhausted', async () => {
    let calls = 0;
    await expect(
      retryWithBackoff(() => {
        calls++;
        throw new Error('fail');
      }, { baseDelayMs: 5, maxRetries: 2 })
    ).rejects.toThrow('fail');
    expect(calls).toBe(3); // initial + 2 retries
  });

  it('throws fatal errors immediately without retry', async () => {
    let calls = 0;
    const fatalErr = Object.assign(new Error('bad request'), { status: 400 });
    await expect(
      retryWithBackoff(() => {
        calls++;
        throw fatalErr;
      }, { baseDelayMs: 5, maxRetries: 3 })
    ).rejects.toThrow('bad request');
    expect(calls).toBe(1);
  });

  it('calls onRetry before each retry with attempt and delay', async () => {
    const onRetry = vi.fn();
    let calls = 0;
    await retryWithBackoff(() => {
      calls++;
      if (calls < 3) throw new Error('fail');
      return 'ok';
    }, { baseDelayMs: 5, maxRetries: 3, onRetry });

    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenNthCalledWith(1, 1, expect.any(Number));
    expect(onRetry).toHaveBeenNthCalledWith(2, 2, expect.any(Number));
    const firstDelay = onRetry.mock.calls[0][1];
    expect(firstDelay).toBeGreaterThanOrEqual(2);
    expect(firstDelay).toBeLessThanOrEqual(10);
  });

  it('calls onCircuitOpen when fatal error occurs', async () => {
    const onCircuitOpen = vi.fn();
    const fatalErr = Object.assign(new Error('bad request'), { status: 400 });
    await expect(
      retryWithBackoff(() => {
        throw fatalErr;
      }, { baseDelayMs: 5, maxRetries: 3, onCircuitOpen })
    ).rejects.toThrow('bad request');
    expect(onCircuitOpen).toHaveBeenCalledTimes(1);
    expect(onCircuitOpen).toHaveBeenCalledWith(fatalErr);
  });

  it('calls onCircuitOpen when retries are exhausted', async () => {
    const onCircuitOpen = vi.fn();
    const err = new Error('fail');
    await expect(
      retryWithBackoff(() => {
        throw err;
      }, { baseDelayMs: 5, maxRetries: 1, onCircuitOpen })
    ).rejects.toThrow('fail');
    expect(onCircuitOpen).toHaveBeenCalledTimes(1);
    expect(onCircuitOpen).toHaveBeenCalledWith(err);
  });

  it('supports synchronous functions', async () => {
    const result = await retryWithBackoff(() => 42);
    expect(result).toBe(42);
  });

  it('supports async functions', async () => {
    const result = await retryWithBackoff(async () => Promise.resolve('async-ok'));
    expect(result).toBe('async-ok');
  });
});
