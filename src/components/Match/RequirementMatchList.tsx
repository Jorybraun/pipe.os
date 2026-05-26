/**
 * RequirementMatchList — replaces MatchSnapshot in CandidateOverviewTab.
 *
 * Shows overall score ring + expandable requirement cards + dealbreaker alerts.
 */

import { useState } from 'react';
import { TrendingUp } from 'lucide-react';
import { LiquidMetalCard, SubTitle } from '../';
import { MetalScoreRing } from '../MetalScoreRing';
import type { RequirementMatch, DealbreakerFailure } from '../../lib/api/types';
import { RequirementMatchCard } from './RequirementMatchCard';
import { DealbreakerAlert } from './DealbreakerAlert';

interface RequirementMatchListProps {
  overallScore: number;
  requirementMatches: RequirementMatch[];
  dealbreakerFailures: DealbreakerFailure[];
}

export function RequirementMatchList({
  overallScore,
  requirementMatches,
  dealbreakerFailures,
}: RequirementMatchListProps): JSX.Element {
  const [expandedIds] = useState<Set<string>>(() => {
    // Auto-expand the top 2 highest-scoring requirements
    const sorted = [...requirementMatches].sort((a, b) => b.score - a.score);
    return new Set(sorted.slice(0, 2).map((r) => r.requirementId));
  });

  const totalEvidence = requirementMatches.reduce(
    (sum, r) => sum + r.evidence.length,
    0,
  );

  const matchedCount = requirementMatches.filter((r) => r.score >= 0.4).length;

  const scoreColor =
    overallScore >= 0.7 ? '#10b981' : overallScore >= 0.4 ? '#fbbf24' : '#f87171';

  return (
    <LiquidMetalCard
      variant="default"
      style={{
        padding: 28,
        borderRadius: 16,
        border: `1px solid ${scoreColor}26`,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 20,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <TrendingUp size={14} color={scoreColor} />
          <SubTitle>MATCH ANALYSIS</SubTitle>
        </div>
      </div>

      {/* Score ring + summary */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 20,
          marginBottom: 24,
          flexWrap: 'wrap',
        }}
      >
        <MetalScoreRing
          value={Math.round(overallScore * 100)}
          size={100}
          label="OVERALL"
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: 'var(--pipe-text, #fff)',
              fontFamily: '"Space Mono", monospace',
            }}
          >
            Matched {matchedCount}/{requirementMatches.length} requirements
          </span>
          <span
            style={{
              fontSize: 10,
              color: 'var(--pipe-text-dim)',
              fontFamily: '"Space Mono", monospace',
            }}
          >
            {totalEvidence} evidence node{totalEvidence !== 1 ? 's' : ''} total
          </span>
          {dealbreakerFailures.length > 0 && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: '#f87171',
                fontFamily: '"Space Mono", monospace',
              }}
            >
              ⚠️ {dealbreakerFailures.length} dealbreaker
              {dealbreakerFailures.length !== 1 ? 's' : ''} flagged
            </span>
          )}
        </div>
      </div>

      {/* Requirement cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {requirementMatches.map((req) => (
          <RequirementMatchCard
            key={req.requirementId}
            requirementText={req.requirementText}
            score={req.score}
            weight={req.weight}
            matchCount={req.matchCount}
            evidence={req.evidence}
            isExpanded={expandedIds.has(req.requirementId)}
          />
        ))}
      </div>

      {/* Dealbreaker alerts */}
      {dealbreakerFailures.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
          {dealbreakerFailures.map((failure) => (
            <DealbreakerAlert key={failure.dealbreakerId} failure={failure} />
          ))}
        </div>
      )}
    </LiquidMetalCard>
  );
}
