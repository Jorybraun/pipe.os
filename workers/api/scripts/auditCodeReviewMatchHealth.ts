#!/usr/bin/env tsx

import {
  auditCodeReviewMatchHealth,
  type CodeReviewMatchHealthAudit,
  type CodeReviewMatchHealthRow,
  type CodeReviewMatchHealthThresholds,
  type CodeReviewPacketHealthRow,
} from '../src/lib/challengeMatching/matchHealthAudit';
import { D1Client } from './crawl-repos/shared/d1Client.js';

type SqlNumber = number | string | null;

interface PacketRow {
  packetId: string;
  repoId: SqlNumber;
  repoUrl: string | null;
  prNumber: SqlNumber;
  productionReady: SqlNumber;
}

interface MatchRow {
  matchRunId: string;
  roleContextId: string | null;
  selectedPacketId: string | null;
  status: string;
  contrastScore: SqlNumber;
  recalledPacketCount: SqlNumber;
}

interface CliOptions {
  remote: boolean;
  strict: boolean;
  databaseId?: string;
  thresholds: Partial<CodeReviewMatchHealthThresholds>;
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function valueFor(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
}

function numberFor(args: string[], flag: string): number | undefined {
  const raw = valueFor(args, flag);
  if (!raw) return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${flag} must be a finite number`);
  }
  return parsed;
}

function parseOptions(args: string[]): CliOptions {
  return {
    remote: hasFlag(args, '--remote'),
    strict: hasFlag(args, '--strict'),
    databaseId: valueFor(args, '--database-id'),
    thresholds: {
      minProductionReadyPackets: numberFor(args, '--min-production-ready-packets'),
      minProductionReadyRepos: numberFor(args, '--min-production-ready-repos'),
      maxSelectedPacketShare: numberFor(args, '--max-selected-packet-share'),
      minCurrentBreadthMatchesForSkew: numberFor(args, '--min-current-breadth-matches-for-skew'),
    },
  };
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function remoteD1Client(options: CliOptions): D1Client {
  if (!options.remote) {
    throw new Error('Only --remote is currently supported for CODE_REVIEW match-health audits.');
  }
  const databaseId = options.databaseId
    ?? process.env['CLOUDFLARE_D1_DATABASE_ID']
    ?? process.env['MATCHING_EVALUATION_D1_DATABASE_ID']
    ?? '';
  if (!databaseId) {
    throw new Error('Missing required D1 database id; set CLOUDFLARE_D1_DATABASE_ID, MATCHING_EVALUATION_D1_DATABASE_ID, or pass --database-id.');
  }
  return new D1Client({
    accountId: requiredEnv('CLOUDFLARE_ACCOUNT_ID'),
    apiToken: requiredEnv('CLOUDFLARE_API_TOKEN'),
    databaseId,
  });
}

function toNumber(value: SqlNumber): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function packetFromRow(row: PacketRow): CodeReviewPacketHealthRow {
  return {
    packetId: row.packetId,
    repoId: String(row.repoId ?? ''),
    repoUrl: row.repoUrl,
    prNumber: toNumber(row.prNumber),
    productionReady: toNumber(row.productionReady) === 1,
  };
}

function matchFromRow(row: MatchRow): CodeReviewMatchHealthRow {
  const contrastScore = row.contrastScore === null ? null : toNumber(row.contrastScore);
  return {
    matchRunId: row.matchRunId,
    roleContextId: row.roleContextId,
    selectedPacketId: row.selectedPacketId,
    status: row.status,
    contrastScore,
    recalledPacketCount: row.recalledPacketCount === null ? null : toNumber(row.recalledPacketCount),
  };
}

async function loadPackets(client: D1Client): Promise<CodeReviewPacketHealthRow[]> {
  const rows = await client.query<PacketRow>(
    `SELECT rcp.id AS packetId,
            rcp.repo_id AS repoId,
            qr.github_url AS repoUrl,
            rcp.pr_number AS prNumber,
            rcp.production_ready AS productionReady
       FROM review_challenge_packets rcp
       LEFT JOIN qualified_repos qr ON qr.id = rcp.repo_id
      ORDER BY rcp.repo_id, rcp.pr_number`,
  );
  return rows.map(packetFromRow);
}

async function loadSelectedMatches(client: D1Client): Promise<CodeReviewMatchHealthRow[]> {
  const rows = await client.query<MatchRow>(
    `SELECT mr.id AS matchRunId,
            mr.role_context_id AS roleContextId,
            mr.selected_packet_id AS selectedPacketId,
            mr.status AS status,
            json_array_length(mr.recalled_packets_json) AS recalledPacketCount,
            (
              SELECT json_extract(metric.value, '$.score')
                FROM json_each(json_extract(ranked.value, '$.assessmentQuality.metrics')) AS metric
               WHERE json_extract(metric.value, '$.id') = 'contrast_separation'
               LIMIT 1
            ) AS contrastScore
       FROM match_runs mr,
            json_each(mr.ranked_results_json) AS ranked
      WHERE mr.status = 'MATCHED'
        AND mr.selected_packet_id IS NOT NULL
        AND json_extract(ranked.value, '$.challengeId') = mr.selected_packet_id
      ORDER BY mr.created_at DESC`,
  );
  return rows.map(matchFromRow);
}

function printHumanSummary(audit: CodeReviewMatchHealthAudit): void {
  const skew = audit.selectedPacketSkew;
  console.log('CODE_REVIEW match health');
  console.log(`ok: ${audit.ok}`);
  console.log(`productionReadyPackets: ${audit.productionReadyPacketCount}`);
  console.log(`productionReadyRepos: ${audit.productionReadyRepoCount}`);
  console.log(`selectedMatches: ${audit.selectedMatchCount}`);
  console.log(`currentBreadthSelectedMatches: ${audit.currentBreadthSelectedMatchCount}`);
  console.log(`staleOrNarrowSelectedMatches: ${audit.staleOrNarrowSelectedMatchCount}`);
  console.log(`roleBackedUnsafeMatches: ${audit.roleBackedUnsafeMatchCount}`);
  console.log(`topSelectedPacket: ${skew ? `${skew.packetId} (${skew.count}, ${Math.round(skew.share * 100)}%)` : 'none'}`);
  if (audit.selectedPacketDistribution.length > 0) {
    console.log('selectedPacketDistribution:');
    for (const entry of audit.selectedPacketDistribution.slice(0, 5)) {
      const repo = entry.repoUrl ?? entry.repoId ?? 'unknown repo';
      const pr = entry.prNumber === null ? 'unknown PR' : `PR ${entry.prNumber}`;
      console.log(
        `- ${entry.packetId}: ${entry.count} (${Math.round(entry.share * 100)}%) ${repo} ${pr}`,
      );
    }
  }
  console.log(`nextAction: ${audit.nextAction}`);
  for (const failure of audit.failures) {
    console.log(`FAIL: ${failure}`);
  }
  for (const warning of audit.warnings) {
    console.log(`WARN: ${warning}`);
  }
}

export async function runCodeReviewMatchHealthAudit(
  options: CliOptions,
): Promise<CodeReviewMatchHealthAudit> {
  const client = remoteD1Client(options);
  const [packets, matches] = await Promise.all([
    loadPackets(client),
    loadSelectedMatches(client),
  ]);
  return auditCodeReviewMatchHealth({
    packets,
    matches,
    thresholds: options.thresholds,
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const options = parseOptions(process.argv.slice(2));
  runCodeReviewMatchHealthAudit(options)
    .then((audit) => {
      printHumanSummary(audit);
      console.log(JSON.stringify(audit, null, 2));
      if (options.strict && !audit.ok) {
        process.exitCode = 1;
      }
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
