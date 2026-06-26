import { useCallback, useState, type ReactNode } from 'react';
import { Video, SquareTerminal, MessageSquare, ListTodo, Monitor, MonitorSmartphone, Globe } from 'lucide-react';
import { Win95Taskbar } from './Win95Taskbar';
import { Win95Window } from './Win95Window';
import type { WindowManagerApi, WindowState, WindowType } from '../hooks/useWindowManager';

interface DesktopIcon {
  windowType: WindowType;
  label: string;
  icon: typeof Video;
}

const DESKTOP_ICONS: DesktopIcon[] = [
  { windowType: 'video', label: 'Video Call', icon: Video },
  { windowType: 'workspace', label: 'My Computer', icon: SquareTerminal },
  { windowType: 'chat', label: 'Chat', icon: MessageSquare },
  { windowType: 'tasks', label: 'Tasks', icon: ListTodo },
  { windowType: 'browser', label: 'Internet', icon: Globe },
  { windowType: 'terminal', label: 'PuTTY', icon: SquareTerminal },
];

export type UiMode = 'win95' | 'standard';

interface Win95DesktopProps {
  wm: WindowManagerApi;
  children?: ReactNode;
  onIconDoubleClick?: (windowType: WindowType) => void;
  recordingLabel?: string;
  recordingActive?: boolean;
  renderWindowContent: (win: WindowState) => ReactNode;
  uiMode: UiMode;
  onUiModeChange: (mode: UiMode) => void;
}

export function Win95Desktop({
  wm,
  onIconDoubleClick,
  recordingLabel,
  recordingActive,
  renderWindowContent,
  uiMode,
  onUiModeChange,
}: Win95DesktopProps): JSX.Element {
  const [startMenuOpen, setStartMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const handleStartClick = useCallback((): void => {
    setStartMenuOpen((v) => !v);
  }, []);

  const handleWindowClick = useCallback(
    (win: WindowState): void => {
      if (win.minimized) {
        wm.restoreWindow(win.id);
      } else if (win.focused) {
        wm.minimizeWindow(win.id);
      } else {
        wm.focusWindow(win.id);
      }
    },
    [wm],
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
      onClick={() => startMenuOpen && setStartMenuOpen(false)}
    >
      <div className="win95-desktop-icons">
        {DESKTOP_ICONS.map((icon) => {
          const Icon = icon.icon;
          return (
            <button
              key={icon.windowType}
              className="win95-desktop-icon"
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
                setSettingsOpen(true);
                setStartMenuOpen(false);
              }}
            >
              <MonitorSmartphone size={16} />
              <span>Display Settings...</span>
            </button>
            <button
              className="win95-start-menu-item"
              onClick={() => setStartMenuOpen(false)}
            >
              <Monitor size={16} />
              <span>Shut Down...</span>
            </button>
          </div>
        </div>
      )}

      <div className="win95-windows-layer">
        {wm.windows.map((win) => (
          <Win95Window
            key={win.id}
            win={win}
            onFocus={wm.focusWindow}
            onClose={wm.closeWindow}
            onMinimize={wm.minimizeWindow}
            onMaximize={wm.toggleMaximize}
            onMove={wm.moveWindow}
            noPadding={win.windowType === 'workspace' || win.windowType === 'video' || win.windowType === 'browser' || win.windowType === 'terminal'}
          >
            {renderWindowContent(win)}
          </Win95Window>
        ))}
      </div>

      {settingsOpen && (
        <div className="win95-settings-dialog" onClick={(e) => e.stopPropagation()}>
          <div className="win95-settings-dialog-title">
            <span>Display Settings</span>
            <button onClick={() => setSettingsOpen(false)}>×</button>
          </div>
          <div className="win95-settings-dialog-body">
            <p>Select your preferred interface mode:</p>
            <label className="win95-settings-option">
              <input
                type="radio"
                name="ui-mode"
                checked={uiMode === 'win95'}
                onChange={() => onUiModeChange('win95')}
              />
              <span>95 Until Infinity — windowed experience with desktop icons</span>
            </label>
            <label className="win95-settings-option">
              <input
                type="radio"
                name="ui-mode"
                checked={uiMode === 'standard'}
                onChange={() => onUiModeChange('standard')}
              />
              <span>Standard — simplified single-panel layout</span>
            </label>
          </div>
          <div className="win95-settings-dialog-footer">
            <button onClick={() => setSettingsOpen(false)}>OK</button>
            <button onClick={() => setSettingsOpen(false)}>Cancel</button>
          </div>
        </div>
      )}

      <Win95Taskbar
        windows={wm.windows}
        onStartClick={handleStartClick}
        onWindowClick={handleWindowClick}
        startMenuOpen={startMenuOpen}
        recordingLabel={recordingLabel}
        recordingActive={recordingActive}
      />
    </div>
  );
}
