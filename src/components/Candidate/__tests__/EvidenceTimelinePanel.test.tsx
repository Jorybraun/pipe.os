import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LivingContextGraph } from '../LivingContextGraph';
import type {
  PersonEvidenceTimeline,
  LivingContextReadModel,
} from '../../../lib/api/types';

const mocks = vi.hoisted(() => ({
  livingContext: null as LivingContextReadModel | null,
  refetch: vi.fn(),
  timeline: null as PersonEvidenceTimeline | null,
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
    report: null,
    isLoading: false,
    error: null,
    compare: vi.fn(),
  }),
}));

vi.mock('../../../hooks/useEvidenceTimeline', () => ({
  useEvidenceTimeline: () => ({
    timeline: mocks.timeline,
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
      assertionIds: ['assert-1'],
      signalKeys: [],
    }],
    artifacts: [],
    contextRecords: [],
    assertions: [],
    signals: [],
    relationships: [],
  };
}

function makeTimeline(): PersonEvidenceTimeline {
  return {
    workspacePersonId: 'wp-1',
    totalEntries: 3,
    entries: [
      {
        id: 'entry-1',
        timestamp: '2026-06-30T10:00:00Z',
        entryType: 'interaction',
        interactionId: 'int-1',
        interactionType: 'resume_review',
        narrative: 'Resume reviewed',
        concepts: [],
        sourceCount: 0,
        confidence: null,
      },
      {
        id: 'entry-2',
        timestamp: '2026-06-30T09:00:00Z',
        entryType: 'assertion',
        interactionId: 'int-1',
        interactionType: 'resume_review',
        narrative: 'Has TypeScript experience',
        concepts: ['typescript', 'experience'],
        sourceCount: 2,
        confidence: 0.85,
      },
      {
        id: 'entry-3',
        timestamp: '2026-06-29T14:00:00Z',
        entryType: 'context_record',
        interactionId: null,
        interactionType: null,
        narrative: 'Initial context record',
        concepts: [],
        sourceCount: 0,
        confidence: null,
      },
    ],
  };
}

describe('EvidenceTimelinePanel', () => {
  it('renders the timeline panel when timeline data is available', () => {
    mocks.livingContext = makeLivingContext();
    mocks.timeline = makeTimeline();

    render(<LivingContextGraph candidateId="cand-1" />);

    expect(screen.getByTestId('evidence-timeline-panel')).toBeTruthy();
    expect(screen.getByText('Evidence timeline')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('renders timeline entries grouped by date', () => {
    mocks.livingContext = makeLivingContext();
    mocks.timeline = makeTimeline();

    render(<LivingContextGraph candidateId="cand-1" />);

    const entries = screen.getAllByTestId('timeline-entry');
    expect(entries.length).toBe(3);
  });

  it('renders entry type labels and narratives', () => {
    mocks.livingContext = makeLivingContext();
    mocks.timeline = makeTimeline();

    render(<LivingContextGraph candidateId="cand-1" />);

    expect(screen.getByText('Resume reviewed')).toBeTruthy();
    expect(screen.getByText('Has TypeScript experience')).toBeTruthy();
    expect(screen.getByText('Initial context record')).toBeTruthy();
  });

  it('renders concepts for assertion entries', () => {
    mocks.livingContext = makeLivingContext();
    mocks.timeline = makeTimeline();

    render(<LivingContextGraph candidateId="cand-1" />);

    expect(screen.getByText('typescript')).toBeTruthy();
    expect(screen.getByText('experience')).toBeTruthy();
  });

  it('renders confidence and source count metadata', () => {
    mocks.livingContext = makeLivingContext();
    mocks.timeline = makeTimeline();

    render(<LivingContextGraph candidateId="cand-1" />);

    expect(screen.getByText('2 sources')).toBeTruthy();
    expect(screen.getByText('85% confidence')).toBeTruthy();
  });

  it('hides timeline panel when no timeline data', () => {
    mocks.livingContext = makeLivingContext();
    mocks.timeline = null;

    render(<LivingContextGraph candidateId="cand-1" />);

    expect(screen.queryByTestId('evidence-timeline-panel')).toBeNull();
  });

  it('renders interaction type badges', () => {
    mocks.livingContext = makeLivingContext();
    mocks.timeline = makeTimeline();

    render(<LivingContextGraph candidateId="cand-1" />);

    const badges = screen.getAllByText('Resume Review');
    expect(badges.length).toBeGreaterThanOrEqual(1);
  });
});
