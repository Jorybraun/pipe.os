// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClippyAssistant } from './ClippyAssistant';
import { useAgentConnection } from '../hooks/useAgentConnection';
import type { AgentChatMessage } from '../hooks/useAgentConnection';

vi.mock('clippyjs', () => ({
  initAgent: vi.fn(async () => ({
    animate: vi.fn(),
    dispose: vi.fn(),
    hide: vi.fn(),
    moveTo: vi.fn(),
    play: vi.fn(),
    show: vi.fn(),
    speak: vi.fn(),
  })),
}));

vi.mock('clippyjs/agents/clippy', () => ({
  default: {
    agent: {},
    map: {},
    sound: {},
  },
}));

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

describe('ClippyAssistant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAgentConnection();
  });

  it('opens a real-agent status panel before the workspace bridge is active', async () => {
    const onAction = vi.fn();
    const { rerender } = render(
      <ClippyAssistant
        messages={[]}
        onDismiss={vi.fn()}
        agentEnabled={false}
        agentWsUrl={null}
        agentUnavailableMessage="Launch the VS Code workspace to connect real Devin."
        canLaunchAgentWorkspace
        openChatRequest={0}
        onAction={onAction}
      />,
    );

    expect(screen.queryByTestId('clippy-open-chat')).toBeNull();

    rerender(
      <ClippyAssistant
        messages={[]}
        onDismiss={vi.fn()}
        agentEnabled={false}
        agentWsUrl={null}
        agentUnavailableMessage="Launch the VS Code workspace to connect real Devin."
        canLaunchAgentWorkspace
        openChatRequest={1}
        onAction={onAction}
      />,
    );

    expect((await screen.findByTestId('clippy-chat')).textContent).toContain(
      'Launch the VS Code workspace to connect real Devin.',
    );
    expect(screen.getByTestId('clippy-chat-input').hasAttribute('disabled')).toBe(true);

    fireEvent.click(screen.getByTestId('clippy-launch-workspace'));
    expect(onAction).toHaveBeenCalledWith('launch-workspace');
  });

  it('sends chat only through the connected Devin bridge', async () => {
    const userMessage: AgentChatMessage = {
      role: 'user',
      text: 'inspect the repo task',
      timestamp: 42,
      source: 'user_submit',
    };
    const sendMessage = vi.fn(() => userMessage);
    const onUserChatMessage = vi.fn();
    mockAgentConnection({
      connected: true,
      status: 'idle',
      capabilities: ['chat'],
      sendMessage,
    });

    render(
      <ClippyAssistant
        messages={[]}
        onDismiss={vi.fn()}
        agentEnabled
        agentWsUrl="wss://room.test/agent"
        openChatRequest={1}
        onUserChatMessage={onUserChatMessage}
      />,
    );

    fireEvent.change(await screen.findByTestId('clippy-chat-input'), {
      target: { value: 'inspect the repo task' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(sendMessage).toHaveBeenCalledWith('inspect the repo task');
    expect(onUserChatMessage).toHaveBeenCalledWith(userMessage);
  });
});
