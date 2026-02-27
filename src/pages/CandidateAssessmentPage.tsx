import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAssessment } from '../hooks/useAssessment';
import { ChallengeRegistry } from '../components/Assessment/ChallengeRegistry';
import { StageShell } from '../components/Assessment/StageShell';
import { TimerProvider } from '../components/Assessment/TimerContext';
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
 */
export default function CandidateAssessmentPage(): JSX.Element {
  const { token } = useParams<{ token: string }>();
  const {
    candidate,
    stages,
    currentStageIndex,
    currentChallengeIndex,
    isLoading,
    error,
    isSubmitted,
    submitChallenge,
    reset,
  } = useAssessment(token || '');

  const [currentSubmission, setCurrentSubmission] = useState<any>(null);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleSubmit = async () => {
    await submitChallenge(currentSubmission || {});
    setCurrentSubmission(null);
  };

  // ---------------------------------------------------------------------------
  // Render Helpers
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

  const isLastChallenge = 
    currentStageIndex === stages.length - 1 && 
    currentChallengeIndex === currentStage.challenges.length - 1;

  return (
    <div style={{ minHeight: '100vh', background: '#0c0c0e', position: 'relative' }}>
      <ChromeMeshGrid />
      
      <TimerProvider>
        <StageShell
          title={currentChallenge.title}
          totalChallenges={currentStage.challenges.length}
          currentChallengeIndex={currentChallengeIndex}
          onNext={handleSubmit}
          isLastChallenge={isLastChallenge}
          canAdvance={
            currentSubmission !== null && 
            (currentChallenge.type !== 'CODE_REVIEW' || Object.keys(currentSubmission.annotations || {}).length > 0)
          }
          isSubmitting={isLoading}
        >
          <ChallengeRegistry
            challenge={currentChallenge}
            stageTimeLimit={currentStage.order !== null ? (currentStage as any).timeLimit : null}
            onSubmissionChange={setCurrentSubmission}
            onSubmit={handleSubmit}
          />
        </StageShell>
      </TimerProvider>

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
