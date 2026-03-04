import { FileTabBar, type FileTabData } from './FileTabBar';

// ============================================================================
// Types
// ============================================================================

interface CodeTabProps {
  files: FileTabData[];
  activeFileId: string;
  activeFileContent: string;
  activeFileLanguage: string;
  onFileSelect: (fileId: string) => void;
  onFileClose: (fileId: string) => void;
  onAddFile: () => void;
  onFileSettings: (fileId: string) => void;
  onContentChange: (content: string) => void;
  /** When provided, renders a Monaco editor placeholder. In the real version, an actual <Editor> will be rendered. */
  editorSlot?: React.ReactNode;
}

// ============================================================================
// Component
// ============================================================================

/**
 * CodeTab - Multi-file code editor tab.
 * Contains a FileTabBar at top and a code editor area below.
 * The editor area either renders the `editorSlot` prop (for Monaco integration)
 * or falls back to a styled textarea for the stateless visual version.
 */
export function CodeTab({
  files,
  activeFileId,
  activeFileContent,
  activeFileLanguage,
  onFileSelect,
  onFileClose,
  onAddFile,
  onFileSettings,
  onContentChange,
  editorSlot,
}: CodeTabProps): JSX.Element {
  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
    }}>
      <FileTabBar
        files={files}
        activeFileId={activeFileId}
        onFileSelect={onFileSelect}
        onFileClose={onFileClose}
        onAddFile={onAddFile}
        onFileSettings={onFileSettings}
      />

      {/* Editor area */}
      <div style={{
        flex: 1,
        position: 'relative',
        overflow: 'hidden',
      }}>
        {editorSlot ? (
          editorSlot
        ) : (
          /* Fallback: styled textarea that mimics the Monaco look */
          <div style={{
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
          }}>
            {/* Language indicator */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '4px 16px',
              background: 'rgba(0,0,0,0.15)',
              borderBottom: '1px solid rgba(255,255,255,0.03)',
              flexShrink: 0,
            }}>
              <span style={{
                fontSize: 8,
                letterSpacing: '0.1em',
                color: 'rgba(255,255,255,0.15)',
                fontFamily: 'Space Mono, monospace',
                textTransform: 'uppercase',
              }}>
                {activeFileLanguage}
              </span>
              <span style={{
                fontSize: 8,
                color: 'rgba(255,255,255,0.1)',
                fontFamily: 'Space Mono, monospace',
              }}>
                {activeFileContent.split('\n').length} lines
              </span>
            </div>

            {/* Faux code editor */}
            <div style={{
              flex: 1,
              display: 'flex',
              overflow: 'hidden',
            }}>
              {/* Line numbers gutter */}
              <div style={{
                width: 48,
                padding: '12px 0',
                textAlign: 'right',
                background: 'rgba(0,0,0,0.2)',
                borderRight: '1px solid rgba(255,255,255,0.04)',
                overflow: 'hidden',
                flexShrink: 0,
              }}>
                {activeFileContent.split('\n').map((_, i) => (
                  <div
                    key={i}
                    style={{
                      padding: '0 12px 0 0',
                      fontSize: 11,
                      lineHeight: '20px',
                      color: 'rgba(255,255,255,0.12)',
                      fontFamily: 'Space Mono, monospace',
                    }}
                  >
                    {i + 1}
                  </div>
                ))}
              </div>

              {/* Code textarea */}
              <textarea
                value={activeFileContent}
                onChange={(e) => onContentChange(e.target.value)}
                spellCheck={false}
                style={{
                  flex: 1,
                  padding: '12px 16px',
                  background: 'transparent',
                  border: 'none',
                  color: 'rgba(255,255,255,0.75)',
                  fontSize: 13,
                  fontFamily: 'Space Mono, monospace',
                  lineHeight: '20px',
                  resize: 'none',
                  outline: 'none',
                  tabSize: 2,
                  whiteSpace: 'pre',
                  overflow: 'auto',
                  scrollbarWidth: 'thin',
                  scrollbarColor: 'rgba(255,255,255,0.1) transparent',
                }}
                placeholder="// Write your starter code here..."
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
