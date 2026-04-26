-- Broker schema for swarm plan registry, conflict detection, migration ledger,
-- event bus, steering cues, and handoff store.
-- Designed for SQLite with WAL mode.

-- ---------------------------------------------------------------------------
-- Plans
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS plans (
    plan_id         TEXT PRIMARY KEY,           -- relative path: part4-candidate-ingestion/candidate-nodes-schema.md
    plan_path       TEXT NOT NULL UNIQUE,       -- full relative path from repo root
    title           TEXT NOT NULL,
    source          TEXT,
    phase           INTEGER,
    status          TEXT NOT NULL DEFAULT 'PENDING',
    estimate        TEXT,
    why             TEXT,
    acceptance      TEXT,                       -- markdown blob
    parsed_at       REAL NOT NULL               -- timestamp
);

CREATE INDEX IF NOT EXISTS idx_plans_status ON plans(status);
CREATE INDEX IF NOT EXISTS idx_plans_phase  ON plans(phase);

-- ---------------------------------------------------------------------------
-- Subtasks
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS plan_subtasks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_id     TEXT NOT NULL REFERENCES plans(plan_id) ON DELETE CASCADE,
    subtask_id  TEXT NOT NULL,                  -- stable id: "subtask-1", "subtask-2" ...
    title       TEXT NOT NULL,
    spec        TEXT,
    files       TEXT,                           -- JSON list of file paths
    migrations  TEXT,                           -- JSON list of migration numbers (e.g. [45, 46])
    status      TEXT NOT NULL DEFAULT 'PENDING'
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_subtasks_plan_subtask
    ON plan_subtasks(plan_id, subtask_id);

-- ---------------------------------------------------------------------------
-- Plan dependencies (plan A depends on plan B, or A blocks B)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS plan_dependencies (
    plan_id     TEXT NOT NULL REFERENCES plans(plan_id) ON DELETE CASCADE,
    depends_on  TEXT NOT NULL REFERENCES plans(plan_id) ON DELETE CASCADE,
    relation    TEXT NOT NULL DEFAULT 'depends_on',   -- depends_on | blocks
    PRIMARY KEY (plan_id, depends_on)
);

-- ---------------------------------------------------------------------------
-- Files touched by each plan (denormalised for fast conflict queries)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS plan_files (
    plan_id     TEXT NOT NULL REFERENCES plans(plan_id) ON DELETE CASCADE,
    file_path   TEXT NOT NULL,
    PRIMARY KEY (plan_id, file_path)
);

CREATE INDEX IF NOT EXISTS idx_plan_files_path ON plan_files(file_path);

-- ---------------------------------------------------------------------------
-- Migration ledger — atomic per-environment allocation
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS migration_ledger (
    number      INTEGER NOT NULL,
    env         TEXT NOT NULL,
    plan_id     TEXT REFERENCES plans(plan_id) ON DELETE SET NULL,
    lane_id     TEXT,
    reserved_at REAL,
    released_at REAL,
    PRIMARY KEY (number, env)
);

CREATE INDEX IF NOT EXISTS idx_migration_ledger_env ON migration_ledger(env, released_at);

-- ---------------------------------------------------------------------------
-- Lanes (active swarm executions)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lanes (
    lane_id         TEXT PRIMARY KEY,
    plan_id         TEXT NOT NULL REFERENCES plans(plan_id),
    status          TEXT NOT NULL DEFAULT 'running',   -- running | paused | complete | failed
    started_at      REAL NOT NULL,
    last_heartbeat  REAL,
    budget_used     INTEGER DEFAULT 0,
    pr_url          TEXT
);

CREATE INDEX IF NOT EXISTS idx_lanes_plan ON lanes(plan_id);
CREATE INDEX IF NOT EXISTS idx_lanes_status ON lanes(status);

-- ---------------------------------------------------------------------------
-- Events (append-only, immutable)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS events (
    event_id    TEXT PRIMARY KEY,
    event_type  TEXT NOT NULL,
    plan_id     TEXT,
    lane_id     TEXT,
    agent_id    TEXT,
    payload     TEXT,                           -- JSON blob
    emitted_at  REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_type    ON events(event_type, emitted_at);
CREATE INDEX IF NOT EXISTS idx_events_plan    ON events(plan_id, emitted_at);
CREATE INDEX IF NOT EXISTS idx_events_lane    ON events(lane_id, emitted_at);

-- ---------------------------------------------------------------------------
-- Cues (operator → swarm, deduped by hash)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cues (
    cue_id      TEXT PRIMARY KEY,
    plan_id     TEXT,
    lane_id     TEXT,
    content     TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    posted_at   REAL NOT NULL,
    acked_at    REAL
);

CREATE INDEX IF NOT EXISTS idx_cues_plan ON cues(plan_id, acked_at, posted_at);
CREATE INDEX IF NOT EXISTS idx_cues_hash ON cues(content_hash);

-- ---------------------------------------------------------------------------
-- Handoffs (dev exit artifacts)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS handoffs (
    handoff_id      TEXT PRIMARY KEY,           -- {plan_id}:{subtask_id}:{sequence}
    plan_id         TEXT NOT NULL REFERENCES plans(plan_id) ON DELETE CASCADE,
    subtask_id      TEXT NOT NULL,
    sequence        INTEGER NOT NULL,
    status          TEXT NOT NULL,              -- complete | context_exhausted | blocked
    done            TEXT,                       -- JSON
    next_actions    TEXT,                       -- JSON list
    state_notes     TEXT,                       -- JSON list
    files_touched   TEXT,                       -- JSON list
    migrations_reserved TEXT,                   -- JSON list
    context_used    INTEGER,
    handoff_to      TEXT NOT NULL,              -- next_dev | qa_deploy | supervisor_reroute
    dod_checklist   TEXT,                       -- JSON: Definition of Done self-certification
    created_at      REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_handoffs_plan ON handoffs(plan_id, subtask_id, sequence);

-- ---------------------------------------------------------------------------
-- Interrupts (LangGraph thread pause/resume registry)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS interrupts (
    interrupt_id    TEXT PRIMARY KEY,
    plan_id         TEXT NOT NULL REFERENCES plans(plan_id) ON DELETE CASCADE,
    plan_path       TEXT,                               -- full relative path from repo root
    lane_id         TEXT,
    thread_id       TEXT NOT NULL,
    checkpoint_id   TEXT,
    reason          TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'active',   -- active | resumed | aborted
    payload         TEXT,                               -- JSON payload at resume time
    created_at      REAL NOT NULL,
    resumed_at      REAL
);

CREATE INDEX IF NOT EXISTS idx_interrupts_plan ON interrupts(plan_id, status);
CREATE INDEX IF NOT EXISTS idx_interrupts_thread ON interrupts(thread_id, status);
