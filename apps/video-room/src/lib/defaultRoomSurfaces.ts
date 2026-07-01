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
        x: 908,
        y: 28,
        width: 380,
        height: 286,
      },
      {
        id: 'chat',
        surfaceType: 'chat',
        title: 'Room Chat',
        x: 908,
        y: 334,
        width: 380,
        height: 304,
      },
      {
        id: 'submission',
        surfaceType: 'submission',
        title: 'Submit Work',
        x: 528,
        y: 420,
        width: 760,
        height: 300,
        minimized: true,
        focused: false,
      },
      {
        id: 'workspace',
        surfaceType: 'workspace',
        title: workspaceTitle ?? 'VS Code',
        x: 24,
        y: 28,
        width: 860,
        height: 610,
      },
    ];
  }

  return [
    {
      id: 'video',
      surfaceType: 'video',
      title: 'Video Call',
      x: 60,
      y: 30,
      width: 480,
      height: 360,
    },
    {
      id: 'chat',
      surfaceType: 'chat',
      title: 'Room Chat',
      x: 560,
      y: 30,
      width: 340,
      height: 400,
    },
  ];
}
