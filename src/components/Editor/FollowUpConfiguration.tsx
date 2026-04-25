import { ChevronDown } from 'lucide-react';
import { Toggle } from '../ui/Toggle';

export interface FollowUpConfigurationProps {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  /** Optional theme color for accents (default is blue) */
  accentColor?: string;
  /** Optional description override */
  description?: string;
}

/**
 * Reusable AI Follow-up configuration component.
 * Displays a toggle and descriptive information about AI follow-up generation.
 */
export function FollowUpConfiguration({
  enabled,
  onChange,
  accentColor = '#60a5fa',
  description,
}: FollowUpConfigurationProps): JSX.Element {
  const defaultDesc = enabled
    ? 'AI will analyze candidate submissions in real-time to generate probing follow-up questions focused on depth, reasoning, and edge cases.'
    : 'Enable to automatically ask follow-up questions after submission. This increases assessment depth and reduces cheating.';

  const displayDesc = description || defaultDesc;

  return (
    <div style={{ 
      background: `${accentColor}0D`, // 5% opacity
      border: `1px solid ${accentColor}33`, // 20% opacity
      padding: 24, 
      borderRadius: 4 
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ 
            width: 32, 
            height: 32, 
            borderRadius: 6, 
            background: `${accentColor}26`, // 15% opacity
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            color: accentColor
          }}>
            <ChevronDown size={16} />
          </div>
          <span style={{ 
            fontSize: 11, 
            fontWeight: 800, 
            color: enabled ? accentColor : 'rgba(255,255,255,0.4)', 
            letterSpacing: '0.1em',
            fontFamily: 'Space Mono'
          }}>
            {enabled ? 'AI_FOLLOW_UP_ACTIVE' : 'ENABLE_FOLLOW_UP'}
          </span>
        </div>
        <Toggle 
          checked={enabled} 
          onChange={onChange} 
          ariaLabel="Enable AI follow-up" 
        />
      </div>

      <div style={{ 
        fontSize: 10, 
        color: enabled ? `${accentColor}AA` : 'rgba(255,255,255,0.3)', 
        lineHeight: 1.7, 
        fontFamily: 'Space Mono',
        maxWidth: 280
      }}>
        {displayDesc}
      </div>

      {enabled && (
        <div style={{ marginTop: 20, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {['WHY', 'DEPTH', 'REASONING', 'FIX'].map((tag) => (
            <span key={tag} style={{
              fontSize: 8,
              fontWeight: 800,
              fontFamily: 'Space Mono',
              padding: '4px 8px',
              borderRadius: 4,
              background: `${accentColor}1A`,
              border: `1px solid ${accentColor}33`,
              color: accentColor,
              letterSpacing: '0.05em',
            }}>
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
