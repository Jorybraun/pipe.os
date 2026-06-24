import { describe, expect, it, vi } from 'vitest';
import { D1Client } from './d1Client';

function okResponse(rows: unknown[] = [{ one: 1 }]): Response {
  return new Response(JSON.stringify({
    success: true,
    result: [{ success: true, results: rows }],
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('D1Client', () => {
  it('sends a bounded abort signal with each REST query', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return okResponse();
    }) as typeof fetch;
    const client = new D1Client({
      accountId: 'acct',
      apiToken: 'token',
      databaseId: 'db',
    }, {
      fetchImpl,
      requestTimeoutMs: 1234,
    });

    await expect(client.query<{ one: number }>('SELECT 1')).resolves.toEqual([{ one: 1 }]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('retries timeout-shaped fetch failures', async () => {
    const fetchImpl = vi.fn(async () => {
      if (fetchImpl.mock.calls.length === 1) {
        throw new Error('fetch timeout');
      }
      return okResponse([{ two: 2 }]);
    }) as unknown as typeof fetch;
    const client = new D1Client({
      accountId: 'acct',
      apiToken: 'token',
      databaseId: 'db',
    }, {
      fetchImpl,
      requestTimeoutMs: 1,
    });

    await expect(client.query<{ two: number }>('SELECT 2')).resolves.toEqual([{ two: 2 }]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
