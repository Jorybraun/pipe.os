import { GripVertical, Code, Shield, FileText, Trash2, Edit3, Clock } from 'lucide-react';
import { LiquidMetalCard } from '../ui/LiquidMetalCard';
import type { Schema } from '../../../amplify/data/resource';

type Challenge = Schema['Challenge']['type'];

interface ChallengeCardProps {
  challenge: Challenge;
  index: number;
  onEdit?: (challenge: Challenge) => void;
  onDelete?: (challenge: Challenge) => void;
}

const TYPE_COLORS = {
  CODE_REVIEW: { bg: 'rgba(59, 130, 246, 0.1)', border: 'rgba(59, 130, 246, 0.3)', text: '#60a5fa', icon: Code },
  CODE_IMPLEMENTATION: { bg: 'rgba(167, 139, 250, 0.1)', border: 'rgba(167, 139, 250, 0.3)', text: '#a78bfa', icon: Code },
  QUIZ_MCQ: { bg: 'rgba(16, 185, 129, 0.1)', border: 'rgba(16, 185, 129, 0.3)', text: '#34d399', icon: Shield },
  QUIZ_SHORT_ANSWER: { bg: 'rgba(245, 158, 11, 0.1)', border: 'rgba(245, 158, 11, 0.3)', text: '#fbbf24', icon: FileText },
};

/**
 * ChallengeCard - Individual challenge item in the pipeline builder.
 */
export function ChallengeCard({ 
  challenge, 
  index, 
  onEdit, 
  onDelete 
}: ChallengeCardProps): JSX.Element {
  const typeStyle = TYPE_COLORS[challenge.type as keyof typeof TYPE_COLORS] || TYPE_COLORS.QUIZ_MCQ;
  const TypeIcon = typeStyle.icon;

  const config = typeof challenge.config === 'string' ? JSON.parse(challenge.config) : (challenge.config || {});
  const timeLimit = config.timeLimit;

  return (
    <LiquidMetalCard variant="dark" style={{ padding: 0, marginBottom: 12, borderRadius: 8 }}>
      <div style={{ display: 'flex', alignItems: 'stretch' }}>
        {/* Drag Handle & Index */}
        <div style={{
          width: 48,
          background: 'rgba(255,255,255,0.02)',
          borderRight: '1px solid rgba(255,255,255,0.05)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          cursor: 'grab'
        }}>
          <GripVertical size={14} color="rgba(255,255,255,0.2)" />
          <div style={{ 
            fontSize: 10, 
            fontWeight: 800, 
            color: 'rgba(255,255,255,0.15)',
            fontFamily: 'Space Mono'
          }}>
            {String(index + 1).padStart(2, '0')}
          </div>
        </div>

        {/* Content Body */}
        <div style={{ flex: 1, padding: '16px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
            <div style={{
              fontSize: 8,
              fontWeight: 800,
              letterSpacing: '0.15em',
              padding: '4px 8px',
              background: typeStyle.bg,
              border: `1px solid ${typeStyle.border}`,
              color: typeStyle.text,
              borderRadius: 4,
              display: 'flex',
              alignItems: 'center',
              gap: 6
            }}>
              <TypeIcon size={10} />
              {challenge.type?.replace('QUIZ_', '').toUpperCase()}
            </div>
            <h4 style={{ 
              fontSize: 13, 
              fontWeight: 700, 
              color: '#fff', 
              margin: 0,
              letterSpacing: '0.01em'
            }}>
              {challenge.title}
            </h4>
            
            {timeLimit && (
              <div style={{ 
                marginLeft: 'auto', 
                display: 'flex', 
                alignItems: 'center', 
                gap: 6, 
                color: 'rgba(255,255,255,0.3)',
                fontSize: 10,
                fontFamily: 'Space Mono'
              }}>
                <Clock size={12} />
                <span>{timeLimit}M</span>
              </div>
            )}
          </div>
          
          <p style={{ 
            fontSize: 11, 
            color: 'rgba(255,255,255,0.4)', 
            lineHeight: 1.5, 
            margin: 0,
            display: '-webkit-box',
            WebkitLineClamp: 1,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden'
          }}>
            {challenge.instructions || 'No instructions provided.'}
          </p>
        </div>

        {/* Action Column */}
        <div style={{ 
          padding: '0 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          borderLeft: '1px solid rgba(255,255,255,0.05)'
        }}>
          <button 
            onClick={() => onEdit?.(challenge)}
            style={{ 
              background: 'none', 
              border: 'none', 
              color: 'rgba(255,255,255,0.3)', 
              cursor: 'pointer',
              padding: 8,
              borderRadius: 4,
              transition: 'all 0.2s'
            }}
            onMouseOver={e => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
              e.currentTarget.style.color = '#fff';
            }}
            onMouseOut={e => {
              e.currentTarget.style.background = 'none';
              e.currentTarget.style.color = 'rgba(255,255,255,0.3)';
            }}
          >
            <Edit3 size={14} />
          </button>
          <button 
            onClick={() => onDelete?.(challenge)}
            style={{ 
              background: 'none', 
              border: 'none', 
              color: 'rgba(255,80,80,0.3)', 
              cursor: 'pointer',
              padding: 8,
              borderRadius: 4,
              transition: 'all 0.2s'
            }}
            onMouseOver={e => {
              e.currentTarget.style.background = 'rgba(255,80,80,0.1)';
              e.currentTarget.style.color = '#ff4444';
            }}
            onMouseOut={e => {
              e.currentTarget.style.background = 'none';
              e.currentTarget.style.color = 'rgba(255,80,80,0.3)';
            }}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </LiquidMetalCard>
  );
}
