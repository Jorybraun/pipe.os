/**
 * Maps Role Discovery persona skills to package manager + package name pairs.
 *
 * The persona's `mustHaveSkills` are free-text strings like "React", "Django",
 * "Spring Boot". This module normalizes them to Libraries.io-queryable
 * (platform, package) tuples.
 *
 * Coverage: Tier 1 stacks (research: repo-discovery-pipeline.md §4.3).
 * Unknown skills are returned as-is with platform 'npm' as a best guess,
 * since npm covers the majority of web dev dependencies.
 */

export interface PackageMapping {
  /** Libraries.io platform: npm, pypi, maven, cargo, go, rubygems, etc. */
  platform: string;
  /** Package name on that platform. */
  packageName: string;
  /** Original skill string from the persona. */
  skill: string;
}

/**
 * Lookup table: normalized skill → (platform, package).
 * Keys are lowercase. Multiple entries per skill are allowed (e.g. "node" maps
 * to both npm/express and npm/koa as common indicators).
 */
const SKILL_MAP: Record<string, Array<{ platform: string; packageName: string }>> = {
  // ─── JavaScript / TypeScript ─────────────────────────────────────────
  'react': [{ platform: 'npm', packageName: 'react' }],
  'react.js': [{ platform: 'npm', packageName: 'react' }],
  'reactjs': [{ platform: 'npm', packageName: 'react' }],
  'next.js': [{ platform: 'npm', packageName: 'next' }],
  'nextjs': [{ platform: 'npm', packageName: 'next' }],
  'next': [{ platform: 'npm', packageName: 'next' }],
  'vue': [{ platform: 'npm', packageName: 'vue' }],
  'vue.js': [{ platform: 'npm', packageName: 'vue' }],
  'vuejs': [{ platform: 'npm', packageName: 'vue' }],
  'nuxt': [{ platform: 'npm', packageName: 'nuxt' }],
  'nuxt.js': [{ platform: 'npm', packageName: 'nuxt' }],
  'angular': [{ platform: 'npm', packageName: '@angular/core' }],
  'svelte': [{ platform: 'npm', packageName: 'svelte' }],
  'sveltekit': [{ platform: 'npm', packageName: '@sveltejs/kit' }],
  'typescript': [{ platform: 'npm', packageName: 'typescript' }],
  'node': [{ platform: 'npm', packageName: 'express' }],
  'node.js': [{ platform: 'npm', packageName: 'express' }],
  'nodejs': [{ platform: 'npm', packageName: 'express' }],
  'express': [{ platform: 'npm', packageName: 'express' }],
  'express.js': [{ platform: 'npm', packageName: 'express' }],
  'fastify': [{ platform: 'npm', packageName: 'fastify' }],
  'nestjs': [{ platform: 'npm', packageName: '@nestjs/core' }],
  'nest': [{ platform: 'npm', packageName: '@nestjs/core' }],
  'hono': [{ platform: 'npm', packageName: 'hono' }],
  'remix': [{ platform: 'npm', packageName: '@remix-run/react' }],
  'astro': [{ platform: 'npm', packageName: 'astro' }],
  'tailwind': [{ platform: 'npm', packageName: 'tailwindcss' }],
  'tailwindcss': [{ platform: 'npm', packageName: 'tailwindcss' }],
  'prisma': [{ platform: 'npm', packageName: '@prisma/client' }],
  'drizzle': [{ platform: 'npm', packageName: 'drizzle-orm' }],
  'graphql': [{ platform: 'npm', packageName: 'graphql' }],
  'trpc': [{ platform: 'npm', packageName: '@trpc/server' }],
  'jest': [{ platform: 'npm', packageName: 'jest' }],
  'vitest': [{ platform: 'npm', packageName: 'vitest' }],
  'playwright': [{ platform: 'npm', packageName: 'playwright' }],
  'cypress': [{ platform: 'npm', packageName: 'cypress' }],
  'webpack': [{ platform: 'npm', packageName: 'webpack' }],
  'vite': [{ platform: 'npm', packageName: 'vite' }],
  'esbuild': [{ platform: 'npm', packageName: 'esbuild' }],
  'redux': [{ platform: 'npm', packageName: '@reduxjs/toolkit' }],
  'zustand': [{ platform: 'npm', packageName: 'zustand' }],
  'mobx': [{ platform: 'npm', packageName: 'mobx' }],
  'socket.io': [{ platform: 'npm', packageName: 'socket.io' }],
  'mongoose': [{ platform: 'npm', packageName: 'mongoose' }],

  // ─── Python ──────────────────────────────────────────────────────────
  'python': [{ platform: 'pypi', packageName: 'flask' }],
  'django': [{ platform: 'pypi', packageName: 'django' }],
  'flask': [{ platform: 'pypi', packageName: 'flask' }],
  'fastapi': [{ platform: 'pypi', packageName: 'fastapi' }],
  'pytorch': [{ platform: 'pypi', packageName: 'torch' }],
  'torch': [{ platform: 'pypi', packageName: 'torch' }],
  'tensorflow': [{ platform: 'pypi', packageName: 'tensorflow' }],
  'pandas': [{ platform: 'pypi', packageName: 'pandas' }],
  'numpy': [{ platform: 'pypi', packageName: 'numpy' }],
  'scikit-learn': [{ platform: 'pypi', packageName: 'scikit-learn' }],
  'sklearn': [{ platform: 'pypi', packageName: 'scikit-learn' }],
  'celery': [{ platform: 'pypi', packageName: 'celery' }],
  'sqlalchemy': [{ platform: 'pypi', packageName: 'sqlalchemy' }],
  'pydantic': [{ platform: 'pypi', packageName: 'pydantic' }],
  'pytest': [{ platform: 'pypi', packageName: 'pytest' }],
  'asyncio': [{ platform: 'pypi', packageName: 'aiohttp' }],
  'aiohttp': [{ platform: 'pypi', packageName: 'aiohttp' }],

  // ─── Java / JVM ──────────────────────────────────────────────────────
  'java': [{ platform: 'maven', packageName: 'org.springframework.boot:spring-boot-starter' }],
  'spring': [{ platform: 'maven', packageName: 'org.springframework.boot:spring-boot-starter' }],
  'spring boot': [{ platform: 'maven', packageName: 'org.springframework.boot:spring-boot-starter' }],
  'springboot': [{ platform: 'maven', packageName: 'org.springframework.boot:spring-boot-starter' }],
  'kotlin': [{ platform: 'maven', packageName: 'org.jetbrains.kotlin:kotlin-stdlib' }],
  'quarkus': [{ platform: 'maven', packageName: 'io.quarkus:quarkus-core' }],

  // ─── Go ──────────────────────────────────────────────────────────────
  'go': [{ platform: 'go', packageName: 'github.com/gin-gonic/gin' }],
  'golang': [{ platform: 'go', packageName: 'github.com/gin-gonic/gin' }],
  'gin': [{ platform: 'go', packageName: 'github.com/gin-gonic/gin' }],
  'fiber': [{ platform: 'go', packageName: 'github.com/gofiber/fiber' }],
  'echo': [{ platform: 'go', packageName: 'github.com/labstack/echo' }],

  // ─── Rust ────────────────────────────────────────────────────────────
  'rust': [{ platform: 'cargo', packageName: 'tokio' }],
  'tokio': [{ platform: 'cargo', packageName: 'tokio' }],
  'actix': [{ platform: 'cargo', packageName: 'actix-web' }],
  'axum': [{ platform: 'cargo', packageName: 'axum' }],

  // ─── Ruby ────────────────────────────────────────────────────────────
  'ruby': [{ platform: 'rubygems', packageName: 'rails' }],
  'rails': [{ platform: 'rubygems', packageName: 'rails' }],
  'ruby on rails': [{ platform: 'rubygems', packageName: 'rails' }],
  'sinatra': [{ platform: 'rubygems', packageName: 'sinatra' }],

  // ─── Infrastructure / DevOps ─────────────────────────────────────────
  'docker': [{ platform: 'npm', packageName: 'dockerode' }],
  'kubernetes': [{ platform: 'npm', packageName: '@kubernetes/client-node' }],
  'k8s': [{ platform: 'npm', packageName: '@kubernetes/client-node' }],
  'terraform': [{ platform: 'go', packageName: 'github.com/hashicorp/terraform' }],
  'aws': [{ platform: 'npm', packageName: '@aws-sdk/client-s3' }],
  'aws-sdk': [{ platform: 'npm', packageName: '@aws-sdk/client-s3' }],
  'gcp': [{ platform: 'npm', packageName: '@google-cloud/storage' }],

  // ─── Databases / ORMs ────────────────────────────────────────────────
  'postgresql': [{ platform: 'npm', packageName: 'pg' }],
  'postgres': [{ platform: 'npm', packageName: 'pg' }],
  'mysql': [{ platform: 'npm', packageName: 'mysql2' }],
  'mongodb': [{ platform: 'npm', packageName: 'mongodb' }],
  'redis': [{ platform: 'npm', packageName: 'redis' }],
  'elasticsearch': [{ platform: 'npm', packageName: '@elastic/elasticsearch' }],
};

/**
 * Maps an array of persona skills to Libraries.io-queryable package mappings.
 * Deduplicates by (platform, packageName) pair.
 */
export function mapSkillsToPackages(skills: string[]): PackageMapping[] {
  const seen = new Set<string>();
  const results: PackageMapping[] = [];

  for (const skill of skills) {
    const normalized = skill.toLowerCase().trim();

    // Try exact match first, then normalized variants:
    // "Nest js" → "nestjs", "Nest.js" → "nest.js", "Next JS" → "nextjs"
    const variants = [
      normalized,
      normalized.replace(/\s+/g, ''),          // "nest js" → "nestjs"
      normalized.replace(/\s+/g, '.'),          // "nest js" → "nest.js"
      normalized.replace(/\.js$/i, ''),          // "react.js" → "react"
      normalized.replace(/\s*js$/i, '').trim(),  // "nest js" → "nest"
    ];

    let matched = false;
    for (const variant of variants) {
      const entries = SKILL_MAP[variant];
      if (entries) {
        for (const entry of entries) {
          const key = `${entry.platform}/${entry.packageName}`;
          if (!seen.has(key)) {
            seen.add(key);
            results.push({ ...entry, skill });
          }
        }
        matched = true;
        break;
      }
    }
    // Unknown skills are silently skipped — no guessing.
    // The recruiter sees which skills were queried in the job response.
    if (!matched) {
      // no-op: recruiter sees unmatched skills via the job response
    }
  }

  return results;
}

/** Returns the set of skills that have known package mappings. */
export function getKnownSkills(): string[] {
  return Object.keys(SKILL_MAP);
}
