// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentAssistant } from './AgentAssistant';
import { useAgentConnection } from '../hooks/useAgentConnection';
import type { AgentChatMessage } from '../hooks/useAgentConnection';

vi.mock('../hooks/useAgentConnection', () => ({
  useAgentConnection: vi.fn(),
}));

const mockUseAgentConnection = vi.mocked(useAgentConnection);

function mockAgentConnection(overrides: Partial<ReturnType<typeof useAgentConnection>> = {}): void {
  mockUseAgentConnection.mockReturnValue({
    connected: false,
    status: 'disconnected',
    messages: [],
    authUrl: null,
    authMessage: null,
    agentName: 'devin',
    capabilities: [],
    roomActions: [],
    fileChanges: [],
    sendMessage: vi.fn(() => null),
    startAuth: vi.fn(),
    stopAgent: vi.fn(),
    ...overrides,
  });
}

describe('AgentAssistant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAgentConnection();
  });

  it('renders a plain AI assistant prompt without the removed mascot hotspot', () => {
    render(
      <AgentAssistant
        messages={[{ text: 'Open the workspace when you are ready.', hold: true }]}
        onDismiss={vi.fn()}
        agentEnabled={false}
        agentWsUrl={null}
      />,
    );

    expect(screen.getByTestId('assistant-prompt').textContent).toContain('AI assistant');
    expect(screen.getByTestId('assistant-prompt').textContent).toContain('Open the workspace');
    expect(screen.queryByTestId('agent-hotspot')).toBeNull();
    expect(screen.queryByTestId('agent-character')).toBeNull();
  });

  it('opens the bridge panel, hides the prompt, and records blocked prompts honestly', () => {
    const onChatOpen = vi.fn();
    const onUserChatMessage = vi.fn();

    render(
      <AgentAssistant
        messages={[{ text: 'I can help once the workspace is connected.', hold: true }]}
        onDismiss={vi.fn()}
        onChatOpen={onChatOpen}
        onUserChatMessage={onUserChatMessage}
        agentEnabled={false}
        agentWsUrl={null}
        canLaunchAgentWorkspace
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open chat' }));

    expect(screen.queryByTestId('assistant-prompt')).toBeNull();
    expect(screen.getByTestId('agent-chat').textContent).toContain('AI assistant');
    expect(screen.getByTestId('agent-bridge-checklist').textContent).toContain('Workspace');
    expect(screen.getByTestId('agent-launch-workspace').textContent).toContain('Launch workspace');
    expect(onChatOpen).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByTestId('agent-chat-input'), {
      target: { value: 'can you inspect the repo?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(onUserChatMessage).toHaveBeenCalledWith(expect.objectContaining({
      text: 'can you inspect the repo?',
      deliveryStatus: 'blocked',
      blockedReason: 'workspace_required',
    }));
    expect(screen.getByTestId('agent-chat').textContent).toContain(
      'The assistant could not send that because the dev workspace is not running.',
    );
  });

  it('sends prompts only through a connected real agent bridge', () => {
    const sentMessage: AgentChatMessage = {
      role: 'user',
      text: 'summarize the failing tests',
      timestamp: 1782604700000,
      source: 'user_submit',
      deliveryStatus: 'queued',
    };
    const sendMessage = vi.fn(() => sentMessage);
    const onUserChatMessage = vi.fn();
    mockAgentConnection({
      connected: true,
      status: 'idle',
      agentName: 'devin',
      capabilities: ['chat'],
      sendMessage,
    });

    render(
      <AgentAssistant
        messages={[]}
        onDismiss={vi.fn()}
        onUserChatMessage={onUserChatMessage}
        agentEnabled
        agentWsUrl="wss://agent.example/ws"
        openChatRequest={1}
      />,
    );

    fireEvent.change(screen.getByTestId('agent-chat-input'), {
      target: { value: 'summarize the failing tests' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(sendMessage).toHaveBeenCalledWith('summarize the failing tests');
    expect(onUserChatMessage).toHaveBeenCalledWith(sentMessage);
    expect(screen.getByTestId('agent-chat').textContent).toContain('Connected to devin');
  });
});
