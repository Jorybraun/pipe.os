import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PersonProfilePage from './PersonProfilePage';
import type {
  LivingContextArtifact,
  LivingContextGenericSourceRef,
  LivingContextReadModel,
  LivingContextRecord,
  LivingContextSourceRef,
} from '../lib/api/types';

const mocks = vi.hoisted(() => ({
  api: {
    get: vi.fn(),
  },
}));

vi.mock('../hooks/useApiClient', () => ({
  useApiClient: () => mocks.api,
}));

vi.mock('../components/Candidate/LivingContextGraph', () => ({
  LivingContextGraph: () => <div data-testid="mock-living-context-graph" />,
}));

interface PersonContact {
  id: string;
  email: string;
  name: string | null;
  company: string | null;
  role: string | null;
  phone: string | null;
  linkedin: string | null;
  notes: string | null;
  type: string;
  created_at: string;
  updated_at: string;
}

function sourceSpan(overrides: Partial<LivingContextSourceRef> = {}): LivingContextSourceRef {
  return {
    sourceRefType: 'source_span',
    sourceRefId: 'source-ref-1',
    sourceSpanId: 'source-span-1',
    evidenceRole: 'score_report',
    artifactId: 'artifact-1',
    artifactType: 'code_review_score_report',
    artifactLogicalKey: 'review-session-1',
    artifactVersionId: 'artifact-version-1',
    artifactVersionNumber: 1,
    mediaType: 'application/json',
    storageKey: null,
    stableSegmentId: 'score-report-full',
    exactText: JSON.stringify({
      overall: {
        score: 82,
        band: 'strong',
        narrative: 'Candidate found the missing retry test and defended the review.',
        strengths: ['Found the source-backed regression risk.'],
        growth_areas: ['Probe how they balance timing trade-offs under pushback.'],
      },
    }),
    byteStart: 0,
    byteEnd: null,
    charStart: 0,
    charEnd: null,
    lineStart: 1,
    lineEnd: 1,
    timestampStartMs: null,
    timestampEndMs: null,
    metadata: { sourceKind: 'score_report' },
    ...overrides,
  };
}

function genericSource(overrides: Partial<LivingContextGenericSourceRef> = {}): LivingContextGenericSourceRef {
  return {
    sourceRefType: 'match_run',
    sourceRefId: 'match-run-1',
    sourceSpanId: null,
    evidenceRole: 'repo_match_decision',
    locator: {
      repoFullName: 'pierre/diffs',
      repoUrl: 'https://github.com/pierre/diffs',
      prNumber: 95,
      matchStatus: 'MATCHED',
    },
    exactText: null,
    contentHash: null,
    metadata: { sourceKind: 'match_run', status: 'MATCHED' },
    ...overrides,
  };
}

function contextRecord(overrides: Partial<LivingContextRecord> = {}): LivingContextRecord {
  return {
    id: 'record-1',
    scopeType: 'workspace_person',
    scopeId: 'workspace-person-1',
    interactionId: 'interaction-code-review',
    applicationId: 'candidate-1',
    episodeId: null,
    assertionId: null,
    recordType: 'code_review_score_report',
    predicate: 'preserves code review score report',
    narrative: 'Code review score report evidence for session review-session-1.',
    qualifiers: {
      sessionId: 'review-session-1',
    },
    confidence: null,
    polarity: 1,
    extractionVersion: 'code-review-ingestion-v1',
    observedAt: '2026-06-28T16:00:00.000Z',
    entities: [],
    concepts: [],
    sources: [sourceSpan()],
    ...overrides,
  };
}

function matchDecisionRecord(): LivingContextRecord {
  return contextRecord({
    id: 'record-match',
    recordType: 'candidate_pr_match_decision',
    predicate: 'selects review challenge',
    narrative: 'Matched candidate candidate-1 to PR #95 from repo repo-1.',
    qualifiers: {
      status: 'MATCHED',
      selectedPacketId: 'challenge-packet-1',
      evaluatedChallenges: [{
        challengeId: 'challenge-packet-1',
        eligible: true,
        prNumber: 95,
        repoId: 'repo-1',
        rank: 1,
      }],
      validatorAgent: {
        sourceBridge: {
          challengeId: 'challenge-packet-1',
          prNumber: 95,
          repoId: 'repo-1',
          provenanceComplete: true,
        },
      },
    },
    entities: [{
      entityType: 'pull_request',
      entityId: 'repo-1#95',
      relationship: 'selected_pull_request',
      value: null,
      confidence: null,
      metadata: {
        prNumber: 95,
        repoId: 'repo-1',
      },
    }],
    sources: [
      genericSource({
        evidenceRole: 'decision_record',
        locator: { status: 'MATCHED' },
      }),
      genericSource({
        evidenceRole: 'selected_repo_evidence',
        locator: { locator: 'src/diff.ts:1-20' },
        exactText: 'Regression test from https://github.com/pierre/diffs/issues/12 covers the risky diff path.',
      }),
    ],
  });
}

function makeLivingContext(): LivingContextReadModel {
  return {
    person: {
      personId: 'person-1',
      workspacePersonId: 'workspace-person-1',
      applicationId: 'candidate-1',
      displayName: 'Ada Reviewer',
      primaryEmail: 'ada@example.com',
      primaryPhone: null,
      relationshipSummary: 'Senior frontend engineer with source-backed React review evidence.',
      applicationStatus: null,
      pipelineId: null,
      roles: [],
    },
    summary: {
      interactionCount: 1,
      artifactCount: 2,
      contextRecordCount: 2,
      assertionCount: 0,
      signalCount: 0,
      sourceSpanCount: 4,
    },
    interactions: [
      {
        id: 'interaction-code-review',
        interactionType: 'code_review_assessment',
        externalReference: 'review-session-1',
        startedAt: '2026-06-28T15:00:00.000Z',
        endedAt: '2026-06-28T16:00:00.000Z',
        createdAt: '2026-06-28T15:00:00.000Z',
        updatedAt: '2026-06-28T16:00:00.000Z',
        metadata: {
          sessionId: 'review-session-1',
          challengeId: 'challenge-1',
          assessmentId: 'assessment-1',
          scheduledInterviewId: 'interview-code-review-1',
          status: 'scored',
        },
        artifactIds: ['artifact-1', 'artifact-2'],
        contextRecordIds: ['record-score', 'record-transcript'],
        assertionIds: [],
        signalKeys: [],
      },
      {
        id: 'interaction-resume',
        interactionType: 'resume',
        externalReference: 'resume:review-evidence:63',
        startedAt: '2026-06-28T14:45:00.000Z',
        endedAt: '2026-06-28T14:45:00.000Z',
        createdAt: '2026-06-28T14:45:00.000Z',
        updatedAt: '2026-06-28T14:45:00.000Z',
        metadata: {},
        artifactIds: ['artifact-legacy-candidate-node'],
        contextRecordIds: [],
        assertionIds: [],
        signalKeys: [],
      },
    ],
    artifacts: [
      {
        id: 'artifact-legacy-candidate-node',
        interactionId: 'interaction-resume',
        artifactType: 'legacy_candidate_node',
        logicalKey: 'candidate_node_625b5cd373443f0aef79af73749894fb',
        metadata: { source: 'legacy_candidate_node' },
        latestVersionId: 'artifact-version-legacy',
        latestVersionNumber: 1,
        versionCount: 1,
        mediaType: 'application/json',
        storageKey: null,
        createdAt: '2026-06-28T14:45:00.000Z',
        updatedAt: '2026-06-28T14:45:00.000Z',
        sourceSpans: [sourceSpan({
          sourceSpanId: 'source-span-resume-1',
          artifactType: 'legacy_candidate_node',
          artifactLogicalKey: 'resume:review-evidence:63',
          evidenceRole: 'candidate_profile_evidence',
          exactText: 'Senior frontend engineer with source-backed React review evidence.',
        })],
      } satisfies LivingContextArtifact,
    ],
    contextRecords: [
      contextRecord({ id: 'record-score' }),
      contextRecord({
        id: 'record-transcript',
        recordType: 'code_review_transcript',
        predicate: 'preserves code review transcript',
        narrative: 'Candidate requested changes and defended the source-backed regression concern.',
        qualifiers: {
          sessionId: 'review-session-1',
          finalVerdictDecision: 'request_changes',
        },
        sources: [
          sourceSpan({
            sourceSpanId: 'source-span-transcript-1',
            evidenceRole: 'transcript_segment',
            artifactType: 'code_review_transcript',
            mediaType: 'text/plain',
            exactText: 'Add a regression test around impatient hover click timing.',
            metadata: { sourceKind: 'review_comment' },
          }),
          sourceSpan({
            sourceSpanId: 'source-span-transcript-2',
            evidenceRole: 'transcript_segment',
            artifactType: 'code_review_transcript',
            mediaType: 'text/plain',
            exactText: 'The timeout cleanup needs to be defended before merge.',
            metadata: { sourceKind: 'review_comment' },
          }),
          sourceSpan({
            sourceSpanId: 'source-span-transcript-3',
            evidenceRole: 'transcript_segment',
            artifactType: 'code_review_transcript',
            mediaType: 'text/plain',
            exactText: 'Candidate requested changes with a concrete regression plan.',
            metadata: { sourceKind: 'review_comment' },
          }),
        ],
      }),
      matchDecisionRecord(),
    ],
    assertions: [],
    signals: [],
    relationships: [],
  };
}

function makeContact(): PersonContact {
  return {
    id: 'person-1',
    email: 'ada@example.com',
    name: 'Ada Reviewer',
    company: null,
    role: 'Senior frontend engineer',
    phone: null,
    linkedin: null,
    notes: null,
    type: 'candidate',
    created_at: '2026-06-28T15:00:00.000Z',
    updated_at: '2026-06-28T16:00:00.000Z',
  };
}

async function flushAsyncUpdates(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function renderPage(): void {
  render(
    <MemoryRouter initialEntries={['/people/person-1']}>
      <Routes>
        <Route path="/people/:personId" element={<PersonProfilePage />} />
        <Route path="/interviews" element={<LocationEcho />} />
      </Routes>
    </MemoryRouter>,
  );
}

function LocationEcho(): JSX.Element {
  const location = useLocation();
  return <div data-testid="location-echo">{location.pathname}{location.search}</div>;
}

function renderPageWithoutPersonId(): void {
  render(
    <MemoryRouter initialEntries={['/people']}>
      <Routes>
        <Route path="/people" element={<PersonProfilePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('PersonProfilePage', () => {
  beforeEach(() => {
    mocks.api.get.mockReset();
  });

  it('leads source-backed code-review profiles with a concise hiring decision snapshot', async () => {
    mocks.api.get
      .mockResolvedValueOnce({ contact: makeContact() })
      .mockResolvedValueOnce(makeLivingContext());

    renderPage();
    await flushAsyncUpdates();

    expect(screen.getByText('PERSON CONTEXT')).toBeInTheDocument();
    expect(screen.getByText('Source-backed profile')).toBeInTheDocument();
    expect(screen.getByText('Interactions')).toBeInTheDocument();
    expect(screen.getByText('Profile record')).toBeInTheDocument();

    const cockpit = screen.getByTestId('person-decision-cockpit');
    expect(cockpit).toHaveTextContent('Decision cockpit');
    expect(cockpit).toHaveTextContent('6 source proof items');
    expect(cockpit).toHaveTextContent('Current recommendation');
    expect(cockpit).toHaveTextContent('Advance with focused probe');
    expect(cockpit).toHaveTextContent('Assessment validity');
    expect(cockpit).toHaveTextContent('Usable source-backed signal');
    expect(cockpit).toHaveTextContent('Uncertainty');
    expect(cockpit).toHaveTextContent('Focused calibration needed');
    expect(cockpit).toHaveTextContent('Next action');
    expect(cockpit).toHaveTextContent('Schedule focused technical calibration');

    const decision = await screen.findByTestId('person-code-review-decision');
    expect(decision).toHaveTextContent('Code-review decision');
    expect(decision).toHaveTextContent('Advance with focused probe');
    expect(decision).toHaveTextContent('82/100 Strong');
    expect(decision).toHaveTextContent('pierre/diffs PR #95');
    expect(decision).toHaveTextContent('Candidate found the missing retry test and defended the review.');
    expect(decision).toHaveTextContent('Probe how they balance timing trade-offs under pushback.');
    expect(decision).toHaveTextContent('6 source-backed proof items');
    expect(decision).toHaveTextContent('Assessment validity');
    expect(decision).toHaveTextContent('Usable source-backed signal');
    expect(decision).toHaveTextContent('Uncertainty');
    expect(decision).toHaveTextContent('Focused calibration needed');
    expect(decision).toHaveTextContent('Missing context');
    expect(decision).toHaveTextContent('Probe: Probe how they balance timing trade-offs under pushback.');
    expect(decision).toHaveTextContent('Next action');
    expect(decision).toHaveTextContent('Schedule focused technical calibration');

    const proof = screen.getByTestId('person-code-review-source-proof');
    const proofSummary = proof.querySelector('summary');
    expect(proofSummary).toHaveTextContent('Source proof');
    expect(proofSummary).toHaveTextContent('candidate, repo, and scoring provenance');
    expect(proofSummary).not.toHaveTextContent('review-session-1');
    expect(proof).toHaveTextContent('Source proof');
    expect(proof).toHaveTextContent('score report');
    expect(proof).toHaveTextContent('transcript segment');
    expect(screen.getByText('Code-review assessment evidence')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open interaction' })).toBeInTheDocument();
    expect(screen.getByText('Resume evidence attached')).toBeInTheDocument();
    expect(screen.getByText('Candidate evidence')).toBeInTheDocument();
    expect(screen.getByText('Imported from resume decomposition')).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('review-session-1');
    expect(document.body).not.toHaveTextContent('interview-code-review-1');
    expect(screen.queryByText('resume:review-evidence:63')).not.toBeInTheDocument();
    expect(screen.queryByText('candidate_node_625b5cd373443f0aef79af73749894fb')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mock-living-context-graph')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open graph' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Create calibration interview' }));
    const location = screen.getByTestId('location-echo');
    expect(location).toHaveTextContent('/interviews?');
    expect(location).toHaveTextContent('new=1');
    expect(location).toHaveTextContent('interviewType=VIDEO');
    expect(location).toHaveTextContent('recipientName=Ada+Reviewer');
    expect(location).toHaveTextContent('recipientEmail=ada%40example.com');
  });

  it('does not trust a scored code review when repo-match provenance is missing', async () => {
    const context = makeLivingContext();
    context.contextRecords = context.contextRecords.filter((record) =>
      record.recordType !== 'candidate_pr_match_decision'
    );

    mocks.api.get
      .mockResolvedValueOnce({ contact: makeContact() })
      .mockResolvedValueOnce(context);

    renderPage();
    await flushAsyncUpdates();

    const cockpit = screen.getByTestId('person-decision-cockpit');
    expect(cockpit).toHaveTextContent('Current recommendation');
    expect(cockpit).toHaveTextContent('Collect missing evidence');
    expect(cockpit).toHaveTextContent('Assessment validity');
    expect(cockpit).toHaveTextContent('Partial source-backed signal');
    expect(cockpit).toHaveTextContent('Uncertainty');
    expect(cockpit).toHaveTextContent('Repo fit unknown');
    expect(cockpit).toHaveTextContent('Next action');
    expect(cockpit).toHaveTextContent('Schedule evidence-gathering call');

    const decision = await screen.findByTestId('person-code-review-decision');
    expect(decision).toHaveTextContent('Collect missing evidence');
    expect(decision).toHaveTextContent('Partial source-backed signal');
    expect(decision).toHaveTextContent('Repo fit unknown');
    expect(decision).toHaveTextContent('Source-backed repo challenge selection');
    expect(decision).toHaveTextContent('Source-backed repo match decision provenance');
    expect(decision).not.toHaveTextContent('Usable source-backed signal');
    expect(decision).not.toHaveTextContent('Advance with focused probe');
  });

  it('shows a visible profile error instead of spinning forever when the person id is missing', async () => {
    renderPageWithoutPersonId();
    await flushAsyncUpdates();

    expect(screen.queryByText('Loading person context...')).not.toBeInTheDocument();
    expect(screen.getByText('Missing person id for this profile.')).toBeInTheDocument();
    expect(mocks.api.get).not.toHaveBeenCalled();
  });
});
