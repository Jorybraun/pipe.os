import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { LivingContextGraph } from '../LivingContextGraph';
import type {
  CandidateComparisonReport,
  LivingContextReadModel,
} from '../../../lib/api/types';

const mocks = vi.hoisted(() => ({
  livingContext: null as LivingContextReadModel | null,
  refetch: vi.fn(),
  comparisonReport: null as CandidateComparisonReport | null,
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
  useEvidenceGaps: () => ({ report: null, isLoading: false, error: null, refetch: vi.fn() }),
}));

vi.mock('../../../hooks/useMatchProvenance', () => ({
  useMatchProvenance: () => ({ provenance: null, isLoading: false, error: null, refetch: vi.fn() }),
}));

vi.mock('../../../hooks/useEvidenceLineage', () => ({
  useEvidenceLineage: () => ({ lineage: null, isLoading: false, error: null, refetch: vi.fn() }),
}));

vi.mock('../../../hooks/useEvidenceFreshness', () => ({
  useEvidenceFreshness: () => ({ freshness: null, isLoading: false, error: null, refetch: vi.fn() }),
}));

vi.mock('../../../hooks/useRematch', () => ({
  useRematch: () => ({ rematch: vi.fn().mockResolvedValue(null), result: null, isRunning: false, error: null }),
}));

vi.mock('../../../hooks/useConceptGraph', () => ({
  useConceptGraph: () => ({ graph: null, isLoading: false, error: null, refetch: vi.fn() }),
}));

vi.mock('../../../hooks/useEvidenceReadiness', () => ({
  useEvidenceReadiness: () => ({ report: null, isLoading: false, error: null, refetch: vi.fn() }),
}));

vi.mock('../../../hooks/useMatchHistory', () => ({
  useMatchHistory: () => ({ history: null, isLoading: false, error: null, refetch: vi.fn() }),
}));

vi.mock('../../../hooks/useEvidenceConflicts', () => ({
  useEvidenceConflicts: () => ({ report: null, isLoading: false, error: null, refetch: vi.fn() }),
}));

vi.mock('../../../hooks/useCandidateComparison', () => ({
  useCandidateComparison: () => ({
    report: mocks.comparisonReport,
    isLoading: false,
    error: null,
    compare: vi.fn(),
  }),
}));

vi.mock('../../../hooks/useEvidenceTimeline', () => ({
  useEvidenceTimeline: () => ({ timeline: null, isLoading: false, error: null, refetch: vi.fn() }),
}));

vi.mock('../../../hooks/useStalenessAlerts', () => ({
  useStalenessAlerts: () => ({ alerts: null, isLoading: false, error: null, refetch: vi.fn() }),
}));

vi.mock('../../../hooks/useMatchDecisions', () => ({
  useMatchDecisions: () => ({ history: null, isLoading: false, error: null, refetch: vi.fn(), recordDecision: vi.fn() }),
}));

vi.mock('../../../hooks/useRepoDecomposition', () => ({
  useRepoDecomposition: () => ({ overlay: null, isLoading: false, error: null, refetch: vi.fn() }),
}));

function makeLivingContext(): LivingContextReadModel {
  return {
    person: {
      personId: 'person-1',
      workspacePersonId: 'wp-1',
      applicationId: 'app-1',
      displayName: 'Alice Test',
      primaryEmail: 'alice@test.dev',
      primaryPhone: null,
      relationshipSummary: null,
      applicationStatus: 'active',
      pipelineId: 'pipeline-1',
      roles: [],
    },
    summary: {
      interactionCount: 1,
      artifactCount: 0,
      contextRecordCount: 0,
      assertionCount: 2,
      signalCount: 1,
      sourceSpanCount: 1,
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
      artifactIds: [],
      contextRecordIds: [],
      assertionIds: ['assert-1', 'assert-2'],
      signalKeys: ['lang:typescript'],
    }],
    artifacts: [],
    contextRecords: [],
    assertions: [],
    signals: [],
    relationships: [],
  };
}

function makeComparisonReport(): CandidateComparisonReport {
  return {
    pipelineId: 'pipeline-1',
    candidateProfiles: [
      {
        candidateId: 'cand-1',
        workspacePersonId: 'wp-1',
        candidateName: 'Alice',
        totalInteractions: 3,
        totalAssertions: 12,
        totalSourceSpans: 8,
        sourceDiversity: 0.75,
        interactionBreakdown: { resume_upload: 1, meeting: 2 },
        topConcepts: [
          { conceptKey: 'typescript', label: 'TypeScript', evidenceCount: 5, bestStrength: 0.9, effectiveStrength: 0.85, sources: ['resume', 'meeting'] },
        ],
        latestInteractionAt: '2026-06-28T10:00:00Z',
        freshestEvidenceAt: '2026-06-28T10:00:00Z',
      },
      {
        candidateId: 'cand-2',
        workspacePersonId: 'wp-2',
        candidateName: 'Bob',
        totalInteractions: 2,
        totalAssertions: 8,
        totalSourceSpans: 5,
        sourceDiversity: 0.5,
        interactionBreakdown: { resume_upload: 1, phone_screen: 1 },
        topConcepts: [
          { conceptKey: 'react', label: 'React', evidenceCount: 3, bestStrength: 0.8, effectiveStrength: 0.7, sources: ['resume'] },
        ],
        latestInteractionAt: '2026-06-27T15:00:00Z',
        freshestEvidenceAt: '2026-06-27T15:00:00Z',
      },
    ],
    conceptComparisons: [
      {
        conceptKey: 'typescript',
        label: 'TypeScript',
        candidates: [
          { candidateId: 'cand-1', evidenceCount: 5, bestStrength: 0.9, effectiveStrength: 0.85, coverageLevel: 'strong' },
          { candidateId: 'cand-2', evidenceCount: 1, bestStrength: 0.4, effectiveStrength: 0.35, coverageLevel: 'weak' },
        ],
      },
    ],
    summary: {
      totalCandidates: 2,
      comparedConceptCount: 5,
      sharedConceptCount: 2,
      uniqueConceptsPerCandidate: { 'cand-1': 3, 'cand-2': 1 },
      evidenceDiversityRanking: [
        { candidateId: 'cand-1', score: 0.75 },
        { candidateId: 'cand-2', score: 0.5 },
      ],
      evidenceDepthRanking: [
        { candidateId: 'cand-1', totalAssertions: 12 },
        { candidateId: 'cand-2', totalAssertions: 8 },
      ],
      evidenceFreshnessRanking: [
        { candidateId: 'cand-1', freshestAt: '2026-06-28T10:00:00Z' },
        { candidateId: 'cand-2', freshestAt: '2026-06-27T15:00:00Z' },
      ],
    },
  };
}

describe('CandidateComparisonPanel', () => {
  it('renders the comparison panel when comparison data is available', () => {
    mocks.livingContext = makeLivingContext();
    mocks.comparisonReport = makeComparisonReport();

    render(
      <LivingContextGraph
        candidateId="cand-1"
        comparisonCandidateIds={['cand-2']}
      />,
    );

    expect(screen.getByTestId('candidate-comparison-panel')).toBeTruthy();
    expect(screen.getByTestId('comparison-summary')).toBeTruthy();
    expect(screen.getByText('5 concepts compared')).toBeTruthy();
    expect(screen.getByText('2 shared')).toBeTruthy();
  });

  it('renders candidate profile cards with stats', () => {
    mocks.livingContext = makeLivingContext();
    mocks.comparisonReport = makeComparisonReport();

    render(
      <LivingContextGraph
        candidateId="cand-1"
        comparisonCandidateIds={['cand-2']}
      />,
    );

    expect(screen.getByTestId('comparison-profiles')).toBeTruthy();
    expect(screen.getByTestId('comparison-profile-cand-1')).toBeTruthy();
    expect(screen.getByTestId('comparison-profile-cand-2')).toBeTruthy();
    expect(screen.getByText('current')).toBeTruthy();
  });

  it('renders concept coverage grid', () => {
    mocks.livingContext = makeLivingContext();
    mocks.comparisonReport = makeComparisonReport();

    render(
      <LivingContextGraph
        candidateId="cand-1"
        comparisonCandidateIds={['cand-2']}
      />,
    );

    const grid = screen.getByTestId('comparison-concept-grid');
    expect(grid).toBeTruthy();
    expect(within(grid).getByText('TypeScript')).toBeTruthy();
    expect(within(grid).getByText('strong')).toBeTruthy();
    expect(within(grid).getByText('weak')).toBeTruthy();
  });

  it('renders rankings', () => {
    mocks.livingContext = makeLivingContext();
    mocks.comparisonReport = makeComparisonReport();

    render(
      <LivingContextGraph
        candidateId="cand-1"
        comparisonCandidateIds={['cand-2']}
      />,
    );

    const rankings = screen.getByTestId('comparison-rankings');
    expect(rankings).toBeTruthy();
    expect(within(rankings).getByText('Source diversity')).toBeTruthy();
    expect(within(rankings).getByText('Evidence depth')).toBeTruthy();
  });

  it('hides comparison panel when no comparison IDs provided', () => {
    mocks.livingContext = makeLivingContext();
    mocks.comparisonReport = null;

    render(
      <LivingContextGraph candidateId="cand-1" />,
    );

    expect(screen.queryByTestId('candidate-comparison-panel')).toBeNull();
  });
});
