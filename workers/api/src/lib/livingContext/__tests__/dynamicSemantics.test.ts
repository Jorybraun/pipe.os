import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockD1, type BetterSqliteDb } from '../../../__tests__/helpers/mockD1';
import { createConceptRegistry, type ConceptRegistry } from '../conceptRegistry';
import { LivingContextStore } from '../persistence';
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

function count(sqlite: BetterSqliteDb, table: string): number {
  return (sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
}

function allRows<T>(sqlite: BetterSqliteDb, sql: string): T[] {
  return sqlite.prepare(sql).all() as T[];
}

describe('dynamic semantics — acceptance criterion #3', () => {
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

  it('previously unknown concepts survive ingestion without taxonomy whitelists', async () => {
    const result = await registry.resolveConcept({
      surface: 'QuantumFluxCapacitorX',
      resolverVersion: 'open-source-term-v1',
      ...provenance,
    });

    expect(result.canonicalKey).toBe('term:quantum-flux-capacitor-x');
    expect(result.confidence).toBeNull();

    const concept = await registry.getConcept(result.canonicalKey);
    expect(concept).not.toBeNull();
    expect(concept?.namespace).toBe('open');
    expect(concept?.label).toBe('QuantumFluxCapacitorX');

    const faces = await registry.getConceptFaces(result.conceptId);
    expect(faces).toHaveLength(1);
    expect(faces[0].surface).toBe('QuantumFluxCapacitorX');
    expect(faces[0].normalizedSurface).toBe('quantum flux capacitor x');
  });

  it('CamelCase terms are split into natural word boundaries', async () => {
    const cases: Array<[string, string]> = [
      ['TypeScript', 'term:type-script'],
      ['GraphQL', 'term:graph-ql'],
      ['RedBlackTree', 'term:red-black-tree'],
      ['HTMLParser', 'term:html-parser'],
      ['OAuth2Provider', 'term:o-auth2provider'],
    ];

    for (const [surface, expectedKey] of cases) {
      const result = await registry.resolveConcept({
        surface,
        resolverVersion: 'open-source-term-v1',
        ...provenance,
        evidenceLocator: `fixture:${surface}`,
      });
      expect(result.canonicalKey).toBe(expectedKey);
    }
  });

  it('concepts accumulate faces from distinct evidence sources', async () => {
    const first = await registry.registerConcept({
      canonicalKey: 'term:event-sourcing',
      namespace: 'open',
      label: 'event sourcing',
      surface: 'event sourcing',
      ...provenance,
    });
    await registry.registerConcept({
      canonicalKey: 'term:event-sourcing',
      namespace: 'open',
      label: 'event sourcing',
      surface: 'Event-Sourcing',
      ...provenance,
      evidenceLocator: 'fixture:line:2',
    });
    await registry.registerConcept({
      canonicalKey: 'term:event-sourcing',
      namespace: 'open',
      label: 'event sourcing',
      surface: 'CQRS/ES',
      ...provenance,
      evidenceLocator: 'fixture:line:3',
    });

    const faces = await registry.getConceptFaces(first.conceptId);
    expect(faces).toHaveLength(3);
    expect(new Set(faces.map((f) => f.surface))).toEqual(
      new Set(['event sourcing', 'Event-Sourcing', 'CQRS/ES']),
    );
  });

  it('novel relationship dimensions survive without hard-coded enums', async () => {
    const left = await registry.registerConcept({
      canonicalKey: 'term:temporal-replay',
      namespace: 'open',
      label: 'temporal replay',
      surface: 'temporal replay',
      ...provenance,
    });
    const right = await registry.registerConcept({
      canonicalKey: 'term:saga-orchestration',
      namespace: 'open',
      label: 'saga orchestration',
      surface: 'saga orchestration',
      ...provenance,
      evidenceLocator: 'fixture:line:2',
    });

    const adjacencyId = await registry.addAdjacency({
      fromConceptId: left.conceptId,
      toConceptId: right.conceptId,
      dimension: 'novel:distributed-transaction-recovery-pattern',
      stretchAllowed: true,
      confidence: 0.85,
      observedAt: 1_700_000_000,
      ...provenance,
    });

    const edges = await registry.getAdjacencies(left.conceptId);
    expect(edges).toHaveLength(1);
    expect(edges[0].dimension).toBe('novel:distributed-transaction-recovery-pattern');
    expect(edges[0].stretchAllowed).toBe(true);
    expect(adjacencyId).toBeTruthy();
  });

  it('unknown concepts survive meeting transcript ingestion end to end', async () => {
    sqlite.prepare(`INSERT INTO contacts (id, owner_id, name, email, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run('contact-1', 'workspace-1', 'Ada', 'ada@example.com', 'candidate', '2026-01-01', '2026-01-01');
    sqlite.prepare(`INSERT INTO meetings (id, owner_id, started_at, ended_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
      .run('meeting-1', 'workspace-1', '2026-06-13T10:00:00Z', '2026-06-13T11:00:00Z', '2026-06-13T11:00:00Z');
    sqlite.prepare(`INSERT INTO meeting_participants (id, meeting_id, contact_id, role, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run('mp-1', 'meeting-1', 'contact-1', 'guest', '2026-06-13T10:00:00Z');

    await ingestMeetingTranscriptToLivingContext(db, {
      meetingId: 'meeting-1',
      ownerId: 'workspace-1',
      segments: [
        {
          stableSegmentId: 'host-1',
          text: 'Tell me about your work.',
          speakerRole: 'host',
          channel: 0,
          timestampStartMs: 1_000,
          timestampEndMs: 2_000,
        },
        {
          stableSegmentId: 'guest-1',
          text: 'I designed a chrono-distributive mesh relay for shard convergence.',
          speakerRole: 'guest',
          contactId: 'contact-1',
          channel: 1,
          timestampStartMs: 2_100,
          timestampEndMs: 6_500,
          confidence: 0.95,
        },
      ],
      semanticAssertions: [{
        sourceSegmentIds: ['host-1', 'guest-1'],
        subjectSegmentId: 'guest-1',
        predicate: 'designed a mechanism for',
        narrative: 'Designed a chrono-distributive mesh relay for shard convergence.',
        objectType: 'source-described mechanism',
        objectValue: { surface: 'chrono-distributive mesh relay' },
        confidence: 0.88,
        concepts: [{
          surface: 'chrono-distributive mesh relay',
          relationship: 'mechanism designed for shard convergence',
          weight: 0.85,
          evidenceLevel: 'implemented' as const,
          strength: 0.87,
        }],
      }],
      extractorVersion: 'open-meeting-test-v1',
      provider: 'deepgram-multichannel',
    });

    const concepts = allRows<{ canonical_key: string; label: string }>(
      sqlite,
      `SELECT canonical_key, label FROM concepts`,
    );
    expect(concepts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          canonical_key: 'term:chrono-distributive-mesh-relay',
          label: 'chrono-distributive mesh relay',
        }),
      ]),
    );
    expect(count(sqlite, 'semantic_assertions')).toBeGreaterThanOrEqual(1);
    expect(count(sqlite, 'signal_evidence')).toBeGreaterThanOrEqual(1);
  });

  it('concepts and relationships evolve through persisted evidence across interactions', async () => {
    sqlite.prepare(`INSERT INTO contacts (id, owner_id, name, email, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run('contact-1', 'workspace-1', 'Ada', 'ada@example.com', 'candidate', '2026-01-01', '2026-01-01');
    sqlite.prepare(`INSERT INTO meetings (id, owner_id, started_at, ended_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
      .run('meeting-1', 'workspace-1', '2026-06-13T10:00:00Z', '2026-06-13T11:00:00Z', '2026-06-13T11:00:00Z');
    sqlite.prepare(`INSERT INTO meeting_participants (id, meeting_id, contact_id, role, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run('mp-1', 'meeting-1', 'contact-1', 'guest', '2026-06-13T10:00:00Z');
    sqlite.prepare(`INSERT INTO meetings (id, owner_id, started_at, ended_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
      .run('meeting-2', 'workspace-1', '2026-06-14T10:00:00Z', '2026-06-14T11:00:00Z', '2026-06-14T11:00:00Z');
    sqlite.prepare(`INSERT INTO meeting_participants (id, meeting_id, contact_id, role, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run('mp-2', 'meeting-2', 'contact-1', 'guest', '2026-06-14T10:00:00Z');

    await ingestMeetingTranscriptToLivingContext(db, {
      meetingId: 'meeting-1',
      ownerId: 'workspace-1',
      segments: [{
        stableSegmentId: 'guest-1',
        text: 'I built a polyglot event mesh.',
        speakerRole: 'guest',
        contactId: 'contact-1',
        channel: 1,
        timestampStartMs: 1_000,
        timestampEndMs: 3_000,
        confidence: 0.94,
      }],
      semanticAssertions: [{
        sourceSegmentIds: ['guest-1'],
        subjectSegmentId: 'guest-1',
        predicate: 'built',
        narrative: 'Built a polyglot event mesh.',
        objectType: 'technical-artifact',
        objectValue: { surface: 'polyglot event mesh' },
        confidence: 0.90,
        concepts: [{
          surface: 'polyglot event mesh',
          relationship: 'built as distributed infrastructure',
          weight: 0.88,
          evidenceLevel: 'implemented' as const,
          strength: 0.85,
        }],
      }],
      extractorVersion: 'open-meeting-test-v1',
      provider: 'deepgram-multichannel',
    });

    const firstSignals = count(sqlite, 'signal_evidence');

    await ingestMeetingTranscriptToLivingContext(db, {
      meetingId: 'meeting-2',
      ownerId: 'workspace-1',
      segments: [{
        stableSegmentId: 'guest-2',
        text: 'I extended the polyglot event mesh with exactly-once delivery.',
        speakerRole: 'guest',
        contactId: 'contact-1',
        channel: 1,
        timestampStartMs: 1_000,
        timestampEndMs: 3_500,
        confidence: 0.93,
      }],
      semanticAssertions: [{
        sourceSegmentIds: ['guest-2'],
        subjectSegmentId: 'guest-2',
        predicate: 'extended',
        narrative: 'Extended the polyglot event mesh with exactly-once delivery.',
        objectType: 'technical-artifact',
        objectValue: { surface: 'polyglot event mesh' },
        confidence: 0.89,
        concepts: [{
          surface: 'polyglot event mesh',
          relationship: 'extended with delivery guarantees',
          weight: 0.86,
          evidenceLevel: 'demonstrated' as const,
          strength: 0.88,
        }],
      }],
      extractorVersion: 'open-meeting-test-v1',
      provider: 'deepgram-multichannel',
    });

    const secondSignals = count(sqlite, 'signal_evidence');
    expect(secondSignals).toBeGreaterThan(firstSignals);

    const conceptCount = count(sqlite, 'concepts');
    expect(conceptCount).toBe(1);

    const snapshots = allRows<{ total_score: number; evidence_count: number }>(
      sqlite,
      `SELECT total_score, evidence_count FROM signal_snapshots ORDER BY evidence_count DESC LIMIT 1`,
    );
    expect(snapshots[0].evidence_count).toBe(2);
    expect(snapshots[0].total_score).toBeGreaterThan(0);
  });
});
