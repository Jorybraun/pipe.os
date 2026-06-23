import { describe, expect, it } from 'vitest';
import { shouldUseCloudflareDevContainers } from '../useDevContainerSession';

describe('shouldUseCloudflareDevContainers', () => {
  it('honors explicit true and false flags', () => {
    expect(shouldUseCloudflareDevContainers('true', 'localhost')).toBe(true);
    expect(shouldUseCloudflareDevContainers('false', 'app-dev.hire-pipe.com')).toBe(false);
  });

  it('defaults deployed PIPE app hosts to the Cloudflare container backend', () => {
    expect(shouldUseCloudflareDevContainers('', 'app-dev.hire-pipe.com')).toBe(true);
    expect(shouldUseCloudflareDevContainers(undefined, 'app.hire-pipe.com')).toBe(true);
  });

  it('keeps local development on the legacy backend unless explicitly enabled', () => {
    expect(shouldUseCloudflareDevContainers('', 'localhost')).toBe(false);
    expect(shouldUseCloudflareDevContainers(undefined, '127.0.0.1')).toBe(false);
  });
});
