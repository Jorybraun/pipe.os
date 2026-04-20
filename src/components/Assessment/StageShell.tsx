import { ChevronRight, CheckCircle, AlertCircle, Clock } from 'lucide-react';
import Logo from '../ui/Logo';
import { useTimer } from './TimerContext';

interface StageShellProps {
  title: string;
  totalChallenges: number;
  currentChallengeIndex: number;
  children: React.ReactNode;
  onNext: () => void;
  isLastChallenge: boolean;
  canAdvance: boolean;
  isSubmitting: boolean;
  /** When true, the content area fills the viewport edge-to-edge with no padding or maxWidth. Use for full-bleed challenge types like CODE_REVIEW. */
  fullBleed?: boolean;
}

/**
 * StageShell - Layout wrapper for the candidate assessment experience.
 * Manages progress and primary navigation. Displays timer from TimerContext.
 */
export function StageShell({
  title,
  totalChallenges,
  currentChallengeIndex,
  children,
  onNext,
  isLastChallenge,
  canAdvance,
  isSubmitting,
  fullBleed = false,
}: StageShellProps): JSX.Element {
  const { secondsRemaining, formatTime } = useTimer();

  const progressPercent = ((currentChallengeIndex + 1) / totalChallenges) * 100;

  const isWarning = secondsRemaining !== null && secondsRemaining < 90;
  const isCritical = secondsRemaining !== null && secondsRemaining < 30;

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Top Progress Bar */}
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, height: 2, background: 'var(--pipe-surface)', zIndex: 100 }}>
        <div style={{ 
          height: '100%', 
          width: `${progressPercent}%`, 
          background: 'linear-gradient(90deg, #60a5fa, var(--pipe-accent))', 
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
        borderBottom: '1px solid var(--pipe-border)',
        position: 'sticky',
        top: 2,
        zIndex: 90
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <div style={{ width: 28, height: 28, opacity: 0.4 }}>
            <Logo />
          </div>

          <div style={{ width: 1, height: 32, background: 'var(--pipe-surface-hover)' }} />

          <div>
            <div style={{ fontSize: 9, letterSpacing: '0.2em', color: 'var(--pipe-text-dim)', marginBottom: 4, fontFamily: 'Space Mono' }}>
              ASSESSMENT_STAGE
            </div>
            <h2 style={{ fontSize: 18, fontWeight: 800, color: 'var(--pipe-text, #fff)', margin: 0, letterSpacing: '-0.01em' }}>
              {title}
            </h2>
          </div>
          
          <div style={{ width: 1, height: 32, background: 'var(--pipe-surface-hover)' }} />
          
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

        {secondsRemaining !== null && (
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: 12, 
            padding: '8px 16px', 
            background: isCritical ? 'rgba(239, 68, 68, 0.1)' : isWarning ? 'rgba(245, 158, 11, 0.1)' : 'rgba(255,255,255,0.03)',
            border: `1px solid ${isCritical ? 'rgba(239, 68, 68, 0.2)' : isWarning ? 'rgba(245, 158, 11, 0.2)' : 'rgba(255,255,255,0.08)'}`,
            borderRadius: 4,
            transition: 'all 0.3s'
          }}>
            <Clock size={14} color={isCritical ? '#f87171' : isWarning ? '#fbbf24' : 'var(--pipe-text-dim)'} />
            <span style={{ 
              fontSize: 14, 
              fontWeight: 700, 
              color: isCritical ? '#f87171' : isWarning ? '#fbbf24' : '#fff',
              fontFamily: 'Space Mono'
            }}>
              {formatTime(secondsRemaining)}
            </span>
          </div>
        )}
      </header>

      {/* Main Content */}
      <main
        style={
          fullBleed
            ? { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }
            : { flex: 1, padding: '40px', maxWidth: 1200, margin: '0 auto', width: '100%', overflowY: 'auto' }
        }
      >
        {children}
      </main>

      {/* Footer Navigation */}
      <footer style={{ 
        padding: '24px 40px', 
        background: 'rgba(12, 12, 14, 0.9)',
        borderTop: '1px solid var(--pipe-border)',
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
            background: canAdvance ? '#fff' : 'var(--pipe-surface)',
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
