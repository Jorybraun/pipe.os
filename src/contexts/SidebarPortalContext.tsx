/**
 * SidebarPortalContext — Lets child pages render content into Layout's aside panel.
 *
 * Layout provides a ref to a portal target div inside the aside.
 * Pages use createPortal() to render into it, while keeping their
 * React tree (and DndContext) intact.
 */

import { createContext, useContext, useRef, useState, useCallback, type RefObject, type ReactNode } from 'react';

interface SidebarPortalContextValue {
  /** Ref to the portal target div inside Layout's aside */
  portalRef: RefObject<HTMLDivElement | null>;
  /** Tell Layout to show the aside (portal target) */
  openPortal: () => void;
  /** Tell Layout to hide the aside */
  closePortal: () => void;
  /** Whether the portal aside is open */
  isPortalOpen: boolean;
}

const Context = createContext<SidebarPortalContextValue | null>(null);

export function SidebarPortalProvider({ children }: { children: ReactNode }): JSX.Element {
  const portalRef = useRef<HTMLDivElement | null>(null);
  const [isPortalOpen, setIsPortalOpen] = useState(false);

  const openPortal = useCallback(() => setIsPortalOpen(true), []);
  const closePortal = useCallback(() => setIsPortalOpen(false), []);

  return (
    <Context.Provider value={{ portalRef, openPortal, closePortal, isPortalOpen }}>
      {children}
    </Context.Provider>
  );
}

export function useSidebarPortal(): SidebarPortalContextValue {
  const ctx = useContext(Context);
  if (!ctx) throw new Error('useSidebarPortal must be used within SidebarPortalProvider');
  return ctx;
}
