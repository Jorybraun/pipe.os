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
    const text = redactDiagnosticText(
      'DEVIN_API_KEY=sk-live-secret Bearer abc.def TOKEN=raw-token https://x.test/?token=abc123',
    );

    expect(text).toContain('DEVIN_API_KEY=[redacted]');
    expect(text).toContain('Bearer [redacted]');
    expect(text).toContain('TOKEN=[redacted]');
    expect(text).toContain('token=[redacted]');
    expect(text).not.toContain('sk-live-secret');
    expect(text).not.toContain('raw-token');
  });

  it('classifies Devin auth/login output as auth failure evidence', () => {
    expect(isAgentAuthFailureText('Please run devin auth login before continuing.')).toBe(true);
    expect(isAgentAuthFailureText('Authentication failed: invalid credential.')).toBe(true);
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
        promptType: 'chat_prompt',
        deliveredToAgent: true,
        promptFingerprint: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        roomContextFingerprint: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        userMessageFingerprint: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
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
        actionCount: 1,
        bridgePersisted: true,
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
        agentActionText: 'Open a terminal so we can inspect the failure TOKEN=[redacted]',
        autoExecute: false,
        url: null,
        observedAt: '2026-06-27T21:10:00.000Z',
        bridgePersisted: true,
      },
    });
  });
});
