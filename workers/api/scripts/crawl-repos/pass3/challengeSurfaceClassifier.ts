/**
 * Pass 3 — deterministic challenge-surface classifier.
 *
 * Extension field recorded in STRATEGY Decision Log 2026-04-14.
 *
 * Emits 10 floats in [0, 1], one per ADR-032:131 bug template category. The
 * output is intentionally deterministic so the same repo always produces the
 * same surfaces; Gemma reads these as facts in the narrative prompt but never
 * writes them itself.
 *
 * Rule rationales:
 *   - SQL injection: repos using a full ORM are at low risk; raw-SQL repos are
 *     at high risk regardless of language.
 *   - N+1: ORM + relations is the textbook cause. Raw SQL has some risk.
 *   - CORS: only repos that expose HTTP APIs can misconfigure CORS.
 *   - Type confusion: weak-typed languages and non-strict TS carry the risk;
 *     Rust/Go/Kotlin/strict TS don't.
 *   - TOCTOU: concurrency primitives + shared state.
 *   - Stale cache: explicit cache layers (Redis/Memcached/in-memory).
 *   - Unvalidated input: HTTP surface without a validator library.
 *   - Off-by-one: flat prior — every codebase has loops and indexes.
 *   - Dangling reference: non-RAII memory-unsafe languages.
 *   - Missing null check: languages without compile-time null safety.
 */

import type { ChallengeSurfaces } from '../shared/types.js';

const ORM_LIBRARIES = new Set([
  'prisma',
  '@prisma/client',
  'sqlalchemy',
  'active_record',
  'activerecord',
  'gorm',
  'diesel',
  'typeorm',
  'sequelize',
  'mikro-orm',
  'mongoose',
  'ent',
]);

const RAW_SQL_LIBRARIES = new Set([
  'pg',
  'postgres',
  'mysql',
  'mysql2',
  'sqlite3',
  'better-sqlite3',
  'psycopg2',
  'psycopg',
  'mysql-connector-python',
  'pq',
  'rusqlite',
]);

const HTTP_FRAMEWORKS = new Set([
  'hono',
  'express',
  'koa',
  'fastify',
  'nestjs',
  '@nestjs/core',
  'fastapi',
  'django',
  'flask',
  'starlette',
  'gin',
  'echo',
  'fiber',
  'actix-web',
  'axum',
  'rocket',
  'rails',
  'sinatra',
  'spring-boot',
]);

const VALIDATOR_LIBRARIES = new Set([
  'zod',
  'pydantic',
  'marshmallow',
  'joi',
  'yup',
  'ajv',
  'valibot',
  'class-validator',
  'attrs',
]);

const CACHE_LIBRARIES = new Set([
  'redis',
  'ioredis',
  'memcached',
  'node-cache',
  'lru-cache',
  'django-redis',
  'aiocache',
  'redigo',
]);

const CONCURRENCY_CONSTRUCTS = new Set([
  'concurrent',
  'async-mutex',
  'tokio',
  'rayon',
  'threading',
  'asyncio-lock',
  'sync-mutex',
  'parallel-workers',
]);

const NULL_SAFE_LANGUAGES = new Set(['rust', 'kotlin', 'swift', 'scala', 'haskell', 'elm']);
const RAII_LANGUAGES = new Set(['rust', 'go', 'java', 'c#', 'kotlin', 'python', 'ruby', 'typescript', 'javascript']);
const WEAK_TYPED_LANGUAGES = new Set(['python', 'javascript', 'ruby', 'php', 'perl']);

/** Flatten detected-stack JSON into a lower-cased Set. */
function extractStackPackages(detectedStackJson: string | null): Set<string> {
  const packages = new Set<string>();
  if (!detectedStackJson) return packages;
  let parsed: unknown;
  try {
    parsed = JSON.parse(detectedStackJson);
  } catch {
    return packages;
  }
  const collect = (value: unknown): void => {
    if (typeof value === 'string') {
      packages.add(value.toLowerCase());
    } else if (Array.isArray(value)) {
      value.forEach(collect);
    } else if (value && typeof value === 'object') {
      for (const v of Object.values(value as Record<string, unknown>)) collect(v);
    }
  };
  collect(parsed);
  return packages;
}

export interface ChallengeSurfaceInput {
  detected_stack_json: string | null;
  primary_language: string;
  constructs: Array<{ slug: string }>;
  detected_domain: string | null;
}

export function classifyChallengeSurfaces(
  input: ChallengeSurfaceInput,
): ChallengeSurfaces {
  const stack = extractStackPackages(input.detected_stack_json);
  const lang = input.primary_language.toLowerCase();
  const constructSlugs = new Set(input.constructs.map((c) => c.slug.toLowerCase()));

  const hasOrm = [...ORM_LIBRARIES].some((l) => stack.has(l));
  const hasRawSql = [...RAW_SQL_LIBRARIES].some((l) => stack.has(l));
  const hasHttp = [...HTTP_FRAMEWORKS].some((l) => stack.has(l));
  const hasValidator = [...VALIDATOR_LIBRARIES].some((l) => stack.has(l));
  const hasCache = [...CACHE_LIBRARIES].some((l) => stack.has(l));
  const hasConcurrency = [...CONCURRENCY_CONSTRUCTS].some((c) => constructSlugs.has(c));

  // SQL injection
  let sql_injection_potential: number;
  if (hasRawSql && !hasOrm) sql_injection_potential = 0.8;
  else if (hasRawSql && hasOrm) sql_injection_potential = 0.4;
  else if (hasOrm) sql_injection_potential = 0.05;
  else sql_injection_potential = 0.1;

  // N+1 queries
  let n_plus_one_potential: number;
  if (hasOrm) n_plus_one_potential = 0.7;
  else if (hasRawSql) n_plus_one_potential = 0.3;
  else n_plus_one_potential = 0.0;

  // CORS misconfiguration
  const cors_misconfig_potential = hasHttp ? 0.6 : 0.1;

  // Type confusion
  let type_confusion_potential: number;
  if (WEAK_TYPED_LANGUAGES.has(lang)) type_confusion_potential = 0.6;
  else if (lang === 'typescript') type_confusion_potential = 0.5;
  else type_confusion_potential = 0.2;

  // TOCTOU race
  const toctou_race_potential = hasConcurrency ? 0.7 : 0.3;

  // Stale cache
  const stale_cache_potential = hasCache ? 0.7 : 0.1;

  // Unvalidated input
  let unvalidated_input_potential: number;
  if (hasHttp && !hasValidator) unvalidated_input_potential = 0.7;
  else if (hasHttp && hasValidator) unvalidated_input_potential = 0.4;
  else unvalidated_input_potential = 0.2;

  // Off-by-one: flat prior
  const off_by_one_potential = 0.4;

  // Dangling reference: only non-RAII / memory-unsafe languages
  const dangling_reference_potential =
    lang === 'c' || lang === 'c++' || lang === 'cpp'
      ? 0.7
      : RAII_LANGUAGES.has(lang)
        ? 0.2
        : 0.4;

  // Missing null check: languages lacking compile-time null safety
  const missing_null_check_potential = NULL_SAFE_LANGUAGES.has(lang)
    ? 0.1
    : lang === 'typescript'
      ? 0.3
      : 0.6;

  return {
    off_by_one_potential,
    toctou_race_potential,
    stale_cache_potential,
    unvalidated_input_potential,
    type_confusion_potential,
    dangling_reference_potential,
    sql_injection_potential,
    cors_misconfig_potential,
    n_plus_one_potential,
    missing_null_check_potential,
  };
}
