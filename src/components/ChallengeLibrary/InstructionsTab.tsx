import { FileText, Eye, Upload, Bold, Italic, Link, List, Code, Image, Heading } from 'lucide-react';

// ============================================================================
// Types
// ============================================================================

interface InstructionsTabProps {
  markdown: string;
  renderedHtml?: string;
  mode: 'edit' | 'preview' | 'split';
  readOnly?: boolean;
  onModeChange: (mode: 'edit' | 'preview' | 'split') => void;
  onMarkdownChange: (value: string) => void;
  onUploadClick: () => void;
}

// ============================================================================
// Toolbar items
// ============================================================================

const TOOLBAR_ITEMS = [
  { icon: Bold, label: 'Bold', action: 'bold' },
  { icon: Italic, label: 'Italic', action: 'italic' },
  { icon: Heading, label: 'Heading', action: 'heading' },
  { icon: Code, label: 'Code', action: 'code' },
  { icon: Link, label: 'Link', action: 'link' },
  { icon: List, label: 'List', action: 'list' },
  { icon: Image, label: 'Image', action: 'image' },
] as const;

// ============================================================================
// Component
// ============================================================================

/**
 * InstructionsTab - Markdown editor with formatting toolbar, live preview toggle,
 * and file upload support. Used for authoring challenge instructions.
 * 
 * Supports three modes:
 * - edit: Full-width markdown textarea
 * - preview: Full-width rendered markdown
 * - split: Side-by-side editor + preview
 */
export function InstructionsTab({
  markdown,
  renderedHtml,
  mode,
  readOnly = false,
  onModeChange,
  onMarkdownChange,
  onUploadClick,
}: InstructionsTabProps): JSX.Element {
  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 16px',
        borderBottom: '1px solid rgba(255,255,255,0.04)',
        background: 'rgba(0,0,0,0.2)',
        flexShrink: 0,
      }}>
        {/* Left: formatting buttons */}
        <div style={{ display: 'flex', gap: 2 }}>
          {TOOLBAR_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.action}
                title={item.label}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 28,
                  height: 28,
                  background: 'transparent',
                  border: '1px solid transparent',
                  borderRadius: 4,
                  color: 'rgba(255,255,255,0.35)',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                <Icon size={13} />
              </button>
            );
          })}

          {/* Divider */}
          <div style={{
            width: 1,
            height: 20,
            background: 'rgba(255,255,255,0.06)',
            margin: '4px 8px',
          }} />

          {/* Upload button */}
          <button
            onClick={onUploadClick}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 10px',
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: 4,
              color: 'rgba(255,255,255,0.4)',
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: '0.08em',
              fontFamily: 'Space Mono, monospace',
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            <Upload size={11} />
            UPLOAD .MD
          </button>
        </div>

        {/* Right: view mode toggle */}
        <div style={{
          display: 'flex',
          gap: 0,
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 4,
          overflow: 'hidden',
        }}>
          {([
            { id: 'edit' as const, label: 'EDIT', icon: FileText },
            { id: 'split' as const, label: 'SPLIT', icon: Code },
            { id: 'preview' as const, label: 'PREVIEW', icon: Eye },
          ]).map((m) => {
            const isActive = mode === m.id;
            const MIcon = m.icon;
            return (
              <button
                key={m.id}
                onClick={() => onModeChange(m.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '5px 12px',
                  background: isActive ? 'rgba(255,255,255,0.08)' : 'transparent',
                  border: 'none',
                  color: isActive ? '#fff' : 'rgba(255,255,255,0.25)',
                  fontSize: 8,
                  fontWeight: 700,
                  letterSpacing: '0.1em',
                  fontFamily: 'Space Mono, monospace',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                <MIcon size={10} />
                {m.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Content area */}
      <div style={{
        flex: 1,
        display: 'flex',
        gap: 0,
        overflow: 'hidden',
      }}>
        {/* Editor pane */}
        {(mode === 'edit' || mode === 'split') && (
          <div style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            borderRight: mode === 'split' ? '1px solid rgba(255,255,255,0.04)' : 'none',
          }}>
            <div style={{
              padding: '6px 16px',
              fontSize: 8,
              letterSpacing: '0.12em',
              color: 'rgba(255,255,255,0.15)',
              fontFamily: 'Space Mono, monospace',
              background: 'rgba(0,0,0,0.15)',
              borderBottom: '1px solid rgba(255,255,255,0.03)',
              flexShrink: 0,
            }}>
              MARKDOWN_EDITOR
            </div>
            <textarea
              value={markdown}
              onChange={(e) => onMarkdownChange(e.target.value)}
              readOnly={readOnly}
              placeholder={'# Challenge Title\n\nWrite your instructions in Markdown...\n\n## Description\n\nDescribe the problem the candidate needs to solve.\n\n## Requirements\n\n- Requirement 1\n- Requirement 2\n\n## Examples\n\n```javascript\n// Example code here\n```'}
              style={{
                flex: 1,
                width: '100%',
                padding: '20px 24px',
                background: 'transparent',
                border: 'none',
                color: readOnly ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.7)',
                fontSize: 13,
                fontFamily: 'Space Mono, monospace',
                lineHeight: 1.7,
                resize: 'none',
                outline: 'none',
                scrollbarWidth: 'thin',
                scrollbarColor: 'rgba(255,255,255,0.1) transparent',
              }}
            />
          </div>
        )}

        {/* Preview pane */}
        {(mode === 'preview' || mode === 'split') && (
          <div style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
          }}>
            <div style={{
              padding: '6px 16px',
              fontSize: 8,
              letterSpacing: '0.12em',
              color: 'rgba(255,255,255,0.15)',
              fontFamily: 'Space Mono, monospace',
              background: 'rgba(0,0,0,0.15)',
              borderBottom: '1px solid rgba(255,255,255,0.03)',
              flexShrink: 0,
            }}>
              RENDERED_PREVIEW
            </div>
            <div
              style={{
                flex: 1,
                padding: '20px 24px',
                color: 'rgba(255,255,255,0.8)',
                fontSize: 14,
                lineHeight: 1.7,
                overflow: 'auto',
                scrollbarWidth: 'thin',
                scrollbarColor: 'rgba(255,255,255,0.1) transparent',
              }}
            >
              {renderedHtml ? (
                <div
                  dangerouslySetInnerHTML={{ __html: renderedHtml }}
                  style={{ maxWidth: 720 }}
                />
              ) : (
                <div style={{
                  color: 'rgba(255,255,255,0.15)',
                  fontStyle: 'italic',
                  fontSize: 12,
                }}>
                  {markdown ? 'Rendering preview...' : 'Start writing to see the preview'}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
