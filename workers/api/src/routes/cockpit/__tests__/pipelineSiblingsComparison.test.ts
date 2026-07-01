import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockD1, type BetterSqliteDb } from '../../../__tests__/helpers/mockD1';
import { compareCandidateEvidence } from '../../../lib/livingContext/candidateComparison';
import { LivingContextStore } from '../../../lib/livingContext/persistence';

const pipelineMigration = readFileSync(
  new URL('../../../../migrations/0001_create_pipelines.sql', import.meta.url),
  'utf8',
);
const livingContextMigration = readFileSync(
  new URL('../../../../migrations/0082_living_context_graph.sql', import.meta.url),
  'utf8',
);
const contextRecordMigration = readFileSync(
  new URL('../../../../migrations/0095_context_records.sql', import.meta.url),
  'utf8',
);
const conceptRegistryMigration = readFileSync(
  new URL('../../../../migrations/0094_concept_registry.sql', import.meta.url),
  'utf8',
);

const USER_ID = 'user-test-owner';
const PIPELINE_ID = 'pipeline-abc';

describe('pipeline-siblings + comparison integration — criteria #5, #6, #7', () => {
  let sqlite: BetterSqliteDb;
  let db: ReturnType<typeof createMockD1>;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec('PRAGMA foreign_keys = OFF;');
    sqlite.exec(pipelineMigration);
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS candidates (
        id TEXT PRIMARY KEY,
        pipeline_id TEXT,
        owner_id TEXT NOT NULL,
        name TEXT,
        email TEXT,
        invite_token TEXT UNIQUE,
        status TEXT NOT NULL DEFAULT 'INVITED',
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
    `);
    sqlite.exec(livingContextMigration);
    sqlite.exec(contextRecordMigration);
    sqlite.exec(conceptRegistryMigration);
    db = createMockD1(sqlite);

    // Seed pipeline and 3 candidates
    sqlite.exec(`
      INSERT INTO pipelines (id, owner_id, title, created_at, updated_at)
      VALUES ('${PIPELINE_ID}', '${USER_ID}', 'Senior Backend', datetime('now'), datetime('now'));

      INSERT INTO candidates (id, pipeline_id, owner_id, name, email, invite_token, status, created_at)
      VALUES
        ('cand-1', '${PIPELINE_ID}', '${USER_ID}', 'Alice', 'alice@test.dev', 'tok-1', 'IN_PROGRESS', datetime('now', '-3 days')),
        ('cand-2', '${PIPELINE_ID}', '${USER_ID}', 'Bob', 'bob@test.dev', 'tok-2', 'IN_PROGRESS', datetime('now', '-2 days')),
        ('cand-3', '${PIPELINE_ID}', '${USER_ID}', 'Charlie', 'charlie@test.dev', 'tok-3', 'ARCHIVED', datetime('now', '-1 days'));
    `);
  });

  afterEach(() => {
    sqlite.close();
  });

  it('pipeline-siblings query returns only non-archived siblings', async () => {
    const candidate = await db.prepare(
      `SELECT c.id, c.pipeline_id
         FROM candidates c
         LEFT JOIN pipelines p ON p.id = c.pipeline_id
        WHERE c.id = ?1 AND (c.owner_id = ?2 OR p.owner_id = ?2)`,
    ).bind('cand-1', USER_ID).first<{ id: string; pipeline_id: string | null }>();

    expect(candidate).not.toBeNull();
    expect(candidate!.pipeline_id).toBe(PIPELINE_ID);

    const siblings = await db.prepare(
      `SELECT id FROM candidates
        WHERE pipeline_id = ?1 AND id != ?2 AND status != 'ARCHIVED'
        ORDER BY created_at DESC
        LIMIT 20`,
    ).bind(candidate!.pipeline_id, 'cand-1').all<{ id: string }>();

    const siblingIds = (siblings.results ?? []).map((r) => r.id);
    expect(siblingIds).toEqual(['cand-2']);
    expect(siblingIds).not.toContain('cand-3'); // ARCHIVED excluded
  });

  it('pipeline-siblings returns empty for candidate without pipeline', async () => {
    sqlite.exec(`
      INSERT INTO candidates (id, pipeline_id, owner_id, name, email, invite_token, status)
      VALUES ('cand-no-pipe', NULL, '${USER_ID}', 'Solo', 'solo@test.dev', 'tok-solo', 'INVITED');
    `);

    const candidate = await db.prepare(
      `SELECT c.id, c.pipeline_id
         FROM candidates c
         LEFT JOIN pipelines p ON p.id = c.pipeline_id
        WHERE c.id = ?1 AND (c.owner_id = ?2 OR p.owner_id = ?2)`,
    ).bind('cand-no-pipe', USER_ID).first<{ id: string; pipeline_id: string | null }>();

    expect(candidate).not.toBeNull();
    expect(candidate!.pipeline_id).toBeNull();
  });

  it('comparison report shows divergent evidence profiles for siblings', async () => {
    const store = new LivingContextStore(db);

    // Set up workspace identities for both candidates
    const p1 = await store.upsertPerson({ ingestionKey: 'person:alice', displayName: 'Alice', primaryEmail: 'alice@test.dev' });
    const p2 = await store.upsertPerson({ ingestionKey: 'person:bob', displayName: 'Bob', primaryEmail: 'bob@test.dev' });
    const wp1 = await store.upsertWorkspacePerson({ ingestionKey: 'wp:alice', workspaceId: 'ws1', personId: p1.id });
    const wp2 = await store.upsertWorkspacePerson({ ingestionKey: 'wp:bob', workspaceId: 'ws1', personId: p2.id });
    await store.upsertApplication({ ingestionKey: 'app:alice', workspacePersonId: wp1.id, legacyCandidateId: 'cand-1' });
    await store.upsertApplication({ ingestionKey: 'app:bob', workspacePersonId: wp2.id, legacyCandidateId: 'cand-2' });

    // Alice: 2 interactions (resume + meeting) with 3 assertions
    const ia1 = await store.upsertInteraction({
      ingestionKey: 'int:alice:resume',
      workspacePersonId: wp1.id,
      interactionType: 'resume_upload',
      startedAt: '2026-06-01T00:00:00Z',
    });
    const ia2 = await store.upsertInteraction({
      ingestionKey: 'int:alice:meeting',
      workspacePersonId: wp1.id,
      interactionType: 'meeting',
      startedAt: '2026-06-10T00:00:00Z',
    });

    const ea1 = await store.upsertEpisode({ ingestionKey: 'ep:alice:1', workspacePersonId: wp1.id, interactionId: ia1.id });
    const ea2 = await store.upsertEpisode({ ingestionKey: 'ep:alice:2', workspacePersonId: wp1.id, interactionId: ia2.id });

    await store.upsertAssertion({
      ingestionKey: 'sa:alice:ts',
      workspacePersonId: wp1.id,
      episodeId: ea1.id,
      subjectType: 'person',
      predicate: 'knows',
      narrative: 'Alice knows TypeScript',
      observedAt: '2026-06-01T00:00:00Z',
    });
    await store.upsertAssertion({
      ingestionKey: 'sa:alice:systems',
      workspacePersonId: wp1.id,
      episodeId: ea1.id,
      subjectType: 'person',
      predicate: 'knows',
      narrative: 'Alice has distributed systems experience',
      observedAt: '2026-06-01T00:00:00Z',
    });
    await store.upsertAssertion({
      ingestionKey: 'sa:alice:leadership',
      workspacePersonId: wp1.id,
      episodeId: ea2.id,
      subjectType: 'person',
      predicate: 'demonstrated',
      narrative: 'Alice demonstrated team leadership in meeting',
      observedAt: '2026-06-10T00:00:00Z',
    });

    // Bob: 1 interaction (resume only) with 1 assertion
    const ib1 = await store.upsertInteraction({
      ingestionKey: 'int:bob:resume',
      workspacePersonId: wp2.id,
      interactionType: 'resume_upload',
      startedAt: '2026-06-05T00:00:00Z',
    });
    const eb1 = await store.upsertEpisode({ ingestionKey: 'ep:bob:1', workspacePersonId: wp2.id, interactionId: ib1.id });
    await store.upsertAssertion({
      ingestionKey: 'sa:bob:ts',
      workspacePersonId: wp2.id,
      episodeId: eb1.id,
      subjectType: 'person',
      predicate: 'knows',
      narrative: 'Bob knows TypeScript',
      observedAt: '2026-06-05T00:00:00Z',
    });

    const report = await compareCandidateEvidence(db, ['cand-1', 'cand-2'], USER_ID, {
      pipelineId: PIPELINE_ID,
    });

    expect(report.candidateProfiles).toHaveLength(2);
    expect(report.pipelineId).toBe(PIPELINE_ID);

    const alice = report.candidateProfiles.find((p) => p.candidateId === 'cand-1');
    const bob = report.candidateProfiles.find((p) => p.candidateId === 'cand-2');

    expect(alice).toBeDefined();
    expect(bob).toBeDefined();
    expect(alice!.totalAssertions).toBe(3);
    expect(bob!.totalAssertions).toBe(1);
    expect(alice!.totalInteractions).toBe(2);
    expect(bob!.totalInteractions).toBe(1);
    expect(alice!.workspacePersonId).toBe(wp1.id);
    expect(bob!.workspacePersonId).toBe(wp2.id);

    // Summary should reflect correct totals
    expect(report.summary.totalCandidates).toBe(2);
  });

  it('comparison includes pipeline members via pipeline ownership', async () => {
    // cand-other has different owner_id but is in pipeline owned by USER_ID
    sqlite.exec(`
      INSERT INTO candidates (id, pipeline_id, owner_id, name, invite_token, status)
      VALUES ('cand-other', '${PIPELINE_ID}', 'other-user', 'Mallory', 'tok-other', 'IN_PROGRESS');
    `);

    const report = await compareCandidateEvidence(db, ['cand-1', 'cand-other'], USER_ID, {
      pipelineId: PIPELINE_ID,
    });

    // Both included because pipeline owner_id matches USER_ID
    expect(report.candidateProfiles).toHaveLength(2);
    const ownedProfiles = report.candidateProfiles.filter((p) => p.candidateId === 'cand-1');
    const pipelineProfiles = report.candidateProfiles.filter((p) => p.candidateId === 'cand-other');
    expect(ownedProfiles).toHaveLength(1);
    expect(pipelineProfiles).toHaveLength(1);
  });

  it('comparison excludes candidates in separate pipeline not owned by user', async () => {
    sqlite.exec(`
      INSERT INTO pipelines (id, owner_id, title, created_at, updated_at)
      VALUES ('pipeline-other', 'other-owner', 'Other Pipeline', datetime('now'), datetime('now'));
      INSERT INTO candidates (id, pipeline_id, owner_id, name, invite_token, status)
      VALUES ('cand-foreign', 'pipeline-other', 'other-owner', 'Foreign', 'tok-foreign', 'IN_PROGRESS');
    `);

    const report = await compareCandidateEvidence(db, ['cand-1', 'cand-foreign'], USER_ID, {});

    // cand-foreign is in a pipeline not owned by USER_ID and has different owner_id
    const ownedProfiles = report.candidateProfiles.filter((p) => p.candidateId === 'cand-1');
    const foreignProfiles = report.candidateProfiles.filter((p) => p.candidateId === 'cand-foreign');
    expect(ownedProfiles).toHaveLength(1);
    expect(foreignProfiles).toHaveLength(0);
  });

  it('full flow: siblings → comparison maps evidence divergence', async () => {
    const store = new LivingContextStore(db);

    // Set up workspace identity for cand-1 only
    const p1 = await store.upsertPerson({ ingestionKey: 'person:alice-full', displayName: 'Alice', primaryEmail: 'alice@test.dev' });
    const wp1 = await store.upsertWorkspacePerson({ ingestionKey: 'wp:alice-full', workspaceId: 'ws1', personId: p1.id });
    await store.upsertApplication({ ingestionKey: 'app:alice-full', workspacePersonId: wp1.id, legacyCandidateId: 'cand-1' });

    const ia = await store.upsertInteraction({
      ingestionKey: 'int:alice-full:resume',
      workspacePersonId: wp1.id,
      interactionType: 'resume_upload',
      startedAt: '2026-06-01T00:00:00Z',
    });
    const ea = await store.upsertEpisode({ ingestionKey: 'ep:alice-full:1', workspacePersonId: wp1.id, interactionId: ia.id });
    await store.upsertAssertion({
      ingestionKey: 'sa:alice-full:go',
      workspacePersonId: wp1.id,
      episodeId: ea.id,
      subjectType: 'person',
      predicate: 'knows',
      narrative: 'Proficient in Go',
      observedAt: '2026-06-01T00:00:00Z',
    });

    // Step 1: Get siblings for cand-1
    const candidate = await db.prepare(
      `SELECT c.id, c.pipeline_id FROM candidates c WHERE c.id = ?1 AND c.owner_id = ?2`,
    ).bind('cand-1', USER_ID).first<{ id: string; pipeline_id: string | null }>();
    expect(candidate!.pipeline_id).toBe(PIPELINE_ID);

    const siblings = await db.prepare(
      `SELECT id FROM candidates WHERE pipeline_id = ?1 AND id != ?2 AND status != 'ARCHIVED' ORDER BY created_at DESC LIMIT 20`,
    ).bind(PIPELINE_ID, 'cand-1').all<{ id: string }>();
    const siblingIds = (siblings.results ?? []).map((r) => r.id);
    expect(siblingIds).toContain('cand-2');

    // Step 2: Compare cand-1 with siblings
    const allIds = ['cand-1', ...siblingIds];
    const report = await compareCandidateEvidence(db, allIds, USER_ID, { pipelineId: PIPELINE_ID });

    expect(report.candidateProfiles.length).toBeGreaterThanOrEqual(2);
    const aliceProfile = report.candidateProfiles.find((p) => p.candidateId === 'cand-1');
    const bobProfile = report.candidateProfiles.find((p) => p.candidateId === 'cand-2');

    // Alice has evidence, Bob does not (no workspace identity set up)
    expect(aliceProfile!.totalAssertions).toBeGreaterThan(0);
    expect(bobProfile!.totalAssertions).toBe(0);
    expect(bobProfile!.workspacePersonId).toBeNull();
  });
});
