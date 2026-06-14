import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ContextualDecomposition } from '../../cultureContextualDecomposition';
import { ingestCultureTurnToLivingContext } from '../cultureTurn';
import { loadCandidateLivingContext } from '../readModel';
import { createMockD1, type BetterSqliteDb } from '../../../__tests__/helpers/mockD1';

const livingContextMigration = readFileSync(
  new URL('../../../../migrations/0082_living_context_graph.sql', import.meta.url),
  'utf8',
);
const transcriptProjectionMigration = readFileSync(
  new URL('../../../../migrations/0091_transcript_semantic_projections.sql', import.meta.url),
  'utf8',
);



describe('living-context candidate read model', () => {
  let sqlite: BetterSqliteDb;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE candidates (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        pipeline_id TEXT,
        name TEXT,
        email TEXT,
        status TEXT NOT NULL
      );
    `);
    sqlite.exec(livingContextMigration);
    sqlite.exec(transcriptProjectionMigration);
    sqlite.prepare(
      `INSERT INTO candidates (id, owner_id, pipeline_id, name, email, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      'candidate-1',
      'workspace-1',
      'pipeline-1',
      'Ada Example',
      'ada@example.com',
      'active',
    );
    db = createMockD1(sqlite);
  });

  afterEach(() => {
    sqlite.close();
  });

  it('returns navigable graph data with exact evidence and accumulated scores', async () => {
    const decomposition: ContextualDecomposition = {
      statements: [{
        id: 'statement-1',
        type: 'stream replay implementation',
        phrase: 'implemented FluxCapacitorX for order replay',
        surface: 'FluxCapacitorX',
        sourceQuote: 'I implemented FluxCapacitorX for order replay.',
        confidence: 0.92,
        semanticTerms: [{
          surface: 'FluxCapacitorX',
          relationship: 'used as the replay mechanism',
          weight: 0.9,
          evidenceLevel: 'implemented',
          strength: 0.8,
        }],
      }],
      edges: [{
        from: 'candidate',
        to: 'statement-1',
        predicate: 'person directly implemented',
      }],
      discarded: false,
      probe: null,
      missingContext: [],
    };
    await ingestCultureTurnToLivingContext(db, {
      candidateId: 'candidate-1',
      sessionId: 'culture-session-1',
      turnIndex: 0,
      question: 'What did you build?',
      answer: 'I implemented FluxCapacitorX for order replay.',
      observedAt: '2026-06-13T20:00:00.000Z',
      decomposition,
    });

    const graph = await loadCandidateLivingContext(db, 'candidate-1');

    expect(graph).not.toBeNull();
    expect(graph?.person).toMatchObject({
      displayName: 'Ada Example',
      primaryEmail: 'ada@example.com',
      applicationStatus: 'active',
    });
    expect(graph?.summary).toEqual({
      interactionCount: 1,
      artifactCount: 1,
      assertionCount: 1,
      signalCount: 1,
      sourceSpanCount: 3,
    });
    expect(graph?.interactions[0]).toMatchObject({
      interactionType: 'culture_interview',
      externalReference: 'culture-session-1',
    });
    expect(graph?.interactions[0]?.artifactIds).toHaveLength(1);
    expect(graph?.interactions[0]?.assertionIds).toHaveLength(1);
    expect(graph?.interactions[0]?.signalKeys).toEqual(['term:flux-capacitor-x']);

    expect(graph?.artifacts[0]).toMatchObject({
      artifactType: 'culture_interview_turn',
      latestVersionNumber: 1,
      versionCount: 1,
    });
    expect(graph?.artifacts[0]?.sourceSpans.map((span) => span.exactText)).toEqual([
      'What did you build?',
      'I implemented FluxCapacitorX for order replay.',
      'I implemented FluxCapacitorX for order replay.',
    ]);

    expect(graph?.assertions[0]).toMatchObject({
      predicate: 'stream replay implementation',
      narrative: 'implemented FluxCapacitorX for order replay',
    });
    expect(graph?.assertions[0]?.sources[0]?.exactText).toBe(
      'I implemented FluxCapacitorX for order replay.',
    );
    expect(graph?.assertions[0]?.concepts[0]).toMatchObject({
      canonicalKey: 'term:flux-capacitor-x',
      label: 'FluxCapacitorX',
      relationship: 'used as the replay mechanism',
    });

    expect(graph?.signals[0]).toMatchObject({
      signalKey: 'term:flux-capacitor-x',
      label: 'FluxCapacitorX',
      conversationScore: 0.8,
      totalScore: 0.8,
      evidenceCount: 1,
      sourceDiversity: 1,
    });
    expect(graph?.signals[0]?.evidence[0]?.sources[0]?.exactText).toBe(
      'I implemented FluxCapacitorX for order replay.',
    );
    expect(graph?.relationships[0]?.predicate).toBe('person directly implemented');
  });
});
