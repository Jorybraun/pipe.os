import { describe, expect, it } from 'vitest';
import { getSchedulingOAuthRedirectUri } from './oauthRedirect';

describe('getSchedulingOAuthRedirectUri', () => {
  it('keeps localhost callbacks canonical for local OAuth providers', () => {
    expect(getSchedulingOAuthRedirectUri({
      protocol: 'http:',
      hostname: '127.0.0.1',
      port: '5173',
      origin: 'http://127.0.0.1:5173',
    })).toBe('http://localhost:5173/interviews');

    expect(getSchedulingOAuthRedirectUri({
      protocol: 'http:',
      hostname: '[::1]',
      port: '5173',
      origin: 'http://[::1]:5173',
    })).toBe('http://localhost:5173/interviews');
  });

  it('preserves non-local origins', () => {
    expect(getSchedulingOAuthRedirectUri({
      protocol: 'https:',
      hostname: 'app.pipe.test',
      port: '',
      origin: 'https://app.pipe.test',
    })).toBe('https://app.pipe.test/interviews');
  });
});
