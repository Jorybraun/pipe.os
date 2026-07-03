#!/usr/bin/env tsx
/**
 * Backfill deterministic review challenge packets from vetted repo sample PRs.
 *
 * Usage:
 *   npx tsx scripts/prepareReviewChallengeGraphLocalDb.ts --database-path /path/to/local-d1.sqlite
 *   npx tsx scripts/backfillReviewChallengePackets.ts --dry-run
 *   npx tsx scripts/backfillReviewChallengePackets.ts --batch-size 25
 *   npx tsx scripts/backfillReviewChallengePackets.ts --repo pipe-labs/orders
 *   npx tsx scripts/backfillReviewChallengePackets.ts --repo-id 42 --pr 123
 *   npx tsx scripts/backfillReviewChallengePackets.ts --force --repo-id 42
 *
 * Reads and writes remote D1 using the crawler's existing REST client. Existing
 * repo-challenge-v1 packets are skipped unless --force is supplied.
 */

import dotenv from 'dotenv';
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(scriptDir, '..', '.dev.vars'), quiet: true });
const apiRoot = resolve(scriptDir, '..');
const require = createRequire(import.meta.url);
const DatabaseSync = require('better-sqlite3') as new (path: string) => LocalSqliteDatabase;

import { D1Client, loadD1Config } from './crawl-repos/shared/d1Client.js';
import { fetchGitHubDiff, type DiffFile } from '../src/lib/fetchGitHubDiff';
import {
  buildChallengePacket,
  deriveRepoSemantics,
  buildRepoSnapshot,
  buildSourceArtifact,
  buildSourceArtifactVersion,
  buildSourceSpan,
  persistReviewChallengeGraph,
  getLanguageSupport,
  sha256,
  type NormalizedPullRequestFile,
  type NormalizedPullRequestInput,
  type PullRequestFileStatus,
  type RepositoryRef,
  type ChallengePacket,
  type SourceArtifact,
  type SourceArtifactKind,
  type SourceArtifactVersion,
  type SourceSpan,
  type StructuralFact,
} from '../src/lib/repoSemanticGraph';
import { analyzeSourceFile } from './repo-semantic/sourceAnalysis';
import {
  changedLineNumbers,
  changedStructuralFacts,
  changedSymbolIds,
} from './repo-semantic/changeEvidence';

const PACKET_VERSION = 'repo-challenge-v1';
const DEFAULT_BATCH_SIZE = 25;
const MAX_BATCH_SIZE = 250;
const DEFAULT_GITHUB_REQUEST_TIMEOUT_MS = 15_000;
const REQUIRED_GRAPH_TABLES = [
  'review_challenge_packets',
  'context_records',
  'context_record_source_refs',
  'context_record_concepts',
] as const;
const REQUIRED_GRAPH_MIGRATIONS = [
  '0082_living_context_graph.sql',
  '0083_repo_semantic_graph_and_match_runs.sql',
  '0095_context_records.sql',
] as const;

export interface Options {
  target: 'local' | 'remote';
  databasePath?: string;
  dryRun: boolean;
  force: boolean;
  preflightGithub: boolean;
  json?: boolean;
  batchSize: number;
  repoId?: number;
  repo?: string;
  prNumber?: number;
}

export interface QueryClient {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: Array<string | number | null>,
  ): Promise<T[]>;
}

interface LocalSqliteStatement {
  all(...values: Array<string | number | null>): unknown[];
  run(...values: Array<string | number | null>): unknown;
}

interface LocalSqliteDatabase {
  prepare(sql: string): LocalSqliteStatement;
  exec(sql: string): void;
  close(): void;
}

function rewriteNumberedParams(
  sql: string,
  params: Array<string | number | null>,
): { sql: string; args: Array<string | number | null> } {
  const numbered = /\?(\d+)/g;
  let match = numbered.exec(sql);
  if (!match) return { sql, args: params };

  const args: Array<string | number | null> = [];
  let rewritten = '';
  let lastIndex = 0;

  numbered.lastIndex = 0;
  while ((match = numbered.exec(sql)) !== null) {
    rewritten += sql.slice(lastIndex, match.index) + '?';
    const paramIndex = Number.parseInt(match[1]!, 10) - 1;
    args.push(params[paramIndex] ?? null);
    lastIndex = numbered.lastIndex;
  }
  rewritten += sql.slice(lastIndex);

  return { sql: rewritten, args };
}

class LocalQueryClient implements QueryClient {
  constructor(private readonly database: LocalSqliteDatabase) {}

  async query<T>(
    sql: string,
    params: Array<string | number | null> = [],
  ): Promise<T[]> {
    const rewritten = rewriteNumberedParams(sql, params);
    const statement = this.database.prepare(rewritten.sql);
    if (/^\s*(SELECT|WITH|PRAGMA)/i.test(rewritten.sql)) {
      return statement.all(...rewritten.args) as T[];
    }
    statement.run(...rewritten.args);
    return [];
  }
}

export interface SamplePullRequestRow {
  repo_id: number;
  full_name: string;
  github_url: string;
  primary_language: string;
  pr_number: number;
  pr_url: string;
  title: string | null;
  merged_at: string;
}

export interface PullRequestRefs {
  baseSha: string;
  baseRef: string;
  headSha: string;
  mergedAt: string | null;
}

export interface NormalizedBuildResult {
  challengeInput: NormalizedPullRequestInput;
  challengeStructuralFacts: StructuralFact[];
  structuralFacts: StructuralFact[];
}

interface ExtractionDiagnostic {
  kind: 'full_source_fetch' | 'semantic_parser';
  path: string;
  language: string;
  reason: string;
}

interface NormalizedChangedFileResult {
  challengeFile: NormalizedPullRequestFile;
  sourceArtifacts: SourceArtifact[];
  sourceArtifactVersions: SourceArtifactVersion[];
  sourceSpans: SourceSpan[];
  structuralFacts: StructuralFact[];
  challengeStructuralFacts: StructuralFact[];
  extractionDiagnostics: ExtractionDiagnostic[];
}

export interface Stats {
  selected: number;
  built: number;
  persisted: number;
  dryRun: number;
  ineligible: number;
  skippedExisting: number;
  skippedFetch: number;
  skippedNoHunks: number;
  errors: number;
}

export type BackfillOutcomeStatus =
  | 'dry_run_ready'
  | 'persisted'
  | 'skipped_fetch'
  | 'skipped_no_hunks'
  | 'error';

export interface BackfillRowOutcome {
  repoId: number;
  repoFullName: string;
  repoUrl: string;
  prNumber: number;
  prUrl: string;
  title: string | null;
  status: BackfillOutcomeStatus;
  packetId: string | null;
  repoSnapshotId: string | null;
  packetContentHash: string | null;
  eligible: boolean | null;
  qualityScore: number | null;
  productionReady: boolean | null;
  demandCount: number | null;
  sourceSpanCount: number | null;
  changedFileCount: number | null;
  structuralFactCount: number | null;
  contextRecordId: string | null;
  repoSourceRefCount: number | null;
  conceptLinkCount: number | null;
  persistedContextReady: boolean | null;
  error: string | null;
}

interface PersistedPacketCoverage {
  productionReady: boolean | null;
  contextRecordId: string | null;
  repoSourceRefCount: number | null;
  conceptLinkCount: number | null;
  persistedContextReady: boolean | null;
}

export interface BackfillRunResult {
  stats: Stats;
  outcomes: BackfillRowOutcome[];
}

export interface BackfillCliReport {
  status: 'completed' | 'failed';
  mode: 'dry-run' | 'write';
  target: 'local' | 'remote';
  filters: {
    repoId: number | null;
    repo: string | null;
    prNumber: number | null;
    force: boolean;
  };
  batchSize: number;
  stats: Stats;
  outcomes: BackfillRowOutcome[];
}

export interface BackfillReviewChallengePacketsInput {
  client: QueryClient;
  db?: D1Database;
  options: Options;
  token?: string;
  log?: Pick<Console, 'log' | 'warn' | 'error'>;
  fetchDiff?: typeof fetchGitHubDiff;
  fetchRefs?: typeof fetchPullRequestRefs;
}

function usage(): string {
  return [
    'Usage: npx tsx scripts/backfillReviewChallengePackets.ts [options]',
    '',
    'Options:',
    '  --preflight-github   Check GitHub API connectivity and exit',
    '  --local               Read and write the local Wrangler D1 database (default)',
    '  --remote              Read and write Cloudflare D1',
    '  --database-path PATH  Override local SQLite discovery',
    '  --dry-run             Fetch and build packets without writing',
    `  --batch-size N        Process at most N rows (default ${DEFAULT_BATCH_SIZE}, max ${MAX_BATCH_SIZE})`,
    '  --repo-id N           Restrict to one qualified_repos.id',
    '  --repo OWNER/NAME     Restrict to one qualified_repos.full_name',
    '  --pr N                Restrict to one pull request number',
    '  --force               Rebuild rows that already have a v1 packet',
    '  --json                Print machine-readable JSON to stdout',
    '  --help, -h            Show this help',
    '',
    'Environment:',
    '  D1_REQUEST_TIMEOUT_MS  Per-statement D1 REST timeout for remote writes; large source-backed packets may need 60000+',
  ].join('\n');
}

function readValue(argv: string[], index: number, flag: string): [string, number] {
  const inline = argv[index]?.match(new RegExp(`^${flag}=(.+)$`))?.[1];
  if (inline !== undefined) return [inline, index];
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return [value, index + 1];
}

function positiveInteger(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    target: 'local',
    dryRun: false,
    force: false,
    preflightGithub: false,
    batchSize: DEFAULT_BATCH_SIZE,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--preflight-github') {
      options.preflightGithub = true;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--local') {
      options.target = 'local';
    } else if (arg === '--remote') {
      options.target = 'remote';
    } else if (arg === '--database-path' || arg.startsWith('--database-path=')) {
      const [value, consumedIndex] = readValue(argv, index, '--database-path');
      options.databasePath = value;
      index = consumedIndex;
    } else if (arg === '--force') {
      options.force = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    } else if (arg === '--batch-size' || arg.startsWith('--batch-size=')) {
      const [value, consumedIndex] = readValue(argv, index, '--batch-size');
      options.batchSize = positiveInteger(value, '--batch-size');
      index = consumedIndex;
    } else if (arg === '--repo-id' || arg.startsWith('--repo-id=')) {
      const [value, consumedIndex] = readValue(argv, index, '--repo-id');
      options.repoId = positiveInteger(value, '--repo-id');
      index = consumedIndex;
    } else if (arg === '--repo' || arg.startsWith('--repo=')) {
      const [value, consumedIndex] = readValue(argv, index, '--repo');
      options.repo = value.trim();
      index = consumedIndex;
    } else if (arg === '--pr' || arg.startsWith('--pr=')) {
      const [value, consumedIndex] = readValue(argv, index, '--pr');
      options.prNumber = positiveInteger(value, '--pr');
      index = consumedIndex;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (options.batchSize > MAX_BATCH_SIZE) {
    throw new Error(`--batch-size cannot exceed ${MAX_BATCH_SIZE}`);
  }
  if (options.repo !== undefined && !/^[^/\s]+\/[^/\s]+$/.test(options.repo)) {
    throw new Error('--repo must use OWNER/NAME format');
  }
  if (options.target === 'remote' && options.databasePath) {
    throw new Error('--database-path can only be used with --local');
  }
  return options;
}

async function selectSamplePullRequests(
  db: QueryClient,
  options: Options,
  packetTableExists: boolean,
): Promise<SamplePullRequestRow[]> {
  const clauses = [
    'rsp.swe_bench_eligible = 1',
    'qr.disqualified = 0',
    "COALESCE(qr.test_framework, '') <> 'source-backed-fixture'",
  ];
  const params: Array<string | number | null> = packetTableExists ? [PACKET_VERSION] : [];

  if (options.repoId !== undefined) {
    clauses.push('qr.id = ?');
    params.push(options.repoId);
  }
  if (options.repo !== undefined) {
    clauses.push('qr.full_name = ?');
    params.push(options.repo);
  }
  if (options.prNumber !== undefined) {
    clauses.push('rsp.pr_number = ?');
    params.push(options.prNumber);
  }
  params.push(options.batchSize);

  return db.query<SamplePullRequestRow>(
    `SELECT
       qr.id AS repo_id,
       qr.full_name,
       qr.github_url,
       qr.primary_language,
       rsp.pr_number,
       rsp.pr_url,
       rsp.title,
       rsp.merged_at
     FROM repo_sample_prs rsp
     JOIN qualified_repos qr ON qr.id = rsp.repo_id
     ${packetTableExists
       ? `LEFT JOIN review_challenge_packets rcp
            ON rcp.repo_id = rsp.repo_id
           AND rcp.pr_number = rsp.pr_number
           AND rcp.packet_version = ?`
       : ''}
     WHERE ${clauses.join(' AND ')}
     GROUP BY qr.id, rsp.pr_number
     ${packetTableExists && !options.force ? 'HAVING COUNT(rcp.id) = 0' : ''}
     ORDER BY qr.id, rsp.pr_number
     LIMIT ?`,
    params,
  );
}

async function tableExists(db: QueryClient, tableName: string): Promise<boolean> {
  const rows = await db.query<{ count: number }>(
    `SELECT COUNT(*) AS count
     FROM sqlite_master
     WHERE type = 'table' AND name = ?`,
    [tableName],
  );
  return Number(rows[0]?.count ?? 0) > 0;
}

async function missingReviewChallengeGraphTables(db: QueryClient): Promise<string[]> {
  const tableChecks = await Promise.all(
    REQUIRED_GRAPH_TABLES.map(async (tableName) => ({
      tableName,
      present: await tableExists(db, tableName),
    })),
  );
  return tableChecks
    .filter((table) => !table.present)
    .map((table) => table.tableName);
}

async function countExistingPackets(db: QueryClient, options: Options): Promise<number> {
  const clauses = [
    'rsp.swe_bench_eligible = 1',
    'qr.disqualified = 0',
    'rcp.packet_version = ?',
    "COALESCE(qr.test_framework, '') <> 'source-backed-fixture'",
  ];
  const params: Array<string | number | null> = [PACKET_VERSION];
  if (options.repoId !== undefined) {
    clauses.push('qr.id = ?');
    params.push(options.repoId);
  }
  if (options.repo !== undefined) {
    clauses.push('qr.full_name = ?');
    params.push(options.repo);
  }
  if (options.prNumber !== undefined) {
    clauses.push('rsp.pr_number = ?');
    params.push(options.prNumber);
  }

  const rows = await db.query<{ count: number }>(
    `SELECT COUNT(DISTINCT CAST(rsp.repo_id AS TEXT) || ':' || CAST(rsp.pr_number AS TEXT)) AS count
     FROM repo_sample_prs rsp
     JOIN qualified_repos qr ON qr.id = rsp.repo_id
     JOIN review_challenge_packets rcp
       ON rcp.repo_id = rsp.repo_id
      AND rcp.pr_number = rsp.pr_number
     WHERE ${clauses.join(' AND ')}`,
    params,
  );
  return Number(rows[0]?.count ?? 0);
}

function repositoryRef(row: SamplePullRequestRow): RepositoryRef {
  const [owner, name] = row.full_name.split('/');
  if (!owner || !name) throw new Error(`Invalid repository full_name: ${row.full_name}`);
  return {
    provider: 'github',
    owner,
    name,
    canonicalUrl: row.github_url,
  };
}

function githubHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'pipe-api/1.0',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function githubRequestTimeoutMs(): number {
  const value = Number(process.env['GITHUB_REQUEST_TIMEOUT_MS'] ?? DEFAULT_GITHUB_REQUEST_TIMEOUT_MS);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_GITHUB_REQUEST_TIMEOUT_MS;
  return Math.round(value);
}

async function timedGitHubFetch(
  input: string,
  init: RequestInit,
): Promise<Response | null> {
  try {
    return await fetch(input, {
      ...init,
      signal: AbortSignal.timeout(githubRequestTimeoutMs()),
    });
  } catch {
    return null;
  }
}

async function fetchGitHubFileContent(input: {
  fullName: string;
  path: string;
  ref: string;
  token?: string;
}): Promise<string | null> {
  const encodedPath = input.path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  const response = await timedGitHubFetch(
    `https://api.github.com/repos/${input.fullName}/contents/${encodedPath}?ref=${encodeURIComponent(input.ref)}`,
    {
      headers: {
        ...githubHeaders(input.token),
        Accept: 'application/vnd.github.raw+json',
      },
    },
  );
  if (!response?.ok) return null;
  const content = await response.text();
  return content.length > 0 ? content : null;
}

async function fetchPullRequestRefs(
  row: SamplePullRequestRow,
  token?: string,
): Promise<PullRequestRefs | null> {
  const response = await timedGitHubFetch(
    `https://api.github.com/repos/${row.full_name}/pulls/${row.pr_number}`,
    { headers: githubHeaders(token) },
  );
  if (!response?.ok) return null;
  const body = await response.json() as {
    base?: { sha?: string; ref?: string };
    head?: { sha?: string };
    merged_at?: string | null;
  };
  if (!body.base?.sha || !body.base.ref || !body.head?.sha) return null;
  return {
    baseSha: body.base.sha,
    baseRef: body.base.ref,
    headSha: body.head.sha,
    mergedAt: body.merged_at ?? null,
  };
}

function normalizeStatus(status: string): PullRequestFileStatus {
  if (status === 'added') return 'added';
  if (status === 'removed') return 'deleted';
  if (status === 'renamed') return 'renamed';
  return 'modified';
}

function languageForPath(path: string, fallback: string): string {
  const extension = path.toLowerCase().match(/\.([^.\/]+)$/)?.[1];
  const languages: Record<string, string> = {
    cjs: 'javascript',
    go: 'go',
    js: 'javascript',
    jsx: 'javascript',
    mjs: 'javascript',
    py: 'python',
    ts: 'typescript',
    tsx: 'typescript',
  };
  return extension ? languages[extension] ?? fallback.toLowerCase() : fallback.toLowerCase();
}

function artifactKind(path: string): SourceArtifactKind {
  const normalized = path.toLowerCase();
  if (/(^|\/)(__tests__|tests?|specs?)(\/|$)|\.(test|spec)\.[^.]+$/.test(normalized)) return 'test';
  if (/(^|\/)(package(-lock)?\.json|pyproject\.toml|go\.mod|requirements.*\.txt)$/.test(normalized)) return 'manifest';
  if (/(^|\/)(readme|docs?)(\/|\.|$)/.test(normalized)) return 'documentation';
  if (/(^|\/)(\.github\/workflows|\.gitlab-ci|ci)(\/|\.|$)/.test(normalized)) return 'ci';
  return 'source';
}

function patchText(file: DiffFile, hunkIndex: number): string {
  const hunk = file.hunks[hunkIndex]!;
  const body = hunk.lines.map((line) => {
    const prefix = line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ';
    return `${prefix}${line.content}`;
  });
  return [hunk.header, ...body].join('\n');
}

async function normalizeChangedFile(input: {
  row: SamplePullRequestRow;
  refs: PullRequestRefs;
  token?: string;
  snapshotId: string;
  observedAt: string;
  file: DiffFile;
}): Promise<NormalizedChangedFileResult> {
  const { row, refs, token, snapshotId, observedAt, file } = input;
  const language = languageForPath(file.filename, row.primary_language);
  const hunks = file.hunks.map((_, index) => patchText(file, index));
  const content = hunks.join('\n');
  const artifact = await buildSourceArtifact({
    repoSnapshotId: snapshotId,
    kind: artifactKind(file.filename),
    path: file.filename,
    externalRef: `${row.pr_url}/files#diff-${await sha256(file.filename)}`,
    language,
    mediaType: 'text/x-diff',
  });
  const artifactVersion = await buildSourceArtifactVersion({
    artifactId: artifact.id,
    repoSnapshotId: snapshotId,
    content,
    createdAt: observedAt,
  });

  let byteOffset = 0;
  let line = 1;
  const normalizedHunks: NormalizedPullRequestFile['hunks'] = [];
  for (let index = 0; index < hunks.length; index++) {
    const patch = hunks[index]!;
    const encodedLength = new TextEncoder().encode(patch).byteLength;
    const lineCount = patch.split('\n').length;
    const sourceSpan = await buildSourceSpan({
      repoSnapshotId: snapshotId,
      artifactId: artifact.id,
      artifactVersionId: artifactVersion.id,
      contentHash: artifactVersion.contentHash,
      start: { byteOffset, line, column: 1 },
      end: { byteOffset: byteOffset + encodedLength, line: line + lineCount - 1, column: 1 },
      exactText: patch,
      displayLabel: `${file.filename}:${file.hunks[index]!.header}`,
      prSide: 'head',
    });
    normalizedHunks.push({
      header: file.hunks[index]!.header,
      patch,
      sourceSpan,
      changedSymbolIds: [],
    });
    byteOffset += encodedLength + (index < hunks.length - 1 ? 1 : 0);
    line += lineCount;
  }

  const challengeFile: NormalizedPullRequestFile = {
    path: file.filename,
    status: normalizeStatus(file.status),
    language,
    additions: file.additions,
    deletions: file.deletions,
    artifact,
    artifactVersion,
    hunks: normalizedHunks,
    symbols: [],
  };
  const sourceSpans = normalizedHunks.map((hunk) => hunk.sourceSpan);
  const sourceArtifacts: SourceArtifact[] = [artifact];
  const sourceArtifactVersions: SourceArtifactVersion[] = [artifactVersion];
  let structuralFacts: StructuralFact[] = [];
  let challengeStructuralFacts: StructuralFact[] = [];
  const extractionDiagnostics: ExtractionDiagnostic[] = [];

  const sourcePath = file.status === 'renamed'
    ? file.filename
    : file.filename;
  const sourceRef = file.status === 'removed' ? refs.baseSha : refs.headSha;
  const sourceContent = await fetchGitHubFileContent({
    fullName: row.full_name,
    path: sourcePath,
    ref: sourceRef,
    token,
  });
  if (sourceContent) {
    const sourceArtifact = await buildSourceArtifact({
      repoSnapshotId: snapshotId,
      kind: artifactKind(sourcePath),
      path: sourcePath,
      externalRef: `https://github.com/${row.full_name}/blob/${sourceRef}/${sourcePath}`,
      language,
      mediaType: 'text/plain',
    });
    const sourceVersion = await buildSourceArtifactVersion({
      artifactId: sourceArtifact.id,
      repoSnapshotId: snapshotId,
      content: sourceContent,
      createdAt: observedAt,
    });
    try {
      const analysis = await analyzeSourceFile({
        repoSnapshotId: snapshotId,
        path: sourcePath,
        language,
        content: sourceContent,
        artifact: sourceArtifact,
        artifactVersion: sourceVersion,
        prSide: file.status === 'removed' ? 'base' : 'head',
      });
      challengeFile.symbols = analysis.symbols;
      sourceSpans.push(...analysis.sourceSpans);
      sourceArtifacts.push(sourceArtifact);
      sourceArtifactVersions.push(sourceVersion);
      structuralFacts = analysis.structuralFacts;

      const side = file.status === 'removed' ? 'base' : 'head';
      const changedLines = new Set<number>();
      for (let index = 0; index < challengeFile.hunks.length; index++) {
        const hunkLines = changedLineNumbers(file.hunks[index]!, side);
        hunkLines.forEach((lineNumber) => changedLines.add(lineNumber));
        challengeFile.hunks[index]!.changedSymbolIds = changedSymbolIds({
          symbols: analysis.symbols,
          spans: analysis.sourceSpans,
          lineNumbers: hunkLines,
        });
      }
      challengeStructuralFacts = changedStructuralFacts({
        facts: analysis.structuralFacts,
        spans: analysis.sourceSpans,
        lineNumbers: [...changedLines],
      });
    } catch (error) {
      extractionDiagnostics.push({
        kind: 'semantic_parser',
        path: sourcePath,
        language,
        reason: error instanceof Error ? error.message : String(error),
      });
      console.warn(
        `[challenge-backfill] structural parser failed for ${row.full_name}:${sourcePath}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  } else if (getLanguageSupport(language).level === 'production' && artifact.kind !== 'documentation') {
    extractionDiagnostics.push({
      kind: 'full_source_fetch',
      path: sourcePath,
      language,
      reason: `could not fetch ${sourceRef}:${sourcePath}`,
    });
  }

  return {
    challengeFile,
    sourceArtifacts,
    sourceArtifactVersions,
    sourceSpans,
    structuralFacts,
    challengeStructuralFacts,
    extractionDiagnostics,
  };
}

function inferTestFramework(path: string): string | undefined {
  const normalized = path.toLowerCase();
  if (normalized.endsWith('_test.go')) return 'go test';
  if (normalized.endsWith('.py')) return 'pytest';
  if (/\.(test|spec)\.[jt]sx?$/.test(normalized)) return 'javascript test runner';
  return undefined;
}

export async function buildNormalizedInput(
  row: SamplePullRequestRow,
  refs: PullRequestRefs,
  diffResult: NonNullable<Awaited<ReturnType<typeof fetchGitHubDiff>>>,
  token?: string,
): Promise<NormalizedBuildResult> {
  const observedAt = refs.mergedAt ?? row.merged_at;
  const snapshot = await buildRepoSnapshot({
    repository: repositoryRef(row),
    commitSha: refs.headSha,
    defaultBranch: refs.baseRef,
    observedAt,
    parentCommitShas: [refs.baseSha],
  });
  const normalizedFiles = await Promise.all(diffResult.diff.files.map((file) =>
    normalizeChangedFile({
      row,
      refs,
      token,
      snapshotId: snapshot.id,
      observedAt,
      file,
    })
  ));
  const changedFiles = normalizedFiles.map((file) => file.challengeFile);
  const structuralFacts = normalizedFiles.flatMap((file) => file.structuralFacts);
  const challengeStructuralFacts = normalizedFiles.flatMap(
    (file) => file.challengeStructuralFacts,
  );
  const extractionDiagnostics = normalizedFiles.flatMap((file) => file.extractionDiagnostics);
  const metadataContent = JSON.stringify({
    author: diffResult.metadata.author,
    baseSha: refs.baseSha,
    body: diffResult.metadata.description,
    headSha: refs.headSha,
    mergedAt: refs.mergedAt ?? row.merged_at,
    number: row.pr_number,
    repository: row.full_name,
    title: diffResult.metadata.title || row.title || `Pull request #${row.pr_number}`,
    url: row.pr_url,
  }, null, 2);
  const metadataArtifact = await buildSourceArtifact({
    repoSnapshotId: snapshot.id,
    kind: 'pull_request',
    path: `.pipe/pull-requests/${row.pr_number}.json`,
    externalRef: row.pr_url,
    language: 'json',
    mediaType: 'application/json',
  });
  const metadataVersion = await buildSourceArtifactVersion({
    artifactId: metadataArtifact.id,
    repoSnapshotId: snapshot.id,
    content: metadataContent,
    createdAt: observedAt,
  });
  const metadataSpan = await buildSourceSpan({
    repoSnapshotId: snapshot.id,
    artifactId: metadataArtifact.id,
    artifactVersionId: metadataVersion.id,
    contentHash: metadataVersion.contentHash,
    start: { byteOffset: 0, line: 1, column: 1 },
    end: {
      byteOffset: new TextEncoder().encode(metadataContent).byteLength,
      line: metadataContent.split('\n').length,
      column: 1,
    },
    exactText: metadataContent,
    displayLabel: `${row.full_name}#${row.pr_number} metadata`,
    prSide: 'metadata',
  });
  const sourceSpans = [
    metadataSpan,
    ...normalizedFiles.flatMap((file) => file.sourceSpans),
  ];
  const sourceArtifacts = [
    metadataArtifact,
    ...normalizedFiles.flatMap((file) => file.sourceArtifacts),
  ];
  const sourceArtifactVersions = [
    metadataVersion,
    ...normalizedFiles.flatMap((file) => file.sourceArtifactVersions),
  ];
  const tests = changedFiles
    .filter((file) => file.artifact.kind === 'test')
    .filter((file) => file.hunks.length > 0)
    .map((file) => ({
      path: file.path,
      framework: inferTestFramework(file.path),
      sourceSpanIds: file.hunks.map((hunk) => hunk.sourceSpan.id),
      relatedSymbolIds: [...new Set(file.hunks.flatMap((hunk) => hunk.changedSymbolIds))].sort(),
    }));

  const challengeInput: NormalizedPullRequestInput & {
    extractionDiagnostics?: ExtractionDiagnostic[];
  } = {
    repoSnapshot: snapshot,
    number: row.pr_number,
    url: row.pr_url,
    title: diffResult.metadata.title || row.title || `Pull request #${row.pr_number}`,
    body: diffResult.metadata.description || undefined,
    author: diffResult.metadata.author,
    primaryLanguage: row.primary_language,
    baseSha: refs.baseSha,
    headSha: refs.headSha,
    mergedAt: refs.mergedAt ?? row.merged_at,
    metadataSourceSpanIds: [metadataSpan.id],
    sourceArtifacts,
    sourceArtifactVersions,
    sourceSpans,
    changedFiles,
    tests,
    structuralFacts: challengeStructuralFacts,
    ...(extractionDiagnostics.length > 0 ? { extractionDiagnostics } : {}),
  };
  return {
    challengeInput,
    challengeStructuralFacts,
    structuralFacts,
  };
}

export function d1DatabaseAdapter(
  client: QueryClient,
  log: Pick<Console, 'log'> | null = null,
): D1Database {
  return {
    prepare(sql: string) {
      let params: Array<string | number | null> = [];
      const statement = {
        bind(...values: unknown[]) {
          params = values as Array<string | number | null>;
          return statement;
        },
        async run() {
          await client.query(sql, params);
          return { success: true, meta: {} };
        },
        async first<T>() {
          const rows = await client.query<T>(sql, params);
          return rows[0] ?? null;
        },
        async all<T>() {
          const rows = await client.query<T>(sql, params);
          return { success: true, results: rows, meta: {} };
        },
        __runBatch() {
          return client.query(sql, params);
        },
      };
      return statement;
    },
    async batch(statements: D1PreparedStatement[]) {
      if (statements.length > 0) {
        log?.log(`[challenge-backfill] executing D1 write batch size=${statements.length}`);
      }
      for (const statement of statements) {
        const adapted = statement as D1PreparedStatement & {
          __runBatch?: () => Promise<unknown>;
        };
        if (adapted.__runBatch) {
          await adapted.__runBatch();
        } else {
          await statement.run();
        }
      }
      return statements.map(() => ({ success: true, meta: {}, results: [] }));
    },
  } as unknown as D1Database;
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

function printSummary(stats: Stats, options: Options): void {
  console.log('\nReview challenge packet backfill summary');
  console.log(`  mode:             ${options.dryRun ? 'dry-run' : 'write'}`);
  console.log(`  selected:         ${stats.selected}`);
  console.log(`  built:            ${stats.built}`);
  console.log(`  persisted:        ${stats.persisted}`);
  console.log(`  dry-run ready:    ${stats.dryRun}`);
  console.log(`  ineligible:       ${stats.ineligible}`);
  console.log(`  skipped existing: ${stats.skippedExisting}`);
  console.log(`  skipped fetch:    ${stats.skippedFetch}`);
  console.log(`  skipped no hunks: ${stats.skippedNoHunks}`);
  console.log(`  errors:           ${stats.errors}`);
}

export function buildBackfillCliReport(result: BackfillRunResult, options: Options): BackfillCliReport {
  return {
    status: result.stats.errors > 0 ? 'failed' : 'completed',
    mode: options.dryRun ? 'dry-run' : 'write',
    target: options.target,
    filters: {
      repoId: options.repoId ?? null,
      repo: options.repo ?? null,
      prNumber: options.prNumber ?? null,
      force: options.force,
    },
    batchSize: options.batchSize,
    stats: result.stats,
    outcomes: result.outcomes,
  };
}

function buildBackfillRowOutcome(
  row: SamplePullRequestRow,
  status: BackfillOutcomeStatus,
  values: Partial<Omit<BackfillRowOutcome,
    | 'repoId'
    | 'repoFullName'
    | 'repoUrl'
    | 'prNumber'
    | 'prUrl'
    | 'title'
    | 'status'
  >> = {},
): BackfillRowOutcome {
  return {
    repoId: row.repo_id,
    repoFullName: row.full_name,
    repoUrl: row.github_url,
    prNumber: row.pr_number,
    prUrl: row.pr_url,
    title: row.title,
    status,
    packetId: values.packetId ?? null,
    repoSnapshotId: values.repoSnapshotId ?? null,
    packetContentHash: values.packetContentHash ?? null,
    eligible: values.eligible ?? null,
    qualityScore: values.qualityScore ?? null,
    productionReady: values.productionReady ?? null,
    demandCount: values.demandCount ?? null,
    sourceSpanCount: values.sourceSpanCount ?? null,
    changedFileCount: values.changedFileCount ?? null,
    structuralFactCount: values.structuralFactCount ?? null,
    contextRecordId: values.contextRecordId ?? null,
    repoSourceRefCount: values.repoSourceRefCount ?? null,
    conceptLinkCount: values.conceptLinkCount ?? null,
    persistedContextReady: values.persistedContextReady ?? null,
    error: values.error ?? null,
  };
}

async function loadPersistedPacketCoverage(
  client: QueryClient,
  packet: ChallengePacket,
): Promise<PersistedPacketCoverage> {
  const row = (await client.query<{
    production_ready: number;
    context_record_id: string | null;
    repo_source_ref_count: number;
    concept_link_count: number;
  }>(
    `SELECT
       rcp.production_ready,
       cr.id AS context_record_id,
       COALESCE((
         SELECT COUNT(*)
           FROM context_record_source_refs
          WHERE context_record_id = cr.id
            AND source_ref_type = 'repo_source_span'
       ), 0) AS repo_source_ref_count,
       COALESCE((
         SELECT COUNT(*)
           FROM context_record_concepts
          WHERE context_record_id = cr.id
       ), 0) AS concept_link_count
     FROM review_challenge_packets rcp
     LEFT JOIN context_records cr
       ON cr.ingestion_key = 'repo-challenge-packet-context:' || rcp.id
      AND cr.scope_type = 'repo_snapshot'
      AND cr.scope_id = rcp.repo_snapshot_id
      AND cr.record_type = 'repo_challenge_packet'
     WHERE rcp.id = ?`,
    [packet.id],
  ))[0];
  if (!row) {
    return {
      productionReady: null,
      contextRecordId: null,
      repoSourceRefCount: null,
      conceptLinkCount: null,
      persistedContextReady: false,
    };
  }
  const productionReady = Number(row.production_ready) !== 0;
  const repoSourceRefCount = Number(row.repo_source_ref_count ?? 0);
  const conceptLinkCount = Number(row.concept_link_count ?? 0);
  return {
    productionReady,
    contextRecordId: row.context_record_id,
    repoSourceRefCount,
    conceptLinkCount,
    persistedContextReady: productionReady
      && row.context_record_id !== null
      && repoSourceRefCount > 0
      && conceptLinkCount > 0,
  };
}

function errorCode(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || !('code' in value)) return null;
  const code = (value as { code?: unknown }).code;
  return typeof code === 'string' && code.trim() ? code : null;
}

function formatError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = (error as { cause?: unknown }).cause;
  if (!(cause instanceof Error)) return error.message;
  const code = errorCode(cause);
  return `${error.message} (cause: ${cause.message}${code ? `; code=${code}` : ''})`;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface GitHubConnectivityResult {
  ok: boolean;
  endpoint: string;
  status: number | null;
  message: string;
  rateLimitRemaining: string | null;
}

export async function checkGitHubApiConnectivity(input: {
  token?: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
} = {}): Promise<GitHubConnectivityResult> {
  const endpoint = 'https://api.github.com/rate_limit';
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'pipe-api/1.0',
  };
  if (input.token) headers.Authorization = `Bearer ${input.token}`;
  try {
    const response = await (input.fetchImpl ?? fetch)(endpoint, {
      headers,
      signal: AbortSignal.timeout(input.timeoutMs ?? 10_000),
    });
    const rateLimitRemaining = response.headers.get('x-ratelimit-remaining');
    return {
      ok: response.ok,
      endpoint,
      status: response.status,
      message: response.ok
        ? 'GitHub API reachable'
        : `GitHub API returned ${response.status} ${response.statusText}`,
      rateLimitRemaining,
    };
  } catch (error) {
    return {
      ok: false,
      endpoint,
      status: null,
      message: formatError(error),
      rateLimitRemaining: null,
    };
  }
}

export async function backfillReviewChallengePackets(
  input: BackfillReviewChallengePacketsInput,
): Promise<BackfillRunResult> {
  const {
    client,
    options,
    token,
    log = console,
    fetchDiff = fetchGitHubDiff,
    fetchRefs = fetchPullRequestRefs,
  } = input;
  const db = input.db ?? d1DatabaseAdapter(client, log);
  const packetTableExists = await tableExists(client, 'review_challenge_packets');
  if (!options.dryRun) {
    const missingGraphTables = await missingReviewChallengeGraphTables(client);
    if (missingGraphTables.length > 0) {
      throw new Error(
        `review challenge graph tables are missing: ${missingGraphTables.join(', ')}; apply migrations ${REQUIRED_GRAPH_MIGRATIONS.join(', ')} before write mode`,
      );
    }
  }
  if (!packetTableExists) {
    log.warn(
      '[challenge-backfill] review_challenge_packets is absent; dry-run will build source packets without existing-packet checks',
    );
  }
  const [rows, existingPacketCount] = await Promise.all([
    selectSamplePullRequests(client, options, packetTableExists),
    options.force || !packetTableExists
      ? Promise.resolve(0)
      : countExistingPackets(client, options),
  ]);
  const stats: Stats = {
    selected: rows.length,
    built: 0,
    persisted: 0,
    dryRun: 0,
    ineligible: 0,
    skippedExisting: existingPacketCount,
    skippedFetch: 0,
    skippedNoHunks: 0,
    errors: 0,
  };
  const outcomes: BackfillRowOutcome[] = [];

  log.log(
    `[challenge-backfill] selected ${rows.length} row(s), mode=${options.dryRun ? 'dry-run' : 'write'}, batch=${options.batchSize}`,
  );
  if (options.target === 'remote' && !options.dryRun) {
    log.log(
      `[challenge-backfill] remote D1 request timeout=${process.env['D1_REQUEST_TIMEOUT_MS'] ?? '15000'}ms`,
    );
  }

  for (let index = 0; index < rows.length; index++) {
    const row = rows[index]!;
    const label = `${row.full_name}#${row.pr_number}`;
    try {
      log.log(`[challenge-backfill] [${index + 1}/${rows.length}] fetching ${label}`);
      const [diffResult, refs] = await Promise.all([
        fetchDiff(row.github_url, row.pr_number, token),
        fetchRefs(row, token),
      ]);
      if (!diffResult || !refs) {
        stats.skippedFetch++;
        outcomes.push(buildBackfillRowOutcome(row, 'skipped_fetch', {
          error: 'GitHub diff or pull request refs were unavailable',
        }));
        log.warn(`[challenge-backfill] [${index + 1}/${rows.length}] skip fetch ${label}`);
        continue;
      }
      log.log(
        `[challenge-backfill] [${index + 1}/${rows.length}] fetched ${label} files=${diffResult.diff.files.length}`,
      );
      if (!diffResult.diff.files.some((file) => file.hunks.length > 0)) {
        stats.skippedNoHunks++;
        outcomes.push(buildBackfillRowOutcome(row, 'skipped_no_hunks', {
          error: 'pull request diff contained no source hunks',
        }));
        log.warn(`[challenge-backfill] [${index + 1}/${rows.length}] skip no hunks ${label}`);
        continue;
      }

      const {
        challengeInput,
        challengeStructuralFacts,
        structuralFacts,
      } = await buildNormalizedInput(row, refs, diffResult, token);
      log.log(
        `[challenge-backfill] [${index + 1}/${rows.length}] normalized ${label} changedFiles=${challengeInput.changedFiles.length} sourceSpans=${challengeInput.sourceSpans.length} structuralFacts=${structuralFacts.length}`,
      );
      log.log(`[challenge-backfill] [${index + 1}/${rows.length}] building packet ${label}`);
      const packet = await buildChallengePacket(challengeInput);
      log.log(
        `[challenge-backfill] [${index + 1}/${rows.length}] built packet ${label} demands=${packet.demands.length} eligible=${packet.quality.eligible}`,
      );
      log.log(`[challenge-backfill] [${index + 1}/${rows.length}] deriving repo semantics ${label}`);
      const semantics = await deriveRepoSemantics({
        pullRequest: challengeInput,
        packet,
        structuralFacts: challengeStructuralFacts,
      });
      log.log(
        `[challenge-backfill] [${index + 1}/${rows.length}] derived repo semantics ${label} assertions=${semantics.assertions.length} signals=${semantics.signals.length}`,
      );
      stats.built++;
      if (!packet.quality.eligible) stats.ineligible++;

      if (options.dryRun) {
        stats.dryRun++;
        outcomes.push(buildBackfillRowOutcome(row, 'dry_run_ready', {
          packetId: packet.id,
          repoSnapshotId: packet.repoSnapshotId,
          packetContentHash: packet.contentHash,
          eligible: packet.quality.eligible,
          qualityScore: packet.quality.score,
          demandCount: packet.demands.length,
          sourceSpanCount: challengeInput.sourceSpans.length,
          changedFileCount: challengeInput.changedFiles.length,
          structuralFactCount: structuralFacts.length,
        }));
        log.log(
          `[challenge-backfill] [${index + 1}/${rows.length}] ready ${label} eligible=${packet.quality.eligible} quality=${packet.quality.score}`,
        );
        continue;
      }

      log.log(`[challenge-backfill] [${index + 1}/${rows.length}] persisting ${label}`);
      await persistReviewChallengeGraph(db, row.repo_id, challengeInput, packet, {
        structuralFacts,
        codeEpisodes: semantics.episodes,
        facets: semantics.facets,
        semanticAssertions: semantics.assertions,
        repoSignals: semantics.signals,
      });
      log.log(`[challenge-backfill] [${index + 1}/${rows.length}] loading persisted coverage ${label}`);
      const persistedCoverage = await loadPersistedPacketCoverage(client, packet);
      stats.persisted++;
      outcomes.push(buildBackfillRowOutcome(row, 'persisted', {
        packetId: packet.id,
        repoSnapshotId: packet.repoSnapshotId,
        packetContentHash: packet.contentHash,
        eligible: packet.quality.eligible,
        qualityScore: packet.quality.score,
        productionReady: persistedCoverage.productionReady,
        demandCount: packet.demands.length,
        sourceSpanCount: challengeInput.sourceSpans.length,
        changedFileCount: challengeInput.changedFiles.length,
        structuralFactCount: structuralFacts.length,
        contextRecordId: persistedCoverage.contextRecordId,
        repoSourceRefCount: persistedCoverage.repoSourceRefCount,
        conceptLinkCount: persistedCoverage.conceptLinkCount,
        persistedContextReady: persistedCoverage.persistedContextReady,
      }));
      log.log(
        `[challenge-backfill] [${index + 1}/${rows.length}] persisted ${label} eligible=${packet.quality.eligible} quality=${packet.quality.score}`,
      );
    } catch (error) {
      stats.errors++;
      const message = formatError(error);
      outcomes.push(buildBackfillRowOutcome(row, 'error', { error: message }));
      log.error(`[challenge-backfill] [${index + 1}/${rows.length}] error ${label}: ${message}`);
    }
  }

  return { stats, outcomes };
}

async function run(options: Options): Promise<void> {
  if (options.preflightGithub) {
    const result = await checkGitHubApiConnectivity({
      token: process.env['GITHUB_TOKEN'],
    });
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      if (!result.ok) process.exitCode = 1;
      return;
    }
    console.log(`[challenge-backfill] github preflight ${result.ok ? 'ok' : 'failed'} ${result.endpoint}`);
    console.log(`  status:          ${result.status ?? 'unreachable'}`);
    console.log(`  message:         ${result.message}`);
    console.log(`  rate remaining:  ${result.rateLimitRemaining ?? 'unknown'}`);
    if (!result.ok) process.exitCode = 1;
    return;
  }

  let localDatabase: LocalSqliteDatabase | undefined;
  const progressLog: Pick<Console, 'log' | 'warn' | 'error'> = options.json
    ? {
        log: (...args: unknown[]) => console.error(...args),
        warn: (...args: unknown[]) => console.error(...args),
        error: (...args: unknown[]) => console.error(...args),
      }
    : console;
  const client: QueryClient = options.target === 'remote'
    ? new D1Client(loadD1Config())
    : (() => {
        const path = discoverLocalDatabase(options.databasePath);
        localDatabase = new DatabaseSync(path);
        localDatabase.exec('PRAGMA foreign_keys = ON');
        progressLog.log(`[challenge-backfill] target=local database=${path}`);
        return new LocalQueryClient(localDatabase);
      })();
  let result: BackfillRunResult;
  try {
    result = await backfillReviewChallengePackets({
      client,
      db: d1DatabaseAdapter(client, progressLog),
      options,
      token: process.env['GITHUB_TOKEN'],
      log: progressLog,
    });
  } finally {
    localDatabase?.close();
  }

  if (options.json) {
    console.log(JSON.stringify(buildBackfillCliReport(result, options), null, 2));
  } else {
    printSummary(result.stats, options);
  }
  if (result.stats.errors > 0) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run(parseArgs(process.argv.slice(2))).catch((error) => {
    console.error(`[challenge-backfill] fatal: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
