import { useCallback, useState, type CSSProperties, type ReactNode } from 'react';
import {
  FileText,
  FolderOpen,
  Globe,
  Palette,
  SquareTerminal,
  Video,
  MessageSquare,
} from 'lucide-react';
import { Win95Taskbar } from './Win95Taskbar';
import { Win95Window } from './Win95Window';
import type { WindowManagerApi, WindowState, WindowType } from '../hooks/useWindowManager';
import type { RoomCursorPresence } from '../hooks/useRoomConnection';

interface DesktopIcon {
  windowType: WindowType;
  label: string;
  icon: typeof Video;
}

const DESKTOP_ICONS: DesktopIcon[] = [
  { windowType: 'video', label: 'Video Call', icon: Video },
  { windowType: 'workspace', label: 'VS Code', icon: SquareTerminal },
  { windowType: 'chat', label: 'Room Chat', icon: MessageSquare },
  { windowType: 'tasks', label: 'Files', icon: FolderOpen },
  { windowType: 'notepad', label: 'Notepad', icon: FileText },
  { windowType: 'paint', label: 'Paint', icon: Palette },
  { windowType: 'browser', label: 'Microsoft Edge', icon: Globe },
  { windowType: 'terminal', label: 'Terminal', icon: SquareTerminal },
];

interface Win95DesktopProps {
  wm: WindowManagerApi;
  children?: ReactNode;
  onIconDoubleClick?: (windowType: WindowType) => void;
  recordingLabel?: string;
  recordingActive?: boolean;
  onClippyClick?: () => void;
  clippyActive?: boolean;
  renderWindowContent: (win: WindowState) => ReactNode;
  onWindowClose?: (id: string) => void;
  onWindowFocus?: (id: string) => void;
  onWindowMinimize?: (id: string) => void;
  onWindowRestore?: (id: string) => void;
  onWindowMaximize?: (id: string) => void;
  onWindowMove?: (id: string, x: number, y: number) => void;
  onWindowMoveEnd?: (id: string, x: number, y: number) => void;
  canExitDesktop?: boolean;
  onExitDesktop?: () => void;
  peerCursors?: RoomCursorPresence[];
  onCursorMove?: (position: { x: number; y: number }) => void;
}

export function Win95Desktop({
  wm,
  onIconDoubleClick,
  recordingLabel,
  recordingActive,
  onClippyClick,
  clippyActive,
  renderWindowContent,
  onWindowClose,
  onWindowFocus,
  onWindowMinimize,
  onWindowRestore,
  onWindowMaximize,
  onWindowMove,
  onWindowMoveEnd,
  canExitDesktop = false,
  onExitDesktop,
  peerCursors = [],
  onCursorMove,
}: Win95DesktopProps): JSX.Element {
  const [startMenuOpen, setStartMenuOpen] = useState(false);

  const handleStartClick = useCallback((): void => {
    setStartMenuOpen((v) => !v);
  }, []);

  const handleWindowClick = useCallback(
    (win: WindowState): void => {
      if (win.minimized) {
        (onWindowRestore ?? wm.restoreWindow)(win.id);
      } else if (win.focused) {
        (onWindowMinimize ?? wm.minimizeWindow)(win.id);
      } else {
        (onWindowFocus ?? wm.focusWindow)(win.id);
      }
    },
    [onWindowFocus, onWindowMinimize, onWindowRestore, wm],
  );

  const handleIconDoubleClick = useCallback(
    (windowType: WindowType): void => {
      if (onIconDoubleClick) {
        onIconDoubleClick(windowType);
      }
    },
    [onIconDoubleClick],
  );

  return (
    <div
      className="win95-desktop"
      data-testid="win95-desktop"
      onMouseMove={(event) => {
        if (!onCursorMove) return;
        const rect = event.currentTarget.getBoundingClientRect();
        onCursorMove({
          x: (event.clientX - rect.left) / rect.width,
          y: (event.clientY - rect.top) / rect.height,
        });
      }}
      onClick={() => startMenuOpen && setStartMenuOpen(false)}
    >
      <div className="win95-peer-cursors" aria-hidden="true">
        {peerCursors.map((cursor) => {
          const label = cursor.role === 'HOST' ? 'Host' : 'Guest';
          const x = Math.min(0.985, Math.max(0.015, cursor.x));
          const y = Math.min(0.96, Math.max(0.015, cursor.y));
          const cursorStyle = {
            '--room-cursor-x': `${x * 100}vw`,
            '--room-cursor-y': `${y * 100}dvh`,
          } as CSSProperties;
          return (
            <div
              key={cursor.role}
              className={`win95-peer-cursor win95-peer-cursor-${cursor.role.toLowerCase()}`}
              data-testid={`room-peer-cursor-${cursor.role.toLowerCase()}`}
              style={cursorStyle}
            >
              <svg
                className="win95-peer-cursor-pointer"
                viewBox="0 0 18 24"
                focusable="false"
                aria-hidden="true"
              >
                <path d="M1 1v19l5-5 3.5 8 3-1.5-3.5-7.5h7z" />
              </svg>
              <span className="win95-peer-cursor-label">{label}</span>
            </div>
          );
        })}
      </div>
      <div className="win95-desktop-icons">
        {DESKTOP_ICONS.map((icon) => {
          const Icon = icon.icon;
          return (
            <button
              key={icon.windowType}
              className="win95-desktop-icon"
              data-testid={`room-desktop-icon-${icon.windowType}`}
              onDoubleClick={() => handleIconDoubleClick(icon.windowType)}
              onClick={(e) => e.stopPropagation()}
              title={icon.label}
            >
              <Icon size={28} />
              <span>{icon.label}</span>
            </button>
          );
        })}
      </div>

      {startMenuOpen && (
        <div className="win95-start-menu" data-testid="win95-start-menu" onClick={(e) => e.stopPropagation()}>
          <div className="win95-start-menu-sidebar">
            <span className="win95-start-menu-brand">95<span>∞</span></span>
          </div>
          <div className="win95-start-menu-items">
            {DESKTOP_ICONS.map((icon) => {
              const Icon = icon.icon;
              return (
                <button
                  key={icon.windowType}
                  className="win95-start-menu-item"
                  onClick={() => {
                    handleIconDoubleClick(icon.windowType);
                    setStartMenuOpen(false);
                  }}
                >
                  <Icon size={16} />
                  <span>{icon.label}</span>
                </button>
              );
            })}
            <div className="win95-start-menu-sep" />
            <button
              className="win95-start-menu-item"
              onClick={() => {
                if (canExitDesktop) onExitDesktop?.();
                setStartMenuOpen(false);
              }}
            >
              <SquareTerminal size={16} />
              <span>{canExitDesktop ? 'Return to Call' : 'Shut Down...'}</span>
            </button>
          </div>
        </div>
      )}

      <div className="win95-windows-layer">
        {wm.windows.map((win) => (
          <Win95Window
            key={win.id}
            win={win}
            onFocus={onWindowFocus ?? wm.focusWindow}
            onClose={onWindowClose ?? wm.closeWindow}
            onMinimize={onWindowMinimize ?? wm.minimizeWindow}
            onMaximize={onWindowMaximize ?? wm.toggleMaximize}
            onMove={onWindowMove ?? wm.moveWindow}
            onMoveEnd={onWindowMoveEnd}
            noPadding={win.windowType === 'workspace'
              || win.windowType === 'video'
              || win.windowType === 'tasks'
              || win.windowType === 'browser'
              || win.windowType === 'notepad'
              || win.windowType === 'paint'
              || win.windowType === 'terminal'}
          >
            {renderWindowContent(win)}
          </Win95Window>
        ))}
      </div>

      <Win95Taskbar
        windows={wm.windows}
        onStartClick={handleStartClick}
        onWindowClick={handleWindowClick}
        startMenuOpen={startMenuOpen}
        recordingLabel={recordingLabel}
        recordingActive={recordingActive}
        onClippyClick={onClippyClick}
        clippyActive={clippyActive}
      />
    </div>
  );
}
