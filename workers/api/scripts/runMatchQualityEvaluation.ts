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
import { pathToFileURL } from 'node:url';
import type { D1Database } from '@cloudflare/workers-types';
import {
  loadCorpus as loadFrozenEvaluationCorpus,
  type EvaluationCorpus,
  type RelevanceGrade,
} from '../src/lib/challengeMatching/evaluation';
import {
  runMatchQualityEvaluation,
  type BatchEvaluationCandidate,
  type MatchQualityReasonCategory,
  type MatchQualityEvaluationThresholds,
} from '../src/lib/livingContext/batchEvaluationHarness';
import type { MatchVerdict } from '../src/lib/livingContext/matchReportPipeline';

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

interface FrozenCorpusRow {
  corpus_json: string;
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

function isMatchQualityCorpusFile(value: unknown): value is MatchQualityCorpusFile {
  return Boolean(value)
    && typeof value === 'object'
    && typeof (value as { corpusId?: unknown }).corpusId === 'string'
    && Array.isArray((value as { cases?: unknown }).cases);
}

function expectedVerdictForGrade(grade: RelevanceGrade): MatchVerdict {
  switch (grade) {
    case 'highly_relevant':
      return 'strong_match';
    case 'relevant':
      return 'likely_match';
    case 'borderline':
      return 'needs_review';
    case 'irrelevant':
    case 'forbidden':
      return 'insufficient_evidence';
  }
}

function reasonForGrade(grade: RelevanceGrade): MatchQualityReasonCategory {
  switch (grade) {
    case 'highly_relevant':
    case 'relevant':
      return 'aligned';
    case 'borderline':
      return 'negative_contrast';
    case 'irrelevant':
    case 'forbidden':
      return 'insufficient_evidence';
  }
}

export function matchQualityCasesFromEvaluationCorpus(corpus: EvaluationCorpus): MatchQualityCorpusFile {
  const cases = corpus.expertLabels.map((label): BatchEvaluationCandidate => {
    const expectedVerdict = expectedVerdictForGrade(label.relevanceGrade);
    const positive = expectedVerdict === 'strong_match' || expectedVerdict === 'likely_match';
    return {
      caseId: label.labelId,
      candidateId: label.candidateId,
      challengePacketId: label.challengeId,
      expectedVerdict,
      expectedReasonCategory: reasonForGrade(label.relevanceGrade),
      expertLabel: label.explanation ?? `${label.relevanceGrade} by ${label.labeledBy}`,
      requireCandidateEvidence: positive,
      requireRepoEvidence: true,
      requireSourceBackedPr: true,
    };
  });
  return {
    corpusId: corpus.corpusId,
    cases,
  };
}

export function parseMatchQualityCorpusJson(json: string): MatchQualityCorpusFile {
  const parsed = JSON.parse(json) as unknown;
  if (isMatchQualityCorpusFile(parsed)) return parsed;
  const evaluationCorpus = loadFrozenEvaluationCorpus(json);
  return matchQualityCasesFromEvaluationCorpus(evaluationCorpus);
}

function loadCorpusFile(path: string): MatchQualityCorpusFile {
  const parsed = JSON.parse(readFileSync(resolve(path), 'utf8')) as MatchQualityCorpusFile;
  if (isMatchQualityCorpusFile(parsed)) return parsed;
  return parseMatchQualityCorpusJson(JSON.stringify(parsed));
}

async function loadStoredCorpus(db: D1Database, corpusId: string): Promise<MatchQualityCorpusFile> {
  const row = await db.prepare(
    'SELECT corpus_json FROM evaluation_corpora WHERE corpus_id = ?1',
  ).bind(corpusId).first<FrozenCorpusRow>();
  if (!row) {
    throw new Error(`stored evaluation corpus not found: ${corpusId}`);
  }
  const corpus = parseMatchQualityCorpusJson(row.corpus_json);
  if (corpus.corpusId !== corpusId) {
    throw new Error(`stored corpus row "${corpusId}" contains corpus "${corpus.corpusId}"`);
  }
  return corpus;
}

async function main(): Promise<void> {
  const databasePath = valueFor(process.argv, '--database-path');
  const corpusFile = valueFor(process.argv, '--corpus-file');
  const corpusId = valueFor(process.argv, '--corpus-id');
  const requirePass = hasFlag(process.argv, '--require-pass');
  const json = hasFlag(process.argv, '--json');
  if (!databasePath || (!corpusFile && !corpusId)) {
    throw new Error('--database-path and either --corpus-file or --corpus-id are required');
  }
  if (corpusFile && corpusId) {
    throw new Error('pass only one of --corpus-file or --corpus-id');
  }

  const sqlite = new Database(resolve(databasePath));
  const db = new LocalD1(sqlite) as unknown as D1Database;
  try {
    const corpus = corpusFile
      ? loadCorpusFile(corpusFile)
      : await loadStoredCorpus(db, corpusId!);
    const result = await runMatchQualityEvaluation(
      db,
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

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
