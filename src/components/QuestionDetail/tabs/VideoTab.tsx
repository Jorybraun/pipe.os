import type { Question } from '../../../types/question';
import { SubTitle } from '../../ui/SubTitle';
import { LiquidMetalCard } from '../../ui/LiquidMetalCard';

/**
 * Props for the VideoTab component.
 */
export interface VideoTabProps {
  /**
   * Question data containing video information.
   */
  question: Question;
}

/**
 * Video tab - displays video recording status and duration.
 *
 * Display-only component showing whether a video has been recorded
 * and its duration if available.
 */
export function VideoTab({ question }: VideoTabProps): JSX.Element {
  const formatDuration = (seconds?: number): string => {
    if (!seconds) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div>
      <SubTitle>VIDEO_RECORDING</SubTitle>

      <LiquidMetalCard variant="default" style={{ padding: 32, marginTop: 16, textAlign: 'center' }}>
        {question.hasVideo ? (
          <div>
            <div style={{ fontSize: 48, fontWeight: 800, color: 'rgba(150,255,150,0.8)', marginBottom: 16 }}>
              {formatDuration(question.videoDuration)}
            </div>
            <div style={{ fontSize: 12, color: 'var(--pipe-text-muted)', marginBottom: 24 }}>
              Video recorded successfully
            </div>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
              <button
                type="button"
                style={{
                  padding: '12px 24px',
                  background: 'var(--pipe-surface-hover)',
                  border: '1px solid var(--pipe-border)',
                  color: 'var(--pipe-text, #fff)',
                  fontSize: 10,
                  letterSpacing: '0.1em',
                  cursor: 'pointer',
                }}
              >
                PLAY
              </button>
              <button
                type="button"
                style={{
                  padding: '12px 24px',
                  background: 'var(--pipe-surface)',
                  border: '1px solid var(--pipe-border)',
                  color: 'var(--pipe-text-muted)',
                  fontSize: 10,
                  letterSpacing: '0.1em',
                  cursor: 'pointer',
                }}
              >
                RE-RECORD
              </button>
            </div>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 14, color: 'rgba(255,200,100,0.8)', marginBottom: 16 }}>
              No video recorded
            </div>
            <button
              type="button"
              style={{
                padding: '12px 24px',
                background: 'var(--pipe-surface-hover)',
                border: '1px solid var(--pipe-border)',
                color: 'var(--pipe-text, #fff)',
                fontSize: 10,
                letterSpacing: '0.1em',
                cursor: 'pointer',
              }}
            >
              RECORD VIDEO
            </button>
          </div>
        )}
      </LiquidMetalCard>
    </div>
  );
}
