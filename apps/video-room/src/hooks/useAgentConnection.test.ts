import { describe, expect, it } from 'vitest';
import { agentStatusEvidenceText, parseAgentBridgeMessage } from './useAgentConnection';

describe('parseAgentBridgeMessage', () => {
  it('parses real Devin bridge status without fabricating a chat response', () => {
    expect(parseAgentBridgeMessage({
      type: 'AGENT_STATUS',
      agent: 'devin',
      status: 'auth_needed',
    })).toEqual({
      kind: 'status',
      agentName: 'devin',
      status: 'auth_needed',
    });
  });

  it('ignores bridge status without explicit agent identity', () => {
    expect(parseAgentBridgeMessage({
      type: 'AGENT_STATUS',
      status: 'auth_needed',
    })).toEqual({ kind: 'ignored' });
  });

  it('ignores bridge room actions without explicit agent identity', () => {
    expect(parseAgentBridgeMessage({
      type: 'ROOM_ACTION',
      action: 'open_terminal',
      text: 'I can inspect that from the terminal.',
      autoExecute: true,
      observedAt: '2026-06-27T21:10:00.000Z',
      persisted: true,
    })).toEqual({ kind: 'ignored' });
  });

  it('normalizes Devin room action messages into safe Clippy actions', () => {
    expect(parseAgentBridgeMessage({
      type: 'ROOM_ACTION',
      agent: 'devin',
      action: 'open_terminal',
      text: 'I can inspect that from the terminal.',
      autoExecute: true,
      observedAt: '2026-06-27T21:10:00.000Z',
      browserPromptId: 'workspace-123:guest:prompt:1782603900000:clippy_0123abcd',
      browserPromptFingerprint: 'clippy_0123abcd',
      browserPromptTimestamp: 1782603900000,
      browserPromptLength: 24,
      persisted: true,
    })).toEqual({
      kind: 'room_action',
      action: {
        id: 'open-terminal',
        label: 'Open Terminal',
        text: 'I can inspect that from the terminal.',
        url: undefined,
        autoExecute: true,
        source: 'agent_stdout_action',
        agentName: 'devin',
        bridgeEventType: 'ROOM_ACTION',
        protocol: 'clippy_room_action_tag',
        observedAt: '2026-06-27T21:10:00.000Z',
        browserPromptId: 'workspace-123:guest:prompt:1782603900000:clippy_0123abcd',
        browserPromptFingerprint: 'clippy_0123abcd',
        browserPromptTimestamp: 1782603900000,
        browserPromptLength: 24,
        persisted: true,
      },
    });
  });

  it('turns container file changes into an actionable workspace suggestion', () => {
    expect(parseAgentBridgeMessage({
      type: 'FILE_CHANGED',
      path: 'src/app.ts',
      action: 'modified',
      contentHash: 'sha256-source-hash',
      sizeBytes: 421,
      contentPreview: 'export const answer = 42;',
      observedAt: '2026-06-27T12:00:00.000Z',
      persisted: false,
    })).toEqual({
      kind: 'file_changed',
      message: {
        role: 'agent',
        text: 'I noticed src/app.ts was modified in the workspace.',
        source: 'bridge_observation',
      },
      action: {
        id: 'open-workspace',
        label: 'Open Workspace',
        text: 'I noticed src/app.ts was modified in the workspace.',
        source: 'bridge_observation',
        bridgeEventType: 'FILE_CHANGED',
        protocol: 'workspace_file_observation',
      },
      fileChange: {
        filePath: 'src/app.ts',
        actionName: 'modified',
        contentHash: 'sha256-source-hash',
        sizeBytes: 421,
        contentPreview: 'export const answer = 42;',
        observedAt: '2026-06-27T12:00:00.000Z',
        source: undefined,
        persisted: false,
      },
    });
  });

  it('preserves real Devin auth failure details without inventing an auth URL', () => {
    expect(parseAgentBridgeMessage({
      type: 'AUTH_NEEDED',
      agent: 'devin',
      message: 'Real Devin credentials are required.',
    })).toEqual({
      kind: 'auth_needed',
      agentName: 'devin',
      authUrl: null,
      message: 'Real Devin credentials are required.',
    });
  });

  it('classifies bridge diagnostics separately from Devin chat responses', () => {
    expect(parseAgentBridgeMessage({
      type: 'AGENT_DIAGNOSTIC',
      agent: 'devin',
      status: 'auth_needed',
      message: 'Devin is not authenticated.',
    })).toEqual({
      kind: 'diagnostic',
      agentName: 'devin',
      status: 'auth_needed',
      message: {
        role: 'agent',
        text: 'Devin is not authenticated.',
        source: 'bridge_diagnostic',
        agentName: 'devin',
        agentStatus: 'auth_needed',
      },
    });
  });

  it('preserves source metadata for real agent process diagnostics', () => {
    expect(parseAgentBridgeMessage({
      type: 'AGENT_DIAGNOSTIC',
      agent: 'devin',
      status: 'disconnected',
      message: 'Devin process exited with code 1.',
      diagnosticSource: 'agent_exit',
      observedAt: '2026-06-27T19:00:00.000Z',
      exitCode: 1,
      signal: null,
      truncated: false,
    })).toEqual({
      kind: 'diagnostic',
      agentName: 'devin',
      status: 'disconnected',
      message: {
        role: 'agent',
        text: 'Devin process exited with code 1.',
        source: 'bridge_diagnostic',
        agentName: 'devin',
        agentStatus: 'disconnected',
        diagnosticSource: 'agent_exit',
        observedAt: '2026-06-27T19:00:00.000Z',
        exitCode: 1,
        signal: null,
        truncated: false,
      },
    });
  });

  it('preserves prompt handoff metadata for bridge diagnostics', () => {
    expect(parseAgentBridgeMessage({
      type: 'AGENT_DIAGNOSTIC',
      agent: 'devin',
      status: 'thinking',
      message: 'devin chat prompt delivered to process stdin.',
      diagnosticSource: 'agent_prompt_sent',
      observedAt: '2026-06-27T20:00:00.000Z',
      promptType: 'chat_prompt',
      deliveredToAgent: true,
      promptLength: 241,
      promptFingerprint: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      roomContextStatus: 200,
      roomContextLength: 92,
      roomContextFingerprint: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      userMessageLength: 18,
      userMessageFingerprint: 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      contextTruncated: false,
      browserPromptId: 'workspace-123:guest:prompt:1782603900000:clippy_0123abcd',
      browserPromptFingerprint: 'clippy_0123abcd',
      browserPromptTimestamp: 1782603900000,
      browserPromptLength: 18,
      persisted: true,
    })).toEqual({
      kind: 'diagnostic',
      agentName: 'devin',
      status: 'thinking',
      message: {
        role: 'agent',
        text: 'devin chat prompt delivered to process stdin.',
        source: 'bridge_diagnostic',
        agentName: 'devin',
        agentStatus: 'thinking',
        diagnosticSource: 'agent_prompt_sent',
        observedAt: '2026-06-27T20:00:00.000Z',
        promptType: 'chat_prompt',
        deliveredToAgent: true,
        promptLength: 241,
        promptFingerprint: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        roomContextStatus: 200,
        roomContextLength: 92,
        roomContextFingerprint: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        userMessageLength: 18,
        userMessageFingerprint: 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        contextTruncated: false,
        browserPromptId: 'workspace-123:guest:prompt:1782603900000:clippy_0123abcd',
        browserPromptFingerprint: 'clippy_0123abcd',
        browserPromptTimestamp: 1782603900000,
        browserPromptLength: 18,
        persisted: true,
      },
    });
  });

  it('marks real bridge chat responses as agent stdout', () => {
    expect(parseAgentBridgeMessage({
      type: 'CHAT_RESPONSE',
      source: 'agent_stdout',
      text: 'I inspected the failing test.',
      agent: 'devin',
      observedAt: '2026-06-27T21:05:00.000Z',
      browserPromptId: 'workspace-123:guest:prompt:1782603900000:clippy_0123abcd',
      browserPromptFingerprint: 'clippy_0123abcd',
      browserPromptTimestamp: 1782603900000,
      browserPromptLength: 24,
      persisted: true,
    })).toEqual({
      kind: 'chat',
      message: {
        role: 'agent',
        text: 'I inspected the failing test.',
        source: 'agent_stdout',
        agentName: 'devin',
        observedAt: '2026-06-27T21:05:00.000Z',
        browserPromptId: 'workspace-123:guest:prompt:1782603900000:clippy_0123abcd',
        browserPromptFingerprint: 'clippy_0123abcd',
        browserPromptTimestamp: 1782603900000,
        browserPromptLength: 24,
        persisted: true,
      },
      actions: undefined,
    });
  });

  it('does not turn CHAT_RESPONSE action arrays into executable desktop actions', () => {
    expect(parseAgentBridgeMessage({
      type: 'CHAT_RESPONSE',
      source: 'agent_stdout',
      text: 'I can open the terminal if you want.',
      agent: 'devin',
      observedAt: '2026-06-27T21:05:00.000Z',
      persisted: true,
      actions: [{
        action: 'open_terminal',
        label: 'Open Terminal',
        observedAt: '2026-06-27T21:05:00.000Z',
        persisted: true,
      }],
    })).toEqual({
      kind: 'chat',
      message: {
        role: 'agent',
        text: 'I can open the terminal if you want.',
        source: 'agent_stdout',
        agentName: 'devin',
        observedAt: '2026-06-27T21:05:00.000Z',
        persisted: true,
      },
      actions: undefined,
    });
  });

  it('ignores bridge chat responses without explicit agent identity', () => {
    expect(parseAgentBridgeMessage({
      type: 'CHAT_RESPONSE',
      source: 'agent_stdout',
      text: 'I inspected the failing test.',
      observedAt: '2026-06-27T21:05:00.000Z',
      persisted: true,
    })).toEqual({ kind: 'ignored' });
  });

  it('ignores bridge chat responses without explicit stdout source metadata', () => {
    expect(parseAgentBridgeMessage({
      type: 'CHAT_RESPONSE',
      text: 'I inspected the failing test.',
      agent: 'devin',
    })).toEqual({ kind: 'ignored' });
  });

  it('turns bridge status into explicit evidence text', () => {
    expect(parseAgentBridgeMessage({
      type: 'AGENT_STATUS',
      agent: 'devin',
      status: 'starting',
    })).toEqual({
      kind: 'status',
      agentName: 'devin',
      status: 'starting',
    });
    expect(agentStatusEvidenceText('starting', 'devin')).toBe(
      'devin is starting from the real container bridge.',
    );
    expect(agentStatusEvidenceText('auth_needed', 'devin')).toBe(
      'devin requires real authentication before it can assist.',
    );
    expect(agentStatusEvidenceText('working', 'devin')).toBe(
      'devin is working on the candidate request.',
    );
    expect(agentStatusEvidenceText('disconnected', 'devin')).toBe(
      'devin bridge is disconnected.',
    );
    expect(agentStatusEvidenceText('idle', '')).toBeNull();
  });
});
