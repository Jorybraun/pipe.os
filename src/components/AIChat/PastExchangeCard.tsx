import { useState } from 'react';
import type { JSX } from 'react';
import { Flag, ChevronDown, Bot } from 'lucide-react';
import type { PastExchange } from './types';

// ─── PastExchangeCard ────────────────────────────────────────────────────────

export function PastExchangeCard({ exchange, index, onFeedback }: {
  exchange: PastExchange;
  index: number;
  onFeedback?: (questionId: string, feedback: string) => void;
}): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackText, setFeedbackText] = useState(exchange.feedback ?? '');
  const [badBotSent, setBadBotSent] = useState(false);

  const hasFeedback = !!(exchange.feedback || feedbackText.trim());

  const handleBadBot = (e: React.MouseEvent): void => {
    e.stopPropagation();
    if (onFeedback && !badBotSent) {
      onFeedback(exchange.questionId, '[BAD_ROBOT] User flagged this question as bad');
      setBadBotSent(true);
    }
  };

  const handleFlagClick = (e: React.MouseEvent): void => {
    e.stopPropagation();
    setShowFeedback(!showFeedback);
    if (!expanded) setExpanded(true);
  };

  const handleSubmitFeedback = (e: React.MouseEvent): void => {
    e.stopPropagation();
    if (feedbackText.trim() && onFeedback) {
      onFeedback(exchange.questionId, feedbackText.trim());
      setShowFeedback(false);
    }
  };

  return (
    <div
      onClick={() => setExpanded(!expanded)}
      style={{
        padding: expanded ? '16px 20px' : '10px 20px',
        background: 'var(--pipe-surface)',
        borderLeft: `2px solid ${hasFeedback ? 'rgba(251, 191, 36, 0.4)' : 'rgba(139, 92, 246, 0.2)'}`,
        cursor: 'pointer',
        transition: 'all 0.3s ease',
        marginBottom: 2,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <span style={{
            fontSize: 8, letterSpacing: '0.15em',
            color: 'rgba(139, 92, 246, 0.5)',
            fontFamily: '"Space Mono", monospace', flexShrink: 0,
          }}>
            Q{index + 1}
          </span>
          <span style={{
            fontSize: 11, color: 'var(--pipe-text-dim)',
            overflow: 'hidden', textOverflow: 'ellipsis',
            whiteSpace: expanded ? 'normal' : 'nowrap',
            fontFamily: '"Space Mono", monospace',
          }}>
            {exchange.questionText}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {onFeedback && (
            <>
              <div
                onClick={handleBadBot}
                title={badBotSent ? 'Reported — thanks' : 'Bad question? Report it'}
                style={{ padding: 4, cursor: badBotSent ? 'default' : 'pointer', opacity: badBotSent ? 1 : 0.3, transition: 'opacity 0.2s ease' }}
                onMouseOver={(e) => { if (!badBotSent) e.currentTarget.style.opacity = '1'; }}
                onMouseOut={(e) => { if (!badBotSent) e.currentTarget.style.opacity = '0.3'; }}
              >
                <Bot size={11} color={badBotSent ? 'rgba(248, 113, 113, 0.9)' : 'var(--pipe-text-muted)'} />
              </div>
              <div
                onClick={handleFlagClick}
                title={hasFeedback ? 'Flagged — click to edit' : 'Flag this question'}
                style={{ padding: 4, cursor: 'pointer', opacity: hasFeedback ? 1 : 0.3, transition: 'opacity 0.2s ease' }}
                onMouseOver={(e) => { e.currentTarget.style.opacity = '1'; }}
                onMouseOut={(e) => { e.currentTarget.style.opacity = hasFeedback ? '1' : '0.3'; }}
              >
                <Flag size={11} color={hasFeedback ? 'rgba(251, 191, 36, 0.9)' : 'var(--pipe-text-muted)'} />
              </div>
            </>
          )}
          <ChevronDown
            size={12}
            style={{
              color: 'var(--pipe-text-dim)',
              transform: expanded ? 'rotate(180deg)' : 'rotate(0)',
              transition: 'transform 0.2s ease',
            }}
          />
        </div>
      </div>

      {expanded && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 10, color: 'var(--pipe-text-dim)', marginBottom: 6, letterSpacing: '0.1em', fontFamily: '"Space Mono", monospace' }}>
            YOUR ANSWER
          </div>
          <div style={{ fontSize: 11, color: 'var(--pipe-text-muted)', lineHeight: 1.6, fontFamily: '"Space Mono", monospace' }}>
            {exchange.answer}
          </div>

          {showFeedback && (
            <div
              onClick={(e) => e.stopPropagation()}
              style={{ marginTop: 12, borderTop: '1px solid rgba(251, 191, 36, 0.15)', paddingTop: 12 }}
            >
              <div style={{ fontSize: 10, color: 'rgba(251, 191, 36, 0.6)', marginBottom: 6, letterSpacing: '0.1em', fontFamily: '"Space Mono", monospace' }}>
                FLAG_QUESTION
              </div>
              <textarea
                value={feedbackText}
                onChange={(e) => setFeedbackText(e.target.value)}
                placeholder="What's wrong with this question? Too vague, leading, irrelevant..."
                style={{ width: '100%', minHeight: 48, padding: '10px 12px', background: 'rgba(251, 191, 36, 0.04)', border: '1px solid rgba(251, 191, 36, 0.15)', color: 'var(--pipe-text-muted)', fontSize: 11, fontFamily: '"Space Mono", monospace', resize: 'vertical', outline: 'none' }}
              />
              <button
                onClick={handleSubmitFeedback}
                disabled={!feedbackText.trim()}
                style={{ marginTop: 8, padding: '6px 16px', background: feedbackText.trim() ? 'rgba(251, 191, 36, 0.1)' : 'transparent', border: `1px solid ${feedbackText.trim() ? 'rgba(251, 191, 36, 0.3)' : 'var(--pipe-border-light)'}`, color: feedbackText.trim() ? 'rgba(251, 191, 36, 0.9)' : 'var(--pipe-text-dim)', fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', fontFamily: '"Space Mono", monospace', cursor: feedbackText.trim() ? 'pointer' : 'default' }}
              >
                SAVE_FLAG
              </button>
            </div>
          )}

          {!showFeedback && hasFeedback && (
            <div style={{ marginTop: 10, padding: '8px 12px', background: 'rgba(251, 191, 36, 0.04)', borderLeft: '2px solid rgba(251, 191, 36, 0.3)', fontSize: 10, color: 'rgba(251, 191, 36, 0.6)', fontFamily: '"Space Mono", monospace' }}>
              {exchange.feedback || feedbackText}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
