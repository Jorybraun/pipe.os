import type { RoomRole, RoomWorkspaceSession } from '../types';

const RECOVERABLE_START_FAILURE_PATTERNS = [
  /container is not running/i,
  /consider calling start\(\)/i,
  /startup did not complete/i,
  /CONTAINER_START_FAILED/i,
  /container stopped unexpectedly\s*\(exit code 0,\s*reason exit\)/i,
];

export function isRecoverableWorkspaceStartFailure(message: string | null | undefined): boolean {
  const value = message?.trim();
  if (!value) return false;
  return RECOVERABLE_START_FAILURE_PATTERNS.some((pattern) => pattern.test(value));
}

export function shouldAutoRelaunchWorkspace(input: {
  roomRole: RoomRole;
  workspaceLoading: boolean;
  canLaunchWorkspace: boolean;
  session: RoomWorkspaceSession | null;
  alreadyAttempted: boolean;
}): boolean {
  if (input.roomRole !== 'HOST') return false;
  if (input.workspaceLoading || !input.canLaunchWorkspace || input.alreadyAttempted) return false;
  if (input.session?.status !== 'ERROR') return false;
  return isRecoverableWorkspaceStartFailure(input.session.errorMessage);
}
