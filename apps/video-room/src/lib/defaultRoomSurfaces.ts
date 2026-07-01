import type { OpenToolSurfaceConfig } from '../hooks/useToolSurfaceManager';

export type DefaultRoomSurfaceConfig = OpenToolSurfaceConfig & { id: string };
export type DefaultRoomSurfaceMode = 'standard_call' | 'code_review' | 'dev_container_assessment';

interface DefaultRoomSurfaceInput {
  mode: DefaultRoomSurfaceMode;
  workspaceEnabled: boolean;
  workspaceTitle?: string | null;
}

export function defaultRoomSurfaceConfigs({
  mode,
  workspaceEnabled,
  workspaceTitle,
}: DefaultRoomSurfaceInput): DefaultRoomSurfaceConfig[] {
  if (mode === 'dev_container_assessment' && workspaceEnabled) {
    return [
      {
        id: 'video',
        surfaceType: 'video',
        title: 'Video Call',
        active: false,
      },
      {
        id: 'chat',
        surfaceType: 'chat',
        title: 'Room Chat',
        active: false,
      },
      {
        id: 'submission',
        surfaceType: 'submission',
        title: 'Submit Work',
        active: false,
      },
      {
        id: 'terminal',
        surfaceType: 'terminal',
        title: 'Container Terminal',
        active: false,
      },
      {
        id: 'workspace',
        surfaceType: 'workspace',
        title: workspaceTitle ?? 'VS Code',
        active: true,
      },
    ];
  }

  return [
    {
      id: 'video',
      surfaceType: 'video',
      title: 'Video Call',
      active: true,
    },
    {
      id: 'chat',
      surfaceType: 'chat',
      title: 'Room Chat',
      active: false,
    },
  ];
}
