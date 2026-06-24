#!/usr/bin/env tsx
/**
 * Rollout gate for source-backed review challenge graph readiness.
 *
 * This composes existing checks without creating packets or faking GitHub data:
 * it can prepare a local crawler D1 with graph migrations, audits packet context
 * coverage, and optionally verifies GitHub API reachability before backfill.
 */

import dotenv from 'dotenv';
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  auditReviewChallengePacketContexts,
  type AuditResult,
  type QueryClient,
} from './auditReviewChallengePacketContexts';
import {
  checkGitHubApiConnectivity,
  type GitHubConnectivityResult,
} from './backfillReviewChallengePackets';
import { D1Client, loadD1Config } from './crawl-repos/shared/d1Client.js';
import {
  prepareReviewChallengeGraphLocalDb,
  SqliteQueryClient,
  type PrepareResult,
  type SqliteDatabase,
} from './prepareReviewChallengeGraphLocalDb';

const scriptDir = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(scriptDir, '..', '.dev.vars'), quiet: true });
const apiRoot = resolve(scriptDir, '..');

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ReviewChallengeGraphReadinessOptions {
  target?: 'local' | 'remote';
  prepareLocal?: boolean;
  schemaOnly?: boolean;
  requireGitHub?: boolean;
  githubToken?: string;
  githubTimeoutMs?: number;
  fetchImpl?: FetchLike;
}

export interface ReviewChallengeGraphReadinessInput {
  client: QueryClient;
  database?: SqliteDatabase;
  databasePath?: string;
  options?: ReviewChallengeGraphReadinessOptions;
}

export interface ReviewChallengeGraphReadinessReport {
  ready: boolean;
  status: 'ready' | 'not_ready';
  databasePath: string | null;
  audit: AuditResult;
  github: GitHubConnectivityResult | null;
  prepare: PrepareResult | null;
  failures: string[];
  nextActions: string[];
}

function auditFailures(
  audit: AuditResult,
  options: Pick<ReviewChallengeGraphReadinessOptions, 'schemaOnly'> = {},
): string[] {
  if (options.schemaOnly && audit.status !== 'missing_graph_tables') {
    return [];
  }
  const projectionFailures = [
    ...audit.missingContextRecordPacketIds.map((id) =>
      `review challenge packet ${id} is missing its repo_challenge_packet context record`
    ),
    ...audit.missingRepoSourceRefPacketIds.map((id) =>
      `review challenge packet ${id} is missing repo_source_span context refs`
    ),
    ...audit.missingConceptLinkPacketIds.map((id) =>
      `review challenge packet ${id} is missing context_record_concepts links`
    ),
  ];
  switch (audit.status) {
    case 'ready':
      return [];
    case 'missing_graph_tables':
      return [`review challenge graph tables are missing: ${audit.missingTables.join(', ')}`];
    case 'no_packets':
      return audit.sourceStats.eligibleSamplePullRequests && audit.sourceStats.eligibleSamplePullRequests > 0
        ? [`${audit.sourceStats.eligibleSamplePullRequests} eligible sample PR(s) exist, but no review challenge packets have been backfilled`]
        : ['no review challenge packets have been backfilled'];
    case 'fixture_only':
      return ['only fixture review challenge packets are present; production needs at least one real packet'];
    case 'no_real_overlay_ready_packets':
      return [
        'no real review challenge packet has complete context-record, repo-source-ref, and concept-link coverage',
        ...projectionFailures,
      ];
    case 'incomplete_context_projection':
      return projectionFailures;
  }
}

function nextActionsForAudit(
  audit: AuditResult,
  options: Pick<ReviewChallengeGraphReadinessOptions, 'target'>,
): string[] {
  const hasProjectionGaps = audit.missingContextRecordPacketIds.length > 0
    || audit.missingRepoSourceRefPacketIds.length > 0
    || audit.missingConceptLinkPacketIds.length > 0;
  switch (audit.status) {
    case 'ready':
      return [];
    case 'missing_graph_tables':
      return options.target === 'remote'
        ? [
            'Run the Review Graph Rollout workflow with prepare_graph_schema_only=true, or apply migrations 0082_living_context_graph.sql, 0083_repo_semantic_graph_and_match_runs.sql, and 0095_context_records.sql to remote D1 after reviewing the migration backlog.',
          ]
        : ['Run prepareReviewChallengeGraphLocalDb.ts against the local crawler D1 before packet backfill.'];
    case 'no_packets':
      return ['Run backfillReviewChallengePackets.ts after GitHub API connectivity is available.'];
    case 'fixture_only':
      return ['Backfill at least one non-fixture GitHub PR packet through persistReviewChallengeGraph.'];
    case 'no_real_overlay_ready_packets':
      return hasProjectionGaps
        ? ['Repair or rebuild the listed packet context projections before rollout.']
        : ['Rebuild review packets through persistReviewChallengeGraph so each packet has source refs and concept links.'];
    case 'incomplete_context_projection':
      return ['Repair or rebuild the listed packet context projections before rollout.'];
  }
}

export async function checkReviewChallengeGraphReadiness(
  input: ReviewChallengeGraphReadinessInput,
): Promise<ReviewChallengeGraphReadinessReport> {
  const options = input.options ?? {};
  if (options.prepareLocal && !input.database) {
    throw new Error('prepareLocal requires a writable local SQLite database');
  }

  const prepare = options.prepareLocal && input.database
    ? await prepareReviewChallengeGraphLocalDb(input.database, input.databasePath ?? '<memory>')
    : null;
  const audit = prepare?.after ?? await auditReviewChallengePacketContexts(input.client);
  const github = options.requireGitHub
    ? await checkGitHubApiConnectivity({
        token: options.githubToken,
        timeoutMs: options.githubTimeoutMs,
        fetchImpl: options.fetchImpl,
      })
    : null;

  const failures = auditFailures(audit, options);
  const nextActions = nextActionsForAudit(audit, options);
  if (github && !github.ok) {
    failures.push(`GitHub API is not reachable for review packet backfill: ${github.message}`);
    nextActions.push('Restore GitHub API connectivity and verify GITHUB_TOKEN/rate limits before packet backfill.');
  }

  return {
    ready: failures.length === 0,
    status: failures.length === 0 ? 'ready' : 'not_ready',
    databasePath: input.databasePath ?? null,
    audit,
    github,
    prepare,
    failures,
    nextActions: [...new Set(nextActions)],
  };
}

function usage(): string {
  return [
    'Usage: npx tsx scripts/checkReviewChallengeGraphReadiness.ts [options]',
    '',
    'Options:',
    '  --local               Audit local Wrangler D1 database (default)',
    '  --remote              Audit Cloudflare D1 via REST',
    '  --database-path PATH  Override local SQLite discovery',
    '  --prepare-local       Apply graph/context migrations before auditing',
    '  --schema-only         Require only graph tables, allowing packet backfill to run next',
    '  --require-github      Fail unless GitHub API is reachable',
    '  --json                Print machine-readable JSON',
    '  --help, -h            Show this help',
  ].join('\n');
}

interface CliOptions {
  target: 'local' | 'remote';
  databasePath?: string;
  prepareLocal: boolean;
  schemaOnly: boolean;
  requireGitHub: boolean;
  json: boolean;
}

function readValue(argv: string[], index: number, flag: string): [string, number] {
  const inline = argv[index]?.match(new RegExp(`^${flag}=(.+)$`))?.[1];
  if (inline !== undefined) return [inline, index];
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return [value, index + 1];
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    target: 'local',
    prepareLocal: false,
    schemaOnly: false,
    requireGitHub: false,
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === '--local') {
      options.target = 'local';
    } else if (arg === '--remote') {
      options.target = 'remote';
    } else if (arg === '--prepare-local') {
      options.prepareLocal = true;
    } else if (arg === '--schema-only') {
      options.schemaOnly = true;
    } else if (arg === '--require-github') {
      options.requireGitHub = true;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--database-path' || arg.startsWith('--database-path=')) {
      const [value, consumedIndex] = readValue(argv, index, '--database-path');
      options.databasePath = value;
      index = consumedIndex;
    } else if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (options.target === 'remote' && options.databasePath) {
    throw new Error('--database-path can only be used with --local');
  }
  if (options.target === 'remote' && options.prepareLocal) {
    throw new Error('--prepare-local can only be used with --local');
  }
  return options;
}

function openLocalDatabase(databasePath?: string): { database: SqliteDatabase; path: string } {
  const require = createRequire(import.meta.url);
  const { DatabaseSync } = require('node:sqlite') as {
    DatabaseSync: new (path: string) => SqliteDatabase;
  };
  const resolvedPath = databasePath
    ? resolve(apiRoot, databasePath)
    : (() => {
        const directory = resolve(apiRoot, '.wrangler/state/v3/d1/miniflare-D1DatabaseObject');
        const candidates = readdirSync(directory)
          .filter((name) => name.endsWith('.sqlite') && name !== 'metadata.sqlite')
          .map((name) => resolve(directory, name));
        if (candidates.length !== 1) {
          throw new Error(
            `Expected one local D1 database; pass --database-path. Found: ${candidates.join(', ') || 'none'}`,
          );
        }
        return candidates[0]!;
      })();
  return { database: new DatabaseSync(resolvedPath), path: resolvedPath };
}

function printHuman(report: ReviewChallengeGraphReadinessReport): void {
  console.log('review challenge graph readiness gate');
  console.log(`  ready:                 ${report.ready ? 'YES' : 'NO'}`);
  console.log(`  audit status:          ${report.audit.status}`);
  console.log(`  database:              ${report.databasePath ?? '(unknown)'}`);
  console.log(`  total packets:         ${report.audit.stats.totalPackets}`);
  console.log(`  real overlay-ready:    ${report.audit.stats.realOverlayReadyPackets}`);
  console.log(`  eligible sample PRs:   ${report.audit.sourceStats.eligibleSamplePullRequests ?? 'unknown'}`);
  if (report.github) {
    console.log(`  GitHub API:            ${report.github.ok ? 'reachable' : 'unreachable'}`);
    console.log(`  GitHub message:        ${report.github.message}`);
    console.log(`  GitHub rate remaining: ${report.github.rateLimitRemaining ?? 'unknown'}`);
  }
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

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const opened = options.target === 'local' ? openLocalDatabase(options.databasePath) : null;
  const database = opened?.database;
  try {
    const client: QueryClient = database ? new SqliteQueryClient(database) : new D1Client(loadD1Config());
    const report = await checkReviewChallengeGraphReadiness({
      client,
      database,
      databasePath: opened?.path ?? 'remote',
      options: {
        prepareLocal: options.prepareLocal,
        schemaOnly: options.schemaOnly,
        requireGitHub: options.requireGitHub,
        target: options.target,
        githubToken: process.env['GITHUB_TOKEN'],
      },
    });
    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printHuman(report);
    }
    if (!report.ready) process.exitCode = 1;
  } finally {
    database?.close?.();
  }
}

if (process.argv[1]?.endsWith('checkReviewChallengeGraphReadiness.ts')) {
  main().catch((error) => {
    console.error('[checkReviewChallengeGraphReadiness] Fatal:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
