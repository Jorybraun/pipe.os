import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockD1, type BetterSqliteDb } from '../../../__tests__/helpers/mockD1';
import { detectEvidenceConflicts } from '../evidenceConflicts';
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

/** Scaffolds a candidate with a workspace person identity. */
async function scaffoldCandidate(
  sqlite: BetterSqliteDb,
  store: LivingContextStore,
  name: string,
  candidateId: string,
): Promise<{ wpId: string; appId: string }> {
  sqlite.exec(`INSERT INTO candidates (id, name) VALUES ('${candidateId}', '${name}')`);
  const person = await store.upsertPerson({
    ingestionKey: `person:${name}`,
    displayName: name,
    primaryEmail: `${name.toLowerCase()}@example.com`,
  });
  const wp = await store.upsertWorkspacePerson({
    ingestionKey: `wp:${name}`,
    workspaceId: 'ws1',
    personId: person.id,
  });
  const app = await store.upsertApplication({
    ingestionKey: `app:${name}`,
    workspacePersonId: wp.id,
    legacyCandidateId: candidateId,
  });
  return { wpId: wp.id, appId: app.id };
}

/** Creates an assertion with linked signal evidence for a concept. */
async function addEvidence(
  store: LivingContextStore,
  opts: {
    wpId: string;
    appId: string;
    conceptKey: string;
    ingestionSuffix: string;
    interactionType: string;
    narrative: string;
    polarity: number;
    strength: number;
    confidence: number;
  },
): Promise<void> {
  const concept = await store.upsertConcept({
    ingestionKey: `concept:${opts.conceptKey}`,
    canonicalKey: opts.conceptKey,
    namespace: 'skill',
    label: opts.conceptKey,
  });
  const interaction = await store.upsertInteraction({
    ingestionKey: `int:${opts.ingestionSuffix}`,
    workspacePersonId: opts.wpId,
    applicationId: opts.appId,
    interactionType: opts.interactionType,
  });
  const episode = await store.upsertEpisode({
    ingestionKey: `ep:${opts.ingestionSuffix}`,
    workspacePersonId: opts.wpId,
    interactionId: interaction.id,
  });
  const assertion = await store.upsertAssertion({
    ingestionKey: `sa:${opts.ingestionSuffix}`,
    workspacePersonId: opts.wpId,
    episodeId: episode.id,
    subjectType: 'person',
    predicate: opts.polarity >= 0 ? 'knows' : 'lacks',
    narrative: opts.narrative,
    polarity: opts.polarity,
    confidence: opts.confidence,
    observedAt: new Date().toISOString(),
  });
  await store.upsertSignalEvidence({
    ingestionKey: `se:${opts.ingestionSuffix}`,
    workspacePersonId: opts.wpId,
    interactionId: interaction.id,
    assertionId: assertion.id,
    conceptId: concept.id,
    signalKey: opts.conceptKey,
    evidenceLevel: 'demonstrated',
    strength: opts.strength,
    polarity: opts.polarity,
    observedAt: new Date().toISOString(),
  });
}

describe('detectEvidenceConflicts', () => {
  let sqlite: BetterSqliteDb;
  let db: ReturnType<typeof createMockD1>;
  let store: LivingContextStore;

  beforeEach(() => {
    sqlite = new Database(':memory:');
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
    store = new LivingContextStore(db);
  });

  afterEach(() => {
    sqlite.close();
  });

  it('returns empty report when candidate has no workspace identity', async () => {
    sqlite.exec(`INSERT INTO candidates (id, name) VALUES ('c1', 'Alice')`);
    const report = await detectEvidenceConflicts(db, 'c1');
    expect(report.workspacePersonId).toBeNull();
    expect(report.totalConflicts).toBe(0);
    expect(report.conflicts).toEqual([]);
    expect(report.analyzedAt).toBeTruthy();
  });

  it('returns empty report when there are no conflicting assertions', async () => {
    const { wpId, appId } = await scaffoldCandidate(sqlite, store, 'Bob', 'c1');
    await addEvidence(store, {
      wpId,
      appId,
      conceptKey: 'typescript',
      ingestionSuffix: 'bob:ts:1',
      interactionType: 'resume_review',
      narrative: 'Bob knows TypeScript',
      polarity: 1,
      strength: 0.9,
      confidence: 0.9,
    });

    const report = await detectEvidenceConflicts(db, 'c1');
    expect(report.workspacePersonId).toBe(wpId);
    expect(report.totalConflicts).toBe(0);
  });

  it('detects polarity conflicts when sources disagree', async () => {
    const { wpId, appId } = await scaffoldCandidate(sqlite, store, 'Carol', 'c1');

    await addEvidence(store, {
      wpId,
      appId,
      conceptKey: 'react',
      ingestionSuffix: 'carol:react:pos',
      interactionType: 'resume_review',
      narrative: 'Resume claims React expertise',
      polarity: 1,
      strength: 0.8,
      confidence: 0.8,
    });

    await addEvidence(store, {
      wpId,
      appId,
      conceptKey: 'react',
      ingestionSuffix: 'carol:react:neg',
      interactionType: 'technical_interview',
      narrative: 'Interview revealed weak React knowledge',
      polarity: -1,
      strength: 0.6,
      confidence: 0.7,
    });

    const report = await detectEvidenceConflicts(db, 'c1');
    expect(report.totalConflicts).toBe(1);
    const conflict = report.conflicts[0]!;
    expect(conflict.conceptKey).toBe('react');
    expect(conflict.conflictType).toBe('polarity');
    expect(conflict.severity).toBe('medium');
    expect(conflict.positiveAssertions).toHaveLength(1);
    expect(conflict.negativeAssertions).toHaveLength(1);
    expect(conflict.description).toContain('affirm');
    expect(conflict.description).toContain('contradict');
    expect(conflict.impactOnMatch).toContain('react');
  });

  it('classifies severity as high when multiple sources contradict', async () => {
    const { wpId, appId } = await scaffoldCandidate(sqlite, store, 'Dave', 'c1');

    // Two positive assertions
    await addEvidence(store, {
      wpId,
      appId,
      conceptKey: 'python',
      ingestionSuffix: 'dave:python:pos:0',
      interactionType: 'resume_review',
      narrative: 'Source 0 confirms Python',
      polarity: 1,
      strength: 0.9,
      confidence: 0.9,
    });

    await addEvidence(store, {
      wpId,
      appId,
      conceptKey: 'python',
      ingestionSuffix: 'dave:python:pos:1',
      interactionType: 'meeting',
      narrative: 'Source 1 confirms Python',
      polarity: 1,
      strength: 0.9,
      confidence: 0.9,
    });

    // One negative assertion
    await addEvidence(store, {
      wpId,
      appId,
      conceptKey: 'python',
      ingestionSuffix: 'dave:python:neg',
      interactionType: 'code_review',
      narrative: 'Code review shows poor Python style',
      polarity: -1,
      strength: 0.7,
      confidence: 0.8,
    });

    const report = await detectEvidenceConflicts(db, 'c1');
    expect(report.totalConflicts).toBe(1);
    expect(report.highSeverity).toBe(1);
    expect(report.conflicts[0]!.severity).toBe('high');
  });

  it('includes deterministic conflict IDs', async () => {
    const { wpId, appId } = await scaffoldCandidate(sqlite, store, 'Eve', 'c1');

    await addEvidence(store, {
      wpId,
      appId,
      conceptKey: 'golang',
      ingestionSuffix: 'eve:go:pos',
      interactionType: 'resume_review',
      narrative: 'Eve knows Go',
      polarity: 1,
      strength: 0.7,
      confidence: 0.8,
    });

    await addEvidence(store, {
      wpId,
      appId,
      conceptKey: 'golang',
      ingestionSuffix: 'eve:go:neg',
      interactionType: 'interview',
      narrative: 'Eve struggled with Go',
      polarity: -1,
      strength: 0.5,
      confidence: 0.6,
    });

    const report1 = await detectEvidenceConflicts(db, 'c1');
    const report2 = await detectEvidenceConflicts(db, 'c1');

    expect(report1.conflicts[0]!.conflictId).toBe(
      report2.conflicts[0]!.conflictId,
    );
    expect(report1.conflicts[0]!.conflictId).toMatch(/^conflict-[0-9a-f]{8}$/);
  });

  it('sorts conflicts by severity (high first)', async () => {
    const { wpId, appId } = await scaffoldCandidate(sqlite, store, 'Frank', 'c1');

    // Medium-severity conflict on "css" (1 positive + 1 negative)
    await addEvidence(store, {
      wpId,
      appId,
      conceptKey: 'css',
      ingestionSuffix: 'frank:css:pos',
      interactionType: 'resume_review',
      narrative: 'Frank uses CSS',
      polarity: 1,
      strength: 0.6,
      confidence: 0.7,
    });

    await addEvidence(store, {
      wpId,
      appId,
      conceptKey: 'css',
      ingestionSuffix: 'frank:css:neg',
      interactionType: 'interview',
      narrative: 'Frank lacks CSS skills',
      polarity: -1,
      strength: 0.4,
      confidence: 0.5,
    });

    // High-severity conflict on "api_design" (2 positive + 1 negative)
    await addEvidence(store, {
      wpId,
      appId,
      conceptKey: 'api_design',
      ingestionSuffix: 'frank:api:pos:0',
      interactionType: 'meeting',
      narrative: 'Source 0 says Frank knows API design',
      polarity: 1,
      strength: 0.85,
      confidence: 0.9,
    });

    await addEvidence(store, {
      wpId,
      appId,
      conceptKey: 'api_design',
      ingestionSuffix: 'frank:api:pos:1',
      interactionType: 'assessment',
      narrative: 'Source 1 says Frank knows API design',
      polarity: 1,
      strength: 0.85,
      confidence: 0.9,
    });

    await addEvidence(store, {
      wpId,
      appId,
      conceptKey: 'api_design',
      ingestionSuffix: 'frank:api:neg',
      interactionType: 'code_review',
      narrative: 'Code review shows poor API design',
      polarity: -1,
      strength: 0.6,
      confidence: 0.7,
    });

    const report = await detectEvidenceConflicts(db, 'c1');
    expect(report.totalConflicts).toBe(2);
    // High severity (api_design) should come first
    expect(report.conflicts[0]!.severity).toBe('high');
    expect(report.conflicts[0]!.conceptKey).toBe('api_design');
    expect(report.conflicts[1]!.severity).toBe('medium');
    expect(report.conflicts[1]!.conceptKey).toBe('css');
  });
});
