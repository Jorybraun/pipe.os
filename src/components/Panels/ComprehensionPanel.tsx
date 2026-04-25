/**
 * ComprehensionPanel — question-first conversation UI for blind comprehension review.
 *
 * Displays a free-form question input, scrollable Q&A conversation with markdown
 * rendering (including mermaid diagrams), and a verdict section at the bottom.
 *
 * Registered as 'comprehension-conversation' in COMPONENT_MAP.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { useInterview } from '../../contexts/InterviewContext';
import { useComprehensionSession } from '../../hooks/useComprehensionSession';
import type { ComprehensionExchange, ComprehensionVerdict } from '../../types/conversation';

// ─── Verdict options ────────────────────────────────────────────────────────

const VERDICT_OPTIONS: Array<{ value: ComprehensionVerdict; label: string; description: string }> = [
  { value: 'approve', label: 'Approve', description: 'The approach is sound and well-implemented' },
  { value: 'request_changes', label: 'Request Changes', description: 'There are issues that need to be addressed' },
  { value: 'needs_more_context', label: 'Needs More Context', description: 'Cannot make a decision with available information' },
];

// ─── Markdown renderer (simple) ─────────────────────────────────────────────

function renderMarkdown(content: string): JSX.Element {
  // Split content into segments: regular text and mermaid blocks
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
          return (
            <div
              key={i}
              style={{
                background: 'var(--pipe-surface)',
                border: '1px solid var(--pipe-border)',
                borderRadius: 8,
                padding: 16,
                margin: '12px 0',
                fontFamily: 'monospace',
                fontSize: 12,
                whiteSpace: 'pre-wrap',
                color: '#94a3b8',
              }}
            >
              <div style={{ fontSize: 10, color: '#64748b', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>
                mermaid diagram
              </div>
              {seg.content}
            </div>
          );
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
        // Text — basic markdown-like rendering
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

export function ComprehensionConversationPanel(): JSX.Element {
  const ctx = useInterview();
  const {
    submitQuestion,
    submitFollowUp,
    submitVerdict,
    isLoading,
    error,
    exchanges,
    currentQuestion,
    sessionId,
  } = useComprehensionSession();

  const [questionText, setQuestionText] = useState('');
  const [selectedVerdict, setSelectedVerdict] = useState<ComprehensionVerdict | null>(null);
  const [rationale, setRationale] = useState('');
  const [verdictSubmitted, setVerdictSubmitted] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const maxQuestions = (ctx.submission.maxQuestions as number) ?? 6;

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
      if (!sessionId) {
        await submitQuestion(ctx.currentIndex, text);
      } else {
        await submitFollowUp(text);
      }
    } catch (err) {
      console.error('[ComprehensionPanel] submit question failed:', err);
    }
  }, [questionText, isLoading, sessionId, ctx.currentIndex, submitQuestion, submitFollowUp]);

  const handleSubmitVerdict = useCallback(async () => {
    if (!selectedVerdict || rationale.trim().length < 100 || isLoading) return;

    try {
      await submitVerdict(selectedVerdict, rationale.trim());
      setVerdictSubmitted(true);
      ctx.submit();
    } catch (err) {
      console.error('[ComprehensionPanel] submit verdict failed:', err);
    }
  }, [selectedVerdict, rationale, isLoading, submitVerdict, ctx]);

  const canAskMore = currentQuestion < maxQuestions && !verdictSubmitted;
  const canSubmitVerdict = exchanges.length > 0 && !verdictSubmitted;

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      background: 'rgba(12,12,14,0.95)',
      borderLeft: '1px solid rgba(255,255,255,0.06)',
    }}>
      {/* Header */}
      <div style={{
        padding: '16px 20px',
        borderBottom: '1px solid var(--pipe-border)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: '#f1f5f9', fontFamily: "'Space Mono', monospace" }}>
            Comprehension Review
          </h3>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: '#64748b' }}>
            Ask questions to understand this PR
          </p>
        </div>
        <div style={{
          fontSize: 12,
          color: '#64748b',
          fontFamily: "'Space Mono', monospace",
        }}>
          {currentQuestion}/{maxQuestions}
        </div>
      </div>

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
              You can only see the diff. Ask the PR author questions to understand
              the architecture, design decisions, and trade-offs.
            </p>
            <p style={{ fontSize: 12, marginTop: 8 }}>
              Your questions and final verdict will be evaluated.
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

      {/* Verdict section (shown after at least 1 exchange) */}
      {canSubmitVerdict && (
        <div style={{
          padding: '16px 20px',
          borderTop: '1px solid var(--pipe-border)',
          background: 'var(--pipe-surface)',
        }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>
            Verdict
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            {VERDICT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setSelectedVerdict(opt.value)}
                disabled={verdictSubmitted}
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  borderRadius: 6,
                  border: `1px solid ${selectedVerdict === opt.value ? '#3b82f6' : 'rgba(255,255,255,0.1)'}`,
                  background: selectedVerdict === opt.value ? 'rgba(59,130,246,0.1)' : 'transparent',
                  color: selectedVerdict === opt.value ? '#60a5fa' : '#94a3b8',
                  cursor: verdictSubmitted ? 'default' : 'pointer',
                  fontSize: 12,
                  fontFamily: "'Space Mono', monospace",
                  textAlign: 'center',
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {selectedVerdict && (
            <>
              <textarea
                value={rationale}
                onChange={(e) => setRationale(e.target.value)}
                placeholder="Write your rationale: what the PR does, why it exists, trade-offs, and your reasoning..."
                disabled={verdictSubmitted}
                style={{
                  width: '100%',
                  minHeight: 100,
                  padding: 12,
                  borderRadius: 6,
                  border: '1px solid var(--pipe-border)',
                  background: 'var(--pipe-surface)',
                  color: '#e2e8f0',
                  fontSize: 13,
                  fontFamily: "'Space Mono', monospace",
                  resize: 'vertical',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                <span style={{ fontSize: 11, color: rationale.trim().length >= 100 ? '#64748b' : '#ef4444' }}>
                  {rationale.trim().length}/100 min characters
                </span>
                <button
                  onClick={handleSubmitVerdict}
                  disabled={rationale.trim().length < 100 || isLoading || verdictSubmitted}
                  style={{
                    padding: '8px 20px',
                    borderRadius: 6,
                    border: 'none',
                    background: rationale.trim().length >= 100 ? '#3b82f6' : 'rgba(255,255,255,0.06)',
                    color: rationale.trim().length >= 100 ? '#fff' : '#475569',
                    cursor: rationale.trim().length >= 100 && !isLoading ? 'pointer' : 'default',
                    fontSize: 13,
                    fontWeight: 600,
                    fontFamily: "'Space Mono', monospace",
                  }}
                >
                  Submit Verdict
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Question input (shown when can ask more) */}
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
    </div>
  );
}
