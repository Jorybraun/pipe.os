import { useEffect, useState } from 'react';
import { FileText, FolderOpen, Globe, Monitor, MessageSquare, Palette, Paperclip, Video, SquareTerminal } from 'lucide-react';
import type { WindowState, WindowType } from '../hooks/useWindowManager';

interface Win95TaskbarProps {
  windows: WindowState[];
  onStartClick: () => void;
  onWindowClick: (win: WindowState) => void;
  startMenuOpen: boolean;
  recordingLabel?: string;
  recordingActive?: boolean;
  onClippyClick?: () => void;
  clippyActive?: boolean;
}

const WINDOW_ICONS: Record<WindowType, typeof Video> = {
  video: Video,
  workspace: SquareTerminal,
  chat: MessageSquare,
  tasks: FolderOpen,
  snippet: Monitor,
  browser: Globe,
  notepad: FileText,
  paint: Palette,
  terminal: SquareTerminal,
  custom: Monitor,
};

function formatClock(d: Date): string {
  const h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${m.toString().padStart(2, '0')} ${ampm}`;
}

export function Win95Taskbar({
  windows,
  onStartClick,
  onWindowClick,
  startMenuOpen,
  recordingLabel,
  recordingActive,
  onClippyClick,
  clippyActive = false,
}: Win95TaskbarProps): JSX.Element {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="win95-taskbar" data-testid="win95-taskbar">
      <button
        className={`win95-start-btn ${startMenuOpen ? 'is-active' : ''}`}
        onClick={onStartClick}
        data-testid="win95-start-btn"
      >
        <span className="win95-start-logo">95∞</span>
        <span>Start</span>
      </button>
      <div className="win95-taskbar-divider" />
      <div className="win95-taskbar-windows">
        {windows.map((win) => {
          const Icon = WINDOW_ICONS[win.windowType] ?? Monitor;
          return (
            <button
              key={win.id}
              className={`win95-taskbar-btn ${win.focused && !win.minimized ? 'is-active' : ''} ${win.minimized ? 'is-minimized' : ''}`}
              onClick={() => onWindowClick(win)}
              title={win.title}
            >
              <Icon size={14} />
              <span className="win95-taskbar-btn-label">{win.title}</span>
            </button>
          );
        })}
      </div>
      <div className="win95-system-tray">
        {onClippyClick && (
          <button
            type="button"
            className={`win95-tray-button${clippyActive ? ' is-active' : ''}`}
            onClick={onClippyClick}
            title="Ask Clippy"
            aria-label="Ask Clippy"
            data-testid="win95-tray-clippy"
          >
            <Paperclip size={15} />
          </button>
        )}
        {recordingActive && (
          <span className="win95-tray-recording" data-testid="win95-tray-recording">
            <span className="win95-tray-rec-dot" />
            {recordingLabel ?? 'REC'}
          </span>
        )}
        <span className="win95-tray-clock" data-testid="win95-tray-clock">
          {formatClock(now)}
        </span>
      </div>
    </div>
  );
}
