import { useState, type ReactNode } from 'react';
import { Circle, MessageSquare, Monitor, SquareTerminal, X } from 'lucide-react';
import type { WindowManagerApi, WindowState } from '../hooks/useWindowManager';

interface StandardLayoutProps {
  wm: WindowManagerApi;
  renderWindowContent: (win: WindowState) => ReactNode;
  recordingLabel?: string;
  recordingActive?: boolean;
  canEnterDesktop?: boolean;
  onEnterDesktop?: () => void;
  modeLabel?: string;
  primarySurface?: 'video' | 'workspace';
}

export function StandardLayout({
  wm,
  renderWindowContent,
  recordingLabel,
  recordingActive,
  canEnterDesktop = false,
  onEnterDesktop,
  modeLabel = 'Standard call',
  primarySurface = 'video',
}: StandardLayoutProps): JSX.Element {
  const [chatOpen, setChatOpen] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);

  const videoWin = wm.windows.find((w) => w.windowType === 'video');
  const chatWin = wm.windows.find((w) => w.windowType === 'chat');
  const workspaceWin = wm.windows.find((w) => w.windowType === 'workspace');

  const hasWorkspace = Boolean(workspaceWin);
  const workspaceIsPrimary = primarySurface === 'workspace' && Boolean(workspaceWin);
  const primaryWin = workspaceIsPrimary ? workspaceWin : videoWin;

  return (
    <div
      className={`standard-layout${workspaceIsPrimary ? ' is-workspace-primary' : ''}`}
      data-testid="standard-layout"
    >
      {/* Main video area */}
      <div className="standard-video-area" data-testid={workspaceIsPrimary ? 'standard-primary-workspace' : 'standard-primary-video'}>
        {primaryWin ? (
          renderWindowContent(primaryWin)
        ) : (
          <div className="standard-video-placeholder">
            <Monitor size={48} />
            <p>Connecting...</p>
          </div>
        )}
        {workspaceIsPrimary && videoWin && (
          <div className="standard-video-pip" data-testid="standard-video-pip">
            {renderWindowContent(videoWin)}
          </div>
        )}
      </div>

      {/* Bottom control bar */}
      <div className="standard-controls-bar" data-testid="standard-controls">
        <span className="standard-layout-label">
          <Monitor size={16} />
          {modeLabel}
        </span>
        <div className="standard-controls-spacer" />
        {hasWorkspace && !workspaceIsPrimary && (
          <button
            className={`standard-control-btn${workspaceOpen ? ' is-active' : ''}`}
            onClick={() => setWorkspaceOpen((v) => !v)}
            title="Toggle workspace"
          >
            <SquareTerminal size={18} />
          </button>
        )}
        {canEnterDesktop && (
          <button
            className="standard-control-btn"
            onClick={onEnterDesktop}
            title="Launch 95 desktop"
            aria-label="Launch 95 desktop"
            data-testid="enter-win95-desktop"
          >
            <Monitor size={18} />
          </button>
        )}
        <button
          className={`standard-control-btn${chatOpen ? ' is-active' : ''}`}
          onClick={() => setChatOpen((v) => !v)}
          title="Toggle room chat"
          aria-label="Toggle room chat"
        >
          <MessageSquare size={18} />
        </button>
        {recordingActive && (
          <span className="standard-recording-indicator">
            <Circle size={10} fill="currentColor" />
            {recordingLabel ?? 'REC'}
          </span>
        )}
      </div>

      {/* Slide-in chat panel */}
      {chatOpen && chatWin && (
        <div className="standard-chat-panel" data-testid="standard-chat">
          <div className="standard-chat-header">
            <span>Room Chat</span>
            <button onClick={() => setChatOpen(false)}>
              <X size={16} />
            </button>
          </div>
          <div className="standard-chat-body">
            {renderWindowContent(chatWin)}
          </div>
        </div>
      )}

      {/* Full-screen workspace overlay */}
      {workspaceOpen && workspaceWin && (
        <div className="standard-workspace-overlay" data-testid="standard-workspace">
          <div className="standard-workspace-header">
            <span>Workspace</span>
            <button onClick={() => setWorkspaceOpen(false)}>
              <X size={16} />
            </button>
          </div>
          <div className="standard-workspace-body">
            {renderWindowContent(workspaceWin)}
          </div>
        </div>
      )}
    </div>
  );
}
