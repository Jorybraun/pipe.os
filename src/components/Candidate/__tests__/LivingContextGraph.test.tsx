import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
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

function reviewSourceCardByText(scope: HTMLElement, text: string | RegExp): HTMLElement {
  const node = within(scope).getByText(text);
  const card = node.closest('[data-testid="review-source-card"]');
  if (!(card instanceof HTMLElement)) {
    throw new Error(`No review source card found for ${String(text)}`);
  }
  return card;
}

function makeStandaloneReviewMatch(): StandaloneReviewMatchRecord {
  return {
    interviewId: 'interview-1',
    interviewStatus: 'MATCHED',
    matchStatus: 'MATCHED',
    matchRunId: 'match-run-1',
    packetId: 'packet-source-backed',
    repoId: 7,
    repoName: 'pipe/source-backed-orders',
    repoUrl: 'https://github.com/pipe/source-backed-orders',
    prNumber: 42,
    prUrl: 'https://github.com/pipe/source-backed-orders/pull/42',
    prTitle: 'Add Kafka-backed order retry handling',
    score: 0.82,
    summary: 'Matched 2 source-backed demands (1 stretch).',
    roleSources: [{
      entityId: 'context-record-jd',
      locator: 'simple_job_description:source_span:jd-span-1',
      conceptKeys: ['term:kafka-order-events'],
      sourceRefType: 'source_span',
      sourceRefId: 'jd-span-1',
      sourceSpanId: 'jd-span-1',
      exactText: 'We need Kafka order events experience for retry-safe platform work.',
      contentHash: 'role-source-hash',
    }],
    evidence: [{
      atomId: 'candidate-atom-kafka',
      demandId: 'repo-demand-retry',
      purpose: 'validation',
      pairScore: 0.91,
      sharedConcepts: ['term:kafka-order-events'],
      roleSourceRefs: [{
        entityId: 'context-record-jd',
        locator: 'simple_job_description:source_span:jd-span-1',
        conceptKeys: ['term:kafka-order-events'],
        sourceRefType: 'source_span',
        sourceRefId: 'jd-span-1',
        sourceSpanId: 'jd-span-1',
        exactText: 'We need Kafka order events experience for retry-safe platform work.',
        contentHash: 'role-source-hash',
      }],
      candidateSourceRefs: [{
        artifactId: 'resume-artifact',
        artifactVersion: 'v1',
        contentHash: 'candidate-hash',
        startOffset: 14,
        endOffset: 88,
        sourceRefType: 'source_span',
        sourceRefId: 'candidate-span-kafka',
        sourceSpanId: 'candidate-span-kafka',
        locator: 'resume line 7',
        exactText: 'Built Kafka order event retries for an ecommerce checkout platform.',
      }],
      challengeSourceRefs: [{
        artifactId: 'repo-artifact',
        artifactVersion: 'commit-abc',
        contentHash: 'repo-hash',
        startOffset: 120,
        endOffset: 210,
        sourceRefType: 'repo_source_span',
        sourceRefId: 'repo-span-retry',
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
        provenanceFailures: [],
        contextProjectionFailures: [],
        qualityScore: null,
      }, {
        id: 'packet-missing-context',
        repoId: '10',
        prNumber: 89,
        reason: 'PACKET_CONTEXT_PROJECTION_INCOMPLETE',
        demandIds: [],
        missingSourceSpanIds: [],
        gateFailures: [],
        provenanceFailures: [],
        contextProjectionFailures: [
          'review challenge packet packet-missing-context is missing repo_source_span context refs',
        ],
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

function makeBackfilledRepoReviewMatch(): StandaloneReviewMatchRecord {
  return {
    interviewId: 'interview-backfilled-1',
    interviewStatus: 'MATCHED',
    matchStatus: 'MATCHED',
    matchRunId: 'match-run-backfilled-1',
    packetId: 'review-packet-77-42',
    repoId: 77,
    repoName: 'pipe-labs/orders',
    repoUrl: 'https://github.com/pipe-labs/orders',
    prNumber: 42,
    prUrl: 'https://github.com/pipe-labs/orders/pull/42',
    prTitle: 'Add idempotent order retry flow',
    score: 0.88,
    summary: 'Matched backfilled PR packet using accumulated resume and meeting evidence.',
    roleSources: [{
      entityId: 'context-record-role-backfill',
      locator: 'simple_job_description:source_span:jd-span-crystalline',
      conceptKeys: ['term:crystalline-quorum-ledger'],
    }],
    evidence: [{
      atomId: 'candidate-atom-crystalline-quorum-ledger',
      demandId: 'demand-crystalline-quorum-ledger',
      purpose: 'source-backed-validation',
      pairScore: 0.93,
      sharedConcepts: ['term:crystalline-quorum-ledger'],
      roleSourceRefs: [{
        entityId: 'context-record-role-backfill',
        locator: 'simple_job_description:source_span:jd-span-crystalline',
        conceptKeys: ['term:crystalline-quorum-ledger'],
        sourceRefType: 'source_span',
        sourceRefId: 'jd-span-crystalline',
        sourceSpanId: 'jd-span-crystalline',
        exactText: 'Review CrystallineQuorumLedger order recovery pull requests.',
        contentHash: 'role-crystalline-hash',
      }],
      candidateSourceRefs: [
        {
          artifactId: 'candidate-artifact-resume',
          artifactVersion: 'artifact-version-resume-1',
          contentHash: 'candidate-resume-hash',
          startOffset: 0,
          endOffset: 65,
          sourceRefType: 'source_span',
          sourceRefId: 'candidate-span-1',
          sourceSpanId: 'candidate-span-1',
          locator: 'candidate-span-1',
          exactText: 'resume: implemented CrystallineQuorumLedger commits for order recovery',
        },
        {
          artifactId: 'candidate-artifact-meeting',
          artifactVersion: 'artifact-version-meeting-1',
          contentHash: 'candidate-meeting-hash',
          startOffset: 0,
          endOffset: 64,
          sourceRefType: 'source_span',
          sourceRefId: 'candidate-span-2',
          sourceSpanId: 'candidate-span-2',
          locator: 'candidate-span-2',
          exactText: 'meeting: debugged CrystallineQuorumLedger replay during an outage',
        },
      ],
      challengeSourceRefs: [{
        artifactId: 'repo-artifact-77-42',
        artifactVersion: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        contentHash: 'repo-source-hash',
        startOffset: 0,
        endOffset: 148,
        sourceRefType: 'repo_source_span',
        sourceRefId: 'repo-span-crystalline-quorum-ledger',
        locator: 'src/orders/crystallineQuorumLedger.ts:1',
        exactText: 'export function writeCrystallineQuorumLedger(orderId: string) { const ledgerKey = `crystalline:${orderId}`; return { ledgerKey, committed: true }; }',
      }],
    }],
    gaps: [],
    diagnostics: {
      recalledPacketIds: ['review-packet-77-42'],
      excludedPackets: [],
      evaluatedChallenges: [{
        challengeId: 'review-packet-77-42',
        repoId: '77',
        prNumber: 42,
        recallRank: 1,
        rank: 1,
        eligible: true,
        rejectionReasons: [],
        provenanceComplete: true,
        alignedDemandCount: 1,
        stretchCount: 0,
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

function makeRolelessMessageSourceRef(overrides: Partial<LivingContextSourceRef> = {}): LivingContextSourceRef {
  return {
    sourceSpanId: 'span-roleless-message-1',
    evidenceRole: 'source',
    artifactId: 'artifact-roleless-message',
    artifactType: 'message',
    artifactLogicalKey: 'roleless_candidate_intake_message',
    artifactVersionId: 'artifact-version-roleless-message-1',
    artifactVersionNumber: 1,
    mediaType: 'text/plain',
    storageKey: null,
    stableSegmentId: 'full-message',
    exactText: 'Roleless follow-up: the same person can discuss temporal shard knitting and join the talent pool.',
    byteStart: 0,
    byteEnd: 92,
    charStart: 0,
    charEnd: 92,
    lineStart: null,
    lineEnd: null,
    timestampStartMs: null,
    timestampEndMs: null,
    metadata: {},
    ...overrides,
  };
}

function makeMeetingLivingContext(options: { includeRolelessMessage?: boolean } = {}): LivingContextReadModel {
  const sourceRef = makeMeetingSourceRef();
  const messageSourceRef = makeRolelessMessageSourceRef();
  const includeRolelessMessage = options.includeRolelessMessage ?? false;
  return {
    ...makeLivingContext(),
    summary: {
      interactionCount: includeRolelessMessage ? 2 : 1,
      artifactCount: includeRolelessMessage ? 2 : 1,
      contextRecordCount: 1,
      assertionCount: 1,
      signalCount: 1,
      sourceSpanCount: includeRolelessMessage ? 2 : 1,
    },
    interactions: [
      {
        id: 'interaction-meeting-1',
        interactionType: 'video_meeting',
        externalReference: 'meeting-1',
        startedAt: '2026-06-13T10:00:00.000Z',
        endedAt: '2026-06-13T10:30:00.000Z',
        createdAt: '2026-06-13T10:00:00.000Z',
        updatedAt: '2026-06-13T10:30:00.000Z',
        metadata: {
          ownerId: 'owner-1',
          participantRole: 'guest',
        },
        artifactIds: ['artifact-meeting-transcript'],
        contextRecordIds: [],
        assertionIds: ['assertion-temporal-shards'],
        signalKeys: ['term:temporal-shard-knitting'],
      },
      ...(includeRolelessMessage
        ? [{
            id: 'interaction-roleless-message-1',
            interactionType: 'message',
            externalReference: 'candidate-1',
            startedAt: '2026-06-13T11:00:00.000Z',
            endedAt: null,
            createdAt: '2026-06-13T11:00:00.000Z',
            updatedAt: '2026-06-13T11:00:00.000Z',
            metadata: { source: 'roleless_candidate_intake', roleless: true },
            artifactIds: ['artifact-roleless-message'],
            contextRecordIds: [],
            assertionIds: [],
            signalKeys: [],
          }]
        : []),
    ],
    artifacts: [
      {
        id: 'artifact-meeting-transcript',
        interactionId: 'interaction-meeting-1',
        artifactType: 'meeting_transcript',
        logicalKey: 'meeting-1',
        metadata: {
          meetingId: 'meeting-1',
          recordingKey: 'meetings/owner-1/meeting-1/recording.webm',
          transcriptionAudioKey: 'meetings/owner-1/meeting-1/transcription-audio.webm',
          provider: 'deepgram-multichannel',
          transcriptStatus: 'READY',
        },
        latestVersionId: 'artifact-version-meeting-1',
        latestVersionNumber: 1,
        versionCount: 1,
        mediaType: 'text/plain',
        storageKey: null,
        createdAt: '2026-06-13T10:00:00.000Z',
        updatedAt: '2026-06-13T10:30:00.000Z',
        sourceSpans: [sourceRef],
      },
      ...(includeRolelessMessage
        ? [{
            id: 'artifact-roleless-message',
            interactionId: 'interaction-roleless-message-1',
            artifactType: 'message',
            logicalKey: 'roleless_candidate_intake_message',
            metadata: { source: 'roleless_candidate_intake', roleless: true },
            latestVersionId: 'artifact-version-roleless-message-1',
            latestVersionNumber: 1,
            versionCount: 1,
            mediaType: 'text/plain',
            storageKey: null,
            createdAt: '2026-06-13T11:00:00.000Z',
            updatedAt: '2026-06-13T11:00:00.000Z',
            sourceSpans: [messageSourceRef],
          }]
        : []),
    ],
    contextRecords: [{
      id: 'record-meeting-transcript',
      scopeType: 'meeting',
      scopeId: 'meeting-1',
      interactionId: null,
      applicationId: null,
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
    const roleSources = screen.getByTestId('standalone-review-role-sources');
    expect(within(roleSources).getByText('Role sources')).toBeInTheDocument();
    expect(within(roleSources).getByText('simple_job_description:source_span:jd-span-1')).toBeInTheDocument();
    expect(within(roleSources).getByText('term:kafka-order-events')).toBeInTheDocument();

    const bridge = screen.getByTestId('match-evidence-bridge');
    expect(screen.getByLabelText('Cross-scope match evidence bridge')).toBe(bridge);
    expect(within(bridge).getByText('role context -> person context -> repo challenge')).toBeInTheDocument();
    expect(within(bridge).getByText('Role requirement')).toBeInTheDocument();
    expect(within(bridge).getByText('Person evidence')).toBeInTheDocument();
    expect(within(bridge).getByText('Repo challenge')).toBeInTheDocument();
    expect(within(bridge).getByText('candidate-atom-kafka -> repo-demand-retry')).toBeInTheDocument();
    expect(within(bridge).getByText('91% alignment')).toBeInTheDocument();
    expect(within(bridge).getByText('We need Kafka order events experience for retry-safe platform work.')).toBeInTheDocument();
    expect(within(bridge).getByText('Built Kafka order event retries for an ecommerce checkout platform.')).toBeInTheDocument();
    expect(within(bridge).getByText('Add idempotent retry handling around order event publication.')).toBeInTheDocument();

    const roleBridgeSource = within(bridge).getByTestId('match-bridge-role-source');
    expect(roleBridgeSource).toHaveAttribute('data-source-ref-type', 'source_span');
    expect(roleBridgeSource).toHaveAttribute('data-source-ref-id', 'jd-span-1');
    expect(roleBridgeSource).toHaveAttribute('data-source-span-id', 'jd-span-1');
    expect(roleBridgeSource).toHaveAttribute('data-content-hash', 'role-source-hash');

    const personBridgeSource = within(bridge).getByTestId('match-bridge-person-source');
    expect(personBridgeSource).toHaveAttribute('data-source-ref-type', 'source_span');
    expect(personBridgeSource).toHaveAttribute('data-source-ref-id', 'candidate-span-kafka');
    expect(personBridgeSource).toHaveAttribute('data-source-span-id', 'candidate-span-kafka');

    const repoBridgeSource = within(bridge).getByTestId('match-bridge-repo-source');
    expect(repoBridgeSource).toHaveAttribute('data-source-ref-type', 'repo_source_span');
    expect(repoBridgeSource).toHaveAttribute('data-source-ref-id', 'repo-span-retry');

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
    expect(screen.getByText('Missing graph projection')).toBeInTheDocument();
    expect(screen.getByText(/graph context review challenge packet packet-missing-context is missing repo_source_span context refs/i)).toBeInTheDocument();

    expect(screen.getByText('Evaluated challenge evidence')).toBeInTheDocument();
    expect(screen.getAllByText('packet-source-backed').length).toBeGreaterThan(1);
    expect(screen.getByText(/PR #42.*2 aligned demands.*1 stretch area.*provenance complete/i)).toBeInTheDocument();
  });

  it('renders repository overlay evidence shaped like the crawler backfill match output', () => {
    mocks.livingContext = makeLivingContext();

    render(
      <LivingContextGraph
        candidateId="candidate-1"
        standaloneReviewMatch={makeBackfilledRepoReviewMatch()}
      />,
    );

    expect(screen.getByLabelText('Standalone code review match')).toBeInTheDocument();
    expect(screen.getByText('pipe-labs/orders #42')).toBeInTheDocument();
    expect(screen.getByText('Add idempotent order retry flow')).toBeInTheDocument();
    expect(screen.getByText('Matched backfilled PR packet using accumulated resume and meeting evidence.')).toBeInTheDocument();
    expect(screen.getAllByText('term:crystalline-quorum-ledger').length).toBeGreaterThan(0);
    expect(screen.getAllByText('simple_job_description:source_span:jd-span-crystalline').length).toBeGreaterThan(0);

    const repoOverlay = screen.getByTestId('repository-overlay-panel');
    expect(within(repoOverlay).getByText('pipe-labs/orders · PR #42')).toBeInTheDocument();
    expect(within(repoOverlay).getAllByText('src/orders/crystallineQuorumLedger.ts').length).toBeGreaterThan(0);
    expect(within(repoOverlay).getAllByText('demand-crystalline-quorum-ledger').length).toBeGreaterThan(1);
    expect(within(repoOverlay).getByText('candidate-atom-crystalline-quorum-ledger')).toBeInTheDocument();
    expect(within(repoOverlay).getByText('93% alignment')).toBeInTheDocument();
    expect(within(repoOverlay).getByText('source-backed-validation')).toBeInTheDocument();
    expect(within(repoOverlay).getByText('candidate-span-1')).toBeInTheDocument();
    expect(within(repoOverlay).getByText('candidate-span-2')).toBeInTheDocument();
    expect(within(repoOverlay).getByText('src/orders/crystallineQuorumLedger.ts:1')).toBeInTheDocument();
    expect(within(repoOverlay).getByText(
      'resume: implemented CrystallineQuorumLedger commits for order recovery',
    )).toBeInTheDocument();
    expect(within(repoOverlay).getByText(
      'meeting: debugged CrystallineQuorumLedger replay during an outage',
    )).toBeInTheDocument();
    expect(within(repoOverlay).getByText(/writeCrystallineQuorumLedger/)).toBeInTheDocument();

    const resumeCard = reviewSourceCardByText(
      repoOverlay,
      'resume: implemented CrystallineQuorumLedger commits for order recovery',
    );
    expect(resumeCard).toHaveAttribute('data-source-ref-type', 'source_span');
    expect(resumeCard).toHaveAttribute('data-source-ref-id', 'candidate-span-1');
    expect(resumeCard).toHaveAttribute('data-source-span-id', 'candidate-span-1');
    expect(resumeCard).toHaveAttribute('data-content-hash', 'candidate-resume-hash');

    const meetingCard = reviewSourceCardByText(
      repoOverlay,
      'meeting: debugged CrystallineQuorumLedger replay during an outage',
    );
    expect(meetingCard).toHaveAttribute('data-source-ref-type', 'source_span');
    expect(meetingCard).toHaveAttribute('data-source-ref-id', 'candidate-span-2');
    expect(meetingCard).toHaveAttribute('data-source-span-id', 'candidate-span-2');

    const repoCard = reviewSourceCardByText(repoOverlay, /writeCrystallineQuorumLedger/);
    expect(repoCard).toHaveAttribute('data-source-ref-type', 'repo_source_span');
    expect(repoCard).toHaveAttribute('data-source-ref-id', 'repo-span-crystalline-quorum-ledger');
    expect(repoCard).toHaveAttribute('data-content-hash', 'repo-source-hash');

    expect(screen.getByText('Evaluated challenge evidence')).toBeInTheDocument();
    expect(screen.getAllByText('review-packet-77-42').length).toBeGreaterThan(1);
    expect(screen.getByText(/PR #42.*1 aligned demand.*0 stretch areas.*provenance complete/i)).toBeInTheDocument();
  });

  it('surfaces meeting transcript evidence as an interaction-level graph branch', () => {
    mocks.livingContext = makeMeetingLivingContext({ includeRolelessMessage: true });

    render(<LivingContextGraph candidateId="candidate-1" />);

    const panel = screen.getByTestId('meeting-evidence-panel');
    expect(panel).toBeInTheDocument();
    expect(screen.getByLabelText('Meeting evidence')).toBeInTheDocument();
    expect(within(panel).getByText('Video Meeting')).toBeInTheDocument();
    expect(within(panel).getAllByText('meeting-1').length).toBeGreaterThan(0);
    expect(within(panel).getByText('1 artifact')).toBeInTheDocument();
    expect(within(panel).getByText('1 span')).toBeInTheDocument();
    expect(within(panel).getByText('1 claim')).toBeInTheDocument();
    const recordingProvenance = within(panel).getByTestId('meeting-recording-provenance');
    expect(recordingProvenance).toHaveTextContent(/Transcript\s*READY/);
    expect(recordingProvenance).toHaveTextContent(/Provider\s*deepgram-multichannel/);
    expect(recordingProvenance).toHaveTextContent(/Recording\s*meetings\/owner-1\/meeting-1\/recording\.webm/);
    expect(recordingProvenance).toHaveTextContent(/Audio\s*meetings\/owner-1\/meeting-1\/transcription-audio\.webm/);

    expect(within(panel).getByText('I implemented temporal shard knitting for order replay.')).toBeInTheDocument();
    expect(within(panel).getByText('Meeting transcript source evidence for meeting meeting-1.')).toBeInTheDocument();
    expect(within(panel).getByText('Ada described implementing temporal shard knitting for order replay.')).toBeInTheDocument();
    expect(within(panel).getAllByText('temporal shard knitting').length).toBeGreaterThan(0);
    expect(within(panel).getByRole('button', { name: /Meeting Transcript.*line 1/i })).toBeInTheDocument();

    expect(screen.getByText('Accumulated context')).toBeInTheDocument();
    expect(screen.getByText('Across every interaction')).toBeInTheDocument();
    expect(screen.getAllByText('Meeting transcript source evidence for meeting meeting-1.').length)
      .toBeGreaterThan(0);
    expect(screen.getAllByText('Message').length).toBeGreaterThan(0);
    expect(screen.getAllByText('2').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: /All context/i }));
    fireEvent.click(screen.getByRole('button', { name: /Message.*chars 0-92/i }));
    expect(screen.getByText(
      'Roleless follow-up: the same person can discuss temporal shard knitting and join the talent pool.',
    )).toBeInTheDocument();
  });
});

describe('LivingContextGraph empty state quietness', () => {
  it('hides empty living graph sections when no evidence exists and no review match is present', () => {
    mocks.livingContext = makeLivingContext();

    render(<LivingContextGraph candidateId="candidate-1" />);

    // The quiet empty state should be surfaced instead of a debug dashboard.
    expect(screen.getByTestId('living-context-empty')).toBeInTheDocument();
    expect(screen.getByText(/No source-backed living evidence yet/i)).toBeInTheDocument();

    // Summary metrics, workspace, and toolbar must not dominate the empty view.
    expect(screen.queryByTestId('living-context-graph')).not.toBeInTheDocument();
    expect(screen.queryAllByText('Interactions')).toHaveLength(0);
    expect(screen.queryAllByText('Context records')).toHaveLength(0);
    expect(screen.queryAllByText('Accumulated context')).toHaveLength(0);
    expect(screen.queryAllByText('Source evidence')).toHaveLength(0);
    expect(screen.queryByLabelText('Search living context')).not.toBeInTheDocument();
  });

  it('keeps the standalone review match visible while hiding empty living graph sections', () => {
    mocks.livingContext = makeLivingContext();

    render(
      <LivingContextGraph
        candidateId="candidate-1"
        standaloneReviewMatch={makeStandaloneReviewMatch()}
      />,
    );

    // The source-backed review match panel stays visible.
    expect(screen.getByLabelText('Standalone code review match')).toBeInTheDocument();
    expect(screen.getByText('pipe/source-backed-orders #42')).toBeInTheDocument();

    // Empty living graph sections remain quiet.
    expect(screen.queryAllByText('Interactions')).toHaveLength(0);
    expect(screen.queryAllByText('Context records')).toHaveLength(0);
    expect(screen.queryAllByText('Accumulated context')).toHaveLength(0);
    expect(screen.queryAllByText('Source evidence')).toHaveLength(0);
    expect(screen.queryByLabelText('Search living context')).not.toBeInTheDocument();
  });
});
