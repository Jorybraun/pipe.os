import { describe, it, expect } from 'vitest';
import { computeImplementerMetrics } from '../lib/implementerMetrics';
import type { ReviewRound } from '../lib/implementerAgent';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeComment(id: number) {
  return { id, what: `Comment ${id}`, why: '', category: null as string | null, severity: null as string | null, positive: false };
}

function makeResponse(toId: number, move: 'comment' | 'change' | 'pushback', content: string, updatedCode?: string) {
  return {
    to_comment_id: toId,
    move,
    content,
    ...(updatedCode !== undefined ? { updated_code: updatedCode } : {}),
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('computeImplementerMetrics', () => {
  it('computes correct distribution for all-change transcript', () => {
    const rounds: ReviewRound[] = [
      {
        round: 1,
        reviewer_comments: [makeComment(1), makeComment(2), makeComment(3)],
        implementer_responses: [
          makeResponse(1, 'change', 'Fixed!', 'const x = 1;'),
          makeResponse(2, 'change', 'Done!', 'const y = 2;'),
          makeResponse(3, 'change', 'Updated.', 'const z = 3;'),
        ],
      },
    ];

    const metrics = computeImplementerMetrics(rounds);
    expect(metrics.totalResponses).toBe(3);
    expect(metrics.moveDistribution).toEqual({ comment: 0, change: 3, pushback: 0 });
    expect(metrics.moveRatios.change).toBe(1);
  });

  it('computes correct ratios for mixed moves', () => {
    const rounds: ReviewRound[] = [
      {
        round: 1,
        reviewer_comments: [makeComment(1), makeComment(2), makeComment(3), makeComment(4), makeComment(5), makeComment(6)],
        implementer_responses: [
          makeResponse(1, 'change', 'Fixed!', 'code'),
          makeResponse(2, 'change', 'Done!', 'code'),
          makeResponse(3, 'change', 'Updated.', 'code'),
          makeResponse(4, 'pushback', 'I considered that, because...'),
          makeResponse(5, 'pushback', 'No.'),
          makeResponse(6, 'comment', 'Can you clarify?'),
        ],
      },
    ];

    const metrics = computeImplementerMetrics(rounds);
    expect(metrics.totalResponses).toBe(6);
    expect(metrics.moveRatios.change).toBeCloseTo(0.5, 2);
    expect(metrics.moveRatios.pushback).toBeCloseTo(0.33, 2);
    expect(metrics.moveRatios.comment).toBeCloseTo(0.17, 2);
  });

  it('returns zeros for empty transcript', () => {
    const metrics = computeImplementerMetrics([]);
    expect(metrics.totalResponses).toBe(0);
    expect(metrics.moveDistribution).toEqual({ comment: 0, change: 0, pushback: 0 });
    expect(metrics.codeChangeRate).toBe(0);
    expect(metrics.caveRate).toBe(0);
  });

  it('computes codeChangeRate = 1.0 when all changes have updated_code', () => {
    const rounds: ReviewRound[] = [
      {
        round: 1,
        reviewer_comments: [makeComment(1), makeComment(2)],
        implementer_responses: [
          makeResponse(1, 'change', 'Fixed!', 'const a = 1;'),
          makeResponse(2, 'change', 'Done!', 'const b = 2;'),
        ],
      },
    ];

    expect(computeImplementerMetrics(rounds).codeChangeRate).toBe(1);
  });

  it('computes codeChangeRate = 0.5 when half have updated_code', () => {
    const rounds: ReviewRound[] = [
      {
        round: 1,
        reviewer_comments: [makeComment(1), makeComment(2), makeComment(3), makeComment(4)],
        implementer_responses: [
          makeResponse(1, 'change', 'Fixed!', 'code'),
          makeResponse(2, 'change', 'I\'ll fix it.'),
          makeResponse(3, 'change', 'Updated!', 'more code'),
          makeResponse(4, 'change', 'Will do.'),
        ],
      },
    ];

    expect(computeImplementerMetrics(rounds).codeChangeRate).toBe(0.5);
  });

  it('detects pushback with reasoning vs bare pushback', () => {
    const rounds: ReviewRound[] = [
      {
        round: 1,
        reviewer_comments: [makeComment(1), makeComment(2), makeComment(3)],
        implementer_responses: [
          makeResponse(1, 'pushback', 'I considered that, because the alternative has worse perf.'),
          makeResponse(2, 'pushback', 'No.'),
          makeResponse(3, 'pushback', 'I think this approach is better since it avoids the race condition.'),
        ],
      },
    ];

    const metrics = computeImplementerMetrics(rounds);
    expect(metrics.pushbackQuality.withReasoning).toBe(2);
    expect(metrics.pushbackQuality.bare).toBe(1);
  });

  it('computes caveRate = 1.0 for all-cave transcript', () => {
    const rounds: ReviewRound[] = [
      {
        round: 1,
        reviewer_comments: [makeComment(1), makeComment(2), makeComment(3)],
        implementer_responses: [
          makeResponse(1, 'change', 'Fixed!'),
          makeResponse(2, 'change', 'Done!'),
          makeResponse(3, 'change', 'Updated!'),
        ],
      },
    ];

    expect(computeImplementerMetrics(rounds).caveRate).toBe(1);
  });

  it('computes caveRate = 0 when all responses are pushback', () => {
    const rounds: ReviewRound[] = [
      {
        round: 1,
        reviewer_comments: [makeComment(1), makeComment(2)],
        implementer_responses: [
          makeResponse(1, 'pushback', 'I disagree because...'),
          makeResponse(2, 'pushback', 'I think this is fine.'),
        ],
      },
    ];

    expect(computeImplementerMetrics(rounds).caveRate).toBe(0);
  });

  it('tracks round progression', () => {
    const rounds: ReviewRound[] = [
      {
        round: 1,
        reviewer_comments: [makeComment(1), makeComment(2)],
        implementer_responses: [
          makeResponse(1, 'pushback', 'I disagree.'),
          makeResponse(2, 'change', 'Fixed!', 'code'),
        ],
      },
      {
        round: 2,
        reviewer_comments: [makeComment(1)],
        implementer_responses: [
          makeResponse(1, 'change', 'OK you\'re right.', 'fixed code'),
        ],
      },
    ];

    const metrics = computeImplementerMetrics(rounds);
    expect(metrics.roundProgression).toHaveLength(2);
    expect(metrics.roundProgression[0]).toEqual({ round: 1, moves: { pushback: 1, change: 1 } });
    expect(metrics.roundProgression[1]).toEqual({ round: 2, moves: { change: 1 } });
  });
});
