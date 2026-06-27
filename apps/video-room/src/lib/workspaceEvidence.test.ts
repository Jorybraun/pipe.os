import { describe, expect, it } from 'vitest';
import { buildCodeEditorOpenEvidence } from './workspaceEvidence';
import type { RoomWorkspace } from '../types';

const workspace: RoomWorkspace = {
  enabled: true,
  canLaunch: false,
  repoUrl: 'https://github.com/cloudflare/workers-sdk',
  githubPrNumber: 14435,
  matchedRepoId: 42,
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
