#!/usr/bin/env tsx

import { createRequire } from 'node:module';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { matchCandidateToReviewChallenge } from '../src/lib/challengeMatching/d1Matcher';
import { loadRoleChallengeSemantics } from '../src/lib/challengeMatching/roleGuardrails';

interface SqliteStatement {
  get(...bindings: unknown[]): unknown;
  all(...bindings: unknown[]): unknown[];
  run(...bindings: unknown[]): { changes: number | bigint };
}

interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

interface PersistedRunRow {
  status: string;
  role_context_id: string | null;
  role_snapshot_id: string;
  model_version: string | null;
  query_json: string;
  recalled_packets_json: string;
  excluded_packets_json: string;
  ranked_results_json: string;
  selected_packet_id: string | null;
}

interface PacketSummaryRow {
  packet_id: string;
  repo_id: number;
  full_name: string;
  github_url: string;
  test_framework: string | null;
  pr_number: number;
  production_ready: number;
  repo_source_ref_count: number;
  concept_link_count: number;
}

interface RankedResultSummary {
  rank: number | null;
  recallRank: number | null;
  challengeId: string | null;
  repoId: number | null;
  repoFullName: string | null;
  prNumber: number | null;
  score: number | null;
  eligible: boolean | null;
  validatorVerdict: string | null;
  assessmentQualityVerdict: string | null;
  assessmentQualityScore: number | null;
  contrastSeparationScore: number | null;
  contrastSeparationReason: string | null;
  alignedDemandCount: number | null;
  stretchCount: number | null;
  rejectionReasons: string[];
  isFixture: boolean | null;
  productionReady: boolean | null;
  repoSourceRefCount: number | null;
  conceptLinkCount: number | null;
}

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as {
  DatabaseSync: new (path: string) => SqliteDatabase;
};

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function localDatabasePath(): string {
  const explicit = argument('--database');
  if (explicit) return resolve(explicit);
  const directory = resolve('.wrangler/state/v3/d1/miniflare-D1DatabaseObject');
  const file = readdirSync(directory).find(
    (entry) => entry.endsWith('.sqlite') && entry !== 'metadata.sqlite',
  );
  if (!file) throw new Error(`No local D1 database found under ${directory}`);
  return resolve(directory, file);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJsonArray(raw: string): unknown[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseJsonObject(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

function numberField(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function booleanField(record: Record<string, unknown>, key: string): boolean | null {
  const value = record[key];
  return typeof value === 'boolean' ? value : null;
}

function stringArrayField(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

function nestedStringField(
  record: Record<string, unknown>,
  parentKey: string,
  childKey: string,
): string | null {
  const parent = record[parentKey];
  return isRecord(parent) ? stringField(parent, childKey) : null;
}

function assessmentQualityMetric(
  record: Record<string, unknown>,
  metricId: string,
): Record<string, unknown> | null {
  const assessmentQuality = record.assessmentQuality;
  if (!isRecord(assessmentQuality)) return null;
  const metrics = assessmentQuality.metrics;
  if (!Array.isArray(metrics)) return null;
  return metrics.find((metric): metric is Record<string, unknown> =>
    isRecord(metric) && stringField(metric, 'id') === metricId
  ) ?? null;
}

function d1(sqlite: SqliteDatabase): D1Database {
  return {
    prepare(query: string) {
      let bindings: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) {
          bindings = values;
          return statement;
        },
        async run() {
          const result = sqlite.prepare(query).run(...bindings);
          return { success: true, results: [], meta: { changes: Number(result.changes) } };
        },
        async first<T>() {
          return (sqlite.prepare(query).get(...bindings) as T | undefined) ?? null;
        },
        async all<T>() {
          return {
            success: true,
            results: sqlite.prepare(query).all(...bindings) as T[],
            meta: {},
          };
        },
      };
      return statement;
    },
  } as unknown as D1Database;
}

function packetSummary(
  sqlite: SqliteDatabase,
  packetId: string | null,
): Omit<RankedResultSummary, 'rank' | 'recallRank' | 'challengeId' | 'repoId' | 'prNumber' | 'score' | 'eligible' | 'validatorVerdict' | 'assessmentQualityVerdict' | 'alignedDemandCount' | 'stretchCount' | 'rejectionReasons'> {
  if (!packetId) {
    return {
      repoFullName: null,
      isFixture: null,
      productionReady: null,
      repoSourceRefCount: null,
      conceptLinkCount: null,
    };
  }
  const row = sqlite.prepare(
    `SELECT
       rcp.id AS packet_id,
       rcp.repo_id,
       qr.full_name,
       qr.github_url,
       qr.test_framework,
       rcp.pr_number,
       rcp.production_ready,
       (
         SELECT COUNT(*)
           FROM context_records cr
           JOIN context_record_source_refs csr ON csr.context_record_id = cr.id
          WHERE cr.ingestion_key = 'repo-challenge-packet-context:' || rcp.id
            AND csr.source_ref_type = 'repo_source_span'
       ) AS repo_source_ref_count,
       (
         SELECT COUNT(*)
           FROM context_records cr
           JOIN context_record_concepts crc ON crc.context_record_id = cr.id
          WHERE cr.ingestion_key = 'repo-challenge-packet-context:' || rcp.id
       ) AS concept_link_count
     FROM review_challenge_packets rcp
     JOIN qualified_repos qr ON qr.id = rcp.repo_id
     WHERE rcp.id = ?`,
  ).get(packetId) as PacketSummaryRow | undefined;

  return {
    repoFullName: row?.full_name ?? null,
    isFixture: row ? row.test_framework === 'source-backed-fixture' : null,
    productionReady: row ? Boolean(row.production_ready) : null,
    repoSourceRefCount: row ? Number(row.repo_source_ref_count) : null,
    conceptLinkCount: row ? Number(row.concept_link_count) : null,
  };
}

function rankedResultSummary(
  sqlite: SqliteDatabase,
  entry: unknown,
): RankedResultSummary | null {
  if (!isRecord(entry)) return null;
  const challengeId = stringField(entry, 'challengeId');
  const packet = packetSummary(sqlite, challengeId);
  return {
    rank: numberField(entry, 'rank'),
    recallRank: numberField(entry, 'recallRank'),
    challengeId,
    repoId: numberField(entry, 'repoId'),
    repoFullName: packet.repoFullName,
    prNumber: numberField(entry, 'prNumber'),
    score: numberField(entry, 'score'),
    eligible: booleanField(entry, 'eligible'),
    validatorVerdict: nestedStringField(entry, 'validatorAgent', 'verdict'),
    assessmentQualityVerdict: nestedStringField(entry, 'assessmentQuality', 'verdict'),
    assessmentQualityScore: isRecord(entry.assessmentQuality)
      ? numberField(entry.assessmentQuality, 'score')
      : null,
    contrastSeparationScore: assessmentQualityMetric(entry, 'contrast_separation')
      ? numberField(assessmentQualityMetric(entry, 'contrast_separation')!, 'score')
      : null,
    contrastSeparationReason: assessmentQualityMetric(entry, 'contrast_separation')
      ? stringField(assessmentQualityMetric(entry, 'contrast_separation')!, 'reason')
      : null,
    alignedDemandCount: numberField(entry, 'alignedDemandCount'),
    stretchCount: numberField(entry, 'stretchCount'),
    rejectionReasons: stringArrayField(entry, 'rejectionReasons'),
    isFixture: packet.isFixture,
    productionReady: packet.productionReady,
    repoSourceRefCount: packet.repoSourceRefCount,
    conceptLinkCount: packet.conceptLinkCount,
  };
}

function compactSummary(
  sqlite: SqliteDatabase,
  input: {
    candidateId: string;
    roleContextId: string | null;
    committed: boolean;
    result: Awaited<ReturnType<typeof matchCandidateToReviewChallenge>>;
    run: PersistedRunRow;
  },
): unknown {
  const query = parseJsonObject(input.run.query_json);
  const roleGuardrails = isRecord(query.roleGuardrails) ? query.roleGuardrails : {};
  const ranked = parseJsonArray(input.run.ranked_results_json);
  const selected = ranked.find((entry) =>
    isRecord(entry) && stringField(entry, 'challengeId') === input.run.selected_packet_id
  ) ?? null;
  const selectedSummary = selected ? rankedResultSummary(sqlite, selected) : null;
  const topRanked = ranked
    .slice(0, 5)
    .flatMap((entry) => {
      const summary = rankedResultSummary(sqlite, entry);
      return summary ? [summary] : [];
    });

  return {
    candidateId: input.candidateId,
    roleContextId: input.roleContextId,
    committed: input.committed,
    result: {
      status: input.result.status,
      matchRunId: input.result.matchRunId,
      repoId: input.result.repoId ?? null,
      prNumber: input.result.prNumber ?? null,
    },
    run: {
      status: input.run.status,
      roleContextId: input.run.role_context_id,
      roleSnapshotId: input.run.role_snapshot_id,
      resolverVersion: input.run.model_version,
      scoringAtoms: Array.isArray(query.validationAtoms) ? query.validationAtoms.length : 0,
      relevantRoleConcepts: stringArrayField(roleGuardrails, 'relevantConcepts'),
      requiredRoleConcepts: stringArrayField(roleGuardrails, 'requiredConcepts'),
      genericConceptCount: stringArrayField(roleGuardrails, 'genericConcepts').length,
      roleSourceReferenceCount: Array.isArray(roleGuardrails.sourceReferences)
        ? roleGuardrails.sourceReferences.length
        : 0,
      recalledPacketCount: parseJsonArray(input.run.recalled_packets_json).length,
      excludedPacketCount: parseJsonArray(input.run.excluded_packets_json).length,
      evaluatedPacketCount: ranked.length,
      selectedPacketId: input.run.selected_packet_id,
    },
    selected: selectedSummary,
    topRanked,
    proof: {
      selectedRealSourceBacked: selectedSummary?.isFixture === false
        && selectedSummary.productionReady === true
        && (selectedSummary.repoSourceRefCount ?? 0) > 0
        && (selectedSummary.conceptLinkCount ?? 0) > 0,
      validatorPassed: selectedSummary?.validatorVerdict === 'PASSED',
      assessmentQualityAccepted: ['STRONG', 'USABLE'].includes(selectedSummary?.assessmentQualityVerdict ?? ''),
    },
  };
}

async function main(): Promise<void> {
  const candidateId = argument('--candidate');
  if (!candidateId) {
    throw new Error(
      'Usage: npx tsx scripts/testLocalChallengeMatch.ts --candidate <candidate-id> [--commit]',
    );
  }

  const commit = process.argv.includes('--commit');
  const sqlite = new DatabaseSync(localDatabasePath());
  sqlite.exec('BEGIN');
  let succeeded = false;
  try {
    const roleContextId = argument('--role-context');
    const database = d1(sqlite);
    let matchOptions = {};
    if (roleContextId) {
      const roleContext = sqlite.prepare(
        `SELECT id, rcd_version, rcd_json, non_negotiable_skills_json
           FROM role_contexts WHERE id = ?`,
      ).get(roleContextId) as {
        id: string;
        rcd_version: string | null;
        rcd_json: string | null;
        non_negotiable_skills_json: string | null;
      } | undefined;
      if (!roleContext) throw new Error(`Role context not found: ${roleContextId}`);
      const roleSemantics = await loadRoleChallengeSemantics(database, roleContext);
      matchOptions = {
        roleContextId,
        roleSnapshotId: roleSemantics.roleSnapshotId,
        roleConcepts: roleSemantics.relevantConcepts,
        requiredConcepts: roleSemantics.requiredConcepts,
        conceptResolverVersion: roleSemantics.resolverVersion,
        roleSourceReferences: roleSemantics.sources.map((source) => ({
          entityId: source.roleNodeId,
          locator: source.sourceSection ?? 'role_context',
          conceptKeys: source.conceptKeys,
        })),
      };
    }
    const result = await matchCandidateToReviewChallenge(database, candidateId, matchOptions);
    const run = sqlite.prepare(
      `SELECT status, role_context_id, role_snapshot_id, model_version,
              query_json, recalled_packets_json, excluded_packets_json,
              ranked_results_json, selected_packet_id
         FROM match_runs WHERE id = ?`,
    ).get(result.matchRunId);
    if (process.argv.includes('--summary') || process.argv.includes('--compact')) {
      const typedRun = run as PersistedRunRow;
      if (process.argv.includes('--compact')) {
        console.log(JSON.stringify(compactSummary(sqlite, {
          candidateId,
          roleContextId,
          committed: commit,
          result,
          run: typedRun,
        }), null, 2));
      } else {
        const query = JSON.parse(typedRun.query_json) as {
        validationAtoms: unknown[];
        roleGuardrails: {
          relevantConcepts?: string[];
          genericConcepts?: string[];
          requiredConcepts?: string[];
          sourceReferences?: unknown[];
        };
      };
        console.log(JSON.stringify({
          candidateId,
          roleContextId,
          committed: commit,
          result,
          run: {
            status: typedRun.status,
            roleContextId: typedRun.role_context_id,
            roleSnapshotId: typedRun.role_snapshot_id,
            resolverVersion: typedRun.model_version,
            scoringAtoms: query.validationAtoms.length,
            relevantRoleConcepts: query.roleGuardrails.relevantConcepts ?? [],
            requiredRoleConcepts: query.roleGuardrails.requiredConcepts ?? [],
            genericConceptCount: query.roleGuardrails.genericConcepts?.length ?? 0,
            roleSourceReferenceCount: query.roleGuardrails.sourceReferences?.length ?? 0,
            recalledPacketCount: JSON.parse(typedRun.recalled_packets_json).length,
            excludedPacketCount: JSON.parse(typedRun.excluded_packets_json).length,
            evaluatedPacketCount: JSON.parse(typedRun.ranked_results_json).length,
            selectedPacketId: typedRun.selected_packet_id,
          },
        }, null, 2));
      }
    } else {
      console.log(JSON.stringify({ candidateId, roleContextId, committed: commit, result, run }, null, 2));
    }
    succeeded = true;
  } finally {
    sqlite.exec(commit && succeeded ? 'COMMIT' : 'ROLLBACK');
    sqlite.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
