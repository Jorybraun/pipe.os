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
import type { AssessmentProgressSnapshot } from '../lib/scheduling/types';

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
      dimensions: {
        source_accuracy: { score: 2 },
        bug_detection: { score: 2 },
        test_reasoning: { score: 2 },
        risk_calibration: { score: 1 },
        communication: { score: 2 },
        ai_usage_judgment: { score: 1 },
      },
      evidence: [
        { id: 'comment-1', text: 'Add a regression test around impatient hover click timing.' },
        { id: 'pushback-1', text: 'The timeout cleanup needs to be defended before merge.' },
      ],
      metrics: {
        annotations: 1,
        pushback_threads: 1,
        source_refs: 4,
        rubric_dimensions: 6,
        score_confidence: 0.82,
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
          candidateSourceCount: 2,
          repoSourceCount: 2,
          roleSourceCount: 0,
          alignedDemandCount: 2,
          stretchCount: 0,
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

function makeWorkspaceAssessmentContext(): LivingContextReadModel {
  const context = makeLivingContext();
  context.summary = {
    ...context.summary,
    interactionCount: 2,
    contextRecordCount: 3,
    sourceSpanCount: 5,
  };
  context.interactions = [
    {
      id: 'interaction-workspace-assessment',
      interactionType: 'assessment_session',
      externalReference: 'assessment-session-1',
      startedAt: '2026-06-30T14:00:00.000Z',
      endedAt: '2026-06-30T14:30:00.000Z',
      createdAt: '2026-06-30T14:00:00.000Z',
      updatedAt: '2026-06-30T14:30:00.000Z',
      metadata: {
        sessionId: 'assessment-session-1',
        scheduledInterviewId: 'interview-workspace-1',
        mode: 'OPEN_SOURCE_BUG_FIX',
        state: 'EVALUATED',
      },
      artifactIds: ['artifact-workspace-evaluation'],
      contextRecordIds: [
        'record-assessment-claim-1',
        'record-assessment-claim-2',
        'record-assessment-source-less-claim',
        'record-assessment-human-decision',
      ],
      assertionIds: [],
      signalKeys: [],
    },
    context.interactions[1]!,
  ];
  context.contextRecords = [
    contextRecord({
      id: 'record-assessment-claim-1',
      interactionId: 'interaction-workspace-assessment',
      recordType: 'evaluation:implementation_correctness',
      predicate: 'positive',
      narrative: 'The candidate fixed the impatient popover click path with a focused source-backed diff.',
      qualifiers: {
        mode: 'OPEN_SOURCE_BUG_FIX',
        dimension: 'implementation_correctness',
        reportStatus: 'EVALUATED',
        reportSummary: 'Candidate addressed the impatient click issue with a focused patch and regression tests.',
      },
      confidence: 0.91,
      observedAt: '2026-06-30T14:25:00.000Z',
      entities: [
        {
          entityType: 'assessment_session',
          entityId: 'assessment-session-1',
          relationship: 'source_session',
          value: null,
          confidence: null,
          metadata: {},
        },
        {
          entityType: 'assessment_evaluation_report',
          entityId: 'assessment-report-1',
          relationship: 'evaluation_report',
          value: null,
          confidence: null,
          metadata: {},
        },
      ],
      sources: [
        genericSource({
          sourceRefType: 'code_diff',
          sourceRefId: 'base..candidate',
          evidenceRole: 'submitted_diff',
          exactText: 'diff --git a/packages/react/src/popover/root/usePopoverRoot.ts b/packages/react/src/popover/root/usePopoverRoot.ts',
        }),
      ],
    }),
    contextRecord({
      id: 'record-assessment-claim-2',
      interactionId: 'interaction-workspace-assessment',
      recordType: 'evaluation:test_strategy',
      predicate: 'positive',
      narrative: 'The submitted test evidence covers the popover trigger regression.',
      qualifiers: {
        mode: 'OPEN_SOURCE_BUG_FIX',
        dimension: 'test_strategy',
        reportStatus: 'EVALUATED',
        reportSummary: 'Candidate addressed the impatient click issue with a focused patch and regression tests.',
      },
      confidence: 0.84,
      observedAt: '2026-06-30T14:26:00.000Z',
      entities: [
        {
          entityType: 'assessment_session',
          entityId: 'assessment-session-1',
          relationship: 'source_session',
          value: null,
          confidence: null,
          metadata: {},
        },
      ],
      sources: [
        genericSource({
          sourceRefType: 'test_run',
          sourceRefId: 'candidate-sha:test-run',
          evidenceRole: 'verification_test_output',
          exactText: '$ git diff --check HEAD~1 HEAD && git diff --name-only HEAD~1 HEAD\nexitCode: 0',
        }),
      ],
    }),
    contextRecord({
      id: 'record-assessment-source-less-claim',
      interactionId: 'interaction-workspace-assessment',
      recordType: 'evaluation:seniority',
      predicate: 'positive',
      narrative: 'This source-less person-profile praise must not appear in the hiring-manager readout.',
      qualifiers: {
        mode: 'OPEN_SOURCE_BUG_FIX',
        dimension: 'seniority',
        reportStatus: 'EVALUATED',
        reportSummary: 'Source-less praise should not shape the profile decision.',
      },
      confidence: 0.99,
      observedAt: '2026-06-30T14:27:00.000Z',
      entities: [
        {
          entityType: 'assessment_session',
          entityId: 'assessment-session-1',
          relationship: 'source_session',
          value: null,
          confidence: null,
          metadata: {},
        },
      ],
      sources: [],
    }),
    contextRecord({
      id: 'record-assessment-human-decision',
      interactionId: 'interaction-workspace-assessment',
      recordType: 'assessment:human_assessment_decision',
      predicate: 'advance',
      narrative: 'Human reviewer advances after checking the source-backed evaluation report.',
      qualifiers: {
        mode: 'OPEN_SOURCE_BUG_FIX',
        decision: 'advance',
      },
      observedAt: '2026-06-30T14:30:00.000Z',
      sources: [
        genericSource({
          sourceRefType: 'assessment_evaluation_report',
          sourceRefId: 'assessment-report-1',
          evidenceRole: 'human_decision_basis',
          exactText: 'Candidate addressed the impatient click issue with a focused patch and regression tests.',
        }),
      ],
    }),
    context.contextRecords.find((record) => record.id === 'record-score')!,
  ].filter((record) => record.id !== 'record-score');
  context.artifacts = [
    {
      id: 'artifact-workspace-evaluation',
      interactionId: 'interaction-workspace-assessment',
      artifactType: 'assessment_evaluation_report',
      logicalKey: 'assessment-report-1',
      metadata: { source: 'assessment_layer' },
      latestVersionId: 'artifact-workspace-evaluation-version',
      latestVersionNumber: 1,
      versionCount: 1,
      mediaType: 'application/json',
      storageKey: null,
      createdAt: '2026-06-30T14:25:00.000Z',
      updatedAt: '2026-06-30T14:25:00.000Z',
      sourceSpans: [],
    },
  ];
  return context;
}

function makeSelectedAssessmentProgress(): AssessmentProgressSnapshot {
  return {
    session: {
      id: 'assessment-session-selected',
      ingestionKey: 'assessment-session-selected',
      interviewId: 'interview-workspace-1',
      candidateId: 'candidate-1',
      workspaceId: 'workspace-1',
      workspacePersonId: 'workspace-person-1',
      applicationId: 'application-1',
      mode: 'OPEN_SOURCE_BUG_FIX',
      state: 'EVALUATED',
      createdAt: '2026-06-30T14:00:00.000Z',
      updatedAt: '2026-06-30T14:30:00.000Z',
    },
    stage: 'EVALUATED',
    nextAction: 'REVIEW_EVALUATION',
    nextActionLabel: 'Review evaluation',
    hasChallengePacket: true,
    hasWorkEvidence: true,
    hasMessageEvidence: true,
    hasDevContainerEvidence: true,
    hasToolUsageEvidence: true,
    hasCommitSubmission: true,
    hasFinalSubmission: true,
    hasAiInteraction: true,
    hasTranscriptEvidence: false,
    hasTestEvidence: true,
    hasVerificationGap: false,
    evidenceCounts: [{ kind: 'code_diff', count: 1 }],
    sourceRefCounts: [
      { kind: 'challenge_packet', count: 1 },
      { kind: 'git_commit', count: 1 },
      { kind: 'code_diff', count: 2 },
    ],
    evidenceSnippets: [
      {
        eventKind: 'assessment_evaluation',
        sourceRefType: 'code_diff',
        evidenceRole: 'evaluation_support',
        exactText: 'Candidate fixed the impatient popover click path and added regression coverage.',
        occurredAt: '2026-06-30T14:25:00.000Z',
      },
    ],
    challenge: {
      sourceRefType: 'challenge_packet',
      sourceRefId: 'challenge-1',
      evidenceRole: 'assessment_challenge',
      exactText: 'Fix the impatient popover click bug.',
      locator: { repositoryUrl: 'https://github.com/mui/base-ui' },
    },
    latestEvent: {
      id: 'event-1',
      kind: 'assessment_evaluation',
      sequence: 8,
      occurredAt: '2026-06-30T14:25:00.000Z',
    },
    commit: {
      eventId: 'commit-event-1',
      repositoryUrl: 'https://github.com/mui/base-ui',
      forkRepositoryUrl: null,
      branchName: 'fix-popover-click',
      baseCommitSha: 'base123',
      commitSha: 'abc1234',
      commitUrl: 'https://github.com/mui/base-ui/commit/abc1234',
      changedFiles: ['packages/react/src/popover/root/usePopoverRoot.ts'],
      occurredAt: '2026-06-30T14:20:00.000Z',
    },
    evaluation: {
      id: 'evaluation-1',
      status: 'EVALUATED',
      summary: 'Candidate addressed the impatient click issue with a focused patch and regression tests.',
      recommendation: 'advance',
      createdAt: '2026-06-30T14:25:00.000Z',
      evidenceCoverage: {
        schemaVersion: '1',
        sourceRefCount: 4,
        sourceRefTypeCounts: { code_diff: 2, git_commit: 1, challenge_packet: 1 },
        requiredForEvaluation: [],
        expectedForHighConfidence: [],
      },
      claims: [
        {
          id: 'claim-1',
          polarity: 'positive',
          dimension: 'implementation_correctness',
          narrative: 'The fix is focused and source-backed.',
          confidence: 0.9,
          sourceRefCount: 2,
          sourceRefTypes: ['code_diff'],
        },
        {
          id: 'claim-source-less-profile-praise',
          polarity: 'positive',
          dimension: 'seniority',
          narrative: 'This selected-assessment source-less praise must not appear on the profile.',
          confidence: 0.99,
          sourceRefCount: 0,
          sourceRefTypes: [],
        },
      ],
      diagnostics: [],
    },
    humanDecision: null,
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

function makeSelectedCodeReviewDecision(): unknown {
  return {
    decisionLabel: 'Code-review decision',
    sessionId: 'review-session-1',
    outcome: 'Candidate requested changes',
    recommendation: 'Advance with focused probe',
    recommendationDetail: 'Use the source-backed review as a positive signal, then calibrate the remaining uncertainty.',
    uncertainty: 'Focused calibration needed',
    uncertaintyDetail: 'Probe timing trade-offs before treating the score as final hiring signal.',
    missingContext: ['Probe timing trade-offs.'],
    assessmentValidity: 'Usable source-backed signal',
    assessmentValidityDetail: 'Score, selected PR, and match proof are present.',
    nextAction: 'Schedule focused technical calibration',
    nextActionDetail: 'Use the next conversation to pressure-test the weakest review dimension.',
    scoreLabel: '82/100 Strong',
    scoreProvenanceLabel: '6 rubric dimensions · 2 evidence items · 5 scoring metrics',
    challengeLabel: 'acme/widgets PR #42',
    challengeUrl: 'https://github.com/acme/widgets/pull/42',
    narrative: 'Candidate found the missing retry test and defended the review.',
    strengths: ['Found the release-blocking risk.'],
    probes: ['Probe timing trade-offs.'],
    proofCount: 4,
    proofItems: [
      { id: 'assignment', label: 'assignment', text: 'acme/widgets PR #42' },
      { id: 'score', label: 'score report', text: '82/100 Strong' },
      { id: 'match-proof', label: 'match proof', text: 'Rendered candidate evidence and repo evidence are bridged by exact source spans.' },
    ],
    basisItems: [
      { label: 'Score report', value: 'Scored', satisfied: true },
      { label: 'Match proof', value: 'Source-backed match', satisfied: true },
    ],
  };
}

function makeSelectedManualCodeReviewDecision(): unknown {
  return {
    ...(makeSelectedCodeReviewDecision() as Record<string, unknown>),
    recommendation: 'Review assignment fairness before rejecting',
    recommendationDetail: 'Use the weak review as a technical signal, then calibrate whether the gap was ability, context, or assignment fit.',
    uncertainty: 'High calibration risk',
    uncertaintyDetail: 'Manual PR assignment does not prove candidate-fit matching.',
    missingContext: ['Manual PR assignment needs candidate-fit calibration.'],
    assessmentValidity: 'Score needs human calibration',
    assessmentValidityDetail: 'Score, review comments, and repo challenge proof exist, but candidate-fit proof is not present.',
    nextAction: 'Review assignment fairness before rejecting',
    nextActionDetail: 'Use the weak score and growth area to verify whether this reflects candidate ability, assignment fit, or missing context before rejecting.',
    scoreLabel: '38/100 Weak',
    challengeLabel: 'mui/base-ui PR #973',
    challengeUrl: 'https://github.com/mui/base-ui/pull/973',
    sourceProofSummary: 'repo evidence, scoring provenance, and open gaps',
    proofItems: [
      { id: 'assignment', label: 'assignment', text: 'mui/base-ui PR #973' },
      { id: 'score', label: 'score report', text: '38/100 Weak' },
      { id: 'match-proof', label: 'match proof', text: 'Manual override: recruiter-selected source-backed review challenge.' },
    ],
    basisItems: [
      { label: 'Score report', value: 'Scored', satisfied: true },
      { label: 'Review evidence', value: '2 annotations', satisfied: true },
      { label: 'Match proof', value: 'Assignment evidence only', satisfied: false },
    ],
  };
}

async function flushAsyncUpdates(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function renderPage(state?: unknown): void {
  render(
    <MemoryRouter initialEntries={[state ? { pathname: '/people/person-1', state } : '/people/person-1']}>
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

  it('renders navigation living context immediately and hydrates the full graph in the background', async () => {
    const initialContext = makeLivingContext();

    mocks.api.get
      .mockResolvedValueOnce({ contact: makeContact() })
      .mockResolvedValueOnce(initialContext);

    renderPage({ livingContext: initialContext, selectedAssessment: makeSelectedAssessmentProgress() });
    await flushAsyncUpdates();

    expect(screen.queryByText('Loading person context...')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Ada Reviewer' })).toBeInTheDocument();
    const cockpit = screen.getByTestId('person-decision-cockpit');
    expect(cockpit).toHaveTextContent('Decision cockpit');
    expect(cockpit).toHaveTextContent('Advance with focused probe');
    expect(screen.getByTestId('person-code-review-decision')).toHaveTextContent('Code-review decision');
    expect(mocks.api.get).toHaveBeenCalledWith('/api/v1/contacts/person-1');
    expect(mocks.api.get).toHaveBeenCalledWith('/api/v1/contacts/person-1/living-context');
  });

  it('keeps generic navigation living context lightweight without full graph hydration', async () => {
    const initialContext = makeLivingContext();

    mocks.api.get
      .mockResolvedValueOnce({ contact: makeContact() });

    renderPage({ livingContext: initialContext });
    await flushAsyncUpdates();

    expect(screen.queryByText('Loading person context...')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Ada Reviewer' })).toBeInTheDocument();
    expect(mocks.api.get).toHaveBeenCalledWith('/api/v1/contacts/person-1');
    expect(mocks.api.get).not.toHaveBeenCalledWith('/api/v1/contacts/person-1/living-context');
  });

  it('renders a selected code-review decision from navigation while background graph hydration is empty', async () => {
    const summaryContext = makeLivingContext();
    summaryContext.interactions = [];
    summaryContext.artifacts = [];
    summaryContext.contextRecords = [];
    summaryContext.assertions = [];
    summaryContext.signals = [];
    summaryContext.relationships = [];

    mocks.api.get
      .mockResolvedValueOnce({ contact: makeContact() })
      .mockResolvedValueOnce(summaryContext);

    renderPage({
      livingContext: summaryContext,
      selectedCodeReviewDecision: makeSelectedCodeReviewDecision(),
    });
    await flushAsyncUpdates();

    expect(screen.queryByText('Loading person context...')).not.toBeInTheDocument();
    const cockpit = screen.getByTestId('person-decision-cockpit');
    expect(cockpit).toHaveTextContent('Advance with focused probe');
    expect(cockpit).toHaveTextContent('Usable source-backed signal');
    const decision = screen.getByTestId('person-code-review-decision');
    expect(decision).toHaveTextContent('82/100 Strong');
    expect(screen.getByTestId('person-code-review-decision-state')).toHaveTextContent('Usable signal');
    expect(screen.getByTestId('person-code-review-decision-state')).toHaveAttribute('aria-label', 'Code-review decision state: usable signal');
    expect(decision).toHaveTextContent('Score provenance');
    expect(decision).toHaveTextContent('6 rubric dimensions · 2 evidence items · 5 scoring metrics');
    expect(decision).toHaveTextContent('acme/widgets PR #42');
    const mix = screen.getByTestId('person-evidence-mix');
    expect(mix).toHaveTextContent('Technical assessment signal is present');
    expect(mix).toHaveTextContent('Use this selected code-review decision as current technical evidence');
    expect(mix).toHaveTextContent('Schedule focused technical calibration');
    expect(mix).not.toHaveTextContent('No source mix yet');
    expect(mix).not.toHaveTextContent('Collect first source-backed evidence');
    expect(mocks.api.get).toHaveBeenCalledWith('/api/v1/contacts/person-1/living-context');
  });

  it('makes empty selected code-review missing context explicit', async () => {
    const summaryContext = makeLivingContext();
    summaryContext.interactions = [];
    summaryContext.artifacts = [];
    summaryContext.contextRecords = [];
    summaryContext.assertions = [];
    summaryContext.signals = [];
    summaryContext.relationships = [];
    const decision = makeSelectedCodeReviewDecision() as Record<string, unknown>;
    decision.missingContext = [];

    mocks.api.get
      .mockResolvedValueOnce({ contact: makeContact() })
      .mockResolvedValueOnce(summaryContext);

    renderPage({
      livingContext: summaryContext,
      selectedCodeReviewDecision: decision,
    });
    await flushAsyncUpdates();

    const decisionCard = screen.getByTestId('person-code-review-decision');
    expect(decisionCard).toHaveTextContent('Missing context');
    expect(decisionCard).toHaveTextContent('No blocking evidence gap recorded; confirm the signal transfers beyond this task.');
    expect(screen.getByTestId('person-decision-cockpit')).toHaveTextContent('No blocking evidence gap');
  });

  it('hydrates real interaction coverage after opening from a compact code-review navigation decision', async () => {
    const summaryContext = makeLivingContext();
    summaryContext.interactions = [];
    summaryContext.artifacts = [];
    summaryContext.contextRecords = [];
    summaryContext.assertions = [];
    summaryContext.signals = [];
    summaryContext.relationships = [];
    let resolveContext: (value: LivingContextReadModel) => void = () => undefined;
    const pendingContext = new Promise<LivingContextReadModel>((resolve) => {
      resolveContext = resolve;
    });

    mocks.api.get
      .mockResolvedValueOnce({ contact: makeContact() })
      .mockReturnValueOnce(pendingContext);

    renderPage({
      livingContext: summaryContext,
      selectedCodeReviewDecision: makeSelectedCodeReviewDecision(),
    });
    await flushAsyncUpdates();

    expect(screen.queryByText('Loading person context...')).not.toBeInTheDocument();
    expect(screen.getByTestId('person-code-review-decision')).toHaveTextContent('acme/widgets PR #42');
    expect(screen.getByTestId('person-interaction-coverage')).toHaveTextContent(
      'Full source rows are loading.',
    );

    await act(async () => {
      resolveContext(makeLivingContext());
      await pendingContext;
    });

    expect(screen.getByTestId('person-code-review-decision')).toHaveTextContent('pierre/diffs PR #95');
    expect(screen.getByTestId('person-interaction-coverage')).toHaveTextContent('1 code review');
    expect(screen.getByTestId('person-interaction-coverage')).toHaveTextContent('1 resume');
  });

  it('keeps selected manual code-review proof wording honest on the person profile', async () => {
    const summaryContext = makeLivingContext();
    summaryContext.interactions = [];
    summaryContext.artifacts = [];
    summaryContext.contextRecords = [];
    summaryContext.assertions = [];
    summaryContext.signals = [];
    summaryContext.relationships = [];

    mocks.api.get
      .mockResolvedValueOnce({ contact: makeContact() })
      .mockResolvedValueOnce(summaryContext);

    renderPage({
      livingContext: summaryContext,
      selectedCodeReviewDecision: makeSelectedManualCodeReviewDecision(),
    });
    await flushAsyncUpdates();

    const decision = screen.getByTestId('person-code-review-decision');
    expect(decision).toHaveTextContent('Review assignment fairness before rejecting');
    expect(screen.getByTestId('person-code-review-decision-state')).toHaveTextContent('Calibration needed');
    expect(screen.getByTestId('person-code-review-decision-state')).toHaveAttribute('aria-label', 'Code-review decision state: calibration needed');
    expect(decision).toHaveTextContent('38/100 Weak');
    expect(decision).toHaveTextContent('mui/base-ui PR #973');
    expect(screen.getByTestId('person-decision-cockpit')).toHaveTextContent('Create fairness review');
    const proof = screen.getByTestId('person-code-review-source-proof');
    const proofSummary = proof.querySelector('summary');
    expect(proofSummary).toHaveTextContent('repo evidence, scoring provenance, and open gaps');
    expect(proofSummary).not.toHaveTextContent('candidate, role, repo');
    expect(proofSummary).not.toHaveTextContent('candidate-repo match proof');
    expect(proofSummary).not.toHaveTextContent('role evidence');
    const basis = screen.getByTestId('person-code-review-decision-basis');
    expect(basis).toHaveTextContent('Match proof');
    expect(basis).toHaveTextContent('Assignment evidence only');
    expect(basis).not.toHaveTextContent('8/12 Usable');
    expect(basis).not.toHaveTextContent('Source-backed match');
  });

  it('does not turn wait-for-review wording into a duplicate code-review assessment CTA', async () => {
    const summaryContext = makeLivingContext();
    summaryContext.interactions = [];
    summaryContext.artifacts = [];
    summaryContext.contextRecords = [];
    summaryContext.assertions = [];
    summaryContext.signals = [];
    summaryContext.relationships = [];

    mocks.api.get
      .mockResolvedValueOnce({ contact: makeContact() })
      .mockResolvedValueOnce(summaryContext);

    renderPage({
      livingContext: summaryContext,
      selectedCodeReviewDecision: {
        ...(makeSelectedCodeReviewDecision() as Record<string, unknown>),
        recommendation: 'Wait for review signal',
        recommendationDetail: 'The PR assignment is ready, but the candidate has not submitted review evidence yet.',
        uncertainty: 'Performance not scored',
        uncertaintyDetail: 'The assignment is setup only until review comments and score evidence exist.',
        missingContext: ['Candidate review transcript or source-backed review comments'],
        assessmentValidity: 'Assignment ready, score missing',
        assessmentValidityDetail: 'The repo challenge and match provenance are source-backed, but there is no performance signal yet.',
        nextAction: 'Wait for review signal',
        nextActionDetail: 'Do not create another code-review invite; evaluate once the candidate submits review evidence.',
        scoreLabel: null,
        scoreProvenanceLabel: null,
      },
    });
    await flushAsyncUpdates();

    const cockpit = screen.getByTestId('person-decision-cockpit');
    expect(cockpit).toHaveTextContent('Wait for review signal');
    expect(cockpit).toHaveTextContent('Do not create another code-review invite');
    expect(screen.queryByTestId('person-next-action-cta')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create code-review assessment' })).not.toBeInTheDocument();
  });

  it('sanitizes stale selected code-review navigation state instead of crashing the profile', async () => {
    const summaryContext = makeLivingContext();
    summaryContext.interactions = [];
    summaryContext.artifacts = [];
    summaryContext.contextRecords = [];
    summaryContext.assertions = [];
    summaryContext.signals = [];
    summaryContext.relationships = [];

    mocks.api.get
      .mockResolvedValueOnce({ contact: makeContact() })
      .mockResolvedValueOnce(summaryContext);

    renderPage({
      livingContext: summaryContext,
      selectedCodeReviewDecision: {
        decisionLabel: 'Code-review decision',
        sessionId: 'review-session-stale',
        outcome: 'Candidate requested changes',
        recommendation: 'Review assignment fairness before rejecting',
        recommendationDetail: 'Route-state fallback should remain visible without trusting malformed proof.',
        uncertainty: 'High calibration risk',
        uncertaintyDetail: 'Malformed navigation state cannot prove candidate-fit matching.',
        missingContext: 'Manual PR assignment needs candidate-fit calibration.',
        assessmentValidity: 'Score needs human calibration',
        assessmentValidityDetail: 'The selected review exists, but proof arrays were not valid.',
        nextAction: 'Review assignment fairness before rejecting',
        nextActionDetail: 'Ask the hiring team to verify assignment fit before deciding.',
        scoreLabel: '38/100 Weak',
        scoreProvenanceLabel: null,
        challengeLabel: 'mui/base-ui PR #973',
        challengeUrl: 'https://github.com/mui/base-ui/pull/973',
        narrative: 'Malformed route state should not crash this page.',
        strengths: 'Found one issue.',
        probes: null,
        proofCount: '4',
        sourceProofSummary: null,
        proofItems: null,
        basisItems: '8/12 Usable',
      },
    });
    await flushAsyncUpdates();

    const decision = screen.getByTestId('person-code-review-decision');
    expect(decision).toHaveTextContent('Review assignment fairness before rejecting');
    expect(decision).toHaveTextContent('38/100 Weak');
    expect(decision).toHaveTextContent('0 source-backed proof items');
    expect(decision).toHaveTextContent('No blocking evidence gap recorded; confirm the signal transfers beyond this task.');
    const basis = screen.getByTestId('person-code-review-decision-basis');
    expect(basis).toHaveTextContent('Match proof');
    expect(basis).toHaveTextContent('Missing');
    expect(basis).not.toHaveTextContent('8/12 Usable');
  });

  it('does not trust source-backed match route-state claims without candidate and repo proof', async () => {
    const summaryContext = makeLivingContext();
    summaryContext.interactions = [];
    summaryContext.artifacts = [];
    summaryContext.contextRecords = [];
    summaryContext.assertions = [];
    summaryContext.signals = [];
    summaryContext.relationships = [];

    mocks.api.get
      .mockResolvedValueOnce({ contact: makeContact() })
      .mockResolvedValueOnce(summaryContext);

    renderPage({
      livingContext: summaryContext,
      selectedCodeReviewDecision: {
        ...(makeSelectedCodeReviewDecision() as Record<string, unknown>),
        proofItems: [
          { id: 'assignment', label: 'assignment', text: 'acme/widgets PR #42' },
          { id: 'score', label: 'score report', text: '82/100 Strong' },
        ],
        sourceProofSummary: 'repo evidence and scoring provenance',
        basisItems: [
          { label: 'Score report', value: 'Scored', satisfied: true },
          { label: 'Match proof', value: 'Source-backed match', satisfied: true },
        ],
      },
    });
    await flushAsyncUpdates();

    const basis = screen.getByTestId('person-code-review-decision-basis');
    expect(basis).toHaveTextContent('Match proof');
    expect(basis).toHaveTextContent('Missing');
    expect(basis).not.toHaveTextContent('Source-backed match');
    const cockpit = screen.getByTestId('person-decision-cockpit');
    expect(cockpit).toHaveTextContent('Collect missing evidence');
    expect(cockpit).not.toHaveTextContent('Advance with focused probe');
    const proof = screen.getByTestId('person-code-review-source-proof');
    const proofSummary = proof.querySelector('summary');
    expect(proofSummary).not.toHaveTextContent('candidate-repo match proof');
  });

  it('does not trust source proof summary text as candidate-repo match proof by itself', async () => {
    const summaryContext = makeLivingContext();
    summaryContext.interactions = [];
    summaryContext.artifacts = [];
    summaryContext.contextRecords = [];
    summaryContext.assertions = [];
    summaryContext.signals = [];
    summaryContext.relationships = [];

    mocks.api.get
      .mockResolvedValueOnce({ contact: makeContact() })
      .mockResolvedValueOnce(summaryContext);

    renderPage({
      livingContext: summaryContext,
      selectedCodeReviewDecision: {
        ...(makeSelectedCodeReviewDecision() as Record<string, unknown>),
        proofItems: [
          { id: 'assignment', label: 'assignment', text: 'acme/widgets PR #42' },
          { id: 'score', label: 'score report', text: '82/100 Strong' },
        ],
        sourceProofSummary: 'candidate-repo match proof, repo evidence, and scoring provenance',
        basisItems: [
          { label: 'Score report', value: 'Scored', satisfied: true },
          { label: 'Match proof', value: 'Source-backed match', satisfied: true },
        ],
      },
    });
    await flushAsyncUpdates();

    const basis = screen.getByTestId('person-code-review-decision-basis');
    expect(basis).toHaveTextContent('Match proof');
    expect(basis).toHaveTextContent('Missing');
    expect(basis).not.toHaveTextContent('Source-backed match');
    const cockpit = screen.getByTestId('person-decision-cockpit');
    expect(cockpit).toHaveTextContent('Collect missing evidence');
    expect(cockpit).not.toHaveTextContent('Advance with focused probe');
    const proof = screen.getByTestId('person-code-review-source-proof');
    const proofSummary = proof.querySelector('summary');
    expect(proofSummary).not.toHaveTextContent('candidate-repo match proof');
  });

  it('does not trust route-state proof counts without parsed proof items', async () => {
    const summaryContext = makeLivingContext();
    summaryContext.interactions = [];
    summaryContext.artifacts = [];
    summaryContext.contextRecords = [];
    summaryContext.assertions = [];
    summaryContext.signals = [];
    summaryContext.relationships = [];

    mocks.api.get
      .mockResolvedValueOnce({ contact: makeContact() })
      .mockResolvedValueOnce(summaryContext);

    renderPage({
      livingContext: summaryContext,
      selectedCodeReviewDecision: {
        ...(makeSelectedManualCodeReviewDecision() as Record<string, unknown>),
        proofCount: 9,
        proofItems: null,
        sourceProofSummary: null,
        basisItems: [
          { label: 'Score report', value: 'Scored', satisfied: true },
          { label: 'Match proof', value: 'Assignment evidence only', satisfied: false },
        ],
      },
    });
    await flushAsyncUpdates();

    const decision = screen.getByTestId('person-code-review-decision');
    expect(decision).toHaveTextContent('0 source-backed proof items');
    expect(decision).not.toHaveTextContent('9 source-backed proof items');
    const proof = screen.getByTestId('person-code-review-source-proof');
    expect(proof).toHaveTextContent('No source proof items were preserved for this selected decision.');
  });

  it('does not trust route-state source proof summary without parsed proof items', async () => {
    const summaryContext = makeLivingContext();
    summaryContext.interactions = [];
    summaryContext.artifacts = [];
    summaryContext.contextRecords = [];
    summaryContext.assertions = [];
    summaryContext.signals = [];
    summaryContext.relationships = [];

    mocks.api.get
      .mockResolvedValueOnce({ contact: makeContact() })
      .mockResolvedValueOnce(summaryContext);

    renderPage({
      livingContext: summaryContext,
      selectedCodeReviewDecision: {
        ...(makeSelectedManualCodeReviewDecision() as Record<string, unknown>),
        proofItems: null,
        proofCount: 3,
        sourceProofSummary: 'repo evidence and scoring provenance',
        basisItems: [
          { label: 'Score report', value: 'Scored', satisfied: true },
          { label: 'Match proof', value: 'Assignment evidence only', satisfied: false },
        ],
      },
    });
    await flushAsyncUpdates();

    const decision = screen.getByTestId('person-code-review-decision');
    expect(decision).toHaveTextContent('0 source-backed proof items');
    const proof = screen.getByTestId('person-code-review-source-proof');
    const proofSummary = proof.querySelector('summary');
    expect(proofSummary).not.toHaveTextContent('repo evidence and scoring provenance');
    expect(proof).toHaveTextContent('No source proof items were preserved for this selected decision.');
  });

  it('renders direct profile loads from a lightweight summary and hydrates full graph on audit open', async () => {
    const summaryContext = makeLivingContext();
    summaryContext.interactions = [];
    summaryContext.artifacts = [];
    summaryContext.contextRecords = [];
    summaryContext.assertions = [];
    summaryContext.signals = [];
    summaryContext.relationships = [];
    let resolveContext: (value: LivingContextReadModel) => void = () => undefined;
    const pendingContext = new Promise<LivingContextReadModel>((resolve) => {
      resolveContext = resolve;
    });

    mocks.api.get
      .mockResolvedValueOnce({ contact: makeContact() })
      .mockResolvedValueOnce(summaryContext)
      .mockReturnValueOnce(pendingContext);

    renderPage();
    await flushAsyncUpdates();

    expect(screen.queryByText('Loading person context...')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Ada Reviewer' })).toBeInTheDocument();
    expect(screen.getByText('Source-backed profile')).toBeInTheDocument();
    expect(mocks.api.get).toHaveBeenCalledWith('/api/v1/contacts/person-1');
    expect(mocks.api.get).toHaveBeenCalledWith('/api/v1/contacts/person-1/living-context/summary');
    expect(mocks.api.get).not.toHaveBeenCalledWith('/api/v1/contacts/person-1/living-context');

    const audit = screen.getByTestId('person-source-audit') as HTMLDetailsElement;
    await act(async () => {
      audit.open = true;
      fireEvent(audit, new Event('toggle'));
    });
    expect(mocks.api.get).toHaveBeenCalledWith('/api/v1/contacts/person-1/living-context');

    await act(async () => {
      resolveContext(makeLivingContext());
      await pendingContext;
    });
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
    expect(cockpit).toHaveTextContent('Missing context');
    expect(cockpit).toHaveTextContent('Calibration probe recommended');
    expect(cockpit).toHaveTextContent('Next action');
    expect(cockpit).toHaveTextContent('Schedule focused technical calibration');

    const decision = await screen.findByTestId('person-code-review-decision');
    expect(decision).toHaveTextContent('Code-review decision');
    expect(decision).toHaveTextContent('Advance with focused probe');
    expect(decision).toHaveTextContent('82/100 Strong');
    expect(decision).toHaveTextContent('Score provenance');
    expect(decision).toHaveTextContent('6 rubric dimensions · 2 evidence items · 5 scoring metrics');
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
    const rationale = screen.getByTestId('person-code-review-rationale');
    expect(rationale).toHaveTextContent('Why this recommendation');
    expect(rationale).toHaveTextContent('Signal');
    expect(rationale).toHaveTextContent('82/100 Strong');
    expect(rationale).toHaveTextContent('pierre/diffs PR #95');
    expect(rationale).toHaveTextContent('Trust');
    expect(rationale).toHaveTextContent('Usable source-backed signal');
    expect(rationale).toHaveTextContent('6 source-backed proof items');
    expect(rationale).toHaveTextContent('Calibrate');
    expect(rationale).toHaveTextContent('Focused calibration needed');
    expect(rationale).toHaveTextContent('Schedule focused technical calibration');
    const scoreValidity = screen.getByTestId('person-code-review-score-validity');
    expect(scoreValidity).toHaveTextContent('Score validity');
    expect(scoreValidity).toHaveTextContent('Valid because');
    expect(scoreValidity).toHaveTextContent('score report is captured');
    expect(scoreValidity).toHaveTextContent('review transcript is captured');
    expect(scoreValidity).toHaveTextContent('repo challenge is source-backed');
    expect(scoreValidity).toHaveTextContent('candidate/repo match proof is source-backed');
    expect(scoreValidity).toHaveTextContent('6 rubric dimensions · 2 evidence items · 5 scoring metrics');
    expect(scoreValidity).toHaveTextContent('This is evidence, not an automatic decision.');
    const basis = screen.getByTestId('person-code-review-decision-basis');
    expect(basis).toHaveTextContent('Decision basis');
    expect(basis).toHaveTextContent('Score report');
    expect(basis).toHaveTextContent('82/100 Strong');
    expect(basis).toHaveTextContent('Review transcript');
    expect(basis).toHaveTextContent('Captured');
    expect(basis).toHaveTextContent('Repo challenge');
    expect(basis).toHaveTextContent('pierre/diffs PR #95');
    expect(basis).toHaveTextContent('Match proof');
    expect(basis).toHaveTextContent('Source-backed match');
    expect(basis).not.toHaveTextContent('2 sources');

    const proof = screen.getByTestId('person-code-review-source-proof');
    const proofSummary = proof.querySelector('summary');
    expect(proofSummary).toHaveTextContent('Source proof');
    expect(proofSummary).toHaveTextContent('candidate-repo match proof, repo evidence, and scoring provenance');
    expect(proofSummary).not.toHaveTextContent('review-session-1');
    expect(proof).toHaveTextContent('Source proof');
    expect(proof).toHaveTextContent('score report');
    expect(proof).toHaveTextContent('82/100 Strong · 6 rubric dimensions · 2 evidence items · 5 scoring metrics');
    expect(proof).not.toHaveTextContent('"overall"');
    expect(proof).not.toHaveTextContent('"growth_areas"');
    expect(proof).toHaveTextContent('transcript segment');
    expect(screen.getByText('Decision evidence')).toBeInTheDocument();
    expect(screen.getByText('Background evidence')).toBeInTheDocument();
    expect(screen.getByText('Code-review assessment evidence')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open interaction' })).toBeInTheDocument();
    expect(screen.getByText('Resume evidence attached')).toBeInTheDocument();
    const coverage = screen.getByTestId('person-interaction-coverage');
    expect(coverage).toHaveTextContent('Evidence coverage');
    expect(coverage).toHaveTextContent('Person-level rollup from 2 evidence-producing interactions.');
    expect(coverage).toHaveTextContent('Open a row only when you need the single-meeting source record.');
    expect(coverage).toHaveTextContent('1 code review');
    expect(coverage).toHaveTextContent('1 resume');
    const mix = screen.getByTestId('person-evidence-mix');
    expect(mix).toHaveTextContent('Evidence mix');
    expect(mix).toHaveTextContent('Technical signal exists; conversation context is missing');
    expect(mix).toHaveTextContent('Use the code review and resume as source-backed signal, then add a focused call only for the calibration gaps.');
    expect(mix).toHaveTextContent('Next best source');
    expect(mix).toHaveTextContent('Schedule focused technical calibration');
    expect(coverage).not.toHaveTextContent('review-session-1');
    expect(coverage).not.toHaveTextContent('resume:review-evidence:63');
    const sourceAudit = screen.getByTestId('person-source-audit');
    expect(sourceAudit).not.toHaveAttribute('open');
    expect(screen.getByText('Evidence audit trail')).toBeVisible();
    expect(screen.getByText('2 records · 2 artifacts')).toBeVisible();
    expect(screen.getByText('Learned Context')).not.toBeVisible();
    expect(screen.getByText('Original Sources')).not.toBeVisible();
    fireEvent.click(screen.getByText('Evidence audit trail'));
    expect(sourceAudit).toHaveAttribute('open');
    expect(screen.getByText('Performance Signals')).toBeVisible();
    expect(screen.getByText('Learned Context')).toBeVisible();
    expect(screen.getByText('Original Sources')).toBeVisible();
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
    const params = new URLSearchParams((location.textContent ?? '').split('?')[1] ?? '');
    const recruiterNotes = params.get('recruiterNotes') ?? '';
    expect(recruiterNotes).toContain('PIPE person-profile next action');
    expect(recruiterNotes).toContain('Recommendation: Advance with focused probe');
    expect(recruiterNotes).toContain('Candidate signal: 82/100 Strong');
    expect(recruiterNotes).toContain('Score provenance: 6 rubric dimensions · 2 evidence items · 5 scoring metrics');
    expect(recruiterNotes).toContain('Repo challenge: pierre/diffs PR #95');
    expect(recruiterNotes).toContain('Assessment validity: Usable source-backed signal');
    expect(recruiterNotes).toContain('Missing context: Probe: Probe how they balance timing trade-offs under pushback.');
  });

  it('keeps technical decision evidence visible when operational interactions are noisy', async () => {
    const context = makeLivingContext();
    const operationalInteractions = Array.from({ length: 6 }, (_, index) => ({
      id: `interaction-invite-noise-${index + 1}`,
      interactionType: 'scheduled_interview_invite_delivery',
      externalReference: `invite-delivery-${index + 1}`,
      startedAt: `2026-06-29T1${index}:00:00.000Z`,
      endedAt: `2026-06-29T1${index}:01:00.000Z`,
      createdAt: `2026-06-29T1${index}:00:00.000Z`,
      updatedAt: `2026-06-29T1${index}:01:00.000Z`,
      metadata: {
        summary: `Invite delivery operational record ${index + 1}`,
        scheduledInterviewId: `interview-invite-noise-${index + 1}`,
      },
      artifactIds: [],
      contextRecordIds: [],
      assertionIds: [],
      signalKeys: [],
    }));
    context.summary = {
      ...context.summary,
      interactionCount: context.interactions.length + operationalInteractions.length,
    };
    context.interactions = [
      ...operationalInteractions,
      ...context.interactions,
    ];

    mocks.api.get
      .mockResolvedValueOnce({ contact: makeContact() })
      .mockResolvedValueOnce(context);

    renderPage();
    await flushAsyncUpdates();

    const coverage = screen.getByTestId('person-interaction-coverage');
    expect(coverage).toHaveTextContent('6 messages or invites');
    expect(coverage).toHaveTextContent('1 code review');
    expect(coverage).toHaveTextContent('1 resume');
    expect(coverage).toHaveTextContent('Showing 5 highest-value interaction rows before 3 lower-priority interactions kept in the audit trail.');
    expect(screen.getByText('Decision evidence')).toBeInTheDocument();
    expect(screen.getByText('Background evidence')).toBeInTheDocument();
    expect(screen.getByText('Code-review assessment evidence')).toBeInTheDocument();
    expect(screen.getByText('Resume evidence attached')).toBeInTheDocument();
    expect(screen.queryByText('Invite delivery operational record 1')).not.toBeInTheDocument();
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
    expect(cockpit).toHaveTextContent('Missing context');
    expect(cockpit).toHaveTextContent('Source-backed repo challenge selection');
    expect(cockpit).toHaveTextContent('1 more blocking gap');
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
    const scoreValidity = screen.getByTestId('person-code-review-score-validity');
    expect(scoreValidity).toHaveTextContent('Score validity');
    expect(scoreValidity).toHaveTextContent('Do not rely yet');
    expect(scoreValidity).toHaveTextContent('candidate/repo match proof is missing');
    expect(scoreValidity).toHaveTextContent('A score exists, but the supporting transcript, selected PR, or match provenance is incomplete.');
    const basis = screen.getByTestId('person-code-review-decision-basis');
    expect(basis).toHaveTextContent('Score report');
    expect(basis).toHaveTextContent('82/100 Strong');
    expect(basis).toHaveTextContent('Review transcript');
    expect(basis).toHaveTextContent('Captured');
    expect(basis).toHaveTextContent('Repo challenge');
    expect(basis).toHaveTextContent('Missing');
    expect(basis).toHaveTextContent('Match proof');
    expect(basis).toHaveTextContent('Missing');
  });

  it('shows pending code-review assignments as waiting for candidate review, not hiring signal', async () => {
    const context = makeLivingContext();
    context.contextRecords = context.contextRecords.filter((record) =>
      record.recordType === 'candidate_pr_match_decision'
    );
    context.summary = {
      ...context.summary,
      contextRecordCount: 1,
      sourceSpanCount: 2,
    };
    context.interactions = context.interactions.map((interaction) =>
      interaction.id === 'interaction-code-review'
        ? {
            ...interaction,
            metadata: {
              ...interaction.metadata,
              status: 'matched',
            },
            contextRecordIds: ['record-match'],
          }
        : interaction
    );

    mocks.api.get
      .mockResolvedValueOnce({ contact: makeContact() })
      .mockResolvedValueOnce(context);

    renderPage();
    await flushAsyncUpdates();

    const cockpit = screen.getByTestId('person-decision-cockpit');
    expect(cockpit).toHaveTextContent('Wait for candidate review');
    expect(cockpit).toHaveTextContent('No score signal yet');
    expect(cockpit).toHaveTextContent('do not make a hiring decision until the candidate submits source-backed review comments');
    expect(cockpit).toHaveTextContent('Candidate review transcript or source-backed review comments');
    expect(cockpit).toHaveTextContent('Wait for candidate submission');
    expect(screen.queryByTestId('person-next-action-cta')).not.toBeInTheDocument();

    const decision = screen.getByTestId('person-code-review-decision');
    expect(decision).toHaveTextContent('Code-review assignment');
    expect(decision).toHaveTextContent('Wait for candidate review');
    expect(decision).toHaveTextContent('No score signal yet');
    expect(decision).toHaveTextContent('Score report');
    expect(decision).toHaveTextContent('Missing');
    expect(decision).toHaveTextContent('Review evidence');
    expect(decision).toHaveTextContent('0 annotations');

    const mix = screen.getByTestId('person-evidence-mix');
    expect(mix).toHaveTextContent('Code-review assignment is waiting on candidate review');
    expect(mix).toHaveTextContent('technical assessment is missing candidate review comments and a score');
    expect(mix).toHaveTextContent('Wait for candidate review submission');
  });

  it('does not blend a newer related match-only interview into the completed code-review recommendation', async () => {
    const context = makeLivingContext();
    context.summary = {
      ...context.summary,
      interactionCount: 3,
      contextRecordCount: 4,
      sourceSpanCount: 6,
    };
    context.interactions = [
      {
        id: 'interaction-new-match-only',
        interactionType: 'code_review_assessment',
        externalReference: 'review-session-new-match-only',
        startedAt: '2026-06-29T15:00:00.000Z',
        endedAt: '2026-06-29T15:10:00.000Z',
        createdAt: '2026-06-29T15:00:00.000Z',
        updatedAt: '2026-06-29T15:10:00.000Z',
        metadata: {
          sessionId: 'review-session-new-match-only',
          scheduledInterviewId: 'interview-new-match-only',
          status: 'matched',
        },
        artifactIds: [],
        contextRecordIds: ['record-new-match-only'],
        assertionIds: [],
        signalKeys: [],
      },
      ...context.interactions,
    ];
    context.contextRecords = [
      ...context.contextRecords,
      contextRecord({
        id: 'record-new-match-only',
        interactionId: 'interaction-new-match-only',
        recordType: 'candidate_pr_match_decision',
        predicate: 'selects review challenge',
        narrative: 'Matched candidate candidate-1 to PR #101 from repo repo-new, but no score or transcript exists yet.',
        observedAt: '2026-06-29T15:10:00.000Z',
        qualifiers: {
          sessionId: 'review-session-new-match-only',
          status: 'MATCHED',
          selectedPacketId: 'challenge-packet-new',
          evaluatedChallenges: [{
            challengeId: 'challenge-packet-new',
            eligible: true,
            prNumber: 101,
            repoId: 'repo-new',
            rank: 1,
          }],
          validatorAgent: {
            sourceBridge: {
              challengeId: 'challenge-packet-new',
              prNumber: 101,
              repoId: 'repo-new',
              provenanceComplete: true,
            },
          },
        },
        entities: [{
          entityType: 'pull_request',
          entityId: 'repo-new#101',
          relationship: 'selected_pull_request',
          value: null,
          confidence: null,
          metadata: {
            prNumber: 101,
            repoId: 'repo-new',
          },
        }],
        sources: [
          genericSource({
            evidenceRole: 'selected_repo_evidence',
            locator: {
              repoFullName: 'react/noisy-related',
              repoUrl: 'https://github.com/react/noisy-related',
              prNumber: 101,
              matchStatus: 'MATCHED',
            },
            exactText: 'Related match evidence from https://github.com/react/noisy-related/pull/101 is not a completed review signal yet.',
          }),
        ],
      }),
    ];

    mocks.api.get
      .mockResolvedValueOnce({ contact: makeContact() })
      .mockResolvedValueOnce(context);

    renderPage();
    await flushAsyncUpdates();

    const cockpit = screen.getByTestId('person-decision-cockpit');
    expect(cockpit).toHaveTextContent('Current recommendation');
    expect(cockpit).toHaveTextContent('Advance with focused probe');

    const decision = await screen.findByTestId('person-code-review-decision');
    expect(decision).toHaveTextContent('pierre/diffs PR #95');
    expect(decision).toHaveTextContent('82/100 Strong');
    expect(decision).toHaveTextContent('Usable source-backed signal');
    expect(decision).not.toHaveTextContent('react/noisy-related');
    expect(decision).not.toHaveTextContent('PR #101');

    const coverage = screen.getByTestId('person-interaction-coverage');
    expect(coverage).toHaveTextContent('2 code reviews');
    expect(coverage).toHaveTextContent('1 resume');
  });

  it('treats weak graph-derived code-review scores as assignment-fairness decisions', async () => {
    const context = makeLivingContext();
    context.contextRecords = context.contextRecords.map((record) =>
      record.id === 'record-score'
        ? contextRecord({
            ...record,
            sources: [sourceSpan({
              exactText: JSON.stringify({
                overall: {
                  score: 42,
                  band: 'weak',
                  narrative: 'Candidate missed the core regression risk in the review.',
                  strengths: [],
                  growth_areas: ['Confirm whether the selected PR was fair for their React experience.'],
                },
                dimensions: {
                  source_accuracy: { score: 1 },
                  bug_detection: { score: 1 },
                  test_reasoning: { score: 1 },
                  risk_calibration: { score: 0 },
                  communication: { score: 1 },
                  ai_usage_judgment: { score: 1 },
                },
                evidence: [
                  { id: 'comment-1', text: 'Candidate missed the timing regression.' },
                  { id: 'pushback-1', text: 'Candidate did not defend the requested change.' },
                ],
                metrics: {
                  annotations: 1,
                  pushback_threads: 1,
                  source_refs: 4,
                  rubric_dimensions: 6,
                  score_confidence: 0.64,
                },
              }),
            })],
          })
        : record
    );

    mocks.api.get
      .mockResolvedValueOnce({ contact: makeContact() })
      .mockResolvedValueOnce(context);

    renderPage();
    await flushAsyncUpdates();

    const cockpit = screen.getByTestId('person-decision-cockpit');
    expect(cockpit).toHaveTextContent('Current recommendation');
    expect(cockpit).toHaveTextContent('Review assignment fairness before rejecting');
    expect(cockpit).toHaveTextContent('Assignment fairness risk');
    expect(cockpit).toHaveTextContent('Create fairness review');

    const decision = await screen.findByTestId('person-code-review-decision');
    expect(decision).toHaveTextContent('42/100 Weak');
    expect(decision).toHaveTextContent('Review assignment fairness before rejecting');
    expect(decision).toHaveTextContent('Check whether the repo challenge was well matched before treating the weak score as candidate signal.');
    expect(decision).not.toHaveTextContent('Do not advance from this signal yet');
  });

  it('does not call assignment-only code-review records candidate-repo match proof', async () => {
    const context = makeLivingContext();
    context.contextRecords = context.contextRecords.map((record) =>
      record.id === 'record-match'
        ? contextRecord({
            ...record,
            qualifiers: {
              ...record.qualifiers,
              validatorAgent: {
                sourceBridge: {
                  challengeId: 'challenge-packet-1',
                  prNumber: 95,
                  repoId: 'repo-1',
                  provenanceComplete: true,
                },
              },
            },
          })
        : record
    );

    mocks.api.get
      .mockResolvedValueOnce({ contact: makeContact() })
      .mockResolvedValueOnce(context);

    renderPage();
    await flushAsyncUpdates();

    const cockpit = screen.getByTestId('person-decision-cockpit');
    expect(cockpit).toHaveTextContent('Collect missing evidence');
    expect(cockpit).not.toHaveTextContent('Advance with focused probe');
    expect(cockpit).toHaveTextContent('Partial source-backed signal');
    expect(cockpit).toHaveTextContent('Repo-match proof incomplete');

    const basis = screen.getByTestId('person-code-review-decision-basis');
    expect(basis).toHaveTextContent('Match proof');
    expect(basis).toHaveTextContent('Assignment evidence only');
    expect(basis).not.toHaveTextContent('Source-backed match');

    const decision = await screen.findByTestId('person-code-review-decision');
    expect(decision).toHaveTextContent('Collect missing evidence');
    expect(decision).not.toHaveTextContent('Advance with focused probe');
    expect(decision).toHaveTextContent('Rendered candidate/repo source bridge');
    expect(decision).toHaveTextContent('PIPE has a visible repo challenge, but the rendered candidate-to-repo source bridge is missing from the person graph.');

    const proof = screen.getByTestId('person-code-review-source-proof');
    const proofSummary = proof.querySelector('summary');
    expect(proofSummary).toHaveTextContent('repo evidence, scoring provenance, and open gaps');
    expect(proofSummary).not.toHaveTextContent('candidate-repo match proof');
  });

  it('routes conversation-only profiles toward a code-review assessment next action', async () => {
    const context = makeLivingContext();
    context.summary = {
      ...context.summary,
      interactionCount: 1,
      artifactCount: 1,
      contextRecordCount: 0,
      sourceSpanCount: 1,
    };
    context.interactions = [{
      ...context.interactions[0]!,
      id: 'interaction-background-call',
      interactionType: 'context_call',
      externalReference: 'meeting-background-call',
      metadata: {
        meetingType: 'SCREENING_INTERVIEW',
        status: 'completed',
      },
      artifactIds: ['artifact-background-call'],
      contextRecordIds: [],
      assertionIds: [],
      signalKeys: [],
    }];
    context.contextRecords = [];
    context.artifacts = [{
      ...context.artifacts[0]!,
      id: 'artifact-background-call',
      interactionId: 'interaction-background-call',
      artifactType: 'meeting_transcript',
      logicalKey: 'meeting-background-call',
      sourceSpans: [sourceSpan({
        sourceSpanId: 'source-span-background-call',
        artifactType: 'meeting_transcript',
        artifactLogicalKey: 'meeting-background-call',
        evidenceRole: 'conversation_context',
        exactText: 'Discussed React platform ownership, but no code-review assessment has been assigned yet.',
      })],
    }];

    mocks.api.get
      .mockResolvedValueOnce({ contact: makeContact() })
      .mockResolvedValueOnce(context);

    renderPage();
    await flushAsyncUpdates();

    const mix = screen.getByTestId('person-evidence-mix');
    expect(mix).toHaveTextContent('Conversation context exists; technical assessment is missing');
    expect(mix).toHaveTextContent('Assign a source-backed technical assessment');

    const cta = screen.getByTestId('person-next-action-cta');
    expect(cta).toHaveTextContent('Create code-review assessment');
    fireEvent.click(cta);

    const location = screen.getByTestId('location-echo');
    expect(location).toHaveTextContent('/interviews?');
    expect(location).toHaveTextContent('new=1');
    expect(location).toHaveTextContent('interviewType=CODE_REVIEW');
    const params = new URLSearchParams((location.textContent ?? '').split('?')[1] ?? '');
    const recruiterNotes = params.get('recruiterNotes') ?? '';
    expect(recruiterNotes).toContain('Next action: Assign a source-backed technical assessment');
    expect(recruiterNotes).toContain('Reason: Use existing conversation evidence to assign a source-backed code-review or workspace challenge.');
  });

  it('derives a person-level hiring decision from source-backed workspace assessment claims', async () => {
    mocks.api.get
      .mockResolvedValueOnce({ contact: makeContact() })
      .mockResolvedValueOnce(makeWorkspaceAssessmentContext());

    renderPage();
    await flushAsyncUpdates();

    const cockpit = screen.getByTestId('person-decision-cockpit');
    expect(cockpit).toHaveTextContent('Current recommendation');
    expect(cockpit).toHaveTextContent('Advance from human-reviewed assessment');
    expect(cockpit).toHaveTextContent('Assessment validity');
    expect(cockpit).toHaveTextContent('Usable source-backed signal from workspace assessment');
    expect(cockpit).toHaveTextContent('Uncertainty');
    expect(cockpit).toHaveTextContent('Low remaining uncertainty');
    expect(cockpit).toHaveTextContent('Missing context');
    expect(cockpit).toHaveTextContent('No blocking evidence gap');
    expect(cockpit).toHaveTextContent('Next action');
    expect(cockpit).toHaveTextContent('Review with hiring team');

    const decision = await screen.findByTestId('person-code-review-decision');
    expect(decision).toHaveTextContent('Workspace assessment decision');
    expect(decision).toHaveTextContent('Advance from human-reviewed assessment');
    expect(decision).toHaveTextContent('Human reviewer advances after checking the source-backed evaluation report.');
    expect(decision).toHaveTextContent('Candidate addressed the impatient click issue with a focused patch and regression tests.');
    expect(decision).toHaveTextContent('The candidate fixed the impatient popover click path with a focused source-backed diff.');
    expect(decision).toHaveTextContent('The submitted test evidence covers the popover trigger regression.');
    expect(decision).toHaveTextContent('3 source-backed proof items');
    expect(decision).not.toHaveTextContent('source-less person-profile praise');
    const basis = screen.getByTestId('person-code-review-decision-basis');
    expect(basis).toHaveTextContent('Evaluation claims');
    expect(basis).toHaveTextContent('2 positive');
    expect(basis).not.toHaveTextContent('3 positive');
    expect(basis).toHaveTextContent('Human decision');
    expect(basis).toHaveTextContent('Advance');
    expect(basis).toHaveTextContent('Source proof');
    expect(basis).toHaveTextContent('Assessment mode');
    expect(basis).not.toHaveTextContent('Match proof');
    expect(decision).not.toHaveTextContent('Collect first source-backed evidence');
  });

  it('renders a person cockpit from living context when the legacy contact record is unavailable', async () => {
    mocks.api.get
      .mockRejectedValueOnce(new Error('HTTP 404: not_found'))
      .mockResolvedValueOnce(makeWorkspaceAssessmentContext());

    renderPage();
    await flushAsyncUpdates();

    expect(screen.queryByText('HTTP 404: not_found')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Ada Reviewer' })).toBeInTheDocument();
    const cockpit = screen.getByTestId('person-decision-cockpit');
    expect(cockpit).toHaveTextContent('Advance from human-reviewed assessment');
    expect(cockpit).toHaveTextContent('Usable source-backed signal from workspace assessment');
    expect(screen.getByTestId('person-code-review-decision')).toHaveTextContent('Workspace assessment decision');
  });

  it('falls back to candidate living context when the routed person id is not a legacy contact', async () => {
    mocks.api.get
      .mockRejectedValueOnce(new Error('HTTP 404: contact_not_found'))
      .mockRejectedValueOnce(new Error('HTTP 404: person_context_not_found'))
      .mockResolvedValueOnce({ livingContext: makeWorkspaceAssessmentContext() });

    renderPage({ candidateId: 'candidate-1' });
    await flushAsyncUpdates();

    expect(mocks.api.get).toHaveBeenCalledWith('/api/v1/candidates/candidate-1/living-context');
    expect(screen.queryByText('HTTP 404: person_context_not_found')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Ada Reviewer' })).toBeInTheDocument();
    expect(screen.getByTestId('person-decision-cockpit')).toHaveTextContent('Advance from human-reviewed assessment');
  });

  it('uses selected interview assessment evidence when the person graph rollup has not ingested the assessment yet', async () => {
    const graphOnlyContext = makeLivingContext();
    graphOnlyContext.contextRecords = [];
    graphOnlyContext.summary = {
      ...graphOnlyContext.summary,
      contextRecordCount: 0,
      sourceSpanCount: 2,
    };
    mocks.api.get
      .mockResolvedValueOnce({ contact: makeContact() })
      .mockResolvedValueOnce(graphOnlyContext);

    renderPage({ selectedAssessment: makeSelectedAssessmentProgress() });
    await flushAsyncUpdates();

    const cockpit = screen.getByTestId('person-decision-cockpit');
    expect(cockpit).toHaveTextContent('Advance');
    expect(cockpit).toHaveTextContent('Usable source-backed signal from workspace assessment');
    expect(cockpit).toHaveTextContent('Graph rollup pending');
    expect(screen.getByTestId('person-interaction-coverage')).toHaveTextContent('1 code review');
    expect(screen.getByText('Decision evidence')).toBeInTheDocument();
    const decision = screen.getByTestId('person-code-review-decision');
    expect(decision).toHaveTextContent('Workspace assessment decision');
    expect(decision).toHaveTextContent('Candidate addressed the impatient click issue');
    expect(decision).toHaveTextContent('Score provenance');
    expect(decision).toHaveTextContent('1 rubric dimension · 4 evidence items · 3 scoring metrics');
    expect(decision).toHaveTextContent('source-backed proof items');
    expect(decision).not.toHaveTextContent('selected-assessment source-less praise');
  });

  it('does not trust malformed selected assessment route-state evidence counts', async () => {
    const graphOnlyContext = makeLivingContext();
    graphOnlyContext.contextRecords = [];
    graphOnlyContext.summary = {
      ...graphOnlyContext.summary,
      contextRecordCount: 0,
      sourceSpanCount: 2,
    };
    mocks.api.get
      .mockResolvedValueOnce({ contact: makeContact() })
      .mockResolvedValueOnce(graphOnlyContext);

    renderPage({
      selectedAssessment: {
        ...(makeSelectedAssessmentProgress() as unknown as Record<string, unknown>),
        sourceRefCounts: '99 refs',
        evidenceSnippets: null,
        evaluation: {
          id: 'evaluation-stale',
          status: 'EVALUATED',
          summary: 'Malformed route state should not create source proof.',
          recommendation: 'advance',
          createdAt: '2026-06-30T14:25:00.000Z',
          claims: null,
          diagnostics: null,
        },
      },
    });
    await flushAsyncUpdates();

    const decision = screen.getByTestId('person-code-review-decision');
    expect(decision).toHaveTextContent('Workspace assessment decision');
    expect(decision).toHaveTextContent('0 source-backed proof items');
    expect(decision).not.toHaveTextContent('99 refs');
    expect(decision).not.toHaveTextContent('99 source-backed proof items');
    const basis = screen.getByTestId('person-code-review-decision-basis');
    expect(basis).toHaveTextContent('Source proof');
    expect(basis).toHaveTextContent('Missing');
  });

  it('shows a visible profile error instead of spinning forever when the person id is missing', async () => {
    renderPageWithoutPersonId();
    await flushAsyncUpdates();

    expect(screen.queryByText('Loading person context...')).not.toBeInTheDocument();
    expect(screen.getByText('Missing person id for this profile.')).toBeInTheDocument();
    expect(mocks.api.get).not.toHaveBeenCalled();
  });
});
