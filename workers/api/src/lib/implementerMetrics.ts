/**
 * Implementer Metrics — Pure Functions
 *
 * Computes metrics about implementer behavior from review transcripts.
 * All functions are deterministic — no LLM calls, no side effects.
 */

import type { ReviewRound, ImplementerResponse } from '../lib/implementerAgent';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface MoveDistribution {
  comment: number;
  change: number;
  pushback: number;
}

export interface ImplementerMetrics {
  totalResponses: number;
  moveDistribution: MoveDistribution;
  moveRatios: { comment: number; change: number; pushback: number };
  /** % of change moves that include updated_code */
  codeChangeRate: number;
  /** Pushback quality: how many pushbacks include reasoning */
  pushbackQuality: { withReasoning: number; bare: number };
  /** Rate of immediate agreement without any prior pushback in the thread */
  caveRate: number;
  /** Move distribution per round */
  roundProgression: Array<{ round: number; moves: Record<string, number> }>;
}

// ─── Reasoning detection ────────────────────────────────────────────────────

const REASONING_PATTERNS = [
  /because/i,
  /since/i,
  /the reason/i,
  /i think/i,
  /i believe/i,
  /in my experience/i,
  /actually/i,
  /however/i,
  /but /i,
  /though/i,
  /considered/i,
  /approach/i,
  /designed/i,
  /intentional/i,
];

function hasReasoning(content: string): boolean {
  return REASONING_PATTERNS.some((p) => p.test(content));
}

// ─── Main computation ───────────────────────────────────────────────────────

/**
 * Computes implementer metrics from review rounds.
 * Pure function — fully deterministic.
 */
export function computeImplementerMetrics(rounds: ReviewRound[]): ImplementerMetrics {
  const allResponses: ImplementerResponse[] = [];
  const distribution: MoveDistribution = { comment: 0, change: 0, pushback: 0 };
  let withCode = 0;
  let totalChangeMoves = 0;
  let pushbackWithReasoning = 0;
  let pushbackBare = 0;
  let caves = 0;
  let totalFirstExchanges = 0;

  // Track which comment IDs have had prior pushback
  const commentPushbackHistory = new Set<number>();

  const roundProgression: Array<{ round: number; moves: Record<string, number> }> = [];

  for (const round of rounds) {
    const roundMoves: Record<string, number> = {};

    for (const resp of round.implementer_responses) {
      allResponses.push(resp);

      // Count moves
      const move = resp.move;
      if (move === 'comment' || move === 'change' || move === 'pushback') {
        distribution[move]++;
        roundMoves[move] = (roundMoves[move] ?? 0) + 1;
      }

      // Code change tracking
      if (move === 'change') {
        totalChangeMoves++;
        if (typeof resp.updated_code === 'string' && resp.updated_code.trim() !== '') {
          withCode++;
        }
      }

      // Pushback quality
      if (move === 'pushback') {
        if (hasReasoning(resp.content)) {
          pushbackWithReasoning++;
        } else {
          pushbackBare++;
        }
        commentPushbackHistory.add(resp.to_comment_id);
      }

      // Cave detection: move=change on first exchange for this comment,
      // without any prior pushback from the implementer on this thread
      if (move === 'change' && round.round === 1 && !commentPushbackHistory.has(resp.to_comment_id)) {
        caves++;
        totalFirstExchanges++;
      } else if (round.round === 1) {
        totalFirstExchanges++;
      }
    }

    roundProgression.push({ round: round.round, moves: roundMoves });
  }

  const total = allResponses.length;
  const ratio = (n: number): number => (total > 0 ? Math.round((n / total) * 100) / 100 : 0);

  return {
    totalResponses: total,
    moveDistribution: distribution,
    moveRatios: {
      comment: ratio(distribution.comment),
      change: ratio(distribution.change),
      pushback: ratio(distribution.pushback),
    },
    codeChangeRate: totalChangeMoves > 0 ? Math.round((withCode / totalChangeMoves) * 100) / 100 : 0,
    pushbackQuality: { withReasoning: pushbackWithReasoning, bare: pushbackBare },
    caveRate: totalFirstExchanges > 0 ? Math.round((caves / totalFirstExchanges) * 100) / 100 : 0,
    roundProgression,
  };
}
