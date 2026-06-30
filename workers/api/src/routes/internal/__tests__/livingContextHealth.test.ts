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
  new URL('../../../../migrations/0104_backfill_checkpoints.sql', import.meta.url),
  'utf8',
);
const gatesMigration = readFileSync(
  new URL('../../../../migrations/0105_rollout_gates.sql', import.meta.url),
  'utf8',
);

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

  it('enqueues rebuild jobs for all workspace persons', async () => {
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
    }, { DB: db });
    expect(res.status).toBe(200);

    const body = await res.json() as { status: string; enqueued: number };
    expect(body.status).toBe('scheduled');
    expect(body.enqueued).toBe(2);

    const rows = sqlite.prepare(
      `SELECT aggregate_id, operation, status FROM projection_outbox WHERE operation = 'rebuild'`,
    ).all() as Array<{ aggregate_id: string; operation: string; status: string }>;
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.aggregate_id).sort()).toEqual(['wp-1', 'wp-2']);
    expect(rows.every((r) => r.status === 'pending')).toBe(true);
  });

  it('returns zero when no workspace persons exist', async () => {
    const db = createMockD1(sqlite);
    const app = new Hono();
    app.route('/', livingContextHealth);

    const res = await app.request('/living-context-rebuild-projections', {
      method: 'POST',
    }, { DB: db });
    expect(res.status).toBe(200);

    const body = await res.json() as { status: string; enqueued: number };
    expect(body.enqueued).toBe(0);
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
