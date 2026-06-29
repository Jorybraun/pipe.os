import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockD1, type BetterSqliteDb } from '../../../__tests__/helpers/mockD1';
import type { ContextualDecomposition } from '../../cultureContextualDecomposition';
import { ingestCultureTurnToLivingContext } from '../cultureTurn';
import { LivingContextStore } from '../persistence';
import { loadCandidateLivingContext, loadRoleContextLivingContext, loadPersonEvidenceTimeline } from '../readModel';



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
const roleContextsMigration = readFileSync(
  new URL('../../../../migrations/0011_role_contexts.sql', import.meta.url),
  'utf8',
);
const personaJdMigration = readFileSync(
  new URL('../../../../migrations/0013_persona_jd.sql', import.meta.url),
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
      CREATE TABLE pipelines (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL
      );
    `);
    sqlite.exec(roleContextsMigration);
    sqlite.exec(personaJdMigration);
    sqlite.exec(livingContextMigration);
    sqlite.exec(transcriptProjectionMigration);
    sqlite.exec(contextRecordMigration);
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
    const recordRefs = sqlite.prepare(
      `SELECT app.id AS application_id,
              app.workspace_person_id,
              i.id AS interaction_id,
              e.id AS episode_id,
              sa.id AS assertion_id,
              ass.source_span_id,
              ac.concept_id
         FROM applications app
         JOIN interactions i ON i.workspace_person_id = app.workspace_person_id
         JOIN semantic_assertions sa ON sa.workspace_person_id = app.workspace_person_id
         JOIN episodes e ON e.id = sa.episode_id
         JOIN assertion_source_spans ass ON ass.assertion_id = sa.id
         JOIN assertion_concepts ac ON ac.assertion_id = sa.id
        WHERE app.legacy_candidate_id = ?
        LIMIT 1`,
    ).get('candidate-1') as {
      application_id: string;
      workspace_person_id: string;
      interaction_id: string;
      episode_id: string;
      assertion_id: string;
      source_span_id: string;
      concept_id: string;
    };
    const store = new LivingContextStore(db, () => '2026-06-13T20:00:01.000Z');
    const contextRecord = await store.upsertContextRecord({
      ingestionKey: 'context-record:culture-session-1:statement-1',
      workspacePersonId: recordRefs.workspace_person_id,
      interactionId: recordRefs.interaction_id,
      applicationId: recordRefs.application_id,
      episodeId: recordRefs.episode_id,
      assertionId: recordRefs.assertion_id,
      recordType: 'source_backed_meaning',
      predicate: 'stream replay implementation',
      narrative: 'implemented FluxCapacitorX for order replay',
      qualifiers: { statementId: 'statement-1' },
      confidence: 0.92,
      extractionVersion: 'read-model-test-v1',
      observedAt: '2026-06-13T20:00:00.000Z',
      sources: [{ sourceSpanId: recordRefs.source_span_id, evidenceRole: 'source' }],
      entities: [
        {
          entityType: 'workspace_person',
          entityId: recordRefs.workspace_person_id,
          relationship: 'subject',
        },
        {
          entityType: 'business_object',
          relationship: 'object',
          value: { literal: 'order replay' },
        },
      ],
      concepts: [{
        conceptId: recordRefs.concept_id,
        relationship: 'mechanism',
        weight: 0.9,
      }],
    });
    const artifactVersionRef = sqlite.prepare(
      `SELECT av.id, av.content_hash
         FROM artifact_versions av
         JOIN artifacts a ON a.id = av.artifact_id
        WHERE a.workspace_person_id = ?
        ORDER BY av.version_number DESC
        LIMIT 1`,
    ).get(recordRefs.workspace_person_id) as {
      id: string;
      content_hash: string;
    };
    const genericSourceRecord = await store.upsertContextRecord({
      ingestionKey: 'context-record:culture-session-1:artifact-version',
      workspacePersonId: recordRefs.workspace_person_id,
      interactionId: recordRefs.interaction_id,
      applicationId: recordRefs.application_id,
      recordType: 'artifact_version_evidence',
      predicate: 'preserves source artifact version',
      narrative: 'Culture turn artifact version is available as generic source evidence.',
      confidence: 1,
      extractionVersion: 'read-model-test-v1',
      observedAt: '2026-06-13T20:00:00.000Z',
      sources: [{
        sourceRefType: 'artifact_version',
        sourceRefId: artifactVersionRef.id,
        evidenceRole: 'source_artifact',
        locator: { logicalKey: 'culture-session-1/turn-0' },
        contentHash: artifactVersionRef.content_hash,
      }],
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
      contextRecordCount: 4,
      assertionCount: 1,
      signalCount: 1,
      sourceSpanCount: 3,
    });
    expect(graph?.interactions[0]).toMatchObject({
      interactionType: 'culture_interview',
      externalReference: 'culture-session-1',
    });
    expect(graph?.interactions[0]?.artifactIds).toHaveLength(1);
    expect(graph?.interactions[0]?.contextRecordIds).toEqual(
      expect.arrayContaining([contextRecord.id, genericSourceRecord.id]),
    );
    expect(graph?.interactions[0]?.contextRecordIds).toHaveLength(4);
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

    expect(graph?.contextRecords.map((record) => record.recordType).sort()).toEqual([
      'artifact_version_evidence',
      'culture_interview_turn',
      'culture_statement',
      'source_backed_meaning',
    ]);
    const sourceBackedMeaning = graph?.contextRecords.find((record) => record.id === contextRecord.id);
    expect(sourceBackedMeaning).toMatchObject({
      id: contextRecord.id,
      interactionId: recordRefs.interaction_id,
      applicationId: recordRefs.application_id,
      episodeId: recordRefs.episode_id,
      assertionId: recordRefs.assertion_id,
      recordType: 'source_backed_meaning',
      predicate: 'stream replay implementation',
      narrative: 'implemented FluxCapacitorX for order replay',
      qualifiers: { statementId: 'statement-1' },
      confidence: 0.92,
      extractionVersion: 'read-model-test-v1',
    });
    expect(sourceBackedMeaning?.sources[0]?.exactText).toBe(
      'I implemented FluxCapacitorX for order replay.',
    );
    expect(sourceBackedMeaning?.entities).toEqual(expect.arrayContaining([
      expect.objectContaining({
        entityType: 'workspace_person',
        entityId: recordRefs.workspace_person_id,
        relationship: 'subject',
      }),
      expect.objectContaining({
        entityType: 'business_object',
        entityId: null,
        relationship: 'object',
        value: { literal: 'order replay' },
      }),
    ]));
    expect(sourceBackedMeaning?.concepts[0]).toMatchObject({
      canonicalKey: 'term:flux-capacitor-x',
      label: 'FluxCapacitorX',
      relationship: 'mechanism',
      weight: 0.9,
    });
    const genericSourceMeaning = graph?.contextRecords.find(
      (record) => record.id === genericSourceRecord.id,
    );
    expect(genericSourceMeaning?.sources[0]).toMatchObject({
      sourceRefType: 'artifact_version',
      sourceRefId: artifactVersionRef.id,
      sourceSpanId: null,
      evidenceRole: 'source_artifact',
      locator: { logicalKey: 'culture-session-1/turn-0' },
      contentHash: artifactVersionRef.content_hash,
      metadata: {},
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

  it('shows only source spans cited by scoped context records', async () => {
    const observedAt = '2026-06-13T21:00:00.000Z';
    sqlite.prepare(
      `INSERT INTO role_contexts (
         id, owner_id, baseline, knowledge_state, status, job_description_md, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'role-context-1',
      'workspace-1',
      JSON.stringify({ title: 'Staff Engineer' }),
      JSON.stringify({}),
      'BASELINE',
      'Line A\nLine B',
      observedAt,
      observedAt,
    );

    const store = new LivingContextStore(db, () => observedAt);
    const artifact = await store.upsertArtifact({
      ingestionKey: 'role-context-1:artifact',
      artifactType: 'job_description',
      logicalKey: 'role-context/role-context-1/job-description.md',
      metadata: {},
    });
    const artifactVersion = await store.createArtifactVersion({
      ingestionKey: 'role-context-1:artifact:v1',
      artifactId: artifact.id,
      versionNumber: 1,
      contentHash: 'role-context-1-content-hash',
      mediaType: 'text/markdown',
      contentText: 'Line A\nLine B',
      byteLength: 'Line A\nLine B'.length,
    });
    const citedSpan = await store.createSourceSpan({
      ingestionKey: 'role-context-1:span:cited',
      artifactVersionId: artifactVersion.id,
      stableSegmentId: 'line-a',
      exactText: 'Line A',
      byteStart: 0,
      byteEnd: 6,
      charStart: 0,
      charEnd: 6,
      lineStart: 1,
      lineEnd: 1,
    });
    await store.createSourceSpan({
      ingestionKey: 'role-context-1:span:uncited',
      artifactVersionId: artifactVersion.id,
      stableSegmentId: 'line-b',
      exactText: 'Line B',
      byteStart: 7,
      byteEnd: 13,
      charStart: 7,
      charEnd: 13,
      lineStart: 2,
      lineEnd: 2,
    });
    await store.upsertContextRecord({
      ingestionKey: 'role-context-1:context-record:cited-only',
      scopeType: 'role_context',
      scopeId: 'role-context-1',
      recordType: 'role_requirement',
      predicate: 'requires cited evidence only',
      narrative: 'Line A is the only cited source evidence.',
      confidence: 1,
      extractionVersion: 'read-model-test-v1',
      observedAt,
      sources: [{ sourceSpanId: citedSpan.id, evidenceRole: 'source' }],
    });

    const graph = await loadRoleContextLivingContext(db, 'role-context-1');

    expect(graph).not.toBeNull();
    expect(graph?.summary).toMatchObject({
      artifactCount: 1,
      contextRecordCount: 1,
      sourceSpanCount: 1,
    });
    expect(graph?.artifacts[0]?.sourceSpans.map((span) => span.exactText)).toEqual(['Line A']);
    expect(graph?.contextRecords[0]?.sources.map((source) => source.exactText)).toEqual(['Line A']);
  });
});

describe('loadPersonEvidenceTimeline', () => {
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
      CREATE TABLE pipelines (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL
      );
    `);
    sqlite.exec(livingContextMigration);
    sqlite.exec(transcriptProjectionMigration);
    sqlite.exec(contextRecordMigration);
    sqlite.prepare(
      `INSERT INTO candidates (id, owner_id, pipeline_id, name, email, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('candidate-timeline', 'workspace-1', 'pipeline-1', 'Timeline Person', 'timeline@test.dev', 'active');
    db = createMockD1(sqlite);
  });

  afterEach(() => {
    sqlite.close();
  });

  it('returns chronological entries merging interactions, assertions, and context records', async () => {
    const decomposition: ContextualDecomposition = {
      statements: [
        {
          id: 'stmt-timeline-1',
          type: 'technical capability',
          phrase: 'built distributed cache invalidation',
          surface: 'cache invalidation',
          sourceQuote: 'I built distributed cache invalidation for multi-region deployments.',
          confidence: 0.88,
          semanticTerms: [{
            surface: 'cache invalidation',
            relationship: 'implemented',
            weight: 0.9,
            evidenceLevel: 'implemented',
            strength: 0.85,
          }],
        },
        {
          id: 'stmt-timeline-2',
          type: 'leadership',
          phrase: 'led team of 8 engineers',
          surface: 'team leadership',
          sourceQuote: 'I led a team of 8 engineers on the cache project.',
          confidence: 0.91,
          semanticTerms: [{
            surface: 'team leadership',
            relationship: 'demonstrated',
            weight: 0.85,
            evidenceLevel: 'demonstrated',
            strength: 0.80,
          }],
        },
      ],
      edges: [
        { from: 'candidate', to: 'stmt-timeline-1', predicate: 'implemented' },
        { from: 'candidate', to: 'stmt-timeline-2', predicate: 'demonstrated' },
      ],
      discarded: false,
      probe: null,
      missingContext: [],
    };

    await ingestCultureTurnToLivingContext(db, {
      candidateId: 'candidate-timeline',
      sessionId: 'session-timeline-1',
      turnIndex: 0,
      question: 'Tell me about your biggest technical project.',
      answer: 'I built distributed cache invalidation for multi-region deployments. I led a team of 8 engineers on the cache project.',
      decomposition,
      observedAt: '2026-06-01T10:00:00.000Z',
    });

    // Load the workspace person ID
    const app = sqlite.prepare(
      `SELECT workspace_person_id FROM applications WHERE legacy_candidate_id = ?`,
    ).get('candidate-timeline') as { workspace_person_id: string } | undefined;
    expect(app).toBeDefined();

    const timeline = await loadPersonEvidenceTimeline(db, app!.workspace_person_id);

    expect(timeline.workspacePersonId).toBe(app!.workspace_person_id);
    expect(timeline.totalEntries).toBeGreaterThan(0);

    // Should have at least one interaction entry and assertion entries
    const interactions = timeline.entries.filter((e) => e.entryType === 'interaction');
    const assertions = timeline.entries.filter((e) => e.entryType === 'assertion');
    expect(interactions.length).toBeGreaterThanOrEqual(1);
    expect(assertions.length).toBeGreaterThanOrEqual(1);

    // Assertions should have narratives from the decomposition
    const narratives = assertions.map((a) => a.narrative);
    expect(narratives.some((n) => n.includes('cache invalidation'))).toBe(true);

    // Entries should be sorted by timestamp (most recent first)
    for (let i = 1; i < timeline.entries.length; i++) {
      expect(timeline.entries[i - 1]!.timestamp >= timeline.entries[i]!.timestamp).toBe(true);
    }
  });

  it('respects pagination parameters (before/after)', async () => {
    const decomposition: ContextualDecomposition = {
      statements: [{
        id: 'stmt-page-1',
        type: 'observation',
        phrase: 'paginated test',
        surface: 'pagination',
        sourceQuote: 'Testing pagination.',
        confidence: 0.9,
        semanticTerms: [],
      }],
      edges: [{ from: 'candidate', to: 'stmt-page-1', predicate: 'observed' }],
      discarded: false,
      probe: null,
      missingContext: [],
    };

    await ingestCultureTurnToLivingContext(db, {
      candidateId: 'candidate-timeline',
      sessionId: 'session-page-1',
      turnIndex: 0,
      question: 'Tell me about pagination.',
      answer: 'Testing pagination.',
      decomposition,
      observedAt: '2026-06-15T12:00:00.000Z',
    });

    const app = sqlite.prepare(
      `SELECT workspace_person_id FROM applications WHERE legacy_candidate_id = ?`,
    ).get('candidate-timeline') as { workspace_person_id: string };

    // Full timeline
    const full = await loadPersonEvidenceTimeline(db, app.workspace_person_id);
    expect(full.totalEntries).toBeGreaterThan(0);

    // Only entries before a future date (should include all)
    const beforeFuture = await loadPersonEvidenceTimeline(db, app.workspace_person_id, {
      before: '2030-01-01T00:00:00.000Z',
    });
    expect(beforeFuture.totalEntries).toBe(full.totalEntries);

    // Only entries before a past date (should exclude all)
    const beforePast = await loadPersonEvidenceTimeline(db, app.workspace_person_id, {
      before: '2020-01-01T00:00:00.000Z',
    });
    expect(beforePast.totalEntries).toBe(0);
  });

  it('returns empty timeline for workspace person with no evidence', async () => {
    // Insert a workspace person directly with no interactions
    sqlite.prepare(
      `INSERT INTO people (id, ingestion_key, display_name, primary_email, primary_phone, external_ids_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, '{}', datetime('now'), datetime('now'))`,
    ).run('person-empty', 'person:empty@test.dev', 'Empty Person', 'empty@test.dev');
    sqlite.prepare(
      `INSERT INTO workspace_people (id, ingestion_key, workspace_id, person_id, relationship_summary, context_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, '{}', datetime('now'), datetime('now'))`,
    ).run('wp-empty', 'wp:workspace-1:person-empty', 'workspace-1', 'person-empty');

    const timeline = await loadPersonEvidenceTimeline(db, 'wp-empty');
    expect(timeline.workspacePersonId).toBe('wp-empty');
    expect(timeline.totalEntries).toBe(0);
    expect(timeline.entries).toEqual([]);
  });
});
