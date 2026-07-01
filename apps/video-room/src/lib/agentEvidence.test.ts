import { describe, expect, it } from 'vitest';
import {
  buildAgentActionEventId,
  buildAgentChatFallbackEvidence,
  buildAgentChatResponseId,
  buildAgentMessageSessionEvidence,
  buildAgentStatusEvidence,
  buildAgentStatusEventId,
  agentResponseFingerprint,
  buildAgentRoomActionExecutionEvidence,
  buildAgentUiActionEvidence,
  buildAgentUserChatEvidence,
} from './agentEvidence';

describe('agent evidence', () => {
  it('captures tray opens as human UI actions without claiming a Devin response', () => {
    expect(buildAgentUiActionEvidence({
      actionId: 'open-agent-chat',
      origin: 'tray',
      actor: 'guest',
      capturedAtMs: 1782594000000,
      surface: 'assessment',
      roomPhase: 'connected',
      workspaceStatus: 'READY',
      workspaceSessionId: 'workspace-123',
      agentWorkspaceReady: true,
    })).toEqual({
      text: 'AI assistant opened from the room controls',
      properties: {
        source: 'agent_tray_ui',
        actionId: 'open-agent-chat',
        origin: 'tray',
        executedBy: 'guest',
        actionSource: 'assessment_agent_tray',
        executionStatus: 'opened',
        capturedAtMs: 1782594000000,
        agentActionEventId: 'agent-action:guest:1782594000000:agent_tray_ui:tray:opened:open-agent-chat',
        surface: 'assessment',
        roomPhase: 'connected',
        workspaceStatus: 'READY',
        workspaceSessionId: 'workspace-123',
        agent: null,
        agentWorkspaceReady: true,
        agentResponseClaimed: false,
      },
    });
  });

  it('captures room-chat Agent opens as chat-panel UI actions', () => {
    expect(buildAgentUiActionEvidence({
      actionId: 'open-agent-chat',
      origin: 'chat',
      actor: 'host',
      capturedAtMs: 1782594010000,
      surface: 'assessment',
      roomPhase: 'connected',
      workspaceStatus: 'READY',
      workspaceSessionId: 'workspace-123',
      agentWorkspaceReady: true,
    })).toEqual({
      text: 'AI assistant opened from the room chat panel',
      properties: {
        source: 'agent_chat_ui',
        actionId: 'open-agent-chat',
        origin: 'chat',
        executedBy: 'host',
        actionSource: 'agent_chat_panel',
        executionStatus: 'opened',
        capturedAtMs: 1782594010000,
        agentActionEventId: 'agent-action:host:1782594010000:agent_chat_ui:chat:opened:open-agent-chat',
        surface: 'assessment',
        roomPhase: 'connected',
        workspaceStatus: 'READY',
        workspaceSessionId: 'workspace-123',
        agent: null,
        agentWorkspaceReady: true,
        agentResponseClaimed: false,
      },
    });
  });

  it('captures call-control assistant opens as video-call UI actions', () => {
    expect(buildAgentUiActionEvidence({
      actionId: 'open-agent-chat',
      origin: 'call',
      actor: 'guest',
      capturedAtMs: 1782594020000,
      surface: 'assessment',
      roomPhase: 'connected',
      workspaceStatus: null,
      workspaceSessionId: null,
      agentWorkspaceReady: false,
    })).toEqual({
      text: 'AI assistant opened from the video call controls',
      properties: {
        source: 'agent_call_controls_ui',
        actionId: 'open-agent-chat',
        origin: 'call',
        executedBy: 'guest',
        actionSource: 'video_call_controls',
        executionStatus: 'opened',
        capturedAtMs: 1782594020000,
        agentActionEventId: 'agent-action:guest:1782594020000:agent_call_controls_ui:call:opened:open-agent-chat',
        surface: 'assessment',
        roomPhase: 'connected',
        workspaceStatus: null,
        workspaceSessionId: null,
        agent: null,
        agentWorkspaceReady: false,
        agentResponseClaimed: false,
      },
    });
  });

  it('captures chat-panel closes as human UI actions without claiming a Devin response', () => {
    expect(buildAgentUiActionEvidence({
      actionId: 'close-agent-chat',
      origin: 'chat',
      actor: 'guest',
      capturedAtMs: 1782594030000,
      surface: 'assessment',
      roomPhase: 'connected',
      workspaceStatus: 'READY',
      workspaceSessionId: 'workspace-123',
      agentWorkspaceReady: true,
    })).toEqual({
      text: 'AI assistant chat panel closed',
      properties: {
        source: 'agent_chat_ui',
        actionId: 'close-agent-chat',
        origin: 'chat',
        executedBy: 'guest',
        actionSource: 'agent_chat_panel',
        executionStatus: 'closed',
        capturedAtMs: 1782594030000,
        agentActionEventId: 'agent-action:guest:1782594030000:agent_chat_ui:chat:closed:close-agent-chat',
        surface: 'assessment',
        roomPhase: 'connected',
        workspaceStatus: 'READY',
        workspaceSessionId: 'workspace-123',
        agent: null,
        agentWorkspaceReady: true,
        agentResponseClaimed: false,
      },
    });
  });

  it('captures Devin auth rechecks as human chat-panel UI evidence', () => {
    expect(buildAgentUiActionEvidence({
      actionId: 'check-devin-auth',
      origin: 'chat',
      actor: 'guest',
      capturedAtMs: 1782594120000,
      surface: 'assessment',
      roomPhase: 'connected',
      workspaceStatus: 'READY',
      workspaceSessionId: 'workspace-123',
      agentWorkspaceReady: true,
    })).toMatchObject({
      text: 'AI assistant requested a real Devin CLI auth recheck',
      properties: {
        source: 'agent_chat_ui',
        actionId: 'check-devin-auth',
        origin: 'chat',
        executedBy: 'guest',
        actionSource: 'agent_chat_panel',
        executionStatus: 'executed',
        capturedAtMs: 1782594120000,
        agentActionEventId: 'agent-action:guest:1782594120000:agent_chat_ui:chat:executed:check-devin-auth',
        agent: null,
        agentResponseClaimed: false,
      },
    });
  });

  it('captures Devin browser auth opens as chat-panel UI evidence', () => {
    expect(buildAgentUiActionEvidence({
      actionId: 'open-devin-auth-browser',
      origin: 'chat',
      actor: 'host',
      capturedAtMs: 1782594130000,
      surface: 'assessment',
      roomPhase: 'connected',
      workspaceStatus: 'READY',
      workspaceSessionId: 'workspace-123',
      agentWorkspaceReady: true,
    })).toMatchObject({
      text: 'AI assistant opened Devin browser authentication',
      properties: {
        source: 'agent_chat_ui',
        actionId: 'open-devin-auth-browser',
        origin: 'chat',
        executedBy: 'host',
        actionSource: 'agent_chat_panel',
        executionStatus: 'executed',
        capturedAtMs: 1782594130000,
        agentActionEventId: 'agent-action:host:1782594130000:agent_chat_ui:chat:executed:open-devin-auth-browser',
        agent: null,
        agentResponseClaimed: false,
      },
    });
  });

  it('captures assistant-panel button executions as source-backed UI evidence', () => {
    expect(buildAgentRoomActionExecutionEvidence({
      actionId: 'start-recording',
      text: 'Agent action: start recording',
      origin: 'chat',
      actor: 'host',
      capturedAtMs: 1782594200000,
      surface: 'assessment',
      roomPhase: 'connected',
      workspaceStatus: 'READY',
      workspaceSessionId: 'workspace-123',
    })).toEqual({
      text: 'Agent action: start recording',
      properties: {
        source: 'agent_chat_ui',
        actionId: 'start-recording',
        origin: 'chat',
        executedBy: 'host',
        actionSource: 'agent_chat_panel',
        agent: null,
        agentActionLabel: null,
        agentActionText: null,
        bridgeEventType: null,
        actionProtocol: null,
        agentActionObservedAt: null,
        agentActionBridgePersisted: null,
        executionStatus: 'executed',
        capturedAtMs: 1782594200000,
        agentActionEventId: 'agent-action:host:1782594200000:agent_chat_ui:chat:executed:start-recording',
        autoExecute: null,
        url: null,
        surface: 'assessment',
        roomPhase: 'connected',
        workspaceStatus: 'READY',
        workspaceSessionId: 'workspace-123',
        agentResponseClaimed: false,
      },
    });
  });

  it('captures Devin auth terminal opens as a distinct assistant-panel action', () => {
    expect(buildAgentRoomActionExecutionEvidence({
      actionId: 'open-devin-auth-terminal',
      text: 'Agent action: open terminal for Devin authentication',
      origin: 'chat',
      actor: 'host',
      capturedAtMs: 1782594210000,
      surface: 'assessment',
      roomPhase: 'connected',
      workspaceStatus: 'READY',
      workspaceSessionId: 'workspace-123',
    })).toMatchObject({
      text: 'Agent action: open terminal for Devin authentication',
      properties: {
        source: 'agent_chat_ui',
        actionId: 'open-devin-auth-terminal',
        origin: 'chat',
        executedBy: 'host',
        actionSource: 'agent_chat_panel',
        executionStatus: 'executed',
        capturedAtMs: 1782594210000,
        agentActionEventId: 'agent-action:host:1782594210000:agent_chat_ui:chat:executed:open-devin-auth-terminal',
        agent: null,
        agentResponseClaimed: false,
        surface: 'assessment',
      },
    });
  });

  it('rejects agent-origin room executions without a real bridge action packet', () => {
    expect(buildAgentRoomActionExecutionEvidence({
      actionId: 'open-terminal',
      text: 'Agent action: open terminal',
      origin: 'agent',
      actor: 'guest',
      capturedAtMs: 1782594660000,
      surface: 'assessment',
      roomPhase: 'connected',
      workspaceStatus: 'READY',
      workspaceSessionId: 'workspace-123',
    })).toBeNull();
  });

  it('rejects legacy chat-response action arrays as executable Devin room actions', () => {
    expect(buildAgentRoomActionExecutionEvidence({
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
      surface: 'assessment',
      roomPhase: 'connected',
      workspaceStatus: 'READY',
      workspaceSessionId: 'workspace-123',
    })).toBeNull();
  });

  it('links executed agent suggestions back to the real bridge action', () => {
    expect(buildAgentRoomActionExecutionEvidence({
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
        protocol: 'agent_room_action_tag',
        observedAt: '2026-06-27T21:10:00.000Z',
        persisted: true,
        autoExecute: false,
        browserPromptId: 'workspace-123:guest:prompt:1782603900000:agent_0123abcd',
        browserPromptFingerprint: 'agent_0123abcd',
        browserPromptTimestamp: 1782603900000,
        browserPromptLength: 24,
      },
      surface: 'assessment',
      roomPhase: 'connected',
      workspaceStatus: 'READY',
      workspaceSessionId: 'workspace-123',
    })).toMatchObject({
      text: 'Agent action: open terminal',
      properties: {
        source: 'agent_bridge',
        origin: 'agent',
        executedBy: 'guest',
        actionSource: 'agent_stdout_action',
        bridgeEventType: 'ROOM_ACTION',
        actionProtocol: 'agent_room_action_tag',
        agentActionObservedAt: '2026-06-27T21:10:00.000Z',
        agentActionBridgePersisted: true,
        browserPromptId: 'workspace-123:guest:prompt:1782603900000:agent_0123abcd',
        browserPromptFingerprint: 'agent_0123abcd',
        browserPromptTimestamp: 1782603900000,
        browserPromptLength: 24,
        executionStatus: 'executed',
        capturedAtMs: 1782594660000,
        agentActionEventId: 'agent-action:guest:1782594660000:agent_bridge:agent:executed:open-terminal',
        agentResponseClaimed: false,
      },
    });
  });

  it('derives Agent action ids from actor, source, origin, status, action, and capture time', () => {
    expect(buildAgentActionEventId({
      actor: 'agent',
      capturedAtMs: 1782594600000,
      source: 'agent_bridge',
      origin: 'agent',
      executionStatus: 'suggested',
      actionId: 'open-terminal',
    })).toBe('agent-action:agent:1782594600000:agent_bridge:agent:suggested:open-terminal');
  });

  it('captures user prompts as browser-to-bridge evidence without claiming an agent response', () => {
    expect(buildAgentUserChatEvidence({
      message: {
        role: 'user',
        text: 'Can you explain the failing order recovery test?',
        timestamp: 1782603900000,
        source: 'user_submit',
        browserPromptId: 'workspace-123:guest:prompt:1782603900000:agent_0123abcd',
        browserPromptFingerprint: 'agent_0123abcd',
        browserPromptTimestamp: 1782603900000,
        browserPromptLength: 48,
      },
      actor: 'guest',
      surface: 'assessment',
      roomPhase: 'connected',
      workspaceStatus: 'READY',
      workspaceSessionId: 'workspace-123',
      repoUrl: 'https://github.com/acme/orders',
    })).toMatchObject({
      text: 'Can you explain the failing order recovery test?',
      properties: {
        source: 'agent_chat_client_submit',
        agentChatEventSource: 'browser_agent_chat_panel',
        bridgeMessageType: 'CHAT',
        bridgeProtocol: 'agent_dev_container_ws',
        promptId: 'workspace-123:guest:prompt:1782603900000:agent_0123abcd',
        promptFingerprint: 'agent_0123abcd',
        promptLength: 48,
        promptTimestamp: 1782603900000,
        bridgeDeliveryStatus: 'queued',
        browserQueuedBridgeMessage: true,
        bridgeDeliveryConfirmed: false,
        agent: null,
        surface: 'assessment',
        roomPhase: 'connected',
        workspaceStatus: 'READY',
        workspaceSessionId: 'workspace-123',
        repoUrl: 'https://github.com/acme/orders',
        agentResponseClaimed: false,
      },
    });
  });

  it('captures blocked Agent prompts without claiming bridge delivery', () => {
    expect(buildAgentUserChatEvidence({
      message: {
        role: 'user',
        text: 'Can you inspect the repo before the workspace starts?',
        timestamp: 1782603950000,
        source: 'user_submit',
        deliveryStatus: 'blocked',
        blockedReason: 'workspace_required',
        browserPromptId: 'none:guest:prompt:1782603950000:agent_89abcdef',
        browserPromptFingerprint: 'agent_89abcdef',
        browserPromptTimestamp: 1782603950000,
        browserPromptLength: 51,
      },
      actor: 'guest',
      surface: 'assessment',
      roomPhase: 'connected',
      workspaceStatus: null,
      workspaceSessionId: null,
      repoUrl: null,
    })).toMatchObject({
      text: 'Can you inspect the repo before the workspace starts?',
      properties: {
        source: 'agent_chat_client_submit',
        agentChatEventSource: 'browser_agent_chat_panel',
        bridgeMessageType: 'CHAT',
        bridgeProtocol: 'agent_dev_container_ws',
        bridgeDeliveryStatus: 'blocked',
        bridgeBlockedReason: 'workspace_required',
        promptId: 'none:guest:prompt:1782603950000:agent_89abcdef',
        promptFingerprint: 'agent_89abcdef',
        promptLength: 51,
        promptTimestamp: 1782603950000,
        browserQueuedBridgeMessage: false,
        bridgeDeliveryConfirmed: false,
        agent: null,
        workspaceStatus: null,
        workspaceSessionId: null,
        agentResponseClaimed: false,
      },
    });
  });

  it('marks browser fallback Devin replies as bridge-sourced evidence, not local chat claims', () => {
    expect(buildAgentChatFallbackEvidence({
      text: 'I inspected the failing test.',
      agentName: 'devin',
      observedAt: '2026-06-27T21:05:00.000Z',
      browserPromptId: 'workspace-123:guest:prompt:1782603900000:agent_0123abcd',
      browserPromptFingerprint: 'agent_0123abcd',
      browserPromptTimestamp: 1782603900000,
      browserPromptLength: 24,
      agentRuntime: 'api',
      agentRunProvider: 'devin_api',
      agentRunId: 'devin-api:1234abcd',
      agentRunExternalSessionHash: 'sha256:1234abcd',
      surface: 'assessment',
      roomPhase: 'connected',
      workspaceStatus: 'READY',
      workspaceSessionId: 'workspace-123',
      messageTimestamp: 1782603900000,
    })).toEqual({
      text: 'I inspected the failing test.',
      properties: {
        source: 'agent_bridge',
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
        browserPromptId: 'workspace-123:guest:prompt:1782603900000:agent_0123abcd',
        browserPromptFingerprint: 'agent_0123abcd',
        browserPromptTimestamp: 1782603900000,
        browserPromptLength: 24,
        agentRuntime: 'api',
        agentRunProvider: 'devin_api',
        agentRunId: 'devin-api:1234abcd',
        agentRunExternalSessionHash: 'sha256:1234abcd',
        surface: 'assessment',
        roomPhase: 'connected',
        workspaceStatus: 'READY',
        workspaceSessionId: 'workspace-123',
        messageTimestamp: 1782603900000,
        agentResponseClaimed: true,
      },
    });
  });

  it('does not fabricate Devin identity in direct browser fallback or status builders', () => {
    expect(buildAgentChatFallbackEvidence({
      text: 'I inspected the failing test.',
      agentName: null,
      observedAt: '2026-06-27T21:05:00.000Z',
      surface: 'assessment',
      roomPhase: 'connected',
      workspaceStatus: 'READY',
      workspaceSessionId: 'workspace-123',
      messageTimestamp: 1782603900000,
    })).toBeNull();

    expect(buildAgentStatusEvidence({
      text: 'bridge is starting',
      agentName: null,
      status: 'starting',
      bridgeMessageSource: 'agent_status',
      observedAt: '2026-06-27T21:12:00.000Z',
      capturedAtMs: 1782594720000,
      surface: 'assessment',
      roomPhase: 'connected',
      workspaceStatus: 'READY',
      workspaceSessionId: 'workspace-123',
      messageTimestamp: 1782594720000,
    })).toBeNull();
  });

  it('converts browser-observed Devin replies into agent chat evidence only when source metadata is present', () => {
    expect(buildAgentMessageSessionEvidence({
      text: 'I inspected the failing test.',
      source: 'agent_stdout',
      agentName: 'devin',
      observedAt: '2026-06-27T21:05:00.000Z',
      browserPromptId: 'workspace-123:guest:prompt:1782603900000:agent_0123abcd',
      browserPromptFingerprint: 'agent_0123abcd',
      browserPromptTimestamp: 1782603900000,
      browserPromptLength: 24,
      agentRuntime: 'api',
      agentRunProvider: 'devin_api',
      agentRunId: 'devin-api:1234abcd',
      agentRunExternalSessionHash: 'sha256:1234abcd',
      surface: 'assessment',
      roomPhase: 'connected',
      workspaceStatus: 'READY',
      workspaceSessionId: 'workspace-123',
      messageTimestamp: 1782603900000,
    })).toMatchObject({
      eventType: 'ai_chat_agent',
      text: 'I inspected the failing test.',
      properties: {
        source: 'agent_bridge',
        bridgeEventType: 'CHAT_RESPONSE',
        bridgeMessageSource: 'agent_stdout',
        observedAt: '2026-06-27T21:05:00.000Z',
        browserPromptId: 'workspace-123:guest:prompt:1782603900000:agent_0123abcd',
        browserPromptFingerprint: 'agent_0123abcd',
        browserPromptTimestamp: 1782603900000,
        browserPromptLength: 24,
        agentRuntime: 'api',
        agentRunProvider: 'devin_api',
        agentRunId: 'devin-api:1234abcd',
        agentRunExternalSessionHash: 'sha256:1234abcd',
        agentResponseClaimed: true,
      },
    });
  });

  it('redacts Devin bridge output before deriving source-backed fallback evidence', () => {
    const evidence = buildAgentMessageSessionEvidence({
      text: 'I inspected auth with DEVIN_API_KEY=cog_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa and /api/v1/meeting-rooms/live-room-token?token=raw-token.',
      source: 'agent_stdout',
      agentName: 'devin',
      observedAt: '2026-06-27T21:05:00.000Z',
      surface: 'assessment',
      roomPhase: 'connected',
      workspaceStatus: 'READY',
      workspaceSessionId: 'workspace-123',
      messageTimestamp: 1782603900000,
    });

    expect(evidence).not.toBeNull();
    if (!evidence) throw new Error('expected redacted agent fallback evidence');
    expect(evidence.eventType).toBe('ai_chat_agent');
    expect(evidence.text).toContain('DEVIN_API_KEY=[REDACTED_SECRET]');
    expect(evidence.text).toContain('/api/v1/meeting-rooms/[REDACTED_SECRET]');
    expect(evidence.text).not.toContain('cog_aaaaaaaa');
    expect(evidence.text).not.toContain('live-room-token');
    expect(evidence.properties.responseLength).toBe(evidence.text.length);
    expect(evidence.properties.responseFingerprint).toBe(agentResponseFingerprint(evidence.text));
  });

  it('records source-backed diagnostics instead of fake replies when agent stdout lacks observation metadata', () => {
    expect(buildAgentMessageSessionEvidence({
      text: 'I inspected the failing test.',
      source: 'agent_stdout',
      agentName: 'devin',
      agentStatus: 'thinking',
      surface: 'assessment',
      roomPhase: 'connected',
      workspaceStatus: 'READY',
      workspaceSessionId: 'workspace-123',
      messageTimestamp: 1700000000000,
    })).toEqual({
      eventType: 'ai_agent_status',
      text: 'AI assistant/Devin response was not recorded as agent evidence because bridge source metadata was missing.',
      properties: {
        source: 'agent_bridge',
        agentStatusEventSource: 'browser_agent_ws',
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
        surface: 'assessment',
        roomPhase: 'connected',
        workspaceStatus: 'READY',
        workspaceSessionId: 'workspace-123',
        messageTimestamp: 1700000000000,
        agentResponseClaimed: false,
      },
    });
  });

  it('keeps browser prompt references on source-backed bridge handoff diagnostics', () => {
    expect(buildAgentMessageSessionEvidence({
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
      browserPromptId: 'workspace-123:guest:prompt:1782603900000:agent_0123abcd',
      browserPromptFingerprint: 'agent_0123abcd',
      browserPromptTimestamp: 1782603900000,
      browserPromptLength: 18,
      agentRuntime: 'api',
      agentRunProvider: 'devin_api',
      agentRunId: 'devin-api:1234abcd',
      agentRunExternalSessionHash: 'sha256:1234abcd',
      surface: 'assessment',
      roomPhase: 'connected',
      workspaceStatus: 'READY',
      workspaceSessionId: 'workspace-123',
      messageTimestamp: 1782603901000,
    })).toMatchObject({
      eventType: 'ai_agent_status',
      text: 'devin chat prompt delivered to process stdin.',
      properties: {
        source: 'agent_bridge',
        bridgeMessageSource: 'bridge_diagnostic',
        diagnosticSource: 'agent_prompt_sent',
        promptType: 'chat_prompt',
        deliveredToAgent: true,
        browserPromptId: 'workspace-123:guest:prompt:1782603900000:agent_0123abcd',
        browserPromptFingerprint: 'agent_0123abcd',
        browserPromptTimestamp: 1782603900000,
        browserPromptLength: 18,
        agentRuntime: 'api',
        agentRunProvider: 'devin_api',
        agentRunId: 'devin-api:1234abcd',
        agentRunExternalSessionHash: 'sha256:1234abcd',
        agentResponseClaimed: false,
      },
    });
  });

  it('redacts source-backed bridge status diagnostics before persistence', () => {
    const evidence = buildAgentStatusEvidence({
      text: 'Auth failed with Bearer ghp_bbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      agentName: 'devin',
      status: 'auth_needed',
      bridgeMessageSource: 'bridge_diagnostic',
      diagnosticSource: 'agent_auth_check',
      observedAt: '2026-06-27T21:12:00.000Z',
      capturedAtMs: 1782594720000,
      surface: 'assessment',
      roomPhase: 'connected',
      workspaceStatus: 'READY',
      workspaceSessionId: 'workspace-123',
      messageTimestamp: 1782594720000,
    });

    expect(evidence).not.toBeNull();
    if (!evidence) throw new Error('expected redacted agent status evidence');
    expect(evidence.text).toBe('Auth failed with Bearer [REDACTED_SECRET]');
    expect(evidence.properties.agentStatusEventId).toBe(
      'agent-status:devin:1782594720000:bridge_diagnostic:auth_needed:agent_auth_check',
    );
  });

  it('does not fabricate bridge diagnostics when an agent message has no bridge source', () => {
    expect(buildAgentMessageSessionEvidence({
      text: 'A message with no bridge source.',
      agentName: 'devin',
      diagnosticSource: 'agent_exit',
      observedAt: '2026-06-27T21:05:00.000Z',
      surface: 'assessment',
      roomPhase: 'connected',
      workspaceStatus: 'READY',
      workspaceSessionId: 'workspace-123',
      messageTimestamp: 1782603900000,
    })).toBeNull();
  });

  it('does not fabricate agent identity when bridge source exists but agent name is missing', () => {
    expect(buildAgentMessageSessionEvidence({
      text: 'I inspected the failing test.',
      source: 'agent_stdout',
      observedAt: '2026-06-27T21:05:00.000Z',
      surface: 'assessment',
      roomPhase: 'connected',
      workspaceStatus: 'READY',
      workspaceSessionId: 'workspace-123',
      messageTimestamp: 1782603900000,
    })).toBeNull();
  });

  it('derives response ids from agent, capture time, and response fingerprint', () => {
    const responseFingerprint = agentResponseFingerprint('I inspected the failing test.');
    expect(responseFingerprint).toBe('agent_314a13fc');
    expect(buildAgentChatResponseId({
      agentName: 'devin',
      capturedAtMs: 1782594300000,
      responseFingerprint,
    })).toBe('agent-chat:devin:1782594300000:CHAT_RESPONSE:agent_314a13fc');
  });

  it('builds stable source-backed status evidence for browser-observed Devin bridge states', () => {
    expect(buildAgentStatusEvidence({
      text: 'devin is starting from the real container bridge.',
      agentName: 'devin',
      status: 'starting',
      bridgeMessageSource: 'agent_status',
      observedAt: '2026-06-27T21:12:00.000Z',
      capturedAtMs: 1782594720000,
      surface: 'assessment',
      roomPhase: 'connected',
      workspaceStatus: 'READY',
      workspaceSessionId: 'workspace-123',
      messageTimestamp: 1782594720000,
    })).toEqual({
      text: 'devin is starting from the real container bridge.',
      properties: {
        source: 'agent_bridge',
        agentStatusEventSource: 'browser_agent_ws',
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
        surface: 'assessment',
        roomPhase: 'connected',
        workspaceStatus: 'READY',
        workspaceSessionId: 'workspace-123',
        messageTimestamp: 1782594720000,
        agentResponseClaimed: false,
      },
    });
  });

  it('derives status ids from agent, source, status, diagnostic, and capture time', () => {
    expect(buildAgentStatusEventId({
      agentName: 'devin',
      capturedAtMs: 1782604380000,
      bridgeMessageSource: 'bridge_diagnostic',
      status: 'thinking',
      diagnosticSource: 'agent_prompt_sent',
    })).toBe('agent-status:devin:1782604380000:bridge_diagnostic:thinking:agent_prompt_sent');
  });
});
