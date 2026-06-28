import { describe, expect, it } from 'vitest';
import {
  buildClippyActionEventId,
  buildClippyAgentChatFallbackEvidence,
  buildClippyAgentChatResponseId,
  buildClippyAgentMessageSessionEvidence,
  buildClippyAgentStatusEvidence,
  buildClippyAgentStatusEventId,
  clippyAgentResponseFingerprint,
  buildClippyRoomActionExecutionEvidence,
  buildClippyUiActionEvidence,
  buildClippyUserChatEvidence,
} from './clippyEvidence';

describe('clippy evidence', () => {
  it('captures tray opens as human UI actions without claiming a Devin response', () => {
    expect(buildClippyUiActionEvidence({
      actionId: 'open-clippy-chat',
      origin: 'tray',
      actor: 'guest',
      capturedAtMs: 1782594000000,
      surface: 'win95',
      roomPhase: 'connected',
      workspaceStatus: 'READY',
      workspaceSessionId: 'workspace-123',
      agentWorkspaceReady: true,
    })).toEqual({
      text: 'Clippy chat opened from the Win95 taskbar tray',
      properties: {
        source: 'clippy_tray_ui',
        actionId: 'open-clippy-chat',
        origin: 'tray',
        executedBy: 'guest',
        actionSource: 'win95_taskbar_tray',
        executionStatus: 'opened',
        capturedAtMs: 1782594000000,
        clippyActionEventId: 'clippy-action:guest:1782594000000:clippy_tray_ui:tray:opened:open-clippy-chat',
        surface: 'win95',
        roomPhase: 'connected',
        workspaceStatus: 'READY',
        workspaceSessionId: 'workspace-123',
        agent: null,
        agentWorkspaceReady: true,
        agentResponseClaimed: false,
      },
    });
  });

  it('captures room-chat Clippy opens as chat-window UI actions', () => {
    expect(buildClippyUiActionEvidence({
      actionId: 'open-clippy-chat',
      origin: 'chat',
      actor: 'host',
      capturedAtMs: 1782594010000,
      surface: 'win95',
      roomPhase: 'connected',
      workspaceStatus: 'READY',
      workspaceSessionId: 'workspace-123',
      agentWorkspaceReady: true,
    })).toEqual({
      text: 'Clippy chat opened from the room chat window',
      properties: {
        source: 'clippy_chat_ui',
        actionId: 'open-clippy-chat',
        origin: 'chat',
        executedBy: 'host',
        actionSource: 'clippy_chat_window',
        executionStatus: 'opened',
        capturedAtMs: 1782594010000,
        clippyActionEventId: 'clippy-action:host:1782594010000:clippy_chat_ui:chat:opened:open-clippy-chat',
        surface: 'win95',
        roomPhase: 'connected',
        workspaceStatus: 'READY',
        workspaceSessionId: 'workspace-123',
        agent: null,
        agentWorkspaceReady: true,
        agentResponseClaimed: false,
      },
    });
  });

  it('captures chat-window closes as human UI actions without claiming a Devin response', () => {
    expect(buildClippyUiActionEvidence({
      actionId: 'close-clippy-chat',
      origin: 'chat',
      actor: 'guest',
      capturedAtMs: 1782594030000,
      surface: 'win95',
      roomPhase: 'connected',
      workspaceStatus: 'READY',
      workspaceSessionId: 'workspace-123',
      agentWorkspaceReady: true,
    })).toEqual({
      text: 'Clippy chat window closed',
      properties: {
        source: 'clippy_chat_ui',
        actionId: 'close-clippy-chat',
        origin: 'chat',
        executedBy: 'guest',
        actionSource: 'clippy_chat_window',
        executionStatus: 'closed',
        capturedAtMs: 1782594030000,
        clippyActionEventId: 'clippy-action:guest:1782594030000:clippy_chat_ui:chat:closed:close-clippy-chat',
        surface: 'win95',
        roomPhase: 'connected',
        workspaceStatus: 'READY',
        workspaceSessionId: 'workspace-123',
        agent: null,
        agentWorkspaceReady: true,
        agentResponseClaimed: false,
      },
    });
  });

  it('captures prompt dismissals separately from agent actions', () => {
    expect(buildClippyUiActionEvidence({
      actionId: 'dismiss-clippy',
      origin: 'prompt',
      actor: 'host',
      capturedAtMs: 1782594060000,
      surface: 'win95',
      roomPhase: 'connected',
      workspaceStatus: null,
      workspaceSessionId: null,
      agentWorkspaceReady: false,
    })).toMatchObject({
      text: 'Clippy prompt dismissed',
      properties: {
        source: 'clippy_prompt_ui',
        actionId: 'dismiss-clippy',
        origin: 'prompt',
        actionSource: 'clippy_prompt_ui',
        executionStatus: 'dismissed',
        capturedAtMs: 1782594060000,
        clippyActionEventId: 'clippy-action:host:1782594060000:clippy_prompt_ui:prompt:dismissed:dismiss-clippy',
        agentResponseClaimed: false,
      },
    });
  });

  it('captures Devin auth rechecks as human prompt UI evidence', () => {
    expect(buildClippyUiActionEvidence({
      actionId: 'check-devin-auth',
      origin: 'prompt',
      actor: 'guest',
      capturedAtMs: 1782594120000,
      surface: 'win95',
      roomPhase: 'connected',
      workspaceStatus: 'READY',
      workspaceSessionId: 'workspace-123',
      agentWorkspaceReady: true,
    })).toMatchObject({
      text: 'Clippy requested a real Devin CLI auth recheck',
      properties: {
        source: 'clippy_prompt_ui',
        actionId: 'check-devin-auth',
        origin: 'prompt',
        executedBy: 'guest',
        actionSource: 'clippy_prompt_ui',
        executionStatus: 'executed',
        capturedAtMs: 1782594120000,
        clippyActionEventId: 'clippy-action:guest:1782594120000:clippy_prompt_ui:prompt:executed:check-devin-auth',
        agent: null,
        agentResponseClaimed: false,
      },
    });
  });

  it('captures prompt-button executions as source-backed UI evidence', () => {
    expect(buildClippyRoomActionExecutionEvidence({
      actionId: 'start-recording',
      text: 'Clippy action: start recording',
      origin: 'prompt',
      actor: 'host',
      capturedAtMs: 1782594200000,
      surface: 'win95',
      roomPhase: 'connected',
      workspaceStatus: 'READY',
      workspaceSessionId: 'workspace-123',
    })).toEqual({
      text: 'Clippy action: start recording',
      properties: {
        source: 'clippy_prompt_ui',
        actionId: 'start-recording',
        origin: 'prompt',
        executedBy: 'host',
        actionSource: 'clippy_prompt_ui',
        agent: null,
        agentActionLabel: null,
        agentActionText: null,
        bridgeEventType: null,
        actionProtocol: null,
        agentActionObservedAt: null,
        agentActionBridgePersisted: null,
        executionStatus: 'executed',
        capturedAtMs: 1782594200000,
        clippyActionEventId: 'clippy-action:host:1782594200000:clippy_prompt_ui:prompt:executed:start-recording',
        autoExecute: null,
        url: null,
        surface: 'win95',
        roomPhase: 'connected',
        workspaceStatus: 'READY',
        workspaceSessionId: 'workspace-123',
        agentResponseClaimed: false,
      },
    });
  });

  it('rejects agent-origin room executions without a real bridge action packet', () => {
    expect(buildClippyRoomActionExecutionEvidence({
      actionId: 'open-terminal',
      text: 'Agent action: open terminal',
      origin: 'agent',
      actor: 'guest',
      capturedAtMs: 1782594660000,
      surface: 'win95',
      roomPhase: 'connected',
      workspaceStatus: 'READY',
      workspaceSessionId: 'workspace-123',
    })).toBeNull();
  });

  it('rejects legacy chat-response action arrays as executable Devin room actions', () => {
    expect(buildClippyRoomActionExecutionEvidence({
      actionId: 'open-terminal',
      text: 'Agent action: open terminal',
      origin: 'agent',
      actor: 'guest',
      capturedAtMs: 1782594660000,
      agentAction: {
        id: 'open-terminal',
        label: 'Open Terminal',
        text: 'Open a terminal to inspect the failing tests.',
        source: 'agent_stdout_action',
        agentName: 'devin',
        bridgeEventType: 'CHAT_RESPONSE',
        protocol: 'bridge_actions_field',
        observedAt: '2026-06-27T21:10:00.000Z',
        persisted: true,
        autoExecute: false,
      },
      surface: 'win95',
      roomPhase: 'connected',
      workspaceStatus: 'READY',
      workspaceSessionId: 'workspace-123',
    })).toBeNull();
  });

  it('links executed agent suggestions back to the real bridge action', () => {
    expect(buildClippyRoomActionExecutionEvidence({
      actionId: 'open-terminal',
      text: 'Agent action: open terminal',
      origin: 'agent',
      actor: 'guest',
      capturedAtMs: 1782594660000,
      agentAction: {
        id: 'open-terminal',
        label: 'Open Terminal',
        text: 'Open a terminal to inspect the failing tests.',
        source: 'agent_stdout_action',
        agentName: 'devin',
        bridgeEventType: 'ROOM_ACTION',
        protocol: 'clippy_room_action_tag',
        observedAt: '2026-06-27T21:10:00.000Z',
        persisted: true,
        autoExecute: false,
        browserPromptId: 'workspace-123:guest:prompt:1782603900000:clippy_0123abcd',
        browserPromptFingerprint: 'clippy_0123abcd',
        browserPromptTimestamp: 1782603900000,
        browserPromptLength: 24,
      },
      surface: 'win95',
      roomPhase: 'connected',
      workspaceStatus: 'READY',
      workspaceSessionId: 'workspace-123',
    })).toMatchObject({
      text: 'Agent action: open terminal',
      properties: {
        source: 'clippy_agent_bridge',
        origin: 'agent',
        executedBy: 'guest',
        actionSource: 'agent_stdout_action',
        bridgeEventType: 'ROOM_ACTION',
        actionProtocol: 'clippy_room_action_tag',
        agentActionObservedAt: '2026-06-27T21:10:00.000Z',
        agentActionBridgePersisted: true,
        browserPromptId: 'workspace-123:guest:prompt:1782603900000:clippy_0123abcd',
        browserPromptFingerprint: 'clippy_0123abcd',
        browserPromptTimestamp: 1782603900000,
        browserPromptLength: 24,
        executionStatus: 'executed',
        capturedAtMs: 1782594660000,
        clippyActionEventId: 'clippy-action:guest:1782594660000:clippy_agent_bridge:agent:executed:open-terminal',
        agentResponseClaimed: false,
      },
    });
  });

  it('derives Clippy action ids from actor, source, origin, status, action, and capture time', () => {
    expect(buildClippyActionEventId({
      actor: 'agent',
      capturedAtMs: 1782594600000,
      source: 'clippy_agent_bridge',
      origin: 'agent',
      executionStatus: 'suggested',
      actionId: 'open-terminal',
    })).toBe('clippy-action:agent:1782594600000:clippy_agent_bridge:agent:suggested:open-terminal');
  });

  it('captures user prompts as browser-to-bridge evidence without claiming an agent response', () => {
    expect(buildClippyUserChatEvidence({
      message: {
        role: 'user',
        text: 'Can you explain the failing order recovery test?',
        timestamp: 1782603900000,
        source: 'user_submit',
        browserPromptId: 'workspace-123:guest:prompt:1782603900000:clippy_0123abcd',
        browserPromptFingerprint: 'clippy_0123abcd',
        browserPromptTimestamp: 1782603900000,
        browserPromptLength: 48,
      },
      actor: 'guest',
      surface: 'win95',
      roomPhase: 'connected',
      workspaceStatus: 'READY',
      workspaceSessionId: 'workspace-123',
      repoUrl: 'https://github.com/acme/orders',
    })).toMatchObject({
      text: 'Can you explain the failing order recovery test?',
      properties: {
        source: 'clippy_agent_chat_client_submit',
        agentChatEventSource: 'browser_clippy_chat_window',
        bridgeMessageType: 'CHAT',
        bridgeProtocol: 'clippy_dev_container_ws',
        promptId: 'workspace-123:guest:prompt:1782603900000:clippy_0123abcd',
        promptFingerprint: 'clippy_0123abcd',
        promptLength: 48,
        promptTimestamp: 1782603900000,
        browserQueuedBridgeMessage: true,
        bridgeDeliveryConfirmed: false,
        agent: null,
        surface: 'win95',
        roomPhase: 'connected',
        workspaceStatus: 'READY',
        workspaceSessionId: 'workspace-123',
        repoUrl: 'https://github.com/acme/orders',
        agentResponseClaimed: false,
      },
    });
  });

  it('marks browser fallback Devin replies as bridge-sourced evidence, not local chat claims', () => {
    expect(buildClippyAgentChatFallbackEvidence({
      text: 'I inspected the failing test.',
      agentName: 'devin',
      observedAt: '2026-06-27T21:05:00.000Z',
      browserPromptId: 'workspace-123:guest:prompt:1782603900000:clippy_0123abcd',
      browserPromptFingerprint: 'clippy_0123abcd',
      browserPromptTimestamp: 1782603900000,
      browserPromptLength: 24,
      surface: 'win95',
      roomPhase: 'connected',
      workspaceStatus: 'READY',
      workspaceSessionId: 'workspace-123',
      messageTimestamp: 1782603900000,
    })).toEqual({
      text: 'I inspected the failing test.',
      properties: {
        source: 'clippy_agent_bridge',
        agent: 'devin',
        bridgeEventType: 'CHAT_RESPONSE',
        bridgeMessageSource: 'agent_stdout',
        observedAt: '2026-06-27T21:05:00.000Z',
        capturedAtMs: 1782594300000,
        agentChatResponseId: 'agent-chat:devin:1782594300000:CHAT_RESPONSE:agent_314a13fc',
        responseFingerprint: 'agent_314a13fc',
        responseLength: 29,
        bridgePersisted: false,
        persistenceFallback: 'browser_after_bridge_persist_failed',
        browserPromptId: 'workspace-123:guest:prompt:1782603900000:clippy_0123abcd',
        browserPromptFingerprint: 'clippy_0123abcd',
        browserPromptTimestamp: 1782603900000,
        browserPromptLength: 24,
        surface: 'win95',
        roomPhase: 'connected',
        workspaceStatus: 'READY',
        workspaceSessionId: 'workspace-123',
        messageTimestamp: 1782603900000,
        agentResponseClaimed: true,
      },
    });
  });

  it('does not fabricate Devin identity in direct browser fallback or status builders', () => {
    expect(buildClippyAgentChatFallbackEvidence({
      text: 'I inspected the failing test.',
      agentName: null,
      observedAt: '2026-06-27T21:05:00.000Z',
      surface: 'win95',
      roomPhase: 'connected',
      workspaceStatus: 'READY',
      workspaceSessionId: 'workspace-123',
      messageTimestamp: 1782603900000,
    })).toBeNull();

    expect(buildClippyAgentStatusEvidence({
      text: 'bridge is starting',
      agentName: null,
      status: 'starting',
      bridgeMessageSource: 'agent_status',
      observedAt: '2026-06-27T21:12:00.000Z',
      capturedAtMs: 1782594720000,
      surface: 'win95',
      roomPhase: 'connected',
      workspaceStatus: 'READY',
      workspaceSessionId: 'workspace-123',
      messageTimestamp: 1782594720000,
    })).toBeNull();
  });

  it('converts browser-observed Devin replies into agent chat evidence only when source metadata is present', () => {
    expect(buildClippyAgentMessageSessionEvidence({
      text: 'I inspected the failing test.',
      source: 'agent_stdout',
      agentName: 'devin',
      observedAt: '2026-06-27T21:05:00.000Z',
      browserPromptId: 'workspace-123:guest:prompt:1782603900000:clippy_0123abcd',
      browserPromptFingerprint: 'clippy_0123abcd',
      browserPromptTimestamp: 1782603900000,
      browserPromptLength: 24,
      surface: 'win95',
      roomPhase: 'connected',
      workspaceStatus: 'READY',
      workspaceSessionId: 'workspace-123',
      messageTimestamp: 1782603900000,
    })).toMatchObject({
      eventType: 'ai_chat_agent',
      text: 'I inspected the failing test.',
      properties: {
        source: 'clippy_agent_bridge',
        bridgeEventType: 'CHAT_RESPONSE',
        bridgeMessageSource: 'agent_stdout',
        observedAt: '2026-06-27T21:05:00.000Z',
        browserPromptId: 'workspace-123:guest:prompt:1782603900000:clippy_0123abcd',
        browserPromptFingerprint: 'clippy_0123abcd',
        browserPromptTimestamp: 1782603900000,
        browserPromptLength: 24,
        agentResponseClaimed: true,
      },
    });
  });

  it('records source-backed diagnostics instead of fake replies when agent stdout lacks observation metadata', () => {
    expect(buildClippyAgentMessageSessionEvidence({
      text: 'I inspected the failing test.',
      source: 'agent_stdout',
      agentName: 'devin',
      agentStatus: 'thinking',
      surface: 'win95',
      roomPhase: 'connected',
      workspaceStatus: 'READY',
      workspaceSessionId: 'workspace-123',
      messageTimestamp: 1700000000000,
    })).toEqual({
      eventType: 'ai_agent_status',
      text: 'Clippy/Devin response was not recorded as agent evidence because bridge source metadata was missing.',
      properties: {
        source: 'clippy_agent_bridge',
        agentStatusEventSource: 'browser_clippy_agent_ws',
        agent: 'devin',
        status: 'thinking',
        diagnosticSource: 'agent_response_missing_source_metadata',
        bridgeMessageSource: 'agent_stdout',
        observedAt: '2023-11-14T22:13:20.000Z',
        capturedAtMs: 1700000000000,
        agentStatusEventId: 'agent-status:devin:1700000000000:agent_stdout:thinking:agent_response_missing_source_metadata',
        exitCode: null,
        signal: null,
        truncated: null,
        bridgePersisted: null,
        promptType: null,
        deliveredToAgent: null,
        promptLength: null,
        promptFingerprint: null,
        roomContextStatus: null,
        roomContextLength: null,
        roomContextFingerprint: null,
        userMessageLength: null,
        userMessageFingerprint: null,
        contextTruncated: null,
        surface: 'win95',
        roomPhase: 'connected',
        workspaceStatus: 'READY',
        workspaceSessionId: 'workspace-123',
        messageTimestamp: 1700000000000,
        agentResponseClaimed: false,
      },
    });
  });

  it('keeps browser prompt references on source-backed bridge handoff diagnostics', () => {
    expect(buildClippyAgentMessageSessionEvidence({
      text: 'devin chat prompt delivered to process stdin.',
      source: 'bridge_diagnostic',
      agentName: 'devin',
      agentStatus: 'thinking',
      diagnosticSource: 'agent_prompt_sent',
      observedAt: '2026-06-27T20:00:00.000Z',
      persisted: false,
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
      surface: 'win95',
      roomPhase: 'connected',
      workspaceStatus: 'READY',
      workspaceSessionId: 'workspace-123',
      messageTimestamp: 1782603901000,
    })).toMatchObject({
      eventType: 'ai_agent_status',
      text: 'devin chat prompt delivered to process stdin.',
      properties: {
        source: 'clippy_agent_bridge',
        bridgeMessageSource: 'bridge_diagnostic',
        diagnosticSource: 'agent_prompt_sent',
        promptType: 'chat_prompt',
        deliveredToAgent: true,
        browserPromptId: 'workspace-123:guest:prompt:1782603900000:clippy_0123abcd',
        browserPromptFingerprint: 'clippy_0123abcd',
        browserPromptTimestamp: 1782603900000,
        browserPromptLength: 18,
        agentResponseClaimed: false,
      },
    });
  });

  it('does not fabricate bridge diagnostics when an agent message has no bridge source', () => {
    expect(buildClippyAgentMessageSessionEvidence({
      text: 'A message with no bridge source.',
      agentName: 'devin',
      diagnosticSource: 'agent_exit',
      observedAt: '2026-06-27T21:05:00.000Z',
      surface: 'win95',
      roomPhase: 'connected',
      workspaceStatus: 'READY',
      workspaceSessionId: 'workspace-123',
      messageTimestamp: 1782603900000,
    })).toBeNull();
  });

  it('does not fabricate agent identity when bridge source exists but agent name is missing', () => {
    expect(buildClippyAgentMessageSessionEvidence({
      text: 'I inspected the failing test.',
      source: 'agent_stdout',
      observedAt: '2026-06-27T21:05:00.000Z',
      surface: 'win95',
      roomPhase: 'connected',
      workspaceStatus: 'READY',
      workspaceSessionId: 'workspace-123',
      messageTimestamp: 1782603900000,
    })).toBeNull();
  });

  it('derives response ids from agent, capture time, and response fingerprint', () => {
    const responseFingerprint = clippyAgentResponseFingerprint('I inspected the failing test.');
    expect(responseFingerprint).toBe('agent_314a13fc');
    expect(buildClippyAgentChatResponseId({
      agentName: 'devin',
      capturedAtMs: 1782594300000,
      responseFingerprint,
    })).toBe('agent-chat:devin:1782594300000:CHAT_RESPONSE:agent_314a13fc');
  });

  it('builds stable source-backed status evidence for browser-observed Devin bridge states', () => {
    expect(buildClippyAgentStatusEvidence({
      text: 'devin is starting from the real container bridge.',
      agentName: 'devin',
      status: 'starting',
      bridgeMessageSource: 'agent_status',
      observedAt: '2026-06-27T21:12:00.000Z',
      capturedAtMs: 1782594720000,
      surface: 'win95',
      roomPhase: 'connected',
      workspaceStatus: 'READY',
      workspaceSessionId: 'workspace-123',
      messageTimestamp: 1782594720000,
    })).toEqual({
      text: 'devin is starting from the real container bridge.',
      properties: {
        source: 'clippy_agent_bridge',
        agentStatusEventSource: 'browser_clippy_agent_ws',
        agent: 'devin',
        status: 'starting',
        diagnosticSource: null,
        bridgeMessageSource: 'agent_status',
        observedAt: '2026-06-27T21:12:00.000Z',
        capturedAtMs: 1782594720000,
        agentStatusEventId: 'agent-status:devin:1782594720000:agent_status:starting:none',
        exitCode: null,
        signal: null,
        truncated: null,
        bridgePersisted: null,
        promptType: null,
        deliveredToAgent: null,
        promptLength: null,
        promptFingerprint: null,
        roomContextStatus: null,
        roomContextLength: null,
        roomContextFingerprint: null,
        userMessageLength: null,
        userMessageFingerprint: null,
        contextTruncated: null,
        surface: 'win95',
        roomPhase: 'connected',
        workspaceStatus: 'READY',
        workspaceSessionId: 'workspace-123',
        messageTimestamp: 1782594720000,
        agentResponseClaimed: false,
      },
    });
  });

  it('derives status ids from agent, source, status, diagnostic, and capture time', () => {
    expect(buildClippyAgentStatusEventId({
      agentName: 'devin',
      capturedAtMs: 1782604380000,
      bridgeMessageSource: 'bridge_diagnostic',
      status: 'thinking',
      diagnosticSource: 'agent_prompt_sent',
    })).toBe('agent-status:devin:1782604380000:bridge_diagnostic:thinking:agent_prompt_sent');
  });
});
