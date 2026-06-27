import { describe, expect, it } from 'vitest';
import {
  buildCodeEditorOpenEvidence,
  buildWorkspaceStateDesktopEvent,
} from './workspaceEvidence';
import type { RoomWorkspace } from '../types';

const workspace: RoomWorkspace = {
  enabled: true,
  canLaunch: false,
  repoUrl: 'https://github.com/cloudflare/workers-sdk',
  githubPrNumber: 14435,
  matchedRepoId: 42,
  challenge: {
    status: 'github_pr_assigned',
    kind: 'github_pr',
    source: 'scheduled_interview.github_pr_number',
    message: null,
  },
  session: {
    sessionId: 'workspace-session-1',
    status: 'READY',
    ttlSeconds: 3600,
    ttlSource: 'default',
    expiresAt: '2026-06-27T20:00:00.000Z',
    warnedAt: null,
    expiringSoon: false,
    proxyPath: '/api/v1/meeting-rooms/secret-token/workspace/proxy/workspace-session-1/',
    errorMessage: null,
  },
};

describe('buildCodeEditorOpenEvidence', () => {
  it('builds source-backed code-server evidence without leaking room-token proxy URLs', () => {
    const evidence = buildCodeEditorOpenEvidence({
      workspace,
      actor: 'guest',
      surface: 'win95',
      roomPhase: 'connected',
    });

    expect(evidence).toEqual({
      text: 'VS Code workspace opened for https://github.com/cloudflare/workers-sdk',
      properties: {
        source: 'code_server_workspace',
        editor: 'code-server',
        actor: 'guest',
        surface: 'win95',
        roomPhase: 'connected',
        workspaceSessionId: 'workspace-session-1',
        workspaceStatus: 'READY',
        repoUrl: 'https://github.com/cloudflare/workers-sdk',
        githubPrNumber: 14435,
        matchedRepoId: 42,
        challengeStatus: 'github_pr_assigned',
        challengeKind: 'github_pr',
        challengeSource: 'scheduled_interview.github_pr_number',
        challengeMessage: null,
      },
    });
    expect(JSON.stringify(evidence)).not.toContain('secret-token');
    expect(JSON.stringify(evidence)).not.toContain('proxyPath');
  });

  it('returns null until a real workspace session exists', () => {
    expect(buildCodeEditorOpenEvidence({
      workspace: { ...workspace, session: null },
      actor: 'host',
      surface: 'standard',
      roomPhase: 'waiting',
    })).toBeNull();
  });
});

describe('buildWorkspaceStateDesktopEvent', () => {
  it('builds source-backed workspace state without leaking proxy URLs', () => {
    const event = buildWorkspaceStateDesktopEvent({
      workspace,
      source: 'launch',
    });

    expect(event).toEqual({
      kind: 'WORKSPACE_STATE_CHANGED',
      status: 'READY',
      workspaceSessionId: 'workspace-session-1',
      errorMessage: null,
      repoUrl: 'https://github.com/cloudflare/workers-sdk',
      githubPrNumber: 14435,
      matchedRepoId: 42,
      challengeStatus: 'github_pr_assigned',
      challengeKind: 'github_pr',
      challengeSource: 'scheduled_interview.github_pr_number',
      challengeMessage: null,
      canLaunch: false,
      ttlSeconds: 3600,
      ttlSource: 'default',
      expiresAt: '2026-06-27T20:00:00.000Z',
      expiringSoon: false,
      source: 'launch',
    });
    expect(JSON.stringify(event)).not.toContain('secret-token');
    expect(JSON.stringify(event)).not.toContain('proxyPath');
  });

  it('records explicit launch errors as diagnostic workspace state', () => {
    expect(buildWorkspaceStateDesktopEvent({
      workspace: { ...workspace, session: null, repoUrl: null, canLaunch: true },
      source: 'error',
      fallbackRepoUrl: 'https://github.com/example/repo',
      errorMessage: 'Container start failed',
    })).toMatchObject({
      status: 'ERROR',
      workspaceSessionId: null,
      errorMessage: 'Container start failed',
      repoUrl: 'https://github.com/example/repo',
      canLaunch: true,
      source: 'error',
    });
  });

  it('records a matched repo with no PR as an explicit reviewable-task gap', () => {
    const event = buildWorkspaceStateDesktopEvent({
      workspace: {
        ...workspace,
        githubPrNumber: null,
        challenge: {
          status: 'missing_reviewable_task',
          kind: 'repo_only',
          source: 'matched_repo_without_pr',
          message: 'Matched repository is available, but no GitHub PR or task was assigned.',
        },
      },
      source: 'launch',
    });

    expect(event).toMatchObject({
      kind: 'WORKSPACE_STATE_CHANGED',
      status: 'READY',
      repoUrl: 'https://github.com/cloudflare/workers-sdk',
      githubPrNumber: null,
      matchedRepoId: 42,
      challengeStatus: 'missing_reviewable_task',
      challengeKind: 'repo_only',
      challengeSource: 'matched_repo_without_pr',
      challengeMessage: 'Matched repository is available, but no GitHub PR or task was assigned.',
    });
  });
});
