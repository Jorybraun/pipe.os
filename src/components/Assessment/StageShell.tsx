import { useState, useEffect } from 'react';
import { Clock, ChevronRight, CheckCircle, AlertCircle } from 'lucide-react';

interface StageShellProps {
  title: string;
  totalChallenges: number;
  currentChallengeIndex: number;
  timeLimit?: number; // in minutes
  children: React.ReactNode;
  onNext: () => void;
  isLastChallenge: boolean;
  canAdvance: boolean;
  isSubmitting: boolean;
}

/**
 * StageShell - Layout wrapper for the candidate assessment experience.
 * Manages timer, progress, and primary navigation.
 */
export function StageShell({
  title,
  totalChallenges,
  currentChallengeIndex,
  timeLimit,
  children,
  onNext,
  isLastChallenge,
  canAdvance,
  isSubmitting,
}: StageShellProps): JSX.Element {
  const [secondsRemaining, setSecondsRemaining] = useState(timeLimit ? timeLimit * 60 : 0);

  useEffect(() => {
    if (!timeLimit) return;
    
    const timer = setInterval(() => {
      setSecondsRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [timeLimit]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const progressPercent = ((currentChallengeIndex + 1) / totalChallenges) * 100;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Top Progress Bar */}
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, height: 2, background: 'rgba(255,255,255,0.05)', zIndex: 100 }}>
        <div style={{ 
          height: '100%', 
          width: `${progressPercent}%`, 
          background: 'linear-gradient(90deg, #60a5fa, #a78bfa)', 
          transition: 'width 0.5s ease-out',
          boxShadow: '0 0 10px rgba(167, 139, 250, 0.5)'
        }} />
      </div>

      {/* Header */}
      <header style={{ 
        padding: '24px 40px', 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        background: 'rgba(12, 12, 14, 0.8)',
        backdropFilter: 'blur(20px)',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        position: 'sticky',
        top: 2,
        zIndex: 90
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <div>
            <div style={{ fontSize: 9, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', marginBottom: 4, fontFamily: 'Space Mono' }}>
              ASSESSMENT_STAGE
            </div>
            <h2 style={{ fontSize: 18, fontWeight: 800, color: '#fff', margin: 0, letterSpacing: '-0.01em' }}>
              {title}
            </h2>
          </div>
          
          <div style={{ width: 1, height: 32, background: 'rgba(255,255,255,0.1)' }} />
          
          <div style={{ display: 'flex', gap: 8 }}>
            {Array.from({ length: totalChallenges }).map((_, i) => (
              <div 
                key={i} 
                style={{ 
                  width: 8, 
                  height: 8, 
                  borderRadius: '50%', 
                  background: i < currentChallengeIndex ? '#34d399' : i === currentChallengeIndex ? '#fff' : 'rgba(255,255,255,0.1)',
                  transition: 'all 0.3s'
                }} 
              />
            ))}
          </div>
        </div>

        {timeLimit && (
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: 12, 
            padding: '8px 16px', 
            background: secondsRemaining < 60 ? 'rgba(239, 68, 68, 0.1)' : 'rgba(255,255,255,0.03)',
            border: `1px solid ${secondsRemaining < 60 ? 'rgba(239, 68, 68, 0.2)' : 'rgba(255,255,255,0.08)'}`,
            borderRadius: 4
          }}>
            <Clock size={14} color={secondsRemaining < 60 ? '#f87171' : 'rgba(255,255,255,0.4)'} />
            <span style={{ 
              fontSize: 14, 
              fontWeight: 700, 
              color: secondsRemaining < 60 ? '#f87171' : '#fff',
              fontFamily: 'Space Mono'
            }}>
              {formatTime(secondsRemaining)}
            </span>
          </div>
        )}
      </header>

      {/* Main Content */}
      <main style={{ flex: 1, padding: '40px', maxWidth: 1200, margin: '0 auto', width: '100%' }}>
        {children}
      </main>

      {/* Footer Navigation */}
      <footer style={{ 
        padding: '24px 40px', 
        background: 'rgba(12, 12, 14, 0.9)',
        borderTop: '1px solid rgba(255,255,255,0.06)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        position: 'sticky',
        bottom: 0,
        zIndex: 90
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {canAdvance ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#34d399' }}>
              <CheckCircle size={16} />
              <span style={{ fontSize: 10, fontWeight: 700, fontFamily: 'Space Mono' }}>READY_TO_PROCEED</span>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'rgba(255,255,255,0.2)' }}>
              <AlertCircle size={16} />
              <span style={{ fontSize: 10, fontWeight: 700, fontFamily: 'Space Mono' }}>COMPLETE_CHALLENGE_TO_CONTINUE</span>
            </div>
          )}
        </div>

        <button
          onClick={onNext}
          disabled={!canAdvance || isSubmitting}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '14px 32px',
            background: canAdvance ? '#fff' : 'rgba(255,255,255,0.05)',
            color: canAdvance ? '#000' : 'rgba(255,255,255,0.2)',
            border: 'none',
            borderRadius: 4,
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: '0.1em',
            fontFamily: 'Space Mono',
            cursor: canAdvance ? 'pointer' : 'not-allowed',
            transition: 'all 0.2s'
          }}
        >
          {isSubmitting ? 'UPLOADING...' : isLastChallenge ? 'FINAL_SUBMIT' : 'NEXT_CHALLENGE'}
          <ChevronRight size={16} />
        </button>
      </footer>
    </div>
  );
}
