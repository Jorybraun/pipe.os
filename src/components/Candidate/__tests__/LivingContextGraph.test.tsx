import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { LivingContextGraph } from '../LivingContextGraph';
import type {
  LivingContextReadModel,
  LivingContextSourceRef,
  StandaloneReviewMatchRecord,
} from '../../../lib/api/types';

const mocks = vi.hoisted(() => ({
  livingContext: null as LivingContextReadModel | null,
  refetch: vi.fn(),
}));

vi.mock('../../../hooks/useLivingContext', () => ({
  useLivingContext: () => ({
    livingContext: mocks.livingContext,
    isLoading: false,
    error: null,
    refetch: mocks.refetch,
  }),
}));

function makeLivingContext(): LivingContextReadModel {
  return {
    person: {
      personId: 'person-1',
      workspacePersonId: 'workspace-person-1',
      applicationId: 'application-1',
      displayName: 'Ada Lovelace',
      primaryEmail: 'ada@example.com',
      primaryPhone: null,
      relationshipSummary: null,
      applicationStatus: 'active',
      pipelineId: null,
      roles: [{
        id: 'role-1',
        roleType: 'candidate',
        label: 'Candidate',
        applicationId: 'application-1',
        attributes: {},
        activeFrom: null,
        activeTo: null,
      }],
    },
    summary: {
      interactionCount: 0,
      artifactCount: 0,
      contextRecordCount: 0,
      assertionCount: 0,
      signalCount: 0,
      sourceSpanCount: 0,
    },
    interactions: [],
    artifacts: [],
    contextRecords: [],
    assertions: [],
    signals: [],
    relationships: [],
  };
}

function makeStandaloneReviewMatch(): StandaloneReviewMatchRecord {
  return {
    interviewId: 'interview-1',
    interviewStatus: 'MATCHED',
    matchStatus: 'MATCHED',
    matchRunId: 'match-run-1',
    repoId: 7,
    repoName: 'pipe/source-backed-orders',
    repoUrl: 'https://github.com/pipe/source-backed-orders',
    prNumber: 42,
    prUrl: 'https://github.com/pipe/source-backed-orders/pull/42',
    prTitle: 'Add Kafka-backed order retry handling',
    score: 0.82,
    summary: 'Matched 2 source-backed demands (1 stretch).',
    evidence: [{
      atomId: 'candidate-atom-kafka',
      demandId: 'repo-demand-retry',
      purpose: 'validation',
      pairScore: 0.91,
      sharedConcepts: ['term:kafka-order-events'],
      candidateSourceRefs: [{
        artifactId: 'resume-artifact',
        artifactVersion: 'v1',
        contentHash: 'candidate-hash',
        startOffset: 14,
        endOffset: 88,
        locator: 'resume line 7',
        exactText: 'Built Kafka order event retries for an ecommerce checkout platform.',
      }],
      challengeSourceRefs: [{
        artifactId: 'repo-artifact',
        artifactVersion: 'commit-abc',
        contentHash: 'repo-hash',
        startOffset: 120,
        endOffset: 210,
        locator: 'src/orders/retry.ts:18',
        exactText: 'Add idempotent retry handling around order event publication.',
      }],
    }],
    gaps: [
      'Candidate evidence does not yet prove ownership of Kafka partition rebalancing.',
    ],
    diagnostics: {
      recalledPacketIds: ['packet-source-backed', 'packet-missing-span'],
      excludedPackets: [{
        id: 'packet-missing-span',
        repoId: '9',
        prNumber: 88,
        reason: 'MISSING_DEMAND_SOURCE_SPANS',
        demandIds: ['demand-without-span'],
        missingSourceSpanIds: ['repo-span-missing'],
        gateFailures: [],
        qualityScore: null,
      }],
      evaluatedChallenges: [{
        challengeId: 'packet-source-backed',
        repoId: '7',
        prNumber: 42,
        recallRank: 2,
        rank: 1,
        eligible: true,
        rejectionReasons: [],
        provenanceComplete: true,
        alignedDemandCount: 2,
        stretchCount: 1,
      }],
    },
    submitted: false,
    submission: null,
    completedAt: null,
  };
}

function makeMeetingSourceRef(overrides: Partial<LivingContextSourceRef> = {}): LivingContextSourceRef {
  return {
    sourceSpanId: 'span-meeting-1',
    evidenceRole: 'transcript_segment',
    artifactId: 'artifact-meeting-transcript',
    artifactType: 'meeting_transcript',
    artifactLogicalKey: 'meeting-1',
    artifactVersionId: 'artifact-version-meeting-1',
    artifactVersionNumber: 1,
    mediaType: 'text/plain',
    storageKey: null,
    stableSegmentId: 'segment-1',
    exactText: 'I implemented temporal shard knitting for order replay.',
    byteStart: 0,
    byteEnd: 54,
    charStart: 0,
    charEnd: 54,
    lineStart: 1,
    lineEnd: 1,
    timestampStartMs: null,
    timestampEndMs: null,
    metadata: {},
    ...overrides,
  };
}

function makeMeetingLivingContext(): LivingContextReadModel {
  const sourceRef = makeMeetingSourceRef();
  return {
    ...makeLivingContext(),
    summary: {
      interactionCount: 1,
      artifactCount: 1,
      contextRecordCount: 1,
      assertionCount: 1,
      signalCount: 1,
      sourceSpanCount: 1,
    },
    interactions: [{
      id: 'interaction-meeting-1',
      interactionType: 'video_meeting',
      externalReference: 'meeting-1',
      startedAt: '2026-06-13T10:00:00.000Z',
      endedAt: '2026-06-13T10:30:00.000Z',
      createdAt: '2026-06-13T10:00:00.000Z',
      updatedAt: '2026-06-13T10:30:00.000Z',
      metadata: {},
      artifactIds: ['artifact-meeting-transcript'],
      contextRecordIds: ['record-meeting-transcript'],
      assertionIds: ['assertion-temporal-shards'],
      signalKeys: ['term:temporal-shard-knitting'],
    }],
    artifacts: [{
      id: 'artifact-meeting-transcript',
      interactionId: 'interaction-meeting-1',
      artifactType: 'meeting_transcript',
      logicalKey: 'meeting-1',
      metadata: {},
      latestVersionId: 'artifact-version-meeting-1',
      latestVersionNumber: 1,
      versionCount: 1,
      mediaType: 'text/plain',
      storageKey: null,
      createdAt: '2026-06-13T10:00:00.000Z',
      updatedAt: '2026-06-13T10:30:00.000Z',
      sourceSpans: [sourceRef],
    }],
    contextRecords: [{
      id: 'record-meeting-transcript',
      scopeType: 'meeting',
      scopeId: 'meeting-1',
      interactionId: 'interaction-meeting-1',
      applicationId: 'application-1',
      episodeId: null,
      assertionId: null,
      recordType: 'meeting_transcript',
      predicate: 'preserves meeting transcript',
      narrative: 'Meeting transcript source evidence for meeting meeting-1.',
      qualifiers: {},
      confidence: 1,
      polarity: 1,
      extractionVersion: 'meeting-transcript-ingestion-v1',
      observedAt: '2026-06-13T10:00:00.000Z',
      entities: [{
        entityType: 'meeting',
        entityId: 'meeting-1',
        relationship: 'source_of',
        value: 'meeting-1',
        confidence: 1,
        metadata: {},
      }],
      concepts: [],
      sources: [sourceRef],
    }],
    assertions: [{
      id: 'assertion-temporal-shards',
      interactionId: 'interaction-meeting-1',
      episodeId: null,
      subjectType: 'person',
      subjectId: 'person-1',
      predicate: 'described implementation experience',
      narrative: 'Ada described implementing temporal shard knitting for order replay.',
      confidence: 0.84,
      polarity: 1,
      extractionVersion: 'meeting-transcript-open-v1',
      observedAt: '2026-06-13T10:00:00.000Z',
      qualifiers: {},
      concepts: [{
        id: 'concept-temporal-shard-knitting',
        canonicalKey: 'term:temporal-shard-knitting',
        namespace: 'term',
        label: 'temporal shard knitting',
        relationship: 'mentions',
        weight: 1,
      }],
      sources: [sourceRef],
    }],
    signals: [{
      signalKey: 'term:temporal-shard-knitting',
      label: 'temporal shard knitting',
      namespace: 'term',
      interactionId: 'interaction-meeting-1',
      asOf: '2026-06-13T10:30:00.000Z',
      conversationScore: 0.84,
      totalScore: 0.84,
      confidence: 0.84,
      evidenceCount: 1,
      sourceDiversity: 1,
      dimensions: {},
      policyVersion: 'test-policy-v1',
      evidence: [{
        id: 'signal-evidence-temporal-shards',
        interactionId: 'interaction-meeting-1',
        assertionId: 'assertion-temporal-shards',
        conceptId: 'concept-temporal-shard-knitting',
        evidenceLevel: 'mentioned',
        strength: 0.84,
        polarity: 1,
        observedAt: '2026-06-13T10:00:00.000Z',
        assertionNarrative: 'Ada described implementing temporal shard knitting for order replay.',
        assertionPredicate: 'described implementation experience',
        sources: [sourceRef],
      }],
    }],
  };
}

describe('LivingContextGraph standalone review explanation', () => {
  it('renders source-backed evidence, gaps, excluded packets, and stretch diagnostics', () => {
    mocks.livingContext = makeLivingContext();

    render(
      <LivingContextGraph
        candidateId="candidate-1"
        standaloneReviewMatch={makeStandaloneReviewMatch()}
      />,
    );

    expect(screen.getByLabelText('Standalone code review match')).toBeInTheDocument();
    expect(screen.getByText('pipe/source-backed-orders #42')).toBeInTheDocument();
    expect(screen.getByText('Matched 2 source-backed demands (1 stretch).')).toBeInTheDocument();
    expect(screen.getByText('Add Kafka-backed order retry handling')).toBeInTheDocument();
    expect(screen.getByText('82% match score')).toBeInTheDocument();
    expect(screen.getByText('1 stretch area')).toBeInTheDocument();

    expect(screen.getByText('candidate-atom-kafka → repo-demand-retry')).toBeInTheDocument();
    expect(screen.getByText('candidate: resume line 7')).toBeInTheDocument();
    expect(screen.getByText('PR: src/orders/retry.ts:18')).toBeInTheDocument();
    expect(screen.getAllByText('Built Kafka order event retries for an ecommerce checkout platform.').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Add idempotent retry handling around order event publication.').length).toBeGreaterThan(0);
    expect(screen.getAllByText('term:kafka-order-events').length).toBeGreaterThan(0);

    const repoOverlay = screen.getByTestId('repository-overlay-panel');
    expect(within(repoOverlay).getByText('Repository evidence overlay')).toBeInTheDocument();
    expect(within(repoOverlay).getByText('pipe/source-backed-orders · PR #42')).toBeInTheDocument();
    expect(within(repoOverlay).getAllByText('src/orders/retry.ts').length).toBeGreaterThan(0);
    expect(within(repoOverlay).getAllByText('repo-demand-retry').length).toBeGreaterThan(0);
    expect(within(repoOverlay).getByText('candidate-atom-kafka')).toBeInTheDocument();
    expect(within(repoOverlay).getByText('91% alignment')).toBeInTheDocument();
    expect(within(repoOverlay).getByText('validation')).toBeInTheDocument();
    expect(within(repoOverlay).getByText('Candidate source')).toBeInTheDocument();
    expect(within(repoOverlay).getByText('PR demand source')).toBeInTheDocument();
    expect(within(repoOverlay).getByText('resume line 7')).toBeInTheDocument();
    expect(within(repoOverlay).getByText('src/orders/retry.ts:18')).toBeInTheDocument();
    expect(within(repoOverlay).getByText('Built Kafka order event retries for an ecommerce checkout platform.')).toBeInTheDocument();
    expect(within(repoOverlay).getByText('Add idempotent retry handling around order event publication.')).toBeInTheDocument();

    expect(screen.getByText('Evidence gaps / guardrails')).toBeInTheDocument();
    expect(screen.getByText(
      'Candidate evidence does not yet prove ownership of Kafka partition rebalancing.',
    )).toBeInTheDocument();

    expect(screen.getByText('Recalled packets')).toBeInTheDocument();
    expect(screen.getAllByText('packet-source-backed').length).toBeGreaterThan(0);
    expect(screen.getAllByText('packet-missing-span').length).toBeGreaterThan(1);

    expect(screen.getByText('Excluded challenge packets')).toBeInTheDocument();
    expect(screen.getByText('Missing repo source spans')).toBeInTheDocument();
    expect(screen.getByText(/missing spans repo-span-missing/i)).toBeInTheDocument();

    expect(screen.getByText('Evaluated challenge evidence')).toBeInTheDocument();
    expect(screen.getAllByText('packet-source-backed').length).toBeGreaterThan(1);
    expect(screen.getByText(/PR #42.*2 aligned demands.*1 stretch area.*provenance complete/i)).toBeInTheDocument();
  });

  it('surfaces meeting transcript evidence as an interaction-level graph branch', () => {
    mocks.livingContext = makeMeetingLivingContext();

    render(<LivingContextGraph candidateId="candidate-1" />);

    const panel = screen.getByTestId('meeting-evidence-panel');
    expect(panel).toBeInTheDocument();
    expect(screen.getByLabelText('Meeting evidence')).toBeInTheDocument();
    expect(within(panel).getByText('Video Meeting')).toBeInTheDocument();
    expect(within(panel).getAllByText('meeting-1').length).toBeGreaterThan(0);
    expect(within(panel).getByText('1 artifact')).toBeInTheDocument();
    expect(within(panel).getByText('1 span')).toBeInTheDocument();
    expect(within(panel).getByText('1 assertion')).toBeInTheDocument();

    expect(within(panel).getByText('I implemented temporal shard knitting for order replay.')).toBeInTheDocument();
    expect(within(panel).getByText('Meeting transcript source evidence for meeting meeting-1.')).toBeInTheDocument();
    expect(within(panel).getByText('Ada described implementing temporal shard knitting for order replay.')).toBeInTheDocument();
    expect(within(panel).getAllByText('temporal shard knitting').length).toBeGreaterThan(0);
    expect(within(panel).getByRole('button', { name: /Meeting Transcript.*line 1/i })).toBeInTheDocument();
  });
});
