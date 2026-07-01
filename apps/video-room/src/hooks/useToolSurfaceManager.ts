import { useCallback, useState } from 'react';

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
  active: boolean;
  data?: Record<string, unknown>;
}

export interface OpenToolSurfaceConfig {
  id?: string;
  surfaceType: ToolSurfaceType;
  title: string;
  icon?: string;
  active?: boolean;
  data?: Record<string, unknown>;
}

export interface ToolSurfaceManagerApi {
  surfaces: ToolSurfaceState[];
  openSurface: (config: OpenToolSurfaceConfig) => string;
  closeSurface: (id: string) => void;
  focusSurface: (id: string) => void;
  updateSurfaceData: (id: string, data: Partial<Record<string, unknown>>) => void;
  isSurfaceOpen: (surfaceType: ToolSurfaceType) => boolean;
  getSurfaceByType: (surfaceType: ToolSurfaceType) => ToolSurfaceState | undefined;
}

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

export function useToolSurfaceManager(): ToolSurfaceManagerApi {
  const [surfaces, setSurfaces] = useState<ToolSurfaceState[]>([]);

  const focusSurface = useCallback((id: string): void => {
    setSurfaces((prev) =>
      prev.map((surface) =>
        surface.id === id
          ? { ...surface, active: true }
          : { ...surface, active: false },
      ),
    );
  }, []);

  const openSurface = useCallback((config: OpenToolSurfaceConfig): string => {
    const id = config.id ?? nextId(config.surfaceType);
    const shouldActivate = config.active ?? true;

    setSurfaces((prev) => {
      const existing = prev.find((surface) => surface.id === id);
      if (existing) {
        return prev.map((surface) =>
          surface.id === id
            ? { ...surface, active: shouldActivate || surface.active, data: config.data ?? surface.data }
            : shouldActivate ? { ...surface, active: false } : surface,
        );
      }
      const newSurface: ToolSurfaceState = {
        id,
        surfaceType: config.surfaceType,
        title: config.title,
        icon: config.icon,
        active: shouldActivate,
        data: config.data,
      };
      return [
        ...prev.map((surface) => (shouldActivate ? { ...surface, active: false } : surface)),
        newSurface,
      ];
    });

    return id;
  }, []);

  const closeSurface = useCallback((id: string): void => {
    setSurfaces((prev) => prev.filter((w) => w.id !== id));
  }, []);

  const updateSurfaceData = useCallback(
    (id: string, data: Partial<Record<string, unknown>>): void => {
      setSurfaces((prev) =>
        prev.map((surface) =>
          surface.id === id ? { ...surface, data: { ...surface.data, ...data } } : surface,
        ),
      );
    },
    [],
  );

  const isSurfaceOpen = useCallback(
    (surfaceType: ToolSurfaceType): boolean =>
      surfaces.some((surface) => surface.surfaceType === surfaceType),
    [surfaces],
  );

  const getSurfaceByType = useCallback(
    (surfaceType: ToolSurfaceType): ToolSurfaceState | undefined =>
      surfaces.find((surface) => surface.surfaceType === surfaceType),
    [surfaces],
  );

  return {
    surfaces,
    openSurface,
    closeSurface,
    focusSurface,
    updateSurfaceData,
    isSurfaceOpen,
    getSurfaceByType,
  };
}
