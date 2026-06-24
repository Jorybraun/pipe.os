#!/usr/bin/env tsx
/**
 * Guard the review-graph rollout from accidentally applying a broad production
 * D1 migration backlog when only the source-backed review graph is intended.
 */

import { readFileSync } from 'node:fs';

export const REQUIRED_REVIEW_GRAPH_MIGRATIONS = [
  '0082_living_context_graph.sql',
  '0083_repo_semantic_graph_and_match_runs.sql',
  '0095_context_records.sql',
] as const;

export interface MigrationPlanOptions {
  requiredMigrations?: readonly string[];
  allowExtraPendingMigrations?: boolean;
}

export interface MigrationPlanReport {
  ready: boolean;
  status: 'ready_to_apply' | 'blocked' | 'nothing_to_apply';
  requiredMigrations: string[];
  pendingMigrations: string[];
  pendingRequiredMigrations: string[];
  missingRequiredMigrations: string[];
  extraPendingMigrations: string[];
  allowExtraPendingMigrations: boolean;
  failures: string[];
  nextActions: string[];
}

export function parseWranglerPendingMigrations(output: string): string[] {
  const migrations = new Set<string>();
  const migrationPattern = /(?:^|│)\s*(\d{4}_[^│\s]+\.sql)\s*(?:│|$)/gm;
  let match: RegExpExecArray | null;
  while ((match = migrationPattern.exec(output)) !== null) {
    migrations.add(match[1]!);
  }
  return [...migrations].sort();
}

export function buildReviewGraphMigrationPlan(
  pendingMigrations: readonly string[],
  options: MigrationPlanOptions = {},
): MigrationPlanReport {
  const requiredMigrations = [...(options.requiredMigrations ?? REQUIRED_REVIEW_GRAPH_MIGRATIONS)].sort();
  const pending = [...new Set(pendingMigrations)].sort();
  const required = new Set(requiredMigrations);
  const pendingRequiredMigrations = pending.filter((migration) => required.has(migration));
  const pendingSet = new Set(pending);
  const missingRequiredMigrations = requiredMigrations.filter((migration) => !pendingSet.has(migration));
  const extraPendingMigrations = pending.filter((migration) => !required.has(migration));
  const allowExtraPendingMigrations = options.allowExtraPendingMigrations === true;
  const failures: string[] = [];
  const nextActions: string[] = [];

  if (extraPendingMigrations.length > 0 && !allowExtraPendingMigrations) {
    failures.push(
      `migration apply would also apply ${extraPendingMigrations.length} unrelated pending migration(s)`,
    );
    nextActions.push(
      'Run the rollout with allow_extra_pending_migrations only after reviewing the full production migration backlog.',
    );
    nextActions.push(
      'Use the graph-only schema prep path to execute just the required review-graph SQL files if the broader migration batch is not ready.',
    );
  }

  if (pendingRequiredMigrations.length === 0 && pending.length > 0) {
    nextActions.push(
      'Review graph migrations are not pending; use the readiness report to confirm graph tables are already present before backfill.',
    );
  }

  if (pending.length === 0) {
    nextActions.push('No D1 migrations are pending; run the review graph readiness gate before backfill.');
  }

  const ready = failures.length === 0;
  const status = pending.length === 0
    ? 'nothing_to_apply'
    : ready
      ? 'ready_to_apply'
      : 'blocked';

  return {
    ready,
    status,
    requiredMigrations,
    pendingMigrations: pending,
    pendingRequiredMigrations,
    missingRequiredMigrations,
    extraPendingMigrations,
    allowExtraPendingMigrations,
    failures,
    nextActions: [...new Set(nextActions)],
  };
}

function usage(): string {
  return [
    'Usage: npx tsx scripts/checkReviewGraphMigrationPlan.ts --file PATH [options]',
    '',
    'Options:',
    '  --file PATH               Text output from `wrangler d1 migrations list`',
    '  --allow-extra-pending     Permit applying unrelated pending migrations in the same D1 batch',
    '  --json                    Print machine-readable JSON (default)',
    '  --help, -h                Show this help',
  ].join('\n');
}

interface CliOptions {
  file?: string;
  allowExtraPendingMigrations: boolean;
  json: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    allowExtraPendingMigrations: false,
    json: true,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === '--allow-extra-pending') {
      options.allowExtraPendingMigrations = true;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--file' || arg.startsWith('--file=')) {
      const inline = arg.match(/^--file=(.+)$/)?.[1];
      const value = inline ?? argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error('--file requires a path');
      options.file = value;
      if (!inline) index += 1;
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

function printHuman(report: MigrationPlanReport): void {
  console.log('review graph migration plan');
  console.log(`  status:             ${report.status}`);
  console.log(`  ready:              ${report.ready ? 'YES' : 'NO'}`);
  console.log(`  pending total:      ${report.pendingMigrations.length}`);
  console.log(`  required pending:   ${report.pendingRequiredMigrations.join(', ') || '(none)'}`);
  console.log(`  extra pending:      ${report.extraPendingMigrations.length}`);
  if (report.failures.length > 0) {
    console.log('');
    console.log('Failures:');
    for (const failure of report.failures) console.log(`- ${failure}`);
  }
  if (report.nextActions.length > 0) {
    console.log('');
    console.log('Next actions:');
    for (const action of report.nextActions) console.log(`- ${action}`);
  }
}

if (process.argv[1]?.endsWith('checkReviewGraphMigrationPlan.ts')) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const output = readFileSync(options.file!, 'utf8');
    const report = buildReviewGraphMigrationPlan(
      parseWranglerPendingMigrations(output),
      { allowExtraPendingMigrations: options.allowExtraPendingMigrations },
    );
    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printHuman(report);
    }
    if (!report.ready) process.exitCode = 1;
  } catch (error) {
    console.error('[checkReviewGraphMigrationPlan] Fatal:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
