/**
 * Prompt Patch System — injects negative examples into interview prompts.
 *
 * Phase 3 of the question-quality feedback loop. Aggregated bad patterns from
 * `feedbackReport.ts` are stored as "patches" (negative examples) and injected
 * into system prompts at generation time.
 *
 * Current implementation is in-memory with a static seed set. Future evolution:
 * - Back patches by a database table (`prompt_patches`).
 * - Auto-generate patches from the weekly `question_quality_report` when a
 *   pattern exceeds a threshold (e.g. 3+ occurrences).
 * - Version patches alongside `RCD_SYNTHESIS_PROMPT_VERSION` for auditability.
 *
 * Usage:
 *   const patchedPrompt = injectPromptPatches(systemPrompt, { participantRole: 'TEAM_MEMBER' });
 */

import type { PromptPatch } from './types';

// ─── Static seed patches — these are the patterns we already know are bad.
// These will be expanded over time via the feedbackReport → auto-patch pipeline.

const SEED_PATCHES: PromptPatch[] = [
  {
    id: 'patch-role-confusion-001',
    ruleId: 'role_confusion_responsibilities',
    participantRoles: ['TEAM_MEMBER', 'HIRING_MANAGER', 'INTERNAL_RECRUITER', 'EXTERNAL_RECRUITER'],
    negativeExample:
      'What are your primary responsibilities as a team member for this Senior Frontend Engineer role?',
    correctedExample: 'What does a typical week look like for you on the team?',
    reason: 'The participant is not the person being hired. NEVER conflate participant role with the role title.',
    flagCount: 5,
    createdAt: '2026-05-02T09:00:00Z',
  },
  {
    id: 'patch-role-confusion-002',
    ruleId: 'role_confusion_self_referential',
    participantRoles: ['TEAM_MEMBER', 'HIRING_MANAGER', 'INTERNAL_RECRUITER', 'EXTERNAL_RECRUITER'],
    negativeExample:
      "You're a team member, which helps me understand the role's scope and responsibilities. What are your primary responsibilities?",
    correctedExample: "Thanks for joining. I'd love to hear what a typical week looks like on your team.",
    reason: 'Robotic acknowledgment that restates the participant role adds nothing. Start with warmth, not metadata.',
    flagCount: 5,
    createdAt: '2026-05-02T09:00:00Z',
  },
  {
    id: 'patch-too-vague-001',
    ruleId: 'early_turn_meta_question',
    participantRoles: undefined,
    negativeExample: "Can you give me an overview of this role's scope and responsibilities?",
    correctedExample: 'What made you decide to hire for this role right now?',
    reason: 'Generic meta-questions in early turns waste budget. Ground in specifics from turn one.',
    flagCount: 3,
    createdAt: '2026-05-02T09:00:00Z',
  },
  {
    id: 'patch-leading-001',
    ruleId: 'leading_question',
    participantRoles: undefined,
    negativeExample: 'Your team probably values clean code, right?',
    correctedExample: 'How does your team think about code quality in practice?',
    reason: 'Leading questions bias answers. Ask open-ended, neutral questions.',
    flagCount: 3,
    createdAt: '2026-05-02T09:00:00Z',
  },
  {
    id: 'patch-filler-001',
    ruleId: 'ack_stilted_role_reference',
    participantRoles: undefined,
    negativeExample: "That's really helpful!",
    correctedExample: "So the team runs blameless post-mortems — that tells me a lot about your culture.",
    reason: 'Filler praise wastes tokens and signals insincerity. Acknowledge specifics, not generic positivity.',
    flagCount: 3,
    createdAt: '2026-05-02T09:00:00Z',
  },
];

// ─── In-memory store (evolve to DB-backed later) ─────────────────────────────

let _patches: PromptPatch[] = [...SEED_PATCHES];

export function getPromptPatches(): PromptPatch[] {
  return [..._patches];
}

export function setPromptPatches(patches: PromptPatch[]): void {
  _patches = [...patches];
}

export function addPromptPatch(patch: PromptPatch): void {
  _patches.push(patch);
}

export function clearPromptPatches(): void {
  _patches = [];
}

// ─── Injection logic ─────────────────────────────────────────────────────────

export interface InjectOptions {
  /** Only include patches relevant to this role. If omitted, all patches apply. */
  participantRole?: string;
  /** Max patches to inject. Default: 10. */
  maxPatches?: number;
  /** Minimum flag count for a patch to be eligible. Default: 2. */
  minFlagCount?: number;
}

/**
 * Build the "Negative Examples" markdown block that gets appended to a system prompt.
 */
export function buildNegativeExamplesBlock(patches: PromptPatch[]): string {
  if (patches.length === 0) return '';

  const lines: string[] = ['', '## Negative Examples — Do NOT generate questions like these', ''];

  for (const p of patches) {
    lines.push(`- "${p.negativeExample}"`);
    lines.push(`  → Instead: "${p.correctedExample}"`);
    lines.push(`  (${p.reason}) [flagged ${p.flagCount}×]`);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Select patches relevant to the given options, sorted by flag count (desc).
 */
export function selectPatches(opts: InjectOptions = {}): PromptPatch[] {
  const { participantRole, maxPatches = 10, minFlagCount = 2 } = opts;

  let eligible = _patches.filter((p) => p.flagCount >= minFlagCount);

  if (participantRole) {
    eligible = eligible.filter(
      (p) => !p.participantRoles || p.participantRoles.includes(participantRole),
    );
  }

  eligible.sort((a, b) => b.flagCount - a.flagCount);
  return eligible.slice(0, maxPatches);
}

/**
 * Inject negative-example patches into a system prompt string.
 *
 * Looks for the "## Negative Examples" or "## Negative Space" section and
 * appends the block there. If neither exists, appends at the end.
 */
export function injectPromptPatches(prompt: string, opts: InjectOptions = {}): string {
  const patches = selectPatches(opts);
  if (patches.length === 0) return prompt;

  const block = buildNegativeExamplesBlock(patches);

  // Try to find an existing Negative Examples / Negative Space section
  const markers = [
    '## Negative Examples',
    '## Negative Space',
    '## Response Format',
    '## Question Types',
  ];

  for (const marker of markers) {
    const idx = prompt.indexOf(marker);
    if (idx !== -1) {
      // Insert the block right before this section
      return prompt.slice(0, idx) + block + '\n' + prompt.slice(idx);
    }
  }

  // Fallback: append to end
  return prompt + block;
}
