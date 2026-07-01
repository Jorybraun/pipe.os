import { useState, type ReactNode } from 'react';
import { Circle, MessageSquare, Monitor, SquareTerminal, X } from 'lucide-react';
import type { ToolSurfaceManagerApi, ToolSurfaceState } from '../hooks/useToolSurfaceManager';

interface StandardLayoutProps {
  toolSurfaces: ToolSurfaceManagerApi;
  renderSurfaceContent: (win: ToolSurfaceState) => ReactNode;
  assessmentHeader?: ReactNode;
  assessmentAside?: ReactNode;
  recordingLabel?: string;
  recordingActive?: boolean;
  modeLabel?: string;
  primarySurface?: 'video' | 'workspace';
}

export function StandardLayout({
  toolSurfaces,
  renderSurfaceContent,
  assessmentHeader,
  assessmentAside,
  recordingLabel,
  recordingActive,
  modeLabel = 'Standard call',
  primarySurface = 'video',
}: StandardLayoutProps): JSX.Element {
  const [chatOpen, setChatOpen] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [activeToolId, setActiveToolId] = useState<string | null>(null);

  const videoSurface = toolSurfaces.surfaces.find((w) => w.surfaceType === 'video');
  const chatSurface = toolSurfaces.surfaces.find((w) => w.surfaceType === 'chat');
  const workspaceSurface = toolSurfaces.surfaces.find((w) => w.surfaceType === 'workspace');

  const hasWorkspace = Boolean(workspaceSurface);
  const workspaceIsPrimary = primarySurface === 'workspace' && Boolean(workspaceSurface);
  const primarySurfaceState = workspaceIsPrimary ? workspaceSurface : videoSurface;
  const utilitySurfaces = toolSurfaces.surfaces.filter((win) => (
    win.surfaceType !== 'video'
    && win.surfaceType !== 'chat'
    && win.surfaceType !== 'workspace'
  ));
  const visibleUtilitySurfaces = utilitySurfaces.filter((win) => !win.minimized);
  const activeTool = visibleUtilitySurfaces.find((win) => win.id === activeToolId)
    ?? visibleUtilitySurfaces.reduce<ToolSurfaceState | null>((current, win) => {
      if (!current || win.zIndex > current.zIndex) return win;
      return current;
    }, null);

  const selectTool = (win: ToolSurfaceState): void => {
    setActiveToolId(win.id);
    toolSurfaces.focusSurface(win.id);
  };

  const closeTool = (win: ToolSurfaceState): void => {
    toolSurfaces.closeSurface(win.id);
    if (activeToolId === win.id) {
      setActiveToolId(null);
    }
  };

  return (
    <div
      className={`standard-layout${workspaceIsPrimary ? ' is-workspace-primary' : ''}`}
      data-testid="standard-layout"
    >
      {/* Main video/workspace area */}
      <div className={workspaceIsPrimary && assessmentAside ? 'standard-assessment-shell' : 'standard-video-area'}>
        <div className="standard-video-area" data-testid={workspaceIsPrimary ? 'standard-primary-workspace' : 'standard-primary-video'}>
          {primarySurfaceState ? (
            renderSurfaceContent(primarySurfaceState)
          ) : (
            <div className="standard-video-placeholder">
              <Monitor size={48} />
              <p>Connecting...</p>
            </div>
          )}
          {workspaceIsPrimary && videoSurface && (
            <div className="standard-video-pip" data-testid="standard-video-pip">
              {renderSurfaceContent(videoSurface)}
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

      {visibleUtilitySurfaces.length > 0 && activeTool && (
        <aside className="standard-tools-panel" data-testid="standard-tools-panel">
          <header className="standard-tools-header">
            <span>Assessment tools</span>
            <button
              type="button"
              onClick={() => closeTool(activeTool)}
              aria-label={`Close ${activeTool.title}`}
            >
              <X size={16} />
            </button>
          </header>
          <nav className="standard-tools-tabs" aria-label="Assessment tools">
            {visibleUtilitySurfaces.map((win) => (
              <button
                key={win.id}
                type="button"
                className={win.id === activeTool.id ? 'is-active' : ''}
                onClick={() => selectTool(win)}
              >
                {win.title}
              </button>
            ))}
          </nav>
          <div
            className={`standard-tool-body is-${activeTool.surfaceType}`}
            data-testid={`standard-tool-${activeTool.surfaceType}`}
          >
            {renderSurfaceContent(activeTool)}
          </div>
        </aside>
      )}

      {/* Slide-in chat panel */}
      {chatOpen && chatSurface && (
        <div className="standard-chat-panel" data-testid="standard-chat">
          <div className="standard-chat-header">
            <span>Room Chat</span>
            <button onClick={() => setChatOpen(false)}>
              <X size={16} />
            </button>
          </div>
          <div className="standard-chat-body">
            {renderSurfaceContent(chatSurface)}
          </div>
        </div>
      )}

      {/* Full-screen workspace overlay */}
      {workspaceOpen && workspaceSurface && (
        <div className="standard-workspace-overlay" data-testid="standard-workspace">
          <div className="standard-workspace-header">
            <span>Workspace</span>
            <button onClick={() => setWorkspaceOpen(false)}>
              <X size={16} />
            </button>
          </div>
          <div className="standard-workspace-body">
            {renderSurfaceContent(workspaceSurface)}
          </div>
        </div>
      )}
    </div>
  );
}
