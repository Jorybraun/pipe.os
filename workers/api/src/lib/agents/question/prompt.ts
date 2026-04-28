/**
 * Question Generator — Prompt Builder
 *
 * Builds a concise, deterministic prompt from InterviewState.
 * No full conversation history duplication — state IS the context.
 */

import type { ConversationPhase, DomainCoverage } from '../../../types';
import type { InterviewState } from '../interview/types';
import { selectPhasePrompt } from '../../agents/roleDiscovery/prompts';

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

function buildSystemPrompt(participantRole: string | null, phase: ConversationPhase): string {
  const phasePrompt = selectPhasePrompt(phase, participantRole ?? undefined);

  return `You are a senior technical recruiting partner conducting a role discovery interview. Your goal is to understand this role deeply enough that downstream agents can generate tailored technical assessments. Talk like a human, not a methodology checklist.

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

## Response Format

You MUST respond with valid JSON matching this exact schema:

${RESPONSE_FORMAT}

Generate exactly ONE question per turn. Pick the single best question that advances coverage most efficiently.

## Brevity — Speed Matters
${BREVITY_RULES}`;
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
