import type { OpenWindowConfig } from '../hooks/useWindowManager';

export type DefaultRoomWindowConfig = OpenWindowConfig & { id: string };
export type DefaultRoomWindowMode = 'standard_call' | 'code_review' | 'dev_container_assessment';

interface DefaultRoomWindowInput {
  mode: DefaultRoomWindowMode;
  workspaceEnabled: boolean;
  workspaceTitle?: string | null;
}

export function defaultRoomWindowConfigs({
  mode,
  workspaceEnabled,
  workspaceTitle,
}: DefaultRoomWindowInput): DefaultRoomWindowConfig[] {
  if (mode === 'dev_container_assessment' && workspaceEnabled) {
    return [
      {
        id: 'video',
        windowType: 'video',
        title: 'Video Call',
        x: 908,
        y: 28,
        width: 380,
        height: 286,
      },
      {
        id: 'chat',
        windowType: 'chat',
        title: 'Room Chat',
        x: 908,
        y: 334,
        width: 380,
        height: 304,
      },
      {
        id: 'submission',
        windowType: 'submission',
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
        windowType: 'workspace',
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
      windowType: 'video',
      title: 'Video Call',
      x: 60,
      y: 30,
      width: 480,
      height: 360,
    },
    {
      id: 'chat',
      windowType: 'chat',
      title: 'Room Chat',
      x: 560,
      y: 30,
      width: 340,
      height: 400,
    },
  ];
}
