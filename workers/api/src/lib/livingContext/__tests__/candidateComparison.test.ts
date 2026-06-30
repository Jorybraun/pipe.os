import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockD1, type BetterSqliteDb } from '../../../__tests__/helpers/mockD1';
import { compareCandidateEvidence } from '../candidateComparison';
import { LivingContextStore, deterministicEntityId } from '../persistence';

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

describe('compareCandidateEvidence', () => {
  let sqlite: BetterSqliteDb;
  let db: ReturnType<typeof createMockD1>;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(migrationSql);
    sqlite.exec(contextRecordMigrationSql);
    sqlite.exec(conceptRegistrySql);
    // Create candidates table
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS pipelines (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS candidates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        pipeline_id TEXT,
        owner_id TEXT
      );
    `);
    db = createMockD1(sqlite);
  });

  afterEach(() => {
    sqlite.close();
  });

  it('returns empty report when no candidates match ownership check', async () => {
    sqlite.exec(`INSERT INTO candidates (id, name, owner_id) VALUES ('c1', 'Alice', 'other-user')`);
    sqlite.exec(`INSERT INTO candidates (id, name, owner_id) VALUES ('c2', 'Bob', 'other-user')`);

    const report = await compareCandidateEvidence(db, ['c1', 'c2'], 'test-user');

    expect(report.candidateProfiles).toHaveLength(0);
    expect(report.summary.totalCandidates).toBe(0);
  });

  it('returns profiles with empty evidence when candidates have no workspace identity', async () => {
    sqlite.exec(`INSERT INTO candidates (id, name, owner_id) VALUES ('c1', 'Alice', 'test-user')`);
    sqlite.exec(`INSERT INTO candidates (id, name, owner_id) VALUES ('c2', 'Bob', 'test-user')`);

    const report = await compareCandidateEvidence(db, ['c1', 'c2'], 'test-user');

    expect(report.candidateProfiles).toHaveLength(2);
    for (const profile of report.candidateProfiles) {
      expect(profile.workspacePersonId).toBeNull();
      expect(profile.totalInteractions).toBe(0);
      expect(profile.totalAssertions).toBe(0);
      expect(profile.topConcepts).toHaveLength(0);
    }
    expect(report.summary.totalCandidates).toBe(2);
    expect(report.conceptComparisons).toHaveLength(0);
  });

  it('compares evidence profiles for candidates with living context data', async () => {
    const store = new LivingContextStore(db);

    // Create pipeline and candidates
    sqlite.exec(`INSERT INTO pipelines (id, owner_id) VALUES ('p1', 'test-user')`);
    sqlite.exec(`INSERT INTO candidates (id, name, pipeline_id, owner_id) VALUES ('c1', 'Alice', 'p1', 'test-user')`);
    sqlite.exec(`INSERT INTO candidates (id, name, pipeline_id, owner_id) VALUES ('c2', 'Bob', 'p1', 'test-user')`);

    // Set up workspace identities
    const p1 = await store.upsertPerson({ ingestionKey: 'person:alice', displayName: 'Alice', primaryEmail: 'alice@test.com' });
    const p2 = await store.upsertPerson({ ingestionKey: 'person:bob', displayName: 'Bob', primaryEmail: 'bob@test.com' });
    const wp1 = await store.upsertWorkspacePerson({ ingestionKey: 'wp:alice', workspaceId: 'ws1', personId: p1.id });
    const wp2 = await store.upsertWorkspacePerson({ ingestionKey: 'wp:bob', workspaceId: 'ws1', personId: p2.id });
    await store.upsertApplication({ ingestionKey: 'app:alice', workspacePersonId: wp1.id, legacyCandidateId: 'c1' });
    await store.upsertApplication({ ingestionKey: 'app:bob', workspacePersonId: wp2.id, legacyCandidateId: 'c2' });

    // Add interactions for Alice
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

    // Add interactions for Bob
    const ib1 = await store.upsertInteraction({
      ingestionKey: 'int:bob:resume',
      workspacePersonId: wp2.id,
      interactionType: 'resume_upload',
      startedAt: '2026-06-05T00:00:00Z',
    });

    // Add episodes and assertions for Alice
    const ea1 = await store.upsertEpisode({
      ingestionKey: 'ep:alice:1',
      workspacePersonId: wp1.id,
      interactionId: ia1.id,
    });
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
      ingestionKey: 'sa:alice:react',
      workspacePersonId: wp1.id,
      episodeId: ea1.id,
      subjectType: 'person',
      predicate: 'knows',
      narrative: 'Alice knows React',
      observedAt: '2026-06-01T00:00:00Z',
    });

    // Add episodes and assertions for Bob
    const eb1 = await store.upsertEpisode({
      ingestionKey: 'ep:bob:1',
      workspacePersonId: wp2.id,
      interactionId: ib1.id,
    });
    await store.upsertAssertion({
      ingestionKey: 'sa:bob:ts',
      workspacePersonId: wp2.id,
      episodeId: eb1.id,
      subjectType: 'person',
      predicate: 'knows',
      narrative: 'Bob knows TypeScript',
      observedAt: '2026-06-05T00:00:00Z',
    });

    const report = await compareCandidateEvidence(db, ['c1', 'c2'], 'test-user', {
      pipelineId: 'p1',
    });

    expect(report.pipelineId).toBe('p1');
    expect(report.candidateProfiles).toHaveLength(2);

    const aliceProfile = report.candidateProfiles.find((p) => p.candidateId === 'c1');
    const bobProfile = report.candidateProfiles.find((p) => p.candidateId === 'c2');

    expect(aliceProfile).toBeDefined();
    expect(aliceProfile!.totalInteractions).toBe(2);
    expect(aliceProfile!.totalAssertions).toBe(2);
    expect(aliceProfile!.sourceDiversity).toBeGreaterThan(0);

    expect(bobProfile).toBeDefined();
    expect(bobProfile!.totalInteractions).toBe(1);
    expect(bobProfile!.totalAssertions).toBe(1);

    // Summary should rank Alice higher on depth
    expect(report.summary.totalCandidates).toBe(2);
    expect(report.summary.evidenceDepthRanking[0].candidateId).toBe('c1');
    expect(report.summary.evidenceDiversityRanking[0].candidateId).toBe('c1');
  });

  it('identifies shared and unique concepts across candidates', async () => {
    const store = new LivingContextStore(db);

    sqlite.exec(`INSERT INTO candidates (id, name, owner_id) VALUES ('c1', 'Alice', 'test-user')`);
    sqlite.exec(`INSERT INTO candidates (id, name, owner_id) VALUES ('c2', 'Bob', 'test-user')`);

    const p1 = await store.upsertPerson({ ingestionKey: 'person:a', displayName: 'Alice' });
    const p2 = await store.upsertPerson({ ingestionKey: 'person:b', displayName: 'Bob' });
    const wp1 = await store.upsertWorkspacePerson({ ingestionKey: 'wp:a', workspaceId: 'ws1', personId: p1.id });
    const wp2 = await store.upsertWorkspacePerson({ ingestionKey: 'wp:b', workspaceId: 'ws1', personId: p2.id });
    await store.upsertApplication({ ingestionKey: 'app:a', workspacePersonId: wp1.id, legacyCandidateId: 'c1' });
    await store.upsertApplication({ ingestionKey: 'app:b', workspacePersonId: wp2.id, legacyCandidateId: 'c2' });

    // Register concepts
    const tsId = (await store.upsertConcept({
      ingestionKey: 'concept:typescript',
      canonicalKey: 'lang:typescript',
      namespace: 'lang',
      label: 'TypeScript',
    })).id;
    const reactId = (await store.upsertConcept({
      ingestionKey: 'concept:react',
      canonicalKey: 'framework:react',
      namespace: 'framework',
      label: 'React',
    })).id;
    const goId = (await store.upsertConcept({
      ingestionKey: 'concept:go',
      canonicalKey: 'lang:go',
      namespace: 'lang',
      label: 'Go',
    })).id;

    const int1 = await store.upsertInteraction({ ingestionKey: 'i:a1', workspacePersonId: wp1.id, interactionType: 'resume_upload' });
    const int2 = await store.upsertInteraction({ ingestionKey: 'i:b1', workspacePersonId: wp2.id, interactionType: 'resume_upload' });

    const ep1 = await store.upsertEpisode({ ingestionKey: 'e:a1', workspacePersonId: wp1.id, interactionId: int1.id });
    const ep2 = await store.upsertEpisode({ ingestionKey: 'e:b1', workspacePersonId: wp2.id, interactionId: int2.id });

    // Alice: TypeScript + React
    const sa1 = await store.upsertAssertion({
      ingestionKey: 'sa:a:ts',
      workspacePersonId: wp1.id,
      episodeId: ep1.id,
      subjectType: 'person',
      predicate: 'knows',
      narrative: 'Knows TypeScript',
    });
    const now = new Date().toISOString();
    sqlite.exec(`INSERT OR IGNORE INTO assertion_concepts (assertion_id, concept_id, relationship, weight, created_at) VALUES ('${sa1.id}', '${tsId}', 'about', 1.0, '${now}')`);

    const sa2 = await store.upsertAssertion({
      ingestionKey: 'sa:a:react',
      workspacePersonId: wp1.id,
      episodeId: ep1.id,
      subjectType: 'person',
      predicate: 'knows',
      narrative: 'Knows React',
    });
    sqlite.exec(`INSERT OR IGNORE INTO assertion_concepts (assertion_id, concept_id, relationship, weight, created_at) VALUES ('${sa2.id}', '${reactId}', 'about', 1.0, '${now}')`);

    // Bob: TypeScript + Go
    const sb1 = await store.upsertAssertion({
      ingestionKey: 'sa:b:ts',
      workspacePersonId: wp2.id,
      episodeId: ep2.id,
      subjectType: 'person',
      predicate: 'knows',
      narrative: 'Knows TypeScript',
    });
    sqlite.exec(`INSERT OR IGNORE INTO assertion_concepts (assertion_id, concept_id, relationship, weight, created_at) VALUES ('${sb1.id}', '${tsId}', 'about', 1.0, '${now}')`);

    const sb2 = await store.upsertAssertion({
      ingestionKey: 'sa:b:go',
      workspacePersonId: wp2.id,
      episodeId: ep2.id,
      subjectType: 'person',
      predicate: 'knows',
      narrative: 'Knows Go',
    });
    sqlite.exec(`INSERT OR IGNORE INTO assertion_concepts (assertion_id, concept_id, relationship, weight, created_at) VALUES ('${sb2.id}', '${goId}', 'about', 1.0, '${now}')`);

    const report = await compareCandidateEvidence(db, ['c1', 'c2'], 'test-user');

    // TypeScript is shared, React is unique to Alice, Go is unique to Bob
    expect(report.summary.sharedConceptCount).toBeGreaterThanOrEqual(1);

    const tsConcept = report.conceptComparisons.find((cc) => cc.conceptKey === 'lang:typescript');
    expect(tsConcept).toBeDefined();
    const aliceTs = tsConcept!.candidates.find((c) => c.candidateId === 'c1');
    const bobTs = tsConcept!.candidates.find((c) => c.candidateId === 'c2');
    expect(aliceTs!.evidenceCount).toBeGreaterThan(0);
    expect(bobTs!.evidenceCount).toBeGreaterThan(0);

    expect(report.summary.uniqueConceptsPerCandidate['c1']).toBeGreaterThanOrEqual(1);
    expect(report.summary.uniqueConceptsPerCandidate['c2']).toBeGreaterThanOrEqual(1);
  });

  it('respects pipeline ownership for authorization', async () => {
    sqlite.exec(`INSERT INTO pipelines (id, owner_id) VALUES ('p1', 'user-a')`);
    sqlite.exec(`INSERT INTO candidates (id, name, pipeline_id, owner_id) VALUES ('c1', 'Alice', 'p1', 'user-a')`);
    sqlite.exec(`INSERT INTO candidates (id, name, pipeline_id, owner_id) VALUES ('c2', 'Bob', 'p1', 'user-a')`);

    // user-b should not be able to compare these candidates
    const report = await compareCandidateEvidence(db, ['c1', 'c2'], 'user-b');
    expect(report.candidateProfiles).toHaveLength(0);

    // user-a should be able to compare them
    const reportA = await compareCandidateEvidence(db, ['c1', 'c2'], 'user-a');
    expect(reportA.candidateProfiles).toHaveLength(2);
  });
});
