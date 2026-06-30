import { useState, type ReactNode } from 'react';
import { Circle, MessageSquare, Minus, Monitor, SquareTerminal, X } from 'lucide-react';
import type { WindowManagerApi, WindowState } from '../hooks/useWindowManager';

interface StandardLayoutProps {
  wm: WindowManagerApi;
  renderWindowContent: (win: WindowState) => ReactNode;
  assessmentHeader?: ReactNode;
  assessmentAside?: ReactNode;
  recordingLabel?: string;
  recordingActive?: boolean;
  modeLabel?: string;
  primarySurface?: 'video' | 'workspace';
}

export function StandardLayout({
  wm,
  renderWindowContent,
  assessmentHeader,
  assessmentAside,
  recordingLabel,
  recordingActive,
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
  const utilityWindows = wm.windows.filter((win) => (
    win.windowType !== 'video'
    && win.windowType !== 'chat'
    && win.windowType !== 'workspace'
  ));
  const visibleUtilityWindows = utilityWindows.filter((win) => !win.minimized);
  const minimizedUtilityWindows = utilityWindows.filter((win) => win.minimized);

  return (
    <div
      className={`standard-layout${workspaceIsPrimary ? ' is-workspace-primary' : ''}`}
      data-testid="standard-layout"
    >
      {/* Main video/workspace area */}
      <div className={workspaceIsPrimary && assessmentAside ? 'standard-assessment-shell' : 'standard-video-area'}>
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
        {workspaceIsPrimary && assessmentAside && (
          <div className="standard-assessment-aside" data-testid="standard-assessment-aside">
            {assessmentAside}
          </div>
        )}
      </div>

      {workspaceIsPrimary && assessmentHeader && (
        <div className="standard-assessment-header" data-testid="standard-assessment-header">
          {assessmentHeader}
        </div>
      )}

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

      {visibleUtilityWindows.length > 0 && (
        <div className="standard-floating-windows" data-testid="standard-floating-windows">
          {visibleUtilityWindows.map((win) => (
            <section
              key={win.id}
              className={`standard-floating-window is-${win.windowType}`}
              data-testid={`standard-window-${win.windowType}`}
              style={{
                width: Math.min(win.width, Math.max(320, window.innerWidth - 48)),
                maxHeight: Math.max(280, window.innerHeight - 96),
                zIndex: win.zIndex,
              }}
              onMouseDown={() => wm.focusWindow(win.id)}
            >
              <header className="standard-floating-window-header">
                <span>{win.title}</span>
                <div className="standard-floating-window-actions">
                  <button
                    type="button"
                    onClick={() => wm.minimizeWindow(win.id)}
                    aria-label={`Minimize ${win.title}`}
                  >
                    <Minus size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => wm.closeWindow(win.id)}
                    aria-label={`Close ${win.title}`}
                  >
                    <X size={14} />
                  </button>
                </div>
              </header>
              <div className="standard-floating-window-body">
                {renderWindowContent(win)}
              </div>
            </section>
          ))}
        </div>
      )}

      {minimizedUtilityWindows.length > 0 && (
        <div className="standard-utility-dock" data-testid="standard-utility-dock">
          {minimizedUtilityWindows.map((win) => (
            <button
              key={win.id}
              type="button"
              className="standard-utility-dock-btn"
              onClick={() => wm.restoreWindow(win.id)}
            >
              {win.title}
            </button>
          ))}
        </div>
      )}

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
