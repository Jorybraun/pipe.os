/**
 * SidebarPortalContext — Lets child pages render content into Layout's aside panel.
 *
 * Layout provides a callback ref for the portal target div inside the aside.
 * Pages use createPortal() to render into it, while keeping their
 * React tree (and DndContext) intact.
 *
 * Uses state (not useRef) so components re-render when the portal target mounts/unmounts.
 */

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

interface SidebarPortalContextValue {
  /** The portal target DOM node (null when aside is hidden) */
  portalNode: HTMLDivElement | null;
  /** Callback ref — Layout attaches this to the portal target div */
  setPortalNode: (node: HTMLDivElement | null) => void;
  /** Tell Layout to show the aside (portal target) */
  openPortal: () => void;
  /** Tell Layout to hide the aside */
  closePortal: () => void;
  /** Whether the portal aside is open */
  isPortalOpen: boolean;
}

const Context = createContext<SidebarPortalContextValue | null>(null);

export function SidebarPortalProvider({ children }: { children: ReactNode }): JSX.Element {
  const [portalNode, setPortalNode] = useState<HTMLDivElement | null>(null);
  const [isPortalOpen, setIsPortalOpen] = useState(false);

  const openPortal = useCallback(() => setIsPortalOpen(true), []);
  const closePortal = useCallback(() => setIsPortalOpen(false), []);

  return (
    <Context.Provider value={{ portalNode, setPortalNode, openPortal, closePortal, isPortalOpen }}>
      {children}
    </Context.Provider>
  );
}

export function useSidebarPortal(): SidebarPortalContextValue {
  const ctx = useContext(Context);
  if (!ctx) throw new Error('useSidebarPortal must be used within SidebarPortalProvider');
  return ctx;
}
