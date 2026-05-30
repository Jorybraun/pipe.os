/**
 * CodeContextPanel — context panel for code review challenges.
 *
 * Shows PR metadata, file list with diff stats, and review scoring signals.
 * Designed to sit alongside the DiffPanel in the UniversalChat layout.
 */

import { type JSX } from 'react';
import { FileCode, GitPullRequest, ExternalLink } from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DiffFile {
  path: string;
  additions: number;
  deletions: number;
  selected?: boolean;
}

export interface CodeContextPanelProps {
  /** PR title. */
  prTitle?: string;
  /** PR number. */
  prNumber?: number;
  /** Repository URL. */
  repoUrl?: string;
  /** PR description (truncated). */
  description?: string;
  /** List of changed files with diff stats. */
  files?: DiffFile[];
  /** Callback when a file is selected. */
  onFileSelect?: (path: string) => void;
  /** Currently selected file. */
  selectedFile?: string;
  /** Review signals/scores. */
  signals?: Record<string, number | string>;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function CodeContextPanel({
  prTitle,
  prNumber,
  repoUrl,
  description,
  files = [],
  onFileSelect,
  selectedFile,
  signals = {},
}: CodeContextPanelProps): JSX.Element {
  const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0);
  const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);

  return (
    <div className="space-y-4">
      {/* PR Header */}
      {prTitle && (
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <GitPullRequest size={14} className="text-[var(--color-info)] flex-shrink-0" />
            <h3 className="text-sm font-semibold text-[var(--color-text)] truncate">
              {prTitle}
            </h3>
          </div>
          {prNumber && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-[var(--color-text-muted)]">
                #{prNumber}
              </span>
              {repoUrl && (
                <a
                  href={repoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-[var(--color-text-dim)] hover:text-[var(--color-text)] transition-colors"
                >
                  <ExternalLink size={10} />
                </a>
              )}
            </div>
          )}
        </div>
      )}

      {/* Description */}
      {description && (
        <p className="text-xs text-[var(--color-text-muted)] line-clamp-3">
          {description}
        </p>
      )}

      {/* Stats */}
      {files.length > 0 && (
        <div className="flex items-center gap-3 text-xs">
          <span className="text-[var(--color-text-muted)]">
            {files.length} file{files.length !== 1 ? 's' : ''}
          </span>
          <span className="text-[var(--color-success)]">+{totalAdditions}</span>
          <span className="text-[var(--color-error)]">-{totalDeletions}</span>
        </div>
      )}

      {/* File List */}
      {files.length > 0 && (
        <div className="space-y-0.5">
          <span className="text-xs font-medium text-[var(--color-text-muted)]">
            Changed Files
          </span>
          <div className="space-y-0.5 max-h-64 overflow-y-auto">
            {files.map((file) => (
              <button
                key={file.path}
                onClick={() => onFileSelect?.(file.path)}
                className={[
                  'w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-left',
                  'hover:bg-[var(--color-surface-hover)] transition-colors',
                  file.path === selectedFile
                    ? 'bg-[var(--color-accent-surface)] border border-[var(--color-accent-border)]'
                    : '',
                ].join(' ')}
              >
                <FileCode size={12} className="text-[var(--color-text-dim)] flex-shrink-0" />
                <span className="flex-1 truncate text-[var(--color-text-muted)]">
                  {file.path.split('/').pop()}
                </span>
                <span className="text-[var(--color-success)] font-mono">
                  +{file.additions}
                </span>
                <span className="text-[var(--color-error)] font-mono">
                  -{file.deletions}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Signals */}
      {Object.keys(signals).length > 0 && (
        <div className="space-y-1.5 pt-2 border-t border-[var(--color-border)]">
          <span className="text-xs font-medium text-[var(--color-text-muted)]">
            Review Signals
          </span>
          {Object.entries(signals).map(([key, value]) => (
            <div key={key} className="flex items-center justify-between text-xs">
              <span className="text-[var(--color-text-dim)]">{key}</span>
              <span className="text-[var(--color-text-muted)] font-mono">
                {typeof value === 'number' ? value.toFixed(1) : value}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
