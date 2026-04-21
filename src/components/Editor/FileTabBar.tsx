// ---------------------------------------------------------------------------
// FileTabBar — file tabs for multi-file editing within VirtualFS
// ---------------------------------------------------------------------------

import { X, Plus, Lock } from 'lucide-react';
import type { VirtualFS } from '../../lib/challenge/virtualFS';

interface FileTabBarProps {
  files: VirtualFS;
  activeFile: string;
  onSelect: (path: string) => void;
  onAdd?: () => void;
  onRemove?: (path: string) => void;
  readOnlyPaths?: Set<string>;
}

export function FileTabBar({
  files,
  activeFile,
  onSelect,
  onAdd,
  onRemove,
}: FileTabBarProps): JSX.Element {
  const paths = Object.keys(files);

  return (
    <div style={{
      display: 'flex',
      alignItems: 'stretch',
      gap: 0,
      background: 'var(--pipe-surface)',
      borderBottom: '1px solid var(--pipe-border)',
      overflow: 'auto',
      minHeight: 36,
    }}>
      {paths.map((path) => {
        const isActive = path === activeFile;
        const file = files[path];
        const isReadOnly = file?.readOnly;
        const fileName = path.split('/').pop() || path;

        return (
          <div
            key={path}
            onClick={() => onSelect(path)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '0 14px',
              height: 36,
              background: isActive ? 'rgba(255,255,255,0.06)' : 'transparent',
              borderRight: '1px solid rgba(255,255,255,0.04)',
              borderBottom: isActive ? '2px solid var(--pipe-accent-border)' : '2px solid transparent',
              cursor: 'pointer',
              transition: 'background 100ms ease',
            }}
          >
            <span style={{
              fontSize: 11,
              fontFamily: 'Space Mono',
              color: isActive ? 'var(--pipe-text, #fff)' : 'rgba(255,255,255,0.45)',
              fontWeight: isActive ? 700 : 400,
              whiteSpace: 'nowrap',
            }}>
              {fileName}
            </span>
            {isReadOnly && (
              <Lock size={10} style={{ color: 'var(--pipe-text-dim)', flexShrink: 0 }} />
            )}
            {onRemove && !isReadOnly && paths.length > 1 && (
              <button
                onClick={(e) => { e.stopPropagation(); onRemove(path); }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--pipe-text-dim)',
                  cursor: 'pointer',
                  padding: 2,
                  display: 'flex',
                  alignItems: 'center',
                  flexShrink: 0,
                }}
              >
                <X size={10} />
              </button>
            )}
          </div>
        );
      })}

      {onAdd && (
        <button
          onClick={onAdd}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--pipe-text-dim)',
            cursor: 'pointer',
            padding: '0 12px',
            display: 'flex',
            alignItems: 'center',
          }}
          title="Add file"
        >
          <Plus size={14} />
        </button>
      )}
    </div>
  );
}
