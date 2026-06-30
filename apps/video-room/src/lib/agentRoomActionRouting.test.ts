import { describe, expect, it } from 'vitest';
import { routeAgentRoomAction } from './agentRoomActionRouting';
import type { AgentRoomAction } from '../hooks/useAgentConnection';

describe('routeAgentRoomAction', () => {
  it('keeps source-backed ROOM_ACTION suggestions on the agent evidence path', () => {
    const action: AgentRoomAction = {
      id: 'open-terminal',
      label: 'Open Terminal',
      text: 'Open a terminal to inspect the failing tests.',
      source: 'agent_api_response_action',
      agentName: 'devin',
      bridgeEventType: 'ROOM_ACTION',
      protocol: 'clippy_room_action_tag',
      observedAt: '2026-06-27T21:10:00.000Z',
      persisted: true,
    };

    expect(routeAgentRoomAction(action)).toEqual({
      kind: 'agent',
      source: 'agent',
      action,
    });
  });

  it('allows file-change observations to offer a user-clicked workspace prompt', () => {
    const action: AgentRoomAction = {
      id: 'open-workspace',
      label: 'Open Workspace',
      text: 'I noticed src/app.ts was modified in the workspace.',
      source: 'bridge_observation',
      bridgeEventType: 'FILE_CHANGED',
      protocol: 'workspace_file_observation',
    };

    expect(routeAgentRoomAction(action)).toEqual({
      kind: 'bridge_observation_prompt',
      source: 'prompt',
      action,
    });
  });

  it('rejects legacy chat-response action arrays instead of relabeling them as prompt actions', () => {
    const action: AgentRoomAction = {
      id: 'open-terminal',
      label: 'Open Terminal',
      text: 'I can open the terminal if you want.',
      source: 'agent_stdout_action',
      agentName: 'devin',
      bridgeEventType: 'CHAT_RESPONSE',
      protocol: 'bridge_actions_field',
      observedAt: '2026-06-27T21:05:00.000Z',
      persisted: true,
    };

    expect(routeAgentRoomAction(action)).toEqual({
      kind: 'reject',
      reason: 'unsupported_agent_room_action_source',
    });
  });
});
