import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockD1, type BetterSqliteDb } from '../../../__tests__/helpers/mockD1';
import { mergeConcepts, splitConcept, queryConceptEvolution } from '../conceptEvolution';

const livingContextMigration = readFileSync(
  new URL('../../../../migrations/0082_living_context_graph.sql', import.meta.url),
  'utf8',
);
const conceptRegistryMigration = readFileSync(
  new URL('../../../../migrations/0094_concept_registry.sql', import.meta.url),
  'utf8',
);
const evolutionMigration = readFileSync(
  new URL('../../../../migrations/0109_concept_evolution_events.sql', import.meta.url),
  'utf8',
);

const NOW = "datetime('now')";

function seedConcepts(sqlite: BetterSqliteDb): { conceptA: string; conceptB: string; conceptC: string } {
  const now = Math.floor(Date.now() / 1000);
  sqlite.exec(`
    INSERT INTO concepts (id, ingestion_key, canonical_key, namespace, label, observation_count, created_at, updated_at)
    VALUES
      ('con-a', 'ik-con-a', 'typescript', 'skill', 'TypeScript', 3, ${NOW}, ${NOW}),
      ('con-b', 'ik-con-b', 'ts', 'skill', 'TS', 2, ${NOW}, ${NOW}),
      ('con-c', 'ik-con-c', 'react', 'skill', 'React', 5, ${NOW}, ${NOW});

    INSERT INTO concept_surfaces (id, ingestion_key, concept_id, surface, normalized_surface, observed_at, created_at)
    VALUES
      ('surf-1', 'ik-surf-1', 'con-a', 'TypeScript', 'typescript', ${now}, ${now}),
      ('surf-2', 'ik-surf-2', 'con-a', 'typescript', 'typescript', ${now}, ${now}),
      ('surf-3', 'ik-surf-3', 'con-b', 'TS', 'ts', ${now}, ${now}),
      ('surf-4', 'ik-surf-4', 'con-b', 'ts', 'ts', ${now}, ${now}),
      ('surf-5', 'ik-surf-5', 'con-c', 'React', 'react', ${now}, ${now}),
      ('surf-6', 'ik-surf-6', 'con-c', 'ReactJS', 'reactjs', ${now}, ${now});

    INSERT INTO concept_adjacency (id, ingestion_key, from_concept_id, to_concept_id, dimension, stretch_allowed, observed_at, created_at)
    VALUES
      ('adj-1', 'ik-adj-1', 'con-b', 'con-c', 'co-occurrence', 1, ${now}, ${now});
  `);

  return { conceptA: 'con-a', conceptB: 'con-b', conceptC: 'con-c' };
}

function seedAssertionConcepts(sqlite: BetterSqliteDb): void {
  sqlite.exec(`
    INSERT INTO people (id, ingestion_key, created_at, updated_at)
    VALUES ('person-1', 'ik-person-1', ${NOW}, ${NOW});
    INSERT INTO workspace_people (id, person_id, workspace_id, ingestion_key, context_json, created_at, updated_at)
    VALUES ('wp-1', 'person-1', 'ws-1', 'ik-wp-1', '{}', ${NOW}, ${NOW});
    INSERT INTO semantic_assertions (id, ingestion_key, workspace_person_id, subject_type, predicate, narrative, confidence, polarity, created_at, updated_at)
    VALUES ('assert-1', 'ik-assert-1', 'wp-1', 'workspace_person', 'demonstrates', 'Candidate knows TypeScript well', 0.9, 1, ${NOW}, ${NOW});
    INSERT INTO assertion_concepts (assertion_id, concept_id, relationship, weight, created_at)
    VALUES ('assert-1', 'con-b', 'demonstrates', 1.0, ${NOW});
  `);
}

describe('conceptEvolution — criterion #3: concepts evolve through evidence', () => {
  let sqlite: BetterSqliteDb;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec('PRAGMA foreign_keys = ON;');
    sqlite.exec(livingContextMigration);
    sqlite.exec(conceptRegistryMigration);
    sqlite.exec(evolutionMigration);
    db = createMockD1(sqlite);
  });

  afterEach(() => {
    sqlite.close();
  });

  describe('mergeConcepts', () => {
    it('merges two concepts, repoints surfaces and adjacencies to survivor', async () => {
      const { conceptA, conceptB } = seedConcepts(sqlite);

      const result = await mergeConcepts(db, {
        survivorConceptId: conceptA,
        absorbedConceptIds: [conceptB],
        reason: 'TS is an alias for TypeScript',
      });

      expect(result.survivorConceptId).toBe(conceptA);
      expect(result.survivorCanonicalKey).toBe('typescript');
      expect(result.mergedCount).toBe(1);
      expect(result.surfacesRepointed).toBe(2);
      expect(result.adjacenciesRepointed).toBeGreaterThanOrEqual(1);
      expect(result.eventId).toMatch(/^cev_/);

      // Verify absorbed concept is superseded
      const absorbed = sqlite.prepare('SELECT superseded_by_id, superseded_at FROM concepts WHERE id = ?').get(conceptB) as { superseded_by_id: string; superseded_at: number };
      expect(absorbed.superseded_by_id).toBe(conceptA);
      expect(absorbed.superseded_at).toBeGreaterThan(0);

      // Verify surfaces now belong to survivor
      const surfaces = sqlite.prepare('SELECT COUNT(*) as count FROM concept_surfaces WHERE concept_id = ?').get(conceptA) as { count: number };
      expect(surfaces.count).toBe(4); // 2 original + 2 repointed
    });

    it('repoints assertion_concepts links during merge', async () => {
      const { conceptA, conceptB } = seedConcepts(sqlite);
      seedAssertionConcepts(sqlite);

      const result = await mergeConcepts(db, {
        survivorConceptId: conceptA,
        absorbedConceptIds: [conceptB],
        reason: 'Consolidating aliases',
      });

      expect(result.assertionLinksRepointed).toBe(1);

      // Verify assertion now links to survivor
      const link = sqlite.prepare('SELECT concept_id FROM assertion_concepts WHERE assertion_id = ?').get('assert-1') as { concept_id: string };
      expect(link.concept_id).toBe(conceptA);
    });

    it('throws when survivor is in absorbed list', async () => {
      seedConcepts(sqlite);
      await expect(mergeConcepts(db, {
        survivorConceptId: 'con-a',
        absorbedConceptIds: ['con-a'],
        reason: 'invalid',
      })).rejects.toThrow('Survivor concept cannot be in absorbed list');
    });

    it('throws when absorbed list is empty', async () => {
      seedConcepts(sqlite);
      await expect(mergeConcepts(db, {
        survivorConceptId: 'con-a',
        absorbedConceptIds: [],
        reason: 'nothing',
      })).rejects.toThrow('at least one absorbed concept');
    });

    it('merges multiple concepts at once', async () => {
      const { conceptA, conceptB, conceptC } = seedConcepts(sqlite);

      const result = await mergeConcepts(db, {
        survivorConceptId: conceptA,
        absorbedConceptIds: [conceptB, conceptC],
        reason: 'Consolidating all frontend concepts',
      });

      expect(result.mergedCount).toBe(2);
      expect(result.surfacesRepointed).toBe(4); // 2 from B + 2 from C
    });
  });

  describe('splitConcept', () => {
    it('splits surfaces from one concept into a new concept', async () => {
      seedConcepts(sqlite);

      const result = await splitConcept(db, {
        sourceConceptId: 'con-c',
        newCanonicalKey: 'react_native',
        newLabel: 'React Native',
        surfaceIdsToMove: ['surf-6'],
        reason: 'ReactJS is actually React Native in this context',
      });

      expect(result.newConceptId).toMatch(/^con_/);
      expect(result.newCanonicalKey).toBe('react_native');
      expect(result.surfacesMoved).toBe(1);
      expect(result.eventId).toMatch(/^cev_/);

      // Verify source concept still has remaining surfaces
      const remaining = sqlite.prepare('SELECT COUNT(*) as count FROM concept_surfaces WHERE concept_id = ?').get('con-c') as { count: number };
      expect(remaining.count).toBe(1);

      // Verify new concept has moved surface
      const newSurfaces = sqlite.prepare('SELECT COUNT(*) as count FROM concept_surfaces WHERE concept_id = ?').get(result.newConceptId) as { count: number };
      expect(newSurfaces.count).toBe(1);
    });

    it('throws when surface does not belong to source concept', async () => {
      seedConcepts(sqlite);

      await expect(splitConcept(db, {
        sourceConceptId: 'con-a',
        newCanonicalKey: 'new_concept',
        newLabel: 'New',
        surfaceIdsToMove: ['surf-5'],
        reason: 'invalid',
      })).rejects.toThrow('does not belong to source concept');
    });

    it('throws when no surfaces to move', async () => {
      seedConcepts(sqlite);

      await expect(splitConcept(db, {
        sourceConceptId: 'con-a',
        newCanonicalKey: 'new',
        newLabel: 'New',
        surfaceIdsToMove: [],
        reason: 'empty',
      })).rejects.toThrow('at least one surface to move');
    });
  });

  describe('queryConceptEvolution', () => {
    it('returns evolution timeline for a concept with merge events', async () => {
      const { conceptA, conceptB } = seedConcepts(sqlite);

      await mergeConcepts(db, {
        survivorConceptId: conceptA,
        absorbedConceptIds: [conceptB],
        reason: 'TS → TypeScript consolidation',
      });

      const timeline = await queryConceptEvolution(db, conceptA);

      expect(timeline.conceptId).toBe(conceptA);
      expect(timeline.canonicalKey).toBe('typescript');
      expect(timeline.events).toHaveLength(1);
      expect(timeline.events[0].eventType).toBe('merge');
      expect(timeline.events[0].absorbedConceptIds).toContain(conceptB);
      expect(timeline.events[0].reason).toBe('TS → TypeScript consolidation');
      expect(timeline.currentAliases.length).toBeGreaterThanOrEqual(2);
    });

    it('returns supersession chain for absorbed concept', async () => {
      const { conceptA, conceptB } = seedConcepts(sqlite);

      await mergeConcepts(db, {
        survivorConceptId: conceptA,
        absorbedConceptIds: [conceptB],
        reason: 'merge',
      });

      const timeline = await queryConceptEvolution(db, conceptB);
      expect(timeline.supersessionChain).toHaveLength(1);
      expect(timeline.supersessionChain[0].fromConceptId).toBe(conceptB);
      expect(timeline.supersessionChain[0].toConceptId).toBe(conceptA);
    });

    it('returns empty timeline for concept with no evolution history', async () => {
      seedConcepts(sqlite);

      const timeline = await queryConceptEvolution(db, 'con-c');
      expect(timeline.events).toHaveLength(0);
      expect(timeline.supersessionChain).toHaveLength(0);
      expect(timeline.currentAliases).toContain('React');
    });

    it('filters events by since parameter', async () => {
      const { conceptA, conceptB } = seedConcepts(sqlite);

      await mergeConcepts(db, {
        survivorConceptId: conceptA,
        absorbedConceptIds: [conceptB],
        reason: 'first merge',
      });

      const futureDate = new Date(Date.now() + 86400000).toISOString();
      const timeline = await queryConceptEvolution(db, conceptA, { since: futureDate });
      expect(timeline.events).toHaveLength(0);
    });
  });
});
