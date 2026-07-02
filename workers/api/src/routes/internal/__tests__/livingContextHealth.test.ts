import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockD1, type BetterSqliteDb } from '../../../__tests__/helpers/mockD1';
import livingContextHealth from '../livingContextHealth';
import { Hono } from 'hono';

const livingContextMigration = readFileSync(
  new URL('../../../../migrations/0082_living_context_graph.sql', import.meta.url),
  'utf8',
);
const contextRecordsMigration = readFileSync(
  new URL('../../../../migrations/0095_context_records.sql', import.meta.url),
  'utf8',
);
const checkpointMigration = readFileSync(
  new URL('../../../../migrations/0106_backfill_checkpoints.sql', import.meta.url),
  'utf8',
);
const gatesMigration = readFileSync(
  new URL('../../../../migrations/0107_rollout_gates.sql', import.meta.url),
  'utf8',
);
const evaluationMigration = readFileSync(
  new URL('../../../../migrations/0093_matching_evaluation.sql', import.meta.url),
  'utf8',
);

function buildExecutionContext(): { ctx: ExecutionContext; waitUntilAll: () => Promise<void> } {
  const promises: Promise<unknown>[] = [];
  return {
    ctx: {
      waitUntil: (promise: Promise<unknown>) => {
        promises.push(promise);
      },
      passThroughOnException: () => {},
    } as unknown as ExecutionContext,
    waitUntilAll: async () => {
      await Promise.all(promises);
    },
  };
}

describe('GET /living-context-health', () => {
  let sqlite: BetterSqliteDb;

  beforeEach(() => {
    sqlite = new Database(':memory:');
  });

  afterEach(() => {
    sqlite.close();
  });

  it('reports healthy when all tables exist', async () => {
    sqlite.exec('PRAGMA foreign_keys = ON;');
    sqlite.exec('CREATE TABLE candidates (id TEXT PRIMARY KEY);');
    sqlite.exec('CREATE TABLE contacts (id TEXT PRIMARY KEY);');
    sqlite.exec(livingContextMigration);
    sqlite.exec(contextRecordsMigration);
    sqlite.exec(checkpointMigration);
    sqlite.exec(gatesMigration);

    const db = createMockD1(sqlite);
    const app = new Hono();
    app.route('/', livingContextHealth);

    const res = await app.request('/living-context-health', undefined, { DB: db });
    expect(res.status).toBe(200);

    const body = await res.json() as { healthy: boolean; subsystems: Array<{ name: string; healthy: boolean }> };
    expect(body.healthy).toBe(true);
    expect(body.subsystems.find((s) => s.name === 'required_tables')?.healthy).toBe(true);
  });

  it('reports unhealthy when tables are missing', async () => {
    const db = createMockD1(sqlite);
    const app = new Hono();
    app.route('/', livingContextHealth);

    const res = await app.request('/living-context-health', undefined, { DB: db });
    expect(res.status).toBe(200);

    const body = await res.json() as { healthy: boolean; subsystems: Array<{ name: string; healthy: boolean }> };
    expect(body.healthy).toBe(false);
    expect(body.subsystems.find((s) => s.name === 'required_tables')?.healthy).toBe(false);
  });
});

describe('POST /living-context-rebuild-projections', () => {
  let sqlite: BetterSqliteDb;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec('PRAGMA foreign_keys = ON;');
    sqlite.exec(livingContextMigration);
    sqlite.exec(contextRecordsMigration);
    sqlite.exec(checkpointMigration);
    sqlite.exec(gatesMigration);
  });

  afterEach(() => {
    sqlite.close();
  });

  it('queues rebuild jobs asynchronously by default', async () => {
    sqlite.exec(`
      INSERT INTO people (id, ingestion_key, created_at, updated_at)
      VALUES ('person-1', 'person:p1', datetime('now'), datetime('now'));
    `);
    sqlite.exec(`
      INSERT INTO people (id, ingestion_key, created_at, updated_at)
      VALUES ('person-2', 'person:p2', datetime('now'), datetime('now'));
    `);
    sqlite.exec(`
      INSERT INTO workspace_people (id, ingestion_key, workspace_id, person_id, created_at, updated_at)
      VALUES ('wp-1', 'wp:1', 'ws-1', 'person-1', datetime('now'), datetime('now'));
    `);
    sqlite.exec(`
      INSERT INTO workspace_people (id, ingestion_key, workspace_id, person_id, created_at, updated_at)
      VALUES ('wp-2', 'wp:2', 'ws-1', 'person-2', datetime('now'), datetime('now'));
    `);

    const db = createMockD1(sqlite);
    const app = new Hono();
    app.route('/', livingContextHealth);
    const { ctx, waitUntilAll } = buildExecutionContext();

    const res = await app.request('/living-context-rebuild-projections', {
      method: 'POST',
    }, { DB: db }, ctx);
    expect(res.status).toBe(202);

    const body = await res.json() as { status: string; mode: string };
    expect(body.status).toBe('queued');
    expect(body.mode).toBe('async');

    await waitUntilAll();

    const rows = sqlite.prepare(
      `SELECT aggregate_id, operation, status FROM projection_outbox WHERE operation = 'rebuild'`,
    ).all() as Array<{ aggregate_id: string; operation: string; status: string }>;
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.aggregate_id).sort()).toEqual(['wp-1', 'wp-2']);
    expect(rows.every((r) => r.status === 'pending')).toBe(true);
  });

  it('runs rebuild synchronously when waitForResult is requested', async () => {
    const db = createMockD1(sqlite);
    const app = new Hono();
    app.route('/', livingContextHealth);

    const res = await app.request('/living-context-rebuild-projections', {
      method: 'POST',
      body: JSON.stringify({ waitForResult: true }),
      headers: { 'Content-Type': 'application/json' },
    }, { DB: db });
    expect(res.status).toBe(200);

    const body = await res.json() as { status: string; enqueued: number };
    expect(body.status).toBe('scheduled');
    expect(body.enqueued).toBe(0);
  });

  it('reports rebuild scope in dry-run mode without enqueuing jobs', async () => {
    sqlite.exec(`
      INSERT INTO people (id, ingestion_key, created_at, updated_at)
      VALUES ('person-1', 'person:p1', datetime('now'), datetime('now'));
    `);
    sqlite.exec(`
      INSERT INTO people (id, ingestion_key, created_at, updated_at)
      VALUES ('person-2', 'person:p2', datetime('now'), datetime('now'));
    `);
    sqlite.exec(`
      INSERT INTO workspace_people (id, ingestion_key, workspace_id, person_id, created_at, updated_at)
      VALUES ('wp-1', 'wp:1', 'ws-1', 'person-1', datetime('now'), datetime('now'));
    `);
    sqlite.exec(`
      INSERT INTO workspace_people (id, ingestion_key, workspace_id, person_id, created_at, updated_at)
      VALUES ('wp-2', 'wp:2', 'ws-1', 'person-2', datetime('now'), datetime('now'));
    `);

    const db = createMockD1(sqlite);
    const app = new Hono();
    app.route('/', livingContextHealth);

    const res = await app.request('/living-context-rebuild-projections', {
      method: 'POST',
      body: JSON.stringify({ dryRun: true }),
      headers: { 'Content-Type': 'application/json' },
    }, { DB: db });
    expect(res.status).toBe(200);

    const body = await res.json() as { status: string; enqueued: number; wouldEnqueue: number };
    expect(body.status).toBe('dry_run');
    expect(body.enqueued).toBe(0);
    expect(body.wouldEnqueue).toBe(2);

    const rows = sqlite.prepare(
      `SELECT aggregate_id FROM projection_outbox WHERE operation = 'rebuild'`,
    ).all();
    expect(rows).toHaveLength(0);
  });
});

describe('GET /living-context-stats', () => {
  let sqlite: BetterSqliteDb;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec('PRAGMA foreign_keys = ON;');
    sqlite.exec('CREATE TABLE candidates (id TEXT PRIMARY KEY);');
    sqlite.exec('CREATE TABLE contacts (id TEXT PRIMARY KEY);');
    sqlite.exec(livingContextMigration);
    sqlite.exec(contextRecordsMigration);
    sqlite.exec(checkpointMigration);
    sqlite.exec(gatesMigration);
  });

  afterEach(() => {
    sqlite.close();
  });

  it('returns entity counts and breakdowns for a populated graph', async () => {
    sqlite.exec(`
      INSERT INTO people (id, ingestion_key, created_at, updated_at)
      VALUES ('p-1', 'person:p1', datetime('now'), datetime('now'));
    `);
    sqlite.exec(`
      INSERT INTO workspace_people (id, ingestion_key, workspace_id, person_id, created_at, updated_at)
      VALUES ('wp-1', 'wp:1', 'ws-1', 'p-1', datetime('now'), datetime('now'));
    `);
    sqlite.exec(`
      INSERT INTO interactions (id, ingestion_key, workspace_person_id, interaction_type, created_at, updated_at)
      VALUES ('i-1', 'int:1', 'wp-1', 'resume_upload', datetime('now'), datetime('now'));
    `);
    sqlite.exec(`
      INSERT INTO interactions (id, ingestion_key, workspace_person_id, interaction_type, created_at, updated_at)
      VALUES ('i-2', 'int:2', 'wp-1', 'meeting', datetime('now'), datetime('now'));
    `);
    sqlite.exec(`
      INSERT INTO artifacts (id, ingestion_key, interaction_id, artifact_type, created_at, updated_at)
      VALUES ('a-1', 'art:1', 'i-1', 'resume', datetime('now'), datetime('now'));
    `);

    const db = createMockD1(sqlite);
    const app = new Hono();
    app.route('/', livingContextHealth);

    const res = await app.request('/living-context-stats', undefined, { DB: db });
    expect(res.status).toBe(200);

    const body = await res.json() as {
      entities: Record<string, number>;
      interactionBreakdown: Record<string, number>;
      artifactBreakdown: Record<string, number>;
    };

    expect(body.entities.people).toBe(1);
    expect(body.entities.workspacePeople).toBe(1);
    expect(body.entities.interactions).toBe(2);
    expect(body.entities.artifacts).toBe(1);
    expect(body.interactionBreakdown).toEqual({
      resume_upload: 1,
      meeting: 1,
    });
    expect(body.artifactBreakdown).toEqual({ resume: 1 });
  });

  it('returns zero counts on empty graph', async () => {
    const db = createMockD1(sqlite);
    const app = new Hono();
    app.route('/', livingContextHealth);

    const res = await app.request('/living-context-stats', undefined, { DB: db });
    expect(res.status).toBe(200);

    const body = await res.json() as { entities: Record<string, number> };
    expect(body.entities.people).toBe(0);
    expect(body.entities.interactions).toBe(0);
  });
});

describe('GET /living-context-backfill', () => {
  let sqlite: BetterSqliteDb;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec('PRAGMA foreign_keys = ON;');
    sqlite.exec(checkpointMigration);
  });

  afterEach(() => {
    sqlite.close();
  });

  it('returns per-task checkpoint detail', async () => {
    sqlite.exec(`
      INSERT INTO backfill_checkpoints (id, ingestion_key, task_key, status, processed, failed, metadata_json, created_at, updated_at)
      VALUES ('cp-1', 'backfill:candidates_to_living_context', 'candidates_to_living_context', 'completed', 42, 0,
              '{"description":"Backfill candidates","dependsOn":[]}',
              datetime('now', '-10 minutes'), datetime('now'));
    `);
    sqlite.exec(`
      INSERT INTO backfill_checkpoints (id, ingestion_key, task_key, status, processed, failed, total_items, metadata_json, started_at, created_at, updated_at)
      VALUES ('cp-2', 'backfill:resumes_to_living_context', 'resumes_to_living_context', 'running', 15, 2, 50,
              '{"description":"Backfill resumes","dependsOn":["candidates_to_living_context"]}',
              datetime('now', '-5 minutes'), datetime('now', '-5 minutes'), datetime('now'));
    `);

    const db = createMockD1(sqlite);
    const app = new Hono();
    app.route('/', livingContextHealth);

    const res = await app.request('/living-context-backfill', undefined, { DB: db });
    expect(res.status).toBe(200);

    const body = await res.json() as {
      overallStatus: string;
      totalTasks: number;
      completedCount: number;
      runningCount: number;
      failedCount: number;
      tasks: Array<{
        taskKey: string;
        status: string;
        processed: number;
        failed: number;
        progressPercent: number | null;
        description: string | null;
        dependsOn: string[];
      }>;
    };

    expect(body.overallStatus).toBe('running');
    expect(body.totalTasks).toBe(2);
    expect(body.completedCount).toBe(1);
    expect(body.runningCount).toBe(1);

    const candidatesTask = body.tasks.find((t) => t.taskKey === 'candidates_to_living_context');
    expect(candidatesTask?.status).toBe('completed');
    expect(candidatesTask?.processed).toBe(42);
    expect(candidatesTask?.dependsOn).toEqual([]);

    const resumesTask = body.tasks.find((t) => t.taskKey === 'resumes_to_living_context');
    expect(resumesTask?.status).toBe('running');
    expect(resumesTask?.processed).toBe(15);
    expect(resumesTask?.failed).toBe(2);
    expect(resumesTask?.progressPercent).toBe(30);
    expect(resumesTask?.dependsOn).toEqual(['candidates_to_living_context']);
  });

  it('returns unavailable when table does not exist', async () => {
    const emptySqlite = new Database(':memory:');
    const db = createMockD1(emptySqlite);
    const app = new Hono();
    app.route('/', livingContextHealth);

    const res = await app.request('/living-context-backfill', undefined, { DB: db });
    expect(res.status).toBe(200);

    const body = await res.json() as { overallStatus: string; error: string };
    expect(body.overallStatus).toBe('unavailable');
    expect(body.error).toBeTruthy();

    emptySqlite.close();
  });
});

describe('POST /living-context-backfill-trigger', () => {
  let sqlite: BetterSqliteDb;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec('PRAGMA foreign_keys = ON;');
    sqlite.exec(livingContextMigration);
    sqlite.exec(contextRecordsMigration);
    sqlite.exec(checkpointMigration);
    sqlite.exec(gatesMigration);
  });

  afterEach(() => {
    sqlite.close();
  });

  it('queues a backfill run asynchronously by default', async () => {
    const db = createMockD1(sqlite);
    const app = new Hono();
    app.route('/', livingContextHealth);
    const { ctx, waitUntilAll } = buildExecutionContext();

    const res = await app.request('/living-context-backfill-trigger', {
      method: 'POST',
    }, { DB: db }, ctx);
    expect(res.status).toBe(202);

    const body = await res.json() as {
      status: string;
      mode: string;
      registeredTasks: Array<{ taskKey: string }>;
    };
    expect(body.status).toBe('queued');
    expect(body.mode).toBe('async');
    expect(body.registeredTasks.length).toBeGreaterThan(0);

    await waitUntilAll();
  });

  it('returns a dry-run plan without creating checkpoints or running tasks', async () => {
    const db = createMockD1(sqlite);
    const app = new Hono();
    app.route('/', livingContextHealth);

    const res = await app.request('/living-context-backfill-trigger', {
      method: 'POST',
      body: JSON.stringify({ dryRun: true }),
      headers: { 'Content-Type': 'application/json' },
    }, { DB: db });
    expect(res.status).toBe(200);

    const body = await res.json() as {
      dryRun: boolean;
      gateEnabled: boolean;
      gateStage: string;
      tasksWouldExecute: string[];
      registeredTasks: Array<{ taskKey: string }>;
    };

    expect(body.dryRun).toBe(true);
    expect(body.gateEnabled).toBe(false);
    expect(body.gateStage).toBe('disabled');
    expect(body.tasksWouldExecute).toEqual([]);
    expect(body.registeredTasks.length).toBeGreaterThan(0);

    const checkpointCount = sqlite.prepare(
      `SELECT COUNT(*) AS cnt FROM backfill_checkpoints`,
    ).get() as { cnt: number };
    expect(checkpointCount.cnt).toBe(0);
  });
});

describe('GET /living-context-integrity', () => {
  let sqlite: BetterSqliteDb;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec('PRAGMA foreign_keys = ON;');
    sqlite.exec('CREATE TABLE candidates (id TEXT PRIMARY KEY);');
    sqlite.exec('CREATE TABLE contacts (id TEXT PRIMARY KEY);');
    sqlite.exec(livingContextMigration);
    sqlite.exec(contextRecordsMigration);
    sqlite.exec(checkpointMigration);
    sqlite.exec(gatesMigration);
  });

  afterEach(() => {
    sqlite.close();
  });

  it('reports all checks passed on a healthy graph', async () => {
    sqlite.exec(`
      INSERT INTO people (id, ingestion_key, created_at, updated_at)
      VALUES ('p-1', 'person:p1', datetime('now'), datetime('now'));
    `);
    sqlite.exec(`
      INSERT INTO workspace_people (id, ingestion_key, workspace_id, person_id, created_at, updated_at)
      VALUES ('wp-1', 'wp:1', 'ws-1', 'p-1', datetime('now'), datetime('now'));
    `);
    sqlite.exec(`
      INSERT INTO interactions (id, ingestion_key, workspace_person_id, interaction_type, created_at, updated_at)
      VALUES ('i-1', 'int:1', 'wp-1', 'resume_upload', datetime('now'), datetime('now'));
    `);
    sqlite.exec(`
      INSERT INTO episodes (id, ingestion_key, workspace_person_id, interaction_id, created_at, updated_at)
      VALUES ('ep-1', 'ep:1', 'wp-1', 'i-1', datetime('now'), datetime('now'));
    `);
    sqlite.exec(`
      INSERT INTO artifacts (id, ingestion_key, interaction_id, artifact_type, created_at, updated_at)
      VALUES ('a-1', 'art:1', 'i-1', 'resume', datetime('now'), datetime('now'));
    `);
    sqlite.exec(`
      INSERT INTO artifact_versions (id, ingestion_key, artifact_id, version_number, content_hash, media_type, content_text, created_at)
      VALUES ('av-1', 'av:1', 'a-1', 1, 'hash1', 'text/plain', 'Some resume text content', datetime('now'));
    `);
    sqlite.exec(`
      INSERT INTO source_spans (id, ingestion_key, artifact_version_id, exact_text, exact_text_hash, created_at)
      VALUES ('ss-1', 'ss:1', 'av-1', 'Some resume text content', 'hash-ss1', datetime('now'));
    `);
    sqlite.exec(`
      INSERT INTO semantic_assertions (id, ingestion_key, workspace_person_id, episode_id, subject_type, predicate, narrative, created_at, updated_at)
      VALUES ('sa-1', 'sa:1', 'wp-1', 'ep-1', 'skill', 'has_skill', 'Has TypeScript', datetime('now'), datetime('now'));
    `);
    sqlite.exec(`
      INSERT INTO assertion_source_spans (assertion_id, source_span_id, evidence_role, created_at)
      VALUES ('sa-1', 'ss-1', 'primary', datetime('now'));
    `);
    sqlite.exec(`
      INSERT INTO context_records (id, ingestion_key, scope_type, scope_id, workspace_person_id, interaction_id, record_type, narrative, created_at, updated_at)
      VALUES ('cr-1', 'cr:1', 'workspace_person', 'wp-1', 'wp-1', 'i-1', 'skill', 'TypeScript experience', datetime('now'), datetime('now'));
    `);
    sqlite.exec(`
      INSERT INTO context_record_source_refs (context_record_id, source_ref_type, source_ref_id, source_span_id, evidence_role, locator_json, metadata_json, created_at)
      VALUES ('cr-1', 'source_span', 'ss-1', 'ss-1', 'primary', '{}', '{}', datetime('now'));
    `);

    const db = createMockD1(sqlite);
    const app = new Hono();
    app.route('/', livingContextHealth);

    const res = await app.request('/living-context-integrity', undefined, { DB: db });
    expect(res.status).toBe(200);

    const body = await res.json() as {
      healthy: boolean;
      totalChecks: number;
      passed: number;
      failed: number;
      checks: Array<{ name: string; passed: boolean; count: number }>;
    };
    expect(body.healthy).toBe(true);
    expect(body.passed).toBe(body.totalChecks);
    expect(body.failed).toBe(0);
  });

  it('detects assertions without source spans', async () => {
    sqlite.exec(`
      INSERT INTO people (id, ingestion_key, created_at, updated_at)
      VALUES ('p-1', 'person:p1', datetime('now'), datetime('now'));
    `);
    sqlite.exec(`
      INSERT INTO workspace_people (id, ingestion_key, workspace_id, person_id, created_at, updated_at)
      VALUES ('wp-1', 'wp:1', 'ws-1', 'p-1', datetime('now'), datetime('now'));
    `);
    sqlite.exec(`
      INSERT INTO semantic_assertions (id, ingestion_key, workspace_person_id, subject_type, predicate, narrative, created_at, updated_at)
      VALUES ('sa-orphan', 'sa:orphan', 'wp-1', 'skill', 'has_skill', 'Orphaned assertion', datetime('now'), datetime('now'));
    `);

    const db = createMockD1(sqlite);
    const app = new Hono();
    app.route('/', livingContextHealth);

    const res = await app.request('/living-context-integrity', undefined, { DB: db });
    expect(res.status).toBe(200);

    const body = await res.json() as {
      healthy: boolean;
      checks: Array<{ name: string; passed: boolean; count: number }>;
    };
    expect(body.healthy).toBe(false);

    const assertionCheck = body.checks.find((c) => c.name === 'assertions_with_source_spans');
    expect(assertionCheck?.passed).toBe(false);
    expect(assertionCheck?.count).toBe(1);
  });

  it('reports healthy on empty graph', async () => {
    const db = createMockD1(sqlite);
    const app = new Hono();
    app.route('/', livingContextHealth);

    const res = await app.request('/living-context-integrity', undefined, { DB: db });
    expect(res.status).toBe(200);

    const body = await res.json() as { healthy: boolean };
    expect(body.healthy).toBe(true);
  });
});

describe('GET /evaluation-readiness', () => {
  let sqlite: BetterSqliteDb;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec('PRAGMA foreign_keys = ON;');
    sqlite.exec('CREATE TABLE candidates (id TEXT PRIMARY KEY);');
    sqlite.exec('CREATE TABLE contacts (id TEXT PRIMARY KEY);');
    sqlite.exec(livingContextMigration);
    sqlite.exec(contextRecordsMigration);
    sqlite.exec(checkpointMigration);
    sqlite.exec(gatesMigration);
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS evaluation_corpora (
        corpus_id TEXT PRIMARY KEY,
        corpus_json TEXT NOT NULL,
        expert_label_count INTEGER NOT NULL DEFAULT 0,
        synthetic_fixture_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS evaluation_results (
        id TEXT PRIMARY KEY,
        corpus_id TEXT NOT NULL REFERENCES evaluation_corpora(corpus_id),
        metrics_json TEXT NOT NULL,
        corpus_json TEXT NOT NULL,
        result_json TEXT NOT NULL,
        passed INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        FOREIGN KEY (corpus_id) REFERENCES evaluation_corpora(corpus_id)
      );
    `);
  });

  afterEach(() => {
    sqlite.close();
  });

  it('returns 400 when corpusId is missing', async () => {
    const db = createMockD1(sqlite);
    const app = new Hono();
    app.route('/', livingContextHealth);

    const res = await app.request('/evaluation-readiness', undefined, { DB: db });
    expect(res.status).toBe(400);

    const body = await res.json() as { ok: boolean; reason: string };
    expect(body.ok).toBe(false);
    expect(body.reason).toContain('corpusId');
  });

  it('returns not ready when no evaluation result exists', async () => {
    const db = createMockD1(sqlite);
    const app = new Hono();
    app.route('/', livingContextHealth);

    const res = await app.request('/evaluation-readiness?corpusId=test-corpus', undefined, { DB: db });
    expect(res.status).toBe(200);

    const body = await res.json() as { ready: boolean; failures: string[]; reportText: string };
    expect(body.ready).toBe(false);
    expect(body.failures.length).toBeGreaterThan(0);
    expect(body.reportText).toContain('NO');
  });

  it('returns 400 for invalid stage', async () => {
    const db = createMockD1(sqlite);
    const app = new Hono();
    app.route('/', livingContextHealth);

    const res = await app.request('/evaluation-readiness?corpusId=test-corpus&stage=bogus', undefined, { DB: db });
    expect(res.status).toBe(400);

    const body = await res.json() as { ok: boolean; reason: string };
    expect(body.ok).toBe(false);
    expect(body.reason).toContain('Invalid stage');
  });
});

function setupEvaluationCorpusSeedSchema(sqlite: BetterSqliteDb): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS match_runs (
      id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL,
      application_id TEXT,
      role_context_id TEXT,
      role_snapshot_id TEXT NOT NULL DEFAULT 'standalone-code-review-v1',
      candidate_snapshot_id TEXT NOT NULL,
      policy_version TEXT NOT NULL DEFAULT '1.0.0',
      model_version TEXT,
      status TEXT NOT NULL,
      selected_packet_id TEXT,
      ranked_results_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS people (
      id TEXT PRIMARY KEY,
      display_name TEXT,
      primary_email TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS workspace_people (
      id TEXT PRIMARY KEY,
      person_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL DEFAULT 'ws-1',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS applications (
      id TEXT PRIMARY KEY,
      workspace_person_id TEXT NOT NULL,
      legacy_candidate_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS interactions (
      id TEXT PRIMARY KEY,
      workspace_person_id TEXT NOT NULL,
      interaction_type TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY,
      interaction_id TEXT,
      artifact_type TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS artifact_versions (
      id TEXT PRIMARY KEY,
      artifact_id TEXT NOT NULL,
      version_number INTEGER NOT NULL DEFAULT 1,
      content_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS source_spans (
      id TEXT PRIMARY KEY,
      artifact_version_id TEXT NOT NULL,
      exact_text TEXT NOT NULL,
      byte_start INTEGER,
      byte_end INTEGER,
      char_start INTEGER,
      char_end INTEGER,
      line_start INTEGER,
      line_end INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS episodes (
      id TEXT PRIMARY KEY,
      workspace_person_id TEXT NOT NULL,
      interaction_id TEXT,
      narrative TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS semantic_assertions (
      id TEXT PRIMARY KEY,
      episode_id TEXT,
      narrative TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS assertion_source_spans (
      assertion_id TEXT NOT NULL,
      source_span_id TEXT NOT NULL,
      PRIMARY KEY (assertion_id, source_span_id)
    );

    CREATE TABLE IF NOT EXISTS concepts (
      id TEXT PRIMARY KEY,
      canonical_key TEXT NOT NULL UNIQUE,
      namespace TEXT NOT NULL DEFAULT 'open',
      label TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS assertion_concepts (
      assertion_id TEXT NOT NULL,
      concept_id TEXT NOT NULL,
      PRIMARY KEY (assertion_id, concept_id)
    );

    CREATE TABLE IF NOT EXISTS role_context_documents (
      id TEXT PRIMARY KEY,
      required_languages_json TEXT,
      relevant_concepts_json TEXT,
      required_concepts_json TEXT,
      forbidden_concepts_json TEXT
    );

    CREATE TABLE IF NOT EXISTS role_source_references (
      id TEXT PRIMARY KEY,
      role_context_id TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      locator TEXT NOT NULL,
      concept_keys_json TEXT NOT NULL DEFAULT '[]',
      source_ref_type TEXT NOT NULL,
      source_ref_id TEXT NOT NULL,
      exact_text TEXT NOT NULL,
      content_hash TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS review_challenge_packets (
      id TEXT PRIMARY KEY,
      repo_id TEXT NOT NULL,
      pr_number INTEGER NOT NULL,
      source_version TEXT NOT NULL,
      content_hash TEXT,
      demands_json TEXT
    );
  `);
  sqlite.exec(evaluationMigration);
}

function seedEvaluationCorpusRouteData(sqlite: BetterSqliteDb): void {
  sqlite.exec(`
    INSERT INTO people (id, display_name, primary_email)
    VALUES ('person-seed-1', 'Seed Candidate', 'seed@test.dev');

    INSERT INTO workspace_people (id, person_id, workspace_id)
    VALUES ('wp-seed-1', 'person-seed-1', 'ws-1');

    INSERT INTO applications (id, workspace_person_id, legacy_candidate_id)
    VALUES ('app-seed-1', 'wp-seed-1', 'candidate-seed-1');

    INSERT INTO interactions (id, workspace_person_id, interaction_type)
    VALUES ('interaction-seed-1', 'wp-seed-1', 'resume_upload');

    INSERT INTO artifacts (id, interaction_id, artifact_type)
    VALUES ('artifact-seed-1', 'interaction-seed-1', 'resume');

    INSERT INTO artifact_versions (id, artifact_id, version_number, content_hash)
    VALUES ('artifact-version-seed-1', 'artifact-seed-1', 1, 'sha256:candidate-seed');

    INSERT INTO source_spans (id, artifact_version_id, exact_text, char_start, char_end)
    VALUES ('span-seed-1', 'artifact-version-seed-1', 'Reviewed React popover trigger regressions with TypeScript tests', 0, 63);

    INSERT INTO episodes (id, workspace_person_id, interaction_id, narrative)
    VALUES ('episode-seed-1', 'wp-seed-1', 'interaction-seed-1', 'Resume evidence');

    INSERT INTO semantic_assertions (id, episode_id, narrative)
    VALUES ('assertion-seed-1', 'episode-seed-1', 'Demonstrates React TypeScript review judgement');

    INSERT INTO assertion_source_spans (assertion_id, source_span_id)
    VALUES ('assertion-seed-1', 'span-seed-1');

    INSERT INTO concepts (id, canonical_key, namespace, label)
    VALUES ('concept-seed-1', 'term:react-popover', 'open', 'React popover');

    INSERT INTO assertion_concepts (assertion_id, concept_id)
    VALUES ('assertion-seed-1', 'concept-seed-1');

    INSERT INTO role_context_documents (id, required_languages_json, relevant_concepts_json)
    VALUES ('role-seed-1', '["typescript"]', '["term:react-popover"]');

    INSERT INTO role_source_references (
      id, role_context_id, entity_id, locator, concept_keys_json,
      source_ref_type, source_ref_id, exact_text, content_hash
    )
    VALUES (
      'role-ref-seed-1', 'role-seed-1', 'role-seed-1', 'requirements',
      '["term:react-popover"]', 'role_context', 'role-ref-seed-1',
      'Needs React popover review judgement', 'sha256:role-seed'
    );

    INSERT INTO review_challenge_packets (
      id, repo_id, pr_number, source_version, content_hash, demands_json
    )
    VALUES (
      'packet-seed-1', 'mui/base-ui', 973, 'v1', 'sha256:packet-seed',
      '[{"demandId":"demand-seed-1","concepts":["term:react-popover"],"sourceRefs":[{"artifactId":"repo-artifact-seed","artifactVersion":"repo-version-seed","contentHash":"sha256:repo-seed","sourceRefType":"repo_span","sourceRefId":"repo-span-seed","exactText":"Popover trigger regression source","startOffset":0,"endOffset":33}]}]'
    );
  `);

  sqlite.prepare(
    `INSERT INTO match_runs (
       id, candidate_id, role_context_id, candidate_snapshot_id, role_snapshot_id,
       policy_version, status, selected_packet_id, ranked_results_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    'match-run-seed-1',
    'candidate-seed-1',
    'role-seed-1',
    'candidate-snapshot-seed-1',
    'standalone-code-review-v1',
    '1.0.0',
    'MATCHED',
    'packet-seed-1',
    JSON.stringify([{
      rank: 1,
      recallRank: 1,
      challengeId: 'packet-seed-1',
      repoId: 'mui/base-ui',
      prNumber: 973,
      sourceVersion: 'v1',
      score: 0.86,
      candidateEvidenceAlignment: 0.9,
      roleRelevance: 0.85,
      contextualSpecificity: 0.8,
      challengeQuality: 0.9,
      validationDeepeningValue: 0.7,
      alignedDemandCount: 1,
      stretchCount: 0,
      stretchDemandWeightRatio: 0,
      provenanceComplete: true,
      eligible: true,
      alignments: [],
      rejectionReasons: [],
    }]),
  );
}

describe('POST /evaluation-corpus-seed', () => {
  let sqlite: BetterSqliteDb;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec('PRAGMA foreign_keys = ON;');
    setupEvaluationCorpusSeedSchema(sqlite);
    seedEvaluationCorpusRouteData(sqlite);
  });

  afterEach(() => {
    sqlite.close();
  });

  it('returns draft label readiness instead of implying a production expert corpus', async () => {
    const db = createMockD1(sqlite);
    const app = new Hono();
    app.route('/', livingContextHealth);

    const res = await app.request('/evaluation-corpus-seed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit: 1 }),
    }, { DB: db });
    expect(res.status).toBe(200);

    const body = await res.json() as {
      corpusId: string;
      corpusHash: string | null;
      persisted: boolean;
      labelCount: number;
      draftLabelCount: number;
      expertLabelCount: number;
      syntheticFixtureCount: number;
      productionReady: boolean;
      nextAction: string;
    };
    expect(body.persisted).toBe(true);
    expect(body.corpusId).toMatch(/^seeded-/);
    expect(body.corpusHash).toMatch(/^[a-f0-9]{64}$/);
    expect(body.labelCount).toBe(1);
    expect(body.draftLabelCount).toBe(1);
    expect(body.expertLabelCount).toBe(0);
    expect(body.syntheticFixtureCount).toBe(0);
    expect(body.productionReady).toBe(false);
    expect(body.nextAction).toBe('attach_expert_label_provenance');
  });

  it('exports a compact review packet for a seeded draft corpus', async () => {
    const db = createMockD1(sqlite);
    const app = new Hono();
    app.route('/', livingContextHealth);

    const seedRes = await app.request('/evaluation-corpus-seed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit: 1 }),
    }, { DB: db });
    expect(seedRes.status).toBe(200);
    const seedBody = await seedRes.json() as { corpusId: string };

    const res = await app.request(
      `/evaluation-corpus-review-packet?corpusId=${encodeURIComponent(seedBody.corpusId)}`,
      undefined,
      { DB: db },
    );
    expect(res.status).toBe(200);

    const body = await res.json() as {
      ok: boolean;
      corpusHash: string;
      reviewPacket: {
        productionReady: boolean;
        productionReadinessFailures: string[];
        items: Array<{
          labelId: string;
          draft: { labeledBy: string; relevanceGrade: string };
          candidateEvidence: Array<{ narrative: string; evidenceReferences: unknown[] }>;
          roleRequirements: { sourceReferences: unknown[] } | null;
          expectedPacket: { repoId: string; prNumber: number; demands: Array<{ sourceRefs: unknown[] }> } | null;
        }>;
      };
    };
    expect(body.ok).toBe(true);
    expect(body.corpusHash).toMatch(/^[a-f0-9]{64}$/);
    expect(body.reviewPacket.productionReady).toBe(false);
    expect(body.reviewPacket.productionReadinessFailures).toContain(
      'expert label is missing reviewer/source provenance: seeded-match-run-seed-1-packet-seed-1',
    );
    expect(body.reviewPacket.items).toHaveLength(1);
    expect(body.reviewPacket.items[0]!.draft.labeledBy).toBe('corpus-seeder');
    expect(body.reviewPacket.items[0]!.candidateEvidence[0]!.narrative).toContain('React TypeScript');
    expect(body.reviewPacket.items[0]!.candidateEvidence[0]!.evidenceReferences).toHaveLength(1);
    expect(body.reviewPacket.items[0]!.roleRequirements!.sourceReferences).toHaveLength(1);
    expect(body.reviewPacket.items[0]!.expectedPacket).toMatchObject({
      repoId: 'mui/base-ui',
      prNumber: 973,
    });
    expect(body.reviewPacket.items[0]!.expectedPacket!.demands[0]!.sourceRefs).toHaveLength(1);
  });

  it('persists expert review as a new frozen corpus with reviewer provenance', async () => {
    const db = createMockD1(sqlite);
    const app = new Hono();
    app.route('/', livingContextHealth);

    const seedRes = await app.request('/evaluation-corpus-seed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit: 1 }),
    }, { DB: db });
    expect(seedRes.status).toBe(200);
    const seedBody = await seedRes.json() as { corpusId: string; corpusHash: string };

    const res = await app.request('/evaluation-corpus-expert-review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceCorpusId: seedBody.corpusId,
        reviewedCorpusId: 'reviewed-seed-corpus-1',
        reviewerId: 'expert-reviewer-1',
        reviewerRole: 'principal-engineer',
        reviewArtifactId: 'review-artifact-1',
        reviewArtifactVersion: 'v1',
        rubricVersion: 'match-rubric-v1',
        reviewedAt: '2026-07-02T20:00:00.000Z',
        labels: [{
          labelId: 'seeded-match-run-seed-1-packet-seed-1',
          relevanceGrade: 'highly_relevant',
          eligibleChallengeIds: ['packet-seed-1'],
          explanation: 'Candidate React popover review evidence directly maps to the source-backed Base UI PR demand.',
        }],
      }),
    }, { DB: db });
    expect(res.status).toBe(200);

    const body = await res.json() as {
      ok: boolean;
      sourceCorpusId: string;
      sourceCorpusHash: string;
      reviewedCorpusId: string;
      corpusHash: string;
      persisted: boolean;
      expertLabelCount: number;
      syntheticFixtureCount: number;
      productionReady: boolean;
      productionReadinessFailures: string[];
      nextAction: string;
    };
    expect(body.ok).toBe(true);
    expect(body.sourceCorpusId).toBe(seedBody.corpusId);
    expect(body.sourceCorpusHash).toBe(seedBody.corpusHash);
    expect(body.reviewedCorpusId).toBe('reviewed-seed-corpus-1');
    expect(body.corpusHash).toMatch(/^[a-f0-9]{64}$/);
    expect(body.persisted).toBe(true);
    expect(body.expertLabelCount).toBe(1);
    expect(body.syntheticFixtureCount).toBe(0);
    expect(body.productionReady).toBe(true);
    expect(body.productionReadinessFailures).toEqual([]);
    expect(body.nextAction).toBe('run_evaluation');

    const rows = sqlite.prepare(
      `SELECT corpus_id, expert_label_count, corpus_json
         FROM evaluation_corpora
        ORDER BY corpus_id`,
    ).all() as Array<{ corpus_id: string; expert_label_count: number; corpus_json: string }>;
    expect(rows.map((row) => row.corpus_id).sort()).toEqual([
      'reviewed-seed-corpus-1',
      seedBody.corpusId,
    ].sort());
    const draftRow = rows.find((row) => row.corpus_id === seedBody.corpusId)!;
    const reviewedRow = rows.find((row) => row.corpus_id === 'reviewed-seed-corpus-1')!;
    expect(draftRow.expert_label_count).toBe(0);
    expect(reviewedRow.expert_label_count).toBe(1);

    const reviewedCorpus = JSON.parse(reviewedRow.corpus_json) as {
      expertLabels: Array<{
        labeledBy: string;
        labelProvenance: { reviewerId: string; contentHash: string; locator: string };
      }>;
    };
    expect(reviewedCorpus.expertLabels[0]!.labeledBy).toBe('expert-reviewer-1');
    expect(reviewedCorpus.expertLabels[0]!.labelProvenance).toMatchObject({
      reviewerId: 'expert-reviewer-1',
      locator: 'review-artifact-1#seeded-match-run-seed-1-packet-seed-1',
    });
    expect(reviewedCorpus.expertLabels[0]!.labelProvenance.contentHash).toMatch(/^sha256:/);
  });

  it('can dry-run expert review without writing a reviewed corpus row', async () => {
    const db = createMockD1(sqlite);
    const app = new Hono();
    app.route('/', livingContextHealth);

    const seedRes = await app.request('/evaluation-corpus-seed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit: 1 }),
    }, { DB: db });
    expect(seedRes.status).toBe(200);
    const seedBody = await seedRes.json() as { corpusId: string };

    const res = await app.request('/evaluation-corpus-expert-review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceCorpusId: seedBody.corpusId,
        reviewedCorpusId: 'reviewed-dry-run-corpus-1',
        reviewerId: 'expert-reviewer-1',
        reviewArtifactId: 'review-artifact-1',
        reviewArtifactVersion: 'v1',
        rubricVersion: 'match-rubric-v1',
        dryRun: true,
        labels: [{
          labelId: 'seeded-match-run-seed-1-packet-seed-1',
          relevanceGrade: 'highly_relevant',
          eligibleChallengeIds: ['packet-seed-1'],
          explanation: 'Dry run confirms this label would become production-ready without persisting it.',
        }],
      }),
    }, { DB: db });
    expect(res.status).toBe(200);

    const body = await res.json() as {
      ok: boolean;
      reviewedCorpusId: string;
      corpusHash: string;
      persisted: boolean;
      dryRun: boolean;
      productionReady: boolean;
    };
    expect(body.ok).toBe(true);
    expect(body.reviewedCorpusId).toBe('reviewed-dry-run-corpus-1');
    expect(body.corpusHash).toMatch(/^[a-f0-9]{64}$/);
    expect(body.persisted).toBe(false);
    expect(body.dryRun).toBe(true);
    expect(body.productionReady).toBe(true);

    const reviewedRow = sqlite.prepare(
      `SELECT corpus_id FROM evaluation_corpora WHERE corpus_id = 'reviewed-dry-run-corpus-1'`,
    ).get();
    expect(reviewedRow).toBeUndefined();
  });

  it('reports repeated expert review persistence idempotently for the same reviewed corpus', async () => {
    const db = createMockD1(sqlite);
    const app = new Hono();
    app.route('/', livingContextHealth);

    const seedRes = await app.request('/evaluation-corpus-seed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit: 1 }),
    }, { DB: db });
    expect(seedRes.status).toBe(200);
    const seedBody = await seedRes.json() as { corpusId: string };

    const reviewBody = {
      sourceCorpusId: seedBody.corpusId,
      reviewedCorpusId: 'reviewed-idempotent-corpus-1',
      reviewerId: 'expert-reviewer-1',
      reviewArtifactId: 'review-artifact-1',
      reviewArtifactVersion: 'v1',
      rubricVersion: 'match-rubric-v1',
      reviewedAt: '2026-07-02T20:00:00.000Z',
      labels: [{
        labelId: 'seeded-match-run-seed-1-packet-seed-1',
        relevanceGrade: 'highly_relevant',
        eligibleChallengeIds: ['packet-seed-1'],
        explanation: 'Repeated review confirms idempotent corpus persistence.',
      }],
    };

    const firstRes = await app.request('/evaluation-corpus-expert-review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reviewBody),
    }, { DB: db });
    expect(firstRes.status).toBe(200);
    const firstBody = await firstRes.json() as { corpusHash: string; persisted: boolean };
    expect(firstBody.persisted).toBe(true);

    const secondRes = await app.request('/evaluation-corpus-expert-review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reviewBody),
    }, { DB: db });
    expect(secondRes.status).toBe(200);
    const secondBody = await secondRes.json() as { corpusHash: string; persisted: boolean };
    expect(secondBody.persisted).toBe(false);
    expect(secondBody.corpusHash).toBe(firstBody.corpusHash);

    const count = sqlite.prepare(
      `SELECT COUNT(*) AS count FROM evaluation_corpora WHERE corpus_id = 'reviewed-idempotent-corpus-1'`,
    ).get() as { count: number };
    expect(count.count).toBe(1);
  });
});

describe('POST /person-identity-link', () => {
  let sqlite: BetterSqliteDb;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec('PRAGMA foreign_keys = ON;');
    sqlite.exec(`
      CREATE TABLE candidates (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        pipeline_id TEXT,
        name TEXT,
        email TEXT,
        status TEXT NOT NULL
      );
      CREATE TABLE contacts (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        name TEXT,
        email TEXT,
        phone TEXT,
        company TEXT,
        role TEXT,
        type TEXT NOT NULL
      );
    `);
    sqlite.exec(livingContextMigration);
    sqlite.exec(contextRecordsMigration);
    sqlite.exec(checkpointMigration);
    sqlite.exec(gatesMigration);
  });

  afterEach(() => {
    sqlite.close();
  });

  it('returns 400 when contactId or candidateId is missing', async () => {
    const db = createMockD1(sqlite);
    const app = new Hono();
    app.route('/', livingContextHealth);

    const res = await app.request('/person-identity-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }, { DB: db });
    expect(res.status).toBe(400);
  });

  it('returns 404 when contact does not exist', async () => {
    sqlite.exec(`
      INSERT INTO candidates (id, owner_id, name, email, status)
      VALUES ('cand-link-1', 'owner-1', 'Alice', 'alice@test.dev', 'active');
    `);
    const db = createMockD1(sqlite);
    const app = new Hono();
    app.route('/', livingContextHealth);

    const res = await app.request('/person-identity-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contactId: 'nonexistent', candidateId: 'cand-link-1' }),
    }, { DB: db });
    expect(res.status).toBe(404);
  });

  it('links a contact and candidate to the same person node', async () => {
    sqlite.exec(`
      INSERT INTO candidates (id, owner_id, name, email, status)
      VALUES ('cand-link-2', 'owner-1', 'Alice Candidate', 'alice-cand@test.dev', 'active');
      INSERT INTO contacts (id, owner_id, name, email, type)
      VALUES ('cont-link-2', 'owner-1', 'Alice Contact', 'alice-cont@different.dev', 'lead');
    `);
    const db = createMockD1(sqlite);
    const app = new Hono();
    app.route('/', livingContextHealth);

    const res = await app.request('/person-identity-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contactId: 'cont-link-2', candidateId: 'cand-link-2' }),
    }, { DB: db });
    expect(res.status).toBe(200);

    const body = await res.json() as {
      linked: boolean;
      alreadyLinked: boolean;
      personId: string;
      mergedWorkspacePersonId: string;
      targetWorkspacePersonId: string;
    };
    expect(body.linked).toBe(true);
    expect(body.alreadyLinked).toBe(false);
    expect(body.personId).toBeTruthy();

    // The contact's workspace person should be merged (deleted)
    const mergedWp = sqlite.prepare(
      `SELECT id FROM workspace_people WHERE id = ?`,
    ).get(body.mergedWorkspacePersonId) as { id: string } | undefined;
    expect(mergedWp).toBeUndefined();

    // The candidate's workspace person should still exist
    const targetWp = sqlite.prepare(
      `SELECT person_id FROM workspace_people WHERE id = ?`,
    ).get(body.targetWorkspacePersonId) as { person_id: string } | undefined;
    expect(targetWp).toBeTruthy();
    expect(targetWp!.person_id).toBe(body.personId);
  });

  it('reports already linked when contact and candidate share same email', async () => {
    sqlite.exec(`
      INSERT INTO candidates (id, owner_id, name, email, status)
      VALUES ('cand-same-1', 'owner-1', 'Bob', 'bob@test.dev', 'active');
      INSERT INTO contacts (id, owner_id, name, email, type)
      VALUES ('cont-same-1', 'owner-1', 'Bob Contact', 'bob@test.dev', 'lead');
    `);
    const db = createMockD1(sqlite);
    const app = new Hono();
    app.route('/', livingContextHealth);

    const res = await app.request('/person-identity-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contactId: 'cont-same-1', candidateId: 'cand-same-1' }),
    }, { DB: db });
    expect(res.status).toBe(200);

    const body = await res.json() as { linked: boolean; alreadyLinked: boolean };
    expect(body.linked).toBe(true);
    expect(body.alreadyLinked).toBe(true);
  });
});

describe('POST /candidate-comparison', () => {
  let sqlite: BetterSqliteDb;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec('PRAGMA foreign_keys = ON;');
    sqlite.exec(livingContextMigration);
    sqlite.exec(contextRecordsMigration);
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS pipelines (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS candidates (
        id TEXT PRIMARY KEY, name TEXT NOT NULL,
        pipeline_id TEXT, owner_id TEXT
      );
    `);
  });

  afterEach(() => {
    sqlite.close();
  });

  it('rejects with fewer than 2 candidate IDs', async () => {
    const db = createMockD1(sqlite);
    const app = new Hono();
    app.route('/', livingContextHealth);

    const res = await app.request('/candidate-comparison', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidateIds: ['c1'] }),
    }, { DB: db });
    expect(res.status).toBe(400);
  });

  it('returns comparison report for valid candidate pair', async () => {
    sqlite.exec(`
      INSERT INTO candidates (id, name, owner_id) VALUES ('c1', 'Alice', 'internal');
      INSERT INTO candidates (id, name, owner_id) VALUES ('c2', 'Bob', 'internal');
    `);
    const db = createMockD1(sqlite);
    const app = new Hono();
    app.route('/', livingContextHealth);

    const res = await app.request('/candidate-comparison', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidateIds: ['c1', 'c2'] }),
    }, { DB: db });
    expect(res.status).toBe(200);

    const body = await res.json() as {
      candidateProfiles: Array<{ candidateId: string; candidateName: string }>;
      summary: { totalCandidates: number };
    };
    expect(body.candidateProfiles).toHaveLength(2);
    expect(body.summary.totalCandidates).toBe(2);
  });

  it('rejects more than 20 candidates', async () => {
    const db = createMockD1(sqlite);
    const app = new Hono();
    app.route('/', livingContextHealth);

    const ids = Array.from({ length: 21 }, (_, i) => `c${i}`);
    const res = await app.request('/candidate-comparison', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidateIds: ids }),
    }, { DB: db });
    expect(res.status).toBe(400);
  });
});

describe('POST /session-event-ingest', () => {
  let sqlite: BetterSqliteDb;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec('PRAGMA foreign_keys = ON;');
    sqlite.exec(livingContextMigration);
    sqlite.exec(contextRecordsMigration);
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS pipelines (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS candidates (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT,
        pipeline_id TEXT, owner_id TEXT, status TEXT
      );
      CREATE TABLE IF NOT EXISTS contacts (
        id TEXT PRIMARY KEY, owner_id TEXT, name TEXT, email TEXT, type TEXT
      );
      CREATE TABLE IF NOT EXISTS session_events (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        session_type TEXT NOT NULL,
        candidate_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload_json TEXT,
        created_at TEXT NOT NULL
      );
    `);
  });

  afterEach(() => {
    sqlite.close();
  });

  it('rejects when candidateId is missing', async () => {
    const db = createMockD1(sqlite);
    const app = new Hono();
    app.route('/', livingContextHealth);

    const res = await app.request('/session-event-ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }, { DB: db });
    expect(res.status).toBe(400);
  });

  it('returns zero counts when no events exist', async () => {
    sqlite.exec(`INSERT INTO candidates (id, name, owner_id) VALUES ('c1', 'Alice', 'test-user')`);

    const db = createMockD1(sqlite);
    const app = new Hono();
    app.route('/', livingContextHealth);

    const res = await app.request('/session-event-ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidateId: 'c1' }),
    }, { DB: db });
    expect(res.status).toBe(200);

    const body = await res.json() as { eventsProcessed: number; message: string };
    expect(body.eventsProcessed).toBe(0);
    expect(body.message).toContain('No session events found');
  });
});

describe('GET /evidence-readiness', () => {
  let sqlite: BetterSqliteDb;

  beforeEach(() => {
    sqlite = new Database(':memory:');
  });

  afterEach(() => {
    sqlite.close();
  });

  it('returns 400 when candidateId is missing', async () => {
    sqlite.exec(`CREATE TABLE IF NOT EXISTS candidates (id TEXT PRIMARY KEY, name TEXT)`);
    sqlite.exec(livingContextMigration);
    sqlite.exec(contextRecordsMigration);
    const db = createMockD1(sqlite);
    const app = new Hono();
    app.route('/', livingContextHealth);

    const res = await app.request('/evidence-readiness', {
      method: 'GET',
    }, { DB: db });
    expect(res.status).toBe(400);

    const body = await res.json() as { error: string };
    expect(body.error).toContain('candidateId');
  });

  it('returns empty readiness report when candidate has no workspace identity', async () => {
    sqlite.exec(`CREATE TABLE IF NOT EXISTS candidates (id TEXT PRIMARY KEY, name TEXT)`);
    sqlite.exec(livingContextMigration);
    sqlite.exec(contextRecordsMigration);
    const db = createMockD1(sqlite);
    const app = new Hono();
    app.route('/', livingContextHealth);

    const res = await app.request('/evidence-readiness?candidateId=c1', {
      method: 'GET',
    }, { DB: db });
    expect(res.status).toBe(200);

    const body = await res.json() as { candidateId: string; overallScore: number; overallLevel: string };
    expect(body.candidateId).toBe('c1');
    expect(body.overallScore).toBe(0);
    expect(body.overallLevel).toBe('not_ready');
  });
});
