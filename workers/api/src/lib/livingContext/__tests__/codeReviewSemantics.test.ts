import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockD1, type BetterSqliteDb } from '../../../__tests__/helpers/mockD1';
import { createConceptRegistry, type ConceptRegistry } from '../conceptRegistry';
import {
  ingestCodeReviewTranscriptToLivingContext,
  type CodeReviewTranscript,
} from '../codeReview';

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

function count(sqlite: BetterSqliteDb, table: string): number {
  return (sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
}

function allRows<T>(sqlite: BetterSqliteDb, sql: string): T[] {
  return sqlite.prepare(sql).all() as T[];
}

describe('code-review evidence semantic survival — acceptance criterion #3', () => {
  let sqlite: BetterSqliteDb;
  let db: D1Database;
  let registry: ConceptRegistry;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec('PRAGMA foreign_keys = ON;');
    sqlite.exec(`
      CREATE TABLE candidates (
        id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, pipeline_id TEXT,
        name TEXT, email TEXT, status TEXT NOT NULL
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
    sqlite.prepare(
      `INSERT INTO candidates (id, owner_id, pipeline_id, name, email, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('candidate-cr-1', 'workspace-1', 'pipeline-1', 'Coder Example', 'coder@example.com', 'active');
    db = createMockD1(sqlite);
    registry = createConceptRegistry(db);
  });

  afterEach(() => sqlite.close());

  function makeTranscript(concepts: string[]): CodeReviewTranscript {
    return {
      rounds: [
        {
          round: 1,
          reviewer_comments: concepts.map((concept, index) => ({
            id: index + 1,
            file: `src/${concept.toLowerCase().replace(/\s+/g, '-')}.ts`,
            line: 10 + index,
            category: null,
            severity: 'nit' as const,
            what: `The ${concept} implementation needs cleanup.`,
            why: `The ${concept} pattern is not idiomatic here.`,
            suggestion: `Refactor ${concept} usage to follow best practices.`,
            positive: false,
          })),
          reviewer_summary: `Review touches: ${concepts.join(', ')}.`,
          implementer_responses: concepts.map((concept, index) => ({
            to_comment_id: index + 1,
            move: 'change' as const,
            content: `Refactored the ${concept} handling as suggested.`,
            updated_code: `// improved ${concept} pattern`,
          })),
        },
      ],
      explainer_exchanges: [
        {
          round: 1,
          question: {
            text: `How does the ${concepts[0]} interact with the rest of the system?`,
            file: 'src/main.ts',
            line: 1,
          },
          answer: {
            content: `The ${concepts[0]} is initialized at startup and shared via dependency injection.`,
            context_provided: ['surrounding_code'],
            depth_level: 'moderate',
          },
        },
      ],
    };
  }

  it('previously unknown concepts in code-review transcript survive ingestion', async () => {
    const novelConcepts = [
      'QuantumStateReconciler',
      'HyperLogLogPlusPlus',
      'TrieBasedRadixMatcher',
    ];

    for (const concept of novelConcepts) {
      const resolved = await registry.resolveConcept({
        surface: concept,
        resolverVersion: 'open-source-term-v1',
        evidenceEntityType: 'code_review',
        evidenceEntityId: 'cr-fixture-1',
        evidenceLocator: `cr:${concept}`,
      });
      expect(resolved.canonicalKey).toBeTruthy();
    }

    for (const concept of novelConcepts) {
      const result = await registry.resolveConcept({
        surface: concept,
        resolverVersion: 'open-source-term-v1',
        evidenceEntityType: 'code_review',
        evidenceEntityId: 'cr-fixture-1',
        evidenceLocator: `cr:verify:${concept}`,
      });
      const persisted = await registry.getConcept(result.canonicalKey);
      expect(persisted).not.toBeNull();
      expect(persisted?.label).toBe(concept);
    }
  });

  it('code-review transcript ingestion creates source spans preserving exact review text', async () => {
    await ingestCodeReviewTranscriptToLivingContext(db, {
      sessionId: 'cr-session-1',
      candidateId: 'candidate-cr-1',
      challengeId: 'challenge-cr-1',
      assessmentId: 'assessment-cr-1',
      transcript: makeTranscript(['ZeroKnowledgeProof', 'MerklePatriciaTrie']),
      status: 'in_progress',
      startedAt: '2026-06-21T10:00:00.000Z',
      observedAt: '2026-06-21T10:05:00.000Z',
    });

    expect(count(sqlite, 'interactions')).toBe(1);
    expect(count(sqlite, 'artifacts')).toBe(1);
    expect(count(sqlite, 'source_spans')).toBeGreaterThan(0);

    const spans = allRows<{ exact_text: string }>(
      sqlite,
      `SELECT exact_text FROM source_spans ORDER BY char_start`,
    );
    const allText = spans.map((s) => s.exact_text).join(' ');
    expect(allText).toContain('ZeroKnowledgeProof');
    expect(allText).toContain('MerklePatriciaTrie');
  });

  it('concepts from code-review and meeting evidence accumulate on the same canonical key', async () => {
    const sharedConcept = 'EventSourcing';

    const fromMeeting = await registry.registerConcept({
      canonicalKey: 'term:event-sourcing',
      namespace: 'open',
      label: 'EventSourcing',
      surface: 'event sourcing',
      evidenceEntityType: 'meeting',
      evidenceEntityId: 'meeting-1',
      evidenceLocator: 'meeting:turn:3',
    });

    const fromReview = await registry.registerConcept({
      canonicalKey: 'term:event-sourcing',
      namespace: 'open',
      label: 'EventSourcing',
      surface: sharedConcept,
      evidenceEntityType: 'code_review',
      evidenceEntityId: 'cr-1',
      evidenceLocator: 'cr:comment:5',
    });

    expect(fromMeeting.conceptId).toBe(fromReview.conceptId);

    const faces = await registry.getConceptFaces(fromReview.conceptId);
    expect(faces.length).toBeGreaterThanOrEqual(2);
    const entityTypes = faces.map((f) => f.evidenceEntityType);
    expect(entityTypes).toContain('meeting');
    expect(entityTypes).toContain('code_review');
  });

  it('CamelCase concepts from code review split into natural word boundaries', async () => {
    const cases: Array<[string, string]> = [
      ['ReactServerComponent', 'term:react-server-component'],
      ['PostgreSQLDriver', 'term:postgre-sql-driver'],
      ['gRPCStreaming', 'term:g-rpc-streaming'],
    ];

    for (const [surface, expectedKey] of cases) {
      const result = await registry.resolveConcept({
        surface,
        resolverVersion: 'open-source-term-v1',
        evidenceEntityType: 'code_review',
        evidenceEntityId: 'cr-camel-1',
        evidenceLocator: `cr:${surface}`,
      });
      expect(result.canonicalKey).toBe(expectedKey);
    }
  });
});
