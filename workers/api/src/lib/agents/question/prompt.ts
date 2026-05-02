/**
 * Question Generator — Prompt Builder
 *
 * Builds a concise, deterministic prompt from InterviewState.
 * No full conversation history duplication — state IS the context.
 */

import type { ConversationPhase, DomainCoverage } from '../../../types';
import type { InterviewState } from '../interview/types';
import { selectPhasePrompt } from '../../agents/roleDiscovery/prompts';
import { injectPromptPatches } from './promptPatch';

const RESPONSE_FORMAT = `{"reasoning":"<20 words max>","acknowledgment":"<1 sentence>","question":{"id":"q-N","text":"<under 15 words>","goal":"<under 10 words>","expectedCoverage":{"domain":"why|work|team|bar|codebase|process","from":"none|sparse|partial|covered|deep","to":"none|sparse|partial|covered|deep"},"probeAlignment":"<probe or none>","questionType":"introductory|grand_tour|example|drilling|direct|hypothesis|contrast","input":{"type":"text|textarea|tags|select|radio","placeholder":"<hint>","options":["<for select/radio>"]},"suggestedAnswers":["<omit if open-ended>"]},"knowledgeStateUpdate":{"<domain>":{"<key>":"<value>"}},"domainCoverage":{"why":"...","work":"...","team":"...","bar":"...","codebase":"...","process":"..."}}`;

const BREVITY_RULES = `- reasoning: max 20 words. One sentence.
- acknowledgment: max 1 sentence. No filler.
- question.text: under 15 words.
- goal: under 10 words.
- suggestedAnswers: omit unless the question truly benefits from examples.
- knowledgeStateUpdate: only include keys that are NEW or CHANGED this turn.`;

// ─── Batch generation (stack architecture) ───────────────────────────────────

const BATCH_RESPONSE_FORMAT = `{"reasoning":"<20 words max>","batch":[{"acknowledgment":"<1 sentence>","question":{"id":"q-N","text":"<under 15 words>","goal":"<under 10 words>","expectedCoverage":{"domain":"why|work|team|bar|codebase|process","from":"none|sparse|partial|covered|deep","to":"none|sparse|partial|covered|deep"},"probeAlignment":"<probe or none>","questionType":"introductory|grand_tour|example|drilling|direct|hypothesis|contrast","input":{"type":"text|textarea|tags|select|radio","placeholder":"<hint>","options":["<for select/radio>"]},"suggestedAnswers":["<omit if open-ended>"]},"knowledgeStateUpdate":{"<domain>":{"<key>":"<value>"}},"domainCoverage":{"why":"...","work":"...","team":"...","bar":"...","codebase":"...","process":"..."}}]}`;

function buildSystemPrompt(participantRole: string | null, phase: ConversationPhase): string {
  const phasePrompt = selectPhasePrompt(phase, participantRole ?? undefined);

  const basePrompt = `You are a senior technical recruiting partner conducting a role discovery interview. Your goal is to understand this role deeply enough that downstream agents can generate tailored technical assessments. Talk like a human, not a methodology checklist.

${phasePrompt}

## Question Types

| Type | When to Use |
|---|---|
| Introductory | Opening (turns 1-2) — establish context, calibrate |
| Grand Tour | Early (turns 2-4) — get the big picture |
| Example | Mid-conversation — move from abstract to concrete |
| Drilling | When user shows energy on a topic |
| Direct | After rapport is built — get specific facts efficiently |
| Hypothesis | Later turns — validate understanding, show listening |
| Contrast | Closing turns — surface hidden preferences via opposites |

## Negative Space — What You Must NEVER Do

- No leading questions: "Your team probably values clean code, right?"
- No stacking multiple questions: one question per turn, always
- No filler praise: "That's really helpful!" — acknowledge what you learned, then move forward
- No asking what you can infer: if they said "HIPAA-compliant healthcare platform," don't ask "Is security important?"
- No repeating answered questions: reference what they said
- No asking the user to do the agent's job: form an opinion and present it for validation
- No role confusion: NEVER ask a team member about their "responsibilities for this role" — they are not the person being hired. NEVER start an acknowledgment with "You're a [role], which helps me understand..." — it's robotic and adds nothing.

## Phrasing Principles

(Injected dynamically from feedback loop — see promptPatch.ts)

## Response Format

You MUST respond with valid JSON matching this exact schema:

${RESPONSE_FORMAT}

Generate exactly ONE question per turn. Pick the single best question that advances coverage most efficiently.

## Brevity — Speed Matters
${BREVITY_RULES}`;

  return injectPromptPatches(basePrompt, { participantRole: participantRole ?? undefined });
}

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

  parts.push('BASELINE FORM DATA:');
  parts.push(JSON.stringify(state.baseline, null, 2));
  parts.push('');

  if (state.participantRole) {
    parts.push(`PARTICIPANT ROLE: ${state.participantRole}`);
    parts.push('');
  }

  parts.push(`PHASE: ${state.phase}`);
  parts.push(`BUDGET: ${state.questionsAsked} of ${state.questionBudget} used. ${state.questionBudget - state.questionsAsked} remaining.`);
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
    parts.push('Generate your FIRST question. Since there is no previous answer to acknowledge, set the acknowledgment to a brief, warm introduction (1-2 sentences) that explains what you will do and why detail matters. Tailor the intro to who you are talking to.');
  } else {
    parts.push('Generate your next question. Acknowledge their answer first, then ask ONE question. No markdown fencing on the response.');
  }

  return parts.join('\n');
}

/**
 * Build the complete prompt pair (system + user) from state.
 */
export function buildQuestionPrompt(state: InterviewState): {
  system: string;
  user: string;
} {
  return {
    system: buildSystemPrompt(state.participantRole, state.phase),
    user: buildUserPrompt(state),
  };
}

// ─── Batch prompt builder ────────────────────────────────────────────────────

function buildBatchSystemPrompt(participantRole: string | null, phase: ConversationPhase, batchSize: number): string {
  const phasePrompt = selectPhasePrompt(phase, participantRole ?? undefined);

  const basePrompt = `You are a senior technical recruiting partner conducting a role discovery interview. Your goal is to understand this role deeply enough that downstream agents can generate tailored technical assessments. Talk like a human, not a methodology checklist.

${phasePrompt}

## Question Types

| Type | When to Use |
|---|---|
| Introductory | Opening (turns 1-2) — establish context, calibrate |
| Grand Tour | Early (turns 2-4) — get the big picture |
| Example | Mid-conversation — move from abstract to concrete |
| Drilling | When user shows energy on a topic |
| Direct | After rapport is built — get specific facts efficiently |
| Hypothesis | Later turns — validate understanding, show listening |
| Contrast | Closing turns — surface hidden preferences via opposites |

## Negative Space — What You Must NEVER Do

- No leading questions: "Your team probably values clean code, right?"
- No stacking multiple questions inside one question text: each question.text must be a single question
- No filler praise: "That's really helpful!" — acknowledge what you learned, then move forward
- No asking what you can infer: if they said "HIPAA-compliant healthcare platform," don't ask "Is security important?"
- No repeating answered questions: reference what they said
- No asking the user to do the agent's job: form an opinion and present it for validation
- No role confusion: NEVER ask a team member about their "responsibilities for this role" — they are not the person being hired. NEVER start an acknowledgment with "You're a [role], which helps me understand..." — it's robotic and adds nothing.

## Phrasing Principles

(Injected dynamically from feedback loop — see promptPatch.ts)

## Response Format

You MUST respond with valid JSON matching this exact schema:

${BATCH_RESPONSE_FORMAT}

## Example

{"reasoning":"User leads a 12-person platform team.","batch":[{"acknowledgment":"A 12-person team is substantial.","question":{"id":"q-3","text":"How do you structure on-call?","goal":"Understand operational burden","expectedCoverage":{"domain":"process","from":"sparse","to":"covered"},"probeAlignment":"on-call","questionType":"direct","input":{"type":"textarea"},"suggestedAnswers":[]},"knowledgeStateUpdate":{"process":{"onCall":"pending"}},"domainCoverage":{"why":"partial","work":"covered","team":"covered","bar":"sparse","codebase":"partial","process":"covered"}}]}

Generate exactly ${batchSize} questions in the batch array.

- Question 1 (batch[0]): MUST acknowledge the most recent answer (or introduce the interview if this is the first turn).
- Questions 2-${batchSize} (batch[1..]): Continue the interview flow. Use an empty string for acknowledgment unless there is a specific transition worth making.
- Each question should cover a different domain or probe angle so the batch is diverse.
- For each item, predict the knowledgeStateUpdate and domainCoverage that would result if the user gives a good, detailed answer.

## Brevity — Speed Matters
${BREVITY_RULES}`;

  return injectPromptPatches(basePrompt, { participantRole: participantRole ?? undefined });
}

function buildBatchUserPrompt(state: InterviewState, batchSize: number): string {
  const parts: string[] = [];

  parts.push('BASELINE FORM DATA:');
  parts.push(JSON.stringify(state.baseline, null, 2));
  parts.push('');

  if (state.participantRole) {
    parts.push(`PARTICIPANT ROLE: ${state.participantRole}`);
    parts.push('');
  }

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
    parts.push('Generate your FIRST batch. Since there is no previous answer to acknowledge, set batch[0].acknowledgment to a brief, warm introduction (1-2 sentences) that explains what you will do and why detail matters. Tailor the intro to who you are talking to.');
  } else {
    parts.push(`Generate the next ${batchSize} questions as a batch. batch[0] must acknowledge the most recent answer. The rest continue the interview. No markdown fencing on the response.`);
  }

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
    system: buildBatchSystemPrompt(state.participantRole, state.phase, batchSize),
    user: buildBatchUserPrompt(state, batchSize),
  };
}
