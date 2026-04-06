/**
 * InterviewDepthModal — Configure how many questions the Discovery Agent
 * will ask during the role interview.
 *
 * Owns its own draft state. Parent only receives the final budget value via
 * `onSave`, then the modal closes itself.
 *
 * Mirrors the JobDescriptionImportModal pattern.
 */

import { useState } from 'react';
import { X, Check } from 'lucide-react';

interface BudgetOption {
  value: number;
  label: string;
  hint: string;
}

const BUDGET_OPTIONS: BudgetOption[] = [
  { value: 5,  label: '5 — Quick',     hint: 'Surface-level signal. Best when you already know the role.' },
  { value: 10, label: '10 — Standard', hint: 'Default. Covers the Six Domains at a workable depth.' },
  { value: 15, label: '15 — Thorough', hint: 'Useful for cross-functional or hard-to-define roles.' },
  { value: 20, label: '20 — Deep Dive', hint: 'Maximum context. Best for senior or strategic hires.' },
];

interface InterviewDepthModalProps {
  initialBudget: number;
  onSave: (budget: number) => void;
  onClose: () => void;
}

export function InterviewDepthModal({
  initialBudget,
  onSave,
  onClose,
}: InterviewDepthModalProps): JSX.Element {
  const [draft, setDraft] = useState<number>(initialBudget);

  const handleSave = (): void => {
    onSave(draft);
    onClose();
  };

  return (
    /* Backdrop */
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.7)',
        backdropFilter: 'blur(4px)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      {/* Panel */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 520,
          background: '#13131a',
          border: '1px solid var(--pipe-border)',
          borderRadius: 12,
          padding: 32,
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            marginBottom: 20,
          }}
        >
          <div>
            <div
              style={{
                fontSize: 11,
                letterSpacing: '0.2em',
                color: 'var(--pipe-text-dim)',
                fontFamily: '"Space Mono", monospace',
                marginBottom: 6,
              }}
            >
              INTERVIEW_DEPTH
            </div>
            <div
              style={{
                fontSize: 13,
                color: 'var(--pipe-text-muted, rgba(255,255,255,0.55))',
                fontFamily: '"Space Mono", monospace',
              }}
            >
              How many questions should the agent ask?
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--pipe-text-dim)',
              cursor: 'pointer',
              padding: 0,
            }}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Options */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 28 }}>
          {BUDGET_OPTIONS.map((opt) => {
            const selected = draft === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => setDraft(opt.value)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  padding: '14px 16px',
                  background: selected
                    ? 'rgba(74, 222, 128, 0.06)'
                    : 'transparent',
                  border: selected
                    ? '1px solid rgba(74, 222, 128, 0.3)'
                    : '1px solid rgba(255,255,255,0.06)',
                  borderRadius: 6,
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'all 0.15s ease',
                }}
              >
                <div
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: '50%',
                    border: selected
                      ? '1px solid rgba(74, 222, 128, 0.7)'
                      : '1px solid rgba(255,255,255,0.15)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  {selected && (
                    <Check size={10} style={{ color: 'rgba(74, 222, 128, 0.9)' }} />
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: '0.05em',
                      color: selected ? 'var(--pipe-text, #fff)' : 'rgba(255,255,255,0.6)',
                      fontFamily: '"Space Mono", monospace',
                      marginBottom: 4,
                    }}
                  >
                    {opt.label}
                  </div>
                  <div
                    style={{
                      fontSize: 10,
                      color: 'var(--pipe-text-dim)',
                      fontFamily: '"Space Mono", monospace',
                      lineHeight: 1.5,
                    }}
                  >
                    {opt.hint}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{
              padding: '10px 20px',
              background: 'transparent',
              border: '1px solid var(--pipe-border)',
              color: 'var(--pipe-text-muted)',
              fontSize: 10,
              letterSpacing: '0.1em',
              fontFamily: '"Space Mono", monospace',
              cursor: 'pointer',
              borderRadius: 4,
            }}
          >
            CANCEL
          </button>
          <button
            onClick={handleSave}
            style={{
              padding: '10px 20px',
              background: 'rgba(74, 222, 128, 0.08)',
              border: '1px solid rgba(74, 222, 128, 0.3)',
              color: 'rgba(74, 222, 128, 0.9)',
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.1em',
              fontFamily: '"Space Mono", monospace',
              cursor: 'pointer',
              borderRadius: 4,
            }}
          >
            SAVE
          </button>
        </div>
      </div>
    </div>
  );
}
