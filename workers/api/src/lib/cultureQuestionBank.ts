/**
 * Culture Interview Agent — deterministic question bank.
 *
 * This module mirrors `knowledge/culture/questions/**` in TypeScript so the
 * Worker can load the bank at runtime without a wiki sync step. The wiki is
 * the source of truth for BARS rubrics and calibration examples (used by the
 * scorer); the runtime bank here is a slimmed-down index used by the agent to
 * pick the next question and compose probes.
 *
 * Phase C will add a build-time sync script (`scripts/sync-culture-wiki.ts`)
 * that regenerates this file from the markdown wiki. Until then, changes to
 * the question set are made in both places by hand.
 *
 * Question IDs MUST match the `id` field in the corresponding markdown file
 * so that the scorer can load the full BARS rubric by ID.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

/** Behavioral competency dimensions — the scored axes. */
export type CompetencyDimension =
  | 'ownership'
  | 'collaboration'
  | 'learning-orientation'
  | 'conflict-handling'
  | 'self-awareness';

export const COMPETENCY_DIMENSIONS: readonly CompetencyDimension[] = [
  'ownership',
  'collaboration',
  'learning-orientation',
  'conflict-handling',
  'self-awareness',
] as const;

/** Seniority tags a question is calibrated for. */
export type SeniorityTag = 'junior' | 'mid' | 'senior' | 'lead' | 'staff' | 'manager';

/** A single STAR slot on a candidate response. */
export type StarSlot = 'S' | 'T' | 'A' | 'R';

/**
 * The probe library for a question. Each key names a specific deficiency in
 * the candidate's answer; the value is a short probe prompt template. The
 * agent passes these as hints to the LLM, which adapts them to the
 * candidate's actual words for a natural flow.
 */
export interface QuestionProbeLibrary {
  missing_S?: string;
  missing_T?: string;
  missing_A?: string;
  missing_R?: string;
  vague_outcome?: string;
  passive_voice?: string;
  unclear_scope?: string;
  cliche_or_generic?: string;
}

export interface CultureQuestion {
  id: string;
  /** Primary + secondary dimensions this question evidences. First entry is primary. */
  dimensions: CompetencyDimension[];
  /** Seniority tags — question is eligible if candidate seniority is in this list. */
  seniority: SeniorityTag[];
  /** The exact question text read to the candidate. */
  text: string;
  /** STAR slots we expect the candidate to cover for a complete answer. */
  expectedSlots: StarSlot[];
  /** Max probes the agent is allowed for this question. Usually 2. */
  maxProbes: number;
  /** Probe templates indexed by deficiency. */
  probes: QuestionProbeLibrary;
  /**
   * Optional tags — `role-overlays/` may use these to bias selection.
   * e.g. ['unowned-work', 'initiative', 'oncall']
   */
  tags?: string[];
}

// ─── The 15-question seed bank ───────────────────────────────────────────────
// Mirrors knowledge/culture/questions/**. Keep in sync until Phase C sync script lands.

export const CULTURE_QUESTION_BANK: CultureQuestion[] = [
  // ─── Ownership (3) ─────────────────────────────────────────────────────────
  {
    id: 'ownership-001',
    dimensions: ['ownership', 'learning-orientation'],
    seniority: ['mid', 'senior', 'lead', 'staff'],
    text: "Tell me about a time you saw a problem at work that wasn't yours to fix, and you fixed it anyway. What was the problem, what did you do, and what happened?",
    expectedSlots: ['S', 'T', 'A', 'R'],
    maxProbes: 2,
    probes: {
      missing_A: 'What did you specifically do in that situation? I want to hear about your actions, not the team\'s.',
      missing_R: 'How did you know it worked? What changed after?',
      unclear_scope: 'Was this your responsibility? How did you decide to get involved?',
      passive_voice: 'Walk me through who decided what — who did what, specifically?',
      cliche_or_generic: 'Was anyone expecting you to handle this? What would have happened if you hadn\'t?',
    },
    tags: ['unowned-work', 'initiative'],
  },
  {
    id: 'ownership-002',
    dimensions: ['ownership', 'self-awareness'],
    seniority: ['junior', 'mid', 'senior', 'lead', 'staff'],
    text: 'Tell me about something you shipped that broke in a way that affected other people. Walk me through what happened and how you handled it.',
    expectedSlots: ['S', 'T', 'A', 'R'],
    maxProbes: 2,
    probes: {
      missing_A: 'Step by step — what did you do once you realized it was broken?',
      missing_R: 'What was the impact? How did you know the fix actually held?',
      vague_outcome: 'Was there any follow-up or post-mortem? What changed in how you work after that?',
      cliche_or_generic: 'I want a specific incident. When was this, and what exactly broke?',
    },
    tags: ['mistake', 'incident-response'],
  },
  {
    id: 'ownership-003',
    dimensions: ['ownership', 'conflict-handling'],
    seniority: ['mid', 'senior', 'lead', 'staff', 'manager'],
    text: "Tell me about a commitment you made that turned out to be much harder than you expected. What did you do?",
    expectedSlots: ['S', 'T', 'A', 'R'],
    maxProbes: 2,
    probes: {
      missing_A: 'What did you do once you realized you were in trouble? Walk me through your steps.',
      missing_R: 'How did it land? Did you deliver, miss, or negotiate?',
      unclear_scope: 'Who did you talk to first? When?',
      cliche_or_generic: 'I\'m looking for a specific commitment — a date, a scope, a promise. Which one?',
    },
    tags: ['commitment', 'estimation'],
  },

  // ─── Collaboration (3) ─────────────────────────────────────────────────────
  {
    id: 'collaboration-001',
    dimensions: ['collaboration', 'conflict-handling'],
    seniority: ['junior', 'mid', 'senior', 'lead', 'staff'],
    text: 'Tell me about a time you disagreed with a teammate on a technical decision. How did you handle it, and what happened?',
    expectedSlots: ['S', 'T', 'A', 'R'],
    maxProbes: 2,
    probes: {
      missing_A: 'What did you actually say or do? Walk me through the conversation.',
      missing_R: 'How did it resolve? Who ended up making the call?',
      unclear_scope: 'What were the two positions exactly? What did each of you want?',
      passive_voice: 'Who said what? I want to hear your words and theirs.',
    },
    tags: ['disagreement', 'decision-making'],
  },
  {
    id: 'collaboration-002',
    dimensions: ['collaboration', 'self-awareness'],
    seniority: ['junior', 'mid', 'senior', 'lead', 'staff'],
    text: 'Tell me about a time you had to work with someone whose working style was very different from yours. How did you make it work?',
    expectedSlots: ['S', 'T', 'A', 'R'],
    maxProbes: 2,
    probes: {
      missing_A: 'What did you change about how you worked with them?',
      missing_R: 'Did the working relationship improve? What would you do differently now?',
      cliche_or_generic: 'Tell me specifically what was different — was it communication, pace, process?',
    },
    tags: ['working-style', 'adaptation'],
  },
  {
    id: 'collaboration-003',
    dimensions: ['collaboration', 'ownership'],
    seniority: ['mid', 'senior', 'lead', 'staff', 'manager'],
    text: 'Tell me about a time you had to get help from someone outside your immediate team. How did you approach it?',
    expectedSlots: ['S', 'T', 'A', 'R'],
    maxProbes: 2,
    probes: {
      missing_A: 'How did you frame the ask? What did you bring to the conversation?',
      missing_R: 'Did you get what you needed? How did the relationship land afterwards?',
      unclear_scope: 'Who exactly did you approach and why that person?',
    },
    tags: ['cross-team', 'help-seeking'],
  },

  // ─── Learning Orientation (3) ──────────────────────────────────────────────
  {
    id: 'learning-orientation-001',
    dimensions: ['learning-orientation', 'self-awareness'],
    seniority: ['junior', 'mid', 'senior', 'lead', 'staff'],
    text: 'Tell me about the last time you realized you were wrong about something important at work. How did you find out, and what did you do?',
    expectedSlots: ['S', 'T', 'A', 'R'],
    maxProbes: 2,
    probes: {
      missing_A: 'What did you do once you realized? Walk me through the sequence.',
      missing_R: 'How did the conclusion land? What changed in your thinking after?',
      cliche_or_generic: 'I need a specific example — what belief, what correction, when?',
    },
    tags: ['intellectual-honesty', 'updating'],
  },
  {
    id: 'learning-orientation-002',
    dimensions: ['learning-orientation', 'ownership'],
    seniority: ['junior', 'mid', 'senior', 'lead', 'staff'],
    text: "Tell me about something technical you had to learn from scratch in the last year. How did you approach it, and where are you now?",
    expectedSlots: ['S', 'T', 'A', 'R'],
    maxProbes: 2,
    probes: {
      missing_A: 'Walk me through your actual process — what did you read, try, build?',
      missing_R: 'Where are you now with it? What can you do today that you couldn\'t before?',
      vague_outcome: 'Give me a concrete indicator — something you shipped, something you understand now.',
    },
    tags: ['learning', 'skill-acquisition'],
  },
  {
    id: 'learning-orientation-003',
    dimensions: ['learning-orientation', 'conflict-handling'],
    seniority: ['mid', 'senior', 'lead', 'staff', 'manager'],
    text: 'Tell me about a piece of feedback that landed hard but that you later realized was right. What was the feedback, and what changed?',
    expectedSlots: ['S', 'T', 'A', 'R'],
    maxProbes: 2,
    probes: {
      missing_A: 'What did you actually do with the feedback, once you got past the sting?',
      missing_R: 'What\'s different about how you work today because of it?',
      cliche_or_generic: 'I want the real one — what did it feel like in the moment, not the tidy retrospective version.',
    },
    tags: ['feedback', 'growth'],
  },

  // ─── Conflict Handling (3) ─────────────────────────────────────────────────
  {
    id: 'conflict-handling-001',
    dimensions: ['conflict-handling', 'collaboration'],
    seniority: ['mid', 'senior', 'lead', 'staff', 'manager'],
    text: 'Tell me about a time you had to push back on a decision your manager or a product stakeholder had made. How did it go?',
    expectedSlots: ['S', 'T', 'A', 'R'],
    maxProbes: 2,
    probes: {
      missing_A: 'What did you actually say? How did you frame the pushback?',
      missing_R: 'How did they respond? Where did it land?',
      unclear_scope: 'What was the decision exactly? Why did you disagree?',
    },
    tags: ['pushback', 'authority'],
  },
  {
    id: 'conflict-handling-002',
    dimensions: ['conflict-handling', 'self-awareness'],
    seniority: ['junior', 'mid', 'senior', 'lead', 'staff'],
    text: "Tell me about a time a disagreement at work got more heated than you wanted. What happened, and how did it end?",
    expectedSlots: ['S', 'T', 'A', 'R'],
    maxProbes: 2,
    probes: {
      missing_A: 'What did you do in the moment to manage it?',
      missing_R: 'How did the relationship look a week later?',
      cliche_or_generic: 'I\'m looking for a specific moment — not general patterns.',
    },
    tags: ['conflict', 'recovery'],
  },
  {
    id: 'conflict-handling-003',
    dimensions: ['conflict-handling', 'ownership'],
    seniority: ['mid', 'senior', 'lead', 'staff', 'manager'],
    text: "Tell me about a time you had to give difficult feedback to a peer or someone you reported to. How did you approach it?",
    expectedSlots: ['S', 'T', 'A', 'R'],
    maxProbes: 2,
    probes: {
      missing_A: 'What did you actually say? Walk me through your words.',
      missing_R: 'How did they take it? What changed afterward, if anything?',
      unclear_scope: 'What was the feedback specifically, and why did it need to be said?',
    },
    tags: ['feedback-giving', 'hard-conversations'],
  },

  // ─── Self-Awareness (3) ────────────────────────────────────────────────────
  {
    id: 'self-awareness-001',
    dimensions: ['self-awareness', 'learning-orientation'],
    seniority: ['junior', 'mid', 'senior', 'lead', 'staff'],
    text: "What's something you used to be confident about professionally that you now think you were wrong about?",
    expectedSlots: ['S', 'T', 'A', 'R'],
    maxProbes: 2,
    probes: {
      missing_A: 'What caused the shift? What evidence changed your mind?',
      missing_R: 'What do you do differently now as a result?',
      cliche_or_generic: 'I want a specific belief, not a category — what exactly did you think?',
    },
    tags: ['belief-update', 'intellectual-humility'],
  },
  {
    id: 'self-awareness-002',
    dimensions: ['self-awareness', 'ownership'],
    seniority: ['mid', 'senior', 'lead', 'staff', 'manager'],
    text: "What's something you know you're not good at that's relevant to this role, and how do you manage around it?",
    expectedSlots: ['S', 'T', 'A', 'R'],
    maxProbes: 2,
    probes: {
      missing_A: 'How do you actually compensate day-to-day? What does it look like?',
      cliche_or_generic: 'Avoid the humble-brag version. What\'s the real weakness, not a disguised strength?',
      missing_R: 'How is it going? Is it getting better, or is it just managed?',
    },
    tags: ['weakness', 'compensation'],
  },
  {
    id: 'self-awareness-003',
    dimensions: ['self-awareness', 'collaboration'],
    seniority: ['junior', 'mid', 'senior', 'lead', 'staff'],
    text: "How would someone who worked closely with you describe your biggest blind spot — and would they be right?",
    expectedSlots: ['S', 'T', 'A', 'R'],
    maxProbes: 2,
    probes: {
      missing_A: 'What do you do when it comes up? Have you tried to address it?',
      missing_R: 'Have you seen it cause problems? Walk me through a time it did.',
      cliche_or_generic: 'I\'m looking for the actual blind spot, not a rehearsed answer.',
    },
    tags: ['blind-spot', 'external-view'],
  },
];

// ─── Bank helpers ────────────────────────────────────────────────────────────

/**
 * Look up a question by ID. Returns null if unknown.
 */
export function getQuestionById(id: string): CultureQuestion | null {
  return CULTURE_QUESTION_BANK.find((q) => q.id === id) ?? null;
}

/**
 * Filter the bank to questions appropriate for a given seniority.
 * If seniority is unknown, returns the full bank.
 */
export function filterBySeniority(seniority: SeniorityTag | null | undefined): CultureQuestion[] {
  if (!seniority) return CULTURE_QUESTION_BANK;
  return CULTURE_QUESTION_BANK.filter((q) => q.seniority.includes(seniority));
}

/**
 * Pick the next question given the current coverage map and the set of
 * already-asked question IDs.
 *
 * Selection rule:
 *   1. Filter out already-asked questions.
 *   2. Rank remaining by coverage gap: the lowest-covered primary dimension
 *      wins. Ties broken by the question's position in the bank (stable).
 *   3. Return the first match, or null if the bank is exhausted.
 */
export function pickNextQuestion(
  coverage: Record<CompetencyDimension, number>,
  askedIds: ReadonlySet<string>,
  seniority?: SeniorityTag | null,
): CultureQuestion | null {
  const eligible = filterBySeniority(seniority).filter((q) => !askedIds.has(q.id));
  if (eligible.length === 0) return null;

  // Find the lowest-covered dimension among eligible primary dimensions.
  // We prefer questions whose PRIMARY dimension has the lowest coverage.
  let best: CultureQuestion | null = null;
  let bestScore = Infinity;
  for (const q of eligible) {
    const primary = q.dimensions[0]!;
    const score = coverage[primary] ?? 0;
    if (score < bestScore) {
      bestScore = score;
      best = q;
    }
  }
  return best;
}

/**
 * Compute an initial coverage map with all dimensions at 0.
 */
export function emptyCoverage(): Record<CompetencyDimension, number> {
  return {
    ownership: 0,
    collaboration: 0,
    'learning-orientation': 0,
    'conflict-handling': 0,
    'self-awareness': 0,
  };
}
