/**
 * RoleContextPanel — sidebar for role discovery showing domain progress,
 * baseline data, and inline editing of the emerging role context.
 */

import { useState, type JSX, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, Edit3, Check, X } from 'lucide-react';
import type { DomainCompletionStatus } from '../../lib/api/types';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RoleContextPanelProps {
  /** Role title (e.g., "Senior Frontend Engineer"). */
  title?: string;
  /** Company name. */
  company?: string;
  /** Domain completion map. */
  domainCompletion?: Record<string, DomainCompletionStatus>;
  /** Current active domain. */
  currentDomain?: string | null;
  /** Baseline fields collected during scripted intake. */
  baseline?: Record<string, string>;
  /** Callback when user edits a baseline field inline. */
  onBaselineEdit?: (field: string, value: string) => void;
}

// ─── Domain ordering + labels ────────────────────────────────────────────────

const DOMAINS: Array<{ key: string; label: string }> = [
  { key: 'team', label: 'Team & Culture' },
  { key: 'work', label: 'Day-to-Day Work' },
  { key: 'bar', label: 'Hiring Bar' },
  { key: 'code', label: 'Technical Depth' },
  { key: 'tic', label: 'Traits & Intangibles' },
  { key: 'soul', label: 'Soul & Values' },
];

const statusColors: Record<DomainCompletionStatus, string> = {
  pending: 'bg-[var(--color-surface)]',
  generating: 'bg-[var(--color-warning)]',
  asking: 'bg-[var(--color-info)]',
  depth_check: 'bg-[var(--color-info)]',
  follow_up: 'bg-[var(--color-info)]',
  complete: 'bg-[var(--color-success)]',
};

// ─── Component ───────────────────────────────────────────────────────────────

export function RoleContextPanel({
  title,
  company,
  domainCompletion = {},
  currentDomain,
  baseline = {},
  onBaselineEdit,
}: RoleContextPanelProps): JSX.Element {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(['domains', 'baseline']),
  );
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const toggleSection = (key: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const startEdit = (field: string, currentValue: string) => {
    setEditingField(field);
    setEditValue(currentValue);
  };

  const confirmEdit = () => {
    if (editingField && onBaselineEdit) {
      onBaselineEdit(editingField, editValue);
    }
    setEditingField(null);
  };

  const cancelEdit = () => {
    setEditingField(null);
  };

  return (
    <div className="space-y-4">
      {/* Role header */}
      {(title || company) && (
        <div className="space-y-1">
          {title && (
            <h3 className="text-sm font-semibold text-[var(--color-text)]">
              {title}
            </h3>
          )}
          {company && (
            <p className="text-xs text-[var(--color-text-muted)]">{company}</p>
          )}
        </div>
      )}

      {/* Domain Progress */}
      <CollapsibleSection
        title="Domain Progress"
        sectionKey="domains"
        expanded={expandedSections.has('domains')}
        onToggle={toggleSection}
      >
        <div className="space-y-2">
          {DOMAINS.map(({ key, label }) => {
            const status = domainCompletion[key] ?? 'pending';
            const isActive = key === currentDomain;
            return (
              <div
                key={key}
                className={[
                  'flex items-center gap-2 px-2 py-1.5 rounded-md text-xs',
                  isActive
                    ? 'bg-[var(--color-accent-surface)] border border-[var(--color-accent-border)]'
                    : '',
                ].join(' ')}
              >
                <span
                  className={[
                    'w-2 h-2 rounded-full flex-shrink-0',
                    statusColors[status],
                  ].join(' ')}
                />
                <span
                  className={[
                    'flex-1',
                    isActive
                      ? 'text-[var(--color-text)] font-medium'
                      : 'text-[var(--color-text-muted)]',
                  ].join(' ')}
                >
                  {label}
                </span>
                <span className="text-[var(--color-text-dim)] capitalize">
                  {status}
                </span>
              </div>
            );
          })}
        </div>
      </CollapsibleSection>

      {/* Baseline Fields */}
      {Object.keys(baseline).length > 0 && (
        <CollapsibleSection
          title="Baseline"
          sectionKey="baseline"
          expanded={expandedSections.has('baseline')}
          onToggle={toggleSection}
        >
          <div className="space-y-2">
            {Object.entries(baseline).map(([field, value]) => (
              <div key={field} className="group">
                <div className="flex items-center gap-1">
                  <span className="text-xs text-[var(--color-text-dim)] capitalize">
                    {field.replace(/^sq-/, '').replace(/-/g, ' ')}
                  </span>
                  {onBaselineEdit && editingField !== field && (
                    <button
                      onClick={() => startEdit(field, value)}
                      className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-[var(--color-text-dim)] hover:text-[var(--color-text)] transition-opacity"
                    >
                      <Edit3 size={10} />
                    </button>
                  )}
                </div>
                {editingField === field ? (
                  <div className="flex items-center gap-1 mt-0.5">
                    <input
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      className="flex-1 text-xs px-2 py-1 rounded bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text)] outline-none focus:border-[var(--color-accent-border)]"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') confirmEdit();
                        if (e.key === 'Escape') cancelEdit();
                      }}
                    />
                    <button onClick={confirmEdit} className="p-0.5 text-[var(--color-success)]">
                      <Check size={12} />
                    </button>
                    <button onClick={cancelEdit} className="p-0.5 text-[var(--color-text-dim)]">
                      <X size={12} />
                    </button>
                  </div>
                ) : (
                  <p className="text-xs text-[var(--color-text)]">{value || '—'}</p>
                )}
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}
    </div>
  );
}

// ─── Shared collapsible section ──────────────────────────────────────────────

function CollapsibleSection({
  title,
  sectionKey,
  expanded,
  onToggle,
  children,
}: {
  title: string;
  sectionKey: string;
  expanded: boolean;
  onToggle: (key: string) => void;
  children: ReactNode;
}) {
  return (
    <div>
      <button
        onClick={() => onToggle(sectionKey)}
        className="flex items-center gap-1.5 w-full text-left text-xs font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {title}
      </button>
      {expanded && <div className="mt-2">{children}</div>}
    </div>
  );
}


