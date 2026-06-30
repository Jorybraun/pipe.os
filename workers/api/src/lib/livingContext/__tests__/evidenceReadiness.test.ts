import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockD1, type BetterSqliteDb } from '../../../__tests__/helpers/mockD1';
import { computeEvidenceReadiness } from '../evidenceReadiness';
import { LivingContextStore } from '../persistence';

const migrationSql = readFileSync(
  new URL('../../../../migrations/0082_living_context_graph.sql', import.meta.url),
  'utf8',
);

const contextRecordMigrationSql = readFileSync(
  new URL('../../../../migrations/0095_context_records.sql', import.meta.url),
  'utf8',
);

const conceptRegistrySql = readFileSync(
  new URL('../../../../migrations/0094_concept_registry.sql', import.meta.url),
  'utf8',
);

describe('computeEvidenceReadiness', () => {
  let sqlite: BetterSqliteDb;
  let db: ReturnType<typeof createMockD1>;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    // candidates table must exist before living context migration (FK reference)
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS candidates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        pipeline_id TEXT,
        owner_id TEXT
      );
    `);
    sqlite.exec(migrationSql);
    sqlite.exec(contextRecordMigrationSql);
    sqlite.exec(conceptRegistrySql);
    db = createMockD1(sqlite);
  });

  afterEach(() => {
    sqlite.close();
  });

  it('returns null when candidate has no workspace identity', async () => {
    sqlite.exec(`INSERT INTO candidates (id, name) VALUES ('c1', 'Alice')`);

    const result = await computeEvidenceReadiness(db, 'c1');

    expect(result).toBeNull();
  });

  it('returns all-zero scores for a candidate with no interactions', async () => {
    const store = new LivingContextStore(db);
    sqlite.exec(`INSERT INTO candidates (id, name) VALUES ('c1', 'Alice')`);

    const person = await store.upsertPerson({
      ingestionKey: 'person:alice',
      displayName: 'Alice',
      primaryEmail: 'alice@test.com',
    });
    const wp = await store.upsertWorkspacePerson({
      ingestionKey: 'wp:alice',
      workspaceId: 'ws1',
      personId: person.id,
    });
    await store.upsertApplication({
      ingestionKey: 'app:alice',
      workspacePersonId: wp.id,
      legacyCandidateId: 'c1',
    });

    const result = await computeEvidenceReadiness(db, 'c1');

    expect(result).not.toBeNull();
    expect(result!.overallScore).toBe(0);
    expect(result!.overallLevel).toBe('not_ready');
    expect(result!.dimensions).toHaveLength(8);
    for (const dim of result!.dimensions) {
      expect(dim.score).toBe(0);
      expect(dim.level).toBe('none');
    }
    expect(result!.weakest.length).toBeGreaterThan(0);
    expect(result!.strongest).toHaveLength(0);
    expect(result!.recommendations.length).toBeGreaterThan(0);
  });

  it('scores resume dimension when resume interactions exist', async () => {
    const store = new LivingContextStore(db);
    sqlite.exec(`INSERT INTO candidates (id, name) VALUES ('c2', 'Bob')`);

    const person = await store.upsertPerson({
      ingestionKey: 'person:bob',
      displayName: 'Bob',
      primaryEmail: 'bob@test.com',
    });
    const wp = await store.upsertWorkspacePerson({
      ingestionKey: 'wp:bob',
      workspaceId: 'ws1',
      personId: person.id,
    });
    await store.upsertApplication({
      ingestionKey: 'app:bob',
      workspacePersonId: wp.id,
      legacyCandidateId: 'c2',
    });

    // Add resume interaction
    await store.upsertInteraction({
      ingestionKey: 'int:bob:resume',
      workspacePersonId: wp.id,
      interactionType: 'resume_upload',
      startedAt: '2026-06-01T00:00:00Z',
    });

    const now = new Date('2026-06-15T00:00:00Z');
    const result = await computeEvidenceReadiness(db, 'c2', { now });

    expect(result).not.toBeNull();
    const resumeDim = result!.dimensions.find((d) => d.dimension === 'resume');
    expect(resumeDim).toBeDefined();
    expect(resumeDim!.score).toBeGreaterThan(0);
    expect(resumeDim!.evidenceCount).toBe(1);
    expect(resumeDim!.level).not.toBe('none');
  });

  it('applies temporal decay to older evidence', async () => {
    const store = new LivingContextStore(db);
    sqlite.exec(`INSERT INTO candidates (id, name) VALUES ('c3', 'Carol')`);

    const person = await store.upsertPerson({
      ingestionKey: 'person:carol',
      displayName: 'Carol',
      primaryEmail: 'carol@test.com',
    });
    const wp = await store.upsertWorkspacePerson({
      ingestionKey: 'wp:carol',
      workspaceId: 'ws1',
      personId: person.id,
    });
    await store.upsertApplication({
      ingestionKey: 'app:carol',
      workspacePersonId: wp.id,
      legacyCandidateId: 'c3',
    });

    // Add old interview
    await store.upsertInteraction({
      ingestionKey: 'int:carol:interview',
      workspacePersonId: wp.id,
      interactionType: 'interview',
      startedAt: '2025-01-01T00:00:00Z',
    });

    const now = new Date('2026-06-15T00:00:00Z');
    const result = await computeEvidenceReadiness(db, 'c3', { now });

    expect(result).not.toBeNull();
    const interviewDim = result!.dimensions.find((d) => d.dimension === 'interview');
    expect(interviewDim).toBeDefined();
    expect(interviewDim!.decayMultiplier).toBeLessThan(1);
  });

  it('identifies weakest and strongest dimensions', async () => {
    const store = new LivingContextStore(db);
    sqlite.exec(`INSERT INTO candidates (id, name) VALUES ('c4', 'Dave')`);

    const person = await store.upsertPerson({
      ingestionKey: 'person:dave',
      displayName: 'Dave',
      primaryEmail: 'dave@test.com',
    });
    const wp = await store.upsertWorkspacePerson({
      ingestionKey: 'wp:dave',
      workspaceId: 'ws1',
      personId: person.id,
    });
    await store.upsertApplication({
      ingestionKey: 'app:dave',
      workspacePersonId: wp.id,
      legacyCandidateId: 'c4',
    });

    const now = new Date('2026-06-15T00:00:00Z');

    // Add several resume interactions to make it strong
    for (let i = 0; i < 6; i++) {
      await store.upsertInteraction({
        ingestionKey: `int:dave:resume:${i}`,
        workspacePersonId: wp.id,
        interactionType: 'resume_upload',
        startedAt: '2026-06-10T00:00:00Z',
      });
    }

    // Add several interview interactions
    for (let i = 0; i < 6; i++) {
      await store.upsertInteraction({
        ingestionKey: `int:dave:interview:${i}`,
        workspacePersonId: wp.id,
        interactionType: 'interview',
        startedAt: '2026-06-10T00:00:00Z',
      });
    }

    const result = await computeEvidenceReadiness(db, 'c4', { now });

    expect(result).not.toBeNull();
    expect(result!.overallScore).toBeGreaterThan(0);

    // Dimensions with no evidence should appear in weakest
    expect(result!.weakest).toContain('assessment');
    expect(result!.weakest).toContain('code_review');

    // Overall level should reflect partial evidence coverage
    expect(['minimal', 'ready', 'not_ready']).toContain(result!.overallLevel);
  });

  it('generates actionable recommendations for missing dimensions', async () => {
    const store = new LivingContextStore(db);
    sqlite.exec(`INSERT INTO candidates (id, name) VALUES ('c5', 'Eve')`);

    const person = await store.upsertPerson({
      ingestionKey: 'person:eve',
      displayName: 'Eve',
      primaryEmail: 'eve@test.com',
    });
    const wp = await store.upsertWorkspacePerson({
      ingestionKey: 'wp:eve',
      workspaceId: 'ws1',
      personId: person.id,
    });
    await store.upsertApplication({
      ingestionKey: 'app:eve',
      workspacePersonId: wp.id,
      legacyCandidateId: 'c5',
    });

    const result = await computeEvidenceReadiness(db, 'c5');

    expect(result).not.toBeNull();
    expect(result!.recommendations.length).toBeGreaterThan(0);
    expect(result!.recommendations.length).toBeLessThanOrEqual(3);

    // Recommendations should be strings with actionable guidance
    for (const rec of result!.recommendations) {
      expect(typeof rec).toBe('string');
      expect(rec.length).toBeGreaterThan(10);
    }
  });

  it('includes computed timestamp in report', async () => {
    const store = new LivingContextStore(db);
    sqlite.exec(`INSERT INTO candidates (id, name) VALUES ('c6', 'Frank')`);

    const person = await store.upsertPerson({
      ingestionKey: 'person:frank',
      displayName: 'Frank',
      primaryEmail: 'frank@test.com',
    });
    const wp = await store.upsertWorkspacePerson({
      ingestionKey: 'wp:frank',
      workspaceId: 'ws1',
      personId: person.id,
    });
    await store.upsertApplication({
      ingestionKey: 'app:frank',
      workspacePersonId: wp.id,
      legacyCandidateId: 'c6',
    });

    const now = new Date('2026-06-30T12:00:00Z');
    const result = await computeEvidenceReadiness(db, 'c6', { now });

    expect(result).not.toBeNull();
    expect(result!.computedAt).toBe('2026-06-30T12:00:00.000Z');
    expect(result!.candidateId).toBe('c6');
    expect(result!.workspacePersonId).toBe(wp.id);
  });
});
