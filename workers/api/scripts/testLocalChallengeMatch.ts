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

async function main(): Promise<void> {
  const candidateId = argument('--candidate');
  if (!candidateId) {
    throw new Error('Usage: npx tsx scripts/testLocalChallengeMatch.ts --candidate <candidate-id>');
  }

  const sqlite = new DatabaseSync(localDatabasePath());
  sqlite.exec('BEGIN');
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
    if (process.argv.includes('--summary')) {
      const typedRun = run as {
        status: string;
        role_context_id: string | null;
        role_snapshot_id: string;
        model_version: string | null;
        query_json: string;
        recalled_packets_json: string;
        excluded_packets_json: string;
        ranked_results_json: string;
        selected_packet_id: string | null;
      };
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
    } else {
      console.log(JSON.stringify({ candidateId, roleContextId, result, run }, null, 2));
    }
  } finally {
    sqlite.exec('ROLLBACK');
    sqlite.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
