import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { LiquidMetalCard } from '../components/ui/LiquidMetalCard';
import { SmartInterviewInput } from '../components/AIChat';
import { CoverageProgress, type CoveragePhase } from '../components/Assessment/CoverageProgress';
import { Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';

// ─── Local Types ──────────────────────────────────────────────────────────────

interface CultureSessionState {
  state: 'consent' | 'in_progress' | 'scoring' | 'complete' | 'error';
  currentQuestion?: { id: string; text: string };
  turnsAsked: number;
  totalBudget: number;
  consentRequired: boolean;
  coverage?: Record<string, number>;
  phase?: CoveragePhase;
}

interface RespondResponse {
  state: 'in_progress' | 'scoring' | 'complete';
  nextQuestion?: { id: string; text: string };
  turnsAsked: number;
  totalBudget: number;
  message?: string;
  coverage?: Record<string, number>;
  phase?: CoveragePhase;
}

// ─── API helpers ──────────────────────────────────────────────────────────────

const API_BASE =
  typeof import.meta !== 'undefined' &&
  typeof import.meta.env !== 'undefined' &&
  import.meta.env.VITE_API_URL
    ? (import.meta.env.VITE_API_URL as string)
    : '';

async function fetchSessionState(token: string): Promise<CultureSessionState> {
  const res = await fetch(`${API_BASE}/rpc/culture/session/${token}/state`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(body.error?.message ?? `Failed to load session (${res.status})`);
  }
  return (await res.json()) as CultureSessionState;
}

async function postConsent(token: string): Promise<CultureSessionState> {
  const res = await fetch(`${API_BASE}/rpc/culture/session/${token}/consent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(body.error?.message ?? `Failed to record consent (${res.status})`);
  }
  return (await res.json()) as CultureSessionState;
}

async function postAnswer(token: string, answer: string): Promise<RespondResponse> {
  const res = await fetch(`${API_BASE}/rpc/culture/session/${token}/respond`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answer }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(body.error?.message ?? `Failed to submit answer (${res.status})`);
  }
  return (await res.json()) as RespondResponse;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

/** Consent screen shown before the first question. Compliance-critical per ADR-031. */
function ConsentScreen({
  onConsent,
  loading,
}: {
  onConsent: () => void;
  loading: boolean;
}): JSX.Element {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#0c0c0e',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '40px 24px',
        fontFamily: '"Space Mono", monospace',
      }}
    >
      <div style={{ maxWidth: 640, width: '100%' }}>
        {/* Header */}
        <div style={{ marginBottom: 40 }}>
          <div
            style={{
              fontSize: 9,
              letterSpacing: '0.25em',
              color: 'rgba(255,255,255,0.35)',
              marginBottom: 16,
              textTransform: 'uppercase',
            }}
          >
            Culture Interview
          </div>
          <h1
            style={{
              fontSize: 28,
              fontWeight: 700,
              color: '#fff',
              letterSpacing: '0.03em',
              margin: 0,
              lineHeight: 1.3,
            }}
          >
            Before we begin
          </h1>
        </div>

        <LiquidMetalCard variant="dark" style={{ padding: 32, marginBottom: 24 }}>
          {/* AI disclosure — prominent, compliance-critical */}
          <div
            style={{
              display: 'flex',
              gap: 12,
              alignItems: 'flex-start',
              marginBottom: 28,
              padding: '16px 20px',
              background: 'rgba(96,165,250,0.08)',
              border: '1px solid rgba(96,165,250,0.2)',
            }}
          >
            <AlertCircle
              size={18}
              style={{ color: '#60a5fa', flexShrink: 0, marginTop: 2 }}
            />
            <div>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: '0.15em',
                  color: '#60a5fa',
                  marginBottom: 6,
                }}
              >
                AI-CONDUCTED INTERVIEW
              </div>
              <p
                style={{
                  fontSize: 13,
                  color: 'rgba(255,255,255,0.75)',
                  margin: 0,
                  lineHeight: 1.6,
                }}
              >
                This interview is conducted by an AI agent. You are not speaking
                with a human recruiter. Powered by{' '}
                <strong style={{ color: 'rgba(255,255,255,0.9)' }}>
                  Cloudflare Workers AI + Gemma
                </strong>
                .
              </p>
            </div>
          </div>

          {/* What will be recorded */}
          <div style={{ marginBottom: 24 }}>
            <h2
              style={{
                fontSize: 11,
                letterSpacing: '0.15em',
                color: 'rgba(255,255,255,0.5)',
                textTransform: 'uppercase',
                margin: '0 0 12px',
              }}
            >
              What we record
            </h2>
            <ul
              style={{
                margin: 0,
                padding: '0 0 0 20px',
                color: 'rgba(255,255,255,0.65)',
                fontSize: 13,
                lineHeight: 1.8,
              }}
            >
              <li>Your written responses to interview questions</li>
              <li>Timestamps for each response</li>
              <li>Optional: voice audio, if you choose to enable it</li>
            </ul>
          </div>

          {/* Duration estimate */}
          <div style={{ marginBottom: 24 }}>
            <h2
              style={{
                fontSize: 11,
                letterSpacing: '0.15em',
                color: 'rgba(255,255,255,0.5)',
                textTransform: 'uppercase',
                margin: '0 0 12px',
              }}
            >
              Estimated duration
            </h2>
            <p
              style={{
                margin: 0,
                color: 'rgba(255,255,255,0.65)',
                fontSize: 13,
                lineHeight: 1.6,
              }}
            >
              5–20 questions &mdash; typically 25–45 minutes. The interview is
              adaptive: the number of questions depends on your answers.
            </p>
          </div>

          {/* Links */}
          <div
            style={{
              display: 'flex',
              gap: 20,
              flexWrap: 'wrap',
              paddingTop: 20,
              borderTop: '1px solid rgba(255,255,255,0.07)',
            }}
          >
            <a
              href="/privacy/delete"
              style={{
                fontSize: 11,
                color: 'rgba(255,255,255,0.4)',
                textDecoration: 'underline',
                letterSpacing: '0.05em',
              }}
            >
              Request data deletion
            </a>
            <a
              href="/support/human-interview"
              style={{
                fontSize: 11,
                color: 'rgba(255,255,255,0.4)',
                textDecoration: 'underline',
                letterSpacing: '0.05em',
              }}
            >
              Request a human interviewer instead
            </a>
          </div>
        </LiquidMetalCard>

        {/* Consent button */}
        <button
          type="button"
          onClick={onConsent}
          disabled={loading}
          aria-busy={loading}
          style={{
            width: '100%',
            padding: '18px 32px',
            background: loading
              ? 'rgba(255,255,255,0.05)'
              : 'linear-gradient(135deg, rgba(255,255,255,0.15), rgba(200,200,220,0.1))',
            border: '1px solid rgba(255,255,255,0.15)',
            color: loading ? 'rgba(255,255,255,0.35)' : '#fff',
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
            cursor: loading ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
            fontFamily: '"Space Mono", monospace',
            transition: 'background 0.2s, color 0.2s',
          }}
        >
          {loading && <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />}
          I consent — start the interview
        </button>

        <p
          style={{
            marginTop: 16,
            fontSize: 11,
            color: 'rgba(255,255,255,0.25)',
            textAlign: 'center',
            lineHeight: 1.6,
          }}
        >
          By clicking the button above you confirm you have read the disclosures
          above and consent to participating in an AI-conducted interview.
        </p>
      </div>
    </div>
  );
}

/** Active interview UI — one question at a time, no scrollback. */
function InterviewUI({
  question,
  turnsAsked,
  totalBudget,
  coverage,
  phase,
  onSubmit,
  submitting,
  submitError,
  onRetry,
}: {
  question: { id: string; text: string };
  turnsAsked: number;
  totalBudget: number;
  coverage?: Record<string, number>;
  phase?: CoveragePhase;
  onSubmit: (answer: string) => void;
  submitting: boolean;
  submitError: string | null;
  onRetry: () => void;
}): JSX.Element {
  const [answer, setAnswer] = useState('');

  // Reset answer when question changes
  useEffect(() => {
    setAnswer('');
  }, [question.id]);

  const handleSubmit = useCallback((): void => {
    const trimmed = answer.trim();
    if (!trimmed || submitting) return;
    setAnswer('');
    onSubmit(trimmed);
  }, [answer, submitting, onSubmit]);

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#0c0c0e',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: '"Space Mono", monospace',
      }}
    >
      {/* Header bar */}
      <div
        style={{
          padding: '20px 32px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div
          style={{
            fontSize: 9,
            letterSpacing: '0.25em',
            color: 'rgba(255,255,255,0.35)',
            textTransform: 'uppercase',
          }}
        >
          Culture Interview
        </div>
        <div
          style={{
            fontSize: 11,
            color: 'rgba(255,255,255,0.4)',
            letterSpacing: '0.08em',
          }}
          aria-live="polite"
          aria-label={`Question ${turnsAsked} of up to ${totalBudget}`}
        >
          Question {turnsAsked} of up to {totalBudget}
        </div>
      </div>

      {/* Coverage progress — floats in the top-right during interview */}
      {coverage && phase && (
        <div
          style={{
            position: 'fixed',
            top: 72,
            right: 24,
            zIndex: 50,
          }}
        >
          <CoverageProgress
            coverage={coverage}
            phase={phase}
            turnsAsked={turnsAsked}
            totalBudget={totalBudget}
          />
        </div>
      )}

      {/* Main content */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'center',
          padding: '60px 24px 40px',
        }}
      >
        <div style={{ maxWidth: 680, width: '100%' }}>
          {/* Question card */}
          <LiquidMetalCard
            variant="mercury"
            style={{ padding: '32px 36px', marginBottom: 32 }}
          >
            <div
              style={{
                fontSize: 9,
                letterSpacing: '0.2em',
                color: 'rgba(255,255,255,0.35)',
                textTransform: 'uppercase',
                marginBottom: 16,
              }}
            >
              Question
            </div>
            <p
              style={{
                margin: 0,
                fontSize: 18,
                fontWeight: 700,
                color: '#fff',
                lineHeight: 1.6,
                letterSpacing: '0.02em',
              }}
            >
              {question.text}
            </p>
          </LiquidMetalCard>

          {/* Answer section — powered by SmartInterviewInput */}
          <SmartInterviewInput
            value={answer}
            onChange={setAnswer}
            onSubmit={handleSubmit}
            questionText={question.text}
            inputId="culture-answer"
            submitLabel="Submit answer"
            enableVoice
            enableTTS
            isLoading={submitting}
            disabled={submitting}
            placeholder="Take your time and answer thoughtfully..."
          />

          {/* Error state */}
          {submitError && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                marginTop: 16,
                padding: '12px 16px',
                background: 'rgba(239,68,68,0.08)',
                border: '1px solid rgba(239,68,68,0.2)',
              }}
              role="alert"
            >
              <AlertCircle size={14} style={{ color: '#ef4444', flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', flex: 1 }}>
                {submitError}
              </span>
              <button
                type="button"
                onClick={onRetry}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#60a5fa',
                  fontSize: 11,
                  letterSpacing: '0.1em',
                  cursor: 'pointer',
                  fontFamily: '"Space Mono", monospace',
                  padding: '2px 0',
                }}
              >
                RETRY
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Terminal state shown after the interview is complete. */
function CompleteScreen({ token }: { token: string }): JSX.Element {
  const navigate = useNavigate();

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#0c0c0e',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '40px 24px',
        fontFamily: '"Space Mono", monospace',
      }}
    >
      <div style={{ maxWidth: 560, width: '100%', textAlign: 'center' }}>
        <CheckCircle2
          size={48}
          style={{ color: '#4ade80', marginBottom: 24 }}
        />
        <h1
          style={{
            fontSize: 24,
            fontWeight: 700,
            color: '#fff',
            letterSpacing: '0.03em',
            margin: '0 0 16px',
          }}
        >
          Thanks — we've recorded your interview.
        </h1>
        <p
          style={{
            fontSize: 14,
            color: 'rgba(255,255,255,0.5)',
            lineHeight: 1.7,
            margin: '0 0 40px',
          }}
        >
          Your responses are being reviewed by our hiring team. You'll hear back
          soon.
        </p>
        <button
          type="button"
          onClick={() => { navigate(`/assess/${token}`); }}
          style={{
            padding: '14px 28px',
            background:
              'linear-gradient(135deg, rgba(255,255,255,0.12), rgba(200,200,220,0.08))',
            border: '1px solid rgba(255,255,255,0.12)',
            color: 'rgba(255,255,255,0.7)',
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
            cursor: 'pointer',
            fontFamily: '"Space Mono", monospace',
          }}
        >
          Return to your assessment
        </button>
      </div>
    </div>
  );
}

/** Full-screen loading skeleton shown during initial hydration. */
function LoadingScreen(): JSX.Element {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#0c0c0e',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: '"Space Mono", monospace',
      }}
    >
      <Loader2
        size={32}
        style={{
          color: 'rgba(255,255,255,0.25)',
          animation: 'spin 1s linear infinite',
        }}
      />
    </div>
  );
}

/** Full-screen error state. */
function ErrorScreen({ message }: { message: string }): JSX.Element {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#0c0c0e',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '40px 24px',
        fontFamily: '"Space Mono", monospace',
      }}
    >
      <div style={{ maxWidth: 480, width: '100%', textAlign: 'center' }}>
        <AlertCircle
          size={40}
          style={{ color: '#ef4444', marginBottom: 20 }}
        />
        <h1
          style={{
            fontSize: 18,
            fontWeight: 700,
            color: '#fff',
            margin: '0 0 12px',
          }}
        >
          Something went wrong
        </h1>
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', margin: 0 }}>
          {message}
        </p>
      </div>
    </div>
  );
}

// ─── Page component ───────────────────────────────────────────────────────────

/**
 * CultureInterviewPage — candidate-facing culture interview experience.
 *
 * Route: /culture/:token
 *
 * States:
 *   consent     → Compliance disclosures + AI authorship notice (ADR-031)
 *   in_progress → Adaptive chat-style interview, one question at a time
 *   scoring     → Treated as "complete" from the candidate's perspective
 *   complete    → Terminal confirmation screen; no score exposed to candidate
 *   error       → Fatal load error
 */
export default function CultureInterviewPage(): JSX.Element {
  const { token } = useParams<{ token: string }>();

  // ─── Session state ───────────────────────────────────────────────────────
  const [session, setSession] = useState<CultureSessionState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingConsent, setLoadingConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Preserve the last submitted answer so retry can re-send it
  const pendingAnswerRef = useRef<string | null>(null);

  // ─── Hydrate on mount ────────────────────────────────────────────────────
  useEffect((): void => {
    if (!token) {
      setLoadError('Invalid interview link — token is missing.');
      return;
    }

    fetchSessionState(token)
      .then((s) => { setSession(s); })
      .catch((err: unknown) => {
        setLoadError(
          err instanceof Error ? err.message : 'Failed to load interview session.',
        );
      });
  }, [token]);

  // ─── Consent handler ─────────────────────────────────────────────────────
  const handleConsent = useCallback((): void => {
    if (!token) return;
    setLoadingConsent(true);
    postConsent(token)
      .then((s) => {
        setSession(s);
      })
      .catch((err: unknown) => {
        setLoadError(
          err instanceof Error ? err.message : 'Failed to record consent.',
        );
      })
      .finally(() => { setLoadingConsent(false); });
  }, [token]);

  // ─── Submit answer handler ────────────────────────────────────────────────
  const handleSubmitAnswer = useCallback((answer: string): void => {
    if (!token) return;
    pendingAnswerRef.current = answer;
    setSubmitError(null);
    setSubmitting(true);

    postAnswer(token, answer)
      .then((res) => {
        pendingAnswerRef.current = null;
        if (res.state === 'in_progress' && res.nextQuestion) {
          const nextQuestion = res.nextQuestion;
          setSession((prev) =>
            prev
              ? {
                  ...prev,
                  state: 'in_progress',
                  currentQuestion: nextQuestion,
                  turnsAsked: res.turnsAsked,
                  totalBudget: res.totalBudget,
                  ...(res.coverage !== undefined ? { coverage: res.coverage } : {}),
                  ...(res.phase !== undefined ? { phase: res.phase } : {}),
                }
              : prev,
          );
        } else {
          // complete or scoring — show terminal screen
          setSession((prev) =>
            prev
              ? {
                  ...prev,
                  state: res.state,
                  ...(res.coverage !== undefined ? { coverage: res.coverage } : {}),
                  ...(res.phase !== undefined ? { phase: res.phase } : {}),
                }
              : prev,
          );
        }
      })
      .catch((err: unknown) => {
        setSubmitError(
          err instanceof Error ? err.message : 'Failed to submit answer. Please try again.',
        );
      })
      .finally(() => { setSubmitting(false); });
  }, [token]);

  // ─── Retry submits the same answer ───────────────────────────────────────
  const handleRetry = useCallback((): void => {
    if (pendingAnswerRef.current) {
      handleSubmitAnswer(pendingAnswerRef.current);
    }
  }, [handleSubmitAnswer]);

  // ─── Render ──────────────────────────────────────────────────────────────

  if (loadError) {
    return <ErrorScreen message={loadError} />;
  }

  if (!session) {
    return <LoadingScreen />;
  }

  const { state } = session;

  // Complete and scoring both show the terminal confirmation — candidates
  // never see scores until a recruiter has reviewed (HITL gate, ADR-031).
  if (state === 'complete' || state === 'scoring') {
    return <CompleteScreen token={token ?? ''} />;
  }

  if (state === 'consent' || (state === 'in_progress' && session.consentRequired)) {
    return (
      <ConsentScreen onConsent={handleConsent} loading={loadingConsent} />
    );
  }

  if (state === 'in_progress' && session.currentQuestion) {
    return (
      <InterviewUI
        question={session.currentQuestion}
        turnsAsked={session.turnsAsked}
        totalBudget={session.totalBudget}
        {...(session.coverage !== undefined ? { coverage: session.coverage } : {})}
        {...(session.phase !== undefined ? { phase: session.phase } : {})}
        onSubmit={handleSubmitAnswer}
        submitting={submitting}
        submitError={submitError}
        onRetry={handleRetry}
      />
    );
  }

  // Fallback — should not happen in normal flow
  if (state === 'error') {
    return <ErrorScreen message="This interview session has encountered an error. Please contact support." />;
  }

  // in_progress with no currentQuestion — loading next question
  return <LoadingScreen />;
}
