import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAssessment } from '../hooks/useAssessment';
import { StageRenderer, StageType } from '../components/Assessment/StageRegistry';
import { LiquidMetalCard } from '../components/ui/LiquidMetalCard';
import { ChromeMeshGrid } from '../components/ChromeMeshGrid';
import { CheckCircle, AlertCircle, ArrowRight, Loader2 } from 'lucide-react';

// ============================================================================
// Component
// ============================================================================

/**
 * CandidateAssessmentPage - Unauthenticated entry point for candidates.
 *
 * Route: /assess/:token
 *
 * This page uses the useAssessment hook to load data based on the inviteToken.
 * It manages the transitions between assessment stages and final submission.
 */
export default function CandidateAssessmentPage(): JSX.Element {
  const { token } = useParams<{ token: string }>();
  const {
    candidate,
    stages,
    currentStageIndex,
    isLoading,
    error,
    isSubmitted,
    submitStage,
    reset,
  } = useAssessment(token || '');

  const [currentSubmission, setCurrentSubmission] = useState<any>(null);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleSubmit = async () => {
    // For MVP, we might allow empty submissions for the code review preview
    // If currentSubmission is null, we send an empty object
    await submitStage(currentSubmission || {});
    setCurrentSubmission(null);
  };

  // ---------------------------------------------------------------------------
  // Render Helpers
  // ---------------------------------------------------------------------------

  if (isLoading && !candidate) {
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
  if (!currentStage) return <></>;

  return (
    <div style={{ minHeight: '100vh', background: '#0c0c0e', position: 'relative', padding: '40px 24px' }}>
      <ChromeMeshGrid />
      
      <div style={{ maxWidth: 1000, margin: '0 auto', position: 'relative', zIndex: 1 }}>
        {/* Header */}
        <header style={{ marginBottom: 40, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div>
            <div style={{ fontSize: 10, letterSpacing: '0.25em', color: 'rgba(255,255,255,0.2)', marginBottom: 12, fontFamily: '"Space Mono", monospace' }}>
              SECURE_ASSESSMENT_SESSION
            </div>
            <h1 style={{ fontSize: 32, fontWeight: 800, color: '#fff', margin: 0, letterSpacing: '-0.01em' }}>
              {candidate?.name || 'Candidate'}
            </h1>
            <div style={{ marginTop: 8, fontSize: 14, color: 'rgba(255,255,255,0.4)', fontFamily: '"Space Mono", monospace' }}>
              Technical Assessment for Senior Software Engineer
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 10, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.25)', marginBottom: 8, fontFamily: '"Space Mono", monospace' }}>
              PROGRESS
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#fff', fontFamily: '"Space Mono", monospace' }}>
              {currentStageIndex + 1} / {stages.length}
            </div>
          </div>
        </header>

        {/* Content */}
        <main style={{ marginBottom: 40 }}>
          <StageRenderer
            type={currentStage.type as StageType}
            config={currentStage.config}
            onSubmissionChange={setCurrentSubmission}
          />
        </main>

        {/* Footer Actions */}
        <footer style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={handleSubmit}
            disabled={isLoading}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '16px 40px',
              background: 'linear-gradient(135deg, rgba(255,255,255,0.15), rgba(255,255,255,0.05))',
              border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: 4,
              color: '#fff',
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: '0.15em',
              fontFamily: '"Space Mono", monospace',
              cursor: isLoading ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s ease',
              boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
            }}
          >
            {isLoading ? (
              <>
                <Loader2 className="animate-spin" size={16} />
                UPLOADING...
              </>
            ) : (
              <>
                {currentStageIndex === stages.length - 1 ? 'FINAL_SUBMIT' : 'COMPLETE_STAGE'}
                <ArrowRight size={16} />
              </>
            )}
          </button>
        </footer>
      </div>

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
