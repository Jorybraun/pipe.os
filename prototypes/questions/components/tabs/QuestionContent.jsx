import React from 'react';
import { Video } from 'lucide-react';
import { LiquidMetalCard } from '../ui/LiquidMetalCard';
import { SubTitle } from '../ui/SubTitle';
import { ButtonGroup } from '../ui/ButtonGroup';
import { NumberInput } from '../ui/NumberInput';
import { Toggle } from '../ui/Toggle';

/**
 * Question tab content - stateless presentation component.
 */
export function QuestionContent({
  questionText,
  questionType,
  timeLimit,
  isRequired,
  hasVideo,
  videoDuration,
  onQuestionTextChange,
  onQuestionTypeChange,
  onTimeLimitChange,
  onIsRequiredChange,
  onEditVideo,
}) {
  const typeOptions = ['technical', 'behavioral', 'motivation', 'situational'];

  return (
    <div>
      <SubTitle>QUESTION_CONTENT</SubTitle>

      {/* Question text */}
      <LiquidMetalCard variant="mercury" style={{ padding: 24, marginTop: 16, marginBottom: 24 }}>
        <div style={{ fontSize: 8, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', marginBottom: 12 }}>
          QUESTION TEXT
        </div>
        <textarea
          value={questionText}
          onChange={(e) => onQuestionTextChange(e.target.value)}
          style={{
            width: '100%',
            height: 120,
            background: 'rgba(0,0,0,0.2)',
            border: '1px solid rgba(255,255,255,0.1)',
            color: '#fff',
            fontSize: 15,
            lineHeight: 1.7,
            padding: 16,
            resize: 'none',
            outline: 'none',
            fontFamily: '"Space Mono", monospace',
          }}
        />
      </LiquidMetalCard>

      {/* Question settings */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Type */}
        <LiquidMetalCard variant="default" style={{ padding: 20 }}>
          <div style={{ fontSize: 8, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', marginBottom: 12 }}>
            QUESTION TYPE
          </div>
          <ButtonGroup
            options={typeOptions}
            value={questionType}
            onChange={onQuestionTypeChange}
          />
        </LiquidMetalCard>

        {/* Time limit */}
        <LiquidMetalCard variant="default" style={{ padding: 20 }}>
          <div style={{ fontSize: 8, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', marginBottom: 12 }}>
            RESPONSE TIME LIMIT
          </div>
          <NumberInput
            value={timeLimit}
            onChange={onTimeLimitChange}
            min={1}
            max={10}
            step={1}
            unit="MIN"
          />
        </LiquidMetalCard>

        {/* Required toggle */}
        <LiquidMetalCard variant="default" style={{ padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 8, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', marginBottom: 4 }}>
                REQUIRED
              </div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>
                Candidates must answer this question
              </div>
            </div>
            <Toggle value={isRequired} onChange={onIsRequiredChange} />
          </div>
        </LiquidMetalCard>

        {/* Video status */}
        <LiquidMetalCard variant={hasVideo ? 'mercury' : 'default'} style={{ padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {hasVideo ? (
                <div style={{ width: 8, height: 8, background: 'rgba(150,255,150,0.8)', boxShadow: '0 0 6px rgba(150,255,150,0.5)' }} />
              ) : (
                <div style={{ width: 8, height: 8, background: 'rgba(255,200,100,0.6)' }} />
              )}
              <div>
                <div style={{ fontSize: 8, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.3)', marginBottom: 4 }}>
                  VIDEO
                </div>
                <div style={{ fontSize: 11, color: hasVideo ? 'rgba(150,255,150,0.8)' : 'rgba(255,200,100,0.8)' }}>
                  {hasVideo ? `Recorded · ${Math.floor(videoDuration / 60)}:${(videoDuration % 60).toString().padStart(2, '0')}` : 'No video recorded'}
                </div>
              </div>
            </div>
            <button
              onClick={onEditVideo}
              style={{
                padding: '8px 14px',
                background: 'rgba(255,255,255,0.1)',
                border: '1px solid rgba(255,255,255,0.15)',
                color: '#fff',
                fontSize: 9,
                letterSpacing: '0.1em',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <Video size={12} />
              {hasVideo ? 'EDIT' : 'RECORD'}
            </button>
          </div>
        </LiquidMetalCard>
      </div>
    </div>
  );
}
