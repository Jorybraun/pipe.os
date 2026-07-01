import { describe, expect, it } from 'vitest';
import { defaultRoomSurfaceConfigs } from './defaultRoomSurfaces';

describe('defaultRoomSurfaceConfigs', () => {
  it('keeps standard calls limited to video and chat panels', () => {
    const configs = defaultRoomSurfaceConfigs({
      mode: 'standard_call',
      workspaceEnabled: false,
      workspaceTitle: null,
    });

    expect(configs.map((config) => config.id)).toEqual(['video', 'chat']);
    expect(configs.some((config) => config.surfaceType === 'submission')).toBe(false);
  });

  it('makes dev-container assessments code-first with a visible submission path', () => {
    const configs = defaultRoomSurfaceConfigs({
      mode: 'dev_container_assessment',
      workspaceEnabled: true,
      workspaceTitle: 'https://github.com/cloudflare/workers-sdk',
    });

    expect(configs.map((config) => config.id)).toEqual(['video', 'chat', 'submission', 'workspace']);
    expect(configs[configs.length - 1]).toMatchObject({
      surfaceType: 'workspace',
      title: 'https://github.com/cloudflare/workers-sdk',
      active: true,
    });
    expect(configs.find((config) => config.id === 'submission')).toMatchObject({
      surfaceType: 'submission',
      active: false,
    });
  });
});
