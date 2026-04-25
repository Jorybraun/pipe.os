/**
 * ExplainerPanel — "Ask" tab for the code review right panel.
 *
 * Free-form question input + scrollable Q&A conversation with markdown rendering.
 * No verdict section — verdict belongs to the Review tab.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { useInterview } from '../../contexts/InterviewContext';
import { useExplainerSession } from '../../hooks/useExplainerSession';
import type { ComprehensionExchange } from '../../types/conversation';
import { MermaidBlock } from './MermaidBlock';

// ─── Markdown renderer ─────────────────────────────────────────────────────

function renderMarkdown(content: string): JSX.Element {
  const segments: Array<{ type: 'text' | 'mermaid' | 'code'; content: string; lang?: string }> = [];
  const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', content: content.slice(lastIndex, match.index) });
    }
    const lang = match[1] ?? '';
    if (lang === 'mermaid') {
      segments.push({ type: 'mermaid', content: match[2] ?? '' });
    } else {
      segments.push({ type: 'code', content: match[2] ?? '', lang });
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < content.length) {
    segments.push({ type: 'text', content: content.slice(lastIndex) });
  }

  return (
    <div style={{ lineHeight: 1.6 }}>
      {segments.map((seg, i) => {
        if (seg.type === 'mermaid') {
          return <MermaidBlock key={i} code={seg.content} />;
        }
        if (seg.type === 'code') {
          return (
            <pre
              key={i}
              style={{
                background: 'var(--pipe-surface)',
                border: '1px solid var(--pipe-border)',
                borderRadius: 6,
                padding: 12,
                margin: '8px 0',
                fontSize: 13,
                overflowX: 'auto',
                color: '#e2e8f0',
              }}
            >
              <code>{seg.content}</code>
            </pre>
          );
        }
        return (
          <div key={i} style={{ whiteSpace: 'pre-wrap' }}>
            {seg.content.split('\n').map((line, j) => {
              if (line.startsWith('## ')) {
                return <h3 key={j} style={{ fontSize: 15, fontWeight: 600, margin: '12px 0 4px', color: '#f1f5f9' }}>{line.slice(3)}</h3>;
              }
              if (line.startsWith('**') && line.endsWith('**')) {
                return <p key={j} style={{ fontWeight: 600, margin: '4px 0', color: '#e2e8f0' }}>{line.slice(2, -2)}</p>;
              }
              if (line.trim() === '') return <br key={j} />;
              return <p key={j} style={{ margin: '2px 0', color: '#cbd5e1' }}>{line}</p>;
            })}
          </div>
        );
      })}
    </div>
  );
}

// ─── Exchange display ───────────────────────────────────────────────────────

function ExchangeBlock({ exchange }: { exchange: ComprehensionExchange }): JSX.Element {
  return (
    <div style={{ marginBottom: 24 }}>
      {/* Question */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <div style={{
          width: 24, height: 24, borderRadius: '50%',
          background: '#3b82f6', display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 12, fontWeight: 700, color: 'var(--pipe-text, #fff)', flexShrink: 0, marginTop: 2,
        }}>
          Q
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, color: '#64748b', marginBottom: 2 }}>
            Q{exchange.round}
            {exchange.question.file && (
              <span style={{ color: '#60a5fa' }}> — {exchange.question.file}{exchange.question.line ? `:${exchange.question.line}` : ''}</span>
            )}
          </div>
          <div style={{ color: '#f1f5f9', fontSize: 14 }}>{exchange.question.text}</div>
        </div>
      </div>

      {/* Answer */}
      <div style={{ display: 'flex', gap: 8, marginLeft: 16 }}>
        <div style={{
          width: 24, height: 24, borderRadius: '50%',
          background: '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 12, fontWeight: 700, color: 'var(--pipe-text, #fff)', flexShrink: 0, marginTop: 2,
        }}>
          A
        </div>
        <div style={{ flex: 1, fontSize: 14 }}>
          {renderMarkdown(exchange.answer.content)}
          <div style={{ display: 'flex', gap: 4, marginTop: 8, flexWrap: 'wrap' }}>
            {exchange.answer.context_provided.map((tag) => (
              <span
                key={tag}
                style={{
                  fontSize: 10,
                  padding: '2px 6px',
                  borderRadius: 4,
                  background: 'rgba(96,165,250,0.1)',
                  color: '#60a5fa',
                  border: '1px solid rgba(96,165,250,0.2)',
                }}
              >
                {tag.replace('_', ' ')}
              </span>
            ))}
            <span
              style={{
                fontSize: 10,
                padding: '2px 6px',
                borderRadius: 4,
                background: exchange.answer.depth_level === 'deep' ? 'rgba(16,185,129,0.1)' : 'rgba(255,255,255,0.03)',
                color: exchange.answer.depth_level === 'deep' ? '#10b981' : '#64748b',
                border: `1px solid ${exchange.answer.depth_level === 'deep' ? 'rgba(16,185,129,0.2)' : 'rgba(255,255,255,0.06)'}`,
              }}
            >
              {exchange.answer.depth_level}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main panel ─────────────────────────────────────────────────────────────

export function ExplainerPanel(): JSX.Element {
  const ctx = useInterview();
  const { askQuestion, isLoading, error, exchanges } = useExplainerSession();

  const [questionText, setQuestionText] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const challengeData = ctx.currentChallenge?.data as Record<string, unknown> | undefined;
  const maxQuestions = (challengeData?.maxExplainerQuestions as number) ?? 6;
  const canAskMore = exchanges.length < maxQuestions;

  // Auto-scroll to bottom when new exchanges arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [exchanges]);

  const handleSubmitQuestion = useCallback(async () => {
    if (!questionText.trim() || isLoading) return;

    const text = questionText.trim();
    setQuestionText('');

    try {
      await askQuestion(ctx.currentIndex, text);
    } catch (err) {
      console.error('[ExplainerPanel] ask question failed:', err);
    }
  }, [questionText, isLoading, ctx.currentIndex, askQuestion]);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
    }}>
      {/* Conversation scroll area */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 20,
        }}
      >
        {exchanges.length === 0 && !isLoading && (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: '#475569' }}>
            <div style={{ fontSize: 24, marginBottom: 12 }}>?</div>
            <p style={{ fontSize: 13, lineHeight: 1.6 }}>
              Ask the PR author questions about the architecture,
              design decisions, and trade-offs behind this change.
            </p>
            <p style={{ fontSize: 12, marginTop: 8, color: '#64748b' }}>
              {maxQuestions} questions available
            </p>
          </div>
        )}

        {exchanges.map((ex, i) => (
          <ExchangeBlock key={i} exchange={ex} />
        ))}

        {isLoading && (
          <div style={{
            display: 'flex', gap: 8, marginLeft: 16, alignItems: 'center',
            color: '#64748b', fontSize: 13,
          }}>
            <div style={{
              width: 24, height: 24, borderRadius: '50%',
              background: '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 700, color: 'var(--pipe-text, #fff)',
            }}>
              A
            </div>
            Thinking...
          </div>
        )}
      </div>

      {/* Error display */}
      {error && (
        <div style={{
          padding: '8px 20px',
          background: 'rgba(239,68,68,0.1)',
          borderTop: '1px solid rgba(239,68,68,0.2)',
          color: '#ef4444',
          fontSize: 12,
        }}>
          {error}
        </div>
      )}

      {/* Question input */}
      {canAskMore && (
        <div style={{
          padding: '12px 20px',
          borderTop: '1px solid var(--pipe-border)',
          display: 'flex',
          gap: 8,
        }}>
          <input
            type="text"
            value={questionText}
            onChange={(e) => setQuestionText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmitQuestion();
              }
            }}
            placeholder={exchanges.length === 0 ? 'Ask the PR author a question...' : 'Ask a follow-up question...'}
            disabled={isLoading}
            style={{
              flex: 1,
              padding: '10px 14px',
              borderRadius: 6,
              border: '1px solid var(--pipe-border)',
              background: 'var(--pipe-surface)',
              color: '#e2e8f0',
              fontSize: 13,
              fontFamily: "'Space Mono', monospace",
              outline: 'none',
            }}
          />
          <button
            onClick={handleSubmitQuestion}
            disabled={!questionText.trim() || isLoading}
            style={{
              padding: '10px 16px',
              borderRadius: 6,
              border: 'none',
              background: questionText.trim() ? '#3b82f6' : 'rgba(255,255,255,0.06)',
              color: questionText.trim() ? '#fff' : '#475569',
              cursor: questionText.trim() && !isLoading ? 'pointer' : 'default',
              fontSize: 13,
              fontWeight: 600,
              fontFamily: "'Space Mono', monospace",
            }}
          >
            Ask
          </button>
        </div>
      )}

      {/* Max questions reached */}
      {!canAskMore && (
        <div style={{
          padding: '12px 20px',
          borderTop: '1px solid var(--pipe-border)',
          textAlign: 'center',
          color: '#64748b',
          fontSize: 12,
        }}>
          All {maxQuestions} questions used
        </div>
      )}
    </div>
  );
}
