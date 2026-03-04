import { GripVertical, Code, Shield, FileText, Trash2, Edit3, Clock, ChevronRight } from 'lucide-react';
import type { Schema } from '../../../amplify/data/resource';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

type Challenge = Schema['Challenge']['type'];

interface ChallengeCardProps {
  challenge: Challenge;
  index?: number;
  onEdit?: (challenge: Challenge) => void;
  onDelete?: (challenge: Challenge) => void;
  onClick?: (challenge: Challenge) => void;
  isSortable?: boolean;
}

const TYPE_COLORS = {
  CODE_REVIEW: { bg: 'rgba(59, 130, 246, 0.1)', border: 'rgba(59, 130, 246, 0.3)', text: '#60a5fa', icon: Code },
  CODE_IMPLEMENTATION: { bg: 'rgba(167, 139, 250, 0.1)', border: 'rgba(167, 139, 250, 0.3)', text: '#a78bfa', icon: Code },
  QUIZ_MCQ: { bg: 'rgba(16, 185, 129, 0.1)', border: 'rgba(16, 185, 129, 0.3)', text: '#34d399', icon: Shield },
  QUIZ_SHORT_ANSWER: { bg: 'rgba(245, 158, 11, 0.1)', border: 'rgba(245, 158, 11, 0.3)', text: '#fbbf24', icon: FileText },
};

/**
 * ChallengeCard - Individual challenge item.
 * Adapted to match the airy Scheduling Page aesthetic.
 */
export function ChallengeCard({ 
  challenge, 
  index, 
  onEdit, 
  onDelete,
  onClick,
  isSortable = true
}: ChallengeCardProps): JSX.Element {
  // Only use sortable if requested and ID exists
  const sortable = useSortable({ 
    id: challenge.id,
    disabled: !isSortable 
  });

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = sortable;

  const style = {
    transform: CSS.Transform.toString(transform),
    opacity: isDragging ? 0.5 : 1,
    marginBottom: 8, 
    borderRadius: 8,
    position: 'relative' as const,
    zIndex: isDragging ? 1 : 0,
    cursor: onClick ? 'pointer' : 'default',
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.06)',
    display: 'flex',
    alignItems: 'stretch',
    transition: transition || 'all 0.2s ease',
  };

  const typeStyle = TYPE_COLORS[challenge.type as keyof typeof TYPE_COLORS] || TYPE_COLORS.QUIZ_MCQ;
  const TypeIcon = typeStyle.icon;

  const config = typeof challenge.config === 'string' ? JSON.parse(challenge.config) : (challenge.config || {});
  const timeLimit = config.timeLimit;

  return (
    <div 
      ref={setNodeRef} 
      style={style}
      onClick={() => onClick?.(challenge)}
      onMouseEnter={e => {
        if (onClick) e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)';
      }}
      onMouseLeave={e => {
        if (onClick) e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)';
      }}
    >
      {/* Drag Handle (Optional) */}
      {isSortable && (
        <div 
          {...attributes}
          {...listeners}
          style={{
            width: 40,
            background: 'rgba(255,255,255,0.01)',
            borderRight: '1px solid rgba(255,255,255,0.04)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            cursor: isDragging ? 'grabbing' : 'grab',
            borderTopLeftRadius: 8,
            borderBottomLeftRadius: 8,
          }}
        >
          <GripVertical size={12} color="rgba(255,255,255,0.15)" />
          {typeof index === 'number' && (
            <div style={{ 
              fontSize: 9, 
              fontWeight: 800, 
              color: 'rgba(255,255,255,0.1)',
              fontFamily: '"Space Mono", monospace'
            }}>
              {String(index + 1).padStart(2, '0')}
            </div>
          )}
        </div>
      )}

      {/* Content Body */}
      <div style={{ flex: 1, padding: '16px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
          <div style={{
            fontSize: 8,
            fontWeight: 800,
            letterSpacing: '0.12em',
            padding: '3px 8px',
            background: typeStyle.bg,
            border: `1px solid ${typeStyle.border}`,
            color: typeStyle.text,
            borderRadius: 4,
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            fontFamily: '"Space Mono", monospace'
          }}>
            <TypeIcon size={10} />
            {challenge.type?.replace('QUIZ_', '').toUpperCase()}
          </div>
          <h4 style={{ 
            fontSize: 14, 
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
              color: 'rgba(255,255,255,0.25)',
              fontSize: 10,
              fontFamily: '"Space Mono", monospace'
            }}>
              <Clock size={12} />
              <span>{timeLimit}M</span>
            </div>
          )}
        </div>
        
        <p style={{ 
          fontSize: 11, 
          color: 'rgba(255,255,255,0.35)', 
          lineHeight: 1.5, 
          margin: 0,
          display: '-webkit-box',
          WebkitLineClamp: 1,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          maxWidth: '80%'
        }}>
          {challenge.instructions || 'No instructions provided.'}
        </p>
      </div>

      {/* Action Column */}
      <div style={{ 
        padding: '0 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 4,
      }}>
        {onEdit && (
          <button 
            onClick={(e) => { e.stopPropagation(); onEdit(challenge); }}
            style={{ 
              background: 'none', 
              border: 'none', 
              color: 'rgba(255,255,255,0.2)', 
              cursor: 'pointer',
              padding: 8,
              borderRadius: 4,
              transition: 'all 0.2s'
            }}
            onMouseOver={e => e.currentTarget.style.color = '#fff'}
            onMouseOut={e => e.currentTarget.style.color = 'rgba(255,255,255,0.2)'}
          >
            <Edit3 size={14} />
          </button>
        )}
        {onDelete && (
          <button 
            onClick={(e) => { e.stopPropagation(); onDelete(challenge); }}
            style={{ 
              background: 'none', 
              border: 'none', 
              color: 'rgba(255,80,80,0.2)', 
              cursor: 'pointer',
              padding: 8,
              borderRadius: 4,
              transition: 'all 0.2s'
            }}
            onMouseOver={e => e.currentTarget.style.color = '#ff4444'}
            onMouseOut={e => e.currentTarget.style.color = 'rgba(255,80,80,0.2)'}
          >
            <Trash2 size={14} />
          </button>
        )}
        {onClick && !onEdit && !onDelete && (
          <ChevronRight size={16} color="rgba(255,255,255,0.15)" />
        )}
      </div>
    </div>
  );
}

