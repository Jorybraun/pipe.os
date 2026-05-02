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

const RESPONSE_FORMAT = `{
  "reasoning": "<max 20 words. One sentence.",
  "acknowledgment": "<1 sentence acknowledging their answer. No filler praise.>",
  "question": {
    "id": "<sequential: q-1, q-2, ...>",
    "text": "<the actual question, under 15 words ideal>",
    "goal": "<specific, measurable goal this question achieves — under 10 words>",
    "expectedCoverage": {
      "domain": "<why | work | team | bar | codebase | process>",
      "from": "<none | sparse | partial | covered | deep>",
      "to": "<none | sparse | partial | covered | deep>"
    },
    "probeAlignment": "<which calibrated probe this serves, or 'none'>",
    "questionType": "<introductory | grand_tour | example | drilling | direct | hypothesis | contrast>",
    "input": {
      "type": "<text | textarea | tags | select | radio>",
      "placeholder": "<optional hint text>",
      "options": ["<only for select/radio>"]
    },
    "suggestedAnswers": ["<2-3 short realistic example answers. Omit if open-ended.>"]
  },
  "knowledgeStateUpdate": {
    "<domain>": { "<key>": "<value extracted from their answer>" }
  },
  "domainCoverage": {
    "why": "<none | sparse | partial | covered | deep>",
    "work": "<none | sparse | partial | covered | deep>",
    "team": "<none | sparse | partial | covered | deep>",
    "bar": "<none | sparse | partial | covered | deep>",
    "codebase": "<none | sparse | partial | covered | deep>",
    "process": "<none | sparse | partial | covered | deep>"
  }
}`;

const BREVITY_RULES = `- reasoning: max 20 words. One sentence.
- acknowledgment: max 1 sentence. No filler.
- question.text: under 15 words.
- goal: under 10 words.
- suggestedAnswers: omit unless the question truly benefits from examples.
- knowledgeStateUpdate: only include keys that are NEW or CHANGED this turn.`;

// ─── Batch generation (stack architecture) ───────────────────────────────────

const BATCH_RESPONSE_FORMAT = `{
  "reasoning": "<max 20 words. One sentence.",
  "batch": [
    {
      "acknowledgment": "<1 sentence acknowledging their answer. No filler praise.>",
      "question": {
        "id": "<sequential: q-N, q-N+1, ...>",
        "text": "<the actual question, under 15 words ideal>",
        "goal": "<specific, measurable goal — under 10 words>",
        "expectedCoverage": {
          "domain": "<why | work | team | bar | codebase | process>",
          "from": "<none | sparse | partial | covered | deep>",
          "to": "<none | sparse | partial | covered | deep>"
        },
        "probeAlignment": "<which calibrated probe this serves, or 'none'>",
        "questionType": "<introductory | grand_tour | example | drilling | direct | hypothesis | contrast>",
        "input": {
          "type": "<text | textarea | tags | select | radio>",
          "placeholder": "<optional hint text>",
          "options": ["<only for select/radio>"]
        },
        "suggestedAnswers": ["<2-3 short realistic example answers. Omit if open-ended.>"]
      },
      "knowledgeStateUpdate": {
        "<domain>": { "<key>": "<value extracted from their answer>" }
      },
      "domainCoverage": {
        "why": "<none | sparse | partial | covered | deep>",
        "work": "<none | sparse | partial | covered | deep>",
        "team": "<none | sparse | partial | covered | deep>",
        "bar": "<none | sparse | partial | covered | deep>",
        "codebase": "<none | sparse | partial | covered | deep>",
        "process": "<none | sparse | partial | covered | deep>"
      }
    }
  ]
}`;

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

## Negative Examples — Questions that were flagged as bad

These are real questions that users flagged. Do NOT generate questions like these:
- "What are your primary responsibilities as a team member for this Senior Frontend Engineer role?" (Role confusion — the team member is not the hire.)
- "You're a team member, which helps me understand the role's scope and responsibilities. What are your primary responsibilities?" (Robotic acknowledgment + role confusion.)
- "Can you give me an overview of this role's scope and responsibilities?" (Too generic for a contextual interview.)
- "Your team probably values clean code, right?" (Leading question.)
- "That's really helpful!" (Filler praise — never do this.)

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

## Negative Examples — Questions that were flagged as bad

These are real questions that users flagged. Do NOT generate questions like these:
- "What are your primary responsibilities as a team member for this Senior Frontend Engineer role?" (Role confusion — the team member is not the hire.)
- "You're a team member, which helps me understand the role's scope and responsibilities. What are your primary responsibilities?" (Robotic acknowledgment + role confusion.)
- "Can you give me an overview of this role's scope and responsibilities?" (Too generic for a contextual interview.)
- "Your team probably values clean code, right?" (Leading question.)
- "That's really helpful!" (Filler praise — never do this.)

## Response Format

You MUST respond with valid JSON matching this exact schema:

${BATCH_RESPONSE_FORMAT}

## Example Response

Here is a concrete example of a valid response for batchSize=2. Follow this structure exactly:

{
  "reasoning": "User mentioned they lead a 12-person platform team. I need to understand their engineering practices and how they handle on-call before drilling into specific tech.",
  "batch": [
    {
      "acknowledgment": "A 12-person platform team is substantial — that gives me a good sense of scale.",
      "question": {
        "id": "q-3",
        "text": "How do you structure on-call rotations across the platform team?",
        "goal": "Understand operational burden distribution",
        "expectedCoverage": {
          "domain": "process",
          "from": "sparse",
          "to": "covered"
        },
        "probeAlignment": "on-call-rotation-structure",
        "questionType": "direct",
        "input": {
          "type": "textarea",
          "placeholder": "Describe the rotation schedule, escalation path, and how you handle pager fatigue."
        },
        "suggestedAnswers": []
      },
      "knowledgeStateUpdate": {
        "process": { "onCallRotation": "pending" }
      },
      "domainCoverage": {
        "why": "partial",
        "work": "covered",
        "team": "covered",
        "bar": "sparse",
        "codebase": "partial",
        "process": "covered"
      }
    },
    {
      "acknowledgment": "",
      "question": {
        "id": "q-4",
        "text": "What does your code review process look like for platform changes?",
        "goal": "Understand quality gate practices",
        "expectedCoverage": {
          "domain": "bar",
          "from": "sparse",
          "to": "covered"
        },
        "probeAlignment": "code-review-process",
        "questionType": "direct",
        "input": {
          "type": "textarea",
          "placeholder": "Who reviews, what tools you use, and what typically gets flagged."
        },
        "suggestedAnswers": []
      },
      "knowledgeStateUpdate": {
        "bar": { "codeReviewProcess": "pending" }
      },
      "domainCoverage": {
        "why": "partial",
        "work": "covered",
        "team": "covered",
        "bar": "covered",
        "codebase": "partial",
        "process": "covered"
      }
    }
  ]
}

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
