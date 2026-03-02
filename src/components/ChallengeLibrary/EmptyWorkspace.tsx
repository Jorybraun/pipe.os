import { Code, Sparkles, BookOpen } from 'lucide-react';

// ============================================================================
// Component
// ============================================================================

/**
 * EmptyWorkspace - Shown when no challenge is selected in the library.
 * Displays a centered message with helpful guidance.
 */
export function EmptyWorkspace(): JSX.Element {
  return (
    <div style={{
      flex: 1,
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 24,
      background: 'rgba(12, 12, 14, 0.3)',
    }}>
      {/* Icon cluster */}
      <div style={{
        position: 'relative',
        width: 80,
        height: 80,
      }}>
        <div style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(255,255,255,0.02)',
          border: '1px solid rgba(255,255,255,0.04)',
          borderRadius: 16,
        }}>
          <Code size={28} color="rgba(255,255,255,0.08)" />
        </div>
        {/* Floating accent dots */}
        <div style={{
          position: 'absolute',
          top: -4,
          right: -4,
          width: 12,
          height: 12,
          borderRadius: '50%',
          background: 'rgba(167, 139, 250, 0.15)',
          border: '1px solid rgba(167, 139, 250, 0.25)',
        }} />
        <div style={{
          position: 'absolute',
          bottom: -2,
          left: -6,
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: 'rgba(96, 165, 250, 0.15)',
          border: '1px solid rgba(96, 165, 250, 0.25)',
        }} />
      </div>

      {/* Text */}
      <div style={{ textAlign: 'center', maxWidth: 360 }}>
        <div style={{
          fontSize: 8,
          letterSpacing: '0.2em',
          color: 'rgba(255,255,255,0.15)',
          fontFamily: 'Space Mono, monospace',
          marginBottom: 12,
        }}>
          SELECT_CHALLENGE
        </div>
        <h3 style={{
          fontSize: 16,
          fontWeight: 700,
          color: 'rgba(255,255,255,0.5)',
          margin: '0 0 12px',
          lineHeight: 1.3,
        }}>
          Select a challenge to edit
        </h3>
        <p style={{
          fontSize: 12,
          color: 'rgba(255,255,255,0.2)',
          lineHeight: 1.6,
          margin: 0,
        }}>
          Choose a challenge from the list or create a new one to start editing
          instructions, code, and test cases.
        </p>
      </div>

      {/* Hint cards */}
      <div style={{
        display: 'flex',
        gap: 16,
        marginTop: 8,
      }}>
        {[
          { icon: BookOpen, label: 'Write Instructions', desc: 'Markdown editor with live preview' },
          { icon: Code, label: 'Edit Code', desc: 'Multi-file Monaco editor' },
          { icon: Sparkles, label: 'Test & Preview', desc: 'Run code and see live output' },
        ].map((hint) => {
          const HintIcon = hint.icon;
          return (
            <div
              key={hint.label}
              style={{
                padding: '16px 20px',
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(255,255,255,0.04)',
                borderRadius: 8,
                width: 160,
                textAlign: 'center',
              }}
            >
              <HintIcon size={16} color="rgba(255,255,255,0.12)" style={{ marginBottom: 10 }} />
              <div style={{
                fontSize: 10,
                fontWeight: 700,
                color: 'rgba(255,255,255,0.4)',
                marginBottom: 4,
              }}>
                {hint.label}
              </div>
              <div style={{
                fontSize: 9,
                color: 'rgba(255,255,255,0.15)',
                lineHeight: 1.4,
                fontFamily: 'Space Mono, monospace',
              }}>
                {hint.desc}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
