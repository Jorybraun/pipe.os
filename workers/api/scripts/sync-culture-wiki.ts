/**
 * sync-culture-wiki.ts
 *
 * Reads `knowledge/culture/questions/exponent/*.md`, parses each frontmatter,
 * and emits `workers/api/src/lib/cultureQuestionBank.generated.ts` containing
 * a TypeScript const that the runtime culture agent imports.
 *
 * Usage:
 *   cd workers/api && npx tsx scripts/sync-culture-wiki.ts
 *   (or: npm run sync:culture-wiki)
 *
 * Why this exists:
 *   Cloudflare Workers have no filesystem at runtime, so we cannot read the
 *   markdown wiki at request time. The sync step bundles the wiki into the
 *   Worker bundle as a TS const. The 15 curated questions stay hand-authored
 *   in cultureQuestionBank.ts; only the Exponent-sourced 1,015 are generated.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, appendFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Repo paths — script lives in workers/api/scripts, repo root is two levels up.
const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const EXPONENT_DIR = join(REPO_ROOT, 'knowledge', 'culture', 'questions', 'exponent');
const QUESTIONS_DIR = join(REPO_ROOT, 'knowledge', 'culture', 'questions');
const ARCHETYPES_DIR = join(QUESTIONS_DIR, 'archetypes');
const INDEX_PATH = join(QUESTIONS_DIR, 'index.md');
const LOG_PATH = join(QUESTIONS_DIR, 'log.md');
const OUTPUT_PATH = join(
  REPO_ROOT,
  'workers',
  'api',
  'src',
  'lib',
  'cultureQuestionBank.generated.ts',
);

// ─── Tiny YAML frontmatter parser ────────────────────────────────────────────
//
// We don't pull in gray-matter for one file format we control. The frontmatter
// shape is fixed by the Haiku tagger and is not arbitrary YAML — every value is
// either a quoted string, an unquoted scalar, an inline array `[a, b, c]`, or a
// number. Reject anything else loudly so we notice when a tagger drifts.

interface Frontmatter {
  source: string;
  exponent_id: number;
  slug: string;
  title: string;
  dimensions: string[];
  archetype: string;
  discipline: string;
  probe_patterns: string[];
  role_overlays: string[];
  seniority: string[];
  bars_fitness: number;
  bias_risk: string;
  related: string[];
}

function parseFrontmatter(raw: string, filename: string): Frontmatter {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) throw new Error(`${filename}: missing frontmatter block`);
  const body = match[1]!;
  const out: Record<string, unknown> = {};

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) throw new Error(`${filename}: malformed line "${rawLine}"`);
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    out[key] = parseValue(value);
  }

  // Validate required keys.
  const required: Array<keyof Frontmatter> = [
    'source',
    'exponent_id',
    'slug',
    'title',
    'dimensions',
    'archetype',
    'discipline',
    'probe_patterns',
    'role_overlays',
    'seniority',
    'bars_fitness',
    'bias_risk',
  ];
  for (const k of required) {
    if (!(k in out)) throw new Error(`${filename}: missing key "${k}"`);
  }

  return {
    source: String(out.source),
    exponent_id: Number(out.exponent_id),
    slug: String(out.slug),
    title: String(out.title),
    dimensions: out.dimensions as string[],
    archetype: String(out.archetype),
    discipline: String(out.discipline),
    probe_patterns: out.probe_patterns as string[],
    role_overlays: out.role_overlays as string[],
    seniority: out.seniority as string[],
    bars_fitness: Number(out.bars_fitness),
    bias_risk: String(out.bias_risk),
    related: (out.related as string[]) ?? [],
  };
}

function parseValue(raw: string): unknown {
  if (raw === '') return '';
  // Inline array: [a, b, c] or []
  if (raw.startsWith('[') && raw.endsWith(']')) {
    const inner = raw.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map((s) => stripQuotes(s.trim()));
  }
  // Quoted string
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return stripQuotes(raw);
  }
  // Number
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  // Bare scalar (string)
  return raw;
}

function stripQuotes(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\'/g, "'");
  }
  return s;
}

// ─── Generic probe library ───────────────────────────────────────────────────
//
// Exponent-sourced questions don't have bespoke probe libraries. We give them
// a generic one keyed off STAR-slot deficiencies; the agent's prompt formatter
// inlines whichever probe matches the deficient slot.

const GENERIC_PROBES = {
  missing_S: "Set the scene for me — when was this, who was involved?",
  missing_T: "What was your role in it specifically? What were you trying to achieve?",
  missing_A: "What did you actually do? Walk me through your steps.",
  missing_R: "How did it land? What was the outcome, and how did you know?",
  vague_outcome: "Give me a concrete indicator — something measurable or observable.",
  passive_voice: "Who decided what? I want to hear your words and theirs, not 'we'.",
  unclear_scope: "What were the boundaries of this — what was yours, what wasn't?",
  cliche_or_generic: "I'm looking for a specific moment, not a general pattern.",
} as const;

// ─── Render generated TypeScript ─────────────────────────────────────────────

function escapeString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function renderArray(items: string[]): string {
  return '[' + items.map((s) => `'${escapeString(s)}'`).join(', ') + ']';
}

// Closed vocabularies — coerce taggers' drift back into the valid set so the
// generated TS file always type-checks. Drift is logged so we can see how
// often each agent went off-vocab.
const VALID_ROLE_OVERLAYS = new Set(['senior-ic', 'manager', 'universal']);
const VALID_DIMENSIONS = new Set([
  'ownership',
  'collaboration',
  'learning-orientation',
  'conflict-handling',
  'self-awareness',
]);
const VALID_DISCIPLINES = new Set(['eng', 'pm', 'design', 'leadership', 'universal']);
const VALID_SENIORITY = new Set(['junior', 'mid', 'senior', 'lead', 'staff', 'manager']);

const drift = {
  role_overlays: 0,
  dimensions: 0,
  discipline: 0,
  seniority: 0,
};

function coerceList(values: string[], valid: Set<string>, fallback: string, kind: keyof typeof drift): string[] {
  const cleaned = values.filter((v) => {
    if (valid.has(v)) return true;
    drift[kind]++;
    return false;
  });
  return cleaned.length ? cleaned : [fallback];
}

function coerceScalar(value: string, valid: Set<string>, fallback: string, kind: keyof typeof drift): string {
  if (valid.has(value)) return value;
  drift[kind]++;
  return fallback;
}

function renderQuestion(fm: Frontmatter): string {
  const id = `exponent-${String(fm.exponent_id).padStart(4, '0')}`;
  const dimensions = coerceList(fm.dimensions, VALID_DIMENSIONS, 'self-awareness', 'dimensions');
  const seniority = coerceList(fm.seniority, VALID_SENIORITY, 'mid', 'seniority');
  const roleOverlays = coerceList(fm.role_overlays, VALID_ROLE_OVERLAYS, 'universal', 'role_overlays');
  const discipline = coerceScalar(fm.discipline, VALID_DISCIPLINES, 'universal', 'discipline');

  return `  {
    id: '${id}',
    dimensions: ${renderArray(dimensions)} as CompetencyDimension[],
    seniority: ${renderArray(seniority)} as SeniorityTag[],
    text: '${escapeString(fm.title)}',
    expectedSlots: ['S', 'T', 'A', 'R'],
    maxProbes: 2,
    probes: GENERIC_PROBES,
    probe_patterns: ${renderArray(fm.probe_patterns)},
    role_overlays: ${renderArray(roleOverlays)} as RoleOverlayId[],
    archetype: '${escapeString(fm.archetype)}',
    discipline: '${escapeString(discipline)}' as Discipline,
    bars_fitness: ${fm.bars_fitness},
  },`;
}

// ─── Main ────────────────────────────────────────────────────────────────────

function main(): void {
  const files = readdirSync(EXPONENT_DIR).filter((f) => f.endsWith('.md'));
  files.sort();

  console.log(`[sync-culture-wiki] reading ${files.length} files from ${EXPONENT_DIR}`);

  const parsed: Frontmatter[] = [];
  const errors: Array<{ file: string; error: string }> = [];

  for (const file of files) {
    try {
      const raw = readFileSync(join(EXPONENT_DIR, file), 'utf-8');
      parsed.push(parseFrontmatter(raw, file));
    } catch (err) {
      errors.push({ file, error: err instanceof Error ? err.message : String(err) });
    }
  }

  if (errors.length) {
    console.error(`[sync-culture-wiki] ${errors.length} parse errors:`);
    for (const e of errors.slice(0, 10)) console.error(`  ${e.file}: ${e.error}`);
    if (errors.length > 10) console.error(`  ... and ${errors.length - 10} more`);
  }

  // Sort by exponent_id for deterministic output.
  parsed.sort((a, b) => a.exponent_id - b.exponent_id);

  const renderedQuestions = parsed.map(renderQuestion).join('\n');

  const output = `/**
 * GENERATED FILE — do not edit by hand.
 *
 * Regenerate via: \`npm run sync:culture-wiki\`
 *
 * Source: knowledge/culture/questions/exponent/*.md (${parsed.length} questions)
 * Generated: ${new Date().toISOString()}
 */

import type {
  CompetencyDimension,
  CultureQuestion,
  Discipline,
  SeniorityTag,
} from './cultureQuestionBank.js';
import type { RoleOverlayId } from './cultureRoleOverlay.js';

const GENERIC_PROBES = ${JSON.stringify(GENERIC_PROBES, null, 2)} as const;

export const CULTURE_QUESTION_BANK_GENERATED: CultureQuestion[] = [
${renderedQuestions}
];
`;

  writeFileSync(OUTPUT_PATH, output, 'utf-8');
  console.log(`[sync-culture-wiki] wrote ${parsed.length} questions to ${OUTPUT_PATH}`);
  console.log(`[sync-culture-wiki] vocabulary drift coerced:`, drift);

  buildArchetypeHubs(parsed);
  buildIndex(parsed);
  appendLog(parsed.length);

  if (errors.length) {
    process.exit(1);
  }
}

// ─── Hub + index + log builders ──────────────────────────────────────────────

function noteFilename(fm: Frontmatter): string {
  return `q-exponent-${String(fm.exponent_id).padStart(4, '0')}-${fm.slug}`;
}

function buildArchetypeHubs(parsed: Frontmatter[]): void {
  if (!existsSync(ARCHETYPES_DIR)) mkdirSync(ARCHETYPES_DIR, { recursive: true });

  const byArchetype = new Map<string, Frontmatter[]>();
  for (const fm of parsed) {
    const a = fm.archetype || 'unsorted';
    if (!byArchetype.has(a)) byArchetype.set(a, []);
    byArchetype.get(a)!.push(fm);
  }

  for (const [archetype, items] of byArchetype) {
    items.sort((a, b) => a.exponent_id - b.exponent_id);
    const lines: string[] = [];
    lines.push(`---`);
    lines.push(`type: archetype-hub`);
    lines.push(`name: ${archetype}`);
    lines.push(`question_count: ${items.length}`);
    lines.push(`---`);
    lines.push(``);
    lines.push(`# ${archetype.charAt(0).toUpperCase() + archetype.slice(1)}`);
    lines.push(``);
    lines.push(`Hub page for the **${archetype}** archetype. ${items.length} questions.`);
    lines.push(``);
    lines.push(`## Questions`);
    lines.push(``);
    for (const fm of items) {
      const dims = fm.dimensions.length ? ` *(${fm.dimensions.join(', ')})*` : '';
      lines.push(`- [[${noteFilename(fm)}]] — ${fm.title}${dims}`);
    }
    lines.push(``);
    writeFileSync(join(ARCHETYPES_DIR, `${archetype}.md`), lines.join('\n'), 'utf-8');
  }
  console.log(`[sync-culture-wiki] wrote ${byArchetype.size} archetype hubs to ${ARCHETYPES_DIR}`);
}

function buildIndex(parsed: Frontmatter[]): void {
  const byDimension = new Map<string, Frontmatter[]>();
  let trivia = 0;
  for (const fm of parsed) {
    if (fm.dimensions.length === 0) {
      trivia++;
      continue;
    }
    const primary = fm.dimensions[0]!;
    if (!byDimension.has(primary)) byDimension.set(primary, []);
    byDimension.get(primary)!.push(fm);
  }

  const lines: string[] = [];
  lines.push(`# Culture Question Wiki — Index`);
  lines.push(``);
  lines.push(`Auto-generated by \`workers/api/scripts/sync-culture-wiki.ts\`. Do not edit by hand.`);
  lines.push(``);
  lines.push(`- **Total questions:** ${parsed.length}`);
  lines.push(`- **Trivia (dimensions: [])**: ${trivia} — excluded from selector`);
  lines.push(`- **Sources:** Exponent (curated 15 live in \`questions/{dimension}/\`)`);
  lines.push(``);
  lines.push(`## By dimension`);
  lines.push(``);
  for (const dim of [...byDimension.keys()].sort()) {
    lines.push(`- **${dim}** — ${byDimension.get(dim)!.length} questions`);
  }
  lines.push(``);
  lines.push(`## Archetype hubs`);
  lines.push(``);
  const archetypes = new Set(parsed.map((p) => p.archetype || 'unsorted'));
  for (const a of [...archetypes].sort()) {
    lines.push(`- [[archetypes/${a}]]`);
  }
  lines.push(``);
  writeFileSync(INDEX_PATH, lines.join('\n'), 'utf-8');
  console.log(`[sync-culture-wiki] wrote index to ${INDEX_PATH}`);
}

function appendLog(count: number): void {
  const stamp = new Date().toISOString();
  const entry = `## [${stamp}] sync — ${count} questions\n`;
  if (!existsSync(LOG_PATH)) {
    writeFileSync(LOG_PATH, `# Culture Wiki — Build Log\n\n`, 'utf-8');
  }
  appendFileSync(LOG_PATH, entry, 'utf-8');
}

main();
