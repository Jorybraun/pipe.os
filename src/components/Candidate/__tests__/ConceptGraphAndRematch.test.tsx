import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { LivingContextGraph } from '../LivingContextGraph';
import type {
  ConceptGraphResponse,
  LivingContextReadModel,
  RematchResult,
} from '../../../lib/api/types';

const mocks = vi.hoisted(() => ({
  livingContext: null as LivingContextReadModel | null,
  refetch: vi.fn(),
  rematch: vi.fn().mockResolvedValue(null),
  rematchResult: null as RematchResult | null,
  rematchRunning: false,
  rematchError: null as Error | null,
  conceptGraph: null as ConceptGraphResponse | null,
  conceptsLoading: false,
  conceptRefetch: vi.fn(),
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
    report: null,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
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
    rematch: mocks.rematch,
    result: mocks.rematchResult,
    isRunning: mocks.rematchRunning,
    error: mocks.rematchError,
  }),
}));

vi.mock('../../../hooks/useConceptGraph', () => ({
  useConceptGraph: () => ({
    graph: mocks.conceptGraph,
    isLoading: mocks.conceptsLoading,
    error: null,
    refetch: mocks.conceptRefetch,
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
      artifactCount: 0,
      contextRecordCount: 0,
      assertionCount: 1,
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
      signalKeys: ['lang:typescript'],
    }],
    artifacts: [],
    contextRecords: [],
    assertions: [],
    signals: [],
    relationships: [],
  };
}

function makeConceptGraph(): ConceptGraphResponse {
  return {
    totalConcepts: 3,
    concepts: [
      {
        id: 'concept-1',
        canonicalKey: 'lang:typescript',
        namespace: 'lang',
        label: 'TypeScript',
        description: 'Typed superset of JavaScript',
        aliases: ['ts'],
        metadata: {},
        observationCount: 12,
        firstObservedAt: 1717200000,
        lastObservedAt: 1719792000,
        createdAt: '2026-06-01T00:00:00Z',
        updatedAt: '2026-06-28T00:00:00Z',
      },
      {
        id: 'concept-2',
        canonicalKey: 'lang:rust',
        namespace: 'lang',
        label: 'Rust',
        description: null,
        aliases: [],
        metadata: {},
        observationCount: 5,
        firstObservedAt: 1717200000,
        lastObservedAt: 1719792000,
        createdAt: '2026-06-01T00:00:00Z',
        updatedAt: '2026-06-28T00:00:00Z',
      },
      {
        id: 'concept-3',
        canonicalKey: 'term:event-sourcing',
        namespace: 'term',
        label: 'event sourcing',
        description: 'Pattern for persisting domain events',
        aliases: ['es', 'event-driven'],
        metadata: {},
        observationCount: 8,
        firstObservedAt: 1717200000,
        lastObservedAt: 1719792000,
        createdAt: '2026-06-01T00:00:00Z',
        updatedAt: '2026-06-28T00:00:00Z',
      },
    ],
    adjacencies: [
      {
        fromConceptKey: 'lang:typescript',
        toConceptKey: 'term:event-sourcing',
        dimension: 'co_occurrence',
        stretchAllowed: false,
        confidence: 0.85,
      },
    ],
  };
}

describe('ConceptGraphPanel', () => {
  beforeEach(() => {
    mocks.livingContext = makeLivingContext();
    mocks.conceptGraph = makeConceptGraph();
    mocks.conceptsLoading = false;
    mocks.rematchResult = null;
    mocks.rematchRunning = false;
    mocks.rematchError = null;
  });

  it('renders concept cards when concept graph has data', () => {
    render(<LivingContextGraph candidateId="cand-1" />);
    const panel = screen.getByTestId('concept-graph-panel');
    expect(panel).toBeTruthy();
    const cards = within(panel).getAllByTestId('concept-card');
    expect(cards.length).toBe(3);
    const first = cards[0]!;
    expect(within(first).getByText('TypeScript')).toBeTruthy();
    expect(within(first).getByText('lang')).toBeTruthy();
    expect(within(first).getByText('12 obs')).toBeTruthy();
  });

  it('renders concept edges when adjacencies present', () => {
    render(<LivingContextGraph candidateId="cand-1" />);
    const edges = screen.getByTestId('concept-edges');
    expect(edges).toBeTruthy();
    expect(within(edges).getByText('lang:typescript')).toBeTruthy();
    expect(within(edges).getByText('term:event-sourcing')).toBeTruthy();
    expect(within(edges).getByText('85%')).toBeTruthy();
  });

  it('hides panel when no concepts', () => {
    mocks.conceptGraph = { totalConcepts: 0, concepts: [], adjacencies: [] };
    render(<LivingContextGraph candidateId="cand-1" />);
    expect(screen.queryByTestId('concept-graph-panel')).toBeNull();
  });

  it('filters concepts by search term', () => {
    render(<LivingContextGraph candidateId="cand-1" />);
    const filterInput = screen.getByLabelText('Filter concepts');
    fireEvent.change(filterInput, { target: { value: 'rust' } });
    const panel = screen.getByTestId('concept-graph-panel');
    const cards = within(panel).getAllByTestId('concept-card');
    expect(cards.length).toBe(1);
    expect(within(cards[0]!).getByText('Rust')).toBeTruthy();
  });
});

describe('RematchButton', () => {
  beforeEach(() => {
    mocks.livingContext = makeLivingContext();
    mocks.conceptGraph = null;
    mocks.rematchResult = null;
    mocks.rematchRunning = false;
    mocks.rematchError = null;
    mocks.rematch.mockReset().mockResolvedValue(null);
  });

  it('renders re-match button', () => {
    render(<LivingContextGraph candidateId="cand-1" />);
    const btn = screen.getByTestId('rematch-button');
    expect(btn).toBeTruthy();
    expect(btn.textContent).toContain('Re-match');
  });

  it('shows running state when matching', () => {
    mocks.rematchRunning = true;
    render(<LivingContextGraph candidateId="cand-1" />);
    const btn = screen.getByTestId('rematch-button');
    expect(btn.textContent).toContain('Matching...');
    expect(btn).toHaveProperty('disabled', true);
  });

  it('shows matched result with PR info', () => {
    mocks.rematchResult = {
      candidateId: 'cand-1',
      status: 'MATCHED',
      matchRunId: 'run-1',
      repoId: 7,
      prNumber: 42,
      evaluatedCount: 3,
      topChallenge: {
        challengeId: 'ch-1',
        repoId: 7,
        prNumber: 42,
        rank: 1,
        alignedDemandCount: 4,
        stretchCount: 1,
        eligible: true,
      },
    };
    render(<LivingContextGraph candidateId="cand-1" />);
    const result = screen.getByTestId('rematch-result');
    expect(result.textContent).toContain('PR #42');
    expect(result.textContent).toContain('4 aligned');
    expect(result.textContent).toContain('1 stretch');
  });

  it('shows needs-more-evidence result', () => {
    mocks.rematchResult = {
      candidateId: 'cand-1',
      status: 'NEEDS_MORE_EVIDENCE',
      matchRunId: null,
      repoId: null,
      prNumber: null,
      evaluatedCount: 0,
      topChallenge: null,
      reason: 'Candidate has no living context workspace identity yet.',
    };
    render(<LivingContextGraph candidateId="cand-1" />);
    const result = screen.getByTestId('rematch-result');
    expect(result.textContent).toContain('no living context workspace identity');
  });

  it('shows error state on failure', () => {
    mocks.rematchError = new Error('Network failure');
    render(<LivingContextGraph candidateId="cand-1" />);
    const error = screen.getByTestId('rematch-error');
    expect(error.textContent).toContain('Network failure');
  });
});
