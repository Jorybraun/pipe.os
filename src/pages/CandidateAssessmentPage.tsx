import { useState, useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useAssessment } from '../hooks/useAssessment';
import { ChallengeRegistry } from '../components/Assessment/ChallengeRegistry';
import { StageShell } from '../components/Assessment/StageShell';
import { TimerProvider } from '../components/Assessment/TimerContext';
import { VideoShell } from '../components/Shells/VideoShell';
import { SchedulingStep } from '../components/Assessment/SchedulingStep';
import { WelcomeScreen, type ChallengeType } from '../components/Assessment/WelcomeScreen';
import { FollowUpQuestionsPanel } from '../components/Assessment/FollowUpQuestionsPanel';
import { LiquidMetalCard } from '../components/ui/LiquidMetalCard';
import { ChromeMeshGrid } from '../components/ChromeMeshGrid';
import { CheckCircle, AlertCircle, Loader2 } from 'lucide-react';

// ============================================================================
// Component
// ============================================================================

/**
 * CandidateAssessmentPage - Unauthenticated entry point for candidates.
 *
 * Route: /assess/:token
 *
 * Flow:
 *   1. Load data (stages + challenges)
 *   2. Show WelcomeScreen (hasStarted = false)
 *   3. onStart → update status IN_PROGRESS, set hasStarted = true
 *   4. Render challenge via StageShell + ChallengeRegistry
 *   5. On CODE_REVIEW submit: show FollowUpQuestionsPanel (or spinner while loading)
 *   6. On follow-up submit/skip: advance to next challenge or isSubmitted screen
 */
export default function CandidateAssessmentPage(): JSX.Element {
  const { token } = useParams<{ token: string }>();
  const [searchParams] = useSearchParams();
  const isPreview = searchParams.get('mode') === 'preview';
  const {
    candidate,
    stages,
    currentStageIndex,
    currentChallengeIndex,
    isLoading,
    error,
    isSubmitted,
    hasStarted,
    followUpQuestions,
    followUpLoading,
    submitChallenge,
    onStart,
    reset,
  } = useAssessment(token || '');

  const [currentSubmission, setCurrentSubmission] = useState<unknown>(null);

  // Auto-skip when Lambda returns 0 follow-up questions (error/empty path).
  // Empty array means no questions were generated — advance without showing the panel.
  useEffect(() => {
    if (followUpQuestions !== null && followUpQuestions.length === 0 && !isLoading) {
      void submitChallenge({ answers: {} });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followUpQuestions]);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleSubmit = async (): Promise<void> => {
    await submitChallenge((currentSubmission as Record<string, unknown>) || {});
    setCurrentSubmission(null);
  };

  const handleFollowUpSkip = (): void => {
    // Skip follow-up: pass empty answers, triggers advancement
    submitChallenge({ answers: {} }).catch((err: unknown) => {
      console.warn('[CandidateAssessmentPage] Skip follow-up failed:', err);
    });
  };

  // ---------------------------------------------------------------------------
  // Loading state
  // ---------------------------------------------------------------------------

  if (isLoading && !candidate && !isSubmitted) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0c0c0e' }}>
        <ChromeMeshGrid />
        <div style={{ textAlign: 'center', zIndex: 1 }}>
          <Loader2 className="animate-spin" size={32} color="rgba(255,255,255,0.4)" />
          <div style={{ marginTop: 16, fontSize: 10, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.4)', fontFamily: '"Space Mono", monospace' }}>
            INITIALIZING_SECURE_SESSION...
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Error state
  // ---------------------------------------------------------------------------

  if (error) {
    const isInvalid = error.message === 'INVALID_TOKEN';
    const isCompleted = error.message === 'ALREADY_COMPLETED';

    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0c0c0e', padding: 24 }}>
        <ChromeMeshGrid />
        <LiquidMetalCard variant="mercury" style={{ maxWidth: 480, padding: 48, textAlign: 'center', zIndex: 1 }}>
          <AlertCircle size={48} color="rgba(255,100,100,0.5)" style={{ marginBottom: 24 }} />
          <h2 style={{ fontSize: 24, fontWeight: 700, color: '#fff', marginBottom: 16 }}>
            {isInvalid ? 'Invalid Invite Link' : isCompleted ? 'Assessment Completed' : 'Connection Error'}
          </h2>
          <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.4)', lineHeight: 1.6, marginBottom: 32, fontFamily: '"Space Mono", monospace' }}>
            {isInvalid
              ? 'This invitation link is invalid or has expired. Please contact your recruiter for a new link.'
              : isCompleted
              ? 'You have already submitted this assessment. Thank you for your time!'
              : 'There was an error connecting to our secure servers. Please try refreshing the page or clicking the button below.'}
          </p>
          {!isInvalid && !isCompleted && (
            <button
              onClick={() => reset()}
              style={{
                padding: '12px 24px',
                background: 'rgba(255,255,255,0.1)',
                border: '1px solid rgba(255,255,255,0.2)',
                color: '#fff',
                fontSize: 10,
                letterSpacing: '0.1em',
                fontFamily: '"Space Mono", monospace',
                cursor: 'pointer'
              }}
            >
              RETRY_CONNECTION
            </button>
          )}
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
          <h2 style={{ fontSize: 32, fontWeight: 800, color: '#fff', marginBottom: 16, letterSpacing: '-0.02em' }}>
            Submitted.
          </h2>
          <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.5)', lineHeight: 1.6, fontFamily: '"Space Mono", monospace' }}>
            Your assessment has been securely delivered. The team will review your submission and get back to you soon.
          </p>
        </LiquidMetalCard>
      </div>
    );
  }

  const currentStage = stages[currentStageIndex];
  if (!currentStage || !currentStage.challenges) return <></>;

  const currentChallenge = currentStage.challenges[currentChallengeIndex];
  if (!currentChallenge) return <></>;

  // ---------------------------------------------------------------------------
  // Welcome screen (before candidate starts)
  // ---------------------------------------------------------------------------

  if (!hasStarted) {
    // Derive the pipeline name from the first stage if available
    const pipelineName = candidate?.pipelineId ?? 'Technical Assessment';
    const stageName = currentStage.title ?? 'Stage 1';
    const challengeType = (currentChallenge.type ?? 'CODE_REVIEW') as ChallengeType;

    return (
      <WelcomeScreen
        pipelineName={pipelineName}
        stageName={stageName}
        challengeType={challengeType}
        onStart={onStart}
      />
    );
  }

  // ---------------------------------------------------------------------------
  // Follow-up question flow (FOLLOW_UP challenge type)
  // ---------------------------------------------------------------------------

  if (currentChallenge.type === 'FOLLOW_UP') {
    // Generating questions — show spinner
    if (followUpLoading) {
      return (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0c0c0e' }}>
          <ChromeMeshGrid />
          <div style={{ textAlign: 'center', zIndex: 1 }}>
            <Loader2 className="animate-spin" size={32} color="rgba(255,255,255,0.4)" />
            <div style={{ marginTop: 16, fontSize: 10, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.4)', fontFamily: '"Space Mono", monospace' }}>
              GENERATING_QUESTIONS...
            </div>
          </div>
        </div>
      );
    }

    // Empty questions: Lambda failed — show completing spinner while useEffect auto-advances
    if (followUpQuestions !== null && followUpQuestions.length === 0) {
      return (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0c0c0e' }}>
          <ChromeMeshGrid />
          <div style={{ textAlign: 'center', zIndex: 1 }}>
            <Loader2 className="animate-spin" size={32} color="rgba(255,255,255,0.4)" />
            <div style={{ marginTop: 16, fontSize: 10, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.4)', fontFamily: '"Space Mono", monospace' }}>
              COMPLETING...
            </div>
          </div>
        </div>
      );
    }

    // Questions ready — show follow-up panel (keep mounted while isLoading so isSubmitting can show spinner)
    if (followUpQuestions !== null && followUpQuestions.length > 0) {
      return (
        <>
          <ChromeMeshGrid />
          <FollowUpQuestionsPanel
            questions={followUpQuestions}
            onSubmit={(answers) => submitChallenge({ answers })}
            onSkip={handleFollowUpSkip}
            isSubmitting={isLoading}
          />
          <style>{`
            @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&display=swap');
            .animate-spin { animation: spin 1s linear infinite; }
            @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
          `}</style>
        </>
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Challenge workspace
  // ---------------------------------------------------------------------------

  const isLastChallenge =
    currentStageIndex === stages.length - 1 &&
    currentChallengeIndex === currentStage.challenges.length - 1;

  // Determine if this stage uses live video
  const isLiveVideoStage = currentStage.mode === 'LIVE_VIDEO';

  // TYPE SAFETY: For CODE_REVIEW, ChallengeRegistry always sets this shape.
  const submission = currentSubmission as {
    annotations?: unknown[];
    verdict?: string | null;
    summary?: string;
    [key: string]: unknown;
  } | null;

  const challengeWorkspace = (
    <TimerProvider key={currentChallenge.id}>
      <StageShell
        title={currentChallenge.title}
        totalChallenges={currentStage.challenges.length}
        currentChallengeIndex={currentChallengeIndex}
        onNext={handleSubmit}
        isLastChallenge={isLastChallenge}
        fullBleed={currentChallenge.type === 'CODE_REVIEW'}
        canAdvance={
          !isPreview &&
          submission !== null &&
          (currentChallenge.type !== 'CODE_REVIEW'
            || (!!submission.verdict && (submission.summary ?? '').trim().length > 0))
        }
        isSubmitting={isLoading}
      >
        <ChallengeRegistry
          challenge={currentChallenge}
          stageTimeLimit={currentStage.order !== null ? (currentStage as { timeLimit?: number | null }).timeLimit ?? null : null}
          onSubmissionChange={setCurrentSubmission}
          onSubmit={handleSubmit}
        />
      </StageShell>
    </TimerProvider>
  );

  // For LIVE_VIDEO stages: show scheduling widget if no challenges exist yet,
  // otherwise wrap the challenge workspace in VideoShell.
  const hasNoChallenges = !currentStage.challenges || currentStage.challenges.length === 0;

  return (
    <div style={{ minHeight: '100vh', background: '#0c0c0e' }}>
      <ChromeMeshGrid />

      {isPreview && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 100,
          background: 'rgba(251,191,36,0.12)',
          borderBottom: '1px solid rgba(251,191,36,0.3)',
          padding: '10px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          fontSize: 10,
          letterSpacing: '0.15em',
          fontWeight: 700,
          fontFamily: '"Space Mono", monospace',
          color: '#fbbf24',
        }}>
          PREVIEW_MODE — This is a preview. Responses will not be scored or saved.
        </div>
      )}

      {isLiveVideoStage && hasNoChallenges && candidate ? (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, paddingTop: isPreview ? 60 : 24 }}>
          <div style={{ width: '100%', maxWidth: 680, zIndex: 1 }}>
            <SchedulingStep
              candidateId={candidate.id}
              stageId={currentStage.id}
              candidateName={candidate.name ?? 'Candidate'}
              {...(candidate.email ? { candidateEmail: candidate.email } : {})}
            />
          </div>
        </div>
      ) : isLiveVideoStage && candidate ? (
        <VideoShell
          stageId={currentStage.id}
          candidateId={candidate.id}
          role="CANDIDATE"
        >
          {challengeWorkspace}
        </VideoShell>
      ) : (
        challengeWorkspace
      )}

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&display=swap');
        .animate-spin {
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
