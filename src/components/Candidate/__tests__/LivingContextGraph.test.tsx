import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LivingContextGraph } from '../LivingContextGraph';
import type {
  LivingContextReadModel,
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
    expect(screen.getByText('Built Kafka order event retries for an ecommerce checkout platform.')).toBeInTheDocument();
    expect(screen.getByText('Add idempotent retry handling around order event publication.')).toBeInTheDocument();
    expect(screen.getByText('term:kafka-order-events')).toBeInTheDocument();

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
});
