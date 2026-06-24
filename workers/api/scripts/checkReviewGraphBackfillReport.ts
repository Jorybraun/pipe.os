#!/usr/bin/env tsx

import { readFileSync } from 'node:fs';
import type {
  BackfillCliReport,
  BackfillRowOutcome,
} from './backfillReviewChallengePackets';

export interface BackfillReportGateOptions {
  expectedMode?: 'dry-run' | 'write';
  minReadyOutcomes?: number;
}

export interface BackfillReportGateResult {
  ready: boolean;
  status: 'ready' | 'not_ready';
  mode: 'dry-run' | 'write' | 'unknown';
  target: 'local' | 'remote' | 'unknown';
  readyOutcomeCount: number;
  dryRunReadyCount: number;
  persistedContextReadyCount: number;
  failures: string[];
  nextActions: string[];
  readyOutcomes: BackfillRowOutcome[];
}

function usage(): string {
  return [
    'Usage: npx tsx scripts/checkReviewGraphBackfillReport.ts --file PATH [options]',
    '',
    'Options:',
    '  --file PATH              Backfill JSON report from backfillReviewChallengePackets --json',
    '  --expected-mode MODE     Expected mode: dry-run or write',
    '  --min-ready N            Minimum ready outcomes required (default 1)',
    '  --json                   Print machine-readable JSON',
    '  --help, -h               Show this help',
  ].join('\n');
}

interface CliOptions extends BackfillReportGateOptions {
  file?: string;
  json: boolean;
}

function readValue(argv: string[], index: number, flag: string): [string, number] {
  const inline = argv[index]?.match(new RegExp(`^${flag}=(.+)$`))?.[1];
  if (inline !== undefined) return [inline, index];
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return [value, index + 1];
}

function positiveInteger(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === '--file' || arg.startsWith('--file=')) {
      const [value, consumedIndex] = readValue(argv, index, '--file');
      options.file = value;
      index = consumedIndex;
    } else if (arg === '--expected-mode' || arg.startsWith('--expected-mode=')) {
      const [value, consumedIndex] = readValue(argv, index, '--expected-mode');
      if (value !== 'dry-run' && value !== 'write') {
        throw new Error('--expected-mode must be dry-run or write');
      }
      options.expectedMode = value;
      index = consumedIndex;
    } else if (arg === '--min-ready' || arg.startsWith('--min-ready=')) {
      const [value, consumedIndex] = readValue(argv, index, '--min-ready');
      options.minReadyOutcomes = positiveInteger(value, '--min-ready');
      index = consumedIndex;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!options.file) throw new Error('--file is required');
  return options;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function validBuiltPacket(outcome: BackfillRowOutcome): boolean {
  return outcome.packetId !== null
    && outcome.repoSnapshotId !== null
    && outcome.packetContentHash !== null
    && outcome.eligible === true
    && numberValue(outcome.demandCount) > 0
    && numberValue(outcome.sourceSpanCount) > 0
    && numberValue(outcome.changedFileCount) > 0
    && numberValue(outcome.structuralFactCount) > 0;
}

function dryRunReady(outcome: BackfillRowOutcome): boolean {
  return outcome.status === 'dry_run_ready' && validBuiltPacket(outcome);
}

function persistedContextReady(outcome: BackfillRowOutcome): boolean {
  return outcome.status === 'persisted'
    && validBuiltPacket(outcome)
    && outcome.productionReady === true
    && outcome.contextRecordId !== null
    && numberValue(outcome.repoSourceRefCount) > 0
    && numberValue(outcome.conceptLinkCount) > 0
    && outcome.persistedContextReady === true;
}

function nextActionsForMode(mode: 'dry-run' | 'write' | 'unknown'): string[] {
  if (mode === 'dry-run') {
    return ['Run a bounded dry-run against an eligible crawler PR that can build an eligible source-backed packet.'];
  }
  if (mode === 'write') {
    return ['Run write-mode backfill after migrations and GitHub connectivity, then require at least one persisted context-ready packet.'];
  }
  return ['Regenerate the report with backfillReviewChallengePackets --json.'];
}

export function validateBackfillReport(
  report: unknown,
  options: BackfillReportGateOptions = {},
): BackfillReportGateResult {
  const failures: string[] = [];
  const minReadyOutcomes = options.minReadyOutcomes ?? 1;
  if (!isObject(report)) {
    return {
      ready: false,
      status: 'not_ready',
      mode: 'unknown',
      target: 'unknown',
      readyOutcomeCount: 0,
      dryRunReadyCount: 0,
      persistedContextReadyCount: 0,
      failures: ['backfill report is not a JSON object'],
      nextActions: nextActionsForMode('unknown'),
      readyOutcomes: [],
    };
  }

  const mode = report['mode'] === 'dry-run' || report['mode'] === 'write'
    ? report['mode']
    : 'unknown';
  const target = report['target'] === 'local' || report['target'] === 'remote'
    ? report['target']
    : 'unknown';
  const outcomes = Array.isArray(report['outcomes'])
    ? report['outcomes'].filter(isObject) as unknown as BackfillRowOutcome[]
    : [];
  const stats = isObject(report['stats']) ? report['stats'] : {};

  if (options.expectedMode && mode !== options.expectedMode) {
    failures.push(`expected ${options.expectedMode} report, received ${mode}`);
  }
  if (report['status'] === 'failed' || numberValue(stats['errors']) > 0) {
    failures.push('backfill report contains errors');
  }
  if (mode === 'write' && numberValue(stats['skippedFetch']) > 0) {
    failures.push('write-mode backfill skipped selected PRs because GitHub data was unavailable');
  }
  if (mode === 'write' && numberValue(stats['skippedNoHunks']) > 0) {
    failures.push('write-mode backfill skipped selected PRs because source hunks were unavailable');
  }
  if (outcomes.length === 0) {
    failures.push('backfill report has no PR outcomes');
  }

  const dryRunReadyOutcomes = outcomes.filter(dryRunReady);
  const persistedContextReadyOutcomes = outcomes.filter(persistedContextReady);
  const readyOutcomes = mode === 'write'
    ? persistedContextReadyOutcomes
    : mode === 'dry-run'
      ? dryRunReadyOutcomes
      : [];

  if (readyOutcomes.length < minReadyOutcomes) {
    failures.push(
      mode === 'write'
        ? `expected at least ${minReadyOutcomes} persisted context-ready packet outcome(s), found ${readyOutcomes.length}`
        : `expected at least ${minReadyOutcomes} eligible dry-run packet outcome(s), found ${readyOutcomes.length}`,
    );
  }

  return {
    ready: failures.length === 0,
    status: failures.length === 0 ? 'ready' : 'not_ready',
    mode,
    target,
    readyOutcomeCount: readyOutcomes.length,
    dryRunReadyCount: dryRunReadyOutcomes.length,
    persistedContextReadyCount: persistedContextReadyOutcomes.length,
    failures,
    nextActions: failures.length === 0 ? [] : nextActionsForMode(mode),
    readyOutcomes,
  };
}

function printHuman(result: BackfillReportGateResult): void {
  console.log('review graph backfill report gate');
  console.log(`  ready:                   ${result.ready ? 'YES' : 'NO'}`);
  console.log(`  mode:                    ${result.mode}`);
  console.log(`  target:                  ${result.target}`);
  console.log(`  ready outcomes:          ${result.readyOutcomeCount}`);
  console.log(`  dry-run ready:           ${result.dryRunReadyCount}`);
  console.log(`  persisted context-ready: ${result.persistedContextReadyCount}`);
  if (result.failures.length > 0) {
    console.log('');
    console.log('Failures:');
    for (const failure of result.failures) console.log(`- ${failure}`);
  }
  if (result.nextActions.length > 0) {
    console.log('');
    console.log('Next actions:');
    for (const action of result.nextActions) console.log(`- ${action}`);
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const report = JSON.parse(readFileSync(options.file!, 'utf8')) as BackfillCliReport;
  const result = validateBackfillReport(report, options);
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printHuman(result);
  }
  if (!result.ready) process.exitCode = 1;
}

if (process.argv[1]?.endsWith('checkReviewGraphBackfillReport.ts')) {
  main().catch((error) => {
    console.error(`[checkReviewGraphBackfillReport] Fatal: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
