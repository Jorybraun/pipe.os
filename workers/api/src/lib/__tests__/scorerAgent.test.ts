import { describe, expect, it, vi } from 'vitest';
import { scoreReviewSession } from '../scorerAgent';

function workersAiReportJson(): string {
  return JSON.stringify({
    dimensions: {
      issue_identification: 4,
      prioritization: 4,
      revision_evaluation: 3,
      reasoning_quality: 4,
      question_formation: 3,
      ai_direction: 4,
    },
    evidence: {
      issue_identification_evidence: 'Flagged a real data-loss risk in the retry path.',
      prioritization_evidence: 'Treated the data-loss risk as blocking.',
      revision_evaluation_evidence: 'Verified the retry fix before final verdict.',
      reasoning_quality_evidence: 'Explained why retry semantics matter for idempotency.',
      question_formation_evidence: 'Asked a targeted question about duplicate writes.',
      ai_direction_evidence: 'Directed the author toward an idempotency guard.',
    },
    metrics: {
      bugs_found: [1],
      bugs_missed: [],
      bugs_found_pct: 1,
      false_positive_count: 0,
      true_finding_count: 1,
      approved_with_unfound_critical: false,
      cave_ratio: 0,
      fix_verifications: 1,
    },
    overall: {
      narrative: 'The review found and defended the important reliability issue.',
      strengths: ['Strong reliability reasoning'],
      growth_areas: ['Could ask one more clarifying question'],
    },
    scorer_a_summary: 'Found the source-backed reliability issue.',
    scorer_b_summary: 'Clear and appropriately firm with the author.',
  });
}

function makeAi(responses: Array<unknown | Error>): { ai: Ai; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    ai: {
      run: vi.fn(async (model: string) => {
        calls.push(model);
        const next = responses.shift();
        if (next instanceof Error) throw next;
        return next;
      }),
    } as unknown as Ai,
  };
}

describe('scoreReviewSession Workers AI path', () => {
  it('scores with one real Workers AI judgment pass and deterministic effectiveness', async () => {
    const { ai, calls } = makeAi([{ response: workersAiReportJson() }]);

    const report = await scoreReviewSession({
      apiKey: '',
      provider: 'workers-ai',
      ai,
      transcript: {
        rounds: [{
          reviewer_comments: [{
            path: 'src/retry.ts',
            body: 'This retry can duplicate writes without an idempotency key.',
          }],
        }],
      },
      groundTruth: [{ id: 1, severity: 'critical', description: 'Retry can duplicate writes.' }],
      diff: 'diff --git a/src/retry.ts b/src/retry.ts',
      prTitle: 'Add retry around writes',
      prDescription: 'Adds retry behavior for transient write failures.',
      instructions: 'Review the PR for correctness.',
    });

    expect(calls).toHaveLength(1);
    expect(report.dimensions.issue_identification).toBe(4);
    expect(report.metrics.bugs_found).toEqual([1]);
    expect(report.effectiveness.score).toBeGreaterThan(90);
    expect(report.overall.score).toBeGreaterThan(70);
    expect(report.overall.narrative).toContain('reliability');
  });

  it('falls through deprecated or malformed Workers AI models before scoring', async () => {
    const { ai, calls } = makeAi([
      new Error('5028: This model was deprecated on 2026-05-30.'),
      { choices: [{ message: { content: workersAiReportJson() } }] },
    ]);

    const report = await scoreReviewSession({
      apiKey: '',
      provider: 'workers-ai',
      ai,
      transcript: { rounds: [{ reviewer_comments: [{ body: 'Blocking duplicate writes.' }] }] },
      groundTruth: [{ id: 1, severity: 'major', description: 'Duplicate writes.' }],
    });

    expect(calls.length).toBe(2);
    expect(calls[0]).toBe('@cf/openai/gpt-oss-20b');
    expect(report.overall.narrative).toContain('reliability');
  });
});
