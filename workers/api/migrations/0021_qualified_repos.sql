-- Migration 0021: Qualified Repos Graph Index
-- Offline-crawled, pre-qualified repo database.
-- Replaces real-time Libraries.io discovery with a pre-populated catalog
-- queryable at runtime in <200ms (STRATEGY.md CR-13).
--
-- Five tables:
--   qualified_repos  — one row per crawled repo (pass1 or pass2)
--   repo_skills      — many-to-many skill join (powers JD→repo matching)
--   repo_constructs  — engineering construct tags (§3 taxonomy)
--   repo_sample_prs  — vetted PRs for AIG bug planting (SWE-bench eligible)
--   skill_aliases    — slug canonicalization for recruiter input normalisation

-- ─── qualified_repos ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS qualified_repos (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  github_url       TEXT    UNIQUE NOT NULL,
  full_name        TEXT    NOT NULL,
  description      TEXT,
  homepage         TEXT,
  primary_language TEXT    NOT NULL,
  license_spdx     TEXT    NOT NULL,
  stars            INTEGER NOT NULL,
  last_pushed_at   TEXT    NOT NULL,
  is_archived      INTEGER NOT NULL DEFAULT 0,
  is_fork          INTEGER NOT NULL DEFAULT 0,

  -- Pass-2 complexity signals (null until pass=2)
  sloc             INTEGER,
  file_count       INTEGER,
  mean_ccn         REAL,

  -- Quality markers
  has_ci           INTEGER NOT NULL DEFAULT 0,
  has_tests        INTEGER NOT NULL DEFAULT 0,
  test_framework   TEXT,

  -- Classification
  seniority_band   TEXT CHECK (seniority_band IN ('junior', 'mid', 'senior', 'staff') OR seniority_band IS NULL),
  detected_domain  TEXT,
  domain_confidence REAL,

  -- Scoring
  pr_quality_score     REAL NOT NULL DEFAULT 0,
  contamination_risk   REAL NOT NULL DEFAULT 0,

  -- Debugging
  detected_stack_json  TEXT,

  -- Crawl state
  pass             INTEGER NOT NULL DEFAULT 1,
  disqualified     INTEGER NOT NULL DEFAULT 0,
  disqualified_reason TEXT,
  crawled_at       TEXT    NOT NULL,
  refreshed_at     TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_repos_lang_active
  ON qualified_repos(primary_language, disqualified, last_pushed_at);

CREATE INDEX IF NOT EXISTS idx_repos_domain_band
  ON qualified_repos(detected_domain, seniority_band, disqualified);

CREATE INDEX IF NOT EXISTS idx_repos_pr_quality
  ON qualified_repos(pr_quality_score DESC)
  WHERE disqualified = 0;

CREATE INDEX IF NOT EXISTS idx_repos_full_name
  ON qualified_repos(full_name);

-- ─── repo_skills ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS repo_skills (
  repo_id    INTEGER NOT NULL REFERENCES qualified_repos(id) ON DELETE CASCADE,
  skill_slug TEXT    NOT NULL,
  source     TEXT    NOT NULL CHECK (source IN ('manifest', 'import', 'topic', 'readme')),
  confidence REAL    NOT NULL,
  PRIMARY KEY (repo_id, skill_slug)
);

CREATE INDEX IF NOT EXISTS idx_repo_skills_slug
  ON repo_skills(skill_slug, confidence DESC);

-- ─── repo_constructs ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS repo_constructs (
  repo_id        INTEGER NOT NULL REFERENCES qualified_repos(id) ON DELETE CASCADE,
  construct_slug TEXT    NOT NULL,
  evidence_count INTEGER NOT NULL,
  PRIMARY KEY (repo_id, construct_slug)
);

CREATE INDEX IF NOT EXISTS idx_repo_constructs_slug
  ON repo_constructs(construct_slug);

-- ─── repo_sample_prs ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS repo_sample_prs (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id               INTEGER NOT NULL REFERENCES qualified_repos(id) ON DELETE CASCADE,
  pr_number             INTEGER NOT NULL,
  pr_url                TEXT    NOT NULL,
  title                 TEXT,
  merged_at             TEXT    NOT NULL,
  resolves_issue_number INTEGER,
  changed_file_count    INTEGER NOT NULL,
  modifies_tests        INTEGER NOT NULL DEFAULT 0,
  additions             INTEGER,
  deletions             INTEGER,
  construct_slugs_json  TEXT,
  swe_bench_eligible    INTEGER NOT NULL DEFAULT 0,
  UNIQUE (repo_id, pr_number)
);

CREATE INDEX IF NOT EXISTS idx_sample_prs_eligible
  ON repo_sample_prs(repo_id, swe_bench_eligible);

-- ─── skill_aliases ───────────────────────────────────────────────────────────
-- Canonical slug lookup so recruiter input ("React", "ReactJS", "react.js")
-- all resolve to the same slug ("react") without a code deploy.

CREATE TABLE IF NOT EXISTS skill_aliases (
  alias          TEXT PRIMARY KEY,
  canonical_slug TEXT NOT NULL
);

-- Seed data — aliases for all keys in skillToPackage.ts
INSERT OR IGNORE INTO skill_aliases (alias, canonical_slug) VALUES
  -- JavaScript / TypeScript
  ('react',             'react'),
  ('React',             'react'),
  ('react.js',          'react'),
  ('React.js',          'react'),
  ('ReactJS',           'react'),
  ('reactjs',           'react'),
  ('next',              'nextjs'),
  ('Next',              'nextjs'),
  ('next.js',           'nextjs'),
  ('Next.js',           'nextjs'),
  ('nextjs',            'nextjs'),
  ('NextJS',            'nextjs'),
  ('vue',               'vue'),
  ('Vue',               'vue'),
  ('vue.js',            'vue'),
  ('Vue.js',            'vue'),
  ('VueJS',             'vue'),
  ('nuxt',              'nuxt'),
  ('nuxt.js',           'nuxt'),
  ('angular',           'angular'),
  ('Angular',           'angular'),
  ('svelte',            'svelte'),
  ('sveltekit',         'sveltekit'),
  ('typescript',        'typescript'),
  ('TypeScript',        'typescript'),
  ('TS',                'typescript'),
  ('ts',                'typescript'),
  ('node',              'nodejs'),
  ('Node',              'nodejs'),
  ('node.js',           'nodejs'),
  ('Node.js',           'nodejs'),
  ('nodejs',            'nodejs'),
  ('NodeJS',            'nodejs'),
  ('express',           'express'),
  ('Express',           'express'),
  ('express.js',        'express'),
  ('fastify',           'fastify'),
  ('nestjs',            'nestjs'),
  ('NestJS',            'nestjs'),
  ('nest',              'nestjs'),
  ('hono',              'hono'),
  ('remix',             'remix'),
  ('astro',             'astro'),
  ('tailwind',          'tailwind'),
  ('tailwindcss',       'tailwind'),
  ('TailwindCSS',       'tailwind'),
  ('prisma',            'prisma'),
  ('drizzle',           'drizzle'),
  ('graphql',           'graphql'),
  ('GraphQL',           'graphql'),
  ('trpc',              'trpc'),
  ('tRPC',              'trpc'),
  ('jest',              'jest'),
  ('vitest',            'vitest'),
  ('playwright',        'playwright'),
  ('cypress',           'cypress'),
  ('webpack',           'webpack'),
  ('vite',              'vite'),
  ('esbuild',           'esbuild'),
  ('redux',             'redux'),
  ('Redux',             'redux'),
  ('zustand',           'zustand'),
  ('mobx',              'mobx'),
  ('mongoose',          'mongoose'),
  -- Python
  ('python',            'python'),
  ('Python',            'python'),
  ('django',            'django'),
  ('Django',            'django'),
  ('flask',             'flask'),
  ('Flask',             'flask'),
  ('fastapi',           'fastapi'),
  ('FastAPI',           'fastapi'),
  ('pytorch',           'pytorch'),
  ('PyTorch',           'pytorch'),
  ('tensorflow',        'tensorflow'),
  ('TensorFlow',        'tensorflow'),
  ('pandas',            'pandas'),
  ('numpy',             'numpy'),
  ('NumPy',             'numpy'),
  ('scikit-learn',      'scikit-learn'),
  ('sklearn',           'scikit-learn'),
  ('celery',            'celery'),
  ('sqlalchemy',        'sqlalchemy'),
  ('SQLAlchemy',        'sqlalchemy'),
  ('pydantic',          'pydantic'),
  ('pytest',            'pytest'),
  ('aiohttp',           'aiohttp'),
  -- Java / JVM
  ('java',              'java'),
  ('Java',              'java'),
  ('spring',            'spring'),
  ('Spring',            'spring'),
  ('spring boot',       'spring-boot'),
  ('Spring Boot',       'spring-boot'),
  ('springboot',        'spring-boot'),
  ('kotlin',            'kotlin'),
  ('Kotlin',            'kotlin'),
  ('quarkus',           'quarkus'),
  -- Go
  ('go',                'go'),
  ('Go',                'go'),
  ('golang',            'go'),
  ('Golang',            'go'),
  ('gin',               'gin'),
  ('fiber',             'fiber'),
  ('echo',              'echo'),
  -- Rust
  ('rust',              'rust'),
  ('Rust',              'rust'),
  ('tokio',             'tokio'),
  ('actix',             'actix'),
  ('axum',              'axum'),
  -- Ruby
  ('ruby',              'ruby'),
  ('Ruby',              'ruby'),
  ('rails',             'rails'),
  ('Rails',             'rails'),
  ('ruby on rails',     'rails'),
  ('Ruby on Rails',     'rails'),
  ('sinatra',           'sinatra'),
  -- Infra
  ('docker',            'docker'),
  ('Docker',            'docker'),
  ('kubernetes',        'kubernetes'),
  ('Kubernetes',        'kubernetes'),
  ('k8s',               'kubernetes'),
  ('K8s',               'kubernetes'),
  ('terraform',         'terraform'),
  ('Terraform',         'terraform'),
  ('aws',               'aws'),
  ('AWS',               'aws'),
  ('gcp',               'gcp'),
  ('GCP',               'gcp'),
  -- Databases
  ('postgresql',        'postgres'),
  ('PostgreSQL',        'postgres'),
  ('postgres',          'postgres'),
  ('Postgres',          'postgres'),
  ('mysql',             'mysql'),
  ('MySQL',             'mysql'),
  ('mongodb',           'mongodb'),
  ('MongoDB',           'mongodb'),
  ('redis',             'redis'),
  ('Redis',             'redis'),
  ('elasticsearch',     'elasticsearch');
