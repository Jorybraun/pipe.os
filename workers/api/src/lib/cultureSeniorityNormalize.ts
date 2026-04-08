/**
 * Normalize the free-text `seniority` string emitted by the Role Discovery
 * Agent (e.g. "Mid-to-senior, 5–8 years", "Staff+", "Engineering Manager")
 * into a single `SeniorityTag` the culture question selector can filter on.
 *
 * Rules are deliberately simple keyword matches. The Role Agent's persona
 * synthesis already standardizes on a small set of phrasings, so a regex
 * cascade is enough — we don't want an LLM round-trip just to bucket text.
 *
 * When no signal matches, default to `mid` (the most common bucket and the
 * one with the broadest question pool).
 */

import type { SeniorityTag } from './cultureQuestionBank.js';

const PATTERNS: Array<[RegExp, SeniorityTag]> = [
  // Manager paths take precedence — "engineering manager" should NOT match
  // /staff/ even if the persona text mentions a staff-level peer expectation.
  [/\b(eng(?:ineering)?\s+)?manager\b|\bmgmt\b|\bdirector\b|\bvp\b|\bhead\s+of\b/i, 'manager'],
  // Highest IC tier first so "principal" → staff and "staff+" beats /senior/.
  [/\b(principal|distinguished|fellow)\b/i, 'staff'],
  [/\bstaff\+?\b/i, 'staff'],
  [/\b(tech\s+)?lead\b|\btl\b/i, 'lead'],
  [/\bsr\.?\s*sw?e?\b|\bsenior\b/i, 'senior'],
  [/\bmid[-\s]?(to[-\s]?senior|level)?\b|\bintermediate\b|\bswe\s*ii\b/i, 'mid'],
  [/\b(jr\.?|junior|entry[-\s]?level|new\s+grad|swe\s*i\b)/i, 'junior'],
];

export function normalizeSeniority(text: string | null | undefined): SeniorityTag {
  if (!text) return 'mid';
  for (const [pattern, tag] of PATTERNS) {
    if (pattern.test(text)) return tag;
  }
  return 'mid';
}
