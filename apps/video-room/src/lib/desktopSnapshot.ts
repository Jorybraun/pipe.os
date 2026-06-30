import type { RoomDesktopWindowConfig } from '../hooks/useRoomConnection';
import type { WindowState } from '../hooks/useWindowManager';

export function sharedWindowIdsMissingFromSnapshot(input: {
  windows: Pick<WindowState, 'id'>[];
  snapshot: Pick<RoomDesktopWindowConfig, 'id'>[];
  sharedWindowIds: ReadonlySet<string>;
}): string[] {
  const snapshotIds = new Set(input.snapshot.map((windowConfig) => windowConfig.id));
  return input.windows
    .filter((windowState) => input.sharedWindowIds.has(windowState.id) && !snapshotIds.has(windowState.id))
    .map((windowState) => windowState.id);
}
