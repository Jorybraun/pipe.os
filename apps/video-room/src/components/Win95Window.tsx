import { useCallback, useRef, type ReactNode } from 'react';
import { Minimize2, Maximize2, X, Square } from 'lucide-react';
import type { WindowState } from '../hooks/useWindowManager';

interface Win95WindowProps {
  win: WindowState;
  onFocus: (id: string) => void;
  onClose: (id: string) => void;
  onMinimize: (id: string) => void;
  onMaximize: (id: string) => void;
  onMove: (id: string, x: number, y: number) => void;
  children: ReactNode;
  className?: string;
  noPadding?: boolean;
}

export function Win95Window({
  win,
  onFocus,
  onClose,
  onMinimize,
  onMaximize,
  onMove,
  children,
  className = '',
  noPadding = false,
}: Win95WindowProps): JSX.Element | null {
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (win.maximized) return;
      onFocus(win.id);
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        origX: win.x,
        origY: win.y,
      };

      const handleMouseMove = (ev: MouseEvent): void => {
        if (!dragRef.current) return;
        const dx = ev.clientX - dragRef.current.startX;
        const dy = ev.clientY - dragRef.current.startY;
        onMove(win.id, dragRef.current.origX + dx, dragRef.current.origY + dy);
      };

      const handleMouseUp = (): void => {
        dragRef.current = null;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [win.id, win.maximized, win.x, win.y, onFocus, onMove],
  );

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (win.maximized) return;
      onFocus(win.id);
      const touch = e.touches[0];
      dragRef.current = {
        startX: touch.clientX,
        startY: touch.clientY,
        origX: win.x,
        origY: win.y,
      };

      const handleTouchMove = (ev: TouchEvent): void => {
        if (!dragRef.current) return;
        const t = ev.touches[0];
        const dx = t.clientX - dragRef.current.startX;
        const dy = t.clientY - dragRef.current.startY;
        onMove(win.id, dragRef.current.origX + dx, dragRef.current.origY + dy);
      };

      const handleTouchEnd = (): void => {
        dragRef.current = null;
        document.removeEventListener('touchmove', handleTouchMove);
        document.removeEventListener('touchend', handleTouchEnd);
      };

      document.addEventListener('touchmove', handleTouchMove);
      document.addEventListener('touchend', handleTouchEnd);
    },
    [win.id, win.maximized, win.x, win.y, onFocus, onMove],
  );

  const style: React.CSSProperties = win.maximized
    ? {
        left: 0,
        top: 0,
        width: '100%',
        height: 'calc(100% - 40px)',
        zIndex: win.zIndex,
        display: win.minimized ? 'none' : 'flex',
      }
    : {
        left: win.x,
        top: win.y,
        width: win.width,
        height: win.height,
        zIndex: win.zIndex,
        display: win.minimized ? 'none' : 'flex',
      };

  return (
    <div
      className={`win95-window ${className} ${win.focused ? 'is-focused' : 'is-unfocused'}`}
      style={style}
      onMouseDown={() => onFocus(win.id)}
      data-testid={`room-window-${win.windowType}`}
      data-window-id={win.id}
    >
      <div
        className="win95-title-bar"
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        onDoubleClick={() => onMaximize(win.id)}
      >
        <span className="win95-title-text">
          {win.icon && <span className="win95-title-icon">{win.icon}</span>}
          {win.title}
        </span>
        <div className="win95-title-buttons">
          <button
            className="win95-tb-btn"
            onClick={(e) => { e.stopPropagation(); onMinimize(win.id); }}
            aria-label="Minimize"
          >
            <Minimize2 size={12} />
          </button>
          <button
            className="win95-tb-btn"
            onClick={(e) => { e.stopPropagation(); onMaximize(win.id); }}
            aria-label="Maximize"
          >
            {win.maximized ? <Square size={10} /> : <Maximize2 size={12} />}
          </button>
          <button
            className="win95-tb-btn win95-tb-close"
            onClick={(e) => { e.stopPropagation(); onClose(win.id); }}
            aria-label="Close"
          >
            <X size={12} />
          </button>
        </div>
      </div>
      <div className={`win95-window-content ${noPadding ? 'no-padding' : ''}`}>
        {children}
      </div>
    </div>
  );
}
