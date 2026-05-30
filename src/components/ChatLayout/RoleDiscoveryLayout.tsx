/**
 * RoleDiscoveryLayout — wraps the role discovery interview in UniversalChat.
 *
 * This is the migration adapter: it takes the existing RoleDiscoveryPage
 * state and plugs it into the UniversalChat three-panel layout with the
 * RoleContextPanel as the sidebar.
 *
 * Usage:
 *   Replace the top-level <div> in RoleDiscoveryPage with:
 *   <RoleDiscoveryLayout sidebar={...} header={...}>
 *     {existing chat content}
 *   </RoleDiscoveryLayout>
 */

import { type ReactNode, type JSX } from 'react';
import { UniversalChat } from './UniversalChat';
import { RoleContextPanel } from '../ContextPanels/RoleContextPanel';
import type { DomainCompletionStatus } from '../../lib/api/types';

export interface RoleDiscoveryLayoutProps {
  children: ReactNode;
  /** Role title from scripted intake. */
  title?: string;
  /** Company name from scripted intake. */
  company?: string;
  /** Domain completion state from the interview hook. */
  domainCompletion?: Record<string, DomainCompletionStatus>;
  /** Current domain being explored. */
  currentDomain?: string | null;
  /** Baseline answers from scripted phase. */
  baseline?: Record<string, string>;
  /** Optional header content (breadcrumbs, etc). */
  header?: ReactNode;
  /** Whether to show the sidebar by default. */
  showSidebar?: boolean;
}

export function RoleDiscoveryLayout({
  children,
  title,
  company,
  domainCompletion,
  currentDomain,
  baseline,
  header,
  showSidebar = true,
}: RoleDiscoveryLayoutProps): JSX.Element {
  const panelProps = {
    ...(title !== undefined && { title }),
    ...(company !== undefined && { company }),
    ...(domainCompletion !== undefined && { domainCompletion }),
    ...(currentDomain !== undefined && { currentDomain }),
    ...(baseline !== undefined && { baseline }),
  };

  return (
    <UniversalChat
      sidebar={<RoleContextPanel {...panelProps} />}
      header={header}
      defaultSidebarOpen={showSidebar}
    >
      {children}
    </UniversalChat>
  );
}
