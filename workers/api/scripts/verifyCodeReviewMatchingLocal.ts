#!/usr/bin/env tsx
/**
 * Compact local proof bundle for standalone CODE_REVIEW repo matching.
 *
 * This is intentionally read-only. It audits every local Wrangler D1 database
 * unless a database path is provided, then reports whether any database has at
 * least one real source-backed review packet that is ready for matching.
 */

import dotenv from 'dotenv';
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  auditReviewChallengePacketContexts,
  type AuditResult,
  type PacketAuditRow,
} from './auditReviewChallengePacketContexts';
import { SqliteQueryClient, type SqliteDatabase } from './prepareReviewChallengeGraphLocalDb';

const scriptDir = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(scriptDir, '..', '.dev.vars'), quiet: true });
const apiRoot = resolve(scriptDir, '..');

export interface ReadyPacketSummary {
  packetId: string;
  repoFullName: string;
  prNumber: number;
  isFixture: boolean;
  repoSourceRefCount: number;
  conceptLinkCount: number;
  reviewDifficultyBand: string | null;
  reviewExpectedSeniority: string | null;
  reviewExpectedTimeMinutes: number | null;
  reviewProfileReady: boolean;
}

export interface LocalMatchingDatabaseSummary {
  databasePath: string;
  auditStatus: AuditResult['status'];
  productionReady: boolean;
  totalPackets: number;
  fixturePackets: number;
  realPackets: number;
  overlayReadyPackets: number;
  realOverlayReadyPackets: number;
  contrastReady: boolean;
  calibratedContrastReady: boolean;
  realOverlayReadyWithReviewProfiles: number;
  eligibleSamplePullRequests: number | null;
  readyPackets: ReadyPacketSummary[];
}

export interface LocalMatchingProof {
  ready: boolean;
  status: 'ready' | 'not_ready';
  selectedDatabasePath: string | null;
  databases: LocalMatchingDatabaseSummary[];
  failures: string[];
  nextActions: string[];
}

function usage(): string {
  return [
    'Usage: npx tsx scripts/verifyCodeReviewMatchingLocal.ts [options]',
    '',
    'Options:',
    '  --database-path PATH  Audit one local SQLite database instead of all local DBs',
    '  --require-ready       Exit non-zero unless at least one DB has a real overlay-ready packet',
    '  --json                Print machine-readable JSON',
    '  --help, -h            Show this help',
  ].join('\n');
}

interface CliOptions {
  databasePath?: string;
  requireReady: boolean;
  json: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    requireReady: false,
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === '--database-path' || arg.startsWith('--database-path=')) {
      const inline = arg.match(/^--database-path=(.+)$/)?.[1];
      const value = inline ?? argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error('--database-path requires a value');
      options.databasePath = value;
      if (!inline) index += 1;
    } else if (arg === '--require-ready') {
      options.requireReady = true;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function discoverLocalDatabases(explicitPath?: string): string[] {
  if (explicitPath) return [resolve(apiRoot, explicitPath)];
  const directory = resolve(apiRoot, '.wrangler/state/v3/d1/miniflare-D1DatabaseObject');
  return readdirSync(directory)
    .filter((name) => name.endsWith('.sqlite') && name !== 'metadata.sqlite')
    .map((name) => resolve(directory, name))
    .sort();
}

function summarizeReadyPacket(row: PacketAuditRow): ReadyPacketSummary {
  return {
    packetId: row.packetId,
    repoFullName: row.repoFullName,
    prNumber: row.prNumber,
    isFixture: row.isFixture,
    repoSourceRefCount: row.repoSourceRefCount,
    conceptLinkCount: row.conceptLinkCount,
    reviewDifficultyBand: row.reviewDifficultyBand,
    reviewExpectedSeniority: row.reviewExpectedSeniority,
    reviewExpectedTimeMinutes: row.reviewExpectedTimeMinutes,
    reviewProfileReady: row.reviewProfileReady,
  };
}

export function summarizeDatabaseAudit(
  databasePath: string,
  audit: AuditResult,
): LocalMatchingDatabaseSummary {
  const readyPackets = audit.rows
    .filter((row) => row.overlayReady)
    .sort((left, right) =>
      Number(left.isFixture) - Number(right.isFixture)
      || left.repoFullName.localeCompare(right.repoFullName)
      || left.prNumber - right.prNumber
      || left.packetId.localeCompare(right.packetId)
    )
    .slice(0, 5)
    .map(summarizeReadyPacket);

  return {
    databasePath,
    auditStatus: audit.status,
    productionReady: audit.stats.realOverlayReadyPackets > 0,
    totalPackets: audit.stats.totalPackets,
    fixturePackets: audit.stats.fixturePackets,
    realPackets: audit.stats.realPackets,
    overlayReadyPackets: audit.stats.overlayReadyPackets,
    realOverlayReadyPackets: audit.stats.realOverlayReadyPackets,
    contrastReady: audit.stats.realOverlayReadyPackets >= 2,
    calibratedContrastReady: audit.stats.realOverlayReadyWithReviewProfiles >= 2,
    realOverlayReadyWithReviewProfiles: audit.stats.realOverlayReadyWithReviewProfiles,
    eligibleSamplePullRequests: audit.sourceStats.eligibleSamplePullRequests,
    readyPackets,
  };
}

function bestDatabase(
  summaries: LocalMatchingDatabaseSummary[],
): LocalMatchingDatabaseSummary | null {
  return [...summaries].sort((left, right) =>
    Number(right.calibratedContrastReady) - Number(left.calibratedContrastReady)
    || Number(right.productionReady) - Number(left.productionReady)
    || right.realOverlayReadyWithReviewProfiles - left.realOverlayReadyWithReviewProfiles
    || right.realOverlayReadyPackets - left.realOverlayReadyPackets
    || right.overlayReadyPackets - left.overlayReadyPackets
    || right.totalPackets - left.totalPackets
    || left.databasePath.localeCompare(right.databasePath)
  )[0] ?? null;
}

export function buildLocalMatchingProof(
  summaries: LocalMatchingDatabaseSummary[],
): LocalMatchingProof {
  const selected = bestDatabase(summaries);
  const ready = summaries.some((summary) => summary.calibratedContrastReady);
  const failures: string[] = [];
  const nextActions: string[] = [];

  if (summaries.length === 0) {
    failures.push('no local Wrangler D1 SQLite databases were found');
    nextActions.push('Start the local Worker once or pass --database-path to a seeded local D1 database.');
  }

  if (!ready && summaries.length > 0) {
    if (!summaries.some((summary) => summary.productionReady)) {
      failures.push('no local D1 database has a real overlay-ready source-backed CODE_REVIEW packet');
    }
    if (!summaries.some((summary) => summary.contrastReady) && summaries.some((summary) => summary.productionReady)) {
      failures.push('fewer than two real overlay-ready CODE_REVIEW packets are available for contrast separation');
    }
    if (summaries.some((summary) => summary.contrastReady && !summary.calibratedContrastReady)) {
      failures.push('fewer than two real overlay-ready CODE_REVIEW packets include assessment-fit review profiles');
    }
    if (summaries.some((summary) => summary.overlayReadyPackets > 0 && summary.realOverlayReadyPackets === 0)) {
      failures.push('local overlay-ready packets are fixture-only and do not prove production repo matching');
    }
    if (summaries.every((summary) => (summary.eligibleSamplePullRequests ?? 0) === 0)) {
      nextActions.push('Sync or crawl real repos so repo_sample_prs contains at least one non-fixture SWE-bench-eligible PR.');
    }
    if (summaries.some((summary) => summary.contrastReady && !summary.calibratedContrastReady)) {
      nextActions.push('Rebuild or backfill real review challenge packets so packet_json contains reviewProfile assessment-fit metadata.');
    }
    if (!summaries.some((summary) => summary.contrastReady)) {
      nextActions.push('Run backfillReviewChallengePackets.ts in write mode for another real GitHub PR, then rerun this proof.');
    }
  }

  if (summaries.length > 1) {
    nextActions.push('Pass --database-path to route-specific scripts when you need to target one local D1 database.');
  }

  return {
    ready,
    status: ready ? 'ready' : 'not_ready',
    selectedDatabasePath: selected?.databasePath ?? null,
    databases: summaries,
    failures,
    nextActions: [...new Set(nextActions)],
  };
}

function openDatabase(path: string): { database: SqliteDatabase; close: () => void } {
  const require = createRequire(import.meta.url);
  const { DatabaseSync } = require('node:sqlite') as {
    DatabaseSync: new (path: string) => SqliteDatabase;
  };
  const database = new DatabaseSync(path);
  return { database, close: () => database.close?.() };
}

async function auditLocalDatabase(path: string): Promise<LocalMatchingDatabaseSummary> {
  const { database, close } = openDatabase(path);
  try {
    const audit = await auditReviewChallengePacketContexts(new SqliteQueryClient(database));
    return summarizeDatabaseAudit(path, audit);
  } finally {
    close();
  }
}

function printHuman(proof: LocalMatchingProof): void {
  console.log('CODE_REVIEW local matching proof');
  console.log(`  status:              ${proof.status}`);
  console.log(`  selected database:   ${proof.selectedDatabasePath ?? 'none'}`);
  for (const database of proof.databases) {
    console.log('');
    console.log(`  ${database.databasePath}`);
    console.log(`    audit status:       ${database.auditStatus}`);
    console.log(`    production ready:   ${database.productionReady ? 'YES' : 'NO'}`);
    console.log(`    packets:            ${database.totalPackets}`);
    console.log(`    fixture packets:    ${database.fixturePackets}`);
    console.log(`    real packets:       ${database.realPackets}`);
    console.log(`    overlay ready:      ${database.overlayReadyPackets}`);
    console.log(`    real overlay ready: ${database.realOverlayReadyPackets}`);
    console.log(`    real calibrated:    ${database.realOverlayReadyWithReviewProfiles}`);
    console.log(`    contrast ready:     ${database.contrastReady ? 'YES' : 'NO'}`);
    console.log(`    calibrated contrast:${database.calibratedContrastReady ? 'YES' : 'NO'}`);
    console.log(`    eligible sample PRs:${database.eligibleSamplePullRequests ?? 'unknown'}`);
    for (const packet of database.readyPackets) {
      const profile = packet.reviewProfileReady
        ? ` ${packet.reviewDifficultyBand}/${packet.reviewExpectedSeniority}/${packet.reviewExpectedTimeMinutes}m`
        : ' uncalibrated';
      console.log(`    ready packet:       ${packet.repoFullName}#${packet.prNumber}${packet.isFixture ? ' (fixture)' : ''}${profile}`);
    }
  }
  if (proof.failures.length > 0) {
    console.log('');
    console.log('  failures:');
    for (const failure of proof.failures) console.log(`    - ${failure}`);
  }
  if (proof.nextActions.length > 0) {
    console.log('');
    console.log('  next actions:');
    for (const action of proof.nextActions) console.log(`    - ${action}`);
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const databasePaths = discoverLocalDatabases(options.databasePath);
  const summaries = await Promise.all(databasePaths.map(auditLocalDatabase));
  const proof = buildLocalMatchingProof(summaries);
  if (options.json) {
    console.log(JSON.stringify(proof, null, 2));
  } else {
    printHuman(proof);
  }
  if (options.requireReady && !proof.ready) {
    process.exitCode = 1;
  }
}

if (process.argv[1]?.endsWith('verifyCodeReviewMatchingLocal.ts')) {
  main().catch((err) => {
    console.error('[verifyCodeReviewMatchingLocal] Fatal:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
