import { useState } from 'react';
import { CheckCircle2, XCircle, MessageSquare } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Annotation {
  id: string;
  file: string;
  line: number;
  severity: 'critical' | 'major' | 'minor';
  comment: string;
  createdAt: string;
}

export interface VerdictPanelProps {
  annotations: Annotation[];
  verdict: string | null;
  summary: string;
  onVerdictChange: (verdict: string) => void;
  onSummaryChange: (summary: string) => void;
}

// ---------------------------------------------------------------------------
// Verdict options
// ---------------------------------------------------------------------------

const VERDICT_OPTIONS = [
  {
    key: 'approve' as const,
    label: 'Approve',
    icon: CheckCircle2,
    color: '#34d399',
    bg: 'rgba(52,211,153,0.08)',
    border: 'rgba(52,211,153,0.2)',
    description: 'Code is ready to merge',
  },
  {
    key: 'request_changes' as const,
    label: 'Request changes',
    icon: XCircle,
    color: '#f87171',
    bg: 'rgba(248,113,113,0.08)',
    border: 'rgba(248,113,113,0.2)',
    description: 'Changes needed before merge',
  },
  {
    key: 'comment_only' as const,
    label: 'Comment only',
    icon: MessageSquare,
    color: '#fbbf24',
    bg: 'rgba(251,191,36,0.08)',
    border: 'rgba(251,191,36,0.2)',
    description: 'Informational review only',
  },
];

function formatVerdictLabel(value: string | null): string {
  if (!value) {
    return '-';
  }
  return value
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function VerdictPanel({
  annotations,
  verdict,
  summary,
  onVerdictChange,
  onSummaryChange,
}: VerdictPanelProps): JSX.Element {
  const [localSummary, setLocalSummary] = useState(summary);

  const handleSummary = (s: string): void => {
    const trimmed = s.slice(0, 1000);
    setLocalSummary(trimmed);
    onSummaryChange(trimmed);
  };

  const isReady = !!verdict && localSummary.trim().length > 0;

  return (
    <div
      data-testid="verdict-panel"
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'rgba(12, 12, 14, 0.5)',
        fontFamily: '"Space Mono", monospace',
      }}
    >
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {/* Verdict */}
        <div style={{ padding: 24, borderBottom: '1px solid var(--pipe-border)' }}>
          <div style={{ fontSize: 9, letterSpacing: '0.2em', color: 'var(--pipe-text-dim)', marginBottom: 16 }}>
            Your verdict
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {VERDICT_OPTIONS.map((opt) => {
              const isActive = verdict === opt.key;
              const Icon = opt.icon;
              return (
                <button
                  key={opt.key}
                  onClick={() => onVerdictChange(opt.key)}
                  style={{
                    padding: '14px 16px',
                    background: isActive ? opt.bg : 'var(--pipe-surface)',
                    border: `1px solid ${isActive ? opt.border : 'rgba(255,255,255,0.06)'}`,
                    borderRadius: 4,
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    textAlign: 'left',
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Icon size={14} color={isActive ? opt.color : 'rgba(255,255,255,0.2)'} />
                      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', color: isActive ? opt.color : 'rgba(255,255,255,0.35)' }}>
                        {opt.label}
                      </span>
                    </div>
                    <span style={{ fontSize: 9, color: isActive ? 'rgba(255,255,255,0.5)' : 'var(--pipe-text-dim)', marginLeft: 22, marginTop: 4 }}>
                      {opt.description}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Summary */}
        <div style={{ padding: 24, borderBottom: '1px solid var(--pipe-border)', display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 9, letterSpacing: '0.2em', color: 'var(--pipe-text-dim)', marginBottom: 12 }}>
            Review summary
          </div>
          <textarea
            value={localSummary}
            onChange={(e) => handleSummary(e.target.value)}
            placeholder="Summarize your code review findings..."
            style={{
              minHeight: 120,
              background: 'var(--pipe-surface)',
              border: '1px solid var(--pipe-border)',
              borderRadius: 4,
              color: 'var(--pipe-text, #fff)',
              fontSize: 11,
              padding: 12,
              fontFamily: '"Space Mono", monospace',
              outline: 'none',
              resize: 'vertical',
              lineHeight: 1.6,
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 9, color: 'rgba(255,255,255,0.3)' }}>
            <span>MAX 1000 CHARACTERS</span>
            <span>{localSummary.length} / 1000</span>
          </div>
        </div>

        {/* Stats */}
        <div style={{ padding: 24 }}>
          <div style={{ fontSize: 9, letterSpacing: '0.2em', color: 'var(--pipe-text-dim)', marginBottom: 12 }}>
            Submission checklist
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, background: 'var(--pipe-surface)', border: '1px solid var(--pipe-border)', borderRadius: 4 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 10, color: 'var(--pipe-text-dim)' }}>Annotations</span>
              <span style={{ fontSize: 10, color: annotations.length > 0 ? 'var(--pipe-accent)' : 'rgba(255,255,255,0.3)', fontWeight: 700 }}>
                {annotations.length}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 10, color: 'var(--pipe-text-dim)' }}>Verdict</span>
              <span style={{ fontSize: 10, fontWeight: 700, color: verdict ? '#34d399' : 'rgba(255,255,255,0.15)' }}>
                {formatVerdictLabel(verdict)}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 10, color: 'var(--pipe-text-dim)' }}>Summary</span>
              <span style={{ fontSize: 10, fontWeight: 700, color: localSummary.trim() ? '#34d399' : 'rgba(255,255,255,0.15)' }}>
                {localSummary.trim() ? 'Ready' : '-'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Status bar */}
      <div style={{ padding: '16px 24px', borderTop: '1px solid var(--pipe-border)' }}>
        {isReady ? (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            padding: '10px 16px', background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.25)',
            borderRadius: 4, fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', color: '#34d399',
          }}>
            <CheckCircle2 size={13} />
            Review ready. Submit when you're done.
          </div>
        ) : (
          <div style={{ padding: '10px 16px', fontSize: 9, color: 'var(--pipe-text-dim)', textAlign: 'center', letterSpacing: '0.08em' }}>
            Choose a verdict and add a summary to enable submit
          </div>
        )}
      </div>
    </div>
  );
}
