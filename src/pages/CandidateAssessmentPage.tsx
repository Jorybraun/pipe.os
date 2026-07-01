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
import { InterviewProvider, useInterview } from '../contexts/InterviewContext';
import { StageRenderer } from '../components/Assessment/StageRenderer';
import { CodeReviewChallenge, asCodeReviewReviewProfile } from '../components/Assessment/CodeReviewChallenge';
import type { Annotation } from '../components/Assessment/DiffPanel';
import type { CodeReviewMatchExplanation } from '../components/Panels/ProblemPanel';
import { FollowUpQuestionsPanel } from '../components/Assessment/FollowUpQuestionsPanel';
import { IntakeChallenge } from '../components/Assessment/IntakeChallenge';
import { WelcomeScreen } from '../components/Assessment/WelcomeScreen';
import { WaitingForMatch, type WaitingForMatchDiagnostics } from '../components/Assessment/WaitingForMatch';
import { resolveStageConfig } from '../lib/challenge/resolveStageConfig';
import { normalizeDiffJson } from '../lib/challenge/componentMap';
import type { RawStage, RawChallenge } from '../lib/challenge/resolveStageConfig';
import { useReviewSessionV2 } from '../hooks/useReviewSessionV2';
import { ReviewSessionPage } from './ReviewSessionPage';
import { VideoShell } from '../components/Shells/VideoShell';
import type { ReviewRound } from '../types/conversation';

function isAnnotation(value: unknown): value is Annotation {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === 'string'
    && typeof record.file === 'string'
    && typeof record.line === 'number'
    && ['critical', 'major', 'minor'].includes(String(record.severity))
    && typeof record.comment === 'string'
    && typeof record.createdAt === 'string';
}

function asCodeReviewMatchExplanation(value: unknown): CodeReviewMatchExplanation | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as CodeReviewMatchExplanation
    : null;
}

function CodeReviewAssessmentView(): JSX.Element {
  const { currentChallenge, submission, updateSubmission } = useInterview();
  const annotations = Array.isArray(submission.annotations)
    ? submission.annotations.filter(isAnnotation)
    : [];
  const verdict = typeof submission.verdict === 'string' ? submission.verdict : null;
  const summary = typeof submission.summary === 'string' ? submission.summary : '';
  const diff = normalizeDiffJson(currentChallenge.data.cachedDiffJson ?? { files: [] });

  return (
    <CodeReviewChallenge
      challenge={{
        id: currentChallenge.id,
        title: currentChallenge.title,
        instructions: currentChallenge.instructions,
        githubRepoUrl: typeof currentChallenge.data.githubRepoUrl === 'string'
          ? currentChallenge.data.githubRepoUrl
          : null,
        githubPrNumber: typeof currentChallenge.data.githubPrNumber === 'number'
          ? currentChallenge.data.githubPrNumber
          : null,
        githubPrTitle: typeof currentChallenge.data.githubPrTitle === 'string'
          ? currentChallenge.data.githubPrTitle
          : null,
        githubPrDescription: typeof currentChallenge.data.githubPrDescription === 'string'
          ? currentChallenge.data.githubPrDescription
          : null,
        cachedMetadata: currentChallenge.data.cachedMetadata,
        matchExplanation: asCodeReviewMatchExplanation(currentChallenge.data.matchExplanation),
        reviewProfile: currentChallenge.data.reviewProfile,
      }}
      diff={diff.files.length > 0 ? diff : null}
      isFetchingDiff={false}
      submission={{ annotations, verdict, summary }}
      onSubmissionChange={(next) => updateSubmission(next)}
    />
  );
}

/**
 * Build a RawStage from the stage config DTO + current challenge content.
 * The composable system needs a StageConfig with challenges array.
 * We include ALL challenges so the WelcomeScreen can show the full queue,
 * and hydrate only the current challenge with content from get-challenge.
 */
function asRawCodeArtifact(
  value: unknown,
): Exclude<RawChallenge['codeArtifact'], undefined> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== 'string') return null;
  return {
    id: record.id,
    code: typeof record.code === 'string' ? record.code : null,
    language: typeof record.language === 'string' ? record.language : null,
    title: typeof record.title === 'string' ? record.title : null,
  };
}

function buildRawStage(
  stageConfig: StageConfigDTO,
  content: ChallengeContentDTO,
  currentOrder: number,
): RawStage {
  const allChallenges = (stageConfig.challenges ?? []).map((ch, index): RawChallenge => {
    const isCurrent = index === currentOrder;
    if (isCurrent) {
      return {
        id: content.id ?? `challenge-${currentOrder}`,
        type: content.type ?? ch.type ?? 'QUIZ_MCQ',
        title: content.title ?? ch.title ?? 'Challenge',
        instructions: content.instructions ?? null,
        config: typeof content.config === 'string'
          ? content.config
          : JSON.stringify(content.config ?? {}),
        order: index,
        codeArtifact: asRawCodeArtifact(content.codeArtifact),
        cachedDiffJson: content.cachedDiffJson ?? null,
        githubPrTitle: (content.githubPrTitle as string) ?? null,
        githubRepoUrl: (content.githubRepoUrl as string) ?? null,
        githubPrNumber: (content.githubPrNumber as number) ?? null,
        githubPrDescription: (content.githubPrDescription as string) ?? null,
        devContainerRepoUrl: (content.devContainerRepoUrl as string) ?? null,
        matchExplanation: content.matchExplanation ?? null,
        reviewProfile: content.reviewProfile ?? null,
        issueBody: content.issueBody ?? null,
      };
    }
    // Non-current challenges: minimal info for WelcomeScreen preview
    return {
      id: `challenge-${index}`,
      type: ch.type ?? 'QUIZ_MCQ',
      title: ch.title ?? 'Challenge',
      instructions: null,
      config: '{}',
      order: index,
    };
  });

  return {
    id: 'current-stage',
    title: stageConfig.stageTitle ?? 'Stage',
    order: 0,
    timeLimit: stageConfig.timeLimit ?? null,
    challenges: allChallenges,
  };
}

function isStandaloneCodeReviewWaitingHandoff(
  stageConfig: StageConfigDTO | null,
  currentType: string | undefined,
): boolean {
  if (currentType !== 'WAITING_FOR_MATCH') return false;
  const stageId = stageConfig?.stageId?.toLowerCase() ?? '';
  const challengeTypes = stageConfig?.challenges?.map((challenge) => challenge.type) ?? [];
  return stageId === 'standalone-code-review' && challengeTypes.includes('CODE_REVIEW');
}

// ============================================================================
// Component
// ============================================================================

interface CandidateAssessmentPageProps {
  hideHeader?: boolean;
}

export default function CandidateAssessmentPage({ hideHeader = false }: CandidateAssessmentPageProps): JSX.Element {
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
    claimAssessmentStart,
    reset,
    refresh,
    sessionToken,
  } = useAssessment(token || '');

  const [currentSubmission, setCurrentSubmission] = useState<unknown>(null);
  const [assessmentWelcomeDismissed, setAssessmentWelcomeDismissed] = useState(false);
  const [assessmentStartLoading, setAssessmentStartLoading] = useState(false);
  const [assessmentStartError, setAssessmentStartError] = useState<string | null>(null);

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
    return resolveStageConfig(rawStage);
  }, [stageConfig, challengeContent, currentOrder]);

  const currentType = challengeContent?.type ?? stageConfig?.challenges?.[currentOrder]?.type;
  const shouldFailClosedToProfileReceived = isStandaloneCodeReviewWaitingHandoff(stageConfig, currentType);

  // Review session v2 state (CODE_REVIEW golden path)
  const [reviewSessionMeta, setReviewSessionMeta] = useState<{
    sessionId: string;
    status: string;
    completed: boolean;
    rounds: ReviewRound[];
    currentRound: number;
    maxRounds: number;
  } | null>(null);
  const [reviewSessionInitLoading, setReviewSessionInitLoading] = useState(false);
  const { initSession } = useReviewSessionV2(undefined, sessionToken);

  // Auto-init review session for CODE_REVIEW challenges that require it
  useEffect(() => {
    if (
      currentType === 'CODE_REVIEW' &&
      challengeContent?.reviewSession?.requiresInit &&
      !reviewSessionMeta &&
      !reviewSessionInitLoading &&
      !isLoading &&
      challengeContent?.id
    ) {
      setReviewSessionInitLoading(true);
      initSession(challengeContent.id)
        .then((result) => {
          setReviewSessionMeta({
            sessionId: result.sessionId,
            status: result.status,
            completed: result.completed === true,
            rounds: result.rounds,
            currentRound: result.currentRound,
            maxRounds: result.maxRounds,
          });
        })
        .catch((err: unknown) => {
          console.error('[CandidateAssessmentPage] initSession failed:', err);
        })
        .finally(() => {
          setReviewSessionInitLoading(false);
        });
    }
  }, [currentType, challengeContent, reviewSessionMeta, reviewSessionInitLoading, isLoading, initSession]);

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

  const handleAssessmentStart = async (): Promise<void> => {
    if (assessmentStartLoading) return;
    setAssessmentStartLoading(true);
    setAssessmentStartError(null);
    try {
      await claimAssessmentStart();
      setAssessmentWelcomeDismissed(true);
    } catch (err) {
      const message = err instanceof Error && err.message
        ? err.message
        : 'Unable to start the assessment. Please retry, or contact your recruiter for a fresh link.';
      setAssessmentStartError(message);
    } finally {
      setAssessmentStartLoading(false);
    }
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

  // Terminal errors (invalid token, completed, expired, claimed) show a full-page error.
  // Non-terminal errors (submission failures) are shown inline so the candidate can retry.
  const isTerminalError = error && (
    error.message === 'INVALID_TOKEN' ||
    error.message === 'ALREADY_COMPLETED' ||
    error.message === 'SESSION_EXPIRED' ||
    error.message === 'TOKEN_ALREADY_CLAIMED'
  );

  if (isTerminalError) {
    const isInvalid = error.message === 'INVALID_TOKEN';
    const isCompleted = error.message === 'ALREADY_COMPLETED';
    const isSessionExpired = error.message === 'SESSION_EXPIRED';
    const isTokenClaimed = error.message === 'TOKEN_ALREADY_CLAIMED';

    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0c0c0e', padding: 24 }}>
        <ChromeMeshGrid />
        <LiquidMetalCard variant="mercury" style={{ maxWidth: 480, padding: 48, textAlign: 'center', zIndex: 1 }}>
          <AlertCircle size={48} color="rgba(255,100,100,0.5)" style={{ marginBottom: 24 }} />
          <h2 style={{ fontSize: 24, fontWeight: 700, color: 'var(--pipe-text, #fff)', marginBottom: 16 }}>
            {isInvalid ? 'Invalid Invite Link'
              : isCompleted ? 'Assessment Completed'
              : isSessionExpired ? 'Session Expired'
              : isTokenClaimed ? 'Assessment Already Started'
              : 'Connection Error'}
          </h2>
          <p style={{ fontSize: 14, color: 'var(--pipe-text-dim)', lineHeight: 1.6, marginBottom: 32, fontFamily: '"Space Mono", monospace' }}>
            {isInvalid ? 'This invitation link is invalid or has expired. Please contact your recruiter for a new link.'
              : isCompleted ? 'You have already submitted this assessment. Thank you for your time!'
              : isSessionExpired ? 'Your session has expired. Please contact your recruiter for a new invite link.'
              : isTokenClaimed ? 'This one-use assessment link has already started. Please contact your recruiter if you need a fresh link.'
              : 'There was an error connecting to our secure servers. Please try refreshing the page or clicking the button below.'}
          </p>
          {!isCompleted && !isTokenClaimed && (
            <button onClick={() => reset()} style={{
              padding: '12px 24px', background: 'var(--pipe-surface-hover)',
              border: '1px solid var(--pipe-border)', color: 'var(--pipe-text, #fff)',
              fontSize: 10, letterSpacing: '0.1em', fontFamily: '"Space Mono", monospace', cursor: 'pointer'
            }}>RETRY_CONNECTION</button>
          )}
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

  if (isSubmitted || currentType === 'PROFILE_RECEIVED' || shouldFailClosedToProfileReceived) {
    const isProfileReceived = currentType === 'PROFILE_RECEIVED' || shouldFailClosedToProfileReceived;
    return (
      <div data-testid="assessment-submitted" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0c0c0e', padding: 24 }}>
        <ChromeMeshGrid />
        <LiquidMetalCard variant="chrome" style={{ maxWidth: 480, padding: 60, textAlign: 'center', zIndex: 1 }}>
          <CheckCircle size={64} color="#10b981" style={{ marginBottom: 32 }} />
          <h2 style={{ fontSize: 32, fontWeight: 800, color: 'var(--pipe-text, #fff)', marginBottom: 16, letterSpacing: '-0.02em' }}>
            {isProfileReceived ? 'Profile received.' : 'Submitted.'}
          </h2>
          <p style={{ fontSize: 14, color: 'var(--pipe-text-muted)', lineHeight: 1.6, fontFamily: '"Space Mono", monospace' }}>
            {isProfileReceived
              ? "You're done here for now. PIPE will email you when a source-backed code review is ready."
              : 'Your assessment has been submitted. Thank you for your time.'}
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
  const isFollowUp = currentType === 'FOLLOW_UP';
  const followUpReady = isFollowUp && followUpQuestions && followUpQuestions.length > 0;
  const followUpWaiting = isFollowUp && (followUpLoading || !followUpQuestions || followUpQuestions.length === 0);
  const isIntake = currentType === 'INTAKE';
  const shouldShowStartWelcome = candidate?.status === 'INVITED' && !assessmentWelcomeDismissed && !isPreview;

  // The one-use invite is claimed only when the candidate explicitly starts.
  // This covers CV intake, direct code review, dev-container, and waiting gates.
  if (shouldShowStartWelcome) {
    const welcomeChallenges = [
      ...(stageConfig.challenges ?? []).map((ch) => ({
        title: ch.title ?? 'Profile & Resume',
        type: ch.type,
        timeLimit: null,
      })),
      ...(stageConfig.upcoming ?? []).map((u) => ({
        title: u.title ?? 'Code Review',
        type: u.type,
        timeLimit: null,
      })),
    ];
    return (
      <WelcomeScreen
        pipelineName={stageConfig.stageTitle ?? 'Assessment'}
        stageName="Getting Started"
        challenges={welcomeChallenges}
        onStart={() => void handleAssessmentStart()}
        isStarting={assessmentStartLoading}
        startError={assessmentStartError}
      />
    );
  }

  // ---------------------------------------------------------------------------
  // WAITING_FOR_MATCH — full-page waiting state, bypasses StageShell
  // ---------------------------------------------------------------------------

  if (currentType === 'WAITING_FOR_MATCH' && challengeContent) {
    const waitConfig = typeof challengeContent.config === 'object' && challengeContent.config !== null
      ? (challengeContent.config as Record<string, unknown>)
      : {};
    const waitState = waitConfig.state === 'blocked' || waitConfig.state === 'pending'
      ? waitConfig.state
      : undefined;
    const waitReason = typeof waitConfig.reason === 'string' ? waitConfig.reason : undefined;
    const waitDiagnostics = typeof waitConfig.diagnostics === 'object' && waitConfig.diagnostics !== null && !Array.isArray(waitConfig.diagnostics)
      ? (waitConfig.diagnostics as WaitingForMatchDiagnostics)
      : undefined;
    return (
      <div style={{ height: '100vh', overflow: 'hidden', background: '#0c0c0e' }}>
        <ChromeMeshGrid />
        <WaitingForMatch
          title={challengeContent.title ?? 'Building your personalized challenge'}
          instructions={challengeContent.instructions ?? 'We are analyzing your profile to find the best open-source project match. This takes a few moments.'}
          config={{
            autoRefresh: waitConfig.autoRefresh === true,
            refreshIntervalSeconds: typeof waitConfig.refreshIntervalSeconds === 'number' ? waitConfig.refreshIntervalSeconds : 30,
            ...(waitState ? { state: waitState } : {}),
            ...(waitReason ? { reason: waitReason } : {}),
            ...(waitDiagnostics ? { diagnostics: waitDiagnostics } : {}),
          }}
          onRefresh={refresh}
          sessionToken={sessionToken}
        />
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Challenge workspace
  // ---------------------------------------------------------------------------
  const totalChallenges = stageConfig.challenges?.length ?? 1;
  const isLastChallenge = currentOrder === totalChallenges - 1;
  const shouldWrapLiveVideo =
    stageConfig.mode === 'LIVE_VIDEO' &&
    currentType !== 'LIVE_VIDEO' &&
    candidateIds !== null &&
    sessionToken !== null;

  // Determine if we're in the review session v2 flow
  const isReviewSessionV2 =
    currentType === 'CODE_REVIEW' &&
    challengeContent?.reviewSession?.requiresInit &&
    reviewSessionMeta != null;

  const isReviewSessionV2Loading =
    currentType === 'CODE_REVIEW' &&
    challengeContent?.reviewSession?.requiresInit &&
    reviewSessionInitLoading;

  // Use the challenge's own isComplete logic rather than a generic null-check.
  // This prevents empty video/voice submissions and ensures recruiters get
  // actual answers on the candidate profile.
  const currentChallengeNode = resolvedConfig?.challenges?.[currentOrder];
  const isChallengeComplete = currentChallengeNode
    ? currentChallengeNode.isComplete(((currentSubmission ?? {}) as Record<string, unknown>))
    : false;

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
        currentIndex={currentOrder}
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
                hideHeader={hideHeader}
                onNext={() => handleSubmit()}
                isLastChallenge={isLastChallenge}
                fullBleed={currentType === 'CODE_REVIEW' || currentType === 'CODE_IMPLEMENTATION' || isIntake}
                canAdvance={
                  !isPreview &&
                  currentType !== 'WELCOME' &&
                  currentType !== 'LIVE_VIDEO' &&
                  !isReviewSessionV2 &&
                  !isIntake &&
                  (followUpReady || (!isFollowUp && isChallengeComplete))
                }
                isSubmitting={isLoading}
                hideFooter={isReviewSessionV2 || isIntake}
              >
                {isReviewSessionV2Loading ? (
                  <div data-testid="review-session-loader" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 12 }}>
                    <Loader2 className="animate-spin" size={32} color="var(--pipe-text-dim)" />
                    <span style={{ fontSize: 10, letterSpacing: '0.15em', color: 'var(--pipe-text-dim)', fontFamily: '"Space Mono", monospace' }}>
                      INITIALISING_REVIEW_SESSION...
                    </span>
                  </div>
                ) : isReviewSessionV2 ? (
                  <ReviewSessionPage
                    sessionId={reviewSessionMeta.sessionId}
                    pr={{
                      title: challengeContent.githubPrTitle ?? undefined,
                      description: challengeContent.githubPrDescription ?? undefined,
                      diff: normalizeDiffJson(challengeContent.cachedDiffJson ?? { files: [] }),
                      repoUrl: typeof challengeContent.githubRepoUrl === 'string'
                        ? challengeContent.githubRepoUrl
                        : null,
                      prNumber: typeof challengeContent.githubPrNumber === 'number'
                        ? challengeContent.githubPrNumber
                        : null,
                      instructions: challengeContent.instructions ?? null,
                      matchExplanation: asCodeReviewMatchExplanation(challengeContent.matchExplanation),
                      reviewProfile: asCodeReviewReviewProfile(challengeContent.reviewProfile),
                    }}
                    maxRounds={reviewSessionMeta.maxRounds}
                    initialStatus={reviewSessionMeta.status}
                    initialCompleted={reviewSessionMeta.completed}
                    initialRounds={reviewSessionMeta.rounds}
                    initialCurrentRound={reviewSessionMeta.currentRound}
                    onComplete={() => {
                      setReviewSessionMeta(null);
                      void handleSubmit({ reviewSessionId: reviewSessionMeta.sessionId });
                    }}
                  />
                ) : isIntake ? (
                  <IntakeChallenge
                    challengeId={challengeContent.id ?? ''}
                    onSubmit={(submission) => handleSubmit(submission)}
                    isSubmitting={isLoading}
                    candidateName={candidate?.name}
                    candidateEmail={candidate?.email}
                    allowSkip={typeof challengeContent.config === 'object' && challengeContent.config !== null && (challengeContent.config as Record<string, unknown>).allowSkip === true}
                  />
                ) : followUpWaiting ? (
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
                ) : currentType === 'CODE_REVIEW' ? (
                  <CodeReviewAssessmentView />
                ) : (
                  <StageRenderer />
                )}
              </StageShell>
            </TimerProvider>
          );

          // A stage can be a live video interview with code-review or
          // dev-container work inside it. The standalone LIVE_VIDEO challenge
          // still renders its own waiting-room panel.
          if (!shouldWrapLiveVideo || !candidateIds) return inner;
          return (
            <VideoShell
              stageId={candidateIds.stageId}
              candidateId={candidateIds.candidateId}
              role="CANDIDATE"
              sessionToken={sessionToken}
            >
              {inner}
            </VideoShell>
          );
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
