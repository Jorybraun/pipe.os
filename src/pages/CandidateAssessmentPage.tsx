import { useState, useEffect, useMemo } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useAssessment, type StageConfigDTO, type ChallengeContentDTO } from '../hooks/useAssessment';
import { SessionTokenProvider } from '../contexts/SessionTokenContext';
import { CandidateIdProvider } from '../contexts/CandidateIdContext';
import { StageShell } from '../components/Assessment/StageShell';
import { TimerProvider } from '../components/Assessment/TimerContext';
import { LiquidMetalCard } from '../components/ui/LiquidMetalCard';
import { ChromeMeshGrid } from '../components/ChromeMeshGrid';
import { CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { InterviewProvider } from '../contexts/InterviewContext';
import { StageRenderer } from '../components/Assessment/StageRenderer';
import { FollowUpQuestionsPanel } from '../components/Assessment/FollowUpQuestionsPanel';
import { resolveStageConfig } from '../lib/challenge/resolveStageConfig';
import type { RawStage } from '../lib/challenge/resolveStageConfig';

/**
 * Build a RawStage from the stage config DTO + current challenge content.
 * The composable system needs a StageConfig with challenges array.
 * We build it with a single challenge (the current one, hydrated with content).
 */
function buildRawStage(
  stageConfig: StageConfigDTO,
  content: ChallengeContentDTO,
  currentOrder: number,
): RawStage {
  return {
    id: 'current-stage',
    title: stageConfig.stageTitle ?? 'Stage',
    order: 0,
    timeLimit: stageConfig.timeLimit ?? null,
    challenges: [{
      id: content.id ?? `challenge-${currentOrder}`,
      type: content.type ?? stageConfig.challenges?.[currentOrder]?.type ?? 'QUIZ_MCQ',
      title: content.title ?? 'Challenge',
      instructions: content.instructions ?? null,
      config: typeof content.config === 'string'
        ? content.config
        : JSON.stringify(content.config ?? {}),
      order: 0,
      codeArtifact: content.codeArtifact as any ?? null,
      cachedDiffJson: content.cachedDiffJson ?? null,
      githubPrTitle: (content.githubPrTitle as string) ?? null,
      githubRepoUrl: (content.githubRepoUrl as string) ?? null,
      githubPrNumber: (content.githubPrNumber as number) ?? null,
      githubPrDescription: (content.githubPrDescription as string) ?? null,
    }],
  };
}

// ============================================================================
// Component
// ============================================================================

export default function CandidateAssessmentPage(): JSX.Element {
  const { token } = useParams<{ token: string }>();
  const [searchParams] = useSearchParams();
  const isPreview = searchParams.get('mode') === 'preview';
  const {
    candidate,
    stageConfig,
    challengeContent,
    currentOrder,
    isLoading,
    error,
    isSubmitted,
    hasStarted,
    followUpQuestions,
    followUpLoading,
    submitChallenge,
    onStart,
    reset,
    sessionToken,
  } = useAssessment(token || '');

  const [currentSubmission, setCurrentSubmission] = useState<unknown>(null);

  // Auto-skip empty follow-ups
  useEffect(() => {
    if (followUpQuestions !== null && followUpQuestions.length === 0 && !isLoading) {
      void submitChallenge({ answers: {} });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followUpQuestions]);

  // Build StageConfig from DTOs (must be before early returns — Rules of Hooks)
  const resolvedConfig = useMemo(() => {
    if (!stageConfig || !challengeContent) return null;
    const rawStage = buildRawStage(stageConfig, challengeContent, currentOrder);
    return resolveStageConfig(rawStage as any);
  }, [stageConfig, challengeContent, currentOrder]);

  // Current challenge type (from stage config, not content — available before hydration)
  const currentType = stageConfig?.challenges?.[currentOrder]?.type;

  // Auto-start: WELCOME is now a challenge in the queue, not a separate screen
  useEffect(() => {
    if (!hasStarted && candidate && !isLoading) {
      void onStart();
    }
  }, [hasStarted, candidate, isLoading, onStart]);

  // Candidate IDs for VideoInterviewStep (must be before early returns)
  const candidateIds = useMemo(() => {
    if (!candidate?.id || !stageConfig?.stageId) return null;
    return { candidateId: candidate.id, stageId: stageConfig.stageId };
  }, [candidate?.id, stageConfig?.stageId]);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleSubmit = async (submissionOverride?: unknown): Promise<void> => {
    const toSubmit = submissionOverride !== undefined
      ? (submissionOverride as Record<string, unknown>)
      : (currentSubmission as Record<string, unknown>) ?? {};
    await submitChallenge(toSubmit);
    setCurrentSubmission(null);
  };

  // ---------------------------------------------------------------------------
  // Loading state (initial)
  // ---------------------------------------------------------------------------

  if (isLoading && !candidate && !isSubmitted) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0c0c0e' }}>
        <ChromeMeshGrid />
        <div style={{ textAlign: 'center', zIndex: 1 }}>
          <Loader2 className="animate-spin" size={32} color="var(--pipe-text-dim)" />
          <div style={{ marginTop: 16, fontSize: 10, letterSpacing: '0.2em', color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace' }}>
            INITIALIZING_SECURE_SESSION...
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Error state
  // ---------------------------------------------------------------------------

  // Terminal errors (invalid token, completed, expired) show a full-page error.
  // Non-terminal errors (submission failures) are shown inline so the candidate can retry.
  const isTerminalError = error && (
    error.message === 'INVALID_TOKEN' ||
    error.message === 'ALREADY_COMPLETED' ||
    error.message === 'SESSION_EXPIRED'
  );

  if (isTerminalError) {
    const isInvalid = error.message === 'INVALID_TOKEN';
    const isCompleted = error.message === 'ALREADY_COMPLETED';
    const isSessionExpired = error.message === 'SESSION_EXPIRED';

    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0c0c0e', padding: 24 }}>
        <ChromeMeshGrid />
        <LiquidMetalCard variant="mercury" style={{ maxWidth: 480, padding: 48, textAlign: 'center', zIndex: 1 }}>
          <AlertCircle size={48} color="rgba(255,100,100,0.5)" style={{ marginBottom: 24 }} />
          <h2 style={{ fontSize: 24, fontWeight: 700, color: 'var(--pipe-text, #fff)', marginBottom: 16 }}>
            {isInvalid ? 'Invalid Invite Link'
              : isCompleted ? 'Assessment Completed'
              : isSessionExpired ? 'Session Expired'
              : 'Connection Error'}
          </h2>
          <p style={{ fontSize: 14, color: 'var(--pipe-text-dim)', lineHeight: 1.6, marginBottom: 32, fontFamily: '"Space Mono", monospace' }}>
            {isInvalid ? 'This invitation link is invalid or has expired. Please contact your recruiter for a new link.'
              : isCompleted ? 'You have already submitted this assessment. Thank you for your time!'
              : isSessionExpired ? 'Your session has expired. Please contact your recruiter for a new invite link.'
              : 'There was an error connecting to our secure servers. Please try refreshing the page or clicking the button below.'}
          </p>
          <button onClick={() => reset()} style={{
            padding: '12px 24px', background: 'var(--pipe-surface-hover)',
            border: '1px solid var(--pipe-border)', color: 'var(--pipe-text, #fff)',
            fontSize: 10, letterSpacing: '0.1em', fontFamily: '"Space Mono", monospace', cursor: 'pointer'
          }}>RETRY_CONNECTION</button>
        </LiquidMetalCard>
      </div>
    );
  }

  // Non-terminal error (e.g. submission failure) — show before initial load only
  if (error && !hasStarted) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0c0c0e', padding: 24 }}>
        <ChromeMeshGrid />
        <LiquidMetalCard variant="mercury" style={{ maxWidth: 480, padding: 48, textAlign: 'center', zIndex: 1 }}>
          <AlertCircle size={48} color="rgba(255,100,100,0.5)" style={{ marginBottom: 24 }} />
          <h2 style={{ fontSize: 24, fontWeight: 700, color: 'var(--pipe-text, #fff)', marginBottom: 16 }}>Connection Error</h2>
          <p style={{ fontSize: 14, color: 'var(--pipe-text-dim)', lineHeight: 1.6, marginBottom: 32, fontFamily: '"Space Mono", monospace' }}>
            There was an error connecting to our secure servers. Please try refreshing the page or clicking the button below.
          </p>
          <button onClick={() => reset()} style={{
            padding: '12px 24px', background: 'var(--pipe-surface-hover)',
            border: '1px solid var(--pipe-border)', color: 'var(--pipe-text, #fff)',
            fontSize: 10, letterSpacing: '0.1em', fontFamily: '"Space Mono", monospace', cursor: 'pointer'
          }}>RETRY_CONNECTION</button>
        </LiquidMetalCard>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Completed state
  // ---------------------------------------------------------------------------

  if (isSubmitted) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0c0c0e', padding: 24 }}>
        <ChromeMeshGrid />
        <LiquidMetalCard variant="chrome" style={{ maxWidth: 480, padding: 60, textAlign: 'center', zIndex: 1 }}>
          <CheckCircle size={64} color="#10b981" style={{ marginBottom: 32 }} />
          <h2 style={{ fontSize: 32, fontWeight: 800, color: 'var(--pipe-text, #fff)', marginBottom: 16, letterSpacing: '-0.02em' }}>Submitted.</h2>
          <p style={{ fontSize: 14, color: 'var(--pipe-text-muted)', lineHeight: 1.6, fontFamily: '"Space Mono", monospace' }}>
            Your assessment has been securely delivered. The team will review your submission and get back to you soon.
          </p>
        </LiquidMetalCard>
      </div>
    );
  }


  // ---------------------------------------------------------------------------
  // Loading challenge
  // ---------------------------------------------------------------------------

  if (!stageConfig || !challengeContent || !resolvedConfig) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0c0c0e' }}>
        <ChromeMeshGrid />
        <div style={{ textAlign: 'center', zIndex: 1 }}>
          <Loader2 className="animate-spin" size={32} color="var(--pipe-text-dim)" />
          <div style={{ marginTop: 16, fontSize: 10, letterSpacing: '0.2em', color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace' }}>
            LOADING_CHALLENGE...
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Challenge workspace
  // ---------------------------------------------------------------------------

  const isFollowUp = currentType === 'FOLLOW_UP';
  const followUpReady = isFollowUp && followUpQuestions && followUpQuestions.length > 0;
  const followUpWaiting = isFollowUp && (followUpLoading || !followUpQuestions || followUpQuestions.length === 0);
  const totalChallenges = stageConfig.challenges?.length ?? 1;
  const isLastChallenge = currentOrder === totalChallenges - 1;

  return (
    <SessionTokenProvider value={sessionToken}>
    <CandidateIdProvider value={candidateIds}>
    <div style={{ height: '100vh', overflow: 'hidden', background: '#0c0c0e' }}>
      <ChromeMeshGrid />

      {isPreview && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100,
          background: 'rgba(251,191,36,0.12)', borderBottom: '1px solid rgba(251,191,36,0.3)',
          padding: '10px 24px', display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: 8, fontSize: 10, letterSpacing: '0.15em', fontWeight: 700,
          fontFamily: '"Space Mono", monospace', color: '#fbbf24',
        }}>PREVIEW_MODE — This is a preview. Responses will not be scored or saved.</div>
      )}

      {/* Inline submission error banner — shown when submit fails mid-assessment */}
      {error && hasStarted && (
        <div
          data-testid="submission-error"
          style={{
            position: 'fixed',
            top: 12,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 200,
            background: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid rgba(239, 68, 68, 0.4)',
            borderRadius: 8,
            padding: '12px 24px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            maxWidth: 600,
            backdropFilter: 'blur(12px)',
          }}
        >
          <AlertCircle size={18} color="#f87171" />
          <span style={{ fontSize: 12, color: '#f87171', fontFamily: '"Space Mono", monospace', fontWeight: 700, letterSpacing: '0.05em' }}>
            SUBMISSION_FAILED — {error.message}. Please try again.
          </span>
        </div>
      )}

      <InterviewProvider
        key={`${currentOrder}-${challengeContent.title}`}
        stageConfig={resolvedConfig}
        currentIndex={0}
        onSubmit={handleSubmit}
        onSubmissionChange={setCurrentSubmission}
      >
        {/* VideoShell wraps for LIVE_VIDEO stages (adds floating PiP), otherwise renders directly */}
        {(() => {
          const inner = (
            <TimerProvider>
              <StageShell
                title={challengeContent.title ?? 'Challenge'}
                totalChallenges={totalChallenges}
                currentChallengeIndex={currentOrder}
                onNext={() => handleSubmit()}
                isLastChallenge={isLastChallenge}
                fullBleed={currentType === 'CODE_REVIEW' || currentType === 'CODE_IMPLEMENTATION'}
                canAdvance={
                  !isPreview &&
                  currentType !== 'WELCOME' &&
                  currentType !== 'LIVE_VIDEO' &&
                  (
                    currentType === 'AGENT_INTERVIEW'
                      ? currentSubmission !== null
                      : (followUpReady || (!isFollowUp && currentSubmission !== null))
                  )
                }
                isSubmitting={isLoading}
              >
                {followUpWaiting ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 400 }}>
                    <Loader2 className="animate-spin" size={32} color="var(--pipe-text-dim)" />
                  </div>
                ) : followUpReady ? (
                  <FollowUpQuestionsPanel
                    questions={followUpQuestions}
                    isSubmitting={isLoading}
                    onSubmit={(answers) => handleSubmit({ answers })}
                    onSkip={() => handleSubmit({ answers: {} })}
                  />
                ) : (
                  <StageRenderer />
                )}
              </StageShell>
            </TimerProvider>
          );

          // VideoShell only activates once past the LIVE_VIDEO waiting room step
          // (recruiter initiates the call, not the candidate)
          return inner;
        })()}
      </InterviewProvider>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&display=swap');
        .animate-spin { animation: spin 1s linear infinite; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
    </CandidateIdProvider>
    </SessionTokenProvider>
  );
}
