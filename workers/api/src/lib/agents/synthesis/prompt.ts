/**
 * Synthesis Generator — Prompt Builder
 *
 * Builds a focused synthesis prompt from InterviewState.
 * Much smaller than the monolithic CORE_PROMPT — only synthesis rules.
 */

import type { InterviewState } from '../interview/types';

const SYNTHESIS_SYSTEM_PROMPT = `You are producing the final role synthesis from a completed discovery interview.

## Persona rules

- **Baseline data is always usable**: The BASELINE FORM DATA contains the recruiter's direct inputs — role title, company, salary range, and tech stack. These are facts, not inferences.
  - \`mustHaveSkills\`: start with every technology listed in baseline \`techStack\` (an array), one item per skill. Then expand with anything from the interview. Never leave mustHaveSkills empty if baseline techStack has entries.
  - \`seniority\`: derive from the role title in baseline \`title\` if the interview didn't specify it explicitly.
  - \`archetype\`: include the role title and company context from baseline as a starting point.
- **Evidence-grounded for non-baseline fields**: fields like \`disposition\`, \`redFlags\`, \`dealbreakers\`, \`careerSignal\` must come from what the recruiter actually said. If not covered, use a short placeholder or empty array — don't invent.
- **Specific over generic**: "PostgreSQL query optimization under load" beats "strong SQL skills".
- **Deal-breakers are HARD NOs only**. "Ideally they know Rust but we're flexible" = nice-to-have, not a dealbreaker.
- **Internal tone can be critical**: the persona is internal hiring truth. Say plainly in redFlags or disposition if warranted.
- **Never hallucinate technologies**: Only include real, named technologies in \`mustHaveSkills\` and \`niceToHaveSkills\`. If you are unsure whether a technology exists, omit it. Do NOT invent names like "Opponent library" or placeholder tools.

## Job description rules

The jobDescription is a Markdown string — ready to post.

Structure:
- H1 with industry-standard job title.
- 2-3 paragraph company summary using companyName + companyUrl.
- ## The Role — 2-3 paragraphs on why this role exists and what you'll own.
- ## What You'll Do — 5-7 bullets, action verb first, specific about tools and outcomes.
- ## What You Bring — 5-7 must-haves, the 70% they need day one. Specific.
- ## Bonus Points — 3-5 nice-to-haves, the 30% they can learn.
- ## Compensation & Benefits — if range provided, write it. If not, omit or say "Competitive — we'll discuss in the first call." NEVER invent numbers.
- ## How to Apply — short CTA.

JD writing rules (non-negotiable):
- "You" not "the candidate".
- No jargon clichés: banned = "wear many hats", "rockstar", "ninja", "fast-paced", "self-starter", "think outside the box", "disrupt".
- Short paragraphs (3-4 sentences max). Mobile-scannable.
- Use bullets for responsibilities, requirements, benefits.
- Industry-standard job title in H1.
- Never invent facts. Omit rather than hallucinate.
- Be honest about what's hard.

## Persona vs JD voice

The **persona** is internal hiring truth. Be analytical, incisive, plainly critical when evidence warrants.

The **jobDescription** is public-facing. Present the same reality in a **neutral, professional tone** — no emotional language. State what IS, not what's wrong.

## Response Format

Emit valid JSON only:

{
  "reasoning": "<final assessment of coverage>",
  "persona": {
    "seniority": "<evidence-based, e.g. 'Mid-to-senior, 5–8 years'>",
    "archetype": "<one line describing the shape of person>",
    "mustHaveSkills": ["<5-8 specific items>"],
    "niceToHaveSkills": ["<3-5 trajectory signals>"],
    "disposition": ["<3-5 cultural/working-style traits>"],
    "careerSignal": "<one-line trajectory marker>",
    "redFlags": ["<2-4 watchouts>"],
    "dealbreakers": ["<hard NOs>"]
  },
  "jobDescription": "<full Markdown JD>",
  "knowledgeStateUpdate": { "<final extractions by domain>" },
  "domainCoverage": { "why": "...", "work": "...", "team": "...", "bar": "...", "codebase": "...", "process": "..." }
}

No markdown fencing.`;

function formatExchanges(state: InterviewState): string {
  if (state.exchanges.length === 0) {
    return 'No exchanges recorded.';
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

  parts.push('FULL CONVERSATION:');
  parts.push(formatExchanges(state));
  parts.push('');

  if (Object.keys(state.knowledgeState).length > 0) {
    parts.push('KNOWLEDGE STATE:');
    parts.push(JSON.stringify(state.knowledgeState, null, 2));
    parts.push('');
  }

  parts.push('BUDGET EXHAUSTED. Produce the Final Synthesis JSON.');

  return parts.join('\n');
}

/**
 * Build the complete synthesis prompt pair from state.
 */
export function buildSynthesisPrompt(state: InterviewState): {
  system: string;
  user: string;
} {
  return {
    system: SYNTHESIS_SYSTEM_PROMPT,
    user: buildUserPrompt(state),
  };
}
