import { describe, expect, it } from 'vitest';
import {
  isRecoverableWorkspaceStartFailure,
  shouldAutoRelaunchWorkspace,
} from './workspaceRecovery';
import type { RoomWorkspaceSession } from '../types';

function session(overrides: Partial<RoomWorkspaceSession> = {}): RoomWorkspaceSession {
  return {
    sessionId: 'workspace-session-1',
    status: 'ERROR',
    ttlSeconds: 3600,
    ttlSource: 'default',
    expiresAt: '2026-06-29T12:00:00.000Z',
    warnedAt: null,
    expiringSoon: false,
    proxyPath: null,
    errorMessage: 'The container is not running, consider calling start()',
    ...overrides,
  };
}

describe('isRecoverableWorkspaceStartFailure', () => {
  it('recognizes Cloudflare container start races as recoverable', () => {
    expect(isRecoverableWorkspaceStartFailure('The container is not running, consider calling start()')).toBe(true);
    expect(isRecoverableWorkspaceStartFailure('CONTAINER_START_FAILED: port 8080 never opened')).toBe(true);
    expect(isRecoverableWorkspaceStartFailure('Workspace startup did not complete.')).toBe(true);
    expect(isRecoverableWorkspaceStartFailure('Container stopped unexpectedly (exit code 0, reason exit).')).toBe(true);
  });

  it('does not classify arbitrary workspace failures as recoverable', () => {
    expect(isRecoverableWorkspaceStartFailure('git clone failed: repository not found')).toBe(false);
    expect(isRecoverableWorkspaceStartFailure('')).toBe(false);
    expect(isRecoverableWorkspaceStartFailure(null)).toBe(false);
  });
});

describe('shouldAutoRelaunchWorkspace', () => {
  it('auto-recovers exactly host-owned recoverable failed workspace starts', () => {
    expect(shouldAutoRelaunchWorkspace({
      roomRole: 'HOST',
      workspaceLoading: false,
      canLaunchWorkspace: true,
      session: session(),
      alreadyAttempted: false,
    })).toBe(true);
  });

  it('does not auto-relaunch for guests, in-flight launches, prior attempts, or non-recoverable failures', () => {
    const base = {
      roomRole: 'HOST' as const,
      workspaceLoading: false,
      canLaunchWorkspace: true,
      session: session(),
      alreadyAttempted: false,
    };
    expect(shouldAutoRelaunchWorkspace({ ...base, roomRole: 'GUEST' })).toBe(false);
    expect(shouldAutoRelaunchWorkspace({ ...base, workspaceLoading: true })).toBe(false);
    expect(shouldAutoRelaunchWorkspace({ ...base, alreadyAttempted: true })).toBe(false);
    expect(shouldAutoRelaunchWorkspace({
      ...base,
      session: session({ errorMessage: 'git clone failed: repository not found' }),
    })).toBe(false);
    expect(shouldAutoRelaunchWorkspace({
      ...base,
      session: session({ status: 'READY', errorMessage: null }),
    })).toBe(false);
  });
});
