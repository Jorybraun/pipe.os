import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { LivingContextGraph } from '../LivingContextGraph';
import type {
  LivingContextReadModel,
  MatchProvenanceChain,
} from '../../../lib/api/types';

const mocks = vi.hoisted(() => ({
  livingContext: null as LivingContextReadModel | null,
  refetch: vi.fn(),
  provenance: null as MatchProvenanceChain | null,
  provenanceRefetch: vi.fn(),
}));

vi.mock('../../../hooks/useLivingContext', () => ({
  useLivingContext: () => ({
    livingContext: mocks.livingContext,
    isLoading: false,
    error: null,
    refetch: mocks.refetch,
  }),
}));

vi.mock('../../../hooks/useMatchProvenance', () => ({
  useMatchProvenance: () => ({
    provenance: mocks.provenance,
    isLoading: false,
    error: null,
    refetch: mocks.provenanceRefetch,
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

vi.mock('../../../hooks/useEvidenceReadiness', () => ({
  useEvidenceReadiness: () => ({
    report: null,
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

vi.mock('../../../hooks/useCandidateComparison', () => ({
  useCandidateComparison: () => ({ report: null, isLoading: false, error: null, compare: vi.fn() }),
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

vi.mock('../../../hooks/useMatchConfidence', () => ({
  useMatchConfidence: () => ({ report: null, isLoading: false, error: null, refetch: vi.fn() }),

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
      artifactIds: ['art-1'],
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

function makeProvenance(): MatchProvenanceChain {
  return {
    decision: {
      matchRunId: 'run-1',
      candidateId: 'candidate-1',
      status: 'MATCHED',
      selectedPacketId: 'packet-1',
      policyVersion: 'policy-v2',
      createdAt: Date.now(),
    },
    challengeId: 'packet-1',
    repoId: '7',
    prNumber: 42,
    totalDemands: 3,
    alignedDemands: 2,
    unmatchedDemands: 1,
    stretchCount: 1,
    chain: [
      {
        demandLink: {
          demandId: 'demand-ts',
          demandNarrative: 'Review TypeScript error handling patterns.',
          demandWeight: 0.9,
          demandConcepts: ['lang:typescript', 'pattern:error-handling'],
          atomId: 'atom-ts-1',
          pairScore: 0.91,
          stretch: null,
        },
        signals: [{
          atomId: 'atom-ts-1',
          episodeId: 'ep-1',
          narrative: 'TypeScript error handling expertise from resume.',
          purpose: 'validation',
          evidenceLevel: 'demonstrated',
          evidenceStrength: 0.91,
          concepts: ['lang:typescript', 'pattern:error-handling'],
          sourceRefs: [{
            artifactId: 'art-resume',
            contentHash: 'hash-resume',
            exactText: 'Built typed error boundaries with discriminated unions.',
            startOffset: 14,
            endOffset: 88,
          }],
        }],
        assertions: [{
          assertionId: 'assert-ts-err',
          narrative: 'Implemented typed error boundaries in production codebase.',
          predicate: 'demonstrated implementation',
          confidence: 0.91,
          polarity: 1,
          observedAt: '2026-06-10T00:00:00Z',
          decayMultiplier: 0.98,
          concepts: ['lang:typescript'],
          sourceSpans: [{
            sourceSpanId: 'span-ts-1',
            exactText: 'Built typed error boundaries with discriminated unions in a production TypeScript codebase.',
            lineStart: 7,
            lineEnd: 7,
            charStart: 0,
            charEnd: 89,
          }],
        }],
        artifacts: [{
          artifactId: 'art-resume',
          artifactType: 'resume',
          logicalKey: 'resume-main',
          mediaType: 'application/pdf',
          versionNumber: 1,
          contentHash: 'hash-resume',
        }],
        interactions: [{
          interactionId: 'int-resume',
          interactionType: 'resume_review',
          startedAt: '2026-06-01T00:00:00Z',
          endedAt: null,
        }],
      },
      {
        demandLink: {
          demandId: 'demand-go',
          demandNarrative: 'Review Go goroutine lifecycle management.',
          demandWeight: 0.7,
          demandConcepts: ['lang:go', 'pattern:goroutine'],
          atomId: 'atom-go-1',
          pairScore: 0.55,
          stretch: {
            atomConcept: 'lang:go',
            demandConcept: 'pattern:goroutine',
            dimension: 'concept_adjacency',
          },
        },
        signals: [],
        assertions: [{
          assertionId: 'assert-go-1',
          narrative: 'Mentioned Go usage for CLI tools.',
          predicate: 'mentioned usage',
          confidence: 0.45,
          polarity: 1,
          observedAt: '2026-05-15T00:00:00Z',
          decayMultiplier: 0.82,
          concepts: ['lang:go'],
          sourceSpans: [{
            sourceSpanId: 'span-go-1',
            exactText: 'Built CLI tooling in Go for internal developer workflow automation.',
            lineStart: 12,
            lineEnd: 12,
            charStart: 0,
            charEnd: 65,
          }],
        }],
        artifacts: [],
        interactions: [{
          interactionId: 'int-meeting',
          interactionType: 'video_meeting',
          startedAt: '2026-05-15T00:00:00Z',
          endedAt: '2026-05-15T00:30:00Z',
        }],
      },
    ],
  };
}

const standaloneMatch = {
  interviewId: 'int-1',
  interviewStatus: 'MATCHED' as const,
  matchStatus: 'MATCHED' as const,
  matchRunId: 'run-1',
  packetId: 'packet-1',
  repoId: 7,
  repoName: 'test/repo',
  repoUrl: 'https://github.com/test/repo',
  prNumber: 42,
  prUrl: 'https://github.com/test/repo/pull/42',
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
};

describe('MatchProvenancePanel', () => {
  it('does not render when provenance is null', () => {
    mocks.livingContext = makeLivingContext();
    mocks.provenance = null;

    render(
      <LivingContextGraph
        candidateId="candidate-1"
        standaloneReviewMatch={standaloneMatch}
      />,
    );

    expect(screen.queryByTestId('match-provenance-panel')).toBeNull();
  });

  it('renders provenance chain with decision summary, demand entries, assertions, and interactions', () => {
    mocks.livingContext = makeLivingContext();
    mocks.provenance = makeProvenance();

    render(
      <LivingContextGraph
        candidateId="candidate-1"
        standaloneReviewMatch={standaloneMatch}
      />,
    );

    const panel = screen.getByTestId('match-provenance-panel');
    expect(panel).toBeInTheDocument();

    // Title
    expect(within(panel).getByText('Match provenance chain')).toBeInTheDocument();

    // Decision summary metrics
    const summary = within(panel).getByTestId('provenance-summary');
    expect(within(summary).getByText('MATCHED')).toBeInTheDocument();
    expect(within(summary).getByText('2/3')).toBeInTheDocument();
    // Both Unmatched and Stretch show "1"
    const metricValues = within(summary).getAllByText('1');
    expect(metricValues).toHaveLength(2);

    // Chain entries
    const entries = within(panel).getAllByTestId('provenance-entry');
    expect(entries).toHaveLength(2);

    // First entry — strong TypeScript alignment (no stretch)
    expect(within(entries[0]!).getByText('Review TypeScript error handling patterns.')).toBeInTheDocument();
    expect(within(entries[0]!).getByText('score: 91%')).toBeInTheDocument();
    expect(within(entries[0]!).getByText('weight: 0.9')).toBeInTheDocument();

    // Demand concepts
    expect(within(entries[0]!).getByText('lang:typescript')).toBeInTheDocument();
    expect(within(entries[0]!).getByText('pattern:error-handling')).toBeInTheDocument();

    // Assertion with decay
    expect(within(entries[0]!).getByText(
      'Implemented typed error boundaries in production codebase.',
    )).toBeInTheDocument();
    expect(within(entries[0]!).getByText('decay: 98%')).toBeInTheDocument();

    // Source span quote
    expect(within(entries[0]!).getByText(
      'Built typed error boundaries with discriminated unions in a production TypeScript codebase.',
    )).toBeInTheDocument();

    // Interaction trace
    expect(within(entries[0]!).getByText(/Resume Review/)).toBeInTheDocument();

    // Second entry — stretch Go alignment
    expect(within(entries[1]!).getByText('Review Go goroutine lifecycle management.')).toBeInTheDocument();
    expect(within(entries[1]!).getByText('score: 55%')).toBeInTheDocument();
    expect(within(entries[1]!).getByText(/stretch: lang:go/)).toBeInTheDocument();
    // pattern:goroutine appears in both concepts and stretch tag
    expect(within(entries[1]!).getAllByText(/pattern:goroutine/).length).toBeGreaterThan(0);

    // Go assertion
    expect(within(entries[1]!).getByText('Mentioned Go usage for CLI tools.')).toBeInTheDocument();
    expect(within(entries[1]!).getByText('decay: 82%')).toBeInTheDocument();

    // Go source quote
    expect(within(entries[1]!).getByText(
      'Built CLI tooling in Go for internal developer workflow automation.',
    )).toBeInTheDocument();

    // Go interaction trace
    expect(within(entries[1]!).getByText(/Video Meeting/)).toBeInTheDocument();
  });

  it('does not render when chain is empty', () => {
    mocks.livingContext = makeLivingContext();
    mocks.provenance = {
      ...makeProvenance(),
      chain: [],
    };

    render(
      <LivingContextGraph
        candidateId="candidate-1"
        standaloneReviewMatch={standaloneMatch}
      />,
    );

    expect(screen.queryByTestId('match-provenance-panel')).toBeNull();
  });
});
