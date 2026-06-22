import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockD1, type BetterSqliteDb } from '../../../__tests__/helpers/mockD1';
import { createConceptRegistry, type ConceptRegistry } from '../conceptRegistry';
import { ensureContactLivingContext } from '../compatibility';
import { ingestMeetingTranscriptToLivingContext } from '../meetingTranscript';

const livingContextMigration = readFileSync(
  new URL('../../../../migrations/0082_living_context_graph.sql', import.meta.url),
  'utf8',
);
const transcriptProjectionMigration = readFileSync(
  new URL('../../../../migrations/0091_transcript_semantic_projections.sql', import.meta.url),
  'utf8',
);
const conceptRegistryMigration = readFileSync(
  new URL('../../../../migrations/0094_concept_registry.sql', import.meta.url),
  'utf8',
);

const provenance = {
  evidenceEntityType: 'fixture',
  evidenceEntityId: 'fixture-1',
  evidenceLocator: 'fixture:line:1',
} as const;

describe('concept aliasing across resume + meeting + review — criterion #3 regression', () => {
  let sqlite: BetterSqliteDb;
  let db: D1Database;
  let registry: ConceptRegistry;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec('PRAGMA foreign_keys = ON;');
    sqlite.exec(`CREATE TABLE candidates (id TEXT PRIMARY KEY);`);
    sqlite.exec(`
      CREATE TABLE contacts (
        id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, name TEXT, email TEXT,
        phone TEXT, company TEXT, role TEXT, type TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE meetings (
        id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, started_at TEXT,
        ended_at TEXT, updated_at TEXT NOT NULL
      );
      CREATE TABLE meeting_participants (
        id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL REFERENCES meetings(id),
        contact_id TEXT NOT NULL REFERENCES contacts(id), role TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    sqlite.exec(livingContextMigration);
    sqlite.exec(transcriptProjectionMigration);
    sqlite.exec(conceptRegistryMigration);
    sqlite.exec(`
      CREATE TABLE role_nodes (
        id TEXT PRIMARY KEY, rcd_version TEXT NOT NULL, source_section TEXT,
        narrative_text TEXT NOT NULL, extracted_properties_json TEXT,
        superseded_at INTEGER
      );
    `);
    db = createMockD1(sqlite);
    registry = createConceptRegistry(db);
  });

  afterEach(() => sqlite.close());

  it('same surface forms with different casing unify to one concept', async () => {
    const r1 = await registry.resolveConcept({
      surface: 'kafka',
      resolverVersion: 'open-source-term-v1',
      ...provenance,
    });
    const r2 = await registry.resolveConcept({
      surface: 'Kafka',
      resolverVersion: 'open-source-term-v1',
      evidenceEntityType: 'fixture',
      evidenceEntityId: 'fixture-2',
      evidenceLocator: 'fixture:line:2',
    });
    const r3 = await registry.resolveConcept({
      surface: 'KAFKA',
      resolverVersion: 'open-source-term-v1',
      evidenceEntityType: 'fixture',
      evidenceEntityId: 'fixture-3',
      evidenceLocator: 'fixture:line:3',
    });

    expect(r1.canonicalKey).toBe(r2.canonicalKey);
    expect(r2.canonicalKey).toBe(r3.canonicalKey);
    expect(r1.conceptId).toBe(r2.conceptId);
    expect(r2.conceptId).toBe(r3.conceptId);

    const faces = await registry.getConceptFaces(r1.conceptId);
    expect(faces.length).toBeGreaterThanOrEqual(1);
    const surfaces = faces.map((f) => f.surface);
    expect(surfaces).toContain('kafka');
  });

  it('CamelCase form produces a distinct canonical key from its already-lowercase form', async () => {
    const camel = await registry.resolveConcept({
      surface: 'TypeScript',
      resolverVersion: 'open-source-term-v1',
      ...provenance,
    });
    const lower = await registry.resolveConcept({
      surface: 'typescript',
      resolverVersion: 'open-source-term-v1',
      evidenceEntityType: 'fixture',
      evidenceEntityId: 'fixture-ts-2',
      evidenceLocator: 'fixture:line:10',
    });

    expect(camel.canonicalKey).toBe('term:type-script');
    expect(lower.canonicalKey).toBe('term:typescript');
    expect(camel.conceptId).not.toBe(lower.conceptId);
  });

  it('CamelCase aliases resolve to the same canonical key as their split form', async () => {
    const r1 = await registry.resolveConcept({
      surface: 'EventSourcing',
      resolverVersion: 'open-source-term-v1',
      ...provenance,
    });
    const r2 = await registry.resolveConcept({
      surface: 'event sourcing',
      resolverVersion: 'open-source-term-v1',
      evidenceEntityType: 'fixture',
      evidenceEntityId: 'fixture-4',
      evidenceLocator: 'fixture:line:4',
    });

    expect(r1.canonicalKey).toBe(r2.canonicalKey);
    expect(r1.conceptId).toBe(r2.conceptId);
  });

  it('concept registered once is found by subsequent resolutions via same normalized surface', async () => {
    const registered = await registry.resolveConcept({
      surface: 'Apache Kafka',
      resolverVersion: 'open-source-term-v1',
      ...provenance,
    });
    expect(registered.canonicalKey).toBe('term:apache-kafka');

    const resolved = await registry.resolveConcept({
      surface: 'apache kafka',
      resolverVersion: 'open-source-term-v1',
      evidenceEntityType: 'code-review',
      evidenceEntityId: 'review-1',
      evidenceLocator: 'review:line:10',
    });

    expect(resolved.canonicalKey).toBe('term:apache-kafka');
    expect(resolved.conceptId).toBe(registered.conceptId);

    const concept = await registry.getConcept('term:apache-kafka');
    expect(concept).not.toBeNull();
    expect(concept!.id).toBe(registered.conceptId);
  });

  it('novel concept from one evidence source survives through different surface resolution', async () => {
    const novelSurface = 'QuantumShardRecoveryProtocol';

    const r1 = await registry.resolveConcept({
      surface: novelSurface,
      resolverVersion: 'open-source-term-v1',
      ...provenance,
    });

    const concept1 = await registry.getConcept(r1.canonicalKey);
    expect(concept1).not.toBeNull();
    expect(concept1!.canonicalKey).toBe('term:quantum-shard-recovery-protocol');

    const r2 = await registry.resolveConcept({
      surface: 'quantum shard recovery protocol',
      resolverVersion: 'open-source-term-v1',
      evidenceEntityType: 'meeting',
      evidenceEntityId: 'meeting-novel-1',
      evidenceLocator: 'meeting:ts:1000',
    });

    expect(r2.canonicalKey).toBe(r1.canonicalKey);
    expect(r2.conceptId).toBe(r1.conceptId);

    const r3 = await registry.resolveConcept({
      surface: 'QuantumShardRecoveryProtocol',
      resolverVersion: 'open-source-term-v1',
      evidenceEntityType: 'code-review',
      evidenceEntityId: 'review-novel-1',
      evidenceLocator: 'review:line:42',
    });

    expect(r3.canonicalKey).toBe(r1.canonicalKey);
    expect(r3.conceptId).toBe(r1.conceptId);

    const resolutions = await registry.getConceptResolutions(r1.conceptId);
    expect(resolutions.length).toBeGreaterThanOrEqual(3);
    const sourceTypes = resolutions.map((r) => r.evidenceEntityType).filter(Boolean);
    expect(sourceTypes).toContain('fixture');
    expect(sourceTypes).toContain('meeting');
    expect(sourceTypes).toContain('code-review');
  });

  it('hyphenated and space-separated forms alias to the same concept', async () => {
    const r1 = await registry.resolveConcept({
      surface: 'machine-learning',
      resolverVersion: 'open-source-term-v1',
      ...provenance,
    });
    const r2 = await registry.resolveConcept({
      surface: 'machine learning',
      resolverVersion: 'open-source-term-v1',
      evidenceEntityType: 'fixture',
      evidenceEntityId: 'fixture-ml-2',
      evidenceLocator: 'fixture:line:5',
    });
    const r3 = await registry.resolveConcept({
      surface: 'MachineLearning',
      resolverVersion: 'open-source-term-v1',
      evidenceEntityType: 'fixture',
      evidenceEntityId: 'fixture-ml-3',
      evidenceLocator: 'fixture:line:6',
    });

    expect(r1.canonicalKey).toBe(r2.canonicalKey);
    expect(r2.canonicalKey).toBe(r3.canonicalKey);
    expect(r1.conceptId).toBe(r2.conceptId);
    expect(r2.conceptId).toBe(r3.conceptId);
  });

  it('concept adjacency persists across evidence sources', async () => {
    const kafka = await registry.resolveConcept({
      surface: 'Kafka',
      resolverVersion: 'open-source-term-v1',
      ...provenance,
    });
    const rabbitmq = await registry.resolveConcept({
      surface: 'RabbitMQ',
      resolverVersion: 'open-source-term-v1',
      evidenceEntityType: 'fixture',
      evidenceEntityId: 'fixture-rmq-1',
      evidenceLocator: 'fixture:line:7',
    });

    await registry.addAdjacency({
      fromConceptId: kafka.conceptId,
      toConceptId: rabbitmq.conceptId,
      dimension: 'technology',
      stretchAllowed: true,
      confidence: 0.85,
      observedAt: Math.floor(Date.now() / 1000),
      sourceSpanId: undefined,
      evidenceEntityType: 'fixture',
      evidenceEntityId: 'fixture-adj-1',
      evidenceLocator: 'fixture:adj:1',
    });

    const kafkaAdj = await registry.getAdjacencies(kafka.conceptId);
    expect(kafkaAdj.length).toBe(1);
    expect(kafkaAdj[0].dimension).toBe('technology');
    expect(kafkaAdj[0].stretchAllowed).toBe(true);

    const rmqAdj = await registry.getAdjacencies(rabbitmq.conceptId);
    expect(rmqAdj.length).toBe(1);
    expect(rmqAdj[0].fromConceptId).toBe(kafka.conceptId);
  });
});
