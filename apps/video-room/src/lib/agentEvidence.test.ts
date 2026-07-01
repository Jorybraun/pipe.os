import { describe, expect, it } from 'vitest';
import {
  agentResponseFingerprint,
  buildAgentChatFallbackEvidence,
  buildAgentChatResponseId,
  buildAgentMessageSessionEvidence,
  buildAgentStatusEvidence,
  buildAgentStatusEventId,
} from './agentEvidence';

describe('agent evidence', () => {
  it('builds stable source-backed bridge status evidence', () => {
    expect(buildAgentStatusEventId({
      agentName: 'devin',
      capturedAtMs: 1782594300000,
      bridgeMessageSource: 'agent_status',
      status: 'idle',
    })).toBe('agent-status:devin:1782594300000:agent_status:idle:none');

    expect(buildAgentStatusEvidence({
      text: 'Devin is ready.',
      agentName: 'devin',
      status: 'idle',
      bridgeMessageSource: 'agent_status',
      observedAt: '2026-06-27T19:45:00.000Z',
      capturedAtMs: 1782594300000,
      surface: 'standard',
      roomPhase: 'connected',
      workspaceStatus: 'READY',
      workspaceSessionId: 'workspace-123',
    })).toMatchObject({
      text: 'Devin is ready.',
      properties: {
        source: 'agent_bridge',
        agentStatusEventSource: 'browser_agent_ws',
        agent: 'devin',
        status: 'idle',
        bridgeMessageSource: 'agent_status',
        observedAt: '2026-06-27T19:45:00.000Z',
        capturedAtMs: 1782594300000,
        workspaceSessionId: 'workspace-123',
        agentResponseClaimed: false,
      },
    });
  });

  it('records unpersisted real agent stdout as fallback bridge evidence', () => {
    const text = 'I inspected the failing test and found the guard mismatch.';
    const fingerprint = agentResponseFingerprint(text);

    expect(buildAgentChatResponseId({
      agentName: 'devin',
      capturedAtMs: 1782594400000,
      responseFingerprint: fingerprint,
    })).toBe(`agent-chat:devin:1782594400000:CHAT_RESPONSE:${fingerprint}`);

    expect(buildAgentChatFallbackEvidence({
      text,
      agentName: 'devin',
      bridgeMessageSource: 'agent_stdout',
      observedAt: '2026-06-27T19:46:40.000Z',
      surface: 'standard',
      roomPhase: 'connected',
      workspaceStatus: 'READY',
      workspaceSessionId: 'workspace-123',
      messageTimestamp: 1782594400000,
    })).toMatchObject({
      text,
      properties: {
        source: 'agent_bridge',
        agent: 'devin',
        bridgeEventType: 'CHAT_RESPONSE',
        bridgeMessageSource: 'agent_stdout',
        responseFingerprint: fingerprint,
        persistenceFallback: 'browser_after_bridge_persist_failed',
        workspaceSessionId: 'workspace-123',
        agentResponseClaimed: true,
      },
    });
  });

  it('turns bridge diagnostics into agent status evidence without claiming a chat response', () => {
    expect(buildAgentMessageSessionEvidence({
      text: 'Bridge connected.',
      source: 'bridge_diagnostic',
      agentName: 'devin',
      agentStatus: 'idle',
      diagnosticSource: 'agent_socket',
      observedAt: '2026-06-27T19:47:00.000Z',
      persisted: false,
      surface: 'standard',
      roomPhase: 'connected',
      workspaceStatus: 'READY',
      workspaceSessionId: 'workspace-123',
      messageTimestamp: 1782594420000,
    })).toMatchObject({
      eventType: 'ai_agent_status',
      text: 'Bridge connected.',
      properties: {
        source: 'agent_bridge',
        agent: 'devin',
        bridgeMessageSource: 'bridge_diagnostic',
        diagnosticSource: 'agent_socket',
        agentResponseClaimed: false,
      },
    });
  });

  it('ignores bridge messages already persisted by the container', () => {
    expect(buildAgentMessageSessionEvidence({
      text: 'Already persisted.',
      source: 'agent_stdout',
      agentName: 'devin',
      observedAt: '2026-06-27T19:48:00.000Z',
      persisted: true,
      surface: 'standard',
      roomPhase: 'connected',
      workspaceStatus: 'READY',
      workspaceSessionId: 'workspace-123',
      messageTimestamp: 1782594480000,
    })).toBeNull();
  });
});
