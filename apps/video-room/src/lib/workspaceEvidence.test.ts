import { describe, expect, it } from 'vitest';
import {
  buildCodeEditorOpenEvidence,
  buildCodeServerFileChangeEvidence,
  buildWorkspaceStateDesktopEvent,
  redactWorkspaceDiagnostic,
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
      capturedAtMs: 1700000000000,
    });

    expect(evidence).toEqual({
      text: 'VS Code workspace opened for https://github.com/cloudflare/workers-sdk',
      properties: {
        source: 'code_server_workspace',
        editorEventSource: 'browser_code_server_iframe',
        codeEditorOpenId: 'code-editor-open:guest:1700000000000:workspace-session-1',
        editor: 'code-server',
        openStatus: 'loaded',
        actor: 'guest',
        capturedAtMs: 1700000000000,
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
        proxyUrlPersisted: false,
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
      capturedAtMs: 1700000000000,
    })).toBeNull();
  });
});

describe('buildCodeServerFileChangeEvidence', () => {
  it('builds browser-observed code-server file evidence only from explicit bridge source metadata', () => {
    expect(buildCodeServerFileChangeEvidence({
      filePath: 'src/app.ts',
      actionName: 'modified',
      source: 'code_server_workspace',
      observedAt: '2026-06-27T12:00:00.000Z',
      sizeBytes: 421,
      contentHash: 'a'.repeat(64),
      contentPreview: 'export const answer = 42;',
      persisted: false,
      workspace,
      surface: 'win95',
      roomPhase: 'connected',
    })).toEqual({
      eventType: 'code_editor_save',
      text: 'src/app.ts',
      properties: {
        source: 'code_server_workspace',
        observedBy: 'clippy_agent_bridge',
        bridgeEventType: 'FILE_CHANGED',
        editorSurface: 'code-server',
        action: 'modified',
        surface: 'win95',
        roomPhase: 'connected',
        workspaceStatus: 'READY',
        workspaceSessionId: 'workspace-session-1',
        repoUrl: 'https://github.com/cloudflare/workers-sdk',
        path: 'src/app.ts',
        observedAt: '2026-06-27T12:00:00.000Z',
        contentHash: 'a'.repeat(64),
        sizeBytes: 421,
        contentPreview: 'export const answer = 42;',
        bridgePersisted: false,
      },
    });
  });

  it('does not fabricate code-server file evidence when bridge source metadata is missing', () => {
    expect(buildCodeServerFileChangeEvidence({
      filePath: 'src/app.ts',
      actionName: 'modified',
      observedAt: '2026-06-27T12:00:00.000Z',
      sizeBytes: 421,
      contentHash: 'a'.repeat(64),
      contentPreview: 'export const answer = 42;',
      persisted: false,
      workspace,
      surface: 'win95',
      roomPhase: 'connected',
    })).toBeNull();
  });

  it('does not build browser-observed code-server file evidence that Durable Object replay would reject', () => {
    const base = {
      filePath: 'src/app.ts',
      actionName: 'modified',
      source: 'code_server_workspace',
      observedAt: '2026-06-27T12:00:00.000Z',
      sizeBytes: 421,
      contentHash: 'a'.repeat(64),
      contentPreview: 'export const answer = 42;',
      persisted: false,
      workspace,
      surface: 'win95' as const,
      roomPhase: 'connected' as const,
    };

    expect(buildCodeServerFileChangeEvidence({
      ...base,
      workspace: { ...workspace, session: null },
    })).toBeNull();
    expect(buildCodeServerFileChangeEvidence({
      ...base,
      observedAt: null,
    })).toBeNull();
    expect(buildCodeServerFileChangeEvidence({
      ...base,
      sizeBytes: null,
    })).toBeNull();
    expect(buildCodeServerFileChangeEvidence({
      ...base,
      contentHash: null,
    })).toBeNull();
    expect(buildCodeServerFileChangeEvidence({
      ...base,
      contentHash: 'not-a-sha256',
    })).toBeNull();
  });
});

describe('buildWorkspaceStateDesktopEvent', () => {
  it('builds source-backed workspace state without leaking proxy URLs', () => {
    const event = buildWorkspaceStateDesktopEvent({
      workspace,
      actor: 'host',
      source: 'launch',
      capturedAtMs: 1700000000000,
    });

    expect(event).toEqual({
      kind: 'WORKSPACE_STATE_CHANGED',
      actor: 'host',
      workspaceStateEventId: 'workspace-state:host:1700000000000:launch:workspace-session-1:READY',
      capturedAtMs: 1700000000000,
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
      source: 'browser_workspace_state_observer',
      workspaceEventSource: 'browser_workspace_state_observer',
      workspaceStateSource: 'launch',
      workspaceTelemetryPersisted: true,
      proxyUrlPersisted: false,
    });
    expect(JSON.stringify(event)).not.toContain('secret-token');
    expect(JSON.stringify(event)).not.toContain('proxyPath');
  });

  it('records explicit launch errors as diagnostic workspace state', () => {
    expect(buildWorkspaceStateDesktopEvent({
      workspace: { ...workspace, session: null, repoUrl: null, canLaunch: true },
      actor: 'host',
      source: 'error',
      capturedAtMs: 1700000005000,
      fallbackRepoUrl: 'https://github.com/example/repo',
      errorMessage: 'Container start failed',
    })).toMatchObject({
      actor: 'host',
      workspaceStateEventId: 'workspace-state:host:1700000005000:error:no-session:ERROR',
      capturedAtMs: 1700000005000,
      status: 'ERROR',
      workspaceSessionId: null,
      errorMessage: 'Container start failed',
      repoUrl: 'https://github.com/example/repo',
      canLaunch: true,
      source: 'browser_workspace_state_observer',
      workspaceEventSource: 'browser_workspace_state_observer',
      workspaceStateSource: 'error',
      workspaceTelemetryPersisted: true,
      proxyUrlPersisted: false,
    });
  });

  it('redacts secrets and room tokens from workspace diagnostics before evidence is built', () => {
    const rawServiceKey = 'cog_abcdefghijklmnopqrstuvwxyz123456';
    const rawRoomToken = 'room-token-secret-123';
    const rawQueryToken = 'query-token-secret-456';
    const diagnostic = `Init failed DEVIN_API_KEY=${rawServiceKey} at /api/v1/meeting-rooms/${rawRoomToken}/workspace?token=${rawQueryToken}`;

    expect(redactWorkspaceDiagnostic(diagnostic)).toBe(
      'Init failed DEVIN_API_KEY=[REDACTED_SECRET] at /api/v1/meeting-rooms/[REDACTED_SECRET]/workspace?token=[REDACTED_SECRET]',
    );

    const event = buildWorkspaceStateDesktopEvent({
      workspace: { ...workspace, session: null, repoUrl: null, canLaunch: true },
      actor: 'host',
      source: 'error',
      capturedAtMs: 1700000006000,
      errorMessage: diagnostic,
    });

    expect(event.errorMessage).toContain('DEVIN_API_KEY=[REDACTED_SECRET]');
    expect(event.errorMessage).toContain('/api/v1/meeting-rooms/[REDACTED_SECRET]/workspace');
    expect(event.errorMessage).not.toContain(rawServiceKey);
    expect(event.errorMessage).not.toContain(rawRoomToken);
    expect(event.errorMessage).not.toContain(rawQueryToken);
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
      actor: 'host',
      source: 'launch',
      capturedAtMs: 1700000010000,
    });

    expect(event).toMatchObject({
      kind: 'WORKSPACE_STATE_CHANGED',
      actor: 'host',
      workspaceStateEventId: 'workspace-state:host:1700000010000:launch:workspace-session-1:READY',
      capturedAtMs: 1700000010000,
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
