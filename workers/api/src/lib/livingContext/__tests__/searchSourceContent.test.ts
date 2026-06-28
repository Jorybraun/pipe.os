import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockD1, type BetterSqliteDb } from '../../../__tests__/helpers/mockD1';
import { searchSourceContent } from '../readModel';

const livingContextMigration = readFileSync(
  new URL('../../../../migrations/0082_living_context_graph.sql', import.meta.url),
  'utf8',
);
const transcriptProjectionMigration = readFileSync(
  new URL('../../../../migrations/0091_transcript_semantic_projections.sql', import.meta.url),
  'utf8',
);
const contextRecordMigration = readFileSync(
  new URL('../../../../migrations/0095_context_records.sql', import.meta.url),
  'utf8',
);

describe('searchSourceContent — criterion #2: original content searchable', () => {
  let sqlite: BetterSqliteDb;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec('PRAGMA foreign_keys = ON;');
    sqlite.exec(livingContextMigration);
    sqlite.exec(transcriptProjectionMigration);
    sqlite.exec(contextRecordMigration);
    db = createMockD1(sqlite);
  });

  afterEach(() => {
    sqlite.close();
  });

  let seqCounter = 0;
  function nextSeq(): number {
    return ++seqCounter;
  }

  function seedPerson(wpId: string, personId: string): void {
    const seq = nextSeq();
    sqlite.exec(`
      INSERT INTO people (id, ingestion_key, display_name, primary_email, created_at, updated_at)
      VALUES ('${personId}', 'ik-person-${seq}', 'Test Person', 'test@example.com', datetime('now'), datetime('now'));
      INSERT INTO workspace_people (id, ingestion_key, workspace_id, person_id, context_json, created_at, updated_at)
      VALUES ('${wpId}', 'ik-wp-${seq}', 'ws-1', '${personId}', '{}', datetime('now'), datetime('now'));
    `);
  }

  function seedInteractionWithSpan(
    wpId: string,
    interactionId: string,
    artifactType: string,
    exactText: string,
  ): string {
    const seq = nextSeq();
    const artId = `art-${interactionId}`;
    const avId = `av-${interactionId}`;
    const spanId = `span-${interactionId}`;
    sqlite.exec(`
      INSERT INTO interactions (id, ingestion_key, workspace_person_id, interaction_type, metadata_json, created_at, updated_at)
      VALUES ('${interactionId}', 'ik-int-${seq}', '${wpId}', 'meeting', '{}', datetime('now'), datetime('now'));
      INSERT INTO artifacts (id, ingestion_key, interaction_id, artifact_type, metadata_json, created_at, updated_at)
      VALUES ('${artId}', 'ik-art-${seq}', '${interactionId}', '${artifactType}', '{}', datetime('now'), datetime('now'));
      INSERT INTO artifact_versions (id, ingestion_key, artifact_id, version_number, content_hash, media_type, content_text, created_at)
      VALUES ('${avId}', 'ik-av-${seq}', '${artId}', 1, 'hash-${interactionId}', 'text/plain', '${exactText}', datetime('now'));
      INSERT INTO source_spans (id, ingestion_key, artifact_version_id, exact_text, exact_text_hash, metadata_json, created_at)
      VALUES ('${spanId}', 'ik-span-${seq}', '${avId}', '${exactText}', 'texthash-${interactionId}', '{}', datetime('now'));
    `);
    return spanId;
  }

  it('returns empty for empty query', async () => {
    seedPerson('wp-1', 'person-1');
    const result = await searchSourceContent(db, 'wp-1', '');
    expect(result.personId).toBe('wp-1');
    expect(result.query).toBe('');
    expect(result.hits).toHaveLength(0);
  });

  it('returns empty for nonexistent workspace person', async () => {
    const result = await searchSourceContent(db, 'wp-nonexistent', 'test');
    expect(result.hits).toHaveLength(0);
  });

  it('finds source spans matching query text across artifacts', async () => {
    seedPerson('wp-1', 'person-1');
    seedInteractionWithSpan('wp-1', 'int-1', 'meeting_transcript', 'Built microservices with Kubernetes');
    seedInteractionWithSpan('wp-1', 'int-2', 'resume', 'Led team of 5 engineers building React apps');

    const result = await searchSourceContent(db, 'wp-1', 'building');
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]!.exactText).toBe('Led team of 5 engineers building React apps');
    expect(result.hits[0]!.matchOffset).toBeGreaterThanOrEqual(0);
    expect(result.hits[0]!.matchLength).toBe(8);
  });

  it('returns hits with artifact metadata and match offsets', async () => {
    seedPerson('wp-1', 'person-1');
    seedInteractionWithSpan('wp-1', 'int-1', 'meeting_transcript', 'Deployed production Kubernetes clusters');

    const result = await searchSourceContent(db, 'wp-1', 'Kubernetes');
    expect(result.hits).toHaveLength(1);
    const hit = result.hits[0]!;
    expect(hit.artifactType).toBe('meeting_transcript');
    expect(hit.sourceSpanId).toBe('span-int-1');
    expect(hit.matchOffset).toBe('Deployed production '.length);
    expect(hit.matchLength).toBe('Kubernetes'.length);
  });

  it('is case-insensitive', async () => {
    seedPerson('wp-1', 'person-1');
    seedInteractionWithSpan('wp-1', 'int-1', 'resume', 'TypeScript Expert');

    const result = await searchSourceContent(db, 'wp-1', 'typescript');
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]!.exactText).toBe('TypeScript Expert');
  });

  it('falls back to assertion narratives when no source spans match', async () => {
    seedPerson('wp-1', 'person-1');
    const seq = nextSeq();

    const assertionId = 'assertion-1';
    const conceptId = 'concept-react';
    sqlite.exec(`
      INSERT INTO concepts (id, ingestion_key, canonical_key, namespace, label, created_at, updated_at)
      VALUES ('${conceptId}', 'ik-concept-${seq}', 'react', 'skill', 'React', datetime('now'), datetime('now'));
      INSERT INTO semantic_assertions (
        id, ingestion_key, workspace_person_id, subject_type, subject_id,
        predicate, narrative,
        qualifiers_json, created_at, updated_at
      ) VALUES (
        '${assertionId}', 'ik-assert-${seq}', 'wp-1', 'person', 'wp-1',
        'demonstrates_skill',
        'Candidate demonstrates deep React expertise across multiple projects',
        '{}', datetime('now'), datetime('now')
      );
      INSERT INTO assertion_concepts (assertion_id, concept_id, relationship, weight, created_at)
      VALUES ('${assertionId}', '${conceptId}', 'subject', 1.0, datetime('now'));
    `);

    const result = await searchSourceContent(db, 'wp-1', 'React expertise');
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]!.exactText).toContain('React expertise');
    expect(result.hits[0]!.citingAssertionIds).toContain(assertionId);
    expect(result.hits[0]!.conceptKeys).toContain('react');
  });

  it('includes citing assertions for source span hits', async () => {
    seedPerson('wp-1', 'person-1');
    const spanId = seedInteractionWithSpan('wp-1', 'int-1', 'meeting_transcript', 'Designed distributed caching layer');

    const seq = nextSeq();
    const assertionId = 'assertion-span-link';
    sqlite.exec(`
      INSERT INTO semantic_assertions (
        id, ingestion_key, workspace_person_id, subject_type, subject_id,
        predicate, narrative,
        qualifiers_json, created_at, updated_at
      ) VALUES (
        '${assertionId}', 'ik-assert-${seq}', 'wp-1', 'person', 'wp-1',
        'demonstrates_skill',
        'Caching system design',
        '{}', datetime('now'), datetime('now')
      );
      INSERT INTO assertion_source_spans (assertion_id, source_span_id, evidence_role, created_at)
      VALUES ('${assertionId}', '${spanId}', 'support', datetime('now'));
    `);

    const result = await searchSourceContent(db, 'wp-1', 'caching');
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]!.citingAssertionIds).toContain(assertionId);
  });

  it('escapes SQL wildcards in search query', async () => {
    seedPerson('wp-1', 'person-1');
    seedInteractionWithSpan('wp-1', 'int-1', 'resume', 'Used 100% test coverage');

    const result = await searchSourceContent(db, 'wp-1', '100%');
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]!.exactText).toContain('100%');
  });

  it('respects limit parameter', async () => {
    seedPerson('wp-1', 'person-1');
    for (let i = 0; i < 5; i++) {
      seedInteractionWithSpan('wp-1', `int-${i}`, 'resume', `matching text variant ${i}`);
    }

    const result = await searchSourceContent(db, 'wp-1', 'matching', 2);
    expect(result.hits).toHaveLength(2);
  });
});
