import { Fragment } from 'react';
import { Check, MoreHorizontal } from 'lucide-react';

interface PhaseProgressProps {
  current: number;
  phases: string[];
}

/**
 * PhaseProgress - Visual indicator for the conversational journey.
 * 
 * Shows the current phase, the next few phases, and ellipses for the rest.
 */
export function PhaseProgress({ current, phases }: PhaseProgressProps) {
  const visibleStartIndex = Math.max(0, current - 1);
  const visibleEndIndex = Math.min(phases.length, visibleStartIndex + 3);
  const hasMore = visibleEndIndex < phases.length;

  return (
    <div
      style={{
        padding: "24px 0",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        display: "flex",
        gap: 16,
        alignItems: "center",
        marginBottom: 48
      }}
    >
      {phases.map((phase, i) => {
        const isActive = i === current - 1;
        const isComplete = i < current - 1;
        const isVisible = i >= visibleStartIndex && i < visibleEndIndex;

        if (!isVisible) {
          if (i === visibleEndIndex && hasMore) {
             return (
               <div key="more" style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                 <div style={{ color: 'rgba(255,255,255,0.2)' }}>
                   <MoreHorizontal size={16} />
                 </div>
               </div>
             );
          }
          return null;
        }

        return (
          <Fragment key={phase}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, position: 'relative' }}>
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  background: isComplete
                    ? "rgba(16, 185, 129, 0.1)"
                    : isActive
                    ? "rgba(139, 92, 246, 0.2)"
                    : "rgba(255,255,255,0.03)",
                  border: `1px solid ${
                    isComplete
                      ? "rgba(16, 185, 129, 0.4)"
                      : isActive
                      ? "rgba(139, 92, 246, 0.5)"
                      : "rgba(255,255,255,0.08)"
                  }`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: isComplete
                    ? "#10b981"
                    : isActive
                    ? "#fff"
                    : "rgba(255,255,255,0.3)",
                  fontSize: 10,
                  fontWeight: 700,
                  fontFamily: '"Space Mono", monospace',
                  transition: 'all 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
                  boxShadow: isActive ? '0 0 15px rgba(139, 92, 246, 0.3)' : 'none'
                }}
              >
                {isComplete ? <Check size={14} /> : i + 1}
              </div>
              <span
                style={{
                  fontSize: 9,
                  letterSpacing: "0.3em",
                  color: isActive ? "#fff" : isComplete ? "rgba(16, 185, 129, 0.7)" : "rgba(255,255,255,0.3)",
                  fontWeight: isActive ? 700 : 400,
                  textTransform: 'uppercase',
                  fontFamily: '"Space Mono", monospace',
                  whiteSpace: 'nowrap'
                }}
              >
                {phase}
              </span>
              
              {isActive && (
                <div style={{
                  position: 'absolute',
                  top: -4,
                  left: -4,
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: 'rgba(139, 92, 246, 0.8)',
                  boxShadow: '0 0 8px rgba(139, 92, 246, 0.6)',
                  animation: 'pulse 2s ease-in-out infinite'
                }} />
              )}
            </div>
            {i < visibleEndIndex - 1 && (
              <div
                style={{
                  width: 32,
                  height: 1,
                  background: isComplete
                    ? "rgba(16, 185, 129, 0.2)"
                    : "rgba(255,255,255,0.06)",
                }}
              />
            )}
          </Fragment>
        );
      })}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(1.5); }
        }
      `}</style>
    </div>
  );
}
