// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClippyAssistant } from './ClippyAssistant';
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

describe('ClippyAssistant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAgentConnection();
  });

  it('renders one controlled Clippy character without mounting the old duplicate clippyjs sprite', () => {
    render(
      <ClippyAssistant
        messages={[{ text: 'Need help opening the workspace?', hold: true }]}
        onDismiss={vi.fn()}
        agentEnabled={false}
        agentWsUrl={null}
      />,
    );

    expect(document.querySelector('[data-clippy-anchor]')).toBeNull();
    expect(screen.getByTestId('clippy-character')).not.toBeNull();
    expect(screen.getByTestId('clippy-proactive-card').textContent).toContain('Need help opening the workspace?');
  });

  it('anchors the proactive speech bubble to a visible Clippy character', () => {
    render(
      <ClippyAssistant
        messages={[{ text: 'I can help when the workspace is ready.', hold: true }]}
        onDismiss={vi.fn()}
        agentEnabled={false}
        agentWsUrl={null}
      />,
    );

    const shell = screen.getByTestId('clippy-proactive-shell');
    const card = screen.getByTestId('clippy-proactive-card');
    const character = screen.getByTestId('clippy-character');

    expect(shell.contains(card)).toBe(true);
    expect(shell.contains(character)).toBe(true);
    expect(shell.children.item(shell.children.length - 1)).toBe(character);
  });

  it('dismisses only the current prompt, leaving Clippy chat recoverable', async () => {
    const onDismiss = vi.fn();
    const onChatOpen = vi.fn();
    const { rerender } = render(
      <ClippyAssistant
        messages={[{ text: 'Need help opening the workspace?', hold: true }]}
        onDismiss={onDismiss}
        onChatOpen={onChatOpen}
        agentEnabled={false}
        agentWsUrl={null}
        openChatRequest={0}
      />,
    );

    fireEvent.click(screen.getByTestId('clippy-dismiss'));

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('clippy-proactive-card')).toBeNull();

    rerender(
      <ClippyAssistant
        messages={[{ text: 'Need help opening the workspace?', hold: true }]}
        onDismiss={onDismiss}
        onChatOpen={onChatOpen}
        agentEnabled={false}
        agentWsUrl={null}
        openChatRequest={1}
      />,
    );

    expect(await screen.findByTestId('clippy-chat')).toBeTruthy();
    expect(onChatOpen).toHaveBeenCalledTimes(1);
  });

  it('keeps a controlled Clippy character visible in the agent bridge chat', async () => {
    render(
      <ClippyAssistant
        messages={[]}
        onDismiss={vi.fn()}
        agentEnabled={false}
        agentWsUrl={null}
        openChatRequest={1}
      />,
    );

    expect(await screen.findByTestId('clippy-chat')).toBeTruthy();
    expect(screen.getByTestId('clippy-character')).not.toBeNull();
    expect(document.querySelector('[data-clippy-anchor]')).toBeNull();
  });

  it('opens a real-agent status panel before the workspace bridge is active', async () => {
    const onAction = vi.fn();
    const onChatOpen = vi.fn();
    const onUserChatMessage = vi.fn();
    const { rerender } = render(
      <ClippyAssistant
        messages={[]}
        onDismiss={vi.fn()}
        onChatOpen={onChatOpen}
        onUserChatMessage={onUserChatMessage}
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
        onChatOpen={onChatOpen}
        onUserChatMessage={onUserChatMessage}
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
    expect(onChatOpen).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('clippy-chat-input').hasAttribute('disabled')).toBe(false);

    fireEvent.change(screen.getByTestId('clippy-chat-input'), {
      target: { value: 'can you inspect the repo?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onUserChatMessage).toHaveBeenCalledWith(expect.objectContaining({
      text: 'can you inspect the repo?',
      deliveryStatus: 'blocked',
      blockedReason: 'workspace_required',
    }));
    expect(screen.getByTestId('clippy-chat').textContent).toContain(
      'Clippy could not send that because the dev workspace is not running.',
    );

    fireEvent.click(screen.getByTestId('clippy-launch-workspace'));
    expect(onAction).toHaveBeenCalledWith('launch-workspace');
  });

  it('reports Clippy chat closes so the tray and evidence stay in sync', async () => {
    const onChatClose = vi.fn();

    render(
      <ClippyAssistant
        messages={[]}
        onDismiss={vi.fn()}
        onChatClose={onChatClose}
        agentEnabled={false}
        agentWsUrl={null}
        openChatRequest={1}
      />,
    );

    expect(await screen.findByTestId('clippy-chat')).toBeTruthy();
    fireEvent.click(screen.getByTestId('clippy-chat-close'));

    expect(onChatClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('clippy-chat')).toBeNull();
  });

  it('hides the proactive Clippy prompt while chat is open and restores it after chat closes', async () => {
    const onChatClose = vi.fn();
    const onDismiss = vi.fn();

    render(
      <ClippyAssistant
        messages={[{ text: 'Need help opening the workspace?', hold: true }]}
        onDismiss={onDismiss}
        onChatClose={onChatClose}
        agentEnabled={false}
        agentWsUrl={null}
        openChatRequest={1}
      />,
    );

    expect(await screen.findByTestId('clippy-chat')).toBeTruthy();
    expect(screen.queryByTestId('clippy-proactive-card')).toBeNull();

    fireEvent.click(screen.getByTestId('clippy-chat-close'));

    expect(onChatClose).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
    expect(screen.queryByTestId('clippy-chat')).toBeNull();
    expect(screen.getByTestId('clippy-proactive-card').textContent).toContain('Need help opening the workspace?');
  });

  it('does not render or enable a fake Devin identity before the bridge reports an agent name', async () => {
    const sendMessage = vi.fn(() => null);
    const onUserChatMessage = vi.fn();
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
        onUserChatMessage={onUserChatMessage}
      />,
    );

    const chat = await screen.findByTestId('clippy-chat');
    expect(chat.textContent).toContain(
      'Waiting for the container bridge to report a real agent identity before chat is enabled.',
    );
    expect(chat.textContent).not.toContain('Devin');
    expect(chat.textContent).not.toContain('devin');
    expect(screen.getByTestId('clippy-chat-input').hasAttribute('disabled')).toBe(false);

    fireEvent.change(screen.getByTestId('clippy-chat-input'), {
      target: { value: 'inspect the repo task' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(sendMessage).not.toHaveBeenCalled();
    expect(onUserChatMessage).toHaveBeenCalledWith(expect.objectContaining({
      text: 'inspect the repo task',
      deliveryStatus: 'blocked',
      blockedReason: 'agent_identity_missing',
    }));
  });

  it('shows a live bridge checklist so disabled Clippy chat is diagnosable without simulation', async () => {
    const sendMessage = vi.fn(() => null);
    const onUserChatMessage = vi.fn();
    mockAgentConnection({
      connected: true,
      status: 'idle',
      agentName: 'devin',
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
        onUserChatMessage={onUserChatMessage}
      />,
    );

    const diagnostics = await screen.findByTestId('clippy-bridge-checklist');
    expect(diagnostics.textContent).toContain('Workspace');
    expect(diagnostics.textContent).toContain('Ready');
    expect(diagnostics.textContent).toContain('WebSocket');
    expect(diagnostics.textContent).toContain('Connected');
    expect(diagnostics.textContent).toContain('Agent');
    expect(diagnostics.textContent).toContain('devin');
    expect(diagnostics.textContent).toContain('Capabilities');
    expect(diagnostics.textContent).toContain('Waiting');
    expect(screen.getByTestId('clippy-bridge-check-state').classList.contains('is-ok')).toBe(true);
    expect(screen.getByTestId('clippy-bridge-check-capabilities').classList.contains('is-waiting')).toBe(true);
    expect(screen.getByTestId('clippy-chat-input').hasAttribute('disabled')).toBe(false);

    fireEvent.change(screen.getByTestId('clippy-chat-input'), {
      target: { value: 'inspect the repo task' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(sendMessage).not.toHaveBeenCalled();
    expect(onUserChatMessage).toHaveBeenCalledWith(expect.objectContaining({
      text: 'inspect the repo task',
      deliveryStatus: 'blocked',
      blockedReason: 'agent_capabilities_missing',
    }));
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
    const onUserChatMessage = vi.fn();
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
        onUserChatMessage={onUserChatMessage}
      />,
    );

    expect((await screen.findByTestId('clippy-chat')).textContent).toContain(
      'Clippy is starting devin inside the dev container.',
    );
    expect(screen.getByTestId('clippy-chat-input').hasAttribute('disabled')).toBe(false);
    expect(screen.getByRole('button', { name: 'Send' }).hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByTestId('clippy-chat-input'), {
      target: { value: 'inspect the repo task' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(sendMessage).not.toHaveBeenCalled();
    expect(onUserChatMessage).toHaveBeenCalledWith(expect.objectContaining({
      text: 'inspect the repo task',
      deliveryStatus: 'blocked',
      blockedReason: 'agent_starting',
    }));
  });

  it('opens a real Devin login terminal when the bridge reports auth needed without a browser auth URL', async () => {
    const onOpenAuthTerminal = vi.fn();
    const onCheckAuth = vi.fn();
    const onUserChatMessage = vi.fn();
    const startAuth = vi.fn();
    const sendMessage = vi.fn(() => null);
    mockAgentConnection({
      connected: true,
      status: 'auth_needed',
      authUrl: null,
      authMessage: 'Devin CLI is not logged in. Run devin auth login --force-manual-token-flow.',
      capabilities: [],
      sendMessage,
      startAuth,
    });

    render(
      <ClippyAssistant
        messages={[]}
        onDismiss={vi.fn()}
        agentEnabled
        agentWsUrl="wss://room.test/agent"
        openChatRequest={1}
        onOpenAuthTerminal={onOpenAuthTerminal}
        onCheckAuth={onCheckAuth}
        onUserChatMessage={onUserChatMessage}
      />,
    );

    const chat = await screen.findByTestId('clippy-chat');
    expect(chat.textContent).toContain('Devin CLI is not logged in.');
    expect(screen.getByTestId('clippy-chat-input').hasAttribute('disabled')).toBe(false);
    fireEvent.change(screen.getByTestId('clippy-chat-input'), {
      target: { value: 'inspect the repo task' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onUserChatMessage).toHaveBeenCalledWith(expect.objectContaining({
      text: 'inspect the repo task',
      deliveryStatus: 'blocked',
      blockedReason: 'agent_auth_needed',
    }));

    fireEvent.click(screen.getByTestId('clippy-open-auth-terminal'));
    expect(onOpenAuthTerminal).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('clippy-check-auth'));
    expect(onCheckAuth).toHaveBeenCalledTimes(1);
    expect(startAuth).toHaveBeenCalledTimes(1);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('opens browser Devin auth as its own source-backed UI intent', async () => {
    const onOpenBrowser = vi.fn();
    const onOpenAuthBrowser = vi.fn();
    const onCheckAuth = vi.fn();
    const startAuth = vi.fn();
    mockAgentConnection({
      connected: true,
      status: 'auth_needed',
      authUrl: 'https://app.devin.ai/auth',
      authMessage: 'Devin needs browser authentication.',
      capabilities: [],
      startAuth,
    });

    render(
      <ClippyAssistant
        messages={[]}
        onDismiss={vi.fn()}
        agentEnabled
        agentWsUrl="wss://room.test/agent"
        openChatRequest={1}
        onOpenBrowser={onOpenBrowser}
        onOpenAuthBrowser={onOpenAuthBrowser}
        onCheckAuth={onCheckAuth}
      />,
    );

    fireEvent.click(await screen.findByTestId('clippy-open-auth-browser'));

    expect(onOpenAuthBrowser).toHaveBeenCalledTimes(1);
    expect(onOpenBrowser).toHaveBeenCalledWith('https://app.devin.ai/auth');
    expect(startAuth).toHaveBeenCalledTimes(1);
    expect(onCheckAuth).not.toHaveBeenCalled();
  });

  it('routes the generic Open Terminal button through source-backed Clippy action handling', async () => {
    const onAction = vi.fn();
    const onOpenTerminal = vi.fn();
    mockAgentConnection({
      connected: true,
      status: 'idle',
      capabilities: ['chat'],
    });

    render(
      <ClippyAssistant
        messages={[]}
        onDismiss={vi.fn()}
        agentEnabled
        agentWsUrl="wss://room.test/agent"
        openChatRequest={1}
        onAction={onAction}
        onOpenTerminal={onOpenTerminal}
      />,
    );

    fireEvent.click(await screen.findByTestId('clippy-open-terminal'));
    expect(onAction).toHaveBeenCalledWith('open-terminal');
    expect(onOpenTerminal).not.toHaveBeenCalled();
  });
});
