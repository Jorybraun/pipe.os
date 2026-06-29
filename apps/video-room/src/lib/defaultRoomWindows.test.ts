import { describe, expect, it } from 'vitest';
import { defaultRoomWindowConfigs } from './defaultRoomWindows';

describe('defaultRoomWindowConfigs', () => {
  it('keeps standard calls focused on video and chat', () => {
    const configs = defaultRoomWindowConfigs({
      mode: 'standard_call',
      workspaceEnabled: false,
      workspaceTitle: null,
    });

    expect(configs.map((config) => config.id)).toEqual(['video', 'chat']);
    expect(configs.some((config) => config.windowType === 'submission')).toBe(false);
  });

  it('makes dev-container assessments code-first with a visible submission path', () => {
    const configs = defaultRoomWindowConfigs({
      mode: 'dev_container_assessment',
      workspaceEnabled: true,
      workspaceTitle: 'https://github.com/cloudflare/workers-sdk',
    });

    expect(configs.map((config) => config.id)).toEqual(['video', 'chat', 'submission', 'workspace']);
    expect(configs[configs.length - 1]).toMatchObject({
      windowType: 'workspace',
      title: 'https://github.com/cloudflare/workers-sdk',
      width: 860,
      height: 610,
    });
    expect(configs.find((config) => config.id === 'submission')).toMatchObject({
      windowType: 'submission',
      minimized: true,
    });
  });
});
