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
        checks: ['candidate_source_evidence', 'repo_source_spans', 'role_context_alignment'],
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
    expect(why).toHaveTextContent('WHY_THIS_PR');
    expect(why).toHaveTextContent('PERSON_ROLE_REPO');
    const readableReason = screen.getByTestId('code-review-match-readable-reason');
    expect(readableReason).toHaveTextContent('MATCH_REASON');
    expect(readableReason).toHaveTextContent('We selected this PR because the source evidence points at typescript');
    expect(why).toHaveTextContent('Candidate evidence');
    expect(why).toHaveTextContent('Role requirement');
    expect(why).toHaveTextContent('Repo challenge');
    expect(why).toHaveTextContent('Implemented workflow conflict warning copy');
    expect(why).toHaveTextContent('Review TypeScript PRs that improve Wrangler deploy warnings');
    expect(why).toHaveTextContent('Workflow names must be unique per account.');

    const assessmentFocus = screen.getByTestId('code-review-assessment-focus');
    expect(assessmentFocus).toHaveTextContent('ASSESSMENT_FOCUS');
    expect(assessmentFocus).toHaveTextContent('Skill/stack overlap');
    expect(assessmentFocus).toHaveTextContent('PR reviewability');
    expect(assessmentFocus).toHaveTextContent('TypeScript review evidence matches the PR stack');
    expect(assessmentFocus).toHaveTextContent('concrete behavioral decision');
    expect(assessmentFocus).toHaveTextContent('typescript');

    const hyperedges = screen.getByTestId('code-review-match-hyperedges');
    expect(hyperedges).toHaveTextContent('EVIDENCE_HYPEREDGES');
    expect(within(hyperedges).getByText('PERSON EVIDENCE')).toBeTruthy();
    expect(within(hyperedges).getByText('ROLE SOURCE')).toBeTruthy();
    expect(within(hyperedges).getByText('REPO CHALLENGE')).toBeTruthy();
    expect(hyperedges).toHaveTextContent('Implemented workflow conflict warning copy');
    expect(hyperedges).toHaveTextContent('Review TypeScript PRs that improve Wrangler deploy warnings');
    expect(hyperedges).toHaveTextContent('Workflow names must be unique per account.');
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
    expect(why).toHaveTextContent('WHY_THIS_PR');
    expect(why).toHaveTextContent('CANDIDATE_REPO');
    expect(screen.getByTestId('code-review-match-readable-reason')).toHaveTextContent(
      'this PR asks you to review those decisions in real code',
    );
    expect(why).toHaveTextContent('Role context was not supplied');
    expect(why).toHaveTextContent('Implemented popover trigger click handling');
    expect(why).toHaveTextContent('Ignore impatient trigger clicks');

    const hyperedges = screen.getByTestId('code-review-match-hyperedges');
    expect(hyperedges).toHaveTextContent('CANDIDATE_REPO');
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
});
