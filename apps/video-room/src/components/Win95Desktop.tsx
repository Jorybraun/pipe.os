import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import {
  FileText,
  FolderOpen,
  Globe,
  Palette,
  ClipboardCheck,
  SquareTerminal,
  Video,
  MessageSquare,
} from 'lucide-react';
import { Win95Taskbar } from './Win95Taskbar';
import type { ClippyTrayStatus } from './Win95Taskbar';
import { Win95Window } from './Win95Window';
import type { WindowManagerApi, WindowState, WindowType } from '../hooks/useWindowManager';
import type { RoomCursorPresence } from '../hooks/useRoomConnection';
import type { WindowStateSource, WindowUiLaunchSource } from '../lib/windowEvidence';
import type { StartMenuEventSource } from '../lib/startMenuEvidence';

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
  { windowType: 'submission', label: 'Submit Work', icon: ClipboardCheck },
];

interface Win95DesktopProps {
  wm: WindowManagerApi;
  children?: ReactNode;
  onIconDoubleClick?: (windowType: WindowType, source?: WindowUiLaunchSource) => void;
  recordingLabel?: string;
  recordingActive?: boolean;
  onClippyClick?: () => void;
  clippyActive?: boolean;
  clippyStatus?: ClippyTrayStatus;
  renderWindowContent: (win: WindowState) => ReactNode;
  onWindowClose?: (id: string) => void;
  onWindowFocus?: (id: string, stateSource?: WindowStateSource) => void;
  onWindowMinimize?: (id: string, stateSource?: WindowStateSource) => void;
  onWindowRestore?: (id: string, stateSource?: WindowStateSource) => void;
  onWindowMaximize?: (id: string) => void;
  onWindowMove?: (id: string, x: number, y: number) => void;
  onWindowMoveEnd?: (id: string, x: number, y: number) => void;
  canExitDesktop?: boolean;
  onExitDesktop?: () => void;
  startMenuState?: { open: boolean; eventId: string } | null;
  onStartMenuStateChange?: (open: boolean, source: StartMenuEventSource) => void;
  peerCursors?: RoomCursorPresence[];
  onCursorMove?: (position: { x: number; y: number }) => void;
  assessmentEnabled?: boolean;
}

export function Win95Desktop({
  wm,
  onIconDoubleClick,
  recordingLabel,
  recordingActive,
  onClippyClick,
  clippyActive,
  clippyStatus,
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
  startMenuState,
  onStartMenuStateChange,
  peerCursors = [],
  onCursorMove,
  assessmentEnabled = false,
}: Win95DesktopProps): JSX.Element {
  const [startMenuOpen, setStartMenuOpen] = useState(false);
  const desktopIcons = assessmentEnabled
    ? DESKTOP_ICONS
    : DESKTOP_ICONS.filter((icon) => icon.windowType !== 'submission');

  useEffect(() => {
    if (!startMenuState) return;
    setStartMenuOpen(startMenuState.open);
  }, [startMenuState?.eventId, startMenuState?.open]);

  const setStartMenuOpenWithEvidence = useCallback((
    open: boolean,
    source: StartMenuEventSource,
  ): void => {
    setStartMenuOpen(open);
    onStartMenuStateChange?.(open, source);
  }, [onStartMenuStateChange]);

  const handleStartClick = useCallback((): void => {
    setStartMenuOpenWithEvidence(!startMenuOpen, 'win95_start_button');
  }, [setStartMenuOpenWithEvidence, startMenuOpen]);

  const handleWindowClick = useCallback(
    (win: WindowState): void => {
      if (win.minimized) {
        if (onWindowRestore) {
          onWindowRestore(win.id, 'win95_taskbar');
        } else {
          wm.restoreWindow(win.id);
        }
      } else if (win.focused) {
        if (onWindowMinimize) {
          onWindowMinimize(win.id, 'win95_taskbar');
        } else {
          wm.minimizeWindow(win.id);
        }
      } else {
        if (onWindowFocus) {
          onWindowFocus(win.id, 'win95_taskbar');
        } else {
          wm.focusWindow(win.id);
        }
      }
    },
    [onWindowFocus, onWindowMinimize, onWindowRestore, wm],
  );

  const handleIconDoubleClick = useCallback(
    (windowType: WindowType, source: WindowUiLaunchSource): void => {
      if (onIconDoubleClick) {
        onIconDoubleClick(windowType, source);
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
      onClick={() => {
        if (startMenuOpen) setStartMenuOpenWithEvidence(false, 'win95_desktop_click');
      }}
    >
      <div className="win95-peer-cursors" aria-hidden="true">
        {peerCursors.map((cursor) => {
          const label = cursor.role === 'HOST' ? 'Host' : 'Guest';
          const x = Math.min(0.985, Math.max(0.015, cursor.x));
          const y = Math.min(0.96, Math.max(0.015, cursor.y));
          const cursorStyle = {
            '--peer-cursor-x': `${x * 100}vw`,
            '--peer-cursor-y': `${y * 100}dvh`,
          } as CSSProperties & Record<'--peer-cursor-x' | '--peer-cursor-y', string>;
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
        {desktopIcons.map((icon) => {
          const Icon = icon.icon;
          return (
            <button
              key={icon.windowType}
              className="win95-desktop-icon"
              data-testid={`room-desktop-icon-${icon.windowType}`}
              onDoubleClick={() => handleIconDoubleClick(icon.windowType, 'win95_desktop_ui')}
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
            {desktopIcons.map((icon) => {
              const Icon = icon.icon;
              return (
                <button
                  key={icon.windowType}
                  className="win95-start-menu-item"
                  onClick={() => {
                    handleIconDoubleClick(icon.windowType, 'win95_start_menu');
                    setStartMenuOpenWithEvidence(false, 'win95_start_menu_item');
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
                setStartMenuOpenWithEvidence(false, 'win95_start_menu_item');
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
        clippyStatus={clippyStatus}
      />
    </div>
  );
}
