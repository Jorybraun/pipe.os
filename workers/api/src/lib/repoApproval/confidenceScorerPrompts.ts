/**
 * Confidence Scorer Prompts
 *
 * Cross-family evaluation: Qwen (evaluator) judges Gemma-generated narratives.
 * Scores four criteria on 0–1 scale:
 *   - coverage: Does the narrative cover the major signal dimensions?
 *   - accuracy: Are the facts in the narrative faithful to the deterministic signals?
 *   - groundedness: Is every claim traceable to a provided signal?
 *   - specificity: Is the narrative repo-specific rather than generic boilerplate?
 */

export interface Pass2SignalSummary {
  repo_id: number;
  full_name: string;
  primary_language: string;
  stars: number;
  sloc: number | null;
  file_count: number | null;
  mean_ccn: number | null;
  seniority_band: string | null;
  has_ci: 0 | 1;
  has_tests: 0 | 1;
  test_framework: string | null;
  detected_domain: string | null;
  pr_quality_score: number;
  open_pr_count: number | null;
  open_feature_issue_count: number | null;
  business_logic_ratio: number | null;
  cross_module_change_rate: number | null;
  test_touch_rate: number | null;
  mean_changed_files: number | null;
  p90_changed_files: number | null;
  issue_link_rate: number | null;
  swe_bench_eligibility_rate: number | null;
  complexity_band: string | null;
  test_style: string | null;
  challenge_surfaces: string | null;
  detected_stack_json: string | null;
  constructs: Array<{ slug: string; evidence_count: number }>;
}

export interface ConfidenceScores {
  coverage: number;
  accuracy: number;
  groundedness: number;
  specificity: number;
}

export interface ConfidenceResult {
  scores: ConfidenceScores;
  aggregate: number;
  verdict: 'auto_approve' | 'manual_review' | 'auto_reject';
  reasoning: string;
}

function fmt(n: number | null | undefined): string {
  return n === null || n === undefined ? 'unknown' : String(n);
}

function fmtBool(n: 0 | 1 | null | undefined): string {
  if (n === null || n === undefined) return 'unknown';
  return n === 1 ? 'yes' : 'no';
}

function topConstructs(constructs: Array<{ slug: string; evidence_count: number }>, k = 5): string {
  return constructs
    .slice(0, k)
    .map((c) => `${c.slug}(${c.evidence_count})`)
    .join(', ') || 'none';
}

function parseChallengeSurfaces(raw: string | null): string {
  if (!raw) return 'none';
  try {
    const obj = JSON.parse(raw) as Record<string, number>;
    return Object.entries(obj)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([k, v]) => `${k}=${v.toFixed(2)}`)
      .join(', ');
  } catch {
    return raw;
  }
}

export function buildConfidenceSystemPrompt(): string {
  return `You are a critical engineering-signal evaluator. Your job is to rate how well a Gemma-generated narrative and searchable profile represent the underlying deterministic signals extracted from a GitHub repository.

Score four criteria on a 0–1 scale (two decimal places). Be harsh — a generic or slightly inaccurate narrative should score ≤ 0.6.

coverage (0–1):
- 1.0 = The narrative covers ALL major dimensions: test discipline, review culture, architecture, complexity, PR patterns, and seniority fit.
- 0.5 = The narrative misses 1–2 major dimensions or gives them only a passing mention.
- 0.0 = The narrative is missing most dimensions or is extremely thin.

accuracy (0–1):
- 1.0 = Every quantitative claim matches the deterministic signals exactly. No hallucinated numbers.
- 0.5 = One or two minor discrepancies between claims and signals.
- 0.0 = Major factual errors or invented statistics.

groundedness (0–1):
- 1.0 = Every claim is traceable to a provided signal. No speculative assertions.
- 0.5 = A few claims go slightly beyond the signals but are reasonable inferences.
- 0.0 = Several claims are pure speculation with no basis in the data.

specificity (0–1):
- 1.0 = The narrative is unmistakably about THIS repo. Mentions specific technologies, patterns, and scale indicators.
- 0.5 = The narrative could describe a dozen similar repos. Generic but not wrong.
- 0.0 = Boilerplate that could apply to any repo in the language.

Respond with ONLY a valid JSON object matching this schema:

{
  "coverage": number,
  "accuracy": number,
  "groundedness": number,
  "specificity": number,
  "reasoning": string
}

Rules:
- All four scores must be numbers between 0.00 and 1.00 inclusive.
- reasoning: 1–3 sentences explaining the aggregate assessment. Be specific about what the narrative got right and wrong.
- Do NOT wrap the response in markdown code fences.
- Do NOT include any text outside the JSON object.`;
}

export function buildConfidenceUserPrompt(
  engineeringNarrative: string,
  repoSearchableProfile: string,
  signals: Pass2SignalSummary,
): string {
  const stack = signals.detected_stack_json
    ? (() => {
        try {
          const arr = JSON.parse(signals.detected_stack_json) as string[];
          return arr.slice(0, 10).join(', ');
        } catch {
          return signals.detected_stack_json;
        }
      })()
    : 'unknown';

  return `DETERMINISTIC SIGNALS (ground truth):
- repo: ${signals.full_name}
- primary_language: ${signals.primary_language}
- stars: ${signals.stars}
- sloc: ${fmt(signals.sloc)}
- file_count: ${fmt(signals.file_count)}
- mean_ccn: ${fmt(signals.mean_ccn)}
- seniority_band: ${signals.seniority_band ?? 'unknown'}
- has_ci: ${fmtBool(signals.has_ci)}
- has_tests: ${fmtBool(signals.has_tests)}
- test_framework: ${signals.test_framework ?? 'unknown'}
- detected_domain: ${signals.detected_domain ?? 'unknown'}
- pr_quality_score: ${fmt(signals.pr_quality_score)}
- open_pr_count: ${fmt(signals.open_pr_count)}
- open_feature_issue_count: ${fmt(signals.open_feature_issue_count)}
- business_logic_ratio: ${fmt(signals.business_logic_ratio)}
- cross_module_change_rate: ${fmt(signals.cross_module_change_rate)}
- test_touch_rate: ${fmt(signals.test_touch_rate)}
- mean_changed_files: ${fmt(signals.mean_changed_files)}
- p90_changed_files: ${fmt(signals.p90_changed_files)}
- issue_link_rate: ${fmt(signals.issue_link_rate)}
- swe_bench_eligibility_rate: ${fmt(signals.swe_bench_eligibility_rate)}
- complexity_band: ${signals.complexity_band ?? 'unknown'}
- test_style: ${signals.test_style ?? 'unknown'}
- challenge_surfaces: ${parseChallengeSurfaces(signals.challenge_surfaces)}
- detected_stack (top 10): ${stack}
- top constructs: ${topConstructs(signals.constructs)}

GEMMA-GENERATED NARRATIVE:
${engineeringNarrative}

GEMMA-GENERATED SEARCHABLE PROFILE:
${repoSearchableProfile}

Evaluate the narrative and profile against the deterministic signals. Score coverage, accuracy, groundedness, and specificity.`;
}
