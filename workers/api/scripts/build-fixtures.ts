#!/usr/bin/env node
/**
 * Fixture Builder — Generates ScorerCalibrationFixture JSON files
 *
 * Reads fixture specifications from fixture-data.ts (embedded templates),
 * arena golden cases (if available), or /calibrate run logs (if available),
 * and writes fully-formed ScorerCalibrationFixture JSON files.
 *
 * Usage:
 *   npx tsx workers/api/scripts/build-fixtures.ts
 *   npx tsx workers/api/scripts/build-fixtures.ts --seniority junior --count 5
 *   npx tsx workers/api/scripts/build-fixtures.ts --persona strong --count 3
 *   npx tsx workers/api/scripts/build-fixtures.ts --output-dir ./custom
 *   npx tsx workers/api/scripts/build-fixtures.ts --validate
 */

import { parseArgs } from 'node:util';
import { writeFile, mkdir, readdir, readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import {
  JUNIOR_FIXTURES,
  MID_FIXTURES,
  SENIOR_FIXTURES,
  type CompactFixture,
  type CompactRound,
} from './fixture-data';

// ─── External data source loaders ────────────────────────────────────────────

interface ArenaCase {
  id: string;
  description: string;
  seniority: 'junior' | 'mid' | 'senior';
  prContext: CompactFixture['prContext'];
  groundTruth: CompactFixture['groundTruth'];
  transcript: unknown;
  expectedBands: CompactFixture['expectedBands'];
}

function loadArenaCases(): CompactFixture[] {
  const arenaPaths = [
    path.resolve(__dirname, '../../../research/code-review-arena/golden/prepared/cases.json'),
    path.resolve(__dirname, '../../../research/code-review-arena/golden/cases.ts'),
  ];

  for (const p of arenaPaths) {
    if (!existsSync(p)) continue;
    console.log(`[build-fixtures] Loading arena cases from ${p}`);
    const raw = readFileSync(p, 'utf8');
    try {
      const cases = JSON.parse(raw) as ArenaCase[];
      return cases.map((c) => ({
        id: c.id,
        description: c.description,
        tags: ['arena', c.seniority],
        seniority: c.seniority,
        prContext: c.prContext,
        groundTruth: c.groundTruth,
        rounds: [],
        finalVerdict: { decision: 'approve' as const, summary: 'Arena case' },
        expectedBands: c.expectedBands,
        metadata: { confidence: 'heuristic' as const },
      }));
    } catch {
      // cases.ts would need tsx eval — skip for now
      console.warn(`[build-fixtures] Found arena file but could not parse: ${p}`);
    }
  }
  return [];
}

interface CalibrateRun {
  fixture_id: string;
  score_report?: { dimensions: Record<string, number> };
}

function loadCalibrateRuns(): CompactFixture[] {
  const runsPath = path.resolve(__dirname, '../../../data/experiments/runs.jsonl');
  if (!existsSync(runsPath)) return [];

  console.log(`[build-fixtures] Loading calibrate runs from ${runsPath}`);
  const lines = readFileSync(runsPath, 'utf8').trim().split('\n');
  const fixtures: CompactFixture[] = [];
  for (const line of lines) {
    try {
      const run = JSON.parse(line) as CalibrateRun;
      if (run.fixture_id && run.score_report) {
        fixtures.push({
          id: run.fixture_id,
          description: `Calibrate run for ${run.fixture_id}`,
          tags: ['calibrate-run'],
          seniority: 'mid',
          prContext: { title: '', description: '', instructions: '', diff: '' },
          groundTruth: [],
          rounds: [],
          finalVerdict: { decision: 'approve' as const, summary: 'Calibrate run' },
          expectedBands: Object.fromEntries(
            Object.entries(run.score_report.dimensions).map(([k, v]) => [
              k,
              { min: Math.max(1, Math.floor(v)), max: Math.min(5, Math.ceil(v)), rationale: 'Derived from calibrate run' },
            ])
          ) as CompactFixture['expectedBands'],
          metadata: { confidence: 'heuristic' as const },
        });
      }
    } catch {
      // ignore malformed lines
    }
  }
  return fixtures;
}

// ─── CLI args ────────────────────────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    seniority: { type: 'string' },
    persona:   { type: 'string' },
    count:     { type: 'string' },
    'output-dir': { type: 'string' },
    validate:  { type: 'boolean', default: false },
    help:      { type: 'boolean', default: false },
  },
});

if (args.help) {
  console.log(`Usage: npx tsx workers/api/scripts/build-fixtures.ts [options]

Options:
  --seniority junior|mid|senior   Filter fixtures by seniority
  --persona strong|adequate|weak  Filter fixtures by expected persona band
  --count N                       Limit number of fixtures generated
  --output-dir PATH               Output directory (default: workers/api/fixtures/scorer-calibration)
  --validate                      Validate all existing fixtures against schema
  --help                          Show this help
`);
  process.exit(0);
}

const SENIORITY_FILTER = args.seniority as 'junior' | 'mid' | 'senior' | undefined;
const PERSONA_FILTER = args.persona as 'strong' | 'adequate' | 'weak' | undefined;
const COUNT_LIMIT = args.count ? parseInt(args.count, 10) : undefined;
const OUTPUT_DIR =
  args['output-dir'] ?? path.resolve(__dirname, '../fixtures/scorer-calibration');
const VALIDATE = args.validate as boolean;

function derivePersona(spec: CompactFixture): 'strong' | 'adequate' | 'weak' {
  const avg =
    Object.values(spec.expectedBands).reduce((sum, b) => sum + (b.min + b.max) / 2, 0) /
    Object.keys(spec.expectedBands).length;
  if (avg >= 4) return 'strong';
  if (avg >= 2.5) return 'adequate';
  return 'weak';
}

// ─── Schema validation ───────────────────────────────────────────────────────

const REQUIRED_DIMENSIONS = [
  'issue_identification',
  'prioritization',
  'revision_evaluation',
  'reasoning_quality',
  'question_formation',
  'ai_direction',
];

function validateFixture(data: unknown, filename: string): string[] {
  const errors: string[] = [];
  const f = data as Record<string, unknown>;

  if (!f.id || typeof f.id !== 'string') errors.push(`${filename}: missing or invalid id`);
  if (!f.description || typeof f.description !== 'string') errors.push(`${filename}: missing or invalid description`);
  if (!Array.isArray(f.tags)) errors.push(`${filename}: missing or invalid tags`);
  if (!['junior', 'mid', 'senior'].includes(f.seniority as string)) errors.push(`${filename}: missing or invalid seniority`);
  if (!f.prContext || typeof (f.prContext as Record<string, unknown>).diff !== 'string') errors.push(`${filename}: missing or invalid prContext.diff`);
  if (!Array.isArray(f.groundTruth)) errors.push(`${filename}: missing or invalid groundTruth`);
  if (!f.transcript || !Array.isArray((f.transcript as Record<string, unknown>).rounds)) errors.push(`${filename}: missing or invalid transcript.rounds`);
  if (!f.expectedBands || typeof f.expectedBands !== 'object') errors.push(`${filename}: missing or invalid expectedBands`);

  for (const dim of REQUIRED_DIMENSIONS) {
    const band = (f.expectedBands as Record<string, unknown>)?.[dim] as Record<string, unknown> | undefined;
    if (!band) {
      errors.push(`${filename}: missing expectedBands.${dim}`);
      continue;
    }
    if (typeof band.min !== 'number' || band.min < 1 || band.min > 5) errors.push(`${filename}: invalid expectedBands.${dim}.min`);
    if (typeof band.max !== 'number' || band.max < 1 || band.max > 5) errors.push(`${filename}: invalid expectedBands.${dim}.max`);
    if (typeof band.rationale !== 'string') errors.push(`${filename}: invalid expectedBands.${dim}.rationale`);
  }

  return errors;
}

async function validateAllFixtures(): Promise<boolean> {
  const files = await readdir(OUTPUT_DIR);
  const jsonFiles = files.filter((f) => f.endsWith('.json') && !f.includes('ground-truth'));
  let total = 0;
  let failed = 0;
  const allErrors: string[] = [];

  for (const file of jsonFiles) {
    const raw = await readFile(path.join(OUTPUT_DIR, file), 'utf8');
    const parsed = JSON.parse(raw);
    const errors = validateFixture(parsed, file);
    total++;
    if (errors.length > 0) {
      failed++;
      allErrors.push(...errors);
    } else {
      console.log(`[validate] ✓ ${file}`);
    }
  }

  if (allErrors.length > 0) {
    console.error(`[validate] ${failed}/${total} fixtures failed:`);
    for (const err of allErrors) console.error(`  ✗ ${err}`);
    return false;
  }

  console.log(`[validate] All ${total} fixtures passed schema validation.`);
  return true;
}

// ─── Expand compact fixture to full ScorerCalibrationFixture ─────────────────

function expandCompactFixture(spec: CompactFixture): unknown {
  const rounds = spec.rounds.map((round: CompactRound) => ({
    round: round.round,
    reviewer_comments: round.comments.map((c) => ({
      id: c.id,
      file: c.file,
      line: c.line,
      category: c.category,
      severity: c.severity,
      what: c.what,
      why: c.why,
      ...(c.suggestion ? { suggestion: c.suggestion } : {}),
      positive: c.positive,
    })),
    reviewer_verdict: round.verdict?.decision,
    reviewer_summary: round.verdict?.summary,
    implementer_responses: round.responses.map((r) => ({
      to_comment_id: r.to_comment_id,
      move: r.move,
      content: r.content,
      ...(r.updated_code ? { updated_code: r.updated_code } : {}),
    })),
  }));

  const transcript = {
    rounds,
    verdict: {
      decision: spec.finalVerdict.decision,
      summary: spec.finalVerdict.summary,
      submittedAt: new Date().toISOString(),
    },
  };

  return {
    id: spec.id,
    description: spec.description,
    tags: spec.tags,
    seniority: spec.seniority,
    prContext: spec.prContext,
    groundTruth: spec.groundTruth,
    transcript,
    expectedBands: spec.expectedBands,
    metadata: spec.metadata ?? { confidence: 'heuristic' },
  };
}

// ─── Generate ground-truth sidecar ───────────────────────────────────────────

function buildGroundTruthSidecar(spec: CompactFixture): unknown {
  return {
    fixtureId: spec.id,
    plantedBugs: spec.groundTruth,
    summary: {
      total: spec.groundTruth.length,
      critical: spec.groundTruth.filter((b) => b.severity === 'critical').length,
      major: spec.groundTruth.filter((b) => b.severity === 'major').length,
      minor: spec.groundTruth.filter((b) => b.severity === 'minor').length,
      expectedFound: spec.groundTruth.filter((b) => b.expectedFound !== false).length,
      expectedMissed: spec.groundTruth.filter((b) => b.expectedFound === false).length,
    },
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  await mkdir(OUTPUT_DIR, { recursive: true });

  if (VALIDATE) {
    const ok = await validateAllFixtures();
    process.exit(ok ? 0 : 1);
  }

  let allSpecs: CompactFixture[] = [
    ...JUNIOR_FIXTURES,
    ...MID_FIXTURES,
    ...SENIOR_FIXTURES,
  ];

  // Merge external data sources if present
  const arenaCases = loadArenaCases();
  const calibrateRuns = loadCalibrateRuns();
  if (arenaCases.length > 0 || calibrateRuns.length > 0) {
    allSpecs = [...allSpecs, ...arenaCases, ...calibrateRuns];
  }

  if (SENIORITY_FILTER) {
    allSpecs = allSpecs.filter((s) => s.seniority === SENIORITY_FILTER);
  }

  if (PERSONA_FILTER) {
    allSpecs = allSpecs.filter((s) => derivePersona(s) === PERSONA_FILTER);
  }

  if (COUNT_LIMIT !== undefined && COUNT_LIMIT > 0) {
    allSpecs = allSpecs.slice(0, COUNT_LIMIT);
  }

  console.log(`[build-fixtures] Generating ${allSpecs.length} fixture(s) → ${OUTPUT_DIR}`);

  let generated = 0;
  for (const spec of allSpecs) {
    const fixture = expandCompactFixture(spec);
    const fixturePath = path.join(OUTPUT_DIR, `${spec.id}.json`);
    const sidecarPath = path.join(OUTPUT_DIR, `${spec.id}.ground-truth.json`);

    await writeFile(fixturePath, JSON.stringify(fixture, null, 2));
    await writeFile(sidecarPath, JSON.stringify(buildGroundTruthSidecar(spec), null, 2));

    console.log(`[build-fixtures]  ✓ ${spec.id} (${spec.seniority})`);
    generated++;
  }

  console.log(`[build-fixtures] Done — ${generated} fixture(s) + sidecar(s) written.`);
}

main().catch((err) => {
  console.error('[build-fixtures] Fatal error:', err);
  process.exit(1);
});
