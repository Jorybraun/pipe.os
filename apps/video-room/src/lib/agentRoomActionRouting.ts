import type { AgentRoomAction } from '../hooks/useAgentConnection';

export type AgentRoomActionRoute =
  | { kind: 'agent'; source: 'agent'; action: AgentRoomAction }
  | { kind: 'bridge_observation_prompt'; source: 'prompt'; action: AgentRoomAction }
  | { kind: 'reject'; reason: string };

export function routeAgentRoomAction(action: AgentRoomAction): AgentRoomActionRoute {
  if (
    action.bridgeEventType === 'ROOM_ACTION'
    && action.protocol === 'clippy_room_action_tag'
    && (action.source === 'agent_stdout_action' || action.source === 'agent_api_response_action')
  ) {
    return { kind: 'agent', source: 'agent', action };
  }

  if (
    action.bridgeEventType === 'FILE_CHANGED'
    && action.protocol === 'workspace_file_observation'
    && action.source === 'bridge_observation'
    && action.id === 'open-workspace'
  ) {
    return { kind: 'bridge_observation_prompt', source: 'prompt', action };
  }

  return { kind: 'reject', reason: 'unsupported_agent_room_action_source' };
}
