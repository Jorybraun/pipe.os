import { describe, expect, it } from 'vitest';
import { resolveDevContainerApiBase } from './devContainerClient';

describe('resolveDevContainerApiBase', () => {
  it('uses explicit env API base URL when provided', () => {
    expect(resolveDevContainerApiBase('https://api-dev.hire-pipe.com/')).toBe(
      'https://api-dev.hire-pipe.com',
    );
  });

  it('uses same-origin on deployed app hosts so /rpc flows through the app proxy', () => {
    expect(
      resolveDevContainerApiBase(undefined, {
        hostname: 'app-dev.hire-pipe.com',
        origin: 'https://app-dev.hire-pipe.com',
      }),
    ).toBe('https://app-dev.hire-pipe.com');
  });

  it('keeps localhost fallback for local worker development', () => {
    expect(
      resolveDevContainerApiBase(undefined, {
        hostname: 'localhost',
        origin: 'http://localhost:5173',
      }),
    ).toBe('http://localhost:8787');
  });
});
