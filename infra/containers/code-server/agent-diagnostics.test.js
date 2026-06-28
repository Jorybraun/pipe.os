import { describe, expect, it } from 'vitest';
import diagnostics from './agent-diagnostics.js';

const {
  agentDiagnosticMessage,
  agentDiagnosticSessionEvent,
  agentChatSessionEvent,
  agentRoomActionSessionEvent,
  agentPromptHandoffDiagnosticMessage,
  boundedDiagnosticText,
  isAgentAuthFailureText,
  redactDiagnosticText,
} = diagnostics;

describe('agent diagnostics', () => {
  it('redacts likely secrets from bridge diagnostics', () => {
    const cognitionLikeToken = 'cog_fakeServiceUserToken0123456789abcdef';
    const text = redactDiagnosticText(
      `DEVIN_API_KEY=sk-live-secret Bearer abc.def TOKEN=raw-token ${cognitionLikeToken} /api/v1/meeting-rooms/raw-room-token?token=abc123`,
    );

    expect(text).toContain('DEVIN_API_KEY=[REDACTED_SECRET]');
    expect(text).toContain('Bearer [REDACTED_SECRET]');
    expect(text).toContain('TOKEN=[REDACTED_SECRET]');
    expect(text).toContain('[REDACTED_SECRET]');
    expect(text).toContain('/api/v1/meeting-rooms/[REDACTED_SECRET]');
    expect(text).toContain('token=[REDACTED_SECRET]');
    expect(text).not.toContain('sk-live-secret');
    expect(text).not.toContain('raw-token');
    expect(text).not.toContain('raw-room-token');
    expect(text).not.toContain(cognitionLikeToken);
  });

  it('classifies Devin auth/login output as auth failure evidence', () => {
    expect(isAgentAuthFailureText('Please run devin auth login before continuing.')).toBe(true);
    expect(isAgentAuthFailureText('Authentication failed: invalid credential.')).toBe(true);
    expect(isAgentAuthFailureText('Error: Login canceled')).toBe(true);
    expect(isAgentAuthFailureText('I inspected the failing test.')).toBe(false);
  });

  it('bounds diagnostic text without fabricating missing context', () => {
    expect(boundedDiagnosticText('abcdef', 3)).toEqual({
      text: 'abc\n[diagnostic truncated]',
      truncated: true,
    });
    expect(boundedDiagnosticText('ok', 10)).toEqual({
      text: 'ok',
      truncated: false,
    });
  });

  it('does not fabricate Devin identity for agent evidence without an explicit agent', () => {
    expect(agentDiagnosticMessage({
      status: 'disconnected',
      message: 'process exited',
      diagnosticSource: 'agent_exit',
      observedAt: '2026-06-27T19:00:00.000Z',
    })).toBeNull();

    expect(agentPromptHandoffDiagnosticMessage({
      status: 'thinking',
      promptType: 'chat_prompt',
      deliveredToAgent: true,
      roomContextStatus: 200,
      roomContextText: 'Room context',
      promptText: 'Prompt text',
      observedAt: '2026-06-27T20:00:00.000Z',
    })).toBeNull();

    expect(agentDiagnosticSessionEvent({
      type: 'AGENT_DIAGNOSTIC',
      status: 'idle',
      message: 'source-less diagnostic',
      diagnosticSource: 'agent_stdout',
      observedAt: '2026-06-27T21:00:00.000Z',
    })).toBeNull();

    expect(agentChatSessionEvent({
      text: 'I inspected the failing test.',
      observedAt: '2026-06-27T21:05:00.000Z',
    })).toBeNull();

    expect(agentRoomActionSessionEvent({
      action: {
        action: 'open-terminal',
        source: 'agent_stdout',
        protocol: 'clippy_room_action_tag',
      },
      observedAt: '2026-06-27T21:10:00.000Z',
    })).toBeNull();
  });

  it('builds source-marked agent diagnostic messages', () => {
    expect(agentDiagnosticMessage({
      agent: 'devin',
      status: 'disconnected',
      message: 'process exited',
      diagnosticSource: 'agent_exit',
      observedAt: '2026-06-27T19:00:00.000Z',
      exitCode: 1,
      signal: null,
    })).toEqual({
      type: 'AGENT_DIAGNOSTIC',
      agent: 'devin',
      status: 'disconnected',
      message: 'process exited',
      diagnosticSource: 'agent_exit',
      observedAt: '2026-06-27T19:00:00.000Z',
      exitCode: 1,
      signal: null,
      truncated: false,
    });
  });

  it('builds prompt handoff diagnostics without storing raw prompt text', () => {
    const message = agentPromptHandoffDiagnosticMessage({
      agent: 'devin',
      status: 'thinking',
      promptType: 'chat_prompt',
      deliveredToAgent: true,
      roomContextStatus: 200,
      roomContextText: 'Candidate opened VS Code with token=room-secret',
      promptText: 'PIPE room context\nCurrent Clippy chat message: please run the tests TOKEN=hidden',
      userMessage: 'please run the tests TOKEN=hidden',
      browserPromptId: 'workspace-123:guest:prompt:1782603900000:clippy_0123abcd',
      browserPromptFingerprint: 'clippy_0123abcd',
      browserPromptTimestamp: 1782603900000,
      browserPromptLength: 35,
      observedAt: '2026-06-27T20:00:00.000Z',
    });

    expect(message).toMatchObject({
      type: 'AGENT_DIAGNOSTIC',
      agent: 'devin',
      status: 'thinking',
      message: 'devin chat prompt delivered to process stdin.',
      diagnosticSource: 'agent_prompt_sent',
      observedAt: '2026-06-27T20:00:00.000Z',
      promptType: 'chat_prompt',
      deliveredToAgent: true,
      promptLength: expect.any(Number),
      promptFingerprint: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      roomContextStatus: 200,
      roomContextLength: expect.any(Number),
      roomContextFingerprint: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      userMessageLength: expect.any(Number),
      userMessageFingerprint: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      contextTruncated: false,
      browserPromptId: 'workspace-123:guest:prompt:1782603900000:clippy_0123abcd',
      browserPromptFingerprint: 'clippy_0123abcd',
      browserPromptTimestamp: 1782603900000,
      browserPromptLength: 35,
    });

    const serialized = JSON.stringify(message);
    expect(serialized).not.toContain('please run the tests');
    expect(serialized).not.toContain('Candidate opened VS Code');
    expect(serialized).not.toContain('room-secret');
    expect(serialized).not.toContain('hidden');
  });

  it('marks failed context-primer handoffs as diagnostics', () => {
    expect(agentPromptHandoffDiagnosticMessage({
      agent: 'devin',
      status: 'idle',
      promptType: 'context_primer',
      deliveredToAgent: false,
      roomContextStatus: 200,
      roomContextText: 'Large context\n[PIPE room context truncated]',
      promptText: 'PIPE room context\nLarge context\n[PIPE room context truncated]',
      observedAt: '2026-06-27T20:05:00.000Z',
    })).toMatchObject({
      type: 'AGENT_DIAGNOSTIC',
      agent: 'devin',
      status: 'idle',
      message: 'devin context primer was not delivered to process stdin.',
      diagnosticSource: 'agent_context_primer_sent',
      observedAt: '2026-06-27T20:05:00.000Z',
      promptType: 'context_primer',
      deliveredToAgent: false,
      contextTruncated: true,
    });
  });

  it('builds source-backed session events for agent diagnostics without raw prompts', () => {
    const diagnostic = agentPromptHandoffDiagnosticMessage({
      agent: 'devin',
      status: 'thinking',
      promptType: 'chat_prompt',
      deliveredToAgent: true,
      roomContextStatus: 200,
      roomContextText: 'Room context with TOKEN=secret',
      promptText: 'Private prompt with TOKEN=secret',
      userMessage: 'Private user message',
      browserPromptId: 'workspace-123:guest:prompt:1782603900000:clippy_0123abcd',
      browserPromptFingerprint: 'clippy_0123abcd',
      browserPromptTimestamp: 1782603900000,
      browserPromptLength: 20,
      observedAt: '2026-06-27T21:00:00.000Z',
    });

    expect(agentDiagnosticSessionEvent(diagnostic)).toMatchObject({
      type: 'ai_agent_status',
      text: 'devin chat prompt delivered to process stdin.',
      actor: 'agent',
      properties: {
        source: 'clippy_agent_bridge',
        agent: 'devin',
        status: 'thinking',
        diagnosticSource: 'agent_prompt_sent',
        bridgeMessageSource: 'bridge_diagnostic',
        observedAt: '2026-06-27T21:00:00.000Z',
        capturedAtMs: 1782594000000,
        agentStatusEventId: 'agent-status:devin:1782594000000:bridge_diagnostic:thinking:agent_prompt_sent',
        promptType: 'chat_prompt',
        deliveredToAgent: true,
        promptFingerprint: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        roomContextFingerprint: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        userMessageFingerprint: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        browserPromptId: 'workspace-123:guest:prompt:1782603900000:clippy_0123abcd',
        browserPromptFingerprint: 'clippy_0123abcd',
        browserPromptTimestamp: 1782603900000,
        browserPromptLength: 20,
        bridgePersisted: true,
      },
    });

    const serialized = JSON.stringify(agentDiagnosticSessionEvent(diagnostic));
    expect(serialized).not.toContain('Private prompt');
    expect(serialized).not.toContain('Private user message');
    expect(serialized).not.toContain('secret');
  });

  it('builds source-backed session events for real Devin stdout', () => {
    expect(agentChatSessionEvent({
      agent: 'devin',
      text: 'I inspected the failing test.',
      observedAt: '2026-06-27T21:05:00.000Z',
      actionCount: 1,
      browserPromptId: 'workspace-123:guest:prompt:1782603900000:clippy_0123abcd',
      browserPromptFingerprint: 'clippy_0123abcd',
      browserPromptTimestamp: 1782603900000,
      browserPromptLength: 24,
    })).toEqual({
      type: 'ai_chat_agent',
      text: 'I inspected the failing test.',
      actor: 'agent',
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
        actionCount: 1,
        browserPromptId: 'workspace-123:guest:prompt:1782603900000:clippy_0123abcd',
        browserPromptFingerprint: 'clippy_0123abcd',
        browserPromptTimestamp: 1782603900000,
        browserPromptLength: 24,
        bridgePersisted: true,
      },
    });
  });

  it('builds source-backed session events for real Devin API responses', () => {
    expect(agentChatSessionEvent({
      agent: 'devin',
      text: 'I inspected the failing test.',
      observedAt: '2026-06-27T21:05:00.000Z',
      bridgeMessageSource: 'agent_api_response',
      browserPromptId: 'workspace-123:guest:prompt:1782603900000:clippy_0123abcd',
      browserPromptFingerprint: 'clippy_0123abcd',
      browserPromptTimestamp: 1782603900000,
      browserPromptLength: 24,
    })).toMatchObject({
      type: 'ai_chat_agent',
      text: 'I inspected the failing test.',
      actor: 'agent',
      properties: {
        source: 'clippy_agent_bridge',
        agent: 'devin',
        bridgeEventType: 'CHAT_RESPONSE',
        bridgeMessageSource: 'agent_api_response',
        browserPromptId: 'workspace-123:guest:prompt:1782603900000:clippy_0123abcd',
      },
    });
  });

  it('builds source-backed session events for real Devin room action suggestions', () => {
    expect(agentRoomActionSessionEvent({
      agent: 'devin',
      action: {
        action: 'open-terminal',
        label: 'Open Terminal',
        text: 'Open a terminal so we can inspect the failure TOKEN=secret',
        source: 'agent_stdout',
        protocol: 'clippy_room_action_tag',
        autoExecute: false,
        browserPromptId: 'workspace-123:guest:prompt:1782603900000:clippy_0123abcd',
        browserPromptFingerprint: 'clippy_0123abcd',
        browserPromptTimestamp: 1782603900000,
        browserPromptLength: 24,
      },
      observedAt: '2026-06-27T21:10:00.000Z',
    })).toEqual({
      type: 'clippy_action',
      text: 'devin suggested room action: open-terminal',
      actor: 'agent',
      properties: {
        source: 'clippy_agent_bridge',
        origin: 'agent',
        executionStatus: 'suggested',
        actionId: 'open-terminal',
        actionSource: 'agent_stdout',
        actionProtocol: 'clippy_room_action_tag',
        bridgeEventType: 'ROOM_ACTION',
        agent: 'devin',
        agentActionLabel: 'Open Terminal',
        agentActionText: 'Open a terminal so we can inspect the failure TOKEN=[REDACTED_SECRET]',
        autoExecute: false,
        url: null,
        browserPromptId: 'workspace-123:guest:prompt:1782603900000:clippy_0123abcd',
        browserPromptFingerprint: 'clippy_0123abcd',
        browserPromptTimestamp: 1782603900000,
        browserPromptLength: 24,
        observedAt: '2026-06-27T21:10:00.000Z',
        capturedAtMs: 1782594600000,
        clippyActionEventId: 'clippy-action:agent:1782594600000:clippy_agent_bridge:agent:suggested:open-terminal',
        bridgePersisted: true,
      },
    });
  });

  it('does not fabricate source metadata for incomplete room action suggestions', () => {
    expect(agentRoomActionSessionEvent({
      agent: 'devin',
      action: {
        action: 'open-terminal',
        label: 'Open Terminal',
        text: 'Open a terminal so we can inspect the failure.',
      },
      observedAt: '2026-06-27T21:10:00.000Z',
    })).toBeNull();

    expect(agentRoomActionSessionEvent({
      agent: 'devin',
      action: {
        action: 'open-terminal',
        label: 'Open Terminal',
        text: 'Open a terminal so we can inspect the failure.',
        source: 'agent_stdout',
        protocol: 'bridge_actions_field',
      },
      observedAt: '2026-06-27T21:10:00.000Z',
    })).toBeNull();
  });

  it('redacts real Devin stdout before building response ids and lengths', () => {
    const event = agentChatSessionEvent({
      agent: 'devin',
      text: 'I inspected auth with DEVIN_API_KEY=cog_fakeServiceUserToken0123456789abcdef.',
      observedAt: '2026-06-27T21:05:00.000Z',
      actionCount: 0,
    });

    expect(event).not.toBeNull();
    expect(event.text).toBe('I inspected auth with DEVIN_API_KEY=[REDACTED_SECRET]');
    expect(event.text).not.toContain('cog_fakeServiceUserToken');
    expect(event.properties.responseLength).toBe(event.text.length);
    expect(event.properties.agentChatResponseId).toContain(event.properties.responseFingerprint);
  });
});
