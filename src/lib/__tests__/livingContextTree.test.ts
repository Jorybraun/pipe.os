import { describe, expect, it } from 'vitest';
import type { LivingContextReadModel, LivingContextSourceRef } from '../api/types';
import { buildLivingContextBranches, buildLivingContextTree } from '../livingContextTree';

function sourceRef(overrides: Partial<LivingContextSourceRef> = {}): LivingContextSourceRef {
  return {
    sourceRefType: 'source_span',
    sourceRefId: 'span-1',
    sourceSpanId: 'span-1',
    evidenceRole: 'source',
    artifactId: 'artifact-1',
    artifactType: 'meeting_transcript',
    artifactLogicalKey: 'meeting-1',
    artifactVersionId: 'artifact-version-1',
    artifactVersionNumber: 1,
    mediaType: 'text/plain',
    storageKey: null,
    stableSegmentId: 'paragraph-1',
    exactText: 'I used Kafka for ecommerce order retries.',
    byteStart: 0,
    byteEnd: 42,
    charStart: 0,
    charEnd: 42,
    lineStart: 7,
    lineEnd: 7,
    timestampStartMs: null,
    timestampEndMs: null,
    metadata: {},
    ...overrides,
  };
}

function livingContext(): LivingContextReadModel {
  const span = sourceRef();
  const accumulatedSpan = sourceRef({
    sourceRefId: 'resume-span-1',
    sourceSpanId: 'resume-span-1',
    artifactId: 'resume-artifact',
    artifactType: 'resume',
    artifactLogicalKey: 'resume.pdf',
    artifactVersionId: 'resume-version-1',
    stableSegmentId: 'resume-line-3',
    exactText: 'Five years building Node services.',
    lineStart: 3,
    lineEnd: 3,
  });

  return {
    person: {
      personId: 'person-1',
      workspacePersonId: 'workspace-person-1',
      applicationId: 'application-1',
      displayName: 'Ada Lovelace',
      primaryEmail: 'ada@example.com',
      primaryPhone: null,
      relationshipSummary: 'Interviewed for source-backed systems work.',
      applicationStatus: 'active',
      pipelineId: null,
      roles: [],
    },
    summary: {
      interactionCount: 1,
      artifactCount: 2,
      contextRecordCount: 2,
      assertionCount: 1,
      signalCount: 1,
      sourceSpanCount: 2,
    },
    interactions: [{
      id: 'interaction-1',
      interactionType: 'video_interview',
      externalReference: 'meeting-1',
      startedAt: '2026-06-23T15:00:00.000Z',
      endedAt: '2026-06-23T15:30:00.000Z',
      createdAt: '2026-06-23T15:00:00.000Z',
      updatedAt: '2026-06-23T15:30:00.000Z',
      metadata: {},
      artifactIds: ['artifact-1'],
      contextRecordIds: ['record-1'],
      assertionIds: ['assertion-1'],
      signalKeys: ['term:order-event-idempotency'],
    }],
    artifacts: [
      {
        id: 'artifact-1',
        interactionId: 'interaction-1',
        artifactType: 'meeting_transcript',
        logicalKey: 'meeting-1',
        metadata: {},
        latestVersionId: 'artifact-version-1',
        latestVersionNumber: 1,
        versionCount: 1,
        mediaType: 'text/plain',
        storageKey: null,
        createdAt: '2026-06-23T15:00:00.000Z',
        updatedAt: '2026-06-23T15:30:00.000Z',
        sourceSpans: [span],
      },
      {
        id: 'resume-artifact',
        interactionId: null,
        artifactType: 'resume',
        logicalKey: 'resume.pdf',
        metadata: {},
        latestVersionId: 'resume-version-1',
        latestVersionNumber: 1,
        versionCount: 1,
        mediaType: 'text/plain',
        storageKey: null,
        createdAt: '2026-06-22T12:00:00.000Z',
        updatedAt: '2026-06-22T12:00:00.000Z',
        sourceSpans: [accumulatedSpan],
      },
    ],
    contextRecords: [
      {
        id: 'record-1',
        scopeType: 'meeting',
        scopeId: 'meeting-1',
        interactionId: null,
        applicationId: null,
        episodeId: null,
        assertionId: null,
        recordType: 'candidate_statement',
        predicate: 'preserves candidate statement',
        narrative: 'Candidate described Kafka order retries.',
        qualifiers: {},
        confidence: 1,
        polarity: 1,
        extractionVersion: 'test-open-concept-v1',
        observedAt: '2026-06-23T15:00:00.000Z',
        entities: [],
        concepts: [{
          id: 'concept-1',
          canonicalKey: 'term:order-event-idempotency',
          namespace: 'term',
          label: 'order event idempotency',
          relationship: 'mentions',
          weight: 1,
        }],
        sources: [span],
      },
      {
        id: 'record-2',
        scopeType: 'person',
        scopeId: 'person-1',
        interactionId: null,
        applicationId: null,
        episodeId: null,
        assertionId: null,
        recordType: 'resume_statement',
        predicate: 'preserves resume statement',
        narrative: 'Candidate described Node services.',
        qualifiers: {},
        confidence: 1,
        polarity: 1,
        extractionVersion: 'test-open-concept-v1',
        observedAt: '2026-06-22T12:00:00.000Z',
        entities: [],
        concepts: [],
        sources: [accumulatedSpan],
      },
    ],
    assertions: [{
      id: 'assertion-1',
      interactionId: 'interaction-1',
      episodeId: null,
      subjectType: 'person',
      subjectId: 'person-1',
      predicate: 'described implementation experience',
      narrative: 'Ada described order event idempotency.',
      confidence: 0.92,
      polarity: 1,
      extractionVersion: 'test-open-concept-v1',
      observedAt: '2026-06-23T15:00:00.000Z',
      qualifiers: {},
      concepts: [{
        id: 'concept-1',
        canonicalKey: 'term:order-event-idempotency',
        namespace: 'term',
        label: 'order event idempotency',
        relationship: 'supports',
        weight: 1,
      }],
      sources: [span],
    }],
    signals: [{
      signalKey: 'term:order-event-idempotency',
      label: 'order event idempotency',
      namespace: 'term',
      interactionId: 'interaction-1',
      asOf: '2026-06-23T15:30:00.000Z',
      conversationScore: 0.92,
      totalScore: 0.92,
      confidence: 0.92,
      evidenceCount: 1,
      sourceDiversity: 1,
      dimensions: {},
      policyVersion: 'test-open-concept-v1',
      evidence: [{
        id: 'signal-evidence-1',
        interactionId: 'interaction-1',
        assertionId: 'assertion-1',
        conceptId: 'concept-1',
        evidenceLevel: 'mentioned',
        strength: 0.92,
        polarity: 1,
        observedAt: '2026-06-23T15:00:00.000Z',
        assertionNarrative: 'Ada described order event idempotency.',
        assertionPredicate: 'described implementation experience',
        sources: [span],
      }],
    }],
    relationships: [],
  };
}

describe('living context tree projection', () => {
  it('keeps meeting evidence source-backed and preserves open concepts', () => {
    const [branch] = buildLivingContextBranches(livingContext());

    expect(branch?.isMeetingEvidence).toBe(true);
    expect(branch?.contextRecords).toHaveLength(1);
    expect(branch?.contextRecords[0]?.concepts[0]).toMatchObject({
      canonicalKey: 'term:order-event-idempotency',
      label: 'order event idempotency',
    });
    expect(branch?.node.children.some((node) =>
      node.kind === 'context_record'
      && node.sourceText === 'Candidate described Kafka order retries.',
    )).toBe(true);
    expect(branch?.node.children.some((node) =>
      node.kind === 'artifact'
      && node.children.some((child) =>
        child.kind === 'source_span'
        && child.sourceText === 'I used Kafka for ecommerce order retries.',
      ),
    )).toBe(true);
  });

  it('separates accumulated person context from interaction evidence', () => {
    const tree = buildLivingContextTree(livingContext());

    expect(tree.root.label).toBe('Ada Lovelace');
    expect(tree.interactionBranches).toHaveLength(1);
    expect(tree.accumulatedNode?.children.some((node) =>
      node.kind === 'artifact'
      && node.children.some((child) =>
        child.kind === 'source_span'
        && child.sourceText === 'Five years building Node services.',
      ),
    )).toBe(true);
    expect(tree.accumulatedNode?.children.some((node) =>
      node.kind === 'context_record'
      && node.sourceText === 'Candidate described Kafka order retries.',
    )).toBe(false);
  });
});
