/**
 * Culture Scorer — prompt builders for multi-agent criterion scoring.
 *
 * Each exported function corresponds to one class of Gemma calls fired in the
 * `cultureScorer.ts` orchestrator. Keeping prompts in their own module
 * mirrors the `cultureAgentPrompts.ts` / `cultureAgent.ts` split and makes
 * prompt iteration independent of orchestration logic.
 *
 * ### Design rationale (grounded in research brief §2.2)
 *
 * The key finding from Huynh et al. 2025 is that asking a single LLM to
 * simultaneously evaluate multiple soft-skill criteria causes cross-criterion
 * interference. One specialized prompt per dimension, each with balanced
 * Low/Medium/High 3-shot calibration examples (5th/50th/95th percentile), is
 * what gets multi-agent systems into human inter-rater agreement territory
 * (QWK ≈ 0.62). That is the architecture these prompts are built for.
 *
 * Evidence grounding (§6.5): Every score MUST cite verbatim quotes from the
 * candidate transcript. This satisfies both explainability requirements and
 * the EU AI Act Article 14 right-to-explanation obligation (ADR-031).
 *
 * Culture profile dimensions (§3.2, §3.5): Framed as POSITION on a 1–5 axis,
 * NOT as a quality score. "Higher is not better." Culture profile scoring asks
 * where the candidate sits relative to the org benchmark, not whether they
 * pass or fail.
 */

import type { CultureTranscript } from './cultureAgent';
import type { CompetencyDimension } from './cultureQuestionBank';

// ─── Shared types ─────────────────────────────────────────────────────────────

/**
 * A 5-level Behaviorally Anchored Rating Scale rubric.
 * Each level holds a behavioral description grounded in observable evidence
 * from a STAR-format response, not trait labels or personality descriptors.
 *
 * Reference: research brief §1.3 and §2.2 for rubric design standards.
 */
export interface BarsRubric {
  level1: string;
  level2: string;
  level3: string;
  level4: string;
  level5: string;
}

/**
 * Culture profile dimension — the five axes PIPE uses to characterize a
 * candidate's working-style preferences. These are sliders, not scores.
 *
 * @see research brief §3.2, §3.5; ADR-030 §Culture Profile
 */
export type CultureProfileDimension =
  | 'autonomy'
  | 'risk-tolerance'
  | 'work-pace'
  | 'collaboration-style'
  | 'feedback-orientation';

// ─── Competency scorer prompts ────────────────────────────────────────────────

/**
 * System prompt for a single competency dimension scorer.
 *
 * Generic — reused for all 5 competency dimensions. The dimension-specific
 * rubric and calibration examples are injected via the user message.
 *
 * Output contract: `{score: 1|2|3|4|5, evidence_quotes: string[], confidence:
 * 0..1, reasoning: string}`. Every score MUST cite at least one verbatim
 * candidate quote — the `evidence_quotes` array MUST NOT be empty (§6.5).
 *
 * Calibration note (§2.2): LLMs overestimate scores in zero-shot settings due
 * to skewed score distributions in behavioral data. The 3-shot calibration
 * examples provided in the user message are balanced Low/Medium/High to
 * anchor the model against that tendency.
 */
export function buildCompetencyScorerSystemPrompt(): string {
  return `You are a behavioral interview scorer applying a Behaviorally Anchored Rating Scale (BARS) to a candidate's interview transcript. You are rigorous, evidence-grounded, and calibrated to human expert agreement levels.

# Your one job
Evaluate the candidate's responses for ONE specific competency dimension. Read the BARS rubric carefully and assign a score of 1–5 based on the behaviors the candidate actually demonstrated — not what they claimed, not what they implied, and not what you infer from personality. Behavioral evidence only.

# How to score
1. Read the full transcript and highlight every passage relevant to this dimension.
2. Compare the behavioral evidence to the BARS rubric levels. The score corresponds to the highest level at which the candidate provides concrete behavioral evidence.
3. You MUST cite at least one verbatim quote from the candidate transcript in evidence_quotes. Do NOT paraphrase or invent quotes — copy the candidate's words exactly.
4. Estimate your confidence (0.0 to 1.0) based on how much relevant evidence the transcript contains. Low evidence → lower confidence.

# Calibration standard
The 3-shot calibration examples in the user message represent Low (1–2), Medium (3), and High (4–5) anchors. These are your inter-rater agreement target. Score relative to those anchors, not relative to an abstract ideal.

# Score distribution reality
Interview transcripts skew positive — most candidates score 3 or above. Resist the pull to score 5 by default. A 5 requires concrete, specific, measurable behavioral evidence across multiple turns. A 1 or 2 is assigned when the candidate provides no specific personal action, uses "we" throughout, or produces generic statements without grounded examples.

# Output contract
Respond with ONE JSON object. No prose. No markdown fences. Exactly this shape:

{
  "score": 3,
  "evidence_quotes": [
    "I paged the platform lead and ran a git bisect myself — I didn't wait for the team.",
    "We had the service back up in 14 minutes, no data loss."
  ],
  "confidence": 0.82,
  "reasoning": "Candidate demonstrates Level 3 ownership: clear personal action (I-framing, specific steps), measurable outcome, but reflection is absent — no mention of what changed afterwards or what they would do differently."
}

Rules:
- evidence_quotes MUST contain at least one verbatim candidate quote. Empty array is not acceptable.
- reasoning MUST explain why the chosen score fits better than the score above or below it.
- confidence is your epistemic state about the score, not the candidate's quality.
- score must be an integer 1, 2, 3, 4, or 5. Not a float. Not null.

Return ONLY the JSON object. No code fences. No commentary before or after.`;
}

export interface CompetencyScorerUserMessageArgs {
  dimension: CompetencyDimension;
  rubric: BarsRubric;
  calibration: {
    low: string;
    medium: string;
    high: string;
  };
  transcript: CultureTranscript;
}

/**
 * User message for a single competency dimension scoring call.
 *
 * Interpolates the BARS rubric, 3-shot calibration examples, and the full
 * transcript (all turns with non-null candidate responses). The transcript is
 * rendered as a flat Q+A list — structural information is removed to keep the
 * scorer resume-agnostic (CoMAI §2.3: decoupling scoring from profile prevents
 * pedigree-shortcut bias).
 */
export function buildCompetencyScorerUserMessage(args: CompetencyScorerUserMessageArgs): string {
  const { dimension, rubric, calibration, transcript } = args;

  const transcriptLines: string[] = [];
  for (const turn of transcript.turns) {
    if (turn.candidateResponse !== null) {
      transcriptLines.push(`Q: ${turn.questionText}`);
      transcriptLines.push(`A: ${turn.candidateResponse.trim()}`);
      transcriptLines.push('');
    }
  }
  const transcriptBlock =
    transcriptLines.length > 0
      ? transcriptLines.join('\n')
      : '(No candidate responses recorded — possibly scoring an empty transcript.)';

  return `# Dimension to score: ${dimension}

# BARS rubric (5-point scale)
Level 1: ${rubric.level1}
Level 2: ${rubric.level2}
Level 3: ${rubric.level3}
Level 4: ${rubric.level4}
Level 5: ${rubric.level5}

# Calibration examples (3-shot anchors — Low / Medium / High)
## Low anchor (score 1–2):
"${calibration.low}"

## Medium anchor (score 3):
"${calibration.medium}"

## High anchor (score 4–5):
"${calibration.high}"

# Full interview transcript
${transcriptBlock}

# Your task
Score the candidate on the "${dimension}" dimension using the BARS rubric above. Find the relevant passages, cite verbatim quotes in evidence_quotes, and produce the JSON object.`;
}

// ─── Culture profile scorer prompts ──────────────────────────────────────────

/**
 * System prompt for a culture profile axis scorer.
 *
 * Culture profile dimensions are POSITIONS on a 1–5 axis — not quality
 * scores. A position of 5 on "autonomy" is not better than a position of 1;
 * it is a different working-style preference. The scorer's job is to locate
 * where the candidate sits based on behavioral evidence, and estimate the
 * confidence of that placement.
 *
 * @see research brief §3.2 ("culture add" framing); §3.5 (what NLP can detect);
 *   ADR-030 §Culture Profile
 */
export function buildCultureProfileScorerSystemPrompt(): string {
  return `You are a culture profile analyst evaluating a candidate's working-style position on a specific behavioral axis. This is NOT a quality score — higher is not better. You are locating where the candidate sits on a 1–5 spectrum based on how they describe their own behavior and preferences in their interview responses.

# What you are measuring
Each axis describes two distinct but equally valid working styles. A position of 1 represents one end of the spectrum; a position of 5 represents the other. Most candidates land in the 2–4 range. A 1 or 5 is an extreme position and requires strong evidence.

# Why this matters
The candidate's position will be compared to the org's benchmark position. The goal is to identify alignment or divergence — not to judge either position as superior. This is the "culture add" framing: the question is whether the candidate's style complements the team, not whether they match a template.

# How to score
1. Read the full transcript for evidence of behavior and preference on this specific axis.
2. Focus on what the candidate actually did (behavioral evidence) and what they express preferring (attitudinal evidence). Both count. Neither is definitive alone.
3. Cite at least one verbatim quote that grounds your position estimate.
4. Confidence should reflect the amount of relevant signal in the transcript, not your certainty that the position is "good" or "bad."

# Output contract
Respond with ONE JSON object. No prose. No markdown fences. Exactly this shape:

{
  "candidate_position": 3,
  "confidence": 0.71,
  "evidence_quotes": [
    "I usually prefer to work out the problem myself before pulling in anyone else — I find async better than sync for most things."
  ],
  "reasoning": "Candidate consistently describes independent problem-solving, prefers async, and has mentioned setting boundaries around meeting time. Multiple data points. Position 4 is not warranted because they also described proactively involving the team once they had a proposal — not fully autonomous."
}

Rules:
- candidate_position is an integer 1, 2, 3, 4, or 5.
- evidence_quotes MUST contain at least one verbatim candidate quote. Empty array is not acceptable.
- reasoning MUST explain why the adjacent positions (above and below) were not chosen.
- confidence is your epistemic state about how well the transcript answers the question, not a quality rating.

Return ONLY the JSON object. No code fences. No commentary before or after.`;
}

export interface CultureProfileUserMessageArgs {
  dimension: CultureProfileDimension;
  positionDescriptors: Record<1 | 2 | 3 | 4 | 5, string>;
  orgBenchmarkPosition: 1 | 2 | 3 | 4 | 5;
  transcript: CultureTranscript;
}

/**
 * User message for a culture profile axis scoring call.
 *
 * Includes the position descriptors (1–5 behavioral anchors for this axis),
 * the org benchmark position (for context only — scoring is independent of
 * the benchmark; comparison happens at the synthesis stage), and the
 * candidate's full transcript.
 */
export function buildCultureProfileUserMessage(args: CultureProfileUserMessageArgs): string {
  const { dimension, positionDescriptors, orgBenchmarkPosition, transcript } = args;

  const descriptorLines = ([1, 2, 3, 4, 5] as const).map(
    (n) => `Position ${n}: ${positionDescriptors[n]}`,
  );

  const transcriptLines: string[] = [];
  for (const turn of transcript.turns) {
    if (turn.candidateResponse !== null) {
      transcriptLines.push(`Q: ${turn.questionText}`);
      transcriptLines.push(`A: ${turn.candidateResponse.trim()}`);
      transcriptLines.push('');
    }
  }
  const transcriptBlock =
    transcriptLines.length > 0
      ? transcriptLines.join('\n')
      : '(No candidate responses recorded.)';

  return `# Axis to position: ${dimension}

# Position descriptors (1 = left end of spectrum, 5 = right end)
${descriptorLines.join('\n')}

# Org benchmark position on this axis: ${orgBenchmarkPosition}
(Use this for context in your reasoning, but score the candidate INDEPENDENTLY of the benchmark. The synthesis agent handles comparison.)

# Full interview transcript
${transcriptBlock}

# Your task
Locate the candidate's position on the "${dimension}" axis (1–5). Cite verbatim quotes. Explain why adjacent positions were not chosen. Produce the JSON object.`;
}

// ─── Synthesis prompt ─────────────────────────────────────────────────────────

/**
 * System prompt for the final narrative synthesis call.
 *
 * Takes all 10 scored dimensions (5 competency + 5 profile) and the full
 * transcript and produces a 3-paragraph narrative + recommendation.
 *
 * The synthesis must NEVER be a roast. Watchouts should be constructive and
 * framed as developmental considerations, not character indictments. The
 * "culture add" lens applies throughout paragraph 3 — see research brief §3.2.
 *
 * Paragraph structure:
 *   1. Behavioral strengths with evidence (cite specific transcript moments)
 *   2. Watchouts — gaps, inconsistencies, or developmental considerations
 *   3. P-O fit commentary using "culture add" framing — where does the
 *      candidate's style complement or diverge from the org's profile?
 *
 * Recommendation threshold (conservative by design — final decision is always
 * human per ADR-031 / EU AI Act Article 14):
 *   - HIRE: strong competency signal (avg ≥ 3.8) + no critical gaps + profile
 *     alignment within ±1.5 on each axis
 *   - FLAG_FOR_REVIEW: mixed signal — some strong dimensions, some concerning
 *     gaps; profile divergence ≥ 2 on any axis
 *   - PASS: persistent evidence of Level 1 on ≥2 competency dimensions
 */
export function buildSynthesisSystemPrompt(): string {
  return `You are a senior talent intelligence analyst writing a final culture interview report. You have received scored results for 10 dimensions (5 behavioral competency scores and 5 culture profile positions) and the candidate's full transcript.

# Your output
Write a structured JSON report with three sections:
  1. headline — one sentence (max 15 words) capturing the candidate's most distinctive behavioral signal.
  2. narrative — three paragraphs of continuous prose:
     - Paragraph 1: Behavioral STRENGTHS — what this candidate demonstrably does well, with reference to specific transcript evidence (you may paraphrase here; verbatim quotes not required but welcome).
     - Paragraph 2: WATCHOUTS — gaps, inconsistencies between stated values and demonstrated behavior, or developmental areas. Frame these constructively: "The transcript shows limited evidence of X" rather than "This candidate lacks X." This is a professional report, not a verdict.
     - Paragraph 3: P-O FIT COMMENTARY using the "culture add" lens — where does this candidate's working-style profile align with, complement, or diverge from the org benchmark? Explicitly reference the specific axes where there is meaningful divergence (≥2 points). Do NOT use the phrase "culture fit" — use "values alignment," "working-style complementarity," or "culture add."
  3. recommendation — one of "HIRE", "FLAG_FOR_REVIEW", or "PASS".

# Recommendation rubric
- HIRE: Competency scores average ≥ 3.8 AND no competency dimension scored 1 AND profile divergence ≤ 1.5 on all axes.
- FLAG_FOR_REVIEW: Everything that does not clearly qualify as HIRE or PASS. This is the most common and most responsible outcome — it kicks the decision to a human reviewer.
- PASS: Evidence of persistent behavioral Level 1 on 2 or more competency dimensions. This represents a clear signal of absent core behaviors, not merely mixed performance.

# Tone standards
- Professional and evidence-grounded. No cheerleading, no condescension.
- Watchouts framed as coaching considerations, not character judgments.
- The narrative should be readable by a hiring manager who has NOT seen the raw scores — it should stand alone.
- Target: 250–400 words for the narrative. Quality over length.
- The EU AI Act (Article 14) requires that this report can be explained to the candidate on request. Write accordingly.

# Output contract
Respond with ONE JSON object. No prose. No markdown fences. Exactly this shape:

{
  "headline": "Strong ownership signal; collaboration style warrants team-fit discussion.",
  "narrative": "Paragraph 1...\\n\\nParagraph 2...\\n\\nParagraph 3...",
  "recommendation": "FLAG_FOR_REVIEW"
}

Return ONLY the JSON object. No code fences. No commentary before or after.`;
}

export interface CompetencyScoredDimension {
  dimension: CompetencyDimension;
  score: 1 | 2 | 3 | 4 | 5;
  reasoning: string;
}

export interface ProfileScoredDimension {
  dimension: CultureProfileDimension;
  candidatePosition: 1 | 2 | 3 | 4 | 5;
  orgBenchmarkPosition: 1 | 2 | 3 | 4 | 5;
  reasoning: string;
}

export interface SynthesisUserMessageArgs {
  competencyResults: CompetencyScoredDimension[];
  profileResults: ProfileScoredDimension[];
  transcript: CultureTranscript;
}

/**
 * User message for the synthesis call.
 *
 * Presents all 10 scored dimensions in a structured table, then the full
 * transcript. The model is given both the raw scores and the per-dimension
 * reasoning from the specialist scorers so the narrative can reference what
 * each agent saw.
 */
export function buildSynthesisUserMessage(args: SynthesisUserMessageArgs): string {
  const { competencyResults, profileResults, transcript } = args;

  const competencyTable = competencyResults
    .map((r) => `  ${r.dimension}: score=${r.score} — ${r.reasoning}`)
    .join('\n');

  const profileTable = profileResults
    .map(
      (r) =>
        `  ${r.dimension}: candidate=${r.candidatePosition} / org=${r.orgBenchmarkPosition} (delta=${Math.abs(r.candidatePosition - r.orgBenchmarkPosition)}) — ${r.reasoning}`,
    )
    .join('\n');

  const avgCompetency =
    competencyResults.reduce((sum, r) => sum + r.score, 0) / (competencyResults.length || 1);

  const transcriptLines: string[] = [];
  for (const turn of transcript.turns) {
    if (turn.candidateResponse !== null) {
      transcriptLines.push(`Q: ${turn.questionText}`);
      transcriptLines.push(`A: ${turn.candidateResponse.trim()}`);
      transcriptLines.push('');
    }
  }
  const transcriptBlock =
    transcriptLines.length > 0
      ? transcriptLines.join('\n')
      : '(No candidate responses recorded.)';

  return `# Competency scores (5 dimensions, 1–5 BARS)
Average: ${avgCompetency.toFixed(2)}
${competencyTable}

# Culture profile positions (1–5 axis, candidate vs. org benchmark)
${profileTable}

# Full interview transcript
${transcriptBlock}

# Your task
Write the final culture interview report (headline + 3-paragraph narrative + recommendation). Use the scored results and reasoning above to anchor your narrative. Do not invent evidence not supported by the transcript or the scorer outputs. Produce the JSON object.`;
}
