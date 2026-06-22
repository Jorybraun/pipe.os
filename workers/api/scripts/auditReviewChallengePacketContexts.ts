#!/usr/bin/env tsx
/**
 * Audit review challenge packet context-record coverage.
 *
 * This is a read-only production-readiness check for the living context graph:
 * review_challenge_packets are useful for matching only if their source-backed
 * packet also has context records, repo source refs, and open concept links.
 */

import dotenv from 'dotenv';
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { D1Client, loadD1Config } from './crawl-repos/shared/d1Client.js';

const scriptDir = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(scriptDir, '..', '.dev.vars'), quiet: true });
const apiRoot = resolve(scriptDir, '..');

export interface QueryClient {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: Array<string | number | null>,
  ): Promise<T[]>;
}

interface LocalSqliteStatement {
  all(...values: Array<string | number | null>): unknown[];
}

interface LocalSqliteDatabase {
  prepare(sql: string): LocalSqliteStatement;
  close(): void;
}

class LocalQueryClient implements QueryClient {
  constructor(private readonly database: LocalSqliteDatabase) {}

  async query<T>(
    sql: string,
    params: Array<string | number | null> = [],
  ): Promise<T[]> {
    return this.database.prepare(sql).all(...params) as T[];
  }
}

export type AuditStatus =
  | 'ready'
  | 'fixture_only'
  | 'no_packets'
  | 'no_real_overlay_ready_packets'
  | 'incomplete_context_projection';

export interface AuditOptions {
  includeFixtures?: boolean;
}

export interface PacketAuditRow {
  packetId: string;
  repoId: number;
  repoFullName: string;
  prNumber: number;
  productionReady: boolean;
  isFixture: boolean;
  contextRecordId: string | null;
  repoSourceRefCount: number;
  conceptLinkCount: number;
  overlayReady: boolean;
}

export interface AuditStats {
  totalPackets: number;
  productionReadyPackets: number;
  fixturePackets: number;
  realPackets: number;
  withContextRecords: number;
  withRepoSourceRefs: number;
  withConceptLinks: number;
  overlayReadyPackets: number;
  realOverlayReadyPackets: number;
}

export interface AuditResult {
  status: AuditStatus;
  stats: AuditStats;
  rows: PacketAuditRow[];
  missingContextRecordPacketIds: string[];
  missingRepoSourceRefPacketIds: string[];
  missingConceptLinkPacketIds: string[];
}

interface PacketRow {
  packet_id: string;
  repo_id: number;
  full_name: string;
  pr_number: number;
  production_ready: number;
  test_framework: string | null;
  context_record_id: string | null;
}

interface CoverageRow {
  repo_source_ref_count: number;
  concept_link_count: number;
}

function bool(value: number | null | undefined): boolean {
  return Number(value ?? 0) !== 0;
}

async function tableExists(client: QueryClient, tableName: string): Promise<boolean> {
  const rows = await client.query<{ count: number }>(
    `SELECT COUNT(*) AS count
       FROM sqlite_master
      WHERE type = 'table'
        AND name = ?`,
    [tableName],
  );
  return Number(rows[0]?.count ?? 0) > 0;
}

function deriveStatus(stats: AuditStats, result: {
  missingContextRecordPacketIds: string[];
  missingRepoSourceRefPacketIds: string[];
  missingConceptLinkPacketIds: string[];
}): AuditStatus {
  if (stats.totalPackets === 0) return 'no_packets';
  if (stats.realPackets === 0) return 'fixture_only';
  if (stats.realOverlayReadyPackets === 0) return 'no_real_overlay_ready_packets';
  if (
    result.missingContextRecordPacketIds.length > 0
    || result.missingRepoSourceRefPacketIds.length > 0
    || result.missingConceptLinkPacketIds.length > 0
  ) {
    return 'incomplete_context_projection';
  }
  return 'ready';
}

export async function auditReviewChallengePacketContexts(
  client: QueryClient,
  options: AuditOptions = {},
): Promise<AuditResult> {
  const requiredTables = [
    'review_challenge_packets',
    'qualified_repos',
    'context_records',
    'context_record_source_refs',
    'context_record_concepts',
  ];
  for (const tableName of requiredTables) {
    if (!await tableExists(client, tableName)) {
      throw new Error(`${tableName} does not exist; apply graph/context migrations before auditing`);
    }
  }

  const packetRows = await client.query<PacketRow>(
    `SELECT
       rcp.id AS packet_id,
       rcp.repo_id,
       qr.full_name,
       rcp.pr_number,
       rcp.production_ready,
       qr.test_framework,
       cr.id AS context_record_id
     FROM review_challenge_packets rcp
     JOIN qualified_repos qr ON qr.id = rcp.repo_id
     LEFT JOIN context_records cr
       ON cr.ingestion_key = 'repo-challenge-packet-context:' || rcp.id
      AND cr.scope_type = 'repo_snapshot'
      AND cr.scope_id = rcp.repo_snapshot_id
      AND cr.record_type = 'repo_challenge_packet'
     ORDER BY qr.full_name, rcp.pr_number, rcp.id`,
  );

  const rows: PacketAuditRow[] = [];
  for (const packet of packetRows) {
    const isFixture = (packet.test_framework ?? '') === 'source-backed-fixture';
    if (isFixture && options.includeFixtures === false) continue;
    const coverage = packet.context_record_id
      ? (await client.query<CoverageRow>(
        `SELECT
           (SELECT COUNT(*)
              FROM context_record_source_refs
             WHERE context_record_id = ?
               AND source_ref_type = 'repo_source_span') AS repo_source_ref_count,
           (SELECT COUNT(*)
              FROM context_record_concepts
             WHERE context_record_id = ?) AS concept_link_count`,
        [packet.context_record_id, packet.context_record_id],
      ))[0]
      : null;
    const repoSourceRefCount = Number(coverage?.repo_source_ref_count ?? 0);
    const conceptLinkCount = Number(coverage?.concept_link_count ?? 0);
    rows.push({
      packetId: packet.packet_id,
      repoId: packet.repo_id,
      repoFullName: packet.full_name,
      prNumber: packet.pr_number,
      productionReady: bool(packet.production_ready),
      isFixture,
      contextRecordId: packet.context_record_id,
      repoSourceRefCount,
      conceptLinkCount,
      overlayReady: bool(packet.production_ready)
        && packet.context_record_id !== null
        && repoSourceRefCount > 0
        && conceptLinkCount > 0,
    });
  }

  const stats: AuditStats = {
    totalPackets: rows.length,
    productionReadyPackets: rows.filter((row) => row.productionReady).length,
    fixturePackets: rows.filter((row) => row.isFixture).length,
    realPackets: rows.filter((row) => !row.isFixture).length,
    withContextRecords: rows.filter((row) => row.contextRecordId !== null).length,
    withRepoSourceRefs: rows.filter((row) => row.repoSourceRefCount > 0).length,
    withConceptLinks: rows.filter((row) => row.conceptLinkCount > 0).length,
    overlayReadyPackets: rows.filter((row) => row.overlayReady).length,
    realOverlayReadyPackets: rows.filter((row) => !row.isFixture && row.overlayReady).length,
  };
  const productionReadyRows = rows.filter((row) => row.productionReady);
  const missingContextRecordPacketIds = productionReadyRows
    .filter((row) => row.contextRecordId === null)
    .map((row) => row.packetId);
  const missingRepoSourceRefPacketIds = productionReadyRows
    .filter((row) => row.contextRecordId !== null && row.repoSourceRefCount === 0)
    .map((row) => row.packetId);
  const missingConceptLinkPacketIds = productionReadyRows
    .filter((row) => row.contextRecordId !== null && row.conceptLinkCount === 0)
    .map((row) => row.packetId);

  const result = {
    missingContextRecordPacketIds,
    missingRepoSourceRefPacketIds,
    missingConceptLinkPacketIds,
  };
  return {
    status: deriveStatus(stats, result),
    stats,
    rows,
    ...result,
  };
}

function discoverLocalDatabase(explicitPath?: string): string {
  if (explicitPath) return resolve(apiRoot, explicitPath);
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
}

function openLocalClient(databasePath?: string): { client: QueryClient; close: () => void; path: string } {
  const require = createRequire(import.meta.url);
  const { DatabaseSync } = require('node:sqlite') as {
    DatabaseSync: new (path: string) => LocalSqliteDatabase;
  };
  const path = discoverLocalDatabase(databasePath);
  const database = new DatabaseSync(path);
  return {
    client: new LocalQueryClient(database),
    close: () => database.close(),
    path,
  };
}

function usage(): string {
  return [
    'Usage: npx tsx scripts/auditReviewChallengePacketContexts.ts [options]',
    '',
    'Options:',
    '  --local               Audit local Wrangler D1 database (default)',
    '  --remote              Audit Cloudflare D1 via REST',
    '  --database-path PATH  Override local SQLite discovery',
    '  --json                Print machine-readable JSON',
    '  --require-real        Exit non-zero unless at least one real overlay-ready packet exists',
    '  --help, -h            Show this help',
  ].join('\n');
}

interface CliOptions {
  target: 'local' | 'remote';
  databasePath?: string;
  json: boolean;
  requireReal: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    target: 'local',
    json: false,
    requireReal: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === '--local') {
      options.target = 'local';
    } else if (arg === '--remote') {
      options.target = 'remote';
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--require-real') {
      options.requireReal = true;
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
  if (options.target === 'remote' && options.databasePath) {
    throw new Error('--database-path can only be used with --local');
  }
  return options;
}

function printHuman(result: AuditResult, source: string): void {
  console.log(`review challenge packet context audit (${source})`);
  console.log(`  status:                 ${result.status}`);
  console.log(`  total packets:          ${result.stats.totalPackets}`);
  console.log(`  production ready:       ${result.stats.productionReadyPackets}`);
  console.log(`  fixture packets:        ${result.stats.fixturePackets}`);
  console.log(`  real packets:           ${result.stats.realPackets}`);
  console.log(`  with context records:   ${result.stats.withContextRecords}`);
  console.log(`  with repo source refs:  ${result.stats.withRepoSourceRefs}`);
  console.log(`  with concept links:     ${result.stats.withConceptLinks}`);
  console.log(`  overlay-ready packets:  ${result.stats.overlayReadyPackets}`);
  console.log(`  real overlay-ready:     ${result.stats.realOverlayReadyPackets}`);
  if (result.missingContextRecordPacketIds.length > 0) {
    console.log(`  missing context:        ${result.missingContextRecordPacketIds.slice(0, 10).join(', ')}`);
  }
  if (result.missingRepoSourceRefPacketIds.length > 0) {
    console.log(`  missing repo refs:      ${result.missingRepoSourceRefPacketIds.slice(0, 10).join(', ')}`);
  }
  if (result.missingConceptLinkPacketIds.length > 0) {
    console.log(`  missing concepts:       ${result.missingConceptLinkPacketIds.slice(0, 10).join(', ')}`);
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  let close = () => {};
  let source = 'remote';
  let client: QueryClient;
  if (options.target === 'remote') {
    client = new D1Client(loadD1Config());
  } else {
    const local = openLocalClient(options.databasePath);
    client = local.client;
    close = local.close;
    source = `local:${local.path}`;
  }

  try {
    const result = await auditReviewChallengePacketContexts(client);
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      printHuman(result, source);
    }
    if (options.requireReal && result.stats.realOverlayReadyPackets === 0) {
      process.exitCode = 1;
    }
  } finally {
    close();
  }
}

if (process.argv[1]?.endsWith('auditReviewChallengePacketContexts.ts')) {
  main().catch((err) => {
    console.error('[auditReviewChallengePacketContexts] Fatal:', err);
    process.exit(1);
  });
}
