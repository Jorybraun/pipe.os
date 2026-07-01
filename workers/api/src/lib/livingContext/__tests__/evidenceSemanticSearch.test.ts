import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockD1, type BetterSqliteDb } from '../../../__tests__/helpers/mockD1';
import { searchEvidence } from '../evidenceSemanticSearch';

const livingContextMigration = readFileSync(
  new URL('../../../../migrations/0082_living_context_graph.sql', import.meta.url),
  'utf8',
);
const conceptRegistryMigration = readFileSync(
  new URL('../../../../migrations/0094_concept_registry.sql', import.meta.url),
  'utf8',
);

const NOW = "datetime('now')";

function seedEvidenceData(sqlite: BetterSqliteDb): string {
  const wpId = 'wp-search-1';
  const now = Math.floor(Date.now() / 1000);
  sqlite.exec(`
    INSERT INTO people (id, ingestion_key, created_at, updated_at)
    VALUES ('person-s1', 'ik-person-s1', ${NOW}, ${NOW});
    INSERT INTO workspace_people (id, person_id, workspace_id, ingestion_key, context_json, created_at, updated_at)
    VALUES ('${wpId}', 'person-s1', 'ws-1', 'ik-wp-s1', '{}', ${NOW}, ${NOW});

    -- Interactions
    INSERT INTO interactions (id, workspace_person_id, interaction_type, started_at, ingestion_key, created_at, updated_at)
    VALUES
      ('int-s1', '${wpId}', 'meeting', '2026-06-15T10:00:00Z', 'ik-int-s1', ${NOW}, ${NOW}),
      ('int-s2', '${wpId}', 'resume_review', '2026-06-10T08:00:00Z', 'ik-int-s2', ${NOW}, ${NOW});

    -- Artifacts
    INSERT INTO artifacts (id, interaction_id, artifact_type, logical_key, ingestion_key, created_at, updated_at)
    VALUES
      ('art-s1', 'int-s1', 'transcript', 'meeting-20260615', 'ik-art-s1', ${NOW}, ${NOW}),
      ('art-s2', 'int-s2', 'resume', 'resume-v1', 'ik-art-s2', ${NOW}, ${NOW});
    INSERT INTO artifact_versions (id, artifact_id, version_number, content_hash, media_type, content_text, ingestion_key, created_at)
    VALUES
      ('av-s1', 'art-s1', 1, 'hash1', 'text/plain', 'transcript content', 'ik-av-s1', ${NOW}),
      ('av-s2', 'art-s2', 1, 'hash2', 'text/plain', 'resume content', 'ik-av-s2', ${NOW});

    -- Source spans
    INSERT INTO source_spans (id, artifact_version_id, exact_text, exact_text_hash, char_start, char_end, line_start, line_end, ingestion_key, created_at)
    VALUES
      ('ss-s1', 'av-s1', 'I have extensive experience with Kubernetes cluster management and container orchestration', 'h1', 0, 91, 1, 1, 'ik-ss-s1', ${NOW}),
      ('ss-s2', 'av-s1', 'Previously led a team migrating microservices to a service mesh architecture', 'h2', 92, 168, 2, 2, 'ik-ss-s2', ${NOW}),
      ('ss-s3', 'av-s2', 'Senior Backend Engineer with expertise in distributed systems and Go programming', 'h3', 0, 80, 1, 1, 'ik-ss-s3', ${NOW}),
      ('ss-s4', 'av-s2', 'Built real-time data pipelines processing 10M events per second using Kafka', 'h4', 81, 155, 2, 2, 'ik-ss-s4', ${NOW});

    -- Semantic assertions
    INSERT INTO semantic_assertions (id, ingestion_key, workspace_person_id, subject_type, predicate, narrative, confidence, polarity, observed_at, created_at, updated_at)
    VALUES
      ('sa-s1', 'ik-sa-s1', '${wpId}', 'workspace_person', 'demonstrates', 'Candidate demonstrates strong Kubernetes expertise at production scale', 0.92, 1, '2026-06-15T10:00:00Z', ${NOW}, ${NOW}),
      ('sa-s2', 'ik-sa-s2', '${wpId}', 'workspace_person', 'led', 'Candidate has led microservices migration projects', 0.85, 1, '2026-06-15T10:00:00Z', ${NOW}, ${NOW}),
      ('sa-s3', 'ik-sa-s3', '${wpId}', 'workspace_person', 'demonstrates', 'Candidate has distributed systems background with real-time processing', 0.88, 1, '2026-06-10T08:00:00Z', ${NOW}, ${NOW});

    -- Concepts
    INSERT INTO concepts (id, ingestion_key, canonical_key, namespace, label, observation_count, created_at, updated_at)
    VALUES
      ('con-k8s', 'ik-con-k8s', 'kubernetes', 'skill', 'Kubernetes', 5, ${NOW}, ${NOW}),
      ('con-go', 'ik-con-go', 'golang', 'skill', 'Go', 3, ${NOW}, ${NOW}),
      ('con-dist', 'ik-con-dist', 'distributed_systems', 'domain', 'Distributed Systems', 4, ${NOW}, ${NOW});

    -- Concept surfaces
    INSERT INTO concept_surfaces (id, ingestion_key, concept_id, surface, normalized_surface, observed_at, created_at)
    VALUES
      ('cs-1', 'ik-cs-1', 'con-k8s', 'Kubernetes', 'kubernetes', ${now}, ${now}),
      ('cs-2', 'ik-cs-2', 'con-k8s', 'k8s', 'k8s', ${now}, ${now}),
      ('cs-3', 'ik-cs-3', 'con-go', 'Go', 'go', ${now}, ${now}),
      ('cs-4', 'ik-cs-4', 'con-dist', 'distributed systems', 'distributed_systems', ${now}, ${now});

    -- Assertion → concept links
    INSERT INTO assertion_concepts (assertion_id, concept_id, relationship, weight, created_at)
    VALUES
      ('sa-s1', 'con-k8s', 'demonstrates', 1.0, ${NOW}),
      ('sa-s3', 'con-dist', 'demonstrates', 1.0, ${NOW}),
      ('sa-s3', 'con-go', 'demonstrates', 0.8, ${NOW});
  `);
  return wpId;
}

describe('evidenceSemanticSearch — criterion #2: original content semantically searchable', () => {
  let sqlite: BetterSqliteDb;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec('PRAGMA foreign_keys = ON;');
    sqlite.exec(livingContextMigration);
    sqlite.exec(conceptRegistryMigration);
    db = createMockD1(sqlite);
  });

  afterEach(() => {
    sqlite.close();
  });

  describe('text strategy', () => {
    it('finds source spans matching query text', async () => {
      const wpId = seedEvidenceData(sqlite);

      const result = await searchEvidence(db, wpId, 'Kubernetes', { strategy: 'text' });

      expect(result.hits.length).toBeGreaterThanOrEqual(1);
      const spanHit = result.hits.find((h) => h.hitType === 'source_span');
      expect(spanHit).toBeDefined();
      expect(spanHit!.text).toContain('Kubernetes');
      expect(spanHit!.matchedOn).toBe('text');
      expect(spanHit!.provenance.interactionType).toBe('meeting');
    });

    it('finds assertions matching query text', async () => {
      const wpId = seedEvidenceData(sqlite);

      const result = await searchEvidence(db, wpId, 'microservices migration', { strategy: 'text' });

      expect(result.hits.length).toBeGreaterThanOrEqual(1);
      const assertionHit = result.hits.find((h) => h.hitType === 'assertion');
      expect(assertionHit).toBeDefined();
      expect(assertionHit!.text).toContain('microservices migration');
    });

    it('returns empty results for non-matching query', async () => {
      const wpId = seedEvidenceData(sqlite);

      const result = await searchEvidence(db, wpId, 'quantum computing', { strategy: 'text' });
      expect(result.hits).toHaveLength(0);
    });

    it('returns empty for empty query', async () => {
      const wpId = seedEvidenceData(sqlite);

      const result = await searchEvidence(db, wpId, '  ', { strategy: 'text' });
      expect(result.hits).toHaveLength(0);
    });
  });

  describe('concept strategy', () => {
    it('finds assertions linked to matching concepts', async () => {
      const wpId = seedEvidenceData(sqlite);

      const result = await searchEvidence(db, wpId, 'kubernetes', { strategy: 'concept' });

      expect(result.conceptsMatched).toContain('kubernetes');
      expect(result.hits.length).toBeGreaterThanOrEqual(1);
      const hit = result.hits.find((h) => h.id === 'sa-s1');
      expect(hit).toBeDefined();
      expect(hit!.matchedOn).toBe('concept');
      expect(hit!.conceptKeys).toContain('kubernetes');
    });

    it('matches concepts by surface alias', async () => {
      const wpId = seedEvidenceData(sqlite);

      const result = await searchEvidence(db, wpId, 'k8s', { strategy: 'concept' });

      expect(result.conceptsMatched).toContain('kubernetes');
      expect(result.hits.length).toBeGreaterThanOrEqual(1);
    });

    it('returns multiple concept matches', async () => {
      const wpId = seedEvidenceData(sqlite);

      const result = await searchEvidence(db, wpId, 'distributed', { strategy: 'concept' });

      expect(result.conceptsMatched).toContain('distributed_systems');
      expect(result.hits.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('hybrid strategy', () => {
    it('combines text and concept results, deduplicating', async () => {
      const wpId = seedEvidenceData(sqlite);

      const result = await searchEvidence(db, wpId, 'Kubernetes', { strategy: 'hybrid' });

      expect(result.hits.length).toBeGreaterThanOrEqual(2);
      expect(result.strategy).toBe('hybrid');

      // No duplicate IDs
      const ids = result.hits.map((h) => `${h.hitType}:${h.id}`);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('enriches text hits with concept keys when both match', async () => {
      const wpId = seedEvidenceData(sqlite);

      const result = await searchEvidence(db, wpId, 'Kubernetes', { strategy: 'hybrid' });

      const enrichedHit = result.hits.find((h) => h.id === 'sa-s1');
      if (enrichedHit) {
        expect(enrichedHit.conceptKeys).toContain('kubernetes');
      }
    });

    it('ranks results by relevance score descending', async () => {
      const wpId = seedEvidenceData(sqlite);

      const result = await searchEvidence(db, wpId, 'Kubernetes', { strategy: 'hybrid' });

      for (let i = 1; i < result.hits.length; i++) {
        expect(result.hits[i - 1].relevanceScore).toBeGreaterThanOrEqual(result.hits[i].relevanceScore);
      }
    });
  });

  describe('filters', () => {
    it('filters by minimum confidence', async () => {
      const wpId = seedEvidenceData(sqlite);

      const result = await searchEvidence(db, wpId, 'Kubernetes', {
        strategy: 'hybrid',
        minConfidence: 0.90,
      });

      for (const hit of result.hits) {
        if (hit.confidence != null) {
          expect(hit.confidence).toBeGreaterThanOrEqual(0.90);
        }
      }
    });

    it('filters by interaction type', async () => {
      const wpId = seedEvidenceData(sqlite);

      const result = await searchEvidence(db, wpId, 'distributed systems', {
        strategy: 'text',
        interactionTypes: ['resume_review'],
      });

      for (const hit of result.hits) {
        if (hit.provenance.interactionType) {
          expect(hit.provenance.interactionType).toBe('resume_review');
        }
      }
    });

    it('respects limit parameter', async () => {
      const wpId = seedEvidenceData(sqlite);

      const result = await searchEvidence(db, wpId, 'e', { strategy: 'text', limit: 2 });
      expect(result.hits.length).toBeLessThanOrEqual(2);
    });
  });

  describe('provenance', () => {
    it('returns full provenance on source span hits', async () => {
      const wpId = seedEvidenceData(sqlite);

      const result = await searchEvidence(db, wpId, 'Kubernetes', { strategy: 'text' });

      const spanHit = result.hits.find((h) => h.hitType === 'source_span');
      expect(spanHit).toBeDefined();
      expect(spanHit!.provenance.interactionId).toBe('int-s1');
      expect(spanHit!.provenance.interactionType).toBe('meeting');
      expect(spanHit!.provenance.artifactId).toBe('art-s1');
      expect(spanHit!.provenance.artifactType).toBe('transcript');
      expect(spanHit!.sourceSpanId).toBeTruthy();
      expect(spanHit!.charStart).toBe(0);
      expect(spanHit!.charEnd).toBe(91);
    });
  });
});
