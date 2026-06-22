import { describe, expect, it } from 'vitest';
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
});
