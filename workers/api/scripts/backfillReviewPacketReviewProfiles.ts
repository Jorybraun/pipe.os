#!/usr/bin/env tsx
/**
 * Repair legacy review_challenge_packets rows by adding persisted
 * reviewProfile assessment-fit metadata to packet_json.
 *
 * The script is local-D1 focused and dry-runs by default. Use --write to
 * mutate packet_json.
 */

import dotenv from 'dotenv';
import { readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildChallengeReviewProfileFromFacts,
  hashObject,
  stableJson,
  type ChallengeReviewProfile,
  type ChallengeReviewProfileBasis,
} from '../src/lib/repoSemanticGraph';

type SqlValue = string | number | null;

interface SqliteStatement {
  all(...values: SqlValue[]): unknown[];
  get(...values: SqlValue[]): unknown;
  run(...values: SqlValue[]): { changes?: number | bigint } | unknown;
}

export interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
  close?: () => void;
}

interface PacketRow {
  id: string;
  repo_full_name: string | null;
  pr_number: number;
  production_ready: number;
  packet_json: string;
  source_hash: string | null;
}

interface SourceSpanRow {
  id: string;
  path: string | null;
  exact_text: string;
  line_start: number | null;
  line_end: number | null;
}

type RepairStatus =
  | 'already_ready'
  | 'would_update'
  | 'updated'
  | 'invalid_json'
  | 'missing_source_spans'
  | 'unsupported_packet';

export interface RepairOutcome {
  packetId: string;
  repoFullName: string | null;
  prNumber: number;
  status: RepairStatus;
  reviewDifficultyBand: string | null;
  reviewExpectedSeniority: string | null;
  reviewExpectedTimeMinutes: number | null;
  changedFileCount: number | null;
  changedLineCount: number | null;
  sourceHunkCount: number | null;
  error: string | null;
}

export interface RepairStats {
  scanned: number;
  alreadyReady: number;
  wouldUpdate: number;
  updated: number;
  invalidJson: number;
  missingSourceSpans: number;
  unsupportedPacket: number;
}

export interface RepairResult {
  mode: 'dry-run' | 'write';
  databasePath: string;
  stats: RepairStats;
  outcomes: RepairOutcome[];
}

export interface RepairOptions {
  write: boolean;
  limit?: number;
  onlyProductionReady?: boolean;
  databasePath?: string;
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(scriptDir, '..', '.dev.vars'), quiet: true });
const apiRoot = resolve(scriptDir, '..');

function zeroStats(): RepairStats {
  return {
    scanned: 0,
    alreadyReady: 0,
    wouldUpdate: 0,
    updated: 0,
    invalidJson: 0,
    missingSourceSpans: 0,
    unsupportedPacket: 0,
  };
}

function hasReadyReviewProfile(value: unknown): value is ChallengeReviewProfile {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const basis = record.basis;
  return record.source === 'deterministic_engineering_prior'
    && ['introductory', 'focused', 'advanced', 'oversized'].includes(String(record.difficultyBand))
    && ['mid', 'senior', 'staff'].includes(String(record.expectedSeniority))
    && typeof record.expectedTimeMinutes === 'number'
    && Number.isFinite(record.expectedTimeMinutes)
    && record.expectedTimeMinutes > 0
    && typeof record.rationale === 'string'
    && typeof basis === 'object'
    && basis !== null
    && !Array.isArray(basis);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function demandSourceSpanIds(packet: Record<string, unknown>): string[] {
  const demands = Array.isArray(packet.demands) ? packet.demands : [];
  const ids = new Set<string>();
  for (const demand of demands) {
    if (typeof demand !== 'object' || demand === null || Array.isArray(demand)) continue;
    stringArray((demand as { sourceSpanIds?: unknown }).sourceSpanIds).forEach((id) => ids.add(id));
  }
  return [...ids].sort();
}

function demandFamilyCount(packet: Record<string, unknown>): number {
  const directFamilies = stringArray(packet.demandFamilies);
  if (directFamilies.length > 0) return new Set(directFamilies).size;
  const demands = Array.isArray(packet.demands) ? packet.demands : [];
  return new Set(demands.flatMap((demand) => {
    if (typeof demand !== 'object' || demand === null || Array.isArray(demand)) return [];
    const family = (demand as { family?: unknown }).family;
    return typeof family === 'string' && family.trim().length > 0 ? [family] : [];
  })).size;
}

function hasIssueContext(packet: Record<string, unknown>): boolean {
  const issue = packet.issue;
  if (typeof issue !== 'object' || issue === null || Array.isArray(issue)) return false;
  const record = issue as Record<string, unknown>;
  return Boolean(
    (typeof record.body === 'string' && record.body.trim().length > 0)
      || stringArray(record.labels).length > 0,
  );
}

function testChangeCount(packet: Record<string, unknown>): number {
  return Array.isArray(packet.testChanges) ? packet.testChanges.length : 0;
}

function buildBasis(spans: readonly SourceSpanRow[], packet: Record<string, unknown>): ChallengeReviewProfileBasis {
  const files = new Map<string, { lines: number; hunks: number }>();
  for (const span of spans) {
    const filename = span.path ?? span.id;
    const existing = files.get(filename) ?? { lines: 0, hunks: 0 };
    existing.lines += span.exact_text.split('\n').length;
    existing.hunks += 1;
    files.set(filename, existing);
  }
  return {
    changedFileCount: files.size,
    changedLineCount: [...files.values()].reduce((sum, file) => sum + file.lines, 0),
    sourceHunkCount: [...files.values()].reduce((sum, file) => sum + file.hunks, 0),
    testChangeCount: testChangeCount(packet),
    demandFamilyCount: demandFamilyCount(packet),
    hasIssueContext: hasIssueContext(packet),
  };
}

function packetContentForHash(packet: Record<string, unknown>): Record<string, unknown> | null {
  const pullRequest = packet.pullRequest;
  if (typeof pullRequest !== 'object' || pullRequest === null || Array.isArray(pullRequest)) return null;
  const pr = pullRequest as Record<string, unknown>;
  const prNumber = typeof pr.number === 'number' ? pr.number : null;
  const baseSha = typeof pr.baseSha === 'string' ? pr.baseSha.toLowerCase() : null;
  const headSha = typeof pr.headSha === 'string' ? pr.headSha.toLowerCase() : null;
  if (prNumber === null || baseSha === null || headSha === null) return null;

  return {
    repoSnapshotId: packet.repoSnapshotId,
    prNumber,
    baseSha,
    headSha,
    policyVersion: packet.policyVersion,
    repository: packet.repository,
    pullRequest: {
      ...pr,
      baseSha,
      headSha,
    },
    languageSupport: packet.languageSupport,
    changedFilePaths: packet.changedFilePaths,
    changedSymbolIds: packet.changedSymbolIds,
    sourceSpanIds: packet.sourceSpanIds,
    testChanges: packet.testChanges,
    issue: packet.issue,
    demands: packet.demands,
    demandFamilies: packet.demandFamilies,
    quality: packet.quality,
    reviewProfile: packet.reviewProfile,
  };
}

async function repairedPacketJson(
  packet: Record<string, unknown>,
  reviewProfile: ChallengeReviewProfile,
): Promise<{ json: string; contentHash: string } | null> {
  return refreshPacketContentHash({ ...packet, reviewProfile });
}

async function refreshPacketContentHash(
  packet: Record<string, unknown>,
): Promise<{ json: string; contentHash: string } | null> {
  const content = packetContentForHash(packet);
  if (!content) return null;
  const contentHash = await hashObject(content);
  return {
    json: stableJson({
      ...packet,
      contentHash,
    }),
    contentHash,
  };
}

function existingPacketContentHash(packet: Record<string, unknown>): string | null {
  const contentHash = packet.contentHash;
  return typeof contentHash === 'string' && contentHash.trim() ? contentHash : null;
}

function updateReviewPacketRow(
  database: SqliteDatabase,
  input: {
    packetId: string;
    packetJson?: string;
    contentHash?: string | null;
    hasSourceHash: boolean;
    hasUpdatedAt: boolean;
  },
): void {
  const assignments: string[] = [];
  const values: SqlValue[] = [];
  if (input.packetJson !== undefined) {
    assignments.push('packet_json = ?');
    values.push(input.packetJson);
  }
  if (input.hasSourceHash && input.contentHash) {
    assignments.push('source_hash = ?');
    values.push(input.contentHash);
  }
  if (input.hasUpdatedAt) {
    assignments.push('updated_at = ?');
    values.push(new Date().toISOString());
  }
  if (assignments.length === 0) return;
  values.push(input.packetId);
  database.prepare(
    `UPDATE review_challenge_packets
        SET ${assignments.join(', ')}
      WHERE id = ?`,
  ).run(...values);
}

function tableColumns(database: SqliteDatabase, tableName: string): Set<string> {
  const rows = database.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name?: unknown }>;
  return new Set(rows.flatMap((row) => typeof row.name === 'string' ? [row.name] : []));
}

function loadRows(database: SqliteDatabase, options: RepairOptions): PacketRow[] {
  const clauses = ['packet_json IS NOT NULL'];
  const args: SqlValue[] = [];
  if (options.onlyProductionReady !== false) clauses.push('production_ready = 1');
  const limit = options.limit && options.limit > 0 ? Math.floor(options.limit) : null;
  if (limit !== null) args.push(limit);
  return database.prepare(
    `SELECT
       rcp.id,
       qr.full_name AS repo_full_name,
       rcp.pr_number,
       rcp.production_ready,
       rcp.source_hash,
       rcp.packet_json
     FROM review_challenge_packets rcp
     LEFT JOIN qualified_repos qr ON qr.id = rcp.repo_id
     WHERE ${clauses.join(' AND ')}
     ORDER BY COALESCE(qr.full_name, ''), rcp.pr_number, rcp.id
     ${limit === null ? '' : 'LIMIT ?'}`,
  ).all(...args) as PacketRow[];
}

function loadSourceSpans(database: SqliteDatabase, spanIds: readonly string[]): SourceSpanRow[] {
  if (spanIds.length === 0) return [];
  const placeholders = spanIds.map(() => '?').join(', ');
  return database.prepare(
    `SELECT id, path, exact_text, line_start, line_end
       FROM repo_source_spans
      WHERE id IN (${placeholders})`,
  ).all(...spanIds) as SourceSpanRow[];
}

function outcome(input: Omit<RepairOutcome, 'reviewDifficultyBand' | 'reviewExpectedSeniority' | 'reviewExpectedTimeMinutes'> & {
  profile?: ChallengeReviewProfile | null;
}): RepairOutcome {
  return {
    packetId: input.packetId,
    repoFullName: input.repoFullName,
    prNumber: input.prNumber,
    status: input.status,
    reviewDifficultyBand: input.profile?.difficultyBand ?? null,
    reviewExpectedSeniority: input.profile?.expectedSeniority ?? null,
    reviewExpectedTimeMinutes: input.profile?.expectedTimeMinutes ?? null,
    changedFileCount: input.changedFileCount,
    changedLineCount: input.changedLineCount,
    sourceHunkCount: input.sourceHunkCount,
    error: input.error,
  };
}

function increment(stats: RepairStats, status: RepairStatus): void {
  if (status === 'already_ready') stats.alreadyReady += 1;
  else if (status === 'would_update') stats.wouldUpdate += 1;
  else if (status === 'updated') stats.updated += 1;
  else if (status === 'invalid_json') stats.invalidJson += 1;
  else if (status === 'missing_source_spans') stats.missingSourceSpans += 1;
  else if (status === 'unsupported_packet') stats.unsupportedPacket += 1;
}

export async function repairReviewPacketReviewProfiles(
  database: SqliteDatabase,
  options: RepairOptions,
): Promise<RepairResult> {
  const stats = zeroStats();
  const outcomes: RepairOutcome[] = [];
  const packetColumns = tableColumns(database, 'review_challenge_packets');
  const hasUpdatedAt = packetColumns.has('updated_at');
  const hasSourceHash = packetColumns.has('source_hash');

  for (const row of loadRows(database, options)) {
    stats.scanned += 1;
    let packet: Record<string, unknown>;
    try {
      const parsed = JSON.parse(row.packet_json) as unknown;
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('packet_json is not an object');
      }
      packet = parsed as Record<string, unknown>;
    } catch (error) {
      increment(stats, 'invalid_json');
      outcomes.push(outcome({
        packetId: row.id,
        repoFullName: row.repo_full_name,
        prNumber: row.pr_number,
        status: 'invalid_json',
        changedFileCount: null,
        changedLineCount: null,
        sourceHunkCount: null,
        error: error instanceof Error ? error.message : String(error),
        profile: null,
      }));
      continue;
    }

    if (hasReadyReviewProfile(packet.reviewProfile)) {
      const basis = packet.reviewProfile.basis;
      const basisRecord = typeof basis === 'object' && basis !== null && !Array.isArray(basis)
        ? basis as Partial<ChallengeReviewProfileBasis>
        : {};
      const readyPacket = await refreshPacketContentHash(packet);
      const contentHash = readyPacket?.contentHash ?? existingPacketContentHash(packet);
      const packetHashStale = readyPacket !== null && existingPacketContentHash(packet) !== readyPacket.contentHash;
      const rowHashStale = hasSourceHash && contentHash !== null && row.source_hash !== contentHash;
      if (packetHashStale || rowHashStale) {
        if (options.write) {
          updateReviewPacketRow(database, {
            packetId: row.id,
            ...(packetHashStale && readyPacket ? { packetJson: readyPacket.json } : {}),
            contentHash,
            hasSourceHash,
            hasUpdatedAt,
          });
          increment(stats, 'updated');
          outcomes.push(outcome({
            packetId: row.id,
            repoFullName: row.repo_full_name,
            prNumber: row.pr_number,
            status: 'updated',
            changedFileCount: basisRecord.changedFileCount ?? null,
            changedLineCount: basisRecord.changedLineCount ?? null,
            sourceHunkCount: basisRecord.sourceHunkCount ?? null,
            error: null,
            profile: packet.reviewProfile,
          }));
        } else {
          increment(stats, 'would_update');
          outcomes.push(outcome({
            packetId: row.id,
            repoFullName: row.repo_full_name,
            prNumber: row.pr_number,
            status: 'would_update',
            changedFileCount: basisRecord.changedFileCount ?? null,
            changedLineCount: basisRecord.changedLineCount ?? null,
            sourceHunkCount: basisRecord.sourceHunkCount ?? null,
            error: packetHashStale ? 'packet contentHash is stale' : 'source_hash is stale',
            profile: packet.reviewProfile,
          }));
        }
        continue;
      }
      increment(stats, 'already_ready');
      outcomes.push(outcome({
        packetId: row.id,
        repoFullName: row.repo_full_name,
        prNumber: row.pr_number,
        status: 'already_ready',
        changedFileCount: basisRecord.changedFileCount ?? null,
        changedLineCount: basisRecord.changedLineCount ?? null,
        sourceHunkCount: basisRecord.sourceHunkCount ?? null,
        error: null,
        profile: packet.reviewProfile,
      }));
      continue;
    }

    const sourceSpanIds = demandSourceSpanIds(packet);
    const spans = loadSourceSpans(database, sourceSpanIds);
    if (sourceSpanIds.length === 0 || spans.length !== sourceSpanIds.length) {
      increment(stats, 'missing_source_spans');
      outcomes.push(outcome({
        packetId: row.id,
        repoFullName: row.repo_full_name,
        prNumber: row.pr_number,
        status: 'missing_source_spans',
        changedFileCount: null,
        changedLineCount: null,
        sourceHunkCount: null,
        error: `expected ${sourceSpanIds.length} source spans, found ${spans.length}`,
        profile: null,
      }));
      continue;
    }

    const basis = buildBasis(spans, packet);
    const reviewProfile = buildChallengeReviewProfileFromFacts(basis);
    const nextPacketJson = await repairedPacketJson(packet, reviewProfile);
    if (!nextPacketJson) {
      increment(stats, 'unsupported_packet');
      outcomes.push(outcome({
        packetId: row.id,
        repoFullName: row.repo_full_name,
        prNumber: row.pr_number,
        status: 'unsupported_packet',
        changedFileCount: basis.changedFileCount,
        changedLineCount: basis.changedLineCount,
        sourceHunkCount: basis.sourceHunkCount,
        error: 'packet_json is missing pullRequest.number/baseSha/headSha',
        profile: reviewProfile,
      }));
      continue;
    }

    if (options.write) {
      updateReviewPacketRow(database, {
        packetId: row.id,
        packetJson: nextPacketJson.json,
        contentHash: nextPacketJson.contentHash,
        hasSourceHash,
        hasUpdatedAt,
      });
      increment(stats, 'updated');
      outcomes.push(outcome({
        packetId: row.id,
        repoFullName: row.repo_full_name,
        prNumber: row.pr_number,
        status: 'updated',
        changedFileCount: basis.changedFileCount,
        changedLineCount: basis.changedLineCount,
        sourceHunkCount: basis.sourceHunkCount,
        error: null,
        profile: reviewProfile,
      }));
    } else {
      increment(stats, 'would_update');
      outcomes.push(outcome({
        packetId: row.id,
        repoFullName: row.repo_full_name,
        prNumber: row.pr_number,
        status: 'would_update',
        changedFileCount: basis.changedFileCount,
        changedLineCount: basis.changedLineCount,
        sourceHunkCount: basis.sourceHunkCount,
        error: null,
        profile: reviewProfile,
      }));
    }
  }

  return {
    mode: options.write ? 'write' : 'dry-run',
    databasePath: options.databasePath ?? '<memory>',
    stats,
    outcomes,
  };
}

function discoverLocalDatabase(explicitPath?: string): string {
  if (explicitPath) return resolve(apiRoot, explicitPath);
  const directory = resolve(apiRoot, '.wrangler/state/v3/d1/miniflare-D1DatabaseObject');
  const files = readdirSync(directory)
    .filter((entry) => entry.endsWith('.sqlite') && entry !== 'metadata.sqlite')
    .map((entry) => resolve(directory, entry));
  if (files.length === 0) throw new Error(`No local D1 database found under ${directory}`);
  if (files.length === 1) return files[0]!;

  const scored = files.map((path) => {
    const require = createRequire(import.meta.url);
    const { DatabaseSync } = require('node:sqlite') as {
      DatabaseSync: new (path: string) => SqliteDatabase;
    };
    const database = new DatabaseSync(path);
    try {
      const count = (tableName: string): number => {
        try {
          const row = database.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as { count?: number | bigint } | null;
          return typeof row?.count === 'bigint' ? Number(row.count) : row?.count ?? 0;
        } catch {
          return 0;
        }
      };
      return {
        path,
        score: count('review_challenge_packets') * 1_000_000 + count('repo_source_spans') * 1_000,
        size: statSync(path).size,
      };
    } finally {
      database.close?.();
    }
  });
  scored.sort((left, right) => right.score - left.score || right.size - left.size);
  return scored[0]!.path;
}

function usage(): string {
  return [
    'Usage: npx tsx scripts/backfillReviewPacketReviewProfiles.ts [options]',
    '',
    'Options:',
    '  --database-path PATH  Override local SQLite discovery',
    '  --write               Persist packet_json repairs (default is dry-run)',
    '  --limit N             Limit rows scanned',
    '  --include-ineligible  Include production_ready=0 packets',
    '  --json                Print machine-readable JSON',
    '  --help, -h            Show this help',
  ].join('\n');
}

interface CliOptions extends RepairOptions {
  json: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    write: false,
    json: false,
    onlyProductionReady: true,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === '--write') {
      options.write = true;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--include-ineligible') {
      options.onlyProductionReady = false;
    } else if (arg === '--limit' || arg.startsWith('--limit=')) {
      const inline = arg.match(/^--limit=(.+)$/)?.[1];
      const value = inline ?? argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error('--limit requires a value');
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed <= 0) throw new Error('--limit must be a positive integer');
      options.limit = parsed;
      if (!inline) index += 1;
    } else if (arg === '--database-path' || arg.startsWith('--database-path=')) {
      const inline = arg.match(/^--database-path=(.+)$/)?.[1];
      const value = inline ?? argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error('--database-path requires a value');
      options.databasePath = value;
      if (!inline) index += 1;
    } else if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function printHuman(result: RepairResult): void {
  console.log(`review packet review-profile repair (${result.mode})`);
  console.log(`  database:           ${result.databasePath}`);
  console.log(`  scanned:            ${result.stats.scanned}`);
  console.log(`  already ready:      ${result.stats.alreadyReady}`);
  console.log(`  would update:       ${result.stats.wouldUpdate}`);
  console.log(`  updated:            ${result.stats.updated}`);
  console.log(`  invalid json:       ${result.stats.invalidJson}`);
  console.log(`  missing spans:      ${result.stats.missingSourceSpans}`);
  console.log(`  unsupported packet: ${result.stats.unsupportedPacket}`);
  for (const item of result.outcomes.slice(0, 10)) {
    const profile = item.reviewDifficultyBand
      ? `${item.reviewDifficultyBand}/${item.reviewExpectedSeniority}/${item.reviewExpectedTimeMinutes}m`
      : 'no-profile';
    console.log(`  ${item.status}: ${item.repoFullName ?? 'unknown'}#${item.prNumber} ${item.packetId} ${profile}${item.error ? ` (${item.error})` : ''}`);
  }
}

function openLocalDatabase(databasePath?: string): { database: SqliteDatabase; path: string } {
  const require = createRequire(import.meta.url);
  const { DatabaseSync } = require('node:sqlite') as {
    DatabaseSync: new (path: string) => SqliteDatabase;
  };
  const path = discoverLocalDatabase(databasePath);
  return { database: new DatabaseSync(path), path };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const { database, path } = openLocalDatabase(options.databasePath);
  try {
    const result = await repairReviewPacketReviewProfiles(database, {
      ...options,
      databasePath: path,
    });
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else printHuman(result);
  } finally {
    database.close?.();
  }
}

if (process.argv[1]?.endsWith('backfillReviewPacketReviewProfiles.ts')) {
  main().catch((error) => {
    console.error('[backfillReviewPacketReviewProfiles] Fatal:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
