import {
  MapPin,
  Calendar,
  ChevronRight,
} from "lucide-react";

export type RoleStatus = "ACTIVE" | "DRAFT" | "ARCHIVED";

interface RoleCardProps {
  title: string;
  department?: string;
  location?: string;
  status: RoleStatus;
  candidates: number;
  avgScore?: number | null;
  stagesConfigured: number;
  totalStages: number;
  createdAt: string;
  onClick?: () => void;
  style?: React.CSSProperties;
  className?: string;
}

const STATUS_COLORS = {
  ACTIVE: { text: '#34d399', bg: 'rgba(16, 185, 129, 0.1)', border: 'rgba(16, 185, 129, 0.3)' },
  DRAFT: { text: '#fbbf24', bg: 'rgba(245, 158, 11, 0.1)', border: 'rgba(245, 158, 11, 0.3)' },
  ARCHIVED: { text: 'rgba(255,255,255,0.4)', bg: 'rgba(255,255,255,0.05)', border: 'rgba(255,255,255,0.1)' }
};

/**
 * RoleCard - Structural twin of ChallengeCard and CandidateCard.
 * All metrics (Candidates, Stages, Score) and Status are moved to the left.
 */
export function RoleCard({
  title,
  department,
  location = "REMOTE",
  status,
  candidates,
  avgScore,
  stagesConfigured,
  createdAt,
  onClick,
  style = {},
  className = "",
}: RoleCardProps) {
  const statusStyle = STATUS_COLORS[status] || STATUS_COLORS.DRAFT;

  const formattedDate = new Date(createdAt)
    .toLocaleDateString("en-US", { month: "short", day: "numeric" })
    .toUpperCase();

  return (
    <div
      onClick={onClick}
      className={className}
      style={{
        display: 'flex',
        alignItems: 'stretch',
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: 8,
        cursor: onClick ? 'pointer' : 'default',
        transition: 'all 0.2s ease',
        marginBottom: 8,
        overflow: 'hidden',
        ...style,
      }}
      onMouseEnter={e => {
        if (onClick) e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)';
      }}
      onMouseLeave={e => {
        if (onClick) e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)';
      }}
    >
      {/* Left Block — Primary Number: Candidates (Matches 48px width standard) */}
      <div style={{
        width: 48,
        background: 'rgba(255,255,255,0.01)',
        borderRight: '1px solid rgba(255,255,255,0.04)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: '#fff' }}>{candidates}</div>
        <div style={{ fontSize: 6, fontWeight: 800, color: 'rgba(255,255,255,0.2)', fontFamily: '"Space Mono", monospace' }}>CANDS</div>
      </div>

      {/* Content Body */}
      <div style={{ flex: 1, padding: '16px 24px', display: 'flex', alignItems: 'center', gap: 24 }}>
        {/* Left Metrics Cluster */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0 }}>
          {/* Status Badge */}
          <div style={{
            fontSize: 8,
            fontWeight: 800,
            letterSpacing: '0.12em',
            padding: '4px 10px',
            background: statusStyle.bg,
            border: `1px solid ${statusStyle.border}`,
            color: statusStyle.text,
            borderRadius: 4,
            fontFamily: '"Space Mono", monospace',
            width: 70,
            textAlign: 'center'
          }}>
            {status}
          </div>

          {/* Secondary Stats */}
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.6)' }}>{stagesConfigured}</div>
              <div style={{ fontSize: 6, color: 'rgba(255,255,255,0.2)', fontFamily: '"Space Mono", monospace', fontWeight: 800 }}>STAGES</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: avgScore ? '#fff' : 'rgba(255,255,255,0.2)' }}>{avgScore || '—'}</div>
              <div style={{ fontSize: 6, color: 'rgba(255,255,255,0.2)', fontFamily: '"Space Mono", monospace', fontWeight: 800 }}>SCORE</div>
            </div>
          </div>
        </div>

        {/* Title & Metadata */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#fff', marginBottom: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {title}
          </div>
          <div style={{ 
            fontSize: 10, 
            color: 'rgba(255,255,255,0.3)', 
            letterSpacing: '0.05em', 
            fontFamily: '"Space Mono", monospace', 
            display: 'flex', 
            alignItems: 'center', 
            gap: 8 
          }}>
            <span>{department?.toUpperCase() || 'GENERAL'}</span>
            <span style={{ width: 3, height: 3, borderRadius: '50%', background: 'currentColor', opacity: 0.3 }} />
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <MapPin size={10} /> {location}
            </span>
            <span style={{ width: 3, height: 3, borderRadius: '50%', background: 'currentColor', opacity: 0.3 }} />
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Calendar size={10} opacity={0.5} /> {formattedDate}
            </span>
          </div>
        </div>
      </div>

      {/* Action/Chevron */}
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
