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
  coverageReport: boolean;
  contacts: number;
  pipelines: number;
  repos: number;
  meetings: number;
}

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface RouteSpec {
  name: string;
  method: HttpMethod;
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

interface SourceRoute {
  method: HttpMethod;
  path: string;
  source: string;
}

const DEFAULT_OPTIONS: CliOptions = {
  baseUrl: 'http://localhost:8787',
  samples: 7,
  thresholdMs: 5_000,
  timeoutMs: 20_000,
  seedLocal: false,
  includeExternal: false,
  includeMutations: false,
  coverageReport: true,
  contacts: 200_000,
  pipelines: 1_200,
  repos: 5_000,
  meetings: 1_200,
};

let roleCreateCounter = 0;

const ROUTES: RouteSpec[] = [
  { name: 'health', method: 'GET', path: '/health', expectedStatuses: [200] },
  { name: 'api health alias', method: 'GET', path: '/api/health', expectedStatuses: [200] },
  { name: 'pipelines list default', method: 'GET', path: '/api/v1/pipelines', expectedStatuses: [200] },
  { name: 'pipelines list limit 100', method: 'GET', path: '/api/v1/pipelines?limit=100', expectedStatuses: [200] },
  { name: 'pipelines active search', method: 'GET', path: '/api/v1/pipelines?status=ACTIVE&q=Benchmark&limit=100', expectedStatuses: [200] },
  { name: 'pipeline overview', method: 'GET', path: '/api/v1/pipelines/bench-pipeline-1/overview', expectedStatuses: [200] },
  { name: 'pipeline ingestion list', method: 'GET', path: '/api/v1/pipelines/bench-pipeline-1/ingestion', expectedStatuses: [200] },
  { name: 'pipeline ingestion feedback list', method: 'GET', path: '/api/v1/pipelines/bench-pipeline-1/ingestion/bench-candidate-8/feedback', expectedStatuses: [200] },
  { name: 'contacts list default', method: 'GET', path: '/api/v1/contacts', expectedStatuses: [200] },
  { name: 'contacts list page 2', method: 'GET', path: '/api/v1/contacts?page=2&limit=100', expectedStatuses: [200] },
  { name: 'meetings list', method: 'GET', path: '/api/v1/meetings', expectedStatuses: [200] },
  { name: 'meeting room context summary missing', method: 'GET', path: '/api/v1/meeting-rooms/missing-token/context-summary', expectedStatuses: [404] },
  { name: 'meeting room context graph missing', method: 'GET', path: '/api/v1/meeting-rooms/missing-token/context-graph', expectedStatuses: [404] },
  { name: 'admin repos pending', method: 'GET', path: '/api/v1/admin/repos?status=pending&limit=50', expectedStatuses: [200] },
  { name: 'admin repos all 500', method: 'GET', path: '/api/v1/admin/repos?status=all&limit=500', expectedStatuses: [200] },
  { name: 'admin repos lookup existing', method: 'GET', path: '/api/v1/admin/repos/lookup?repoUrl=https%3A%2F%2Fgithub.com%2Fbench%2Frepo-0&suitability=any&minPass=1', expectedStatuses: [200] },
  { name: 'admin ai usage summary', method: 'GET', path: '/api/v1/admin/ai-usage', expectedStatuses: [200] },
  { name: 'admin ai usage sessions', method: 'GET', path: '/api/v1/admin/ai-usage/sessions?limit=20', expectedStatuses: [200] },
  { name: 'repo discovery missing pipeline query', method: 'GET', path: '/api/v1/repos', expectedStatuses: [400] },
  { name: 'repo discovery list empty', method: 'GET', path: '/api/v1/repos?pipelineId=bench-pipeline-1', expectedStatuses: [200] },
  { name: 'repo discovery job missing', method: 'GET', path: '/api/v1/repos/jobs/missing-job', expectedStatuses: [404] },
  { name: 'repo discovery detail missing', method: 'GET', path: '/api/v1/repos/missing-repo', expectedStatuses: [404] },
  { name: 'repo discovery by skills disabled', method: 'POST', path: '/api/v1/repos/discover-by-skills', expectedStatuses: [410] },
  { name: 'agent session empty', method: 'GET', path: '/api/v1/agent/session?pipelineId=bench-pipeline-1', expectedStatuses: [200] },
  { name: 'email connection', method: 'GET', path: '/api/v1/email/connection', expectedStatuses: [200] },
  { name: 'scheduling connection', method: 'GET', path: '/api/v1/scheduling/connection', expectedStatuses: [200] },
  { name: 'scheduling event types missing connection', method: 'GET', path: '/api/v1/scheduling/event-types', expectedStatuses: [404] },
  { name: 'scheduling interviews list', method: 'GET', path: '/api/v1/scheduling/interviews', expectedStatuses: [200] },
  { name: 'scheduling interview detail missing', method: 'GET', path: '/api/v1/scheduling/interviews/missing-interview', expectedStatuses: [404] },
  { name: 'scheduling room events snapshot', method: 'GET', path: '/api/v1/scheduling/room-events', expectedStatuses: [200] },
  { name: 'scheduling events snapshot', method: 'GET', path: '/api/v1/scheduling/events', expectedStatuses: [200] },
  { name: 'phone connection', method: 'GET', path: '/api/v1/phone/connection', expectedStatuses: [200] },
  { name: 'phone calls list', method: 'GET', path: '/api/v1/phone/calls?candidateId=bench-candidate-1', expectedStatuses: [200] },
  { name: 'culture cost dashboard', method: 'GET', path: '/api/v1/screening/culture/cost-dashboard', expectedStatuses: [200] },
  { name: 'culture report missing', method: 'GET', path: '/api/v1/screening/culture/sessions/missing-session/report', expectedStatuses: [404] },
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
  { name: 'candidate ingestion status', method: 'GET', path: '/api/v1/candidates/bench-candidate-1/ingestion-status', expectedStatuses: [200] },
  { name: 'meeting room missing', method: 'GET', path: '/api/v1/meeting-rooms/missing-token', expectedStatuses: [404] },
  { name: 'rollout gate', method: 'GET', path: '/api/v1/internal/rollout-gate', expectedStatuses: [200] },
  { name: 'rollout gate gates', method: 'GET', path: '/api/v1/internal/rollout-gate/gates', expectedStatuses: [200] },
  { name: 'rollout gate audit', method: 'GET', path: '/api/v1/internal/rollout-gate/audit?gateKey=living_context_read&limit=20', expectedStatuses: [200] },
  { name: 'living context health', method: 'GET', path: '/api/v1/internal/living-context-health', expectedStatuses: [200] },
  { name: 'living context integrity', method: 'GET', path: '/api/v1/internal/living-context-integrity', expectedStatuses: [200] },
  { name: 'evaluation readiness validation', method: 'GET', path: '/api/v1/internal/evaluation-readiness', expectedStatuses: [400] },
  { name: 'living context stats', method: 'GET', path: '/api/v1/internal/living-context-stats', expectedStatuses: [200] },
  { name: 'living context backfill status', method: 'GET', path: '/api/v1/internal/living-context-backfill', expectedStatuses: [200] },
  { name: 'concept graph overview', method: 'GET', path: '/api/v1/internal/concept-graph?limit=20', expectedStatuses: [200] },
  { name: 'internal evidence readiness', method: 'GET', path: '/api/v1/internal/evidence-readiness?candidateId=bench-candidate-1', expectedStatuses: [200] },
  { name: 'internal evidence conflicts', method: 'GET', path: '/api/v1/internal/evidence-conflicts?candidateId=bench-candidate-1', expectedStatuses: [200] },
  {
    name: 'search repos query',
    method: 'POST',
    path: '/api/v1/search/repos',
    body: () => ({ query: 'typescript react api performance', limit: 5 }),
    expectedStatuses: [200],
  },
  {
    name: 'search candidates validation',
    method: 'POST',
    path: '/api/v1/search/candidates',
    body: () => ({ query: 'typescript react api performance', limit: 5 }),
    expectedStatuses: [422],
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
  { name: 'candidate living search', method: 'GET', path: '/api/v1/candidates/bench-candidate-1/living-context/search?q=typescript', expectedStatuses: [200] },
  { name: 'candidate living timeline', method: 'GET', path: '/api/v1/candidates/bench-candidate-1/living-context/timeline?limit=20', expectedStatuses: [200] },
  { name: 'candidate living match narrative', method: 'GET', path: '/api/v1/candidates/bench-candidate-1/living-context/match-narrative', expectedStatuses: [200] },
  { name: 'candidate living evidence depth', method: 'GET', path: '/api/v1/candidates/bench-candidate-1/living-context/evidence-depth', expectedStatuses: [200] },
  { name: 'candidate living evidence readiness', method: 'GET', path: '/api/v1/candidates/bench-candidate-1/living-context/evidence-readiness', expectedStatuses: [200] },
  { name: 'candidate living evidence conflicts', method: 'GET', path: '/api/v1/candidates/bench-candidate-1/living-context/evidence-conflicts', expectedStatuses: [200] },
  { name: 'candidate living match history', method: 'GET', path: '/api/v1/candidates/bench-candidate-1/living-context/match-history?limit=20', expectedStatuses: [200] },
  {
    name: 'candidate compare same pipeline',
    method: 'POST',
    path: '/api/v1/candidates/compare',
    body: () => ({ candidateIds: ['bench-candidate-1', 'bench-candidate-2'], pipelineId: 'bench-pipeline-0', conceptLimit: 5 }),
    expectedStatuses: [200],
  },
  { name: 'contact detail', method: 'GET', path: '/api/v1/contacts/bench-contact-1', expectedStatuses: [200] },
  { name: 'contact living summary', method: 'GET', path: '/api/v1/contacts/bench-contact-1/living-context/summary', expectedStatuses: [200] },
  { name: 'contact living full', method: 'GET', path: '/api/v1/contacts/bench-contact-1/living-context', expectedStatuses: [200] },
  { name: 'contact living search', method: 'GET', path: '/api/v1/contacts/bench-contact-1/living-context/search?q=benchmark', expectedStatuses: [200] },
  { name: 'contact living timeline', method: 'GET', path: '/api/v1/contacts/bench-contact-1/living-context/timeline?limit=20', expectedStatuses: [200] },
  { name: 'contact living evidence depth', method: 'GET', path: '/api/v1/contacts/bench-contact-1/living-context/evidence-depth', expectedStatuses: [200] },
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
  { name: 'dev container sessions by pipeline', method: 'GET', path: '/api/v1/pipelines/bench-pipeline-1/dev-container-sessions', expectedStatuses: [200] },
  { name: 'dev container session missing', method: 'GET', path: '/api/v1/dev-container-sessions/missing-session', expectedStatuses: [404] },
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
  { name: 'role context living missing', method: 'GET', path: '/api/v1/role-contexts/missing-role-context/living-context', expectedStatuses: [404] },
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
      case '--no-coverage-report':
        options.coverageReport = false;
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
  --no-coverage-report   Skip source route inventory coverage output
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

function stripQuery(rawPath: string): string {
  return rawPath.split('?')[0] ?? rawPath;
}

function parseStringLiteral(raw: string): string | null {
  const trimmed = raw.trim();
  const quote = trimmed[0];
  if ((quote !== "'" && quote !== '"') || trimmed[trimmed.length - 1] !== quote) {
    return null;
  }
  return trimmed.slice(1, -1);
}

function normalizeRoutePath(routePath: string): string {
  if (routePath.length === 0) return '/';
  const withoutTrailing = routePath.length > 1 ? routePath.replace(/\/+$/, '') : routePath;
  return withoutTrailing.startsWith('/') ? withoutTrailing : `/${withoutTrailing}`;
}

function joinRoutePath(prefix: string, routePath: string): string {
  const normalizedPrefix = prefix === '/' ? '' : prefix.replace(/\/+$/, '');
  if (routePath === '/' || routePath.length === 0) return normalizeRoutePath(normalizedPrefix || '/');
  const normalizedRoute = routePath.startsWith('/') ? routePath : `/${routePath}`;
  return normalizeRoutePath(`${normalizedPrefix}${normalizedRoute}`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sourcePatternToRegExp(pattern: string): RegExp {
  const parts = normalizeRoutePath(pattern).split('/').map((part) => {
    if (part.startsWith(':')) return '[^/]+';
    return escapeRegExp(part);
  });
  return new RegExp(`^${parts.join('/')}$`);
}

function sourcePatternScore(pattern: string): number {
  return pattern
    .split('/')
    .filter((part) => part.length > 0 && !part.startsWith(':'))
    .join('/')
    .length;
}

function parseImports(source: string, sourcePath: string): Map<string, string> {
  const imported = new Map<string, string>();
  const importRegex = /import\s+(?:([A-Za-z0-9_]+)|\{\s*([^}]+?)\s*\})\s+from\s+['"](.+?)['"]/gs;
  let match: RegExpExecArray | null;
  while ((match = importRegex.exec(source)) !== null) {
    const defaultName = match[1];
    const namedImports = match[2];
    const importPath = match[3];
    if (!importPath?.startsWith('.')) continue;
    const resolved = path.resolve(path.dirname(sourcePath), importPath);
    const tsPath = resolved.endsWith('.ts') ? resolved : `${resolved}.ts`;

    if (defaultName) imported.set(defaultName, tsPath);
    if (!namedImports) continue;

    for (const rawPart of namedImports.split(',')) {
      const part = rawPart.trim();
      if (!part) continue;
      const aliasMatch = /^([A-Za-z0-9_]+)\s+as\s+([A-Za-z0-9_]+)$/.exec(part);
      imported.set(aliasMatch?.[2] ?? part, tsPath);
    }
  }
  return imported;
}

function discoverHonoRouterNames(source: string): string[] {
  const routers = new Set<string>();
  const routerRegex = /const\s+([A-Za-z0-9_]+)\s*=\s*new\s+Hono\b/g;
  let match: RegExpExecArray | null;
  while ((match = routerRegex.exec(source)) !== null) {
    if (match[1]) routers.add(match[1]);
  }
  return [...routers];
}

function collectSourceRoutes(
  routerName: string,
  filePath: string,
  prefix: string,
  seen: Set<string>,
): SourceRoute[] {
  const key = `${filePath}:${routerName}:${prefix}`;
  if (seen.has(key)) return [];
  seen.add(key);

  let source: string;
  try {
    source = readFileSync(filePath, 'utf8');
  } catch {
    return [];
  }

  const routes: SourceRoute[] = [];
  const imports = parseImports(source, filePath);
  const routerNames = source.includes(`${routerName}.`)
    ? [routerName]
    : discoverHonoRouterNames(source);

  for (const name of routerNames) {
    const methodRegex = new RegExp(`${name}\\.(get|post|put|patch|delete)\\(\\s*([^,]+)`, 'g');
    let match: RegExpExecArray | null;
    while ((match = methodRegex.exec(source)) !== null) {
      const method = match[1]?.toUpperCase() as HttpMethod | undefined;
      const routePath = match[2] ? parseStringLiteral(match[2]) : null;
      if (!method || !routePath) continue;
      routes.push({
        method,
        path: joinRoutePath(prefix, routePath),
        source: path.relative(workerDir(), filePath),
      });
    }

    const nestedRouteRegex = new RegExp(`${name}\\.route\\(\\s*(['"][^'"]+['"])\\s*,\\s*([A-Za-z0-9_]+)\\s*\\)`, 'g');
    while ((match = nestedRouteRegex.exec(source)) !== null) {
      const routePath = parseStringLiteral(match[1] ?? '');
      const nestedRouter = match[2];
      const nestedFile = nestedRouter ? imports.get(nestedRouter) : undefined;
      if (!routePath || !nestedRouter || !nestedFile) continue;
      routes.push(...collectSourceRoutes(nestedRouter, nestedFile, joinRoutePath(prefix, routePath), seen));
    }
  }

  return routes;
}

function discoverSourceRoutes(baseDir: string): SourceRoute[] {
  const indexPath = path.join(baseDir, 'src', 'index.ts');
  const indexSource = readFileSync(indexPath, 'utf8');
  const imports = parseImports(indexSource, indexPath);
  const routes: SourceRoute[] = [];

  const directRouteRegex = /app\.(get|post|put|patch|delete)\(\s*([^,]+)/g;
  let match: RegExpExecArray | null;
  while ((match = directRouteRegex.exec(indexSource)) !== null) {
    const method = match[1]?.toUpperCase() as HttpMethod | undefined;
    const routePath = match[2] ? parseStringLiteral(match[2]) : null;
    if (!method || !routePath) continue;
    routes.push({ method, path: normalizeRoutePath(routePath), source: path.relative(baseDir, indexPath) });
  }

  const mountedRouteRegex = /app\.route\(\s*(['"][^'"]*['"])\s*,\s*([A-Za-z0-9_]+)\s*\)/g;
  const seen = new Set<string>();
  while ((match = mountedRouteRegex.exec(indexSource)) !== null) {
    const prefix = parseStringLiteral(match[1] ?? '');
    const routerName = match[2];
    const routerFile = routerName ? imports.get(routerName) : undefined;
    if (prefix === null || !routerName || !routerFile) continue;
    routes.push(...collectSourceRoutes(routerName, routerFile, prefix, seen));
  }

  const unique = new Map<string, SourceRoute>();
  for (const route of routes) {
    unique.set(`${route.method} ${route.path} ${route.source}`, route);
  }
  return [...unique.values()].sort((a, b) => `${a.method} ${a.path}`.localeCompare(`${b.method} ${b.path}`));
}

function matchSourceRoute(spec: RouteSpec, sourceRoutes: SourceRoute[]): SourceRoute | null {
  const requestPath = normalizeRoutePath(stripQuery(spec.path));
  const candidates = sourceRoutes
    .filter((route) => route.method === spec.method && sourcePatternToRegExp(route.path).test(requestPath))
    .sort((a, b) => sourcePatternScore(b.path) - sourcePatternScore(a.path));
  return candidates[0] ?? null;
}

function printCoverageReport(baseDir: string, routes: RouteSpec[]): void {
  const sourceRoutes = discoverSourceRoutes(baseDir);
  const covered = new Set<string>();

  for (const route of routes) {
    const sourceRoute = matchSourceRoute(route, sourceRoutes);
    if (!sourceRoute) continue;
    covered.add(`${sourceRoute.method} ${sourceRoute.path} ${sourceRoute.source}`);
  }

  const uncovered = sourceRoutes.filter((route) => !covered.has(`${route.method} ${route.path} ${route.source}`));
  console.log(`[bench:routes] source route coverage: ${covered.size}/${sourceRoutes.length} discovered handlers matched by ${routes.length} benchmark specs.`);
  if (uncovered.length === 0) return;
  console.log('[bench:routes] uncovered source routes (first 25):');
  for (const route of uncovered.slice(0, 25)) {
    console.log(`  - ${route.method} ${route.path} (${route.source})`);
  }
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
  if (options.coverageReport) printCoverageReport(workerDir(), routes);

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
