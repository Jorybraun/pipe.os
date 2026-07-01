import { useCallback, useRef, useState } from 'react';

export type ToolSurfaceType =
  | 'video'
  | 'workspace'
  | 'chat'
  | 'terminal'
  | 'submission'
  | 'custom';

export interface ToolSurfaceState {
  id: string;
  surfaceType: ToolSurfaceType;
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

export interface ToolSurfaceStatePatch {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  minimized?: boolean;
  maximized?: boolean;
  focused?: boolean;
}

export interface OpenToolSurfaceConfig {
  id?: string;
  surfaceType: ToolSurfaceType;
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

export interface ToolSurfaceManagerApi {
  surfaces: ToolSurfaceState[];
  openSurface: (config: OpenToolSurfaceConfig) => string;
  closeSurface: (id: string) => void;
  focusSurface: (id: string) => void;
  minimizeSurface: (id: string) => void;
  toggleMaximizeSurface: (id: string) => void;
  moveSurface: (id: string, x: number, y: number) => void;
  resizeSurface: (id: string, width: number, height: number) => void;
  updateSurfaceData: (id: string, data: Partial<Record<string, unknown>>) => void;
  applySurfaceState: (id: string, patch: ToolSurfaceStatePatch) => void;
  restoreSurface: (id: string) => void;
  isSurfaceOpen: (surfaceType: ToolSurfaceType) => boolean;
  getSurfaceByType: (surfaceType: ToolSurfaceType) => ToolSurfaceState | undefined;
}

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

const DEFAULT_SIZES: Record<ToolSurfaceType, { width: number; height: number }> = {
  video: { width: 480, height: 360 },
  workspace: { width: 800, height: 560 },
  chat: { width: 360, height: 440 },
  terminal: { width: 640, height: 400 },
  submission: { width: 680, height: 560 },
  custom: { width: 400, height: 300 },
};

export function useToolSurfaceManager(): ToolSurfaceManagerApi {
  const [surfaces, setSurfaces] = useState<ToolSurfaceState[]>([]);
  const zCounter = useRef(10);

  const focusSurface = useCallback((id: string): void => {
    zCounter.current += 1;
    const nextZ = zCounter.current;
    setSurfaces((prev) =>
      prev.map((w) =>
        w.id === id
          ? { ...w, focused: true, minimized: false, zIndex: nextZ }
          : { ...w, focused: false },
      ),
    );
  }, []);

  const openSurface = useCallback((config: OpenToolSurfaceConfig): string => {
    const id = config.id ?? nextId(config.surfaceType);
    const defaults = DEFAULT_SIZES[config.surfaceType] ?? DEFAULT_SIZES.custom;
    zCounter.current += 1;
    const nextZ = zCounter.current;

    setSurfaces((prev) => {
      const existing = prev.find((w) => w.id === id);
      if (existing) {
        return prev.map((w) =>
          w.id === id
            ? { ...w, minimized: false, focused: true, zIndex: nextZ }
            : { ...w, focused: false },
        );
      }
      const newSurface: ToolSurfaceState = {
        id,
        surfaceType: config.surfaceType,
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
      return [...prev.map((w) => ({ ...w, focused: false })), newSurface];
    });

    return id;
  }, []);

  const closeSurface = useCallback((id: string): void => {
    setSurfaces((prev) => prev.filter((w) => w.id !== id));
  }, []);

  const minimizeSurface = useCallback((id: string): void => {
    setSurfaces((prev) =>
      prev.map((w) =>
        w.id === id ? { ...w, minimized: true, focused: false } : w,
      ),
    );
  }, []);

  const restoreSurface = useCallback((id: string): void => {
    zCounter.current += 1;
    const nextZ = zCounter.current;
    setSurfaces((prev) =>
      prev.map((w) =>
        w.id === id
          ? { ...w, minimized: false, focused: true, zIndex: nextZ }
          : { ...w, focused: false },
      ),
    );
  }, []);

  const toggleMaximizeSurface = useCallback((id: string): void => {
    setSurfaces((prev) =>
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

  const moveSurface = useCallback((id: string, x: number, y: number): void => {
    setSurfaces((prev) =>
      prev.map((w) => (w.id === id ? { ...w, x, y } : w)),
    );
  }, []);

  const resizeSurface = useCallback((id: string, width: number, height: number): void => {
    setSurfaces((prev) =>
      prev.map((w) => (w.id === id ? { ...w, width, height } : w)),
    );
  }, []);

  const updateSurfaceData = useCallback(
    (id: string, data: Partial<Record<string, unknown>>): void => {
      setSurfaces((prev) =>
        prev.map((w) =>
          w.id === id ? { ...w, data: { ...w.data, ...data } } : w,
        ),
      );
    },
    [],
  );

  const applySurfaceState = useCallback((id: string, patch: ToolSurfaceStatePatch): void => {
    const focusTarget = patch.focused === true;
    if (focusTarget) {
      zCounter.current += 1;
    }
    const nextZ = zCounter.current;
    setSurfaces((prev) =>
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

  const isSurfaceOpen = useCallback(
    (surfaceType: ToolSurfaceType): boolean =>
      surfaces.some((w) => w.surfaceType === surfaceType),
    [surfaces],
  );

  const getSurfaceByType = useCallback(
    (surfaceType: ToolSurfaceType): ToolSurfaceState | undefined =>
      surfaces.find((w) => w.surfaceType === surfaceType),
    [surfaces],
  );

  return {
    surfaces,
    openSurface,
    closeSurface,
    focusSurface,
    minimizeSurface,
    toggleMaximizeSurface,
    moveSurface,
    resizeSurface,
    updateSurfaceData,
    applySurfaceState,
    restoreSurface,
    isSurfaceOpen,
    getSurfaceByType,
  };
}
