-- Migration 0022: Role Discovery + Repo Understanding Data Contract (ADR-036)
--
-- Closes two drifts in one bridge:
--   (1) Role Discovery flattening — the intake interview's rich Knowledge State
--       was collapsing into an 8-field CandidatePersona at synthesis time. This
--       migration adds storage for a Role Context Document (RCD) — a hybrid
--       framework-matrix + IPA evidence anchors + grounded-theory axial links +
--       Means-End Chain laddering artifact keyed per (stakeholder, domain).
--       Legacy persona_json stays as a derived consumer_slice cache so existing
--       readers don't break during the migration.
--
--   (2) Repo library has no AI reasoning layer — matchRepos.ts is a SQL keyword
--       join. This migration adds the two tables the two-stage retrieval
--       architecture (ADR-036 §2) needs: role-agnostic repo_engineering_signals
--       (offline Pass 3 output) and cached (role × repo) repo_role_alignment
--       (runtime rerank output).
--
-- Plus a role_probe_bank table that lets the culture interview pull from a
-- finite, recruiter-approved, role-setup-time-enriched probe set instead of
-- generating probes per-candidate (NYC LL 144 + EU AI Act Art 14 compliance).
--
-- Phase 1 only touches schema. Consumer rewrites land in Phase 2+.

-- ─── role_contexts: new columns ─────────────────────────────────────────────
-- rcd_json becomes the primary synthesis artifact. persona_json remains as a
-- cached derivation of rcd_json.consumer_slice so legacy readers keep working
-- until Phase 2/3 cuts them over.

ALTER TABLE role_contexts ADD COLUMN rcd_version         TEXT;
ALTER TABLE role_contexts ADD COLUMN rcd_json            TEXT;
ALTER TABLE role_contexts ADD COLUMN validation_metadata TEXT;
ALTER TABLE role_contexts ADD COLUMN bars_overrides      TEXT;

-- ─── repo_engineering_signals ──────────────────────────────────────────────
-- Offline Pass 3 output (Stage 1 of the two-stage retrieval). Role-agnostic by
-- design — one row per repo, amortized across every role that matches the
-- repo via matchRepos.ts. Runs on Claude Haiku 4.5 via the offline Agent tool
-- path (Phase 4 work — table is created here so Phase 1 migrates once).
--
-- Content-hashed inputs so unchanged repos aren't re-summarized on crawler
-- re-runs. Signals are split into Tier 1 (computable today) and Tier 2
-- (needs Pass 2 extension). Tier 3 (embeddings, code-smell analysis) is
-- explicitly deferred per ADR-036 §2.1.

CREATE TABLE IF NOT EXISTS repo_engineering_signals (
  repo_id                    INTEGER PRIMARY KEY REFERENCES qualified_repos(id) ON DELETE CASCADE,
  signals_version            TEXT    NOT NULL,        -- semver; invalidation key for downstream caches
  content_hash               TEXT    NOT NULL,        -- of the inputs; skip re-run if unchanged

  -- Tier 1 signals (computable from existing substrate)
  test_touch_rate            REAL,                    -- 0.0–1.0
  mean_changed_files         REAL,
  p90_changed_files          INTEGER,
  issue_link_rate            REAL,                    -- 0.0–1.0
  complexity_band            TEXT,                    -- 'low' | 'medium' | 'high' | 'mixed'
  swe_bench_eligibility_rate REAL,                    -- 0.0–1.0

  -- Tier 2 signals (populated as Pass 2 extends; null on first ship)
  architecture_style         TEXT,                    -- 'monolith' | 'microservice' | 'modular_monolith' | 'serverless' | 'unknown'
  review_density             REAL,                    -- mean PR comments per PR
  commit_cadence             REAL,                    -- commits/week trailing 12 months
  satd_density               REAL,                    -- SATD markers per KLOC

  -- Narrative output
  engineering_narrative      TEXT    NOT NULL,        -- ~200-word structured summary
  signal_json                TEXT    NOT NULL,        -- full structured output blob (future-proof)

  -- Provenance
  generated_at               TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  model_used                 TEXT    NOT NULL,        -- e.g. 'claude-haiku-4-5-20251001'
  model_version              TEXT    NOT NULL
);

CREATE INDEX idx_repo_signals_version ON repo_engineering_signals(signals_version);
CREATE INDEX idx_repo_signals_hash    ON repo_engineering_signals(content_hash);

-- ─── repo_role_alignment ───────────────────────────────────────────────────
-- Stage 2 runtime rerank output (Gemma 4 26B on Workers AI). Cached per
-- (role_context_id, repo_id) with rcd_version + signals_version as explicit
-- invalidation columns so a bumped RCD or refreshed signals blow the cache
-- on next read. Phase 4 work — table lands in Phase 1 to migrate once.
--
-- reasoning_json holds the structured per-signal justification the copilot
-- tool explain_repo_for_role reads for the recruiter drawer (ADR-035).

CREATE TABLE IF NOT EXISTS repo_role_alignment (
  role_context_id   TEXT    NOT NULL REFERENCES role_contexts(id)  ON DELETE CASCADE,
  repo_id           INTEGER NOT NULL REFERENCES qualified_repos(id) ON DELETE CASCADE,

  alignment_score   REAL    NOT NULL,                 -- 0.0–1.0
  alignment_band    TEXT    NOT NULL,                 -- 'strong' | 'moderate' | 'weak' | 'mismatch'
  reasoning_json    TEXT    NOT NULL,                 -- structured per-signal justification
  per_signal_scores TEXT    NOT NULL,                 -- JSON { test_touch_rate: 0.82, ... }

  -- Invalidation keys (bump either → cache miss)
  rcd_version       TEXT    NOT NULL,
  signals_version   TEXT    NOT NULL,

  -- Provenance
  generated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  model_used        TEXT    NOT NULL,                 -- e.g. '@cf/google/gemma-4-26b-a4b-it'

  PRIMARY KEY (role_context_id, repo_id)
);

CREATE INDEX idx_role_alignment_role    ON repo_role_alignment(role_context_id, alignment_score DESC);
CREATE INDEX idx_role_alignment_rcd_ver ON repo_role_alignment(role_context_id, rcd_version);

-- ─── role_probe_bank ───────────────────────────────────────────────────────
-- Finite, versioned, recruiter-approved probe set per role. Two sources:
-- 'static_base' (shared across all roles) and 'rcd_enriched' (generated at
-- role setup time from the RCD's laddering_chains). Never per-candidate
-- dynamic generation — that would fail NYC Local Law 144 auditability and
-- EU AI Act Article 14 interpretability (ADR-036 §1.6).

CREATE TABLE IF NOT EXISTS role_probe_bank (
  id               TEXT    PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  role_context_id  TEXT    NOT NULL REFERENCES role_contexts(id) ON DELETE CASCADE,
  dimension        TEXT    NOT NULL,                  -- which culture/behavioral dimension this probes
  probe_text       TEXT    NOT NULL,
  source           TEXT    NOT NULL                   -- provenance of the probe
                   CHECK (source IN ('static_base', 'rcd_enriched')),
  source_chain_id  TEXT,                              -- pointer into RCD laddering_chains (enriched only)
  approved_by      TEXT    NOT NULL,                  -- recruiter user id
  approved_at      TEXT    NOT NULL,                  -- ISO 8601
  rcd_version      TEXT    NOT NULL,                  -- invalidation key
  created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_role_probe_bank_role ON role_probe_bank(role_context_id);
CREATE INDEX idx_role_probe_bank_dim  ON role_probe_bank(role_context_id, dimension);
