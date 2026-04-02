import { useState } from 'react';
import { Send, CheckCircle2, XCircle, MessageSquare, AlertTriangle, Loader2 } from 'lucide-react';
import { Annotation } from './DiffPanel';

export interface SubmissionPanelProps {
  assessmentId: string;
  annotations: Annotation[];
  onSubmitComplete: (result: { success: boolean; submittedAt: string }) => void;
  onError: (error: string) => void;
  readOnly?: boolean;
}

export interface SubmissionResponse {
  success: boolean;
  assessmentId: string;
  submittedAt: string;
  error?: { code: string; message: string };
}

interface SubmissionState {
  verdict: 'approve' | 'request_changes' | 'comment_only' | null;
  summary: string;
  isLoading: boolean;
  error: string | null;
  success: boolean;
}

export function SubmissionPanel({
  assessmentId,
  annotations,
  onSubmitComplete,
  onError,
  readOnly = false,
}: SubmissionPanelProps): JSX.Element {
  const [state, setState] = useState<SubmissionState>({
    verdict: null,
    summary: '',
    isLoading: false,
    error: null,
    success: false,
  });

  const handleSubmit = async (): Promise<void> => {
    if (!state.verdict || !state.summary.trim()) {
      setState(prev => ({ ...prev, error: 'Verdict and summary are required' }));
      return;
    }

    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      // In a real implementation, this would call the submitCodeReview Lambda
      // For now, simulate the API call
      await new Promise(resolve => setTimeout(resolve, 800));

      const response: SubmissionResponse = {
        success: true,
        assessmentId,
        submittedAt: new Date().toISOString(),
      };

      setState(prev => ({ ...prev, isLoading: false, success: true }));
      onSubmitComplete({ success: true, submittedAt: response.submittedAt });

      // Reset after 2 seconds
      setTimeout(() => {
        setState({
          verdict: null,
          summary: '',
          isLoading: false,
          error: null,
          success: false,
        });
      }, 2000);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to submit review';
      setState(prev => ({ ...prev, isLoading: false, error: errorMsg }));
      onError(errorMsg);
    }
  };

  const verdictOptions = [
    {
      key: 'approve' as const,
      label: 'APPROVE',
      icon: CheckCircle2,
      color: '#34d399',
      bg: 'rgba(52,211,153,0.08)',
      border: 'rgba(52,211,153,0.2)',
      description: 'Code is ready to merge',
    },
    {
      key: 'request_changes' as const,
      label: 'REQUEST_CHANGES',
      icon: XCircle,
      color: '#f87171',
      bg: 'rgba(248,113,113,0.08)',
      border: 'rgba(248,113,113,0.2)',
      description: 'Changes needed before merge',
    },
    {
      key: 'comment_only' as const,
      label: 'COMMENT',
      icon: MessageSquare,
      color: '#fbbf24',
      bg: 'rgba(251,191,36,0.08)',
      border: 'rgba(251,191,36,0.2)',
      description: 'Informational review only',
    },
  ];

  const isReady = state.verdict && state.summary.trim().length > 0;
  const characterCount = state.summary.length;
  const maxCharacters = 1000;

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      background: 'rgba(12, 12, 14, 0.5)',
      borderLeft: '1px solid rgba(255,255,255,0.06)',
    }}>
      {/* Success state */}
      {state.success && (
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
        }}>
          <div style={{
            width: 64,
            height: 64,
            borderRadius: '50%',
            background: 'rgba(16, 185, 129, 0.1)',
            border: '2px solid rgba(16, 185, 129, 0.2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 16,
          }}>
            <CheckCircle2 size={32} color="#10b981" />
          </div>
          <h3 style={{
            fontSize: 14,
            fontWeight: 700,
            color: '#10b981',
            margin: 0,
            marginBottom: 8,
            textAlign: 'center',
            letterSpacing: '0.05em',
          }}>
            REVIEW_SUBMITTED
          </h3>
          <p style={{
            fontSize: 11,
            color: 'var(--pipe-text-muted)',
            textAlign: 'center',
            margin: 0,
            lineHeight: 1.5,
          }}>
            Your code review has been recorded and will be scored.
          </p>
        </div>
      )}

      {/* Error state */}
      {state.error && !state.isLoading && (
        <div style={{
          margin: 20,
          padding: 16,
          background: 'rgba(248, 113, 113, 0.08)',
          border: '1px solid rgba(248, 113, 113, 0.2)',
          borderRadius: 4,
          display: 'flex',
          gap: 12,
          alignItems: 'flex-start',
        }} data-testid="error-card">
          <AlertTriangle size={16} color="#f87171" style={{ flexShrink: 0, marginTop: 2 }} />
          <div style={{ flex: 1 }}>
            <h4 style={{
              fontSize: 10,
              fontWeight: 700,
              color: '#f87171',
              margin: 0,
              marginBottom: 4,
              letterSpacing: '0.1em',
            }}>
              SUBMISSION_FAILED
            </h4>
            <p style={{
              fontSize: 11,
              color: 'rgba(248, 113, 113, 0.8)',
              margin: 0,
              lineHeight: 1.5,
            }}>
              {state.error}
            </p>
            <button
              onClick={() => setState(prev => ({ ...prev, error: null }))}
              style={{
                marginTop: 8,
                padding: '6px 12px',
                background: 'rgba(248, 113, 113, 0.15)',
                border: '1px solid rgba(248, 113, 113, 0.3)',
                color: '#f87171',
                fontSize: 9,
                fontWeight: 700,
                cursor: 'pointer',
                fontFamily: '"Space Mono", monospace',
                borderRadius: 2,
              }}
              data-testid="dismiss-error-btn"
            >
              DISMISS
            </button>
          </div>
        </div>
      )}

      {/* Form (hidden if success) */}
      {!state.success && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
          {/* Verdict */}
          <div style={{ padding: 24, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ fontSize: 9, letterSpacing: '0.2em', color: 'var(--pipe-text-dim)', marginBottom: 16 }}>
              REVIEW_VERDICT
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {verdictOptions.map(opt => {
                const isActive = state.verdict === opt.key;
                const Icon = opt.icon;
                return (
                  <button
                    key={opt.key}
                    onClick={() => setState(prev => ({ ...prev, verdict: opt.key }))}
                    disabled={readOnly || state.isLoading}
                    style={{
                      padding: '14px 16px',
                      background: isActive ? opt.bg : 'rgba(255,255,255,0.02)',
                      border: `1px solid ${isActive ? opt.border : 'rgba(255,255,255,0.06)'}`,
                      borderRadius: 4,
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 10,
                      cursor: readOnly || state.isLoading ? 'not-allowed' : 'pointer',
                      transition: 'all 0.2s',
                      opacity: readOnly || state.isLoading ? 0.5 : 1,
                    }}
                    data-testid={`verdict-${opt.key}`}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Icon size={14} color={isActive ? opt.color : 'rgba(255,255,255,0.2)'} />
                        <span style={{
                          fontSize: 10,
                          fontWeight: 700,
                          letterSpacing: '0.05em',
                          color: isActive ? opt.color : 'rgba(255,255,255,0.35)',
                        }}>
                          {opt.label}
                        </span>
                      </div>
                      <span style={{
                        fontSize: 9,
                        color: isActive ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.25)',
                        marginLeft: 22,
                        marginTop: 4,
                      }}>
                        {opt.description}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Summary */}
          <div style={{ padding: 24, borderBottom: '1px solid rgba(255,255,255,0.06)', flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 9, letterSpacing: '0.2em', color: 'var(--pipe-text-dim)', marginBottom: 12 }}>
              REVIEW_SUMMARY
            </div>

            <textarea
              value={state.summary}
              onChange={e => setState(prev => ({
                ...prev,
                summary: e.target.value.slice(0, maxCharacters),
              }))}
              placeholder="Summarize your code review findings..."
              disabled={readOnly || state.isLoading}
              style={{
                flex: 1,
                minHeight: 120,
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 4,
                color: 'var(--pipe-text, #fff)',
                fontSize: 11,
                padding: 12,
                fontFamily: '"Space Mono", monospace',
                outline: 'none',
                resize: 'vertical',
                lineHeight: 1.6,
                opacity: readOnly || state.isLoading ? 0.5 : 1,
              }}
              data-testid="summary-textarea"
            />

            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: 8,
              fontSize: 9,
              color: 'var(--pipe-text-dim)',
            }}>
              <span>MAX {maxCharacters} CHARACTERS</span>
              <span data-testid="char-count">{characterCount} / {maxCharacters}</span>
            </div>
          </div>

          {/* Stats */}
          <div style={{ padding: 24, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ fontSize: 9, letterSpacing: '0.2em', color: 'var(--pipe-text-dim)', marginBottom: 12 }}>
              SUBMISSION_STATS
            </div>

            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              padding: 12,
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: 4,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>Annotations</span>
                <span style={{
                  fontSize: 10,
                  color: annotations.length > 0 ? '#a78bfa' : 'rgba(255,255,255,0.3)',
                  fontWeight: 700,
                }}>
                  {annotations.length}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>Verdict</span>
                <span style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: state.verdict ? '#34d399' : 'rgba(255,255,255,0.15)',
                }}>
                  {state.verdict ? state.verdict.replace('_', ' ').toUpperCase() : '—'}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>Summary</span>
                <span style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: state.summary.trim() ? '#34d399' : 'rgba(255,255,255,0.15)',
                }}>
                  {state.summary.trim() ? 'PROVIDED' : '—'}
                </span>
              </div>
            </div>
          </div>

          {/* Ready status */}
          <div style={{
            padding: '12px 24px',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            color: isReady ? '#34d399' : 'rgba(255,255,255,0.2)',
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.1em',
          }} data-testid="ready-status">
            {isReady ? (
              <CheckCircle2 size={14} />
            ) : (
              <AlertTriangle size={14} />
            )}
            {isReady ? 'READY_TO_SUBMIT' : 'COMPLETE_FORM_TO_CONTINUE'}
          </div>
        </div>
      )}

      {/* Submit button (footer) */}
      {!state.success && (
        <div style={{
          padding: '16px 24px',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          display: 'flex',
          gap: 12,
        }}>
          <button
            onClick={handleSubmit}
            disabled={!isReady || state.isLoading || readOnly}
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              padding: '12px 20px',
              background: isReady && !state.isLoading ? '#fff' : 'rgba(255,255,255,0.05)',
              color: isReady && !state.isLoading ? '#000' : 'rgba(255,255,255,0.2)',
              border: 'none',
              borderRadius: 4,
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: '0.1em',
              fontFamily: '"Space Mono", monospace',
              cursor: isReady && !state.isLoading ? 'pointer' : 'not-allowed',
              transition: 'all 0.2s',
              opacity: readOnly ? 0.5 : 1,
            }}
            data-testid="submit-button"
          >
            {state.isLoading ? (
              <>
                <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                SUBMITTING...
              </>
            ) : (
              <>
                SUBMIT_REVIEW
                <Send size={14} />
              </>
            )}
          </button>
        </div>
      )}

      {/* Add spinner animation */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
