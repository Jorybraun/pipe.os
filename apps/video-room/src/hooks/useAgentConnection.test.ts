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
    })).toEqual({
      kind: 'file_changed',
      message: {
        role: 'agent',
        text: 'I noticed src/app.ts was modified in the workspace.',
      },
      action: {
        id: 'open-workspace',
        label: 'Open Workspace',
        text: 'I noticed src/app.ts was modified in the workspace.',
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
