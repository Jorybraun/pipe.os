/**
 * GapFillModal — Displays a clarifying question from the calibration agent
 * and captures the recruiter's answer.
 */

import { useEffect, useState } from 'react';
import { X, Loader2 } from 'lucide-react';

interface GapFillModalProps {
  question: string;
  onSubmit: (answer: string) => Promise<void>;
  onClose: () => void;
}

export function GapFillModal({ question, onSubmit, onClose }: GapFillModalProps): JSX.Element {
  const [answer, setAnswer] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (): Promise<void> => {
    if (!answer.trim() || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await onSubmit(answer.trim());
      setAnswer('');
    } finally {
      setIsSubmitting(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      data-testid="gap-fill-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="gap-fill-modal-title"
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
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 560,
          background: 'var(--pipe-surface-solid)',
          border: '1px solid var(--pipe-border)',
          borderRadius: 12,
          padding: 32,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
          <div>
            <div id="gap-fill-modal-title" style={{ fontSize: 11, letterSpacing: '0.2em', color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace', marginBottom: 6 }}>
              CLARIFY ATTRIBUTE
            </div>
            <div style={{ fontSize: 13, color: 'var(--pipe-text-muted)', fontFamily: '"Space Mono", monospace' }}>
              Help us sharpen this claim.
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: 'var(--pipe-text-dim)', cursor: 'pointer', padding: 0 }}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div
          data-testid="gap-fill-question"
          style={{
            padding: 16,
            background: 'var(--pipe-surface)',
            border: '1px solid var(--pipe-border)',
            borderRadius: 6,
            marginBottom: 20,
            fontSize: 13,
            color: 'var(--pipe-text)',
            lineHeight: 1.6,
            fontFamily: '"Space Mono", monospace',
          }}
        >
          {question}
        </div>

        <textarea
          data-testid="gap-fill-answer"
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          placeholder="Your answer…"
          rows={4}
          style={{
            width: '100%',
            padding: 12,
            background: 'var(--pipe-surface)',
            border: '1px solid var(--pipe-border-light)',
            borderRadius: 6,
            color: 'var(--pipe-text)',
            fontSize: 13,
            fontFamily: '"Space Mono", monospace',
            lineHeight: 1.6,
            resize: 'vertical',
            marginBottom: 20,
          }}
        />

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
            data-testid="gap-fill-submit"
            onClick={() => { void handleSubmit(); }}
            disabled={!answer.trim() || isSubmitting}
            style={{
              padding: '10px 20px',
              background: answer.trim() && !isSubmitting ? 'rgba(74, 222, 128, 0.08)' : 'transparent',
              border: `1px solid ${answer.trim() && !isSubmitting ? 'rgba(74, 222, 128, 0.3)' : 'var(--pipe-border-light)'}`,
              color: answer.trim() && !isSubmitting ? 'rgba(74, 222, 128, 0.9)' : 'var(--pipe-text-dim)',
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.1em',
              fontFamily: '"Space Mono", monospace',
              cursor: answer.trim() && !isSubmitting ? 'pointer' : 'default',
              borderRadius: 4,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            {isSubmitting ? (
              <><Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> SUBMITTING…</>
            ) : (
              'SUBMIT'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
