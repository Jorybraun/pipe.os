import { describe, it, expect } from 'vitest';
import { signJwt, verifyJwt } from '../jwt';

const SECRET = 'test-secret';

describe('jwt', () => {
  it('round-trips a token with a pipeline id', async () => {
    const token = await signJwt({ sub: 'cand-1', pid: 'pipe-1' }, SECRET);
    const payload = await verifyJwt(token, SECRET);
    expect(payload).toMatchObject({ sub: 'cand-1', pid: 'pipe-1' });
  });

  it('round-trips a token with a null pipeline id (standalone candidate)', async () => {
    const token = await signJwt({ sub: 'cand-2', pid: null }, SECRET);
    const payload = await verifyJwt(token, SECRET);
    expect(payload).toMatchObject({ sub: 'cand-2', pid: null });
  });

  it('round-trips the optional invite token claim marker', async () => {
    const token = await signJwt({ sub: 'cand-2', pid: null, itk: 'invite-token-1' }, SECRET);
    const payload = await verifyJwt(token, SECRET);
    expect(payload).toMatchObject({ sub: 'cand-2', pid: null, itk: 'invite-token-1' });
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await signJwt({ sub: 'cand-3', pid: null }, 'other-secret');
    expect(await verifyJwt(token, SECRET)).toBeNull();
  });

  it('rejects an expired token unless ignoreExpiry is set', async () => {
    const token = await signJwt({ sub: 'cand-4', pid: null }, SECRET, -10);
    expect(await verifyJwt(token, SECRET)).toBeNull();
    expect(await verifyJwt(token, SECRET, true)).toMatchObject({ sub: 'cand-4' });
  });
});
