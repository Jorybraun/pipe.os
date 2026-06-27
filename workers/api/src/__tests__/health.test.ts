import { describe, expect, it, vi } from 'vitest';
import worker from '../index';

describe('worker health routes', () => {
  it('serves both legacy and api-prefixed health checks', async () => {
    for (const path of ['/health', '/api/health']) {
      const res = await worker.fetch(
        new Request(`http://pipe.test${path}`),
        {} as never,
        {} as never,
      );

      expect(res.status).toBe(200);
      const body = await res.json() as { status?: string; timestamp?: string };
      expect(body.status).toBe('ok');
      expect(typeof body.timestamp).toBe('string');
    }
  });

  it('lets the dev-container bridge reach token-scoped room context without the dev proxy secret', async () => {
    const first = vi.fn(async () => null);
    const bind = vi.fn(() => ({ first }));
    const prepare = vi.fn(() => ({ bind }));

    const res = await worker.fetch(
      new Request('http://pipe.test/api/v1/meeting-rooms/not-a-real-token/context-summary'),
      {
        ENV: 'dev',
        DEV_PROXY_SECRET: 'dev-secret',
        DB: { prepare },
      } as never,
      {} as never,
    );

    expect(res.status).toBe(404);
    expect(prepare).toHaveBeenCalled();
    const body = await res.json() as { error?: { code?: string; message?: string } };
    expect(body.error?.code).toBe('NOT_FOUND');
    expect(body.error?.message).toBe('Room link is invalid or expired.');
  });

  it('still requires the dev proxy secret for non-public api routes in dev', async () => {
    const res = await worker.fetch(
      new Request('http://pipe.test/api/v1/search/candidates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      }),
      {
        ENV: 'dev',
        DEV_PROXY_SECRET: 'dev-secret',
      } as never,
      {} as never,
    );

    expect(res.status).toBe(401);
    const body = await res.json() as { error?: { code?: string } };
    expect(body.error?.code).toBe('DEV_PROXY_REQUIRED');
  });
});
