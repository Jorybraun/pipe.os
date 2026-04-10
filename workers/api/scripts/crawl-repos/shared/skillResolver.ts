/**
 * Normalizes raw skill strings and package names to canonical slugs.
 *
 * Used by both:
 *   - The crawler (to populate repo_skills.skill_slug)
 *   - The runtime matchRepos (to slugify recruiter input)
 *
 * Extended from skillToPackage.ts — same keys, but maps to slugs (not
 * Libraries.io platform/package tuples).
 */

/** Canonical slug → the set of raw strings that map to it */
const SLUG_MAP: Record<string, string[]> = {
  // JavaScript / TypeScript
  react:        ['react', 'react.js', 'reactjs'],
  nextjs:       ['next', 'next.js', 'nextjs', 'next js'],
  vue:          ['vue', 'vue.js', 'vuejs', 'vue js'],
  nuxt:         ['nuxt', 'nuxt.js', 'nuxtjs'],
  angular:      ['angular', '@angular/core'],
  svelte:       ['svelte'],
  sveltekit:    ['sveltekit', '@sveltejs/kit'],
  typescript:   ['typescript'],
  nodejs:       ['node', 'node.js', 'nodejs', 'express', 'express.js'],
  express:      ['express', 'express.js'],
  fastify:      ['fastify'],
  nestjs:       ['nestjs', 'nest', '@nestjs/core'],
  hono:         ['hono'],
  remix:        ['remix', '@remix-run/react'],
  astro:        ['astro'],
  tailwind:     ['tailwind', 'tailwindcss'],
  prisma:       ['prisma', '@prisma/client'],
  drizzle:      ['drizzle', 'drizzle-orm'],
  graphql:      ['graphql', '@apollo/client', '@apollo/server', 'apollo-server'],
  trpc:         ['trpc', '@trpc/server', '@trpc/client'],
  jest:         ['jest'],
  vitest:       ['vitest'],
  playwright:   ['playwright', '@playwright/test'],
  cypress:      ['cypress'],
  webpack:      ['webpack'],
  vite:         ['vite'],
  esbuild:      ['esbuild'],
  redux:        ['redux', '@reduxjs/toolkit'],
  zustand:      ['zustand'],
  mobx:         ['mobx'],
  mongoose:     ['mongoose'],
  socketio:     ['socket.io', 'socket.io-client'],

  // Python
  python:       ['python'],
  django:       ['django'],
  flask:        ['flask'],
  fastapi:      ['fastapi'],
  pytorch:      ['torch', 'pytorch'],
  tensorflow:   ['tensorflow', 'keras'],
  pandas:       ['pandas'],
  numpy:        ['numpy'],
  'scikit-learn': ['scikit-learn', 'sklearn'],
  celery:       ['celery'],
  sqlalchemy:   ['sqlalchemy'],
  pydantic:     ['pydantic'],
  pytest:       ['pytest'],
  aiohttp:      ['aiohttp', 'asyncio'],
  alembic:      ['alembic'],
  uvicorn:      ['uvicorn'],

  // Java / JVM
  java:         ['java'],
  spring:       ['spring', 'spring-boot', 'spring boot'],
  'spring-boot': ['spring-boot', 'spring boot', 'springboot', 'org.springframework.boot:spring-boot-starter'],
  kotlin:       ['kotlin'],
  quarkus:      ['quarkus'],
  micronaut:    ['micronaut'],
  junit:        ['junit', 'junit5'],

  // Go
  go:           ['go', 'golang'],
  gin:          ['gin', 'github.com/gin-gonic/gin'],
  fiber:        ['fiber', 'github.com/gofiber/fiber'],
  echo:         ['echo', 'github.com/labstack/echo'],
  gorm:         ['gorm'],

  // Rust
  rust:         ['rust'],
  tokio:        ['tokio'],
  actix:        ['actix', 'actix-web'],
  axum:         ['axum'],

  // Ruby
  ruby:         ['ruby'],
  rails:        ['rails', 'ruby on rails'],
  sinatra:      ['sinatra'],

  // Infra / DevOps
  docker:       ['docker', 'dockerode'],
  kubernetes:   ['kubernetes', 'k8s', '@kubernetes/client-node'],
  terraform:    ['terraform'],
  aws:          ['aws', '@aws-sdk/client-s3', 'aws-sdk'],
  gcp:          ['gcp', '@google-cloud/storage'],
  pulumi:       ['pulumi'],
  ansible:      ['ansible'],

  // Databases
  postgres:     ['postgres', 'postgresql', 'pg', 'pgx'],
  mysql:        ['mysql', 'mysql2'],
  mongodb:      ['mongodb', 'mongoose'],
  redis:        ['redis', 'ioredis'],
  elasticsearch: ['elasticsearch', '@elastic/elasticsearch'],
  sqlite:       ['sqlite', 'better-sqlite3', 'sqlite3'],
  supabase:     ['supabase', '@supabase/supabase-js'],
  firebase:     ['firebase', '@firebase/app'],

  // Testing
  mocha:        ['mocha'],
  jasmine:      ['jasmine'],
  phpunit:      ['phpunit'],
  rspec:        ['rspec'],
  gotest:       ['testing', 'testify'],
};

/** Reverse map: raw string → canonical slug */
const REVERSE: Map<string, string> = new Map();
for (const [slug, aliases] of Object.entries(SLUG_MAP)) {
  for (const alias of aliases) {
    REVERSE.set(alias.toLowerCase(), slug);
  }
  // Slug itself always resolves to itself
  REVERSE.set(slug.toLowerCase(), slug);
}

/**
 * Normalise a raw skill or package name to a canonical slug.
 * Returns null if no mapping exists.
 */
export function resolveSkillSlug(raw: string): string | null {
  const normalized = raw.toLowerCase().trim();
  // Direct lookup
  const direct = REVERSE.get(normalized);
  if (direct) return direct;

  // Variant: strip ".js" suffix ("react.js" → "react")
  const noJs = normalized.replace(/\.js$/, '');
  if (noJs !== normalized) {
    const v = REVERSE.get(noJs);
    if (v) return v;
  }

  // Variant: collapse spaces ("nest js" → "nestjs")
  const noSpaces = normalized.replace(/\s+/g, '');
  if (noSpaces !== normalized) {
    const v = REVERSE.get(noSpaces);
    if (v) return v;
  }

  // Variant: "@scope/package" → "package"
  if (normalized.startsWith('@')) {
    const bare = normalized.split('/')[1];
    if (bare) {
      const v = REVERSE.get(bare);
      if (v) return v;
    }
  }

  return null;
}

/** Resolve an array of raw skills, deduplicating by canonical slug. */
export function resolveSkills(raws: string[]): string[] {
  const seen = new Set<string>();
  const results: string[] = [];
  for (const raw of raws) {
    const slug = resolveSkillSlug(raw);
    if (slug && !seen.has(slug)) {
      seen.add(slug);
      results.push(slug);
    }
  }
  return results;
}

/** All canonical slugs. */
export function getAllSlugs(): string[] {
  return Object.keys(SLUG_MAP);
}
