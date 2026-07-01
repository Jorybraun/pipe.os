import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockD1, type BetterSqliteDb } from '../../../__tests__/helpers/mockD1';
import {
  traverseLivingContextGraph,
  type GraphEntityType,
  type GraphTraversalResult,
} from '../graphTraversal';

const livingContextMigration = readFileSync(
  new URL('../../../../migrations/0082_living_context_graph.sql', import.meta.url),
  'utf8',
);
const repoGraphMigration = readFileSync(
  new URL('../../../../migrations/0083_repo_semantic_graph_and_match_runs.sql', import.meta.url),
  'utf8',
);
const transcriptProjectionsMigration = readFileSync(
  new URL('../../../../migrations/0091_transcript_semantic_projections.sql', import.meta.url),
  'utf8',
);

const NOW = "datetime('now')";
const CANDIDATE_ID = 'candidate-1';
const WP_ID = 'wp-1';
const PERSON_ID = 'person-1';

function seedCore(sqlite: BetterSqliteDb): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS candidates (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL DEFAULT 'ws-1',
      name TEXT,
      email TEXT,
      status TEXT NOT NULL DEFAULT 'active'
    );
    CREATE TABLE IF NOT EXISTS qualified_repos (
      id INTEGER PRIMARY KEY,
      full_name TEXT NOT NULL DEFAULT 'test/repo',
      url TEXT NOT NULL DEFAULT 'https://github.com/test/repo',
      default_branch TEXT NOT NULL DEFAULT 'main',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  sqlite.exec(livingContextMigration);
  sqlite.exec(repoGraphMigration);
  sqlite.exec(transcriptProjectionsMigration);

  sqlite.exec(`
    INSERT INTO candidates (id, owner_id, name, email) VALUES ('${CANDIDATE_ID}', 'ws-1', 'Test', 'test@test.dev');
    INSERT INTO people (id, ingestion_key, display_name, primary_email, created_at, updated_at)
    VALUES ('${PERSON_ID}', 'ik-person-1', 'Test Person', 'test@test.dev', ${NOW}, ${NOW});
    INSERT INTO workspace_people (id, person_id, workspace_id, ingestion_key, context_json, created_at, updated_at)
    VALUES ('${WP_ID}', '${PERSON_ID}', 'ws-1', 'ik-wp-1', '{}', ${NOW}, ${NOW});
    INSERT INTO applications (id, workspace_person_id, legacy_candidate_id, ingestion_key, created_at, updated_at)
    VALUES ('app-1', '${WP_ID}', '${CANDIDATE_ID}', 'ik-app-1', ${NOW}, ${NOW});
  `);
}

function seedInteractionWithEvidence(sqlite: BetterSqliteDb): {
  interactionId: string;
  artifactId: string;
  sourceSpanId: string;
  assertionId: string;
  conceptId: string;
  signalId: string;
} {
  const interactionId = 'interaction-1';
  const artifactId = 'artifact-1';
  const avId = 'av-1';
  const sourceSpanId = 'span-1';
  const assertionId = 'assertion-1';
  const conceptId = 'concept-1';
  const signalId = 'signal-1';

  sqlite.exec(`
    INSERT INTO interactions (id, ingestion_key, workspace_person_id, interaction_type, external_reference, started_at, created_at, updated_at)
    VALUES ('${interactionId}', 'ik-int-1', '${WP_ID}', 'meeting', 'meeting-ext-1', '2026-06-01T10:00:00Z', ${NOW}, ${NOW});

    INSERT INTO artifacts (id, ingestion_key, workspace_person_id, interaction_id, artifact_type, logical_key, created_at, updated_at)
    VALUES ('${artifactId}', 'ik-art-1', '${WP_ID}', '${interactionId}', 'transcript', 'meeting-transcript', ${NOW}, ${NOW});

    INSERT INTO artifact_interactions (artifact_id, interaction_id, relationship, created_at)
    VALUES ('${artifactId}', '${interactionId}', 'produced_by', ${NOW});

    INSERT INTO artifact_versions (id, ingestion_key, artifact_id, version_number, content_hash, media_type, content_text, created_at)
    VALUES ('${avId}', 'ik-av-1', '${artifactId}', 1, 'hash-1', 'text/plain', 'Built Kafka retry systems.', ${NOW});

    INSERT INTO source_spans (id, ingestion_key, artifact_version_id, exact_text, exact_text_hash, created_at)
    VALUES ('${sourceSpanId}', 'ik-span-1', '${avId}', 'Built Kafka retry systems with idempotent keys.', 'hash-span-1', ${NOW});

    INSERT INTO concepts (id, ingestion_key, canonical_key, namespace, label, created_at, updated_at)
    VALUES ('${conceptId}', 'ik-concept-1', 'term:kafka', 'term', 'Kafka', ${NOW}, ${NOW});

    INSERT INTO semantic_assertions (id, ingestion_key, workspace_person_id, subject_type, predicate, narrative, confidence, polarity, created_at, updated_at)
    VALUES ('${assertionId}', 'ik-assert-1', '${WP_ID}', 'workspace_person', 'implemented', 'Candidate built Kafka retry publishing.', 0.95, 1, ${NOW}, ${NOW});

    INSERT INTO assertion_source_spans (assertion_id, source_span_id, evidence_role, created_at)
    VALUES ('${assertionId}', '${sourceSpanId}', 'primary', ${NOW});

    INSERT INTO assertion_concepts (assertion_id, concept_id, relationship, weight, created_at)
    VALUES ('${assertionId}', '${conceptId}', 'about', 1.0, ${NOW});

    INSERT INTO signal_evidence (id, ingestion_key, workspace_person_id, interaction_id, assertion_id, concept_id, signal_key, evidence_level, strength, polarity, created_at, updated_at)
    VALUES ('${signalId}', 'ik-signal-1', '${WP_ID}', '${interactionId}', '${assertionId}', '${conceptId}', 'kafka', 'implemented', 0.95, 1, ${NOW}, ${NOW});
  `);

  return { interactionId, artifactId, sourceSpanId, assertionId, conceptId, signalId };
}

describe('graphTraversal', () => {
  let sqlite: BetterSqliteDb;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    seedCore(sqlite);
    db = createMockD1(sqlite);
  });

  afterEach(() => {
    sqlite.close();
  });

  it('returns empty graph when candidate has no living context', async () => {
    const result = await traverseLivingContextGraph(
      db,
      'nonexistent-candidate',
      'workspace_person',
      WP_ID,
    );
    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
    expect(result.truncated).toBe(false);
  });

  it('traverses from workspace_person to interactions, assertions, and signals', async () => {
    const seeded = seedInteractionWithEvidence(sqlite);

    const result = await traverseLivingContextGraph(
      db,
      CANDIDATE_ID,
      'workspace_person',
      WP_ID,
      { maxDepth: 1 },
    );

    expect(result.root.entityType).toBe('workspace_person');
    expect(result.root.id).toBe(WP_ID);

    const interactionNodes = result.nodes.filter((n) => n.entityType === 'interaction');
    expect(interactionNodes.length).toBeGreaterThanOrEqual(1);
    expect(interactionNodes.some((n) => n.id === seeded.interactionId)).toBe(true);

    const assertionNodes = result.nodes.filter((n) => n.entityType === 'assertion');
    expect(assertionNodes.length).toBeGreaterThanOrEqual(1);

    const participatedEdges = result.edges.filter((e) => e.relationship === 'participated_in');
    expect(participatedEdges.length).toBeGreaterThanOrEqual(1);
  });

  it('traverses from assertion to concepts and source spans', async () => {
    const seeded = seedInteractionWithEvidence(sqlite);

    const result = await traverseLivingContextGraph(
      db,
      CANDIDATE_ID,
      'assertion',
      seeded.assertionId,
      { maxDepth: 1 },
    );

    expect(result.root.entityType).toBe('assertion');
    expect(result.root.label).toBe('implemented');

    const conceptNodes = result.nodes.filter((n) => n.entityType === 'concept');
    expect(conceptNodes.length).toBe(1);
    expect(conceptNodes[0]!.label).toBe('Kafka');

    const spanNodes = result.nodes.filter((n) => n.entityType === 'source_span');
    expect(spanNodes.length).toBe(1);
    expect(spanNodes[0]!.label).toContain('Kafka');

    const aboutEdges = result.edges.filter((e) => e.relationship === 'about');
    expect(aboutEdges.length).toBe(1);
    expect(aboutEdges[0]!.sourceEvidence?.confidence).toBe(1.0);

    const sourcedEdges = result.edges.filter((e) => e.relationship === 'sourced_from');
    expect(sourcedEdges.length).toBe(1);
    expect(sourcedEdges[0]!.sourceEvidence?.sourceSpanId).toBe(seeded.sourceSpanId);
  });

  it('traverses from concept back to assertions scoped to the candidate', async () => {
    const seeded = seedInteractionWithEvidence(sqlite);

    const result = await traverseLivingContextGraph(
      db,
      CANDIDATE_ID,
      'concept',
      seeded.conceptId,
      { maxDepth: 1 },
    );

    expect(result.root.entityType).toBe('concept');
    expect(result.root.metadata.canonicalKey).toBe('term:kafka');

    const assertionNodes = result.nodes.filter((n) => n.entityType === 'assertion');
    expect(assertionNodes.length).toBe(1);
    expect(assertionNodes[0]!.id).toBe(seeded.assertionId);

    const signalNodes = result.nodes.filter((n) => n.entityType === 'signal_evidence');
    expect(signalNodes.length).toBe(1);
  });

  it('traverses from interaction to artifacts and assertions', async () => {
    const seeded = seedInteractionWithEvidence(sqlite);

    const result = await traverseLivingContextGraph(
      db,
      CANDIDATE_ID,
      'interaction',
      seeded.interactionId,
      { maxDepth: 1 },
    );

    expect(result.root.entityType).toBe('interaction');
    expect(result.root.label).toContain('meeting');

    const artifactNodes = result.nodes.filter((n) => n.entityType === 'artifact');
    expect(artifactNodes.length).toBeGreaterThanOrEqual(1);

    const assertionNodes = result.nodes.filter((n) => n.entityType === 'assertion');
    expect(assertionNodes.length).toBeGreaterThanOrEqual(1);
  });

  it('traverses depth-2: workspace_person → interaction → artifacts → source_spans', async () => {
    seedInteractionWithEvidence(sqlite);

    const result = await traverseLivingContextGraph(
      db,
      CANDIDATE_ID,
      'workspace_person',
      WP_ID,
      { maxDepth: 2 },
    );

    const spanNodes = result.nodes.filter((n) => n.entityType === 'source_span');
    expect(spanNodes.length).toBeGreaterThanOrEqual(1);

    const depth0Nodes = result.nodes.filter((n) => n.depth === 0);
    expect(depth0Nodes.length).toBe(1);

    const depth1Nodes = result.nodes.filter((n) => n.depth === 1);
    expect(depth1Nodes.length).toBeGreaterThanOrEqual(1);

    const depth2Nodes = result.nodes.filter((n) => n.depth === 2);
    expect(depth2Nodes.length).toBeGreaterThanOrEqual(1);
  });

  it('respects entityTypeFilter', async () => {
    seedInteractionWithEvidence(sqlite);

    const result = await traverseLivingContextGraph(
      db,
      CANDIDATE_ID,
      'workspace_person',
      WP_ID,
      { maxDepth: 2, entityTypeFilter: ['interaction', 'workspace_person'] },
    );

    const nonFiltered = result.nodes.filter(
      (n) => n.entityType !== 'interaction' && n.entityType !== 'workspace_person',
    );
    expect(nonFiltered).toHaveLength(0);
  });

  it('respects maxNodes limit and sets truncated flag', async () => {
    seedInteractionWithEvidence(sqlite);

    const result = await traverseLivingContextGraph(
      db,
      CANDIDATE_ID,
      'workspace_person',
      WP_ID,
      { maxDepth: 3, maxNodes: 3 },
    );

    expect(result.nodes.length).toBeLessThanOrEqual(3);
    expect(result.truncated).toBe(true);
  });

  it('traverses from source_span to supporting assertions', async () => {
    const seeded = seedInteractionWithEvidence(sqlite);

    const result = await traverseLivingContextGraph(
      db,
      CANDIDATE_ID,
      'source_span',
      seeded.sourceSpanId,
      { maxDepth: 1 },
    );

    expect(result.root.entityType).toBe('source_span');
    expect(result.root.label).toContain('Kafka');

    const assertionNodes = result.nodes.filter((n) => n.entityType === 'assertion');
    expect(assertionNodes.length).toBe(1);

    const supportsEdges = result.edges.filter((e) => e.relationship === 'supports');
    expect(supportsEdges.length).toBe(1);
    expect(supportsEdges[0]!.sourceEvidence?.sourceSpanId).toBe(seeded.sourceSpanId);
  });

  it('traverses from signal_evidence to assertion and concept', async () => {
    const seeded = seedInteractionWithEvidence(sqlite);

    const result = await traverseLivingContextGraph(
      db,
      CANDIDATE_ID,
      'signal_evidence',
      seeded.signalId,
      { maxDepth: 1 },
    );

    expect(result.root.entityType).toBe('signal_evidence');
    expect(result.root.label).toContain('kafka');

    const assertionNodes = result.nodes.filter((n) => n.entityType === 'assertion');
    expect(assertionNodes.length).toBe(1);

    const conceptNodes = result.nodes.filter((n) => n.entityType === 'concept');
    expect(conceptNodes.length).toBe(1);

    const interactionNodes = result.nodes.filter((n) => n.entityType === 'interaction');
    expect(interactionNodes.length).toBe(1);
  });

  it('does not produce duplicate edges for revisited nodes', async () => {
    seedInteractionWithEvidence(sqlite);

    const result = await traverseLivingContextGraph(
      db,
      CANDIDATE_ID,
      'workspace_person',
      WP_ID,
      { maxDepth: 3 },
    );

    const edgeKeys = result.edges.map(
      (e) => `${e.fromType}:${e.fromId}->${e.toType}:${e.toId}:${e.relationship}`,
    );
    const uniqueKeys = new Set(edgeKeys);
    expect(edgeKeys.length).toBe(uniqueKeys.size);
  });

  it('traverses from person to workspace_people', async () => {
    const result = await traverseLivingContextGraph(
      db,
      CANDIDATE_ID,
      'person',
      PERSON_ID,
      { maxDepth: 1 },
    );

    expect(result.root.entityType).toBe('person');
    expect(result.root.label).toBe('Test Person');

    const wpNodes = result.nodes.filter((n) => n.entityType === 'workspace_person');
    expect(wpNodes.length).toBe(1);
    expect(wpNodes[0]!.id).toBe(WP_ID);
  });

  it('returns not-found root when entity does not exist', async () => {
    const result = await traverseLivingContextGraph(
      db,
      CANDIDATE_ID,
      'assertion',
      'nonexistent-assertion',
      { maxDepth: 1 },
    );

    expect(result.root.label).toBe('Not found');
    expect(result.nodes).toHaveLength(0);
  });
});
