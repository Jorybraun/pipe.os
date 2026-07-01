#!/usr/bin/env tsx
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

interface CliOptions {
  baseUrl: string;
  samples: number;
  thresholdMs: number;
  timeoutMs: number;
  seedLocal: boolean;
  includeExternal: boolean;
  includeMutations: boolean;
  contacts: number;
  pipelines: number;
  repos: number;
  meetings: number;
}

interface RouteSpec {
  name: string;
  method: 'GET' | 'POST';
  path: string;
  body?: () => Record<string, unknown>;
  expectedStatuses: number[];
  external?: boolean;
  mutation?: boolean;
}

interface SampleResult {
  ms: number;
  status: number | 'timeout' | 'error';
  bytes: number;
  error?: string;
}

interface RouteSummary {
  name: string;
  method: string;
  path: string;
  statuses: Record<string, number>;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  maxBytes: number;
  unexpectedStatus: boolean;
  slow: boolean;
}

const DEFAULT_OPTIONS: CliOptions = {
  baseUrl: 'http://localhost:8787',
  samples: 7,
  thresholdMs: 5_000,
  timeoutMs: 20_000,
  seedLocal: false,
  includeExternal: false,
  includeMutations: false,
  contacts: 200_000,
  pipelines: 1_200,
  repos: 5_000,
  meetings: 1_200,
};

let roleCreateCounter = 0;

const ROUTES: RouteSpec[] = [
  { name: 'health', method: 'GET', path: '/health', expectedStatuses: [200] },
  { name: 'pipelines list default', method: 'GET', path: '/api/v1/pipelines', expectedStatuses: [200] },
  { name: 'pipelines list limit 100', method: 'GET', path: '/api/v1/pipelines?limit=100', expectedStatuses: [200] },
  { name: 'pipelines active search', method: 'GET', path: '/api/v1/pipelines?status=ACTIVE&q=Benchmark&limit=100', expectedStatuses: [200] },
  { name: 'contacts list default', method: 'GET', path: '/api/v1/contacts', expectedStatuses: [200] },
  { name: 'contacts list page 2', method: 'GET', path: '/api/v1/contacts?page=2&limit=100', expectedStatuses: [200] },
  { name: 'meetings list', method: 'GET', path: '/api/v1/meetings', expectedStatuses: [200] },
  { name: 'admin repos pending', method: 'GET', path: '/api/v1/admin/repos?status=pending&limit=50', expectedStatuses: [200] },
  { name: 'admin repos all 500', method: 'GET', path: '/api/v1/admin/repos?status=all&limit=500', expectedStatuses: [200] },
  { name: 'phone connection', method: 'GET', path: '/api/v1/phone/connection', expectedStatuses: [200] },
  { name: 'culture cost dashboard', method: 'GET', path: '/api/v1/screening/culture/cost-dashboard', expectedStatuses: [200] },
  { name: 'review judge examples', method: 'GET', path: '/api/v1/review-sessions/judge-examples', expectedStatuses: [200] },
  {
    name: 'talent resolve present',
    method: 'POST',
    path: '/rpc/talent/resolve-token',
    body: () => ({ inviteToken: 'bench-token-1' }),
    expectedStatuses: [200],
  },
  {
    name: 'talent resolve missing',
    method: 'POST',
    path: '/rpc/talent/resolve-token',
    body: () => ({ inviteToken: 'missing-token' }),
    expectedStatuses: [404],
  },
  {
    name: 'assessment resolve present',
    method: 'POST',
    path: '/rpc/resolve-token',
    body: () => ({ inviteToken: 'bench-token-1' }),
    expectedStatuses: [200],
  },
  { name: 'meeting room missing', method: 'GET', path: '/api/v1/meeting-rooms/missing-token', expectedStatuses: [404] },
  { name: 'rollout gate', method: 'GET', path: '/api/v1/internal/rollout-gate', expectedStatuses: [200] },
  { name: 'rollout gate gates', method: 'GET', path: '/api/v1/internal/rollout-gate/gates', expectedStatuses: [200] },
  { name: 'living context health', method: 'GET', path: '/api/v1/internal/living-context-health', expectedStatuses: [200] },
  { name: 'living context stats', method: 'GET', path: '/api/v1/internal/living-context-stats', expectedStatuses: [200] },
  {
    name: 'search repos query',
    method: 'POST',
    path: '/api/v1/search/repos',
    body: () => ({ query: 'typescript react api performance', limit: 5 }),
    expectedStatuses: [200],
  },
  {
    name: 'search roles query',
    method: 'POST',
    path: '/api/v1/search/roles',
    body: () => ({ query: 'typescript react api performance', limit: 5 }),
    expectedStatuses: [200],
  },
  { name: 'stage detail with challenges', method: 'GET', path: '/api/v1/stages/bench-stage-1', expectedStatuses: [200] },
  { name: 'challenge detail', method: 'GET', path: '/api/v1/challenges/bench-challenge-1', expectedStatuses: [200] },
  { name: 'candidate detail nested', method: 'GET', path: '/api/v1/candidates/bench-candidate-1', expectedStatuses: [200] },
  { name: 'candidate assignments empty', method: 'GET', path: '/api/v1/candidates/bench-candidate-1/assignments', expectedStatuses: [200] },
  { name: 'contact detail', method: 'GET', path: '/api/v1/contacts/bench-contact-1', expectedStatuses: [200] },
  { name: 'contact living summary', method: 'GET', path: '/api/v1/contacts/bench-contact-1/living-context/summary', expectedStatuses: [200] },
  { name: 'contact living full', method: 'GET', path: '/api/v1/contacts/bench-contact-1/living-context', expectedStatuses: [200] },
  { name: 'meeting detail', method: 'GET', path: '/api/v1/meetings/bench-meeting-1', expectedStatuses: [200] },
  { name: 'meeting interaction context', method: 'GET', path: '/api/v1/meetings/bench-meeting-1/interaction-context', expectedStatuses: [200] },
  {
    name: 'meeting transcript search',
    method: 'GET',
    path: '/api/v1/meetings/bench-meeting-1/transcript/search?q=benchmark',
    expectedStatuses: [200],
  },
  { name: 'admin repo detail', method: 'GET', path: '/api/v1/admin/repos/900000', expectedStatuses: [200] },
  { name: 'admin repo prs empty', method: 'GET', path: '/api/v1/admin/repos/900000/prs', expectedStatuses: [200] },
  { name: 'admin bulk ingest preview', method: 'GET', path: '/api/v1/admin/repos/bulk-ingest/preview', expectedStatuses: [200] },
  { name: 'review report missing', method: 'GET', path: '/api/v1/review-sessions/missing-session/report', expectedStatuses: [404] },
  { name: 'review transcript missing', method: 'GET', path: '/api/v1/review-sessions/missing-session/transcript', expectedStatuses: [404] },
  {
    name: 'repo task progress missing',
    method: 'GET',
    path: '/api/v1/assessment/repo-task/sessions/missing-session/progress',
    expectedStatuses: [404],
  },
  {
    name: 'role simple jd create',
    method: 'POST',
    path: '/api/v1/role-contexts/simple-job-description',
    body: () => ({
      title: `Benchmark JD ${roleCreateCounter++}`,
      jobDescriptionMd: 'We need TypeScript, React, and Cloudflare Workers experience for API performance work.',
      selectedTerms: ['TypeScript', 'React'],
    }),
    expectedStatuses: [201],
    mutation: true,
  },
  { name: 'role context missing', method: 'GET', path: '/api/v1/role-contexts/missing-role-context', expectedStatuses: [404] },
  { name: 'neo4j health', method: 'GET', path: '/api/v1/internal/neo4j-health', expectedStatuses: [200, 503], external: true },
  {
    name: 'dev test ai',
    method: 'POST',
    path: '/dev/test-ai',
    body: () => ({ prompt: 'Say ok.' }),
    expectedStatuses: [200],
    external: true,
  },
  { name: 'video turn credentials', method: 'GET', path: '/api/v1/video/turn-credentials', expectedStatuses: [200], external: true },
];

function parseArgs(argv: string[]): CliOptions {
  const options = { ...DEFAULT_OPTIONS };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg) continue;
    const next = argv[i + 1];
    switch (arg) {
      case '--base-url':
        if (!next) throw new Error('--base-url requires a value');
        options.baseUrl = next.replace(/\/$/, '');
        i += 1;
        break;
      case '--samples':
        if (!next) throw new Error('--samples requires a value');
        options.samples = parsePositiveInt(next, options.samples);
        i += 1;
        break;
      case '--threshold-ms':
        if (!next) throw new Error('--threshold-ms requires a value');
        options.thresholdMs = parsePositiveInt(next, options.thresholdMs);
        i += 1;
        break;
      case '--timeout-ms':
        if (!next) throw new Error('--timeout-ms requires a value');
        options.timeoutMs = parsePositiveInt(next, options.timeoutMs);
        i += 1;
        break;
      case '--contacts':
        if (!next) throw new Error('--contacts requires a value');
        options.contacts = parsePositiveInt(next, options.contacts);
        i += 1;
        break;
      case '--pipelines':
        if (!next) throw new Error('--pipelines requires a value');
        options.pipelines = parsePositiveInt(next, options.pipelines);
        i += 1;
        break;
      case '--repos':
        if (!next) throw new Error('--repos requires a value');
        options.repos = parsePositiveInt(next, options.repos);
        i += 1;
        break;
      case '--meetings':
        if (!next) throw new Error('--meetings requires a value');
        options.meetings = parsePositiveInt(next, options.meetings);
        i += 1;
        break;
      case '--seed-local':
        options.seedLocal = true;
        break;
      case '--include-external':
        options.includeExternal = true;
        break;
      case '--include-mutations':
        options.includeMutations = true;
        break;
      case '--help':
        printHelp();
        process.exit(0);
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function parsePositiveInt(raw: string, fallback: number): number {
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function printHelp(): void {
  console.log(`Usage: npm run bench:routes -- [options]

Options:
  --base-url <url>       Worker URL to benchmark (default: http://localhost:8787)
  --seed-local           Seed the local Miniflare D1 database with benchmark rows
  --include-external     Include routes that call external providers / remote bindings
  --include-mutations    Include valid mutation routes such as simple JD creation
  --samples <n>          Timed samples per route after one warmup (default: 7)
  --threshold-ms <n>     Fail when any route sample reaches this latency (default: 5000)
  --timeout-ms <n>       Per-request timeout (default: 20000)
  --contacts <n>         Contacts to seed locally (default: 200000)
  --pipelines <n>        Pipelines to seed locally (default: 1200)
  --repos <n>            Repos to seed locally (default: 5000)
  --meetings <n>         Meetings to seed locally (default: 1200)`);
}

function workerDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

function readDevBypassUserId(baseDir: string): string {
  const varsPath = path.join(baseDir, '.dev.vars');
  const raw = readFileSync(varsPath, 'utf8');
  const match = raw.match(/^DEV_BYPASS_USER_ID=(.+)$/m);
  const ownerId = match?.[1]?.trim();
  if (!ownerId) throw new Error(`DEV_BYPASS_USER_ID not found in ${varsPath}`);
  return ownerId;
}

function findLocalD1Sqlite(baseDir: string): string {
  const root = path.join(baseDir, '.wrangler', 'state', 'v3', 'd1');
  const files: Array<{ file: string; mtimeMs: number }> = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.sqlite')) {
        files.push({ file: fullPath, mtimeMs: statSync(fullPath).mtimeMs });
      }
    }
  }
  if (files.length === 0) throw new Error(`No local D1 SQLite file found under ${root}. Run wrangler d1 migrations apply pipe-db --local first.`);
  return files.sort((a, b) => b.mtimeMs - a.mtimeMs)[0]!.file;
}

function queryNumber(db: Database.Database, sql: string, key: string): number {
  const row = db.prepare(sql).get() as Record<string, unknown> | undefined;
  const value = row?.[key];
  return typeof value === 'number' ? value : 0;
}

function seedLocalDatabase(options: CliOptions): void {
  const baseDir = workerDir();
  const dbPath = findLocalD1Sqlite(baseDir);
  const ownerId = readDevBypassUserId(baseDir);
  const db = new Database(dbPath);
  const now = new Date().toISOString();
  const candidatesPerPipeline = 8;
  const challenges = 25;

  db.pragma('journal_mode = WAL');
  db.transaction(() => {
    db.prepare("DELETE FROM meeting_participants WHERE id LIKE 'bench-%'").run();
    db.prepare("DELETE FROM meeting_rooms WHERE id LIKE 'bench-%'").run();
    db.prepare("DELETE FROM meetings WHERE id LIKE 'bench-%'").run();
    db.prepare("DELETE FROM contacts WHERE id LIKE 'bench-%'").run();
    db.prepare("DELETE FROM challenges WHERE id LIKE 'bench-challenge-%'").run();
    db.prepare("DELETE FROM candidates WHERE id LIKE 'bench-%'").run();
    db.prepare("DELETE FROM stages WHERE id LIKE 'bench-%'").run();
    db.prepare("DELETE FROM pipelines WHERE id LIKE 'bench-%'").run();
    db.prepare('DELETE FROM repo_skills WHERE repo_id BETWEEN 900000 AND 999999').run();
    db.prepare('DELETE FROM qualified_repos WHERE id BETWEEN 900000 AND 999999').run();
    db.prepare(
      `INSERT INTO rollout_gates (
         id, gate_key, stage, updated_by, metadata_json, created_at, updated_at
       ) VALUES (
         'bench-gate-living-context-read',
         'living_context_read',
         'GA',
         'benchmark-api-routes',
         '{"source":"benchmark-api-routes"}',
         datetime('now'),
         datetime('now')
       )
       ON CONFLICT(gate_key) DO UPDATE SET
         stage = 'GA',
         updated_by = 'benchmark-api-routes',
         metadata_json = '{"source":"benchmark-api-routes"}',
         updated_at = datetime('now')`,
    ).run();

    const pipelineStmt = db.prepare(
      `INSERT INTO pipelines (id, owner_id, title, level, stack, description, status, creation_mode, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const stageStmt = db.prepare(
      `INSERT INTO stages (id, pipeline_id, owner_id, title, description, sort_order, mode, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const candidateStmt = db.prepare(
      `INSERT INTO candidates (
         id, pipeline_id, owner_id, name, email, invite_token, status, current_stage_id,
         skills, years_of_experience, current_role, education, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    for (let i = 0; i < options.pipelines; i += 1) {
      const pipelineId = `bench-pipeline-${i}`;
      const stageId = `bench-stage-${i}`;
      pipelineStmt.run(
        pipelineId,
        ownerId,
        `Benchmark Pipeline ${i}`,
        i % 3 === 0 ? 'Senior' : 'Mid',
        '["TypeScript","React"]',
        'Synthetic route benchmark pipeline',
        i % 5 === 0 ? 'DRAFT' : 'ACTIVE',
        'BLANK',
        now,
        now,
      );
      stageStmt.run(stageId, pipelineId, ownerId, `Benchmark Stage ${i}`, 'Synthetic route benchmark stage', 0, 'ASYNC', now, now);
      for (let j = 0; j < candidatesPerPipeline; j += 1) {
        const n = i * candidatesPerPipeline + j;
        candidateStmt.run(
          `bench-candidate-${n}`,
          pipelineId,
          ownerId,
          `Bench Candidate ${n}`,
          `bench-candidate-${n}@example.test`,
          `bench-token-${n}`,
          j % 7 === 0 ? 'COMPLETED' : (j % 3 === 0 ? 'IN_PROGRESS' : 'INVITED'),
          stageId,
          JSON.stringify(['TypeScript', 'React', 'Workers']),
          5 + (j % 8),
          'Software Engineer',
          JSON.stringify(['BS Computer Science']),
          now,
          now,
        );
      }
    }

    const challengeStmt = db.prepare(
      `INSERT INTO challenges (
         id, stage_id, owner_id, type, sort_order, title, instructions, config, server_config, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (let i = 0; i < challenges; i += 1) {
      challengeStmt.run(
        `bench-challenge-${i}`,
        'bench-stage-1',
        ownerId,
        i % 2 === 0 ? 'CODE_REVIEW' : 'QUIZ_SHORT_ANSWER',
        i,
        `Benchmark Challenge ${i}`,
        'Review the provided source-backed change.',
        '{"prompt":"benchmark"}',
        '{"rubric":"benchmark"}',
        now,
        now,
      );
    }

    const contactStmt = db.prepare(
      `INSERT INTO contacts (id, owner_id, email, name, company, role, phone, linkedin, notes, type, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (let i = 0; i < options.contacts; i += 1) {
      contactStmt.run(
        `bench-contact-${i}`,
        ownerId,
        `bench-contact-${i}@example.test`,
        `Bench Contact ${i}`,
        `Company ${i % 200}`,
        i % 2 === 0 ? 'Engineering Manager' : 'Recruiter',
        null,
        null,
        'Synthetic contact for route benchmarking',
        i % 10 === 0 ? 'customer' : 'lead',
        new Date(Date.now() - i * 1000).toISOString(),
        now,
      );
    }

    const meetingStmt = db.prepare(
      `INSERT INTO meetings (
         id, owner_id, title, description, status, scheduled_at, meeting_type,
         transcript_status, created_at, updated_at, video_enabled, workspace_enabled, recording_enabled
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const roomStmt = db.prepare(
      `INSERT INTO meeting_rooms (id, meeting_id, session_id, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const participantStmt = db.prepare(
      `INSERT INTO meeting_participants (id, meeting_id, contact_id, role, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (let i = 0; i < options.meetings; i += 1) {
      const meetingId = `bench-meeting-${i}`;
      meetingStmt.run(
        meetingId,
        ownerId,
        `Benchmark Meeting ${i}`,
        'Synthetic meeting for route benchmarking',
        i % 4 === 0 ? 'COMPLETED' : 'SCHEDULED',
        now,
        'VIDEO',
        i % 4 === 0 ? 'completed' : 'pending',
        new Date(Date.now() - i * 2000).toISOString(),
        now,
        1,
        1,
        1,
      );
      roomStmt.run(`bench-room-${i}`, meetingId, `bench-session-${i}`, 'READY', now, now);
      participantStmt.run(`bench-participant-${i}`, meetingId, `bench-contact-${i}`, 'ATTENDEE', now, now);
    }

    const repoStmt = db.prepare(
      `INSERT INTO qualified_repos (
         id, github_url, full_name, description, primary_language, license_spdx, stars,
         last_pushed_at, is_archived, is_fork, sloc, file_count, mean_ccn, has_ci,
         has_tests, test_framework, seniority_band, detected_domain, domain_confidence,
         pr_quality_score, contamination_risk, detected_stack_json, pass, disqualified,
         disqualified_reason, crawled_at, refreshed_at, open_pr_count,
         open_feature_issue_count, business_logic_ratio, cross_module_change_rate,
         admin_status, admin_reason, readme_excerpt, root_tree_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const skillStmt = db.prepare('INSERT INTO repo_skills (repo_id, skill_slug, source, confidence) VALUES (?, ?, ?, ?)');
    const skills = ['typescript', 'react', 'cloudflare-workers', 'sqlite', 'testing', 'api-design', 'performance', 'security'];
    for (let i = 0; i < options.repos; i += 1) {
      const id = 900000 + i;
      repoStmt.run(
        id,
        `https://github.com/bench/repo-${i}`,
        `bench/repo-${i}`,
        'Synthetic benchmark repository',
        i % 3 === 0 ? 'TypeScript' : 'JavaScript',
        'MIT',
        50_000 - i,
        now,
        0,
        0,
        20_000 + i,
        300 + (i % 50),
        3.2,
        1,
        1,
        'vitest',
        i % 2 === 0 ? 'senior' : 'mid',
        'web',
        0.8,
        0.75,
        0.05,
        '["TypeScript","React"]',
        (i % 3) + 1,
        0,
        null,
        now,
        now,
        10 + (i % 20),
        4 + (i % 8),
        0.6,
        0.35,
        i % 4 === 0 ? 'approved' : 'pending',
        null,
        'Synthetic readme excerpt',
        '[]',
      );
      for (let s = 0; s < skills.length; s += 1) {
        skillStmt.run(id, skills[s], 'manifest', 1 - s * 0.05);
      }
    }
  })();

  const counts = {
    pipelines: queryNumber(db, "SELECT COUNT(*) AS n FROM pipelines WHERE id LIKE 'bench-%'", 'n'),
    candidates: queryNumber(db, "SELECT COUNT(*) AS n FROM candidates WHERE id LIKE 'bench-%'", 'n'),
    contacts: queryNumber(db, "SELECT COUNT(*) AS n FROM contacts WHERE id LIKE 'bench-%'", 'n'),
    meetings: queryNumber(db, "SELECT COUNT(*) AS n FROM meetings WHERE id LIKE 'bench-%'", 'n'),
    repos: queryNumber(db, 'SELECT COUNT(*) AS n FROM qualified_repos WHERE id BETWEEN 900000 AND 999999', 'n'),
  };
  db.close();
  console.log('[bench:routes] seeded local D1:', counts);
}

function percentile(values: number[], pct: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((pct / 100) * sorted.length) - 1);
  return sorted[index] ?? 0;
}

async function measureOnce(baseUrl: string, route: RouteSpec, timeoutMs: number): Promise<SampleResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  try {
    const body = route.body?.();
    const response = await fetch(`${baseUrl}${route.path}`, {
      method: route.method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const bytes = (await response.arrayBuffer()).byteLength;
    return { ms: performance.now() - started, status: response.status, bytes };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const status = err instanceof Error && err.name === 'AbortError' ? 'timeout' : 'error';
    return { ms: performance.now() - started, status, bytes: 0, error };
  } finally {
    clearTimeout(timer);
  }
}

async function benchmarkRoute(options: CliOptions, route: RouteSpec): Promise<RouteSummary> {
  await measureOnce(options.baseUrl, route, options.timeoutMs);
  const samples: SampleResult[] = [];
  for (let i = 0; i < options.samples; i += 1) {
    samples.push(await measureOnce(options.baseUrl, route, options.timeoutMs));
  }

  const durations = samples.map((sample) => sample.ms);
  const statuses = samples.reduce<Record<string, number>>((acc, sample) => {
    const key = String(sample.status);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const unexpectedStatus = samples.some((sample) => (
    typeof sample.status !== 'number'
    || !route.expectedStatuses.includes(sample.status)
  ));
  const maxMs = Math.round(Math.max(...durations));

  return {
    name: route.name,
    method: route.method,
    path: route.path,
    statuses,
    p50Ms: Math.round(percentile(durations, 50)),
    p95Ms: Math.round(percentile(durations, 95)),
    maxMs,
    maxBytes: Math.max(...samples.map((sample) => sample.bytes)),
    unexpectedStatus,
    slow: maxMs >= options.thresholdMs || Boolean(statuses.timeout),
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.seedLocal) seedLocalDatabase(options);

  const routes = ROUTES.filter((route) => {
    if (route.external && !options.includeExternal) return false;
    if (route.mutation && !options.includeMutations) return false;
    return true;
  });

  const summaries: RouteSummary[] = [];
  for (const route of routes) {
    const summary = await benchmarkRoute(options, route);
    summaries.push(summary);
    console.log(`[bench:routes] ${summary.method} ${summary.path} ${summary.name}: p50=${summary.p50Ms}ms p95=${summary.p95Ms}ms max=${summary.maxMs}ms statuses=${JSON.stringify(summary.statuses)} bytes=${summary.maxBytes}`);
  }

  console.table(summaries.map((summary) => ({
    name: summary.name,
    statuses: JSON.stringify(summary.statuses),
    p50Ms: summary.p50Ms,
    p95Ms: summary.p95Ms,
    maxMs: summary.maxMs,
    maxBytes: summary.maxBytes,
  })));

  const failures = summaries.filter((summary) => summary.slow || summary.unexpectedStatus);
  if (failures.length > 0) {
    console.error('[bench:routes] failures:', JSON.stringify(failures, null, 2));
    process.exitCode = 1;
    return;
  }

  console.log(`[bench:routes] PASS: ${summaries.length} routes measured under ${options.thresholdMs}ms with expected statuses.`);
}

void main().catch((err) => {
  console.error('[bench:routes] fatal:', err);
  process.exitCode = 1;
});
