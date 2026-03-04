import { useState, useEffect } from "react";
import { Building, MapPin, ChevronRight, User } from "lucide-react";

export type CandidateSignal = "strong" | "yes" | "maybe" | "no";

interface CandidateCardProps {
  initials: string;
  name: string;
  company: string;
  location: string;
  score: number;
  signal: CandidateSignal;
  onClick?: () => void;
  animationDelay?: number;
  style?: React.CSSProperties;
  className?: string;
}

const SIGNAL_COLORS: Record<CandidateSignal, { bg: string; border: string; text: string }> = {
  strong: {
    bg: "rgba(16, 185, 129, 0.1)",
    border: "rgba(16, 185, 129, 0.3)",
    text: "#34d399",
  },
  yes: {
    bg: "rgba(59, 130, 246, 0.1)",
    border: "rgba(59, 130, 246, 0.3)",
    text: "#60a5fa",
  },
  maybe: {
    bg: "rgba(245, 158, 11, 0.1)",
    border: "rgba(245, 158, 11, 0.3)",
    text: "#fbbf24",
  },
  no: {
    bg: "rgba(239, 68, 68, 0.1)",
    border: "rgba(239, 68, 68, 0.3)",
    text: "#f87171",
  },
};

/**
 * CandidateCard - Structural twin of ChallengeCard.
 * Matches the layout, proportions, and aesthetic perfectly.
 */
export function CandidateCard({
  initials,
  name,
  company,
  location,
  score,
  signal,
  onClick,
  animationDelay = 0,
  style = {},
  className = "",
}: CandidateCardProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), animationDelay);
    return () => clearTimeout(timer);
  }, [animationDelay]);

  const signalStyle = SIGNAL_COLORS[signal] || SIGNAL_COLORS.maybe;

  return (
    <div
      onClick={onClick}
      className={className}
      style={{
        opacity: mounted ? 1 : 0,
        transform: mounted ? "translateY(0)" : "translateY(8px)",
        transition: "all 0.4s cubic-bezier(0.16, 1, 0.3, 1)",
        display: "flex",
        alignItems: "stretch",
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.06)",
        borderRadius: 8,
        cursor: onClick ? "pointer" : "default",
        marginBottom: 8,
        overflow: "hidden",
        ...style,
      }}
      onMouseEnter={e => {
        if (onClick) e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)';
      }}
      onMouseLeave={e => {
        if (onClick) e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)';
      }}
    >
      {/* Left Block — Avatar/Initials (Matches ChallengeCard drag handle width) */}
      <div style={{
        width: 48,
        background: 'rgba(255,255,255,0.01)',
        borderRight: '1px solid rgba(255,255,255,0.04)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}>
        <div style={{
          fontSize: 11,
          fontWeight: 800,
          color: 'rgba(255,255,255,0.25)',
          fontFamily: '"Space Mono", monospace'
        }}>
          {initials}
        </div>
      </div>

      {/* Content Body */}
      <div style={{ flex: 1, padding: '16px 24px' }}>
        {/* Top Row: Badge + Title + Score */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
          <div style={{
            fontSize: 8,
            fontWeight: 800,
            letterSpacing: '0.12em',
            padding: '3px 8px',
            background: signalStyle.bg,
            border: `1px solid ${signalStyle.border}`,
            color: signalStyle.text,
            borderRadius: 4,
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            fontFamily: '"Space Mono", monospace'
          }}>
            <User size={10} />
            {signal.toUpperCase()}
          </div>
          
          <h4 style={{ 
            fontSize: 14, 
            fontWeight: 700, 
            color: '#fff', 
            margin: 0,
            letterSpacing: '0.01em'
          }}>
            {name}
          </h4>
          
          <div style={{ 
            marginLeft: 'auto', 
            display: 'flex', 
            alignItems: 'center', 
            gap: 6, 
            color: 'rgba(255,255,255,0.25)',
            fontSize: 10,
            fontFamily: '"Space Mono", monospace'
          }}>
            <span style={{ fontSize: 16, fontWeight: 800, color: '#fff' }}>{score}</span>
            <span style={{ fontSize: 8, opacity: 0.5 }}>SCORE</span>
          </div>
        </div>
        
        {/* Bottom Row: Company & Location */}
        <div style={{ 
          fontSize: 11, 
          color: 'rgba(255,255,255,0.35)', 
          fontFamily: '"Space Mono", monospace',
          display: 'flex',
          gap: 12,
          alignItems: 'center'
        }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Building size={10} /> {company}
          </span>
          <span style={{ width: 3, height: 3, borderRadius: '50%', background: 'currentColor', opacity: 0.3 }} />
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <MapPin size={10} /> {location}
          </span>
        </div>
      </div>

      {/* Action Column */}
      <div style={{ 
        padding: '0 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        <ChevronRight size={16} color="rgba(255,255,255,0.15)" />
      </div>
    </div>
  );
}
