/**
 * Domain Question Generation Prompts
 *
 * Builds prompts that ask an LLM to generate N questions for a specific domain.
 * Replaces the hardcoded probe librarian with dynamic, context-aware generation.
 */

import type { Domain, DomainCoverage } from '../../../types';
import type { InterviewState } from '../interview/types';
import { buildRoleInstruction } from './roleAdapter';

// ─── Domain descriptions ─────────────────────────────────────────────────────

interface DomainGuide {
  label: string;
  whatToSurface: string[];
  negativeSignalPrompt: string;
  style: 'technical' | 'cultural' | 'strategic';
}

const DOMAIN_GUIDES: Record<Domain, DomainGuide> = {
  team: {
    label: 'team culture and dynamics',
    whatToSurface: [
      'How the team actually works day-to-day',
      'Communication norms and conflict resolution',
      'Psychological safety signals',
      'Who thrives vs who struggles',
      'Hidden values not in the job description',
    ],
    negativeSignalPrompt: 'Include 1-2 questions that surface what does NOT work on this team — who struggles, what creates friction, what people complain about.',
    style: 'cultural',
  },
  work: {
    label: 'day-to-day work and responsibilities',
    whatToSurface: [
      'Actual daily activities vs job description',
      'Autonomy level and decision-making scope',
      'Collaboration patterns and handoffs',
      'What success looks like in the first 90 days',
      'The gap between expectation and reality',
    ],
    negativeSignalPrompt: 'Include 1-2 questions that surface the hardest parts of the job — what burns people out, what is thankless, what takes more energy than expected.',
    style: 'technical',
  },
  bar: {
    label: 'hiring bar and seniority expectations',
    whatToSurface: [
      "What 'senior' actually means on this team",
      'The gap between a good hire and a great one',
      'Technical depth vs breadth expectations',
      'Ownership scope and accountability',
      'What would make someone fail probation',
    ],
    negativeSignalPrompt: 'Include 1-2 questions that surface what the team has compromised on before — hires they regretted, standards they lowered under pressure.',
    style: 'technical',
  },
  codebase: {
    label: 'codebase and technical environment',
    whatToSurface: [
      'Stack, architecture, and technical debt profile',
      'Code review culture and quality standards',
      'Testing practices and definition of done',
      'On-call and operational expectations',
      'The parts of the stack that scare new hires',
    ],
    negativeSignalPrompt: 'Include 1-2 questions that surface technical pain — legacy systems, brittleness, areas where the team has given up on cleanliness.',
    style: 'technical',
  },
  process: {
    label: 'engineering process and shipping cadence',
    whatToSurface: [
      'How ideas become shipped features',
      'Planning, estimation, and prioritization',
      'Incident response and post-mortem culture',
      'Stakeholder interaction patterns',
      'What slows the team down most',
    ],
    negativeSignalPrompt: 'Include 1-2 questions that surface process dysfunction — meetings that waste time, decisions that get revisited, deadlines that are unrealistic.',
    style: 'technical',
  },
  why: {
    label: 'role purpose and strategic context',
    whatToSurface: [
      'Why this role exists now (business context)',
      'What happens if this hire is delayed or wrong',
      'How this role connects to company strategy',
      'The real urgency behind the hire',
      'What success looks like at 6 and 12 months',
    ],
    negativeSignalPrompt: 'Include 1-2 questions that surface organizational risk — re-orgs, funding uncertainty, leadership churn, strategic pivots.',
    style: 'strategic',
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatExchanges(state: InterviewState): string {
  if (state.exchanges.length === 0) {
    return 'No exchanges yet. This is the first domain being explored.';
  }
  return state.exchanges
    .map((ex) => {
      const lines = [`[${ex.questionId}] Interviewer: ${ex.acknowledgment}`, `  Q: ${ex.question}`];
      if (ex.answer) {
        lines.push(`  A: ${ex.answer}`);
      }
      return lines.join('\n');
    })
    .join('\n\n');
}

function formatDomainKnowledge(state: InterviewState, domain: Domain): string {
  const ks = state.knowledgeState;
  const domainKs = ks[domain];
  if (!domainKs || Object.keys(domainKs).length === 0) {
    return 'Nothing established yet for this domain.';
  }
  return Object.entries(domainKs)
    .map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`)
    .join('\n');
}

function buildDomainSystemPrompt(): string {
  return `You are a precise, curious interview question generator. Your job: write a BATCH of questions for ONE specific domain of a role discovery interview.

Rules:
- Each question should be answerable with a story or concrete example
- Avoid abstract "what do you think about..." questions
- Questions should build on each other (start broad, get specific)
- Include negative-signal probes that surface friction, pain, or failure
- Keep questions warm and conversational, not interrogative
- Return valid JSON matching the schema exactly`;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export interface DomainGenerationPrompt {
  system: string;
  user: string;
}

/**
 * Build a prompt pair that generates `count` questions for a specific domain.
 */
export function buildDomainGenerationPrompt(
  domain: Domain,
  state: InterviewState,
  count: number,
  opts: { style?: 'technical' | 'soul' } = {},
): DomainGenerationPrompt {
  const guide = DOMAIN_GUIDES[domain];
  const roleInstruction = buildRoleInstruction(state.baseline, state.participantRole);
  const style = opts.style ?? guide.style;

  const system = buildDomainSystemPrompt();

  const parts: string[] = [];

  parts.push(`## Domain Focus: ${guide.label.toUpperCase()}`);
  parts.push(`Generate ${count} questions about ${guide.label}.`);
  parts.push('');

  parts.push('## What to Surface');
  for (const item of guide.whatToSurface) {
    parts.push(`- ${item}`);
  }
  parts.push('');

  parts.push('## Negative Signal');
  parts.push(guide.negativeSignalPrompt);
  parts.push('');

  if (style === 'soul') {
    parts.push(`## Soul Style (behavior over values)`);
    parts.push('- Probe trauma and tradeoffs, not abstract values');
    parts.push('- Ask "what did you do?" not "what do you care about?"');
    parts.push("- The 'who didn't work out' stories matter more than 'who thrives'");
    parts.push('');
  }

  parts.push(roleInstruction);
  parts.push('');

  parts.push('## Existing Knowledge for This Domain');
  parts.push(formatDomainKnowledge(state, domain));
  parts.push('');

  parts.push('## Conversation History');
  parts.push(formatExchanges(state));
  parts.push('');

  parts.push(`## Response Format
Return valid JSON matching this exact schema:
{"questions":[{"id":"dq-1","text":"<under 20 words, warm and conversational>","intent":"<what this question reveals, 1 sentence>","drillingHints":["<hint 1>","<hint 2>"],"ladderingTarget":"<what to ladder toward if energy is high>"}]}

Generate exactly ${count} questions in the questions array.`);

  return { system, user: parts.join('\n') };
}
