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
        agentUnavailableMessage="Launch the VS Code workspace to connect a real agent."
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
        agentUnavailableMessage="Launch the VS Code workspace to connect a real agent."
        canLaunchAgentWorkspace
        openChatRequest={1}
        onAction={onAction}
      />,
    );

    expect((await screen.findByTestId('clippy-chat')).textContent).toContain(
      'Launch the VS Code workspace to connect a real agent.',
    );
    expect(screen.getByTestId('clippy-chat-input').hasAttribute('disabled')).toBe(true);

    fireEvent.click(screen.getByTestId('clippy-launch-workspace'));
    expect(onAction).toHaveBeenCalledWith('launch-workspace');
  });

  it('does not render or enable a fake Devin identity before the bridge reports an agent name', async () => {
    const sendMessage = vi.fn(() => null);
    mockAgentConnection({
      connected: true,
      status: 'idle',
      agentName: '',
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
      />,
    );

    const chat = await screen.findByTestId('clippy-chat');
    expect(chat.textContent).toContain(
      'Waiting for the container bridge to report a real agent identity before chat is enabled.',
    );
    expect(chat.textContent).not.toContain('Devin');
    expect(chat.textContent).not.toContain('devin');
    expect(screen.getByTestId('clippy-chat-input').hasAttribute('disabled')).toBe(true);

    fireEvent.change(screen.getByTestId('clippy-chat-input'), {
      target: { value: 'inspect the repo task' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(sendMessage).not.toHaveBeenCalled();
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

  it('keeps chat disabled while the real bridge agent is starting and before capabilities arrive', async () => {
    const sendMessage = vi.fn(() => null);
    mockAgentConnection({
      connected: true,
      status: 'starting',
      capabilities: [],
      sendMessage,
    });

    render(
      <ClippyAssistant
        messages={[]}
        onDismiss={vi.fn()}
        agentEnabled
        agentWsUrl="wss://room.test/agent"
        openChatRequest={1}
      />,
    );

    expect((await screen.findByTestId('clippy-chat')).textContent).toContain(
      'Clippy is starting devin inside the dev container.',
    );
    expect(screen.getByTestId('clippy-chat-input').hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Send' }).hasAttribute('disabled')).toBe(true);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('opens a real Devin login terminal when the bridge reports auth needed without a browser auth URL', async () => {
    const onOpenAuthTerminal = vi.fn();
    const sendMessage = vi.fn(() => null);
    mockAgentConnection({
      connected: true,
      status: 'auth_needed',
      authUrl: null,
      authMessage: 'Devin CLI is not logged in. Run devin auth login --force-manual-token-flow.',
      capabilities: [],
      sendMessage,
    });

    render(
      <ClippyAssistant
        messages={[]}
        onDismiss={vi.fn()}
        agentEnabled
        agentWsUrl="wss://room.test/agent"
        openChatRequest={1}
        onOpenAuthTerminal={onOpenAuthTerminal}
      />,
    );

    const chat = await screen.findByTestId('clippy-chat');
    expect(chat.textContent).toContain('Devin CLI is not logged in.');
    expect(screen.getByTestId('clippy-chat-input').hasAttribute('disabled')).toBe(true);

    fireEvent.click(screen.getByTestId('clippy-open-auth-terminal'));
    expect(onOpenAuthTerminal).toHaveBeenCalledTimes(1);
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
