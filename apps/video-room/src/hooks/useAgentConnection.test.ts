import { describe, expect, it } from 'vitest';
import { agentStatusEvidenceText, parseAgentBridgeMessage } from './useAgentConnection';

describe('parseAgentBridgeMessage', () => {
  it('parses real Devin bridge status without fabricating a chat response', () => {
    expect(parseAgentBridgeMessage({
      type: 'AGENT_STATUS',
      status: 'auth_needed',
    })).toEqual({
      kind: 'status',
      status: 'auth_needed',
    });
  });

  it('normalizes Devin room action messages into safe Clippy actions', () => {
    expect(parseAgentBridgeMessage({
      type: 'ROOM_ACTION',
      action: 'open_terminal',
      text: 'I can inspect that from the terminal.',
      autoExecute: true,
    })).toEqual({
      kind: 'room_action',
      action: {
        id: 'open-terminal',
        label: 'Open Terminal',
        text: 'I can inspect that from the terminal.',
        autoExecute: true,
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

  it('marks real bridge chat responses as agent stdout', () => {
    expect(parseAgentBridgeMessage({
      type: 'CHAT_RESPONSE',
      text: 'I inspected the failing test.',
    })).toEqual({
      kind: 'chat',
      message: {
        role: 'agent',
        text: 'I inspected the failing test.',
        source: 'agent_stdout',
      },
      actions: undefined,
    });
  });

  it('turns bridge status into explicit evidence text', () => {
    expect(agentStatusEvidenceText('auth_needed', 'devin')).toBe(
      'devin requires real authentication before it can assist.',
    );
    expect(agentStatusEvidenceText('working', 'devin')).toBe(
      'devin is working on the candidate request.',
    );
    expect(agentStatusEvidenceText('disconnected', 'devin')).toBe(
      'devin bridge is disconnected.',
    );
  });
});
