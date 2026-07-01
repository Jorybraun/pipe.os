import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { defaultRoomSurfaceConfigs } from './defaultRoomSurfaces';

const roomRoot = process.cwd().endsWith('/apps/video-room')
  ? process.cwd()
  : join(process.cwd(), 'apps/video-room');

describe('assessment room identity', () => {
  it('ships PIPE assessment-room metadata', async () => {
    const [html, packageJson] = await Promise.all([
      readFile(join(roomRoot, 'index.html'), 'utf8'),
      readFile(join(roomRoot, 'package.json'), 'utf8'),
    ]);

    expect(html).toContain('<title>PIPE Assessment Room</title>');
    expect(html).toContain('content="PIPE Assessment Room"');
    expect(JSON.parse(packageJson)).toMatchObject({
      name: 'pipe-assessment-room',
    });
  });

  it('keeps the default room surfaces focused on assessment work', () => {
    const standard = defaultRoomSurfaceConfigs({
      mode: 'standard_call',
      workspaceEnabled: false,
      workspaceTitle: null,
    });
    const workspace = defaultRoomSurfaceConfigs({
      mode: 'dev_container_assessment',
      workspaceEnabled: true,
      workspaceTitle: 'https://github.com/cloudflare/workers-sdk',
    });

    expect(standard.map((surface) => surface.title)).toEqual(['Video Call', 'Room Chat']);
    expect(workspace.map((surface) => surface.title)).toEqual([
      'Video Call',
      'Room Chat',
      'Submit Work',
      'Container Terminal',
      'https://github.com/cloudflare/workers-sdk',
    ]);
  });
});
