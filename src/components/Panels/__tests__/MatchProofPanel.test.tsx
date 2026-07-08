import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MatchProofPanel, type CodeReviewMatchExplanation } from '../ProblemPanel';

describe('MatchProofPanel', () => {
  it('renders source-backed evidence hyperedges for recruiter and candidate trust', () => {
    const matchExplanation: CodeReviewMatchExplanation = {
      status: 'MATCHED',
      summary: 'Matched 2 source-backed demands.',
      score: 0.82,
      candidateSourceCount: 1,
      repoSourceCount: 1,
      roleSourceCount: 1,
      qualityGate: {
        verdict: 'PASSED',
        checks: [
          { id: 'candidate_source_evidence', passed: true, reason: 'Candidate source evidence is present.' },
          { id: 'repo_source_spans', passed: true, reason: 'Repo source spans are present.' },
          'role_context_alignment',
        ],
      },
      assessmentQuality: {
        verdict: 'STRONG',
        score: 10,
        maxScore: 12,
        metrics: [
          {
            id: 'skill_stack_overlap',
            label: 'Skill/stack overlap',
            score: 2,
            maxScore: 2,
            reason: 'TypeScript review evidence matches the PR stack and changed workflow code.',
          },
          {
            id: 'pr_reviewability',
            label: 'PR reviewability',
            score: 2,
            maxScore: 2,
            reason: 'The diff contains a concrete behavioral decision with regression-test implications.',
          },
        ],
      },
      evidence: [],
      evidenceHyperedges: [
        {
          relation: 'candidate_role_repo_alignment',
          label: 'Evidence bridge 1',
          pairScore: 0.91,
          nodes: [
            {
              kind: 'person_evidence',
              label: 'Person evidence',
              sourceRef: {
                exactText: 'Implemented workflow conflict warning copy',
                locator: 'resume:span-1',
              },
            },
            {
              kind: 'role_source',
              label: 'Role source',
              sourceRef: {
                exactText: 'Review TypeScript PRs that improve Wrangler deploy warnings',
                locator: 'role:jd-1',
                conceptKeys: ['term:typescript'],
              },
            },
            {
              kind: 'repo_challenge',
              label: 'Repo challenge',
              sourceRef: {
                exactText: 'Workflow names must be unique per account.',
                locator: 'repo:span-1',
              },
            },
          ],
        },
      ],
    };

    render(<MatchProofPanel matchExplanation={matchExplanation} />);

    const why = screen.getByTestId('code-review-match-why');
    expect(why).toHaveTextContent('The match in plain language');
    expect(why).not.toHaveTextContent('PERSON_ROLE_REPO');
    const readableReason = screen.getByTestId('code-review-match-readable-reason');
    expect(readableReason).toHaveTextContent('Summary');
    expect(readableReason).toHaveTextContent('We selected this PR because the source evidence points at typescript');
    expect(why).toHaveTextContent('Candidate evidence');
    expect(why).toHaveTextContent('Role requirement');
    expect(why).toHaveTextContent('Repo challenge');
    expect(why).toHaveTextContent('Implemented workflow conflict warning copy');
    expect(why).toHaveTextContent('Review TypeScript PRs that improve Wrangler deploy warnings');
    expect(why).toHaveTextContent('Workflow names must be unique per account.');

    const assessmentFocus = screen.getByTestId('code-review-assessment-focus');
    expect(assessmentFocus).toHaveTextContent('What this review focuses on');
    expect(assessmentFocus).toHaveTextContent('Skill/stack overlap');
    expect(assessmentFocus).toHaveTextContent('PR reviewability');
    expect(assessmentFocus).toHaveTextContent('TypeScript review evidence matches the PR stack');
    expect(assessmentFocus).toHaveTextContent('concrete behavioral decision');
    expect(assessmentFocus).toHaveTextContent('typescript');
    expect(screen.getAllByText('Candidate evidence').length).toBeGreaterThan(0);
    expect(screen.getByText('Repo source spans')).toBeTruthy();
    expect(screen.getByText('Role alignment')).toBeTruthy();

    const hyperedges = screen.getByTestId('code-review-match-hyperedges');
    expect(hyperedges).toHaveTextContent('Supporting evidence');
    expect(within(hyperedges).getByText('From your profile')).toBeTruthy();
    expect(within(hyperedges).getByText('From the role')).toBeTruthy();
    expect(within(hyperedges).getByText('From the repo')).toBeTruthy();
    expect(hyperedges).toHaveTextContent('Implemented workflow conflict warning copy');
    expect(hyperedges).toHaveTextContent('Review TypeScript PRs that improve Wrangler deploy warnings');
    expect(hyperedges).toHaveTextContent('Workflow names must be unique per account.');
    expect(why).not.toHaveTextContent(/WHY_THIS_PR|PERSON_ROLE_REPO|MATCH_REASON/);
    expect(assessmentFocus).not.toHaveTextContent('ASSESSMENT_FOCUS');
    expect(hyperedges).not.toHaveTextContent('EVIDENCE_HYPEREDGES');
  });

  it('labels roleless evidence hyperedges as candidate-to-repo matches', () => {
    const matchExplanation: CodeReviewMatchExplanation = {
      status: 'MATCHED',
      summary: 'Matched source-backed candidate evidence to a reviewable PR.',
      score: 0.68,
      candidateSourceCount: 1,
      repoSourceCount: 1,
      roleSourceCount: 0,
      qualityGate: {
        verdict: 'PASSED',
        checks: ['candidate_source_evidence', 'repo_source_spans'],
      },
      evidence: [],
      evidenceHyperedges: [
        {
          relation: 'candidate_repo_evidence_alignment',
          label: 'Candidate evidence bridge 1',
          pairScore: 0.74,
          nodes: [
            {
              kind: 'person_evidence',
              label: 'Person evidence',
              sourceRef: {
                exactText: 'Implemented popover trigger click handling in usePopoverRoot.',
                locator: 'resume:span-1',
                conceptKeys: ['term:popover', 'term:click'],
              },
            },
            {
              kind: 'repo_challenge',
              label: 'Repo challenge',
              sourceRef: {
                exactText: 'Ignore impatient trigger clicks within 500ms.',
                locator: 'packages/react/src/popover/root/usePopoverRoot.ts',
                conceptKeys: ['term:popover', 'term:click'],
              },
            },
          ],
        },
      ],
    };

    render(<MatchProofPanel matchExplanation={matchExplanation} />);

    const why = screen.getByTestId('code-review-match-why');
    expect(why).toHaveTextContent('The match in plain language');
    expect(why).not.toHaveTextContent('CANDIDATE_REPO');
    expect(screen.getByTestId('code-review-match-readable-reason')).toHaveTextContent(
      'this PR asks you to review those decisions in real code',
    );
    expect(why).toHaveTextContent('Role context was not supplied');
    expect(why).toHaveTextContent('Implemented popover trigger click handling');
    expect(why).toHaveTextContent('Ignore impatient trigger clicks');

    const hyperedges = screen.getByTestId('code-review-match-hyperedges');
    expect(hyperedges).not.toHaveTextContent('CANDIDATE_REPO');
    expect(hyperedges).not.toHaveTextContent('PERSON_ROLE_REPO');
    expect(hyperedges).toHaveTextContent('Implemented popover trigger click handling');
    expect(hyperedges).toHaveTextContent('Ignore impatient trigger clicks');
  });

  it('explains manual overrides without claiming candidate CV fit', () => {
    const matchExplanation: CodeReviewMatchExplanation = {
      status: 'MATCHED',
      summary: 'Manual override: recruiter-selected source-backed review challenge.',
      score: 0.9,
      candidateSourceCount: 0,
      repoSourceCount: 1,
      roleSourceCount: 0,
      qualityGate: {
        verdict: 'PASSED',
        checks: ['repo_source_spans', 'source_backed_manual_override'],
      },
      assessmentQuality: {
        verdict: 'USABLE',
        score: 8,
        maxScore: 12,
        metrics: [],
      },
      evidence: [],
      evidenceHyperedges: [],
    };

    render(<MatchProofPanel matchExplanation={matchExplanation} />);

    const readableReason = screen.getByTestId('code-review-match-readable-reason');
    expect(readableReason).toHaveTextContent('A recruiter selected this PR');
    expect(readableReason).toHaveTextContent('source-backed review packet');
    expect(readableReason).toHaveTextContent('without claiming CV fit');
    expect(readableReason).not.toHaveTextContent('your profile evidence maps');
  });

  it('surfaces source-backed match diagnostics separately from passing proof checks', () => {
    const matchExplanation: CodeReviewMatchExplanation = {
      status: 'MATCHED',
      summary: 'Embedding recall selected a challenge without source-backed alignment.',
      score: 0.7,
      candidateSourceCount: 0,
      repoSourceCount: 0,
      roleSourceCount: 0,
      qualityGate: {
        verdict: 'NEEDS_REVIEW',
        checks: ['assessment_quality_verified'],
        diagnostics: [
          'MISSING_CANDIDATE_SOURCE_EVIDENCE',
          'MISSING_REPO_SOURCE_EVIDENCE',
          'EMBEDDING_ONLY_MATCH_REJECTED',
        ],
      },
      evidence: [],
      evidenceHyperedges: [],
    };

    render(<MatchProofPanel matchExplanation={matchExplanation} />);

    expect(screen.getByText('Assessment quality')).toBeTruthy();

    const diagnostics = screen.getByTestId('code-review-match-diagnostics');
    expect(diagnostics).toHaveTextContent('Missing Candidate Source Evidence');
    expect(diagnostics).toHaveTextContent('Missing Repo Source Evidence');
    expect(diagnostics).toHaveTextContent('Embedding Only Match Rejected');
    expect(diagnostics).not.toHaveTextContent(/MISSING_CANDIDATE_SOURCE_EVIDENCE|MISSING_REPO_SOURCE_EVIDENCE|EMBEDDING_ONLY_MATCH_REJECTED/);
  });
});
