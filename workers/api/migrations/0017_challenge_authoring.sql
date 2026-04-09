-- Migration 0017: Challenge Authoring System (ADR-034)
--
-- Creates 4 new tables for the template-based challenge authoring system:
--   1. challenge_templates — immutable challenge definitions
--   2. challenge_language_variants — per-language starter code + test suites
--   3. template_packs — versioned, immutable pack definitions
--   4. template_pack_items — pack composition (which challenges, what order)
--
-- Also adds template_pack_id + template_pack_version to the stages table
-- to track which pack was used to populate a stage.

-- ─── 1. Challenge templates ─────────────────────────────────────────────────

CREATE TABLE challenge_templates (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('CODE_IMPLEMENTATION', 'QUIZ_MCQ', 'QUIZ_SHORT_ANSWER')),
  title TEXT NOT NULL,
  instructions TEXT NOT NULL,
  difficulty TEXT NOT NULL CHECK (difficulty IN ('JUNIOR', 'MID', 'SENIOR')),
  primary_skill TEXT NOT NULL,
  secondary_skills TEXT,            -- JSON array: ["testing", "debugging"]
  bloom_level TEXT CHECK (bloom_level IN (
    'remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'
  )),
  estimated_minutes INTEGER,
  config TEXT NOT NULL,              -- JSON: type-specific public config
  server_config TEXT,                -- JSON: answer keys, rubrics (never sent to client)
  source TEXT NOT NULL CHECK (source IN ('SYSTEM', 'AI_GENERATED', 'USER_CREATED')),
  is_published INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,                   -- Clerk user ID (NULL for system templates)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_challenge_templates_type ON challenge_templates(type);
CREATE INDEX idx_challenge_templates_difficulty ON challenge_templates(difficulty);
CREATE INDEX idx_challenge_templates_primary_skill ON challenge_templates(primary_skill);
CREATE INDEX idx_challenge_templates_source ON challenge_templates(source);
CREATE INDEX idx_challenge_templates_published ON challenge_templates(is_published);

-- ─── 2. Language variants for code challenges ───────────────────────────────

CREATE TABLE challenge_language_variants (
  id TEXT PRIMARY KEY,
  challenge_template_id TEXT NOT NULL REFERENCES challenge_templates(id) ON DELETE CASCADE,
  language TEXT NOT NULL,            -- 'javascript', 'typescript', 'python'
  starter_code TEXT NOT NULL,
  test_suite TEXT NOT NULL,
  test_framework TEXT NOT NULL,      -- 'jest', 'vitest', 'pytest', 'unittest'
  test_command TEXT NOT NULL,        -- 'npx jest', 'python -m pytest'
  solution_code TEXT,                -- Reference solution (server-side only)
  UNIQUE(challenge_template_id, language)
);

CREATE INDEX idx_language_variants_template ON challenge_language_variants(challenge_template_id);

-- ─── 3. Template packs ──────────────────────────────────────────────────────

CREATE TABLE template_packs (
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  role_type TEXT NOT NULL CHECK (role_type IN (
    'FRONTEND', 'BACKEND', 'FULLSTACK', 'DATA_ENGINEERING', 'DEVOPS', 'MOBILE', 'CUSTOM'
  )),
  seniority TEXT NOT NULL CHECK (seniority IN ('JUNIOR', 'MID', 'SENIOR', 'ANY')),
  version INTEGER NOT NULL DEFAULT 1,
  skills TEXT NOT NULL,               -- JSON array of skill tags
  supported_languages TEXT,           -- JSON array: ["javascript", "python"]
  source TEXT NOT NULL CHECK (source IN ('SYSTEM', 'USER_CREATED')),
  is_published INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (id, version)
);

CREATE INDEX idx_template_packs_role ON template_packs(role_type);
CREATE INDEX idx_template_packs_seniority ON template_packs(seniority);
CREATE INDEX idx_template_packs_published ON template_packs(is_published);

-- ─── 4. Pack composition ────────────────────────────────────────────────────

CREATE TABLE template_pack_items (
  template_pack_id TEXT NOT NULL,
  template_pack_version INTEGER NOT NULL,
  challenge_template_id TEXT NOT NULL REFERENCES challenge_templates(id),
  sort_order INTEGER NOT NULL,
  weight REAL NOT NULL DEFAULT 1.0,          -- Relative scoring weight
  is_required INTEGER NOT NULL DEFAULT 1,    -- Required vs optional challenge
  PRIMARY KEY (template_pack_id, template_pack_version, challenge_template_id),
  FOREIGN KEY (template_pack_id, template_pack_version)
    REFERENCES template_packs(id, version) ON DELETE CASCADE
);

-- ─── 5. Stages: track which template pack was used ──────────────────────────

ALTER TABLE stages ADD COLUMN template_pack_id TEXT;
ALTER TABLE stages ADD COLUMN template_pack_version INTEGER;
