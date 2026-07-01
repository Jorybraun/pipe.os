#!/usr/bin/env tsx
/**
 * Internal living-context match-quality gate.
 *
 * Usage:
 *   npx tsx scripts/runMatchQualityEvaluation.ts --database-path .wrangler/.../db.sqlite --corpus-file ./corpus.json --require-pass
 */

import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { D1Database } from '@cloudflare/workers-types';
import {
  runMatchQualityEvaluation,
  type BatchEvaluationCandidate,
  type MatchQualityEvaluationThresholds,
} from '../src/lib/livingContext/batchEvaluationHarness';

type SqlValue = string | number | null;
type BetterSqliteDb = InstanceType<typeof Database>;

interface QueryResult<T> {
  results: T[];
  success: boolean;
  meta?: { changes?: number };
}

interface StatementLike {
  bind(...values: SqlValue[]): StatementLike;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<QueryResult<T>>;
  run(): Promise<QueryResult<never>>;
}

interface MatchQualityCorpusFile {
  corpusId: string;
  cases: BatchEvaluationCandidate[];
  thresholds?: Partial<MatchQualityEvaluationThresholds>;
}

class LocalStatement implements StatementLike {
  private values: SqlValue[] = [];

  constructor(
    private readonly database: BetterSqliteDb,
    private readonly sql: string,
  ) {}

  bind(...values: SqlValue[]): StatementLike {
    this.values = values;
    return this;
  }

  private rewritten(): { sql: string; args: SqlValue[] } {
    const numbered = /\?(\d+)/g;
    if (!numbered.test(this.sql)) return { sql: this.sql, args: this.values };
    numbered.lastIndex = 0;
    const args: SqlValue[] = [];
    const sql = this.sql.replace(numbered, (_match, index: string) => {
      args.push(this.values[Number(index) - 1] ?? null);
      return '?';
    });
    return { sql, args };
  }

  async first<T>(): Promise<T | null> {
    const { sql, args } = this.rewritten();
    return (this.database.prepare(sql).get(...args) as T | undefined) ?? null;
  }

  async all<T>(): Promise<QueryResult<T>> {
    const { sql, args } = this.rewritten();
    return {
      results: this.database.prepare(sql).all(...args) as T[],
      success: true,
    };
  }

  async run(): Promise<QueryResult<never>> {
    const { sql, args } = this.rewritten();
    const result = this.database.prepare(sql).run(...args);
    return {
      results: [],
      success: true,
      meta: { changes: result.changes },
    };
  }
}

class LocalD1 {
  constructor(private readonly database: BetterSqliteDb) {}

  prepare(sql: string): StatementLike {
    return new LocalStatement(this.database, sql);
  }
}

function valueFor(argv: string[], flag: string): string | undefined {
  const inline = argv.find((arg) => arg.startsWith(`${flag}=`));
  if (inline) return inline.slice(flag.length + 1);
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}

function hasFlag(argv: string[], flag: string): boolean {
  return argv.includes(flag);
}

function loadCorpus(path: string): MatchQualityCorpusFile {
  const parsed = JSON.parse(readFileSync(resolve(path), 'utf8')) as MatchQualityCorpusFile;
  if (!parsed.corpusId || !Array.isArray(parsed.cases)) {
    throw new Error('corpus file must include { corpusId, cases }');
  }
  return parsed;
}

async function main(): Promise<void> {
  const databasePath = valueFor(process.argv, '--database-path');
  const corpusFile = valueFor(process.argv, '--corpus-file');
  const requirePass = hasFlag(process.argv, '--require-pass');
  const json = hasFlag(process.argv, '--json');
  if (!databasePath || !corpusFile) {
    throw new Error('--database-path and --corpus-file are required');
  }

  const corpus = loadCorpus(corpusFile);
  const sqlite = new Database(resolve(databasePath));
  try {
    const result = await runMatchQualityEvaluation(
      new LocalD1(sqlite) as unknown as D1Database,
      {
        corpusId: corpus.corpusId,
        cases: corpus.cases,
        thresholds: corpus.thresholds,
      },
    );

    if (json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`${result.passed ? 'PASS' : 'FAIL'} ${result.corpusId}`);
      console.log(`accuracy=${result.metrics.verdictAccuracy.toFixed(3)} usable=${result.metrics.usableChallengeRate.toFixed(3)} separation=${result.metrics.averageScoreSeparation.toFixed(3)}`);
      for (const failure of result.gateFailures) console.log(`- ${failure}`);
    }

    if (requirePass && !result.passed) process.exitCode = 1;
  } finally {
    sqlite.close();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
