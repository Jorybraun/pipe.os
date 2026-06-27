import { useCallback, useRef, useState } from 'react';

export type WindowType =
  | 'video'
  | 'workspace'
  | 'chat'
  | 'tasks'
  | 'snippet'
  | 'browser'
  | 'notepad'
  | 'paint'
  | 'terminal'
  | 'custom';

export interface WindowState {
  id: string;
  windowType: WindowType;
  title: string;
  icon?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  minimized: boolean;
  maximized: boolean;
  focused: boolean;
  prevX?: number;
  prevY?: number;
  prevWidth?: number;
  prevHeight?: number;
  data?: Record<string, unknown>;
}

export interface WindowStatePatch {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  minimized?: boolean;
  maximized?: boolean;
  focused?: boolean;
}

export interface OpenWindowConfig {
  id?: string;
  windowType: WindowType;
  title: string;
  icon?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  minimized?: boolean;
  maximized?: boolean;
  focused?: boolean;
  data?: Record<string, unknown>;
}

export interface WindowManagerApi {
  windows: WindowState[];
  openWindow: (config: OpenWindowConfig) => string;
  closeWindow: (id: string) => void;
  focusWindow: (id: string) => void;
  minimizeWindow: (id: string) => void;
  toggleMaximize: (id: string) => void;
  moveWindow: (id: string, x: number, y: number) => void;
  resizeWindow: (id: string, width: number, height: number) => void;
  updateWindowData: (id: string, data: Partial<Record<string, unknown>>) => void;
  applyWindowState: (id: string, patch: WindowStatePatch) => void;
  restoreWindow: (id: string) => void;
  isWindowOpen: (windowType: WindowType) => boolean;
  getWindowByType: (windowType: WindowType) => WindowState | undefined;
}

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

const DEFAULT_SIZES: Record<WindowType, { width: number; height: number }> = {
  video: { width: 480, height: 360 },
  workspace: { width: 800, height: 560 },
  chat: { width: 360, height: 440 },
  tasks: { width: 420, height: 480 },
  snippet: { width: 480, height: 320 },
  browser: { width: 800, height: 560 },
  notepad: { width: 520, height: 420 },
  paint: { width: 640, height: 480 },
  terminal: { width: 640, height: 400 },
  custom: { width: 400, height: 300 },
};

export function useWindowManager(): WindowManagerApi {
  const [windows, setWindows] = useState<WindowState[]>([]);
  const zCounter = useRef(10);

  const focusWindow = useCallback((id: string): void => {
    zCounter.current += 1;
    const nextZ = zCounter.current;
    setWindows((prev) =>
      prev.map((w) =>
        w.id === id
          ? { ...w, focused: true, minimized: false, zIndex: nextZ }
          : { ...w, focused: false },
      ),
    );
  }, []);

  const openWindow = useCallback((config: OpenWindowConfig): string => {
    const id = config.id ?? nextId(config.windowType);
    const defaults = DEFAULT_SIZES[config.windowType] ?? DEFAULT_SIZES.custom;
    zCounter.current += 1;
    const nextZ = zCounter.current;

    setWindows((prev) => {
      const existing = prev.find((w) => w.id === id);
      if (existing) {
        return prev.map((w) =>
          w.id === id
            ? { ...w, minimized: false, focused: true, zIndex: nextZ }
            : { ...w, focused: false },
        );
      }
      const newWindow: WindowState = {
        id,
        windowType: config.windowType,
        title: config.title,
        icon: config.icon,
        x: config.x ?? 40 + (prev.length * 24) % 200,
        y: config.y ?? 30 + (prev.length * 24) % 160,
        width: config.width ?? defaults.width,
        height: config.height ?? defaults.height,
        zIndex: nextZ,
        minimized: config.minimized ?? false,
        maximized: config.maximized ?? false,
        focused: config.focused ?? true,
        data: config.data,
      };
      return [...prev.map((w) => ({ ...w, focused: false })), newWindow];
    });

    return id;
  }, []);

  const closeWindow = useCallback((id: string): void => {
    setWindows((prev) => prev.filter((w) => w.id !== id));
  }, []);

  const minimizeWindow = useCallback((id: string): void => {
    setWindows((prev) =>
      prev.map((w) =>
        w.id === id ? { ...w, minimized: true, focused: false } : w,
      ),
    );
  }, []);

  const restoreWindow = useCallback((id: string): void => {
    zCounter.current += 1;
    const nextZ = zCounter.current;
    setWindows((prev) =>
      prev.map((w) =>
        w.id === id
          ? { ...w, minimized: false, focused: true, zIndex: nextZ }
          : { ...w, focused: false },
      ),
    );
  }, []);

  const toggleMaximize = useCallback((id: string): void => {
    setWindows((prev) =>
      prev.map((w) => {
        if (w.id !== id) return w;
        if (w.maximized) {
          return {
            ...w,
            maximized: false,
            x: w.prevX ?? w.x,
            y: w.prevY ?? w.y,
            width: w.prevWidth ?? w.width,
            height: w.prevHeight ?? w.height,
          };
        }
        return {
          ...w,
          maximized: true,
          prevX: w.x,
          prevY: w.y,
          prevWidth: w.width,
          prevHeight: w.height,
        };
      }),
    );
  }, []);

  const moveWindow = useCallback((id: string, x: number, y: number): void => {
    setWindows((prev) =>
      prev.map((w) => (w.id === id ? { ...w, x, y } : w)),
    );
  }, []);

  const resizeWindow = useCallback((id: string, width: number, height: number): void => {
    setWindows((prev) =>
      prev.map((w) => (w.id === id ? { ...w, width, height } : w)),
    );
  }, []);

  const updateWindowData = useCallback(
    (id: string, data: Partial<Record<string, unknown>>): void => {
      setWindows((prev) =>
        prev.map((w) =>
          w.id === id ? { ...w, data: { ...w.data, ...data } } : w,
        ),
      );
    },
    [],
  );

  const applyWindowState = useCallback((id: string, patch: WindowStatePatch): void => {
    const focusTarget = patch.focused === true;
    if (focusTarget) {
      zCounter.current += 1;
    }
    const nextZ = zCounter.current;
    setWindows((prev) =>
      prev.map((w) => {
        if (w.id !== id) {
          return focusTarget ? { ...w, focused: false } : w;
        }
        return {
          ...w,
          x: patch.x ?? w.x,
          y: patch.y ?? w.y,
          width: patch.width ?? w.width,
          height: patch.height ?? w.height,
          minimized: patch.minimized ?? w.minimized,
          maximized: patch.maximized ?? w.maximized,
          focused: patch.focused ?? w.focused,
          zIndex: focusTarget ? nextZ : w.zIndex,
        };
      }),
    );
  }, []);

  const isWindowOpen = useCallback(
    (windowType: WindowType): boolean =>
      windows.some((w) => w.windowType === windowType),
    [windows],
  );

  const getWindowByType = useCallback(
    (windowType: WindowType): WindowState | undefined =>
      windows.find((w) => w.windowType === windowType),
    [windows],
  );

  return {
    windows,
    openWindow,
    closeWindow,
    focusWindow,
    minimizeWindow,
    toggleMaximize,
    moveWindow,
    resizeWindow,
    updateWindowData,
    applyWindowState,
    restoreWindow,
    isWindowOpen,
    getWindowByType,
  };
}
