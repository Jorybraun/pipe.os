/**
 * Engineering construct extractor rules — §3.3 of the plan.
 *
 * Each extractor is a deterministic function over the cloned repo's file tree.
 * Returns an evidence count: 0 = not present, >0 = present (higher = stronger signal).
 *
 * The taxonomy covers ~60 slugs across 9 categories. Extend as needed.
 * DO NOT add constructs that require full AST parsing — regex + path matching only.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { ConstructExtractor, ExtractorContext } from './shared/types.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function countFilesMatching(filePaths: string[], pattern: RegExp): number {
  return filePaths.filter((f) => pattern.test(f)).length;
}

function hasFileMatching(filePaths: string[], pattern: RegExp): boolean {
  return filePaths.some((f) => pattern.test(f));
}

function hasPackage(rawDeps: string[], ...pkgs: string[]): boolean {
  return pkgs.some((p) => rawDeps.some((d) => d.toLowerCase() === p.toLowerCase()));
}

function hasSkill(skills: string[], ...slugs: string[]): boolean {
  return slugs.some((s) => skills.includes(s));
}

function fileContains(filePath: string, pattern: RegExp): boolean {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return pattern.test(content);
  } catch {
    return false;
  }
}

function countFilesContaining(
  repoDir: string,
  filePaths: string[],
  filePattern: RegExp,
  contentPattern: RegExp,
  limit = 200,
): number {
  let count = 0;
  const candidates = filePaths.filter((f) => filePattern.test(f)).slice(0, limit);
  for (const rel of candidates) {
    if (fileContains(path.join(repoDir, rel), contentPattern)) count++;
  }
  return count;
}

// ─── Construct extractors ─────────────────────────────────────────────────────

export const CONSTRUCT_EXTRACTORS: ConstructExtractor[] = [

  // ── Async & concurrency ──────────────────────────────────────────────────

  {
    slug: 'async-error-handling',
    match: ({ repoDir, filePaths, skills }) => {
      if (!hasSkill(skills, 'nodejs', 'express', 'fastify', 'nestjs', 'fastapi', 'aiohttp')) return 0;
      const jsFiles = filePaths.filter((f) => /\.(ts|js|mts|mjs)$/.test(f));
      return countFilesContaining(repoDir, jsFiles, /\.(ts|js)$/, /try\s*\{[\s\S]{1,200}await/, 100);
    },
  },

  {
    slug: 'promise-chains',
    match: ({ repoDir, filePaths, skills }) => {
      if (!hasSkill(skills, 'nodejs', 'express', 'react', 'nextjs')) return 0;
      const jsFiles = filePaths.filter((f) => /\.(ts|js)$/.test(f));
      return countFilesContaining(repoDir, jsFiles, /\.(ts|js)$/, /\.then\s*\(|\.catch\s*\(|\.finally\s*\(/, 80);
    },
  },

  {
    slug: 'race-conditions',
    match: ({ repoDir, filePaths, skills }) => {
      if (!hasSkill(skills, 'nodejs', 'go', 'rust')) return 0;
      const files = filePaths.filter((f) => /\.(ts|js|go|rs)$/.test(f));
      return countFilesContaining(repoDir, files, /\.(ts|js|go|rs)$/, /Promise\.race|sync\.WaitGroup|tokio::select/, 50);
    },
  },

  {
    slug: 'cancellation-tokens',
    match: ({ repoDir, filePaths, skills }) => {
      if (!hasSkill(skills, 'nodejs', 'go', 'python')) return 0;
      const files = filePaths.filter((f) => /\.(ts|js|go|py)$/.test(f));
      return countFilesContaining(repoDir, files, /\.(ts|js|go|py)$/, /AbortController|AbortSignal|context\.Cancel|CancellationToken/, 50);
    },
  },

  {
    slug: 'backpressure',
    match: ({ rawDeps }) => {
      return hasPackage(rawDeps, 'bull', 'bullmq', 'p-limit', 'bottleneck', 'rxjs') ? 2 : 0;
    },
  },

  {
    slug: 'event-loop-blocking',
    match: ({ repoDir, filePaths, skills }) => {
      if (!hasSkill(skills, 'nodejs', 'express')) return 0;
      const files = filePaths.filter((f) => /\.(ts|js)$/.test(f));
      return countFilesContaining(repoDir, files, /\.(ts|js)$/, /worker_threads|child_process|cluster\.fork/, 50);
    },
  },

  // ── State management ─────────────────────────────────────────────────────

  {
    slug: 'react-hooks',
    match: ({ repoDir, filePaths, skills }) => {
      if (!hasSkill(skills, 'react', 'nextjs')) return 0;
      const files = filePaths.filter((f) => /\.(tsx|jsx|ts|js)$/.test(f));
      return countFilesContaining(repoDir, files, /\.(tsx|jsx|ts|js)$/, /\buse[A-Z]\w+\s*[=(]/, 100);
    },
  },

  {
    slug: 'react-context',
    match: ({ repoDir, filePaths, skills }) => {
      if (!hasSkill(skills, 'react', 'nextjs')) return 0;
      const files = filePaths.filter((f) => /\.(tsx|jsx|ts|js)$/.test(f));
      return countFilesContaining(repoDir, files, /\.(tsx|jsx|ts|js)$/, /createContext|useContext|\.Provider/, 50);
    },
  },

  {
    slug: 'redux-reducers',
    match: ({ repoDir, filePaths, skills }) => {
      if (!hasSkill(skills, 'redux')) return 0;
      const files = filePaths.filter((f) => /reducer/i.test(f) && /\.(ts|js|tsx|jsx)$/.test(f));
      return Math.min(files.length, 10);
    },
  },

  {
    slug: 'state-machines',
    match: ({ rawDeps }) => {
      return hasPackage(rawDeps, 'xstate', '@xstate/react', 'robot3', 'statecharts') ? 3 : 0;
    },
  },

  {
    slug: 'immutability',
    match: ({ rawDeps }) => {
      return hasPackage(rawDeps, 'immer', 'immutable', 'seamless-immutable') ? 2 : 0;
    },
  },

  {
    slug: 'derived-state',
    match: ({ rawDeps }) => {
      return hasPackage(rawDeps, 'reselect', 'jotai', 'valtio', 'nanostores') ? 2 : 0;
    },
  },

  // ── API design ────────────────────────────────────────────────────────────

  {
    slug: 'rest-api-design',
    match: ({ filePaths, skills }) => {
      if (!hasSkill(skills, 'express', 'fastify', 'nestjs', 'hono', 'django', 'fastapi', 'rails', 'gin')) return 0;
      return countFilesMatching(filePaths, /routes?\/|controllers?\//i);
    },
  },

  {
    slug: 'graphql-schema',
    match: ({ filePaths }) => {
      return countFilesMatching(filePaths, /schema\.(graphql|gql)$|typeDefs/);
    },
  },

  {
    slug: 'graphql-resolvers',
    match: ({ filePaths, rawDeps }) => {
      if (!hasPackage(rawDeps, 'graphql', '@apollo/server', 'apollo-server', 'type-graphql', 'nexus')) return 0;
      return countFilesMatching(filePaths, /resolvers?\//i);
    },
  },

  {
    slug: 'pagination',
    match: ({ repoDir, filePaths }) => {
      const apiFiles = filePaths.filter((f) => /\.(ts|js|py|go|rb)$/.test(f));
      return countFilesContaining(repoDir, apiFiles, /\.(ts|js|py|go|rb)$/, /cursor|offset|page_size|per_page|limit.*offset|after.*first/i, 50);
    },
  },

  {
    slug: 'api-versioning',
    match: ({ filePaths }) => {
      return hasFileMatching(filePaths, /\/v[0-9]+\//i) ||
             hasFileMatching(filePaths, /\/api\/v[0-9]/i) ? 2 : 0;
    },
  },

  {
    slug: 'error-responses',
    match: ({ repoDir, filePaths }) => {
      const apiFiles = filePaths.filter((f) => /\.(ts|js|py|go|rb)$/.test(f));
      return countFilesContaining(repoDir, apiFiles, /\.(ts|js|py|go|rb)$/, /status\(4[0-9]{2}\)|HTTPException|http\.Error|json\(\{.*error/, 30);
    },
  },

  {
    slug: 'idempotency',
    match: ({ repoDir, filePaths }) => {
      const apiFiles = filePaths.filter((f) => /\.(ts|js|py|go|rb)$/.test(f));
      return countFilesContaining(repoDir, apiFiles, /\.(ts|js|py|go|rb)$/, /idempotency.?key|Idempotency-Key|upsert/i, 20);
    },
  },

  // ── Data layer ────────────────────────────────────────────────────────────

  {
    slug: 'sql-queries',
    match: ({ filePaths }) => {
      return countFilesMatching(filePaths, /\.sql$/) +
             countFilesMatching(filePaths, /migrations?\//i);
    },
  },

  {
    slug: 'sql-optimization',
    match: ({ repoDir, filePaths }) => {
      const sqlFiles = filePaths.filter((f) => /\.sql$/.test(f));
      return countFilesContaining(repoDir, sqlFiles, /\.sql$/, /CREATE INDEX|EXPLAIN|QUERY PLAN|ANALYZE/i, 30);
    },
  },

  {
    slug: 'orm-n-plus-one',
    match: ({ rawDeps, repoDir, filePaths, skills }) => {
      if (!hasSkill(skills, 'prisma', 'drizzle', 'sqlalchemy', 'django')) {
        if (!hasPackage(rawDeps, 'typeorm', 'sequelize', 'mongoose')) return 0;
      }
      const ormFiles = filePaths.filter((f) => /\.(ts|js|py)$/.test(f));
      return countFilesContaining(repoDir, ormFiles, /\.(ts|js|py)$/, /include:|select\(|prefetch_related|eager|\.findMany|\.findAll/, 50);
    },
  },

  {
    slug: 'transactions',
    match: ({ repoDir, filePaths }) => {
      const dbFiles = filePaths.filter((f) => /\.(ts|js|py|go|rb|sql)$/.test(f));
      return countFilesContaining(repoDir, dbFiles, /\.(ts|js|py|go|rb|sql)$/, /BEGIN|COMMIT|ROLLBACK|transaction|\.transaction\(/, 20);
    },
  },

  {
    slug: 'migrations',
    match: ({ filePaths }) => {
      return countFilesMatching(filePaths, /migrations?\//i);
    },
  },

  {
    slug: 'connection-pooling',
    match: ({ rawDeps }) => {
      return hasPackage(rawDeps, 'pg-pool', 'knex', 'sequelize', 'typeorm') ? 2 : 0;
    },
  },

  {
    slug: 'caching-strategy',
    match: ({ rawDeps, repoDir, filePaths }) => {
      if (hasPackage(rawDeps, 'redis', 'ioredis', 'lru-cache', 'node-cache')) return 3;
      const files = filePaths.filter((f) => /\.(ts|js|py|go)$/.test(f));
      return countFilesContaining(repoDir, files, /\.(ts|js|py|go)$/, /cache\.set|cache\.get|setex|getex|memcached/, 20);
    },
  },

  // ── Auth & security ───────────────────────────────────────────────────────

  {
    slug: 'authn-flows',
    match: ({ rawDeps, filePaths }) => {
      if (hasPackage(rawDeps, 'passport', 'next-auth', 'lucia', '@auth/core', 'jose', 'jsonwebtoken')) return 4;
      return countFilesMatching(filePaths, /login|signin|oauth|auth/i);
    },
  },

  {
    slug: 'authz-checks',
    match: ({ repoDir, filePaths }) => {
      const files = filePaths.filter((f) => /\.(ts|js|py|go|rb)$/.test(f));
      return countFilesContaining(repoDir, files, /\.(ts|js|py|go|rb)$/, /canActivate|permission|hasRole|authorize|can\(|ability\./i, 30);
    },
  },

  {
    slug: 'token-handling',
    match: ({ rawDeps }) => {
      return hasPackage(rawDeps, 'jsonwebtoken', 'jose', 'passport-jwt', 'pyjwt', 'golang-jwt') ? 3 : 0;
    },
  },

  {
    slug: 'input-validation',
    match: ({ rawDeps }) => {
      return hasPackage(rawDeps, 'zod', 'joi', 'yup', 'class-validator', 'express-validator', 'pydantic') ? 3 : 0;
    },
  },

  {
    slug: 'sql-injection',
    match: ({ repoDir, filePaths }) => {
      const files = filePaths.filter((f) => /\.(ts|js|py|go|rb)$/.test(f));
      return countFilesContaining(repoDir, files, /\.(ts|js|py|go|rb)$/, /parameterized|prepared|sanitize|escape.*sql|sql.*escape/i, 20);
    },
  },

  {
    slug: 'xss-escaping',
    match: ({ rawDeps, repoDir, filePaths }) => {
      if (hasPackage(rawDeps, 'dompurify', 'sanitize-html', 'xss')) return 3;
      const files = filePaths.filter((f) => /\.(ts|js|tsx|jsx)$/.test(f));
      return countFilesContaining(repoDir, files, /\.(ts|js|tsx|jsx)$/, /dangerouslySetInnerHTML|sanitize|escapeHtml/, 20);
    },
  },

  {
    slug: 'csrf',
    match: ({ rawDeps }) => {
      return hasPackage(rawDeps, 'csurf', 'csrf-csrf', 'django-csrf', 'gorilla/csrf') ? 3 : 0;
    },
  },

  {
    slug: 'secrets-handling',
    match: ({ filePaths }) => {
      return hasFileMatching(filePaths, /\.env\.example$|\.env\.sample$/) ? 2 : 0;
    },
  },

  // ── Frontend concerns ─────────────────────────────────────────────────────

  {
    slug: 'form-validation',
    match: ({ rawDeps }) => {
      return hasPackage(rawDeps, 'react-hook-form', 'formik', 'react-final-form', 'vee-validate') ? 3 : 0;
    },
  },

  {
    slug: 'accessibility-aria',
    match: ({ repoDir, filePaths, skills }) => {
      if (!hasSkill(skills, 'react', 'nextjs', 'vue', 'angular', 'svelte')) return 0;
      const files = filePaths.filter((f) => /\.(tsx|jsx|vue|html)$/.test(f));
      return countFilesContaining(repoDir, files, /\.(tsx|jsx|vue|html)$/, /aria-|role="|tabIndex|sr-only/, 30);
    },
  },

  {
    slug: 'responsive-layout',
    match: ({ rawDeps, filePaths }) => {
      if (hasPackage(rawDeps, 'tailwindcss', 'bootstrap', '@mui/material', 'styled-components')) return 2;
      return countFilesMatching(filePaths, /\.css$|\.scss$|\.less$/);
    },
  },

  {
    slug: 'client-routing',
    match: ({ rawDeps }) => {
      return hasPackage(rawDeps, 'react-router', 'react-router-dom', '@tanstack/router', 'vue-router', '@angular/router') ? 3 : 0;
    },
  },

  {
    slug: 'data-fetching',
    match: ({ rawDeps }) => {
      return hasPackage(rawDeps, '@tanstack/react-query', 'swr', '@apollo/client', 'rtk-query', 'axios') ? 3 : 0;
    },
  },

  {
    slug: 'suspense-boundaries',
    match: ({ repoDir, filePaths, skills }) => {
      if (!hasSkill(skills, 'react', 'nextjs')) return 0;
      const files = filePaths.filter((f) => /\.(tsx|jsx)$/.test(f));
      return countFilesContaining(repoDir, files, /\.(tsx|jsx)$/, /Suspense|lazy\(|React\.lazy|loading\.tsx/, 20);
    },
  },

  {
    slug: 'memoization',
    match: ({ repoDir, filePaths, skills }) => {
      if (!hasSkill(skills, 'react', 'nextjs')) return 0;
      const files = filePaths.filter((f) => /\.(tsx|jsx|ts|js)$/.test(f));
      return countFilesContaining(repoDir, files, /\.(tsx|jsx|ts|js)$/, /useMemo|useCallback|React\.memo|memo\(/, 20);
    },
  },

  // ── Testing ───────────────────────────────────────────────────────────────

  {
    slug: 'unit-tests',
    match: ({ filePaths }) => {
      return countFilesMatching(filePaths, /\.test\.(ts|js|tsx|jsx)$|\.spec\.(ts|js|tsx|jsx)$|_test\.go$|_test\.py$/);
    },
  },

  {
    slug: 'integration-tests',
    match: ({ filePaths }) => {
      return countFilesMatching(filePaths, /integration[\\/].*\.(test|spec)\.|e2e[\\/].*\.(test|spec)\./i);
    },
  },

  {
    slug: 'test-doubles',
    match: ({ repoDir, filePaths }) => {
      const testFiles = filePaths.filter((f) => /\.(test|spec)\.(ts|js)$/.test(f));
      return countFilesContaining(repoDir, testFiles, /\.(test|spec)\.(ts|js)$/, /vi\.mock|jest\.mock|sinon\.|stub\(|spy\(/, 30);
    },
  },

  {
    slug: 'snapshot-tests',
    match: ({ filePaths }) => {
      return countFilesMatching(filePaths, /__snapshots__\/|\.snap$/);
    },
  },

  {
    slug: 'property-tests',
    match: ({ rawDeps }) => {
      return hasPackage(rawDeps, 'fast-check', 'jsverify', 'hypothesis', 'quickcheck') ? 3 : 0;
    },
  },

  {
    slug: 'e2e-tests',
    match: ({ rawDeps, filePaths }) => {
      if (hasPackage(rawDeps, 'playwright', '@playwright/test', 'cypress', 'puppeteer', 'selenium-webdriver')) return 4;
      return countFilesMatching(filePaths, /e2e[\\/]|playwright\.config|cypress\.config/);
    },
  },

  // ── Infra & ops ───────────────────────────────────────────────────────────

  {
    slug: 'ci-workflows',
    match: ({ filePaths }) => {
      return countFilesMatching(filePaths, /\.github\/workflows\/.*\.ya?ml$/);
    },
  },

  {
    slug: 'dockerfiles',
    match: ({ filePaths }) => {
      return countFilesMatching(filePaths, /^Dockerfile$|\/Dockerfile$|docker-compose\.ya?ml$/i);
    },
  },

  {
    slug: 'env-config',
    match: ({ filePaths }) => {
      const envExamples = countFilesMatching(filePaths, /\.env\.(example|sample|template)$/i);
      const configFiles = countFilesMatching(filePaths, /config\.(ts|js|json|yaml|yml)$/i);
      return envExamples + Math.min(configFiles, 3);
    },
  },

  {
    slug: 'feature-flags',
    match: ({ rawDeps }) => {
      return hasPackage(rawDeps, 'growthbook', 'launchdarkly-js-sdk', 'unleash-client', 'openfeature') ? 3 : 0;
    },
  },

  {
    slug: 'logging',
    match: ({ rawDeps }) => {
      return hasPackage(rawDeps, 'winston', 'pino', 'bunyan', 'morgan', 'structlog', 'zap', 'logrus', 'slog') ? 3 : 0;
    },
  },

  {
    slug: 'metrics',
    match: ({ rawDeps }) => {
      return hasPackage(rawDeps, 'prom-client', 'prometheus-client', 'opentelemetry', '@opentelemetry/api', 'statsd') ? 3 : 0;
    },
  },

  {
    slug: 'tracing',
    match: ({ rawDeps }) => {
      return hasPackage(rawDeps, '@opentelemetry/sdk-trace-node', 'dd-trace', 'jaeger-client', 'zipkin') ? 3 : 0;
    },
  },

  // ── Code quality ──────────────────────────────────────────────────────────

  {
    slug: 'error-types',
    match: ({ repoDir, filePaths }) => {
      const files = filePaths.filter((f) => /errors?\.(ts|js|go|py|rb)$/.test(f));
      return files.length + countFilesContaining(repoDir,
        filePaths.filter((f) => /\.(ts|go)$/.test(f)),
        /\.(ts|go)$/, /extends Error|class.*Error|type.*Error|errors\.New/, 30,
      );
    },
  },

  {
    slug: 'null-handling',
    match: ({ repoDir, filePaths }) => {
      const tsFiles = filePaths.filter((f) => /\.ts$/.test(f));
      return countFilesContaining(repoDir, tsFiles, /\.ts$/, /\?\.|[?][?]|Optional|Maybe|Result</, 30);
    },
  },

  {
    slug: 'type-narrowing',
    match: ({ repoDir, filePaths }) => {
      const tsFiles = filePaths.filter((f) => /\.ts$|\.tsx$/.test(f));
      return countFilesContaining(repoDir, tsFiles, /\.tsx?$/, /instanceof |typeof .*===|is[A-Z]\w+\(.*:.*=>|satisfies /, 20);
    },
  },

  {
    slug: 'refactoring-extraction',
    match: ({ repoDir, filePaths }) => {
      const files = filePaths.filter((f) => /utils?\.|helpers?\.|shared\./i.test(f) && /\.(ts|js|py|go)$/.test(f));
      return Math.min(files.length, 10);
    },
  },

  {
    slug: 'dead-code',
    match: ({ rawDeps }) => {
      return hasPackage(rawDeps, 'knip', 'ts-prune', 'unimported') ? 2 : 0;
    },
  },
];

export const CONSTRUCT_SLUGS = CONSTRUCT_EXTRACTORS.map((e) => e.slug);
