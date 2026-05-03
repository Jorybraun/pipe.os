/**
 * Mode-1 Profile Builder — Role-agnostic probe bank.
 *
 * These probes elicit career history, behavioral depth, cultural signal,
 * technical depth, motivation, and context. They are NOT BARS-scored.
 * Coverage is the goal: at least 2 probes per dimension, 8–15 total turns.
 *
 * Probes are stored in `profile_probe_bank` table (migration 0069) so they
 * can be curated without code changes. This module exports the curated seed
 * bank and a coverage-driven selector.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type ProfileProbeDimension =
  | 'career_history'
  | 'behavioral_depth'
  | 'cultural'
  | 'technical'
  | 'motivation'
  | 'context';

export const PROFILE_PROBE_DIMENSIONS: readonly ProfileProbeDimension[] = [
  'career_history',
  'behavioral_depth',
  'cultural',
  'technical',
  'motivation',
  'context',
] as const;

export interface ProfileProbe {
  id: string;
  dimension: ProfileProbeDimension;
  text: string;
  expectedSlots: string[];
  maxProbes: number;
  probes: Record<string, string>;
  tags?: string[];
  sortOrder: number;
}

// ─── Curated seed bank ───────────────────────────────────────────────────────
// Mirrors the table schema. When the table is populated, the selector reads
// from DB. When empty (or in tests), this seed bank is the fallback.

const SEED_BANK: ProfileProbe[] = [
  // ─── Career History (3) ────────────────────────────────────────────────────
  {
    id: 'career-history-001',
    dimension: 'career_history',
    text: "Walk me through your career from your first job to now. For each role, tell me the company, your title, how long you were there, and what you were actually responsible for.",
    expectedSlots: ['S', 'T'],
    maxProbes: 2,
    probes: {
      missing_company: 'What was the company or organization?',
      missing_role: 'What was your title or role there?',
      missing_duration: 'How long were you in that role?',
      vague_scope: 'What were you actually responsible for day-to-day?',
    },
    tags: ['timeline', 'chronology'],
    sortOrder: 1,
  },
  {
    id: 'career-history-002',
    dimension: 'career_history',
    text: "Tell me about the biggest jump in responsibility you've had — moving from one level to the next. What changed, and how did you handle it?",
    expectedSlots: ['S', 'T', 'A', 'R'],
    maxProbes: 2,
    probes: {
      missing_A: 'What did you specifically do to step up?',
      missing_R: 'How did it work out? What was different afterwards?',
      vague_scope: 'What was your scope before versus after?',
    },
    tags: ['growth', 'promotion'],
    sortOrder: 2,
  },
  {
    id: 'career-history-003',
    dimension: 'career_history',
    text: "Looking at your most recent role: what did you spend most of your time on, and what would you have spent more time on if you could?",
    expectedSlots: ['S', 'T', 'A'],
    maxProbes: 2,
    probes: {
      missing_A: 'What did your typical week actually look like?',
      vague_scope: 'What percentage of your time went to each area?',
    },
    tags: ['recent-role', 'time-allocation'],
    sortOrder: 3,
  },

  // ─── Behavioral Depth (3) ──────────────────────────────────────────────────
  {
    id: 'behavioral-depth-001',
    dimension: 'behavioral_depth',
    text: "At your current or most recent company, tell me about a time you had to figure something out with very little guidance. What was the situation and what did you do?",
    expectedSlots: ['S', 'T', 'A', 'R'],
    maxProbes: 2,
    probes: {
      missing_A: 'What did you specifically try first? Walk me through your thinking.',
      missing_R: 'How did it end? What would you do differently?',
      vague_scope: 'How much time did you have, and what constraints were you under?',
    },
    tags: ['autonomy', 'problem-solving'],
    sortOrder: 1,
  },
  {
    id: 'behavioral-depth-002',
    dimension: 'behavioral_depth',
    text: "Tell me about a project that didn't go the way you hoped. What happened, what was your part in it, and what did you learn?",
    expectedSlots: ['S', 'T', 'A', 'R'],
    maxProbes: 2,
    probes: {
      missing_A: 'What specifically did you do when things started going sideways?',
      missing_R: 'What was the actual outcome? Be honest — not every project succeeds.',
      cliche_or_generic: 'I want the real one, not a sanitized version. What actually went wrong?',
    },
    tags: ['failure', 'learning'],
    sortOrder: 2,
  },
  {
    id: 'behavioral-depth-003',
    dimension: 'behavioral_depth',
    text: "Describe a time you had to convince someone — a teammate, a manager, a stakeholder — to change their mind. How did you approach it?",
    expectedSlots: ['S', 'T', 'A', 'R'],
    maxProbes: 2,
    probes: {
      missing_A: 'What did you actually say or do to persuade them?',
      missing_R: 'Did they change their mind? Where did it land?',
      passive_voice: 'Who said what? I want your words and theirs.',
    },
    tags: ['influence', 'communication'],
    sortOrder: 3,
  },

  // ─── Cultural (3) ──────────────────────────────────────────────────────────
  {
    id: 'cultural-001',
    dimension: 'cultural',
    text: "Tell me about a time you took ownership of something that wasn't explicitly your job. What was it, and what happened?",
    expectedSlots: ['S', 'T', 'A', 'R'],
    maxProbes: 2,
    probes: {
      missing_A: 'What did you specifically do?',
      missing_R: 'How did you know it worked?',
      unclear_scope: 'Was this your responsibility? How did you decide to get involved?',
    },
    tags: ['ownership', 'initiative'],
    sortOrder: 1,
  },
  {
    id: 'cultural-002',
    dimension: 'cultural',
    text: "Tell me about a time you disagreed with a teammate on how to do something. How did you handle it?",
    expectedSlots: ['S', 'T', 'A', 'R'],
    maxProbes: 2,
    probes: {
      missing_A: 'What did you actually say or do?',
      missing_R: 'How did it resolve?',
      unclear_scope: 'What were the two positions exactly?',
    },
    tags: ['collaboration', 'disagreement'],
    sortOrder: 2,
  },
  {
    id: 'cultural-003',
    dimension: 'cultural',
    text: "Tell me about the last time you realized you were wrong about something important at work. How did you find out, and what did you do?",
    expectedSlots: ['S', 'T', 'A', 'R'],
    maxProbes: 2,
    probes: {
      missing_A: 'What did you do once you realized?',
      missing_R: 'What changed in your thinking or behavior after?',
      cliche_or_generic: 'I need a specific example — what belief, what correction, when?',
    },
    tags: ['learning', 'intellectual-honesty'],
    sortOrder: 3,
  },

  // ─── Technical (3) ─────────────────────────────────────────────────────────
  {
    id: 'technical-001',
    dimension: 'technical',
    text: "Tell me about the most technically complex thing you've built or worked on. What made it complex, and what was your specific contribution?",
    expectedSlots: ['S', 'T', 'A', 'R'],
    maxProbes: 2,
    probes: {
      missing_A: 'What did you specifically build, design, or decide?',
      missing_R: 'How did it perform? Any metrics?',
      vague_scope: 'What technologies were involved? What was the scale?',
    },
    tags: ['complexity', 'technical-depth'],
    sortOrder: 1,
  },
  {
    id: 'technical-002',
    dimension: 'technical',
    text: "Tell me about a bug or production issue that was particularly hard to track down. How did you debug it?",
    expectedSlots: ['S', 'T', 'A', 'R'],
    maxProbes: 2,
    probes: {
      missing_A: 'What did you try first? What eliminated the wrong hypotheses?',
      missing_R: 'What was the root cause? Did you fix the class of issue or just the symptom?',
      vague_scope: 'What tools or techniques did you use?',
    },
    tags: ['debugging', 'incident'],
    sortOrder: 2,
  },
  {
    id: 'technical-003',
    dimension: 'technical',
    text: "What's a technology or approach you used to believe in strongly that you've since changed your mind about? What changed?",
    expectedSlots: ['S', 'T', 'A', 'R'],
    maxProbes: 2,
    probes: {
      missing_A: 'What did you do differently after changing your mind?',
      missing_R: 'How did that work out?',
      cliche_or_generic: 'Be specific — what technology, what project, what outcome?',
    },
    tags: ['opinion-change', 'technical-judgment'],
    sortOrder: 3,
  },

  // ─── Motivation (3) ────────────────────────────────────────────────────────
  {
    id: 'motivation-001',
    dimension: 'motivation',
    text: "What are you optimizing for in your next role? If you had to rank the top three things, what would they be?",
    expectedSlots: ['S', 'T'],
    maxProbes: 2,
    probes: {
      vague_scope: 'Can you be more specific? For example: team size, autonomy, tech stack, impact, compensation, growth?',
      missing_R: 'Have you had roles that gave you those things? How did that feel?',
    },
    tags: ['priorities', 'next-role'],
    sortOrder: 1,
  },
  {
    id: 'motivation-002',
    dimension: 'motivation',
    text: "Tell me about a job you loved. What made it great? And a job you couldn't wait to leave — what made it bad?",
    expectedSlots: ['S', 'T'],
    maxProbes: 2,
    probes: {
      vague_scope: 'What specifically? Was it the people, the work, the autonomy, the pace, the recognition?',
      missing_R: 'What did you learn about yourself from the bad one?',
    },
    tags: ['fit', 'preferences'],
    sortOrder: 2,
  },
  {
    id: 'motivation-003',
    dimension: 'motivation',
    text: "What kind of work do you find yourself doing even when no one asked you to?",
    expectedSlots: ['S', 'T', 'A'],
    maxProbes: 2,
    probes: {
      missing_A: 'What do you actually do? Give me a concrete example.',
      vague_scope: 'How often? Is it a regular thing or occasional?',
    },
    tags: ['intrinsic-motivation', 'drive'],
    sortOrder: 3,
  },

  // ─── Context (3) ───────────────────────────────────────────────────────────
  {
    id: 'context-001',
    dimension: 'context',
    text: "Where are you based, and what's your work arrangement preference — remote, hybrid, in-office?",
    expectedSlots: ['S'],
    maxProbes: 1,
    probes: {
      missing_T: 'Is that a preference or a hard constraint?',
    },
    tags: ['location', 'remote'],
    sortOrder: 1,
  },
  {
    id: 'context-002',
    dimension: 'context',
    text: "What's your notice period or earliest start date? Are there any constraints on your time we should know about?",
    expectedSlots: ['S'],
    maxProbes: 1,
    probes: {
      missing_T: 'Is that a firm date or an estimate?',
    },
    tags: ['availability', 'timeline'],
    sortOrder: 2,
  },
  {
    id: 'context-003',
    dimension: 'context',
    text: "What stage of company do you think fits you best right now — early startup, growth-stage, or established? Why?",
    expectedSlots: ['S', 'T'],
    maxProbes: 1,
    probes: {
      missing_T: 'What have you experienced that makes you say that?',
    },
    tags: ['company-stage', 'preference'],
    sortOrder: 3,
  },
];

// ─── Runtime bank ─────────────────────────────────────────────────────────────

export const PROFILE_PROBE_BANK: ProfileProbe[] = [...SEED_BANK];
export const PROFILE_PROBE_BANK_SIZE = PROFILE_PROBE_BANK.length;

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function getProfileProbeById(id: string): ProfileProbe | null {
  return PROFILE_PROBE_BANK.find((p) => p.id === id) ?? null;
}

/**
 * Compute an initial coverage map with all profile dimensions at 0.
 */
export function emptyProfileCoverage(): Record<ProfileProbeDimension, number> {
  return {
    career_history: 0,
    behavioral_depth: 0,
    cultural: 0,
    technical: 0,
    motivation: 0,
    context: 0,
  };
}

// ─── Selector ────────────────────────────────────────────────────────────────

export interface PickNextProfileProbeOptions {
  coverage: Record<string, number>;
  askedIds: ReadonlySet<string>;
}

/**
 * Pick the next profile probe with a coverage-driven selector.
 *
 * Pipeline:
 *   1. Filter out already-asked probes.
 *   2. Score each candidate by inverse coverage of its dimension.
 *   3. Highest score wins. Stable on ties via sort_order.
 *
 * Returns null when all probes have been asked.
 */
export function pickNextProfileProbe(
  options: PickNextProfileProbeOptions,
): ProfileProbe | null {
  const candidates = PROFILE_PROBE_BANK.filter((p) => !options.askedIds.has(p.id));
  if (candidates.length === 0) return null;

  let best: ProfileProbe | null = null;
  let bestScore = -Infinity;

  for (const p of candidates) {
    const coverage = options.coverage[p.dimension] ?? 0;
    const score = 1 / (coverage + 1);

    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }

  return best ?? candidates[0] ?? null;
}

// ─── DB loader (optional) ────────────────────────────────────────────────────

import type { D1Database } from '@cloudflare/workers-types';

export async function loadProfileProbeBankFromDb(_db: D1Database): Promise<ProfileProbe[]> {
  // Future: SELECT * FROM profile_probe_bank ORDER BY dimension, sort_order
  // For now, return the seed bank. Callers can merge DB rows with seed bank
  // if they want dynamic curation without deployments.
  return PROFILE_PROBE_BANK;
}
