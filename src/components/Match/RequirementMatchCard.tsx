/**
 * RequirementMatchCard — expandable card showing a single requirement
 * with its score, weight, and supporting evidence nodes.
 */

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { EvidenceNode } from '../../lib/api/types';
import { EvidenceNodeBadge } from './EvidenceNodeBadge';

interface RequirementMatchCardProps {
  requirementText: string;
  score: number;
  weight: number;
  matchCount: number;
  evidence: EvidenceNode[];
  isExpanded?: boolean;
}

function getScoreColor(score: number): string {
  if (score >= 0.7) return '#10b981';
  if (score >= 0.4) return '#fbbf24';
  return '#f87171';
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

function EvidenceRow({ node, isLast }: { node: EvidenceNode; isLast: boolean }): JSX.Element {
  const connectorColor = 'rgba(255,255,255,0.08)';

  return (
    <div style={{ display: 'flex', gap: 8 }}>
      {/* Tree connector */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: getScoreColor(node.similarity),
            marginTop: 4,
          }}
        />
        {!isLast && (
          <div style={{ width: 1, flex: 1, background: connectorColor, marginTop: 4 }} />
        )}
      </div>

      {/* Content */}
      <div style={{ flex: 1, paddingBottom: isLast ? 0 : 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
          <EvidenceNodeBadge sourceType={node.sourceType} nodeType={node.nodeType} />
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: getScoreColor(node.similarity),
              fontFamily: '"Space Mono", monospace',
            }}
          >
            {node.similarity.toFixed(2)} sim
          </span>
          {node.barsScore != null && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: '#fbbf24',
                fontFamily: '"Space Mono", monospace',
              }}
            >
              BARS: {node.barsScore.toFixed(1)}
            </span>
          )}
        </div>

        <div
          style={{
            fontSize: 12,
            color: 'var(--pipe-text-muted)',
            lineHeight: 1.5,
            marginBottom: 4,
          }}
        >
          "{node.narrative}"
        </div>

        <div
          style={{
            fontSize: 9,
            color: 'var(--pipe-text-dim)',
            fontFamily: '"Space Mono", monospace',
            letterSpacing: '0.04em',
          }}
        >
          from {node.sourceType.replace(/_/g, ' ')} · captured {formatDate(node.capturedAt)}
        </div>
      </div>
    </div>
  );
}

export function RequirementMatchCard({
  requirementText,
  score,
  weight,
  matchCount,
  evidence,
  isExpanded: initialExpanded = false,
}: RequirementMatchCardProps): JSX.Element {
  const [isExpanded, setIsExpanded] = useState(initialExpanded);
  const scoreColor = getScoreColor(score);
  const hasEvidence = evidence.length > 0;

  return (
    <div
      style={{
        borderRadius: 8,
        border: '1px solid var(--pipe-border-light, rgba(255,255,255,0.06))',
        background: 'rgba(255,255,255,0.02)',
        overflow: 'hidden',
      }}
    >
      {/* Header — clickable to expand */}
      <button
        onClick={() => setIsExpanded((v) => !v)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '14px 16px',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        {isExpanded ? (
          <ChevronDown size={14} color="var(--pipe-text-dim)" />
        ) : (
          <ChevronRight size={14} color="var(--pipe-text-dim)" />
        )}

        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: 'var(--pipe-text, #fff)',
              lineHeight: 1.4,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {requirementText}
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              marginTop: 4,
            }}
          >
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: scoreColor,
                fontFamily: '"Space Mono", monospace',
              }}
            >
              {Math.round(score * 100)}% match
            </span>
            <span
              style={{
                fontSize: 9,
                color: 'var(--pipe-text-dim)',
                fontFamily: '"Space Mono", monospace',
              }}
            >
              weight: {weight.toFixed(2)}
            </span>
            <span
              style={{
                fontSize: 9,
                color: 'var(--pipe-text-dim)',
                fontFamily: '"Space Mono", monospace',
              }}
            >
              {matchCount} node{matchCount !== 1 ? 's' : ''}
            </span>
          </div>
        </div>

        {/* Mini score bar */}
        <div style={{ width: 60, flexShrink: 0 }}>
          <div
            style={{
              height: 4,
              background: 'rgba(255,255,255,0.06)',
              borderRadius: 2,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${Math.min(100, Math.max(0, score * 100))}%`,
                height: '100%',
                background: scoreColor,
                borderRadius: 2,
                transition: 'width 0.4s ease',
              }}
            />
          </div>
        </div>
      </button>

      {/* Evidence list */}
      {isExpanded && (
        <div style={{ padding: '0 16px 16px 44px' }}>
          {hasEvidence ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              <div
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: '0.1em',
                  color: 'var(--pipe-text-dim)',
                  fontFamily: '"Space Mono", monospace',
                  textTransform: 'uppercase',
                  marginBottom: 10,
                }}
              >
                Evidence ({evidence.length} node{evidence.length !== 1 ? 's' : ''})
              </div>
              {evidence.map((node, i) => (
                <EvidenceRow key={node.nodeId} node={node} isLast={i === evidence.length - 1} />
              ))}
            </div>
          ) : (
            <div
              style={{
                fontSize: 11,
                fontStyle: 'italic',
                color: 'var(--pipe-text-dim)',
              }}
            >
              No evidence nodes matched for this requirement.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
