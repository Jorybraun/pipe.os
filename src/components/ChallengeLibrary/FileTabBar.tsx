import { Plus, X, Settings } from 'lucide-react';

// ============================================================================
// Types
// ============================================================================

export interface FileTabData {
  id: string;
  name: string;
  language: string;
  isEntryPoint?: boolean;
}

interface FileTabBarProps {
  files: FileTabData[];
  activeFileId: string;
  onFileSelect: (fileId: string) => void;
  onFileClose: (fileId: string) => void;
  onAddFile: () => void;
  onFileSettings: (fileId: string) => void;
}

// ============================================================================
// Constants
// ============================================================================

const LANG_COLORS: Record<string, string> = {
  javascript: '#f7df1e',
  typescript: '#3178c6',
  jsx: '#61dafb',
  tsx: '#3178c6',
  html: '#e34f26',
  css: '#1572b6',
  python: '#3776ab',
  java: '#ed8b00',
  go: '#00add8',
  rust: '#dea584',
  json: '#292929',
};

// ============================================================================
// Component
// ============================================================================

/**
 * FileTabBar - Horizontal tab bar for multi-file editing.
 * Shows a tab per file with language-colored indicator, close button,
 * entry point marker, and an "add file" button.
 */
export function FileTabBar({
  files,
  activeFileId,
  onFileSelect,
  onFileClose,
  onAddFile,
  onFileSettings,
}: FileTabBarProps): JSX.Element {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      background: 'rgba(0,0,0,0.25)',
      borderBottom: '1px solid rgba(255,255,255,0.04)',
      flexShrink: 0,
      overflow: 'hidden',
    }}>
      {/* File tabs */}
      <div style={{
        display: 'flex',
        flex: 1,
        overflow: 'auto',
        scrollbarWidth: 'none',
      }}>
        {files.map((file) => {
          const isActive = activeFileId === file.id;
          const langColor = LANG_COLORS[file.language] ?? 'rgba(255,255,255,0.3)';

          return (
            <div
              key={file.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '0 4px 0 14px',
                height: 36,
                background: isActive ? 'rgba(255,255,255,0.04)' : 'transparent',
                borderRight: '1px solid rgba(255,255,255,0.03)',
                borderBottom: isActive ? `2px solid ${langColor}` : '2px solid transparent',
                cursor: 'pointer',
                transition: 'all 0.15s',
                position: 'relative',
                flexShrink: 0,
              }}
            >
              {/* Language dot */}
              <div style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: langColor,
                flexShrink: 0,
                boxShadow: isActive ? `0 0 6px ${langColor}60` : 'none',
              }} />

              {/* File name */}
              <button
                onClick={() => onFileSelect(file.id)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: isActive ? '#fff' : 'rgba(255,255,255,0.4)',
                  fontSize: 11,
                  fontFamily: 'Space Mono, monospace',
                  cursor: 'pointer',
                  padding: 0,
                  whiteSpace: 'nowrap',
                  transition: 'color 0.15s',
                }}
              >
                {file.name}
              </button>

              {/* Entry point indicator */}
              {file.isEntryPoint && (
                <span style={{
                  fontSize: 7,
                  fontWeight: 800,
                  letterSpacing: '0.08em',
                  color: '#4ade80',
                  fontFamily: 'Space Mono, monospace',
                  opacity: 0.6,
                }}>
                  ENTRY
                </span>
              )}

              {/* Settings/rename button */}
              <button
                onClick={(e) => { e.stopPropagation(); onFileSettings(file.id); }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 20,
                  height: 20,
                  background: 'transparent',
                  border: 'none',
                  color: 'rgba(255,255,255,0.15)',
                  cursor: 'pointer',
                  borderRadius: 3,
                  opacity: isActive ? 1 : 0,
                  transition: 'opacity 0.15s',
                  flexShrink: 0,
                }}
              >
                <Settings size={10} />
              </button>

              {/* Close button */}
              {files.length > 1 && (
                <button
                  onClick={(e) => { e.stopPropagation(); onFileClose(file.id); }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 20,
                    height: 20,
                    background: 'transparent',
                    border: 'none',
                    color: 'rgba(255,255,255,0.15)',
                    cursor: 'pointer',
                    borderRadius: 3,
                    transition: 'all 0.15s',
                    flexShrink: 0,
                  }}
                >
                  <X size={10} />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Add file button */}
      <button
        onClick={onAddFile}
        title="Add file"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 32,
          height: 36,
          background: 'transparent',
          border: 'none',
          borderLeft: '1px solid rgba(255,255,255,0.04)',
          color: 'rgba(255,255,255,0.2)',
          cursor: 'pointer',
          transition: 'all 0.15s',
          flexShrink: 0,
        }}
      >
        <Plus size={13} />
      </button>
    </div>
  );
}
