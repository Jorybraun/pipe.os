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

const NOW = "datetime('now')";

function seedPerson(sqlite: BetterSqliteDb, id: string, wpId: string, appId: string, candidateId: string): void {
  sqlite.exec(`
    INSERT INTO people (id, ingestion_key, created_at, updated_at)
    VALUES ('${id}', 'ik-person-${id}', ${NOW}, ${NOW});
    INSERT INTO workspace_people (id, person_id, workspace_id, ingestion_key, context_json, created_at, updated_at)
    VALUES ('${wpId}', '${id}', 'ws-1', 'ik-wp-${wpId}', '{}', ${NOW}, ${NOW});
    INSERT INTO applications (id, workspace_person_id, legacy_candidate_id, ingestion_key, created_at, updated_at)
    VALUES ('${appId}', '${wpId}', '${candidateId}', 'ik-app-${appId}', ${NOW}, ${NOW});
  `);
}

describe('evidence-depth scoring — criteria #7/#8: evidence accumulation visibility', () => {
  let sqlite: BetterSqliteDb;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec('PRAGMA foreign_keys = ON;');
    sqlite.exec(`
      CREATE TABLE candidates (id TEXT PRIMARY KEY, owner_id TEXT, pipeline_id TEXT);
      CREATE TABLE pipelines (id TEXT PRIMARY KEY, owner_id TEXT);
    `);
    sqlite.exec(livingContextMigration);
    sqlite.exec(contextRecordsMigration);
  });

  afterEach(() => {
    sqlite.close();
  });

  it('returns zero diversity when candidate has no living context identity', async () => {
    sqlite.exec(`INSERT INTO candidates (id, owner_id) VALUES ('cand-1', 'user-1');`);
    const db = createMockD1(sqlite);

    const wp = await db.prepare(
      `SELECT wp.id FROM applications app
       JOIN workspace_people wp ON wp.id = app.workspace_person_id
       WHERE app.legacy_candidate_id = ?1 LIMIT 1`,
    ).bind('cand-1').first<{ id: string }>();

    expect(wp).toBeNull();
  });

  it('computes source diversity from distinct interaction types', async () => {
    sqlite.exec(`INSERT INTO candidates (id, owner_id) VALUES ('cand-2', 'user-1');`);
    seedPerson(sqlite, 'person-1', 'wp-1', 'app-1', 'cand-2');
    sqlite.exec(`
      INSERT INTO interactions (id, workspace_person_id, interaction_type, ingestion_key, metadata_json, created_at, updated_at)
      VALUES ('int-1', 'wp-1', 'resume_upload', 'ik-int-1', '{}', ${NOW}, ${NOW});
      INSERT INTO interactions (id, workspace_person_id, interaction_type, ingestion_key, metadata_json, created_at, updated_at)
      VALUES ('int-2', 'wp-1', 'meeting', 'ik-int-2', '{}', ${NOW}, ${NOW});
      INSERT INTO interactions (id, workspace_person_id, interaction_type, ingestion_key, metadata_json, created_at, updated_at)
      VALUES ('int-3', 'wp-1', 'code_review', 'ik-int-3', '{}', ${NOW}, ${NOW});
    `);

    const db = createMockD1(sqlite);

    const interactionBreakdown = await db.prepare(
      `SELECT interaction_type, COUNT(*) AS cnt
         FROM interactions
        WHERE workspace_person_id = ?1
        GROUP BY interaction_type
        ORDER BY cnt DESC`,
    ).bind('wp-1').all<{ interaction_type: string; cnt: number }>();

    const sources: Record<string, number> = {};
    let totalInteractions = 0;
    for (const row of interactionBreakdown.results ?? []) {
      sources[row.interaction_type] = row.cnt;
      totalInteractions += row.cnt;
    }

    const distinctSourceTypes = Object.keys(sources).length;
    const maxSourceTypes = 6;
    const sourceDiversity = Math.min(distinctSourceTypes / maxSourceTypes, 1);

    expect(totalInteractions).toBe(3);
    expect(sources).toEqual({ resume_upload: 1, meeting: 1, code_review: 1 });
    expect(sourceDiversity).toBeCloseTo(0.5); // 3/6
  });

  it('returns top concepts ranked by evidence count', async () => {
    sqlite.exec(`INSERT INTO candidates (id, owner_id) VALUES ('cand-3', 'user-1');`);
    seedPerson(sqlite, 'person-2', 'wp-2', 'app-2', 'cand-3');
    sqlite.exec(`
      INSERT INTO concepts (id, canonical_key, namespace, label, ingestion_key, created_at, updated_at)
      VALUES ('concept-1', 'term:typescript', 'term', 'TypeScript', 'ik-c-1', ${NOW}, ${NOW});
      INSERT INTO concepts (id, canonical_key, namespace, label, ingestion_key, created_at, updated_at)
      VALUES ('concept-2', 'term:react', 'term', 'React', 'ik-c-2', ${NOW}, ${NOW});
      INSERT INTO semantic_assertions (id, workspace_person_id, subject_type, predicate, narrative, polarity, ingestion_key, created_at, updated_at)
      VALUES ('assert-1', 'wp-2', 'person', 'demonstrates', 'uses TypeScript', 1, 'ik-sa-1', ${NOW}, ${NOW});
      INSERT INTO semantic_assertions (id, workspace_person_id, subject_type, predicate, narrative, polarity, ingestion_key, created_at, updated_at)
      VALUES ('assert-2', 'wp-2', 'person', 'demonstrates', 'uses React', 1, 'ik-sa-2', ${NOW}, ${NOW});
      INSERT INTO semantic_assertions (id, workspace_person_id, subject_type, predicate, narrative, polarity, ingestion_key, created_at, updated_at)
      VALUES ('assert-3', 'wp-2', 'person', 'demonstrates', 'advanced TS', 1, 'ik-sa-3', ${NOW}, ${NOW});
      INSERT INTO assertion_concepts (assertion_id, concept_id, relationship, weight, created_at)
      VALUES ('assert-1', 'concept-1', 'demonstrates', 1, ${NOW});
      INSERT INTO assertion_concepts (assertion_id, concept_id, relationship, weight, created_at)
      VALUES ('assert-2', 'concept-2', 'demonstrates', 1, ${NOW});
      INSERT INTO assertion_concepts (assertion_id, concept_id, relationship, weight, created_at)
      VALUES ('assert-3', 'concept-1', 'demonstrates', 1, ${NOW});
    `);

    const db = createMockD1(sqlite);

    const topConcepts = await db.prepare(
      `SELECT c.canonical_key, c.label, COUNT(DISTINCT ac.assertion_id) AS evidence_count
         FROM concepts c
         JOIN assertion_concepts ac ON ac.concept_id = c.id
         JOIN semantic_assertions sa ON sa.id = ac.assertion_id
        WHERE sa.workspace_person_id = ?1
        GROUP BY c.id, c.canonical_key, c.label
        ORDER BY evidence_count DESC
        LIMIT 20`,
    ).bind('wp-2').all<{ canonical_key: string; label: string; evidence_count: number }>();

    const concepts = (topConcepts.results ?? []).map((row) => ({
      key: row.canonical_key,
      label: row.label,
      evidenceCount: row.evidence_count,
    }));

    expect(concepts).toHaveLength(2);
    expect(concepts[0]).toEqual({ key: 'term:typescript', label: 'TypeScript', evidenceCount: 2 });
    expect(concepts[1]).toEqual({ key: 'term:react', label: 'React', evidenceCount: 1 });
  });

  it('diversity reaches 1.0 when all source types present', () => {
    const sources = {
      resume_upload: 1,
      meeting: 2,
      culture_interview: 1,
      code_review: 1,
      phone_call: 1,
      assessment: 1,
    };
    const distinctSourceTypes = Object.keys(sources).length;
    const maxSourceTypes = 6;
    const sourceDiversity = Math.min(distinctSourceTypes / maxSourceTypes, 1);
    expect(sourceDiversity).toBe(1);
  });
});
