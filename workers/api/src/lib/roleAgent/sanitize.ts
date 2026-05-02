/**
 * Content sanitization utilities for AI-generated role data.
 *
 * These functions clean LLM output before it reaches the UI:
 *   - Humanize snake_case / kebab-case tokens
 *   - Fix spacing artifacts ("theOpponent" → "the Opponent")
 *   - Strip prompt leakage ("(via: i work with I work with...)")
 *   - Drop obvious hallucinations ("Opponent library")
 *   - Deduplicate and normalize skill arrays
 */

/** Known hallucinated or nonsense technology names to reject. */
const HALLUCINATION_BLOCKLIST = new Set<string>([
  'opponent',
  'opponent library',
  'theopponent',
  'the opponent',
  'opponent_library',
  'framework_x',
  'tech_y',
  'library_z',
  'tool_a',
  'system_b',
  'unknown',
  'n/a',
  'na',
  'not applicable',
  'placeholder',
  'example',
  'sample',
  'test',
  'dummy',
]);

/** Common false positives that look like hallucinations but are real. */
const ALLOWLIST = new Set<string>([
  'go',          // Go language
  'r',           // R language
  'c',           // C language
  'd',           // D language
  'flow',        // Flow type system
  'dart',        // Dart language
  'julia',       // Julia language
]);

/** Convert snake_case / kebab-case to Title Case. Leaves camelCase proper nouns (e.g. TypeScript) untouched. */
export function humanize(raw: string): string {
  if (!raw || typeof raw !== 'string') return '';
  const hasDelimiter = /[_-]/.test(raw);
  const isAllLower = raw === raw.toLowerCase();
  const isAllUpper = raw === raw.toUpperCase();

  let cleaned = raw.trim();

  if (hasDelimiter) {
    // Split on delimiters and title-case each word
    cleaned = cleaned.replace(/[_-]+/g, ' ').trim();
    return cleaned
      .split(' ')
      .map((w) => (w.length === 0 ? '' : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
      .join(' ');
  }

  if (isAllLower) {
    // Simple title case for all-lowercase strings
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase();
  }

  if (isAllUpper && cleaned.length > 1) {
    // Likely an acronym — leave as-is
    return cleaned;
  }

  // Mixed case with no delimiters: probably a proper noun (TypeScript, Next.js, iOS).
  // Leave it alone.
  return cleaned;
}

/** Fix spacing artifacts like "theOpponent" → "the Opponent". */
export function fixSpacingArtifacts(text: string): string {
  return text
    // Only split camelCase when preceded by a common short word (theOpponent, withReact, etc.)
    // This preserves proper nouns like TypeScript, PostgreSQL, NextJS.
    .replace(/\b(the|a|an|in|on|with|of|for|to|and|or|is)([A-Z][a-z]+)\b/g, '$1 $2')
    .replace(/([a-zA-Z])\/(\w)/g, '$1 / $2')     // missing space around slash
    .replace(/\s+/g, ' ')                         // collapse multiple spaces
    .trim();
}

/** Strip prompt-leakage wrappers like "(via: ...)" and repeated phrases. */
export function stripPromptLeakage(text: string): string {
  if (!text) return '';
  let cleaned = text;

  // Remove "(via: ... )" wrappers entirely
  cleaned = cleaned.replace(/\s*\(\s*via\s*:([^)]*)\)\s*$/i, '');
  cleaned = cleaned.replace(/\s*via\s*:([^\n]*)/gi, '');

  // Remove echo patterns like "I work with I work with"
  const words = cleaned.split(/\s+/);
  const deduped: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const prev = deduped.slice(-4).join(' ').toLowerCase();
    const next4 = words.slice(i, i + 4).join(' ').toLowerCase();
    if (prev.endsWith(next4) && next4.length > 5) {
      // Skip this repeated phrase
      continue;
    }
    deduped.push(words[i]!);
  }
  cleaned = deduped.join(' ');

  // Collapse multiple spaces again
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  return cleaned;
}

/** Check if a technology/skill name is likely a hallucination. */
export function isLikelyHallucination(skill: string): boolean {
  const normalized = skill.toLowerCase().trim();
  if (ALLOWLIST.has(normalized)) return false;
  if (HALLUCINATION_BLOCKLIST.has(normalized)) return true;

  // Reject things that look like placeholder patterns
  if (/^(framework|tech|library|tool|system|platform)_?[a-z0-9]?$/i.test(normalized)) return true;
  if (/^\w_\w$/.test(normalized)) return true; // single char underscore single char
  if (normalized.length < 2) return true;

  return false;
}

/** Clean a single skill string: humanize delimited tokens, fix spacing, drop hallucinations. */
export function cleanSkill(raw: string): string | null {
  if (!raw || typeof raw !== 'string') return null;
  let cleaned = raw.trim();
  if (cleaned.length === 0) return null;

  cleaned = fixSpacingArtifacts(cleaned);
  // Only humanize snake_case / kebab-case, not already-readable names.
  if (/[_-]/.test(cleaned)) {
    cleaned = humanize(cleaned);
  }

  if (isLikelyHallucination(cleaned)) return null;
  return cleaned;
}

/** Clean and dedupe an array of skill strings. */
export function cleanSkillArray(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const cleaned = cleanSkill(item);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
  }
  return out;
}

/** Clean career signal: strip leakage, fix spacing, humanize. */
export function cleanCareerSignal(raw: string): string {
  if (!raw || typeof raw !== 'string') return 'Not specified';
  let cleaned = stripPromptLeakage(raw);
  cleaned = fixSpacingArtifacts(cleaned);
  cleaned = cleaned.replace(/^["']|["']$/g, '').trim();
  if (cleaned.length === 0) return 'Not specified';
  return cleaned;
}

/** Clean disposition/summary text: fix spacing, normalize. */
export function cleanDisposition(raw: string): string {
  if (!raw || typeof raw !== 'string') return '';
  let cleaned = fixSpacingArtifacts(raw);
  cleaned = humanize(cleaned);
  if (cleaned.length < 2) return '';
  return cleaned;
}

/** Clean and humanize open_codes for display in a job description. */
export function humanizeOpenCode(raw: string | undefined): string | null {
  if (!raw) return null;
  if (!raw || typeof raw !== 'string') return null;
  const cleaned = cleanSkill(raw);
  if (!cleaned) return null;
  // Additional open-code specific cleanup
  return cleaned
    .replace(/^Open\s+/i, '')
    .replace(/^Code\s+/i, '')
    .replace(/^(Is|Has|Can|Will)\s+/i, '');
}
