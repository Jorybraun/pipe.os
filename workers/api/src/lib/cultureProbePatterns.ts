/**
 * Closed vocabulary of behavioral probe patterns.
 *
 * Source of truth: this file. The human-facing doc is
 * `knowledge/culture/probe-patterns.md` and should mirror this list — they are
 * not auto-synced, so a drift check belongs in the sync script later.
 *
 * Both the build-time Haiku tagger and the live agent's `running_theme_to_add`
 * field draw from this list. Free-text on either side breaks the
 * theme-resonance bonus in `pickNextQuestion` (the intersection becomes empty).
 *
 * Adding a new tag means: (1) append it here, (2) update the doc,
 * (3) re-tag any affected questions in the wiki, (4) regenerate.
 */

export const PROBE_PATTERNS = [
  // Ownership
  'failure-ownership',
  'unowned-work',
  'bias-for-action',
  'follow-through',
  'accountability-when-it-hurts',
  // Collaboration
  'cross-functional-collab',
  'peer-coaching',
  'stakeholder-management',
  'async-communication',
  'psychological-safety',
  // Learning orientation
  'learning-from-mistakes',
  'changed-my-mind',
  'closed-a-gap',
  'feedback-receptivity',
  'deliberate-practice',
  // Conflict handling
  'technical-disagreement',
  'difficult-feedback-delivery',
  'stakeholder-pushback',
  'de-escalation',
  'principled-compromise',
  // Self-awareness
  'pattern-in-failures',
  'how-i-land',
  'surprising-feedback',
  'blind-spot-acknowledgment',
  'self-correction',
  // Cross-cutting
  'ambiguity-tolerance',
  'prioritization-tradeoffs',
  'scope-management',
  'growth-orientation',
  'cultural-add',
] as const;

export type ProbePattern = (typeof PROBE_PATTERNS)[number];

const PROBE_PATTERN_SET: ReadonlySet<string> = new Set(PROBE_PATTERNS);

export function isProbePattern(value: unknown): value is ProbePattern {
  return typeof value === 'string' && PROBE_PATTERN_SET.has(value);
}

/** Coerce a free-text theme to a valid probe pattern, or null if no match. */
export function coerceProbePattern(value: unknown): ProbePattern | null {
  return isProbePattern(value) ? value : null;
}
