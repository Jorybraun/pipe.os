/**
 * Pass 3 — deterministic PR-sample statistics.
 *
 * Computes the numeric facts that used to be LLM-estimated. Every value
 * derives from `repo_sample_prs` aggregates with no model in the loop, so
 * the same repo always produces identical numbers across re-runs. These feed
 * the FACTS block in the Gemma prompt; Gemma narrates them but may not
 * invent new digits (enforced in validate.ts).
 */

import type { SamplePRSummary } from './types.js';

export interface DeterministicStats {
  test_touch_rate: number | null;
  mean_changed_files: number | null;
  p90_changed_files: number | null;
  issue_link_rate: number | null;
  swe_bench_eligibility_rate: number | null;
}

function mean(xs: number[]): number {
  return xs.reduce((acc, x) => acc + x, 0) / xs.length;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0]!;
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx]!;
}

export function computeDeterministicStats(
  samplePrs: SamplePRSummary[],
): DeterministicStats {
  if (samplePrs.length === 0) {
    return {
      test_touch_rate: null,
      mean_changed_files: null,
      p90_changed_files: null,
      issue_link_rate: null,
      swe_bench_eligibility_rate: null,
    };
  }

  const n = samplePrs.length;
  const changedCounts = samplePrs.map((p) => p.changed_file_count).sort((a, b) => a - b);

  const testTouchCount = samplePrs.filter((p) => p.modifies_tests === 1).length;
  const issueLinkCount = samplePrs.filter((p) => p.resolves_issue_number !== null).length;
  const sweBenchCount = samplePrs.filter((p) => p.swe_bench_eligible === 1).length;

  return {
    test_touch_rate: Number((testTouchCount / n).toFixed(3)),
    mean_changed_files: Number(mean(changedCounts).toFixed(2)),
    p90_changed_files: percentile(changedCounts, 0.9),
    issue_link_rate: Number((issueLinkCount / n).toFixed(3)),
    swe_bench_eligibility_rate: Number((sweBenchCount / n).toFixed(3)),
  };
}

export function computeComplexityBand(
  meanCcn: number | null,
): 'low' | 'medium' | 'high' | 'mixed' | null {
  if (meanCcn === null) return null;
  if (meanCcn < 3) return 'low';
  if (meanCcn <= 6) return 'medium';
  return 'high';
}
