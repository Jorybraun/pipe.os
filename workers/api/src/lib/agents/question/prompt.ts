/**
 * Question Generator — Prompt Builder (Multi-Agent Architecture)
 *
 * System prompt: ~300 chars. Warm interviewer persona + JSON schema + brevity.
 * User prompt: Assembled per-turn from deterministic agents + state.
 *
 * Agents contributing to the user prompt:
 *   - Turn Planner (planner.ts): phase, strategy, target domain, question type
 *   - Probe Librarian (probeLibrarian.ts): calibrated probe text + drilling hints
 *   - Role Context Adapter (roleAdapter.ts): interviewee brief from baseline
 *
 * The LLM (Question Writer) sees exactly what it needs for THIS turn.
 */

import type { ConversationPhase, DomainCoverage } from '../../../types';
import type { InterviewState } from '../interview/types';
import { injectPromptPatches } from './promptPatch';
import { buildTurnPlan, buildPlanInstruction } from './planner';
import { buildProbeInstruction } from './probeLibrarian';
import { buildRoleInstruction } from './roleAdapter';

// ─── Compact JSON schemas ────────────────────────────────────────────────────

const RESPONSE_FORMAT = `{"reasoning":"<20 words max>","acknowledgment":"<1 sentence>","question":{"id":"q-N","text":"<under 15 words>","goal":"<under 10 words>","expectedCoverage":{"domain":"why|work|team|bar|codebase|process","from":"none|sparse|partial|covered|deep","to":"none|sparse|partial|covered|deep"},"probeAlignment":"<probe id or none>","questionType":"introductory|grand_tour|example|drilling|direct|hypothesis|contrast","input":{"type":"text|textarea|tags|select|radio","placeholder":"<hint>","options":["<for select/radio>"]},"suggestedAnswers":["<omit if open-ended>"]},"knowledgeStateUpdate":{"<domain>":{"<key>":"<value>"}},"domainCoverage":{"why":"...","work":"...","team":"...","bar":"...","codebase":"...","process":"..."}}`;

const BREVITY_RULES = `- reasoning: max 20 words. One sentence.
- acknowledgment: max 1 sentence. No filler.
- question.text: under 15 words.
- goal: under 10 words.
- suggestedAnswers: omit unless the question truly benefits from examples.
- knowledgeStateUpdate: only include keys that are NEW or CHANGED this turn.`;

const BATCH_RESPONSE_FORMAT = `{"reasoning":"<20 words max>","batch":[{"acknowledgment":"<1 sentence>","question":{"id":"q-N","text":"<under 15 words>","goal":"<under 10 words>","expectedCoverage":{"domain":"why|work|team|bar|codebase|process","from":"none|sparse|partial|covered|deep","to":"none|sparse|partial|covered|deep"},"probeAlignment":"<probe id or none>","questionType":"introductory|grand_tour|example|drilling|direct|hypothesis|contrast","input":{"type":"text|textarea|tags|select|radio","placeholder":"<hint>","options":["<for select/radio>"]},"suggestedAnswers":["<omit if open-ended>"]},"knowledgeStateUpdate":{"<domain>":{"<key>":"<value>"}},"domainCoverage":{"why":"...","work":"...","team":"...","bar":"...","codebase":"...","process":"..."}}]}`;

// ─── System Prompt ───────────────────────────────────────────────────────────

const BASE_SYSTEM_PROMPT = `You are a warm, curious interviewer. Your job: write ONE engaging question that advances the conversation. Talk like a human, not a checklist.

## Response Format
Respond with valid JSON matching this exact schema:
${RESPONSE_FORMAT}

Generate exactly ONE question per turn. Pick the single best question that advances coverage most efficiently.

## Brevity — Speed Matters
${BREVITY_RULES}`;

function buildSystemPrompt(participantRole: string | null): string {
  const base = BASE_SYSTEM_PROMPT;
  return injectPromptPatches(base, { participantRole: participantRole ?? undefined });
}

// ─── User Prompt Assembler ───────────────────────────────────────────────────

function formatExchanges(state: InterviewState): string {
  if (state.exchanges.length === 0) {
    return 'No exchanges yet. This is the FIRST question of the interview.';
  }

  return state.exchanges
    .map((ex) => {
      const lines = [`[${ex.questionId}] Agent: ${ex.acknowledgment}`, `  Q: ${ex.question}`];
      if (ex.answer) {
        lines.push(`  A: ${ex.answer}`);
      }
      return lines.join('\n');
    })
    .join('\n\n');
}

function buildUserPrompt(state: InterviewState): string {
  const parts: string[] = [];
  const plan = buildTurnPlan(state);

  // 1. Turn Plan (from deterministic planner)
  parts.push(buildPlanInstruction(plan));
  parts.push('');

  // 2. Probe Instruction (from probe librarian) — only in DISCOVERY phase
  const probeInstruction = buildProbeInstruction(
    typeof state.knowledgeState['_probesDelivered'] === 'number'
      ? (state.knowledgeState['_probesDelivered'] as number)
      : 0,
    state.participantRole,
  );
  if (probeInstruction) {
    parts.push(probeInstruction);
    parts.push('');
  }

  // 3. Role Context (from role adapter — derived from baseline, not hardcoded)
  parts.push(buildRoleInstruction(state.baseline, state.participantRole));
  parts.push('');

  // 4. Interviewing Principles (compact, per-phase)
  parts.push(buildPhasePrinciples(state.phase));
  parts.push('');

  // 5. Baseline data
  parts.push('BASELINE FORM DATA:');
  parts.push(JSON.stringify(state.baseline, null, 2));
  parts.push('');

  // 6. Budget & progress
  parts.push(`PHASE: ${state.phase}`);
  parts.push(`BUDGET: ${state.questionsAsked} of ${state.questionBudget} used. ${state.questionBudget - state.questionsAsked} remaining.`);
  if (state.questionBudget - state.questionsAsked <= 2) {
    parts.push('⚠ Budget nearly exhausted. Make remaining questions count.');
  }
  parts.push('');

  // 7. Domain coverage
  parts.push('DOMAIN COVERAGE:');
  parts.push(JSON.stringify(state.coverage, null, 2));
  parts.push('');

  // 8. Knowledge state
  if (Object.keys(state.knowledgeState).length > 0) {
    parts.push('KNOWLEDGE STATE (previously established facts):');
    parts.push(JSON.stringify(state.knowledgeState, null, 2));
    parts.push('');
  }

  // 9. Exchanges
  parts.push('EXCHANGES:');
  parts.push(formatExchanges(state));
  parts.push('');

  // 10. Closing instruction
  if (state.exchanges.length === 0) {
    parts.push('Generate your FIRST question. Since there is no previous answer to acknowledge, set the acknowledgment to a brief, warm introduction (1-2 sentences) that explains what you will do and why detail matters. Tailor the intro to who you are talking to.');
  } else {
    parts.push('Generate your next question. Acknowledge their answer first, then ask ONE question. No markdown fencing on the response.');
  }

  return parts.join('\n');
}

/**
 * Compact phase-specific principles injected into the user prompt.
 * These replace the bloated phase prompts from prompts.ts.
 */
function buildPhasePrinciples(phase: ConversationPhase): string {
  const principles: Record<ConversationPhase, string> = {
    CONTEXT: `## Phase Principles — CONTEXT
- Warm, low-pressure opening. 1-2 turns max.
- Introductory or Grand Tour question types only.
- Do NOT drill deep yet. Do NOT ask about requirements or skills.`,

    DISCOVERY: `## Phase Principles — DISCOVERY
- Laddering: when they name a tech or trait, ask WHY it matters. Reach root motivation.
- Stories beat abstractions: "Tell me about the last time..." > "How do you think about..."
- ONE probe per turn. Follow energy with at most ONE drilling follow-up, then move on.
- Never ask what you can infer. Reference what they said.
- If they give a short answer, ask ONE follow-up, then pivot.`,

    PRIORITIZE: `## Phase Principles — PRIORITIZE
- Force ranking, not listing: "If you could only keep 3 non-negotiables..."
- Contrast questions: "What's the cost of NOT having X?"
- Convergent thinking. Direct or Contrast question types.`,

    EVP_FRICTION: `## Phase Principles — EVP_FRICTION
- Demand-side flip: "Why would a great engineer leave their job for this one?"
- Mandatory friction probe: ask what would surprise a candidate or what's hardest.
- Frame friction as trade-off, not complaint.
- Direct or Hypothesis question types.`,

    SOUL: `## Phase Principles — SOUL
- Behavior over values. Never ask "what do you care about?" Always ask "what did you do?"
- Probe trauma and tradeoffs. The "who didn't work out" stories matter more than "who thrives."
- Stay curious, not diagnostic. You're hunting signal, not judging.
- ONE soul probe per turn. Follow energy with at most ONE drilling follow-up.
- If the participant gets vulnerable, acknowledge the trust — don't rush to the next probe.`,

    WRAP_UP: `## Phase Principles — WRAP_UP
- Brief summary + confirmation: "Here's what I'm taking away... Does that capture it?"
- ONE question. If they add something, acknowledge and stop.
- After this turn, synthesis runs.`,
  };

  return principles[phase];
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Build the complete prompt pair (system + user) from state.
 */
export function buildQuestionPrompt(state: InterviewState): {
  system: string;
  user: string;
} {
  return {
    system: buildSystemPrompt(state.participantRole),
    user: buildUserPrompt(state),
  };
}

// ─── Batch prompt builder ────────────────────────────────────────────────────

function buildBatchSystemPrompt(participantRole: string | null): string {
  const base = `You are a warm, curious interviewer. Your job: write a BATCH of engaging questions that advance the conversation. Talk like a human, not a checklist.

## Response Format
Respond with valid JSON matching this exact schema:

${BATCH_RESPONSE_FORMAT}

Generate the requested number of questions in the batch array.

## Brevity — Speed Matters
${BREVITY_RULES}`;

  return injectPromptPatches(base, { participantRole: participantRole ?? undefined });
}

function buildBatchUserPrompt(state: InterviewState, batchSize: number): string {
  const parts: string[] = [];
  const plan = buildTurnPlan(state);

  // Include turn plan + probe + role context (same as single-turn)
  parts.push(buildPlanInstruction(plan));
  parts.push('');

  const probeInstruction = buildProbeInstruction(
    typeof state.knowledgeState['_probesDelivered'] === 'number'
      ? (state.knowledgeState['_probesDelivered'] as number)
      : 0,
    state.participantRole,
  );
  if (probeInstruction) {
    parts.push(probeInstruction);
    parts.push('');
  }

  parts.push(buildRoleInstruction(state.baseline, state.participantRole));
  parts.push('');

  parts.push(buildPhasePrinciples(state.phase));
  parts.push('');

  parts.push('BASELINE FORM DATA:');
  parts.push(JSON.stringify(state.baseline, null, 2));
  parts.push('');

  parts.push(`PHASE: ${state.phase}`);
  parts.push(`BUDGET: ${state.questionsAsked} of ${state.questionBudget} used. ${state.questionBudget - state.questionsAsked} remaining.`);
  parts.push(`BATCH SIZE: Generate ${batchSize} questions.`);
  parts.push('');

  parts.push('DOMAIN COVERAGE:');
  parts.push(JSON.stringify(state.coverage, null, 2));
  parts.push('');

  if (Object.keys(state.knowledgeState).length > 0) {
    parts.push('KNOWLEDGE STATE (previously established facts):');
    parts.push(JSON.stringify(state.knowledgeState, null, 2));
    parts.push('');
  }

  parts.push('EXCHANGES:');
  parts.push(formatExchanges(state));
  parts.push('');

  if (state.exchanges.length === 0) {
    parts.push('Generate your FIRST batch. Since there is no previous answer to acknowledge, set batch[0].acknowledgment to a brief, warm introduction (1-2 sentences). Tailor the intro to who you are talking to.');
  } else {
    parts.push(`Generate the next ${batchSize} questions as a batch. batch[0] must acknowledge the most recent answer. The rest continue the interview. No markdown fencing on the response.`);
  }

  parts.push(`
Batch rules:
- Question 1 (batch[0]): MUST acknowledge the most recent answer (or introduce the interview if first turn).
- Questions 2-${batchSize} (batch[1..]): Continue the interview flow. Use empty string for acknowledgment unless there is a specific transition worth making.
- Each question should cover a different domain or probe angle so the batch is diverse.
- For each item, predict the knowledgeStateUpdate and domainCoverage that would result if the user gives a good, detailed answer.`);

  return parts.join('\n');
}

/**
 * Build a batch prompt that generates multiple questions in one LLM call.
 */
export function buildBatchPrompt(state: InterviewState, batchSize = 3): {
  system: string;
  user: string;
} {
  return {
    system: buildBatchSystemPrompt(state.participantRole),
    user: buildBatchUserPrompt(state, batchSize),
  };
}
