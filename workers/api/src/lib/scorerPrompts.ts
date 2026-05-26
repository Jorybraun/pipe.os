/**
 * Scorer prompt constants for the multi-turn code review scoring panel.
 *
 * 6-dimension BARS rubric (per ADR-032):
 *
 * Scorer A (needs ground truth):
 *   1. Issue Identification Depth (20%)
 *   3. Prioritization Accuracy (15%)
 *   5. Revision Evaluation (20%)
 *
 * Scorer B (no ground truth — evaluates communication quality):
 *   2. Reasoning & Explanation Quality (20%)
 *   4. Question Formation (15%)
 *   6. AI Direction (10%, seniority-adjusted)
 *
 * Effectiveness: deterministic bug-matching (no LLM), 15% of composite.
 * Synthesizer: narrative summary for hiring managers.
 *
 * Scale: 1-5 per dimension (encounter-level, not turn-level).
 * Anchors are Hodges-compliant BARS: concrete observable behaviors only.
 */

import { buildBarsPromptSection } from './scorerRubric';

// ─── Scorer A: Ground-Truth Dimensions ──────────────────────────────────────

export const SCORER_A_PROMPT = `You are Scorer A on a code review assessment panel. You evaluate three dimensions that require access to GROUND TRUTH (planted bugs and design tradeoffs). The candidate does NOT know bugs were planted.

You score on a 1-5 scale using BARS (Behaviorally Anchored Rating Scales). Each level has a specific observable behavior — score based on what you observe, not on inferred traits.

## Your 3 Dimensions

${buildBarsPromptSection({ needsGroundTruth: true })}

## MANDATORY PROCESS

STEP 1: EXTRACT FACTS
Before scoring, list:
- Each reviewer comment and what it claims
- Each planted bug and whether any comment matches it
- Each false positive (comment flagging correct code as broken)
- Each severity label assigned by the reviewer and whether it matches actual severity
- Each implementer response (fix/pushback/clarification) and the reviewer's follow-up
- Each case where the reviewer did or did not verify a claimed fix

STEP 2: COMPUTE METRICS
Calculate from extracted facts:
- bugs_found_pct: (critical+major bugs found) / (total critical+major bugs)
- false_positives vs true_findings count
- approved_with_unfound_critical: boolean
- cave_ratio: (pushback points where reviewer caved) / (total pushback points)
- fix_verifications: count of times reviewer explicitly checked implementer's claimed fix

STEP 3: SCORE
Score each dimension 1-5 using the BARS anchors above. Apply ALL cross-checks — if a cross-check condition is met, the dimension score CANNOT exceed the stated maximum.

STEP 4: OUTPUT
Return a valid JSON object matching the tool schema. Include evidence for each score.`;

// ─── Scorer B: Communication Dimensions ─────────────────────────────────────

export const SCORER_B_PROMPT = `You are Scorer B on a code review assessment panel. You evaluate three dimensions of COMMUNICATION QUALITY. You do NOT see ground truth — you cannot know which bugs are real. You evaluate how the reviewer reasons, asks questions, and exercises judgment.

You score on a 1-5 scale using BARS (Behaviorally Anchored Rating Scales). Each level has a specific observable behavior — score based on what you observe, not on inferred traits.

## Your 3 Dimensions

${buildBarsPromptSection({ needsGroundTruth: false })}

## MANDATORY PROCESS

STEP 1: EXTRACT EVIDENCE
Before scoring, list:
- Each reviewer comment that contains an explanation (what mechanism was described?)
- Each clarifying question the reviewer asked (what did it probe?)
- Each time the reviewer responded to an implementer proposal (accepted/rejected/evaluated?)
- Each concession (was it reasoned or reflexive?)

STEP 2: SCORE
Score each dimension 1-5 using the BARS anchors above. Stick to observable behavior — do not infer intent or capability beyond what the transcript shows.

STEP 3: OUTPUT
Return a valid JSON object matching the tool schema. Include specific evidence quotes for each score.`;

// ─── Synthesizer ────────────────────────────────────────────────────────────

export const SYNTHESIZER_PROMPT = `You are writing a hiring assessment summary for a non-technical hiring manager. You receive scores from two evaluators who reviewed a candidate's code review performance across 6 dimensions, plus an objective effectiveness metric.

The 6 dimensions (scored 1-5 each):
1. Issue Identification Depth — Did they find real bugs?
2. Reasoning & Explanation Quality — Did they explain why issues matter?
3. Prioritization Accuracy — Did they distinguish blockers from nitpicks?
4. Question Formation — Did they ask before assuming?
5. Revision Evaluation — Did they verify fixes, or rubber-stamp?
6. AI Direction — Did they exercise judgment on suggestions?

Plus an Effectiveness score (0-100) measuring objective bug detection.

Write a 3-5 sentence narrative that:
1. Leads with the overall impression (strong/adequate/weak reviewer)
2. Highlights the strongest dimension with a specific example from the scores
3. Calls out the most important growth area with a specific example
4. Is honest but constructive — this goes to a hiring manager making a decision
5. Avoids jargon — use plain language a non-engineer can understand

Also identify 2-3 key strengths and 2-3 growth areas as bullet points.

Return ONLY a JSON object with: { "narrative": "...", "strengths": ["..."], "growth_areas": ["..."] }`;

// ─── Legacy prompts (kept for backward compatibility during migration) ──────

export { SCORER_A_PROMPT as TECHNICAL_SCORER_PROMPT };
export { SCORER_B_PROMPT as CONVERSATION_SCORER_PROMPT };
export { SCORER_B_PROMPT as PRACTICE_SCORER_PROMPT };

// ─── Tool schemas for structured output ────────────────────────────────────

export const SCORER_A_TOOL_SCHEMA = {
  name: 'submit_scorer_a',
  description: 'Submit ground-truth dimension scores (issue identification, prioritization, revision evaluation)',
  input_schema: {
    type: 'object' as const,
    required: [
      'issue_identification', 'prioritization', 'revision_evaluation',
      'evidence', 'metrics', 'summary',
    ],
    properties: {
      issue_identification: { type: 'number', description: '1-5 BARS score' },
      prioritization: { type: 'number', description: '1-5 BARS score' },
      revision_evaluation: { type: 'number', description: '1-5 BARS score' },
      evidence: {
        type: 'object',
        description: 'Evidence supporting each score',
        properties: {
          issue_identification_evidence: { type: 'string' },
          prioritization_evidence: { type: 'string' },
          revision_evaluation_evidence: { type: 'string' },
        },
      },
      metrics: {
        type: 'object',
        description: 'Computed metrics from fact extraction',
        properties: {
          bugs_found: { type: 'array', items: { type: 'number' }, description: 'IDs of planted bugs found' },
          bugs_missed: { type: 'array', items: { type: 'number' }, description: 'IDs of planted bugs missed' },
          bugs_found_pct: { type: 'number', description: 'Fraction of critical+major bugs found (0-1)' },
          false_positive_count: { type: 'number' },
          true_finding_count: { type: 'number' },
          approved_with_unfound_critical: { type: 'boolean' },
          cave_ratio: { type: 'number', description: 'Fraction of pushback points where reviewer caved (0-1)' },
          fix_verifications: { type: 'number', description: 'Count of verified claimed fixes' },
        },
      },
      summary: { type: 'string', description: '2-3 sentence summary of ground-truth dimensions' },
    },
  },
};

export const SCORER_B_TOOL_SCHEMA = {
  name: 'submit_scorer_b',
  description: 'Submit communication dimension scores (reasoning, question formation, AI direction)',
  input_schema: {
    type: 'object' as const,
    required: [
      'reasoning_quality', 'question_formation', 'ai_direction',
      'evidence', 'summary',
    ],
    properties: {
      reasoning_quality: { type: 'number', description: '1-5 BARS score' },
      question_formation: { type: 'number', description: '1-5 BARS score' },
      ai_direction: { type: 'number', description: '1-5 BARS score' },
      evidence: {
        type: 'object',
        description: 'Evidence supporting each score, with specific quotes',
        properties: {
          reasoning_quality_evidence: { type: 'string' },
          question_formation_evidence: { type: 'string' },
          ai_direction_evidence: { type: 'string' },
        },
      },
      summary: { type: 'string', description: '2-3 sentence summary of communication dimensions' },
    },
  },
};

// Legacy schemas — aliased for backward compatibility during migration
export const TECHNICAL_TOOL_SCHEMA = SCORER_A_TOOL_SCHEMA;
export const CONVERSATION_TOOL_SCHEMA = SCORER_B_TOOL_SCHEMA;
export const PRACTICE_TOOL_SCHEMA = SCORER_B_TOOL_SCHEMA;
