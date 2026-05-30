/**
 * UniversalChat — shared three-panel layout for all chat-based pages.
 *
 * Architecture:
 *   ┌──────────────┬─────────────────────────┬───────────────┐
 *   │   Sidebar    │      Chat (main)         │  Context Panel│
 *   │  (optional)  │  (conversation area)     │  (optional)   │
 *   └──────────────┴─────────────────────────┴───────────────┘
 *
 * - Sidebar slot: navigation, domain progress, role context editor
 * - Chat area: always present — renders AIChat or custom content
 * - Context panel: evidence, source references, inline editing
 *
 * All panels are collapsible and responsive. On mobile, sidebar and
 * context panel become slide-over drawers.
 */

import { useState, useCallback, type ReactNode, type JSX } from 'react';
import { PanelLeft, PanelRight, X } from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface UniversalChatProps {
  /** Main chat content — typically <AIChat> or a custom conversation view. */
  children: ReactNode;
  /** Left sidebar content (domain progress, navigation, context editor). */
  sidebar?: ReactNode;
  /** Right context panel (evidence, source references). */
  contextPanel?: ReactNode;
  /** Header rendered above the chat area (breadcrumbs, title). */
  header?: ReactNode;
  /** Footer below the chat area (status bar, actions). */
  footer?: ReactNode;
  /** Initial sidebar visibility. Default: true if sidebar is provided. */
  defaultSidebarOpen?: boolean;
  /** Initial context panel visibility. Default: false. */
  defaultContextOpen?: boolean;
  /** Sidebar width class. Default: 'w-72'. */
  sidebarWidth?: string;
  /** Context panel width class. Default: 'w-80'. */
  contextWidth?: string;
  /** Additional class on the root wrapper. */
  className?: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function UniversalChat({
  children,
  sidebar,
  contextPanel,
  header,
  footer,
  defaultSidebarOpen,
  defaultContextOpen = false,
  sidebarWidth = 'w-72',
  contextWidth = 'w-80',
  className = '',
}: UniversalChatProps): JSX.Element {
  const [sidebarOpen, setSidebarOpen] = useState(
    defaultSidebarOpen ?? !!sidebar,
  );
  const [contextOpen, setContextOpen] = useState(defaultContextOpen);

  const toggleSidebar = useCallback(() => setSidebarOpen((v) => !v), []);
  const toggleContext = useCallback(() => setContextOpen((v) => !v), []);

  return (
    <div
      className={[
        'flex h-full w-full overflow-hidden',
        'bg-[var(--color-bg)] text-[var(--color-text)]',
        className,
      ].join(' ')}
    >
      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      {sidebar && (
        <aside
          className={[
            sidebarWidth,
            'flex-shrink-0 flex flex-col',
            'border-r border-[var(--color-border)]',
            'bg-[var(--color-surface-solid)]',
            'transition-all duration-normal ease-[var(--ease-standard)]',
            sidebarOpen ? 'translate-x-0' : '-translate-x-full absolute -left-full',
          ].join(' ')}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
            <span className="text-sm font-medium text-[var(--color-text-muted)]">
              Context
            </span>
            <button
              onClick={toggleSidebar}
              className="p-1 rounded-md text-[var(--color-text-dim)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] transition-colors"
              aria-label="Close sidebar"
            >
              <X size={16} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {sidebar}
          </div>
        </aside>
      )}

      {/* ── Main Chat Area ──────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header bar with panel toggles */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--color-border)] bg-[var(--color-surface-solid)]">
          {sidebar && !sidebarOpen && (
            <button
              onClick={toggleSidebar}
              className="p-1.5 rounded-md text-[var(--color-text-dim)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] transition-colors"
              aria-label="Open sidebar"
            >
              <PanelLeft size={18} />
            </button>
          )}

          <div className="flex-1 min-w-0">
            {header}
          </div>

          {contextPanel && !contextOpen && (
            <button
              onClick={toggleContext}
              className="p-1.5 rounded-md text-[var(--color-text-dim)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] transition-colors"
              aria-label="Open context panel"
            >
              <PanelRight size={18} />
            </button>
          )}
        </div>

        {/* Chat content */}
        <div className="flex-1 overflow-y-auto">
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div className="border-t border-[var(--color-border)] bg-[var(--color-surface-solid)]">
            {footer}
          </div>
        )}
      </main>

      {/* ── Context Panel ───────────────────────────────────────────────── */}
      {contextPanel && contextOpen && (
        <aside
          className={[
            contextWidth,
            'flex-shrink-0 flex flex-col',
            'border-l border-[var(--color-border)]',
            'bg-[var(--color-surface-solid)]',
            'transition-all duration-normal ease-[var(--ease-standard)]',
          ].join(' ')}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
            <span className="text-sm font-medium text-[var(--color-text-muted)]">
              Details
            </span>
            <button
              onClick={toggleContext}
              className="p-1 rounded-md text-[var(--color-text-dim)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] transition-colors"
              aria-label="Close context panel"
            >
              <X size={16} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {contextPanel}
          </div>
        </aside>
      )}
    </div>
  );
}
