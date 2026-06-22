import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMockD1, type BetterSqliteDb } from '../../../__tests__/helpers/mockD1';
import { LivingContextStore } from '../persistence';
import type { ContextRecordInput } from '../types';



const migrationSql = readFileSync(
  new URL('../../../../migrations/0082_living_context_graph.sql', import.meta.url),
  'utf8',
);
const contextRecordMigrationSql = readFileSync(
  new URL('../../../../migrations/0095_context_records.sql', import.meta.url),
  'utf8',
);
const NOW = '2026-06-11T12:00:00.000Z';



describe('LivingContextStore', () => {
  let sqlite: BetterSqliteDb;
  let store: LivingContextStore;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec('PRAGMA foreign_keys = ON; CREATE TABLE candidates (id TEXT PRIMARY KEY);');
    sqlite.exec(migrationSql);
    sqlite.exec(contextRecordMigrationSql);
    store = new LivingContextStore(createMockD1(sqlite), () => NOW);
  });

  afterEach(() => {
    sqlite.close();
  });

  it('replays identity, workspace context, roles, and legacy application linkage idempotently', async () => {
    sqlite.prepare('INSERT INTO candidates (id) VALUES (?)').run('candidate-17');

    const person = await store.upsertPerson({
      ingestionKey: 'person:email:ada@example.com',
      displayName: 'Ada Lovelace',
      primaryEmail: ' ADA@EXAMPLE.COM ',
      externalIds: { crm: 'contact-9' },
    });
    const replayedPerson = await store.upsertPerson({
      ingestionKey: 'person:email:ada@example.com',
      displayName: 'Ada Byron Lovelace',
      primaryEmail: 'ada@example.com',
      externalIds: { crm: 'contact-9' },
    });

    const workspacePerson = await store.upsertWorkspacePerson({
      ingestionKey: 'workspace:acme:person:ada',
      workspaceId: 'acme',
      personId: person.id,
      relationshipSummary: 'Candidate and prior collaborator',
      context: { source: 'meeting', firstSeenAt: '2026-01-01T00:00:00.000Z' },
    });
    await store.upsertWorkspacePerson({
      ingestionKey: 'workspace:acme:person:ada',
      workspaceId: 'acme',
      personId: person.id,
      relationshipSummary: 'Candidate, prior collaborator, and advisor',
      context: { source: 'meeting', conversationCount: 2 },
    });

    const application = await store.upsertApplication({
      ingestionKey: 'application:candidate-17',
      workspacePersonId: workspacePerson.id,
      legacyCandidateId: 'candidate-17',
      pipelineId: 'pipeline-3',
      status: 'IN_PROGRESS',
    });
    await store.upsertPersonRole({
      ingestionKey: 'role:candidate-17',
      workspacePersonId: workspacePerson.id,
      applicationId: application.id,
      roleType: 'candidate',
      label: 'Backend engineer applicant',
    });
    await store.upsertPersonRole({
      ingestionKey: 'role:candidate-17',
      workspacePersonId: workspacePerson.id,
      applicationId: application.id,
      roleType: 'candidate',
      label: 'Distributed systems applicant',
    });

    expect(replayedPerson.id).toBe(person.id);
    expect(sqlite.prepare('SELECT count(*) AS count FROM people').get()).toEqual({ count: 1 });
    expect(sqlite.prepare('SELECT count(*) AS count FROM workspace_people').get()).toEqual({ count: 1 });
    expect(sqlite.prepare('SELECT count(*) AS count FROM applications').get()).toEqual({ count: 1 });
    expect(sqlite.prepare('SELECT count(*) AS count FROM person_roles').get()).toEqual({ count: 1 });
    expect(sqlite.prepare(
      'SELECT display_name, primary_email FROM people WHERE id = ?',
    ).get(person.id)).toEqual({
      display_name: 'Ada Byron Lovelace',
      primary_email: 'ada@example.com',
    });
    expect(sqlite.prepare(
      'SELECT legacy_candidate_id FROM applications WHERE id = ?',
    ).get(application.id)).toEqual({ legacy_candidate_id: 'candidate-17' });
    expect(JSON.parse(sqlite.prepare(
      'SELECT context_json FROM workspace_people WHERE id = ?',
    ).get(workspacePerson.id)!.context_json as string)).toEqual({
      conversationCount: 2,
      firstSeenAt: '2026-01-01T00:00:00.000Z',
      source: 'meeting',
    });
  });

  it('reuses the existing application when the same legacy candidate is replayed with another ingestion key', async () => {
    sqlite.prepare('INSERT INTO candidates (id) VALUES (?)').run('candidate-29');

    const person = await store.upsertPerson({
      ingestionKey: 'person:email:grace@example.com',
      displayName: 'Grace Hopper',
      primaryEmail: 'grace@example.com',
    });
    const workspacePerson = await store.upsertWorkspacePerson({
      ingestionKey: 'workspace:acme:person:grace',
      workspaceId: 'acme',
      personId: person.id,
    });

    const seededApplication = await store.upsertApplication({
      ingestionKey: 'application:candidate:candidate-29',
      workspacePersonId: workspacePerson.id,
      legacyCandidateId: 'candidate-29',
      pipelineId: null,
      status: 'standalone_code_review_match_fixture',
      context: { seededBy: 'e2e' },
    });
    const replayedApplication = await store.upsertApplication({
      ingestionKey: 'candidate:candidate-29',
      workspacePersonId: workspacePerson.id,
      legacyCandidateId: 'candidate-29',
      pipelineId: null,
      status: 'IN_PROGRESS',
      context: { source: 'candidate_profile' },
    });

    expect(replayedApplication).toEqual(seededApplication);
    expect(sqlite.prepare('SELECT count(*) AS count FROM applications').get()).toEqual({ count: 1 });
    expect(sqlite.prepare(
      `SELECT ingestion_key, legacy_candidate_id, status, context_json
         FROM applications
        WHERE legacy_candidate_id = ?`,
    ).get('candidate-29')).toEqual({
      ingestion_key: 'application:candidate:candidate-29',
      legacy_candidate_id: 'candidate-29',
      status: 'IN_PROGRESS',
      context_json: JSON.stringify({ source: 'candidate_profile' }),
    });
  });

  it('reuses open concepts by canonical key across ingestion sources', async () => {
    const candidateConcept = await store.upsertConcept({
      ingestionKey: 'open-term:term:kafka',
      canonicalKey: 'term:kafka',
      namespace: 'term',
      label: 'Kafka',
      metadata: { source: 'candidate_context' },
    });
    const repoConcept = await store.upsertConcept({
      ingestionKey: 'repo-open-concept:term:kafka',
      canonicalKey: 'term:kafka',
      namespace: 'term',
      label: 'kafka',
      metadata: { source: 'repo_challenge_packet' },
    });

    expect(repoConcept.id).toBe(candidateConcept.id);
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM concepts').get()).toEqual({ count: 1 });
    expect(sqlite.prepare(
      'SELECT ingestion_key, canonical_key, namespace, label FROM concepts WHERE id = ?',
    ).get(candidateConcept.id)).toEqual({
      ingestion_key: 'open-term:term:kafka',
      canonical_key: 'term:kafka',
      namespace: 'term',
      label: 'kafka',
    });
  });

  it('stores exact immutable provenance and rejects a conflicting replay', async () => {
    const person = await store.upsertPerson({ ingestionKey: 'person:1' });
    const workspacePerson = await store.upsertWorkspacePerson({
      ingestionKey: 'workspace-person:1',
      workspaceId: 'workspace-1',
      personId: person.id,
    });
    const interaction = await store.upsertInteraction({
      ingestionKey: 'meeting:42',
      workspacePersonId: workspacePerson.id,
      interactionType: 'video_meeting',
      externalReference: 'room-42',
      startedAt: '2026-06-11T10:00:00.000Z',
    });
    const artifact = await store.upsertArtifact({
      ingestionKey: 'meeting:42:transcript',
      workspacePersonId: workspacePerson.id,
      interactionId: interaction.id,
      artifactType: 'transcript',
      logicalKey: 'room-42/transcript',
    });
    const version = await store.createArtifactVersion({
      ingestionKey: 'meeting:42:transcript:sha256:abc',
      artifactId: artifact.id,
      versionNumber: 1,
      contentHash: 'sha256:abc',
      mediaType: 'text/plain',
      contentText: 'I implemented ordered replay for ecommerce orders using Kafka.',
      byteLength: 63,
      metadata: { language: 'en' },
    });
    const spanInput = {
      ingestionKey: 'meeting:42:segment:turn-7:0-63',
      artifactVersionId: version.id,
      stableSegmentId: 'turn-7',
      byteStart: 0,
      byteEnd: 63,
      charStart: 0,
      charEnd: 63,
      lineStart: 14,
      lineEnd: 14,
      timestampStartMs: 31_200,
      timestampEndMs: 38_900,
      exactText: 'I implemented ordered replay for ecommerce orders using Kafka.',
      metadata: { speaker: 'candidate' },
    } as const;
    const span = await store.createSourceSpan(spanInput);
    const replayedSpan = await store.createSourceSpan(spanInput);

    expect(replayedSpan.id).toBe(span.id);
    expect(sqlite.prepare('SELECT count(*) AS count FROM artifact_versions').get()).toEqual({ count: 1 });
    expect(sqlite.prepare('SELECT count(*) AS count FROM source_spans').get()).toEqual({ count: 1 });
    expect(sqlite.prepare(
      `SELECT stable_segment_id, byte_start, byte_end, char_start, char_end,
              line_start, line_end, timestamp_start_ms, timestamp_end_ms, exact_text
         FROM source_spans WHERE id = ?`,
    ).get(span.id)).toEqual({
      stable_segment_id: 'turn-7',
      byte_start: 0,
      byte_end: 63,
      char_start: 0,
      char_end: 63,
      line_start: 14,
      line_end: 14,
      timestamp_start_ms: 31_200,
      timestamp_end_ms: 38_900,
      exact_text: spanInput.exactText,
    });

    await expect(store.createSourceSpan({
      ...spanInput,
      exactText: 'A different sentence.',
    })).rejects.toThrow('replayed with different exact_text');
  });

  it('persists flexible assertions, accumulated signals, and one deduplicated projection job', async () => {
    const person = await store.upsertPerson({ ingestionKey: 'person:2' });
    const workspacePerson = await store.upsertWorkspacePerson({
      ingestionKey: 'workspace-person:2',
      workspaceId: 'workspace-1',
      personId: person.id,
    });
    const interaction = await store.upsertInteraction({
      ingestionKey: 'meeting:84',
      workspacePersonId: workspacePerson.id,
      interactionType: 'video_meeting',
    });
    const artifact = await store.upsertArtifact({
      ingestionKey: 'meeting:84:transcript',
      workspacePersonId: workspacePerson.id,
      interactionId: interaction.id,
      artifactType: 'transcript',
    });
    const version = await store.createArtifactVersion({
      ingestionKey: 'meeting:84:transcript:v1',
      artifactId: artifact.id,
      versionNumber: 1,
      contentHash: 'sha256:def',
      mediaType: 'text/plain',
      contentText: 'Kafka statement',
    });
    const span = await store.createSourceSpan({
      ingestionKey: 'meeting:84:span:1',
      artifactVersionId: version.id,
      stableSegmentId: 'turn-1',
      exactText: 'Kafka statement',
    });
    const episode = await store.upsertEpisode({
      ingestionKey: 'meeting:84:episode:order-replay',
      workspacePersonId: workspacePerson.id,
      interactionId: interaction.id,
      narrative: 'Discussion of ordered event replay',
    });
    const assertion = await store.upsertAssertion({
      ingestionKey: 'meeting:84:assertion:1',
      workspacePersonId: workspacePerson.id,
      episodeId: episode.id,
      subjectType: 'person',
      subjectId: person.id,
      predicate: 'implemented ordered replay for ecommerce orders using',
      objectType: 'technology',
      objectValue: { canonicalKey: 'technology:kafka' },
      narrative: 'Implemented Kafka-based ordered replay for ecommerce orders.',
      qualifiers: { domain: 'ecommerce', businessObject: 'order' },
      confidence: 0.91,
      observedAt: '2026-06-11T10:10:00.000Z',
    });
    await store.linkAssertionSourceSpan(assertion.id, span.id, 'direct_quote');
    const concept = await store.upsertConcept({
      ingestionKey: 'concept:technology:kafka',
      canonicalKey: 'technology:kafka',
      namespace: 'technology',
      label: 'Kafka',
    });
    await store.linkAssertionConcept(assertion.id, concept.id, 'mechanism', 0.95);
    await store.upsertSignalEvidence({
      ingestionKey: 'evidence:meeting-84:kafka-implementation',
      workspacePersonId: workspacePerson.id,
      interactionId: interaction.id,
      assertionId: assertion.id,
      conceptId: concept.id,
      signalKey: 'technology:kafka',
      evidenceLevel: 'implemented',
      strength: 0.88,
      observedAt: '2026-06-11T10:10:00.000Z',
    });
    await store.upsertSignalSnapshot({
      ingestionKey: 'snapshot:person-2:kafka:2026-06-11',
      workspacePersonId: workspacePerson.id,
      signalKey: 'technology:kafka',
      interactionId: interaction.id,
      asOf: NOW,
      conversationScore: 0.82,
      totalScore: 0.76,
      confidence: 0.84,
      evidenceCount: 3,
      sourceDiversity: 2,
      policyVersion: 'living-context-v1',
    });
    await store.upsertSemanticRelationship({
      ingestionKey: 'relationship:assertion-1:order-replay',
      workspacePersonId: workspacePerson.id,
      fromEntityType: 'assertion',
      fromEntityId: assertion.id,
      predicate: 'reduced duplicate fulfillment during ordered replay of',
      toValue: { businessObject: 'order event' },
      sourceAssertionId: assertion.id,
    });
    const firstJob = await store.enqueueProjection({
      ingestionKey: 'neo4j:workspace-person-2:revision-7',
      projectionType: 'neo4j',
      aggregateType: 'workspace_person',
      aggregateId: workspacePerson.id,
      payload: { assertionIds: [assertion.id] },
    });
    const replayedJob = await store.enqueueProjection({
      ingestionKey: 'neo4j:workspace-person-2:revision-7',
      projectionType: 'neo4j',
      aggregateType: 'workspace_person',
      aggregateId: workspacePerson.id,
      payload: { assertionIds: [assertion.id], signalKeys: ['technology:kafka'] },
    });

    expect(replayedJob.id).toBe(firstJob.id);
    expect(sqlite.prepare('SELECT count(*) AS count FROM projection_outbox').get()).toEqual({ count: 1 });
    expect(sqlite.prepare(
      'SELECT predicate FROM semantic_assertions WHERE id = ?',
    ).get(assertion.id)).toEqual({
      predicate: 'implemented ordered replay for ecommerce orders using',
    });
    expect(sqlite.prepare(
      'SELECT predicate FROM semantic_relationships',
    ).get()).toEqual({
      predicate: 'reduced duplicate fulfillment during ordered replay of',
    });
    expect(sqlite.prepare(
      'SELECT status, payload_json FROM projection_outbox WHERE id = ?',
    ).get(firstJob.id)).toEqual({
      status: 'pending',
      payload_json: JSON.stringify({
        assertionIds: [assertion.id],
        signalKeys: ['technology:kafka'],
      }),
    });
    expect(sqlite.prepare(
      `SELECT conversation_score, total_score
         FROM signal_snapshots WHERE signal_key = 'technology:kafka'`,
    ).get()).toEqual({
      conversation_score: 0.82,
      total_score: 0.76,
    });
  });

  it('replays source-backed context records idempotently and preserves unknown concepts', async () => {
    const person = await store.upsertPerson({ ingestionKey: 'person:context-record' });
    const workspacePerson = await store.upsertWorkspacePerson({
      ingestionKey: 'workspace-person:context-record',
      workspaceId: 'workspace-1',
      personId: person.id,
    });
    const interaction = await store.upsertInteraction({
      ingestionKey: 'meeting:context-record',
      workspacePersonId: workspacePerson.id,
      interactionType: 'video_meeting',
    });
    const artifact = await store.upsertArtifact({
      ingestionKey: 'meeting:context-record:transcript',
      workspacePersonId: workspacePerson.id,
      interactionId: interaction.id,
      artifactType: 'transcript',
    });
    const version = await store.createArtifactVersion({
      ingestionKey: 'meeting:context-record:transcript:v1',
      artifactId: artifact.id,
      versionNumber: 1,
      contentHash: 'sha256:context-record',
      mediaType: 'text/plain',
      contentText: 'I used Kafka for ecommerce order events.',
    });
    const span = await store.createSourceSpan({
      ingestionKey: 'meeting:context-record:span:1',
      artifactVersionId: version.id,
      stableSegmentId: 'paragraph-0014',
      exactText: 'I used Kafka for ecommerce order events.',
    });
    const concept = await store.upsertConcept({
      ingestionKey: 'open-term:previously-unseen-event-stream',
      canonicalKey: 'term:previously-unseen-event-stream',
      namespace: 'term',
      label: 'previously unseen event stream',
      metadata: { source: 'unit_test_unknown_concept' },
    });

    const input: ContextRecordInput = {
      ingestionKey: 'context-record:meeting:14:kafka-orders',
      workspacePersonId: workspacePerson.id,
      interactionId: interaction.id,
      recordType: 'source_backed_meaning',
      predicate: 'used for',
      narrative: 'I used Kafka for ecommerce order events.',
      qualifiers: { sourceSegmentId: 'paragraph-0014' },
      confidence: 0.88,
      extractionVersion: 'context-record-test-v1',
      observedAt: NOW,
      sources: [{ sourceSpanId: span.id, evidenceRole: 'source' }],
      entities: [
        {
          entityType: 'workspace_person',
          entityId: workspacePerson.id,
          relationship: 'speaker',
        },
        {
          entityType: 'business_object',
          relationship: 'object',
          value: { literal: 'ecommerce order events' },
        },
      ],
      concepts: [{ conceptId: concept.id, relationship: 'mechanism', weight: 0.93 }],
    };

    const first = await store.upsertContextRecord(input);
    const replayed = await store.upsertContextRecord(input);

    expect(replayed.id).toBe(first.id);
    expect(sqlite.prepare('SELECT count(*) AS count FROM context_records').get()).toEqual({
      count: 1,
    });
    expect(sqlite.prepare('SELECT count(*) AS count FROM context_record_source_spans').get()).toEqual({
      count: 1,
    });
    expect(sqlite.prepare('SELECT count(*) AS count FROM context_record_source_refs').get()).toEqual({
      count: 1,
    });
    expect(sqlite.prepare('SELECT count(*) AS count FROM context_record_entities').get()).toEqual({
      count: 2,
    });
    expect(sqlite.prepare('SELECT count(*) AS count FROM context_record_concepts').get()).toEqual({
      count: 1,
    });
    expect(sqlite.prepare(
      `SELECT c.canonical_key
         FROM context_record_concepts crc
         JOIN concepts c ON c.id = crc.concept_id`,
    ).get()).toEqual({
      canonical_key: 'term:previously-unseen-event-stream',
    });
    await expect(store.upsertContextRecord({
      ...input,
      sources: [{ sourceSpanId: 'missing-source-span', evidenceRole: 'source' }],
    })).rejects.toThrow(
      `source span missing-source-span for workspace person ${workspacePerson.id} does not exist`,
    );
    expect(sqlite.prepare('SELECT count(*) AS count FROM context_records').get()).toEqual({
      count: 1,
    });
    expect(sqlite.prepare('SELECT count(*) AS count FROM context_record_source_spans').get()).toEqual({
      count: 1,
    });
    expect(sqlite.prepare('SELECT count(*) AS count FROM context_record_source_refs').get()).toEqual({
      count: 1,
    });
    expect(sqlite.prepare('SELECT count(*) AS count FROM context_record_entities').get()).toEqual({
      count: 2,
    });
    expect(sqlite.prepare('SELECT count(*) AS count FROM context_record_concepts').get()).toEqual({
      count: 1,
    });
    expect(sqlite.prepare(
      'SELECT source_span_id FROM context_record_source_spans WHERE context_record_id = ?',
    ).get(first.id)).toEqual({ source_span_id: span.id });

    await store.enqueueProjection({
      ingestionKey: `projection:context-record:${first.id}:v1`,
      projectionType: 'neo4j',
      aggregateType: 'workspace_person',
      aggregateId: workspacePerson.id,
      operation: 'rebuild',
      payload: { contextRecordIds: [first.id], sourceSpanIds: [span.id] },
    });
    sqlite.prepare('DELETE FROM projection_outbox').run();
    const sourceBackedRows = sqlite.prepare(
      `SELECT cr.id AS context_record_id, crss.source_span_id
         FROM context_records cr
         JOIN context_record_source_spans crss ON crss.context_record_id = cr.id
        WHERE cr.workspace_person_id = ?`,
    ).all(workspacePerson.id) as { context_record_id: string; source_span_id: string }[];
    await store.enqueueProjection({
      ingestionKey: `projection:context-record:${first.id}:rebuilt`,
      projectionType: 'neo4j',
      aggregateType: 'workspace_person',
      aggregateId: workspacePerson.id,
      operation: 'rebuild',
      payload: {
        contextRecordIds: sourceBackedRows.map((row) => row.context_record_id),
        sourceSpanIds: sourceBackedRows.map((row) => row.source_span_id),
      },
    });
    expect(sqlite.prepare('SELECT count(*) AS count FROM context_records').get()).toEqual({
      count: 1,
    });
    expect(sqlite.prepare('SELECT count(*) AS count FROM projection_outbox').get()).toEqual({
      count: 1,
    });
  });

  it('persists repo-scoped context records through generic source refs', async () => {
    sqlite.exec(`
      CREATE TABLE repo_source_spans (
        id TEXT PRIMARY KEY,
        exact_text TEXT NOT NULL,
        content_hash TEXT NOT NULL
      );
    `);
    sqlite.prepare(
      'INSERT INTO repo_source_spans (id, exact_text, content_hash) VALUES (?, ?, ?)',
    ).run(
      'repo-span-1',
      'export async function reconcileQuantumLedger() { return "stable"; }',
      'sha256:repo-span-1',
    );

    const record = await store.upsertContextRecord({
      ingestionKey: 'context-record:repo:pr-7:reconcile-ledger',
      scopeType: 'repo_snapshot',
      scopeId: 'repo-snapshot-1',
      recordType: 'repo_pr_meaning',
      predicate: 'changes behavior in',
      narrative: 'PR 7 changes reconcileQuantumLedger behavior.',
      sources: [{
        sourceRefType: 'repo_source_span',
        sourceRefId: 'repo-span-1',
        evidenceRole: 'source',
        locator: {
          path: 'src/quantumLedger.ts',
          lineStart: 1,
          lineEnd: 1,
          prNumber: 7,
        },
        exactText: 'export async function reconcileQuantumLedger() { return "stable"; }',
        contentHash: 'sha256:repo-span-1',
      }],
      entities: [
        {
          entityType: 'repo_snapshot',
          entityId: 'repo-snapshot-1',
          relationship: 'scope',
        },
        {
          entityType: 'pull_request',
          entityId: 'pr:7',
          relationship: 'changed_by',
        },
      ],
    });

    expect(sqlite.prepare(
      `SELECT scope_type, scope_id, workspace_person_id
         FROM context_records WHERE id = ?`,
    ).get(record.id)).toEqual({
      scope_type: 'repo_snapshot',
      scope_id: 'repo-snapshot-1',
      workspace_person_id: null,
    });
    expect(sqlite.prepare('SELECT count(*) AS count FROM context_record_source_spans').get()).toEqual({
      count: 0,
    });
    expect(sqlite.prepare(
      `SELECT source_ref_type, source_ref_id, evidence_role, exact_text, content_hash
         FROM context_record_source_refs WHERE context_record_id = ?`,
    ).get(record.id)).toEqual({
      source_ref_type: 'repo_source_span',
      source_ref_id: 'repo-span-1',
      evidence_role: 'source',
      exact_text: 'export async function reconcileQuantumLedger() { return "stable"; }',
      content_hash: 'sha256:repo-span-1',
    });
    expect(sqlite.prepare('SELECT count(*) AS count FROM context_record_entities').get()).toEqual({
      count: 2,
    });
  });

  it('rejects repo source refs with mismatched immutable text or hash', async () => {
    sqlite.exec(`
      CREATE TABLE repo_source_spans (
        id TEXT PRIMARY KEY,
        exact_text TEXT NOT NULL,
        content_hash TEXT NOT NULL
      );
    `);
    sqlite.prepare(
      'INSERT INTO repo_source_spans (id, exact_text, content_hash) VALUES (?, ?, ?)',
    ).run(
      'repo-span-mismatch',
      'const verified = true;',
      'sha256:verified',
    );

    const baseInput: ContextRecordInput = {
      ingestionKey: 'context-record:repo:mismatch',
      scopeType: 'repo_snapshot',
      scopeId: 'repo-snapshot-2',
      recordType: 'repo_pr_meaning',
      narrative: 'PR source evidence must match the immutable repo span.',
      sources: [{
        sourceRefType: 'repo_source_span',
        sourceRefId: 'repo-span-mismatch',
        evidenceRole: 'source',
        locator: { path: 'src/verified.ts' },
        exactText: 'const verified = true;',
        contentHash: 'sha256:verified',
      }],
    };

    await expect(store.upsertContextRecord({
      ...baseInput,
      sources: [{
        ...baseInput.sources[0],
        exactText: 'const verified = false;',
      }],
    })).rejects.toThrow('repo source span repo-span-mismatch exactText does not match');

    await expect(store.upsertContextRecord({
      ...baseInput,
      sources: [{
        ...baseInput.sources[0],
        contentHash: 'sha256:unverified',
      }],
    })).rejects.toThrow('repo source span repo-span-mismatch contentHash does not match');

    expect(sqlite.prepare('SELECT count(*) AS count FROM context_records').get()).toEqual({
      count: 0,
    });
  });

  it('rejects context records without exact source-span provenance', async () => {
    const person = await store.upsertPerson({ ingestionKey: 'person:no-source-record' });
    const workspacePerson = await store.upsertWorkspacePerson({
      ingestionKey: 'workspace-person:no-source-record',
      workspaceId: 'workspace-1',
      personId: person.id,
    });

    await expect(store.upsertContextRecord({
      ingestionKey: 'context-record:no-source',
      workspacePersonId: workspacePerson.id,
      recordType: 'source_backed_meaning',
      narrative: 'This cannot be claimed without a source span.',
      sources: [],
    })).rejects.toThrow('requires at least one source span or source ref');
  });

  it('rejects context records that cite another workspace person source span', async () => {
    const person = await store.upsertPerson({ ingestionKey: 'person:span-owner' });
    const workspacePerson = await store.upsertWorkspacePerson({
      ingestionKey: 'workspace-person:span-owner',
      workspaceId: 'workspace-1',
      personId: person.id,
    });
    const otherPerson = await store.upsertPerson({ ingestionKey: 'person:span-owner-other' });
    const otherWorkspacePerson = await store.upsertWorkspacePerson({
      ingestionKey: 'workspace-person:span-owner-other',
      workspaceId: 'workspace-1',
      personId: otherPerson.id,
    });
    const otherArtifact = await store.upsertArtifact({
      ingestionKey: 'artifact:span-owner-other',
      workspacePersonId: otherWorkspacePerson.id,
      artifactType: 'transcript',
    });
    const otherVersion = await store.createArtifactVersion({
      ingestionKey: 'artifact:span-owner-other:v1',
      artifactId: otherArtifact.id,
      versionNumber: 1,
      contentHash: 'sha256:other-span-owner',
      mediaType: 'text/plain',
      contentText: 'This source belongs to a different person.',
    });
    const otherSpan = await store.createSourceSpan({
      ingestionKey: 'artifact:span-owner-other:span:1',
      artifactVersionId: otherVersion.id,
      exactText: 'This source belongs to a different person.',
    });

    await expect(store.upsertContextRecord({
      ingestionKey: 'context-record:wrong-span-owner',
      workspacePersonId: workspacePerson.id,
      recordType: 'source_backed_meaning',
      narrative: 'This claim cannot borrow another person source span.',
      sources: [{ sourceSpanId: otherSpan.id, evidenceRole: 'source' }],
    })).rejects.toThrow(
      `source span ${otherSpan.id} for workspace person ${workspacePerson.id} does not exist`,
    );

    expect(sqlite.prepare('SELECT count(*) AS count FROM context_records').get()).toEqual({
      count: 0,
    });
  });
});
