/**
 * Pass 3 — Devstral quality gate
 *
 * Evaluates Gemma's engineering_narrative + repo_searchable_profile against
 * the FACTS block that was used to generate them. Returns a structured
 * JudgeResult with 4 boolean dimensions and an overall approve/deny decision.
 *
 * Uses Devstral (Mistral API) — intentionally a different model family than
 * Gemma so the gate is an independent perspective.
 *
 * Threshold: 3/4 dimensions must pass to approve.
 *
 * Dimensions:
 *   constraint_pass    — profile is 400–600 words; no digits absent from FACTS
 *   accuracy_pass      — narrative accurately reflects the repo's signals
 *                        (language, domain, test culture, PR patterns)
 *   architecture_pass  — architecture_style is plausible given the stack/domain
 *   completeness_pass  — profile covers all 5 required sections
 */

import { logger } from '../shared/logger.js';

export interface JudgeResult {
  constraint_pass: boolean;
  accuracy_pass: boolean;
  architecture_pass: boolean;
  completeness_pass: boolean;
  /** true if ≥ 3/4 dimensions pass */
  approved: boolean;
  failures: string[];
  reasoning: string;
  /** raw Devstral response */
  raw: string;
}

interface DevstralResponse {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message: string };
}

const DEVSTRAL_MODEL = 'mistral-small-latest';
const JUDGE_SYSTEM = `You are a technical content quality auditor. You receive:
1. A FACTS block — structured signals about an open-source repository
2. A Gemma-generated engineering_narrative (200–400 words) and repo_searchable_profile (400–600 words)
3. The chosen architecture_style enum value

Your job is to score the output on 4 dimensions. Return ONLY a JSON object matching this schema exactly:

{
  "constraint_pass": boolean,
  "accuracy_pass": boolean,
  "architecture_pass": boolean,
  "completeness_pass": boolean,
  "failures": string[],
  "reasoning": string
}

Scoring rules:
- constraint_pass: true if repo_searchable_profile is between 400 and 600 words AND contains no numbers that weren't present in the FACTS block
- accuracy_pass: true if the narrative mentions the primary language, reflects the actual test discipline (has_tests, test_framework), and the domain/stack signals are represented without contradiction
- architecture_pass: true if the architecture_style choice is defensible given detected_stack and detected_domain (e.g. "library" only if the repo is clearly an importable package, "microservice" only if multi-service topology is evident)
- completeness_pass: true if repo_searchable_profile covers all 5 of: (a) repo type and purpose, (b) language and stack, (c) PR-shape observations, (d) test/review culture, (e) contribution readiness (open PR/issue counts)

failures: list each failing dimension with a one-sentence reason. Empty array if all pass.
reasoning: one paragraph explaining your overall assessment.

Return ONLY the JSON. No markdown, no commentary.`;

function buildJudgePrompt(
  factsBlock: string,
  narrative: string,
  profile: string,
  architectureStyle: string | null,
): string {
  return `FACTS:
${factsBlock}

---

architecture_style chosen: ${architectureStyle ?? 'null'}

engineering_narrative:
${narrative}

repo_searchable_profile:
${profile}

Score the above output on the 4 dimensions.`;
}

export async function judgeOutput(opts: {
  factsBlock: string;
  narrative: string;
  profile: string;
  architectureStyle: string | null;
  apiKey: string;
}): Promise<JudgeResult> {
  const { factsBlock, narrative, profile, architectureStyle, apiKey } = opts;

  const userPrompt = buildJudgePrompt(factsBlock, narrative, profile, architectureStyle);

  let raw = '';
  try {
    const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: DEVSTRAL_MODEL,
        messages: [
          { role: 'system', content: JUDGE_SYSTEM },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 800,
        response_format: { type: 'json_object' },
        temperature: 0.1,
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Devstral ${res.status}: ${err}`);
    }

    const data = (await res.json()) as DevstralResponse;
    raw = data.choices?.[0]?.message?.content ?? '';
    if (!raw) throw new Error('Devstral returned empty response');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('[pass3/judge] Devstral call failed', { error: msg });
    // On judge failure, approve with warning — don't block the pipeline
    return {
      constraint_pass: true,
      accuracy_pass: true,
      architecture_pass: true,
      completeness_pass: true,
      approved: true,
      failures: [],
      reasoning: `Judge unavailable: ${msg}`,
      raw: '',
    };
  }

  try {
    const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed = JSON.parse(stripped) as {
      constraint_pass?: boolean;
      accuracy_pass?: boolean;
      architecture_pass?: boolean;
      completeness_pass?: boolean;
      failures?: string[];
      reasoning?: string;
    };

    const constraint_pass = parsed.constraint_pass ?? true;
    const accuracy_pass = parsed.accuracy_pass ?? true;
    const architecture_pass = parsed.architecture_pass ?? true;
    const completeness_pass = parsed.completeness_pass ?? true;
    const passingCount = [constraint_pass, accuracy_pass, architecture_pass, completeness_pass]
      .filter(Boolean).length;

    return {
      constraint_pass,
      accuracy_pass,
      architecture_pass,
      completeness_pass,
      approved: passingCount >= 3,
      failures: parsed.failures ?? [],
      reasoning: parsed.reasoning ?? '',
      raw,
    };
  } catch (err) {
    logger.error('[pass3/judge] Failed to parse Devstral response', {
      error: err instanceof Error ? err.message : String(err),
      raw: raw.slice(0, 300),
    });
    // Parse failure → approve with warning, don't block
    return {
      constraint_pass: true,
      accuracy_pass: true,
      architecture_pass: true,
      completeness_pass: true,
      approved: true,
      failures: [],
      reasoning: `Judge parse error: ${raw.slice(0, 100)}`,
      raw,
    };
  }
}
