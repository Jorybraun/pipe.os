import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { LivingContextGraph } from '../LivingContextGraph';
import type {
  EvidenceGapReport,
  LivingContextReadModel,
} from '../../../lib/api/types';

const mocks = vi.hoisted(() => ({
  livingContext: null as LivingContextReadModel | null,
  refetch: vi.fn(),
  gapReport: null as EvidenceGapReport | null,
  gapRefetch: vi.fn(),
}));

vi.mock('../../../hooks/useLivingContext', () => ({
  useLivingContext: () => ({
    livingContext: mocks.livingContext,
    isLoading: false,
    error: null,
    refetch: mocks.refetch,
  }),
}));

vi.mock('../../../hooks/useEvidenceGaps', () => ({
  useEvidenceGaps: () => ({
    report: mocks.gapReport,
    isLoading: false,
    error: null,
    refetch: mocks.gapRefetch,
  }),
}));

vi.mock('../../../hooks/useMatchProvenance', () => ({
  useMatchProvenance: () => ({
    provenance: null,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock('../../../hooks/useEvidenceLineage', () => ({
  useEvidenceLineage: () => ({
    lineage: null,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock('../../../hooks/useEvidenceFreshness', () => ({
  useEvidenceFreshness: () => ({
    freshness: null,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock('../../../hooks/useRematch', () => ({
  useRematch: () => ({
    rematch: vi.fn().mockResolvedValue(null),
    result: null,
    isRunning: false,
    error: null,
  }),
}));

vi.mock('../../../hooks/useConceptGraph', () => ({
  useConceptGraph: () => ({
    graph: null,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock('../../../hooks/useMatchHistory', () => ({
  useMatchHistory: () => ({
    history: null,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock('../../../hooks/useEvidenceConflicts', () => ({
  useEvidenceConflicts: () => ({
    report: null,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock('../../../hooks/useEvidenceReadiness', () => ({
  useEvidenceReadiness: () => ({
    report: null,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

function makeLivingContext(): LivingContextReadModel {
  return {
    person: {
      personId: 'person-1',
      workspacePersonId: 'wp-1',
      applicationId: 'app-1',
      displayName: 'Test Candidate',
      primaryEmail: 'test@example.com',
      primaryPhone: null,
      relationshipSummary: null,
      applicationStatus: 'active',
      pipelineId: null,
      roles: [],
    },
    summary: {
      interactionCount: 1,
      artifactCount: 1,
      contextRecordCount: 0,
      assertionCount: 2,
      signalCount: 2,
      sourceSpanCount: 2,
    },
    interactions: [{
      id: 'int-1',
      interactionType: 'resume_review',
      externalReference: 'resume-1',
      startedAt: '2026-06-01T00:00:00Z',
      endedAt: null,
      createdAt: '2026-06-01T00:00:00Z',
      updatedAt: '2026-06-01T00:00:00Z',
      metadata: {},
      artifactIds: ['art-1'],
      contextRecordIds: [],
      assertionIds: ['assert-1', 'assert-2'],
      signalKeys: ['lang:typescript', 'lang:go'],
    }],
    artifacts: [],
    contextRecords: [],
    assertions: [],
    signals: [],
    relationships: [],
  };
}

function makeGapReport(): EvidenceGapReport {
  return {
    candidateId: 'candidate-1',
    workspacePersonId: 'wp-1',
    challengeId: 'packet-1',
    summary: {
      strongCount: 1,
      partialCount: 1,
      weakCount: 0,
      noneCount: 1,
      totalDemands: 3,
      coverageScore: 0.55,
      weightedCoverageScore: 0.62,
    },
    demands: [
      {
        demandId: 'demand-ts',
        demandNarrative: 'Review TypeScript type-safe error handling.',
        demandWeight: 0.9,
        demandConcepts: ['lang:typescript', 'pattern:error-handling'],
        coverageLevel: 'strong',
        matchedConcepts: ['lang:typescript', 'pattern:error-handling'],
        missingConcepts: [],
        evidenceCount: 3,
        bestEvidenceLevel: 'demonstrated',
        bestStrength: 0.92,
        effectiveStrength: 0.88,
        supportingAssertions: [{
          assertionId: 'assert-ts-1',
          narrative: 'Implemented typed error boundaries in production.',
          conceptKey: 'lang:typescript',
          strength: 0.92,
          decayMultiplier: 0.98,
          effectiveStrength: 0.90,
          observedAt: '2026-06-10T00:00:00Z',
          exactText: 'Built exhaustive error handling with discriminated unions in TypeScript.',
        }],
      },
      {
        demandId: 'demand-go',
        demandNarrative: 'Review Go concurrency patterns.',
        demandWeight: 0.7,
        demandConcepts: ['lang:go', 'pattern:concurrency'],
        coverageLevel: 'partial',
        matchedConcepts: ['lang:go'],
        missingConcepts: ['pattern:concurrency'],
        evidenceCount: 1,
        bestEvidenceLevel: 'mentioned',
        bestStrength: 0.45,
        effectiveStrength: 0.40,
        supportingAssertions: [{
          assertionId: 'assert-go-1',
          narrative: 'Mentioned using Go for CLI tooling.',
          conceptKey: 'lang:go',
          strength: 0.45,
          decayMultiplier: 0.85,
          effectiveStrength: 0.38,
          observedAt: '2026-05-15T00:00:00Z',
          exactText: null,
        }],
      },
      {
        demandId: 'demand-k8s',
        demandNarrative: 'Review Kubernetes deployment orchestration.',
        demandWeight: 0.5,
        demandConcepts: ['infra:kubernetes', 'pattern:deployment'],
        coverageLevel: 'none',
        matchedConcepts: [],
        missingConcepts: ['infra:kubernetes', 'pattern:deployment'],
        evidenceCount: 0,
        bestEvidenceLevel: null,
        bestStrength: 0,
        effectiveStrength: 0,
        supportingAssertions: [],
      },
    ],
    recommendations: [
      'No evidence for Kubernetes deployment experience. Consider probing during interview.',
      'Go concurrency evidence is weak — only mentioned, not demonstrated.',
    ],
  };
}

describe('EvidenceGapPanel', () => {
  it('does not render when gap report is null', () => {
    mocks.livingContext = makeLivingContext();
    mocks.gapReport = null;

    render(
      <LivingContextGraph
        candidateId="candidate-1"
        standaloneReviewMatch={{
          interviewId: 'int-1',
          interviewStatus: 'MATCHED',
          matchStatus: 'MATCHED',
          matchRunId: 'run-1',
          packetId: 'packet-1',
          repoId: 1,
          repoName: 'test/repo',
          repoUrl: 'https://github.com/test/repo',
          prNumber: 10,
          prUrl: 'https://github.com/test/repo/pull/10',
          prTitle: 'Test PR',
          score: 0.75,
          summary: 'Matched.',
          roleSources: [],
          evidence: [],
          stretchAreas: [],
          unmatchedDemandIds: [],
          gaps: [],
          diagnostics: {
            recalledPacketIds: [],
            excludedPackets: [],
            evaluatedChallenges: [],
          },
          matchNarrative: null,
          submitted: false,
          submission: null,
          completedAt: null,
          packet: null,
        }}
      />,
    );

    expect(screen.queryByTestId('evidence-gap-panel')).toBeNull();
  });

  it('renders gap analysis with coverage bar, demand cards, and recommendations', () => {
    mocks.livingContext = makeLivingContext();
    mocks.gapReport = makeGapReport();

    render(
      <LivingContextGraph
        candidateId="candidate-1"
        standaloneReviewMatch={{
          interviewId: 'int-1',
          interviewStatus: 'MATCHED',
          matchStatus: 'MATCHED',
          matchRunId: 'run-1',
          packetId: 'packet-1',
          repoId: 1,
          repoName: 'test/repo',
          repoUrl: 'https://github.com/test/repo',
          prNumber: 10,
          prUrl: 'https://github.com/test/repo/pull/10',
          prTitle: 'Test PR',
          score: 0.75,
          summary: 'Matched.',
          roleSources: [],
          evidence: [],
          stretchAreas: [],
          unmatchedDemandIds: [],
          gaps: [],
          diagnostics: {
            recalledPacketIds: [],
            excludedPackets: [],
            evaluatedChallenges: [],
          },
          matchNarrative: null,
          submitted: false,
          submission: null,
          completedAt: null,
          packet: null,
        }}
      />,
    );

    const panel = screen.getByTestId('evidence-gap-panel');
    expect(panel).toBeInTheDocument();

    // Title and summary
    expect(within(panel).getByText('Evidence gap analysis')).toBeInTheDocument();
    expect(within(panel).getByText('62% weighted coverage across 3 demands')).toBeInTheDocument();

    // Coverage bar segments
    const coverageBar = within(panel).getByTestId('gap-coverage-bar');
    expect(within(coverageBar).getByTestId('gap-segment-strong')).toBeInTheDocument();
    expect(within(coverageBar).getByTestId('gap-segment-partial')).toBeInTheDocument();
    expect(within(coverageBar).getByTestId('gap-segment-none')).toBeInTheDocument();
    expect(within(coverageBar).queryByTestId('gap-segment-weak')).toBeNull();

    // Demand cards
    const demands = within(panel).getAllByTestId('gap-demand');
    expect(demands).toHaveLength(3);

    // Strong demand
    expect(within(demands[0]!).getByText('Review TypeScript type-safe error handling.')).toBeInTheDocument();
    expect(within(demands[0]!).getByTestId('gap-badge-strong')).toHaveTextContent('Strong');
    expect(within(demands[0]!).getByText('88% effective strength')).toBeInTheDocument();
    expect(within(demands[0]!).getByText('3 evidence sources')).toBeInTheDocument();

    // Matched concepts on strong demand
    expect(within(demands[0]!).getByText('lang:typescript')).toBeInTheDocument();
    expect(within(demands[0]!).getByText('pattern:error-handling')).toBeInTheDocument();

    // Supporting assertion quote
    expect(within(demands[0]!).getByText(
      'Built exhaustive error handling with discriminated unions in TypeScript.',
    )).toBeInTheDocument();

    // Partial demand with missing concepts
    expect(within(demands[1]!).getByText('Review Go concurrency patterns.')).toBeInTheDocument();
    expect(within(demands[1]!).getByTestId('gap-badge-partial')).toHaveTextContent('Partial');
    expect(within(demands[1]!).getByText('lang:go')).toBeInTheDocument();
    expect(within(demands[1]!).getByText('pattern:concurrency')).toBeInTheDocument();

    // None demand
    expect(within(demands[2]!).getByText('Review Kubernetes deployment orchestration.')).toBeInTheDocument();
    expect(within(demands[2]!).getByTestId('gap-badge-none')).toHaveTextContent('None');
    expect(within(demands[2]!).getByText('infra:kubernetes')).toBeInTheDocument();
    expect(within(demands[2]!).getByText('pattern:deployment')).toBeInTheDocument();

    // Recommendations
    const recs = within(panel).getByTestId('gap-recommendations');
    expect(within(recs).getByText('Recommendations')).toBeInTheDocument();
    expect(within(recs).getByText(
      'No evidence for Kubernetes deployment experience. Consider probing during interview.',
    )).toBeInTheDocument();
    expect(within(recs).getByText(
      'Go concurrency evidence is weak — only mentioned, not demonstrated.',
    )).toBeInTheDocument();
  });

  it('does not render when demands array is empty', () => {
    mocks.livingContext = makeLivingContext();
    mocks.gapReport = {
      ...makeGapReport(),
      demands: [],
    };

    render(
      <LivingContextGraph
        candidateId="candidate-1"
        standaloneReviewMatch={{
          interviewId: 'int-1',
          interviewStatus: 'MATCHED',
          matchStatus: 'MATCHED',
          matchRunId: 'run-1',
          packetId: 'packet-1',
          repoId: 1,
          repoName: 'test/repo',
          repoUrl: 'https://github.com/test/repo',
          prNumber: 10,
          prUrl: 'https://github.com/test/repo/pull/10',
          prTitle: 'Test PR',
          score: 0.75,
          summary: 'Matched.',
          roleSources: [],
          evidence: [],
          stretchAreas: [],
          unmatchedDemandIds: [],
          gaps: [],
          diagnostics: {
            recalledPacketIds: [],
            excludedPackets: [],
            evaluatedChallenges: [],
          },
          matchNarrative: null,
          submitted: false,
          submission: null,
          completedAt: null,
          packet: null,
        }}
      />,
    );

    expect(screen.queryByTestId('evidence-gap-panel')).toBeNull();
  });
});
