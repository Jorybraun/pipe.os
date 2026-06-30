import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockD1, type BetterSqliteDb } from '../../../__tests__/helpers/mockD1';

const livingContextMigration = readFileSync(
  new URL('../../../../migrations/0082_living_context_graph.sql', import.meta.url),
  'utf8',
);
const contextRecordsMigration = readFileSync(
  new URL('../../../../migrations/0095_context_records.sql', import.meta.url),
  'utf8',
);
const conceptRegistryMigration = readFileSync(
  new URL('../../../../migrations/0094_concept_registry.sql', import.meta.url),
  'utf8',
);

const NOW = "datetime('now')";

function seedContactWithLivingContext(sqlite: BetterSqliteDb, contactId: string, ownerId: string, wpId: string): void {
  sqlite.exec(`
    INSERT INTO contacts (id, owner_id, email, type, created_at, updated_at)
    VALUES ('${contactId}', '${ownerId}', '${contactId}@example.com', 'lead', ${NOW}, ${NOW});
    INSERT INTO people (id, ingestion_key, created_at, updated_at)
    VALUES ('person-${contactId}', 'ik-person-${contactId}', ${NOW}, ${NOW});
    INSERT INTO workspace_people (id, person_id, workspace_id, ingestion_key, context_json, created_at, updated_at)
    VALUES ('${wpId}', 'person-${contactId}', '${ownerId}', 'ik-wp-${wpId}', '{"contactId":"${contactId}"}', ${NOW}, ${NOW});
  `);
}

describe('contact living context timeline — criterion #1: contacts share one evolving person graph', () => {
  let sqlite: BetterSqliteDb;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec('PRAGMA foreign_keys = ON;');
    sqlite.exec(`
      CREATE TABLE contacts (id TEXT PRIMARY KEY, owner_id TEXT, email TEXT, type TEXT, created_at TEXT, updated_at TEXT);
    `);
    sqlite.exec(livingContextMigration);
    sqlite.exec(contextRecordsMigration);
    sqlite.exec(conceptRegistryMigration);
  });

  afterEach(() => {
    sqlite.close();
  });

  it('returns empty timeline when contact has no workspace person', async () => {
    sqlite.exec(`INSERT INTO contacts (id, owner_id, email, type, created_at, updated_at) VALUES ('c-1', 'user-1', 'a@b.com', 'lead', ${NOW}, ${NOW});`);
    const db = createMockD1(sqlite);

    const wp = await db.prepare(
      `SELECT wp.id FROM workspace_people wp WHERE json_extract(wp.context_json, '$.contactId') = ?1 LIMIT 1`,
    ).bind('c-1').first<{ id: string }>();

    expect(wp).toBeNull();
  });

  it('resolves workspace person for contact via context_json', async () => {
    seedContactWithLivingContext(sqlite, 'c-2', 'user-1', 'wp-2');
    const db = createMockD1(sqlite);

    const wp = await db.prepare(
      `SELECT wp.id FROM workspace_people wp WHERE json_extract(wp.context_json, '$.contactId') = ?1 LIMIT 1`,
    ).bind('c-2').first<{ id: string }>();

    expect(wp).not.toBeNull();
    expect(wp?.id).toBe('wp-2');
  });

  it('loads evidence timeline entries for contact with interactions', async () => {
    seedContactWithLivingContext(sqlite, 'c-3', 'user-1', 'wp-3');
    const db = createMockD1(sqlite);

    sqlite.exec(`
      INSERT INTO interactions (id, workspace_person_id, interaction_type, ingestion_key, created_at, updated_at)
      VALUES ('int-1', 'wp-3', 'meeting', 'ik-int-1', ${NOW}, ${NOW});
    `);

    const { loadPersonEvidenceTimeline } = await import('../../../lib/livingContext');
    const timeline = await loadPersonEvidenceTimeline(db, 'wp-3', { limit: 50 });
    expect(timeline.workspacePersonId).toBe('wp-3');
  });
});

describe('contact living context evidence-depth — criterion #1: parity with candidate evidence depth', () => {
  let sqlite: BetterSqliteDb;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec('PRAGMA foreign_keys = ON;');
    sqlite.exec(`
      CREATE TABLE contacts (id TEXT PRIMARY KEY, owner_id TEXT, email TEXT, type TEXT, created_at TEXT, updated_at TEXT);
    `);
    sqlite.exec(livingContextMigration);
    sqlite.exec(contextRecordsMigration);
    sqlite.exec(conceptRegistryMigration);
  });

  afterEach(() => {
    sqlite.close();
  });

  it('returns zero diversity when contact has no workspace person', async () => {
    sqlite.exec(`INSERT INTO contacts (id, owner_id, email, type, created_at, updated_at) VALUES ('c-1', 'user-1', 'a@b.com', 'lead', ${NOW}, ${NOW});`);
    const db = createMockD1(sqlite);

    const wp = await db.prepare(
      `SELECT wp.id FROM workspace_people wp WHERE json_extract(wp.context_json, '$.contactId') = ?1 LIMIT 1`,
    ).bind('c-1').first<{ id: string }>();

    expect(wp).toBeNull();
  });

  it('computes source diversity from distinct interaction types', async () => {
    seedContactWithLivingContext(sqlite, 'c-4', 'user-1', 'wp-4');
    const db = createMockD1(sqlite);

    sqlite.exec(`
      INSERT INTO interactions (id, workspace_person_id, interaction_type, ingestion_key, created_at, updated_at)
      VALUES
        ('int-1', 'wp-4', 'meeting', 'ik-int-1', ${NOW}, ${NOW}),
        ('int-2', 'wp-4', 'meeting', 'ik-int-2', ${NOW}, ${NOW}),
        ('int-3', 'wp-4', 'phone_call', 'ik-int-3', ${NOW}, ${NOW});
    `);

    const interactionBreakdown = await db.prepare(
      `SELECT interaction_type, COUNT(*) AS cnt
         FROM interactions
        WHERE workspace_person_id = ?1
        GROUP BY interaction_type
        ORDER BY cnt DESC`,
    ).bind('wp-4').all<{ interaction_type: string; cnt: number }>();

    const sources: Record<string, number> = {};
    let totalInteractions = 0;
    for (const row of interactionBreakdown.results ?? []) {
      sources[row.interaction_type] = row.cnt;
      totalInteractions += row.cnt;
    }

    expect(totalInteractions).toBe(3);
    expect(sources.meeting).toBe(2);
    expect(sources.phone_call).toBe(1);

    const distinctSourceTypes = Object.keys(sources).length;
    const sourceDiversity = Math.min(distinctSourceTypes / 6, 1);
    expect(sourceDiversity).toBeCloseTo(2 / 6);
  });

  it('returns top concepts from contact evidence', async () => {
    seedContactWithLivingContext(sqlite, 'c-5', 'user-1', 'wp-5');
    const db = createMockD1(sqlite);
    const now = Math.floor(Date.now() / 1000);

    sqlite.exec(`
      INSERT INTO interactions (id, workspace_person_id, interaction_type, ingestion_key, created_at, updated_at)
      VALUES ('int-1', 'wp-5', 'resume', 'ik-int-1', datetime('now'), datetime('now'));
      INSERT INTO episodes (id, workspace_person_id, interaction_id, narrative, ingestion_key, created_at, updated_at)
      VALUES ('ep-1', 'wp-5', 'int-1', 'Resume section', 'ik-ep-1', datetime('now'), datetime('now'));
      INSERT INTO semantic_assertions (id, workspace_person_id, episode_id, subject_type, predicate, narrative, ingestion_key, created_at, updated_at)
      VALUES ('sa-1', 'wp-5', 'ep-1', 'person', 'has_skill', 'Expert in TypeScript', 'ik-sa-1', datetime('now'), datetime('now'));
      INSERT INTO concepts (id, ingestion_key, canonical_key, namespace, label, aliases_json, metadata_json, observation_count, created_at, updated_at)
      VALUES ('concept-ts', 'ik-concept-ts', 'typescript', 'language', 'TypeScript', '[]', '{}', 1, datetime('now'), datetime('now'));
      INSERT INTO assertion_concepts (assertion_id, concept_id, relationship, weight, created_at)
      VALUES ('sa-1', 'concept-ts', 'about', 1.0, datetime('now'));
    `);

    const topConcepts = await db.prepare(
      `SELECT c.canonical_key, c.label, COUNT(DISTINCT ac.assertion_id) AS evidence_count
         FROM concepts c
         JOIN assertion_concepts ac ON ac.concept_id = c.id
         JOIN semantic_assertions sa ON sa.id = ac.assertion_id
        WHERE sa.workspace_person_id = ?1
        GROUP BY c.id, c.canonical_key, c.label
        ORDER BY evidence_count DESC
        LIMIT 20`,
    ).bind('wp-5').all<{ canonical_key: string; label: string; evidence_count: number }>();

    expect(topConcepts.results).toHaveLength(1);
    expect(topConcepts.results?.[0].canonical_key).toBe('typescript');
    expect(topConcepts.results?.[0].evidence_count).toBe(1);
  });
});
