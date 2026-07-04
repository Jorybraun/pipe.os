import { describe, expect, it } from 'vitest';

import {
  buildDeterministicAssessmentFallback,
  parseAiJson,
  type SessionSourceRef,
} from '../repoTaskAssessmentEvaluator';

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sourceRef(input: {
  type: string;
  id: string;
  role?: string;
  exactText: string;
  sequence?: number;
  locator?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}): Promise<SessionSourceRef> {
  return {
    eventId: `event-${input.sequence ?? 1}`,
    eventKind: 'commit_submission',
    eventSequence: input.sequence ?? 1,
    key: `${input.type}:${input.id}:${input.role ?? 'support'}:`,
    sourceRefType: input.type,
    sourceRefId: input.id,
    evidenceRole: input.role ?? 'support',
    locator: input.locator,
    exactText: input.exactText,
    contentHash: await sha256Hex(input.exactText),
    metadata: input.metadata,
  };
}

describe('repo task assessment evaluator output parsing', () => {
  it('builds conservative source-backed fallback claims when model claims are unusable', async () => {
    const requestText = 'Recruiter requested source-backed evaluation.';
    const fallback = buildDeterministicAssessmentFallback({
      sessionId: 'assessment-session-fallback',
      requestSourceRef: {
        sourceRefType: 'assessment_evaluation_request',
        sourceRefId: 'request-1',
        exactText: requestText,
        contentHash: await sha256Hex(requestText),
      },
      sourceRefs: [
        await sourceRef({
          type: 'open_source_challenge_packet',
          id: 'challenge-1',
          role: 'assigned_challenge',
          sequence: 1,
          exactText: [
            'Repo: https://github.com/mui/base-ui',
            'Base commit: 58dff8444fa56e4444a3a1dd991c76b49cf4ab7e',
            'Task: Fix Base UI popover impatient click handling',
            'Success criteria:',
            '- Change popover behavior.',
            'Expected evidence:',
            '- git_commit',
            '- code_diff',
          ].join('\n'),
        }),
        await sourceRef({
          type: 'git_commit',
          id: '81c11363a3b6e31b34b3777fd150de7fe462c64f',
          sequence: 2,
          exactText: 'commit 81c11363a3b6e31b34b3777fd150de7fe462c64f\nfix popover impatient click handling',
        }),
        await sourceRef({
          type: 'code_diff',
          id: 'base..head',
          sequence: 2,
          exactText: 'diff --git a/packages/react/src/popover/root/usePopoverRoot.ts b/packages/react/src/popover/root/usePopoverRoot.ts\n+PATIENT_CLICK_THRESHOLD',
        }),
        await sourceRef({
          type: 'test_run',
          id: 'verification-1',
          sequence: 2,
          exactText: '$ git diff --check HEAD~1 HEAD\nexitCode: 0',
        }),
        await sourceRef({
          type: 'ai_user_prompt',
          id: 'prompt-1',
          sequence: 2,
          exactText: 'Can you inspect why the popover closes on impatient clicks before I change the hook?',
        }),
        await sourceRef({
          type: 'ai_agent_response',
          id: 'agent-response-1',
          sequence: 2,
          exactText: 'The issue appears to be in usePopoverRoot.ts where the close handler does not guard patient click timing.',
        }),
        await sourceRef({
          type: 'upstream_pull_request',
          id: 'https://github.com/mui/base-ui/pull/973',
          role: 'optional_upstream_pr_tracking',
          sequence: 2,
          exactText: 'https://github.com/mui/base-ui/pull/973',
        }),
        await sourceRef({
          type: 'terminal_command',
          id: 'finalizer-1',
          sequence: 2,
          exactText: '$ git diff --check HEAD~1 HEAD',
        }),
        await sourceRef({
          type: 'room_chat_message',
          id: 'chat-1',
          sequence: 2,
          exactText: 'Candidate: I kept the change scoped to the popover root hook because the impatient click failure is isolated there.',
        }),
      ],
    });

    expect(fallback).not.toBeNull();
    expect(fallback?.summary).toContain('Fix Base UI popover impatient click handling');
    expect(fallback?.summary).toContain('successful verification');
    expect(fallback?.summary).toContain('AI-use trail captured');
    expect(fallback?.summary).toContain('conversation context captured');
    expect(fallback?.recommendation).toBe('mixed_evidence_human_review');
    expect(fallback?.claims).toEqual(expect.arrayContaining([
      expect.objectContaining({
        polarity: 'positive',
        dimension: 'source_provenance',
      }),
      expect.objectContaining({
        polarity: 'positive',
        dimension: 'verification',
      }),
      expect.objectContaining({
        polarity: 'positive',
        dimension: 'ai_use_observability',
        narrative: 'Candidate AI-assistance prompts and agent responses are captured as real source evidence for review.',
      }),
      expect.objectContaining({
        polarity: 'positive',
        dimension: 'upstream_pr_tracking',
        narrative: 'Candidate-approved upstream pull request tracking is captured for reviewer inspection.',
      }),
      expect.objectContaining({
        polarity: 'positive',
        dimension: 'communication_context',
        narrative: 'Candidate explanation or room conversation context is captured as source evidence for review.',
      }),
    ]));
    expect(fallback?.claims.every((claim) => (claim.sourceRefs?.length ?? 0) > 0)).toBe(true);
    expect(fallback?.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'MODEL_CLAIMS_UNUSABLE', severity: 'warning' }),
      expect.objectContaining({ code: 'HUMAN_CORRECTNESS_REVIEW_REQUIRED', severity: 'warning' }),
    ]));
  });

  it('makes missing test evidence explicit in deterministic fallback reports', async () => {
    const requestText = 'Recruiter requested source-backed evaluation.';
    const fallback = buildDeterministicAssessmentFallback({
      sessionId: 'assessment-session-no-tests',
      requestSourceRef: {
        sourceRefType: 'assessment_evaluation_request',
        sourceRefId: 'request-no-tests',
        exactText: requestText,
        contentHash: await sha256Hex(requestText),
      },
      sourceRefs: [
        await sourceRef({
          type: 'open_source_challenge_packet',
          id: 'challenge-no-tests',
          role: 'assigned_challenge',
          sequence: 1,
          exactText: [
            'Repo: https://github.com/mui/base-ui',
            'Base commit: 58dff8444fa56e4444a3a1dd991c76b49cf4ab7e',
            'Task: Fix Base UI popover impatient click handling',
            'Success criteria:',
            '- Change popover behavior.',
            'Expected evidence:',
            '- git_commit',
            '- code_diff',
            '- test_run',
          ].join('\n'),
        }),
        await sourceRef({
          type: 'git_commit',
          id: '81c11363a3b6e31b34b3777fd150de7fe462c64f',
          sequence: 2,
          exactText: 'commit 81c11363a3b6e31b34b3777fd150de7fe462c64f\nfix popover impatient click handling',
        }),
        await sourceRef({
          type: 'code_diff',
          id: 'base..head',
          sequence: 2,
          exactText: 'diff --git a/packages/react/src/popover/root/usePopoverRoot.ts b/packages/react/src/popover/root/usePopoverRoot.ts\n+PATIENT_CLICK_THRESHOLD',
        }),
      ],
    });

    expect(fallback).not.toBeNull();
    expect(fallback?.summary).toContain('test evidence missing');
    expect(fallback?.claims).toEqual(expect.not.arrayContaining([
      expect.objectContaining({ dimension: 'verification' }),
    ]));
    expect(fallback?.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'MISSING_TEST_EVIDENCE', severity: 'warning' }),
    ]));
  });

  it('preserves declared verification gaps without creating positive verification claims', async () => {
    const requestText = 'Recruiter requested source-backed evaluation.';
    const fallback = buildDeterministicAssessmentFallback({
      sessionId: 'assessment-session-verification-gap',
      requestSourceRef: {
        sourceRefType: 'assessment_evaluation_request',
        sourceRefId: 'request-verification-gap',
        exactText: requestText,
        contentHash: await sha256Hex(requestText),
      },
      sourceRefs: [
        await sourceRef({
          type: 'open_source_challenge_packet',
          id: 'challenge-verification-gap',
          role: 'assigned_challenge',
          sequence: 1,
          exactText: [
            'Repo: https://github.com/mui/base-ui',
            'Base commit: 58dff8444fa56e4444a3a1dd991c76b49cf4ab7e',
            'Task: Fix Base UI popover impatient click handling',
            'Success criteria:',
            '- Change popover behavior.',
            'Expected evidence:',
            '- git_commit',
            '- code_diff',
            '- test_run or verification_gap',
          ].join('\n'),
        }),
        await sourceRef({
          type: 'git_commit',
          id: '81c11363a3b6e31b34b3777fd150de7fe462c64f',
          sequence: 2,
          exactText: 'commit 81c11363a3b6e31b34b3777fd150de7fe462c64f\nfix popover impatient click handling',
        }),
        await sourceRef({
          type: 'code_diff',
          id: 'base..head',
          sequence: 2,
          exactText: 'diff --git a/packages/react/src/popover/root/usePopoverRoot.ts b/packages/react/src/popover/root/usePopoverRoot.ts\n+PATIENT_CLICK_THRESHOLD',
        }),
        await sourceRef({
          type: 'verification_gap',
          id: 'verification-gap-1',
          role: 'missing_test_evidence_note',
          sequence: 2,
          exactText: 'Browser e2e could not run because Playwright browser install is missing in this assessment container.',
        }),
      ],
    });

    expect(fallback).not.toBeNull();
    expect(fallback?.summary).toContain('verification gap declared');
    expect(fallback?.summary).toContain('test output missing');
    expect(fallback?.claims).toEqual(expect.not.arrayContaining([
      expect.objectContaining({ dimension: 'verification' }),
    ]));
    expect(fallback?.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'VERIFICATION_GAP_DECLARED',
        severity: 'warning',
        sourceRefs: [
          expect.objectContaining({
            sourceRefType: 'verification_gap',
            sourceRefId: 'verification-gap-1',
          }),
        ],
      }),
    ]));
    expect(fallback?.diagnostics).toEqual(expect.not.arrayContaining([
      expect.objectContaining({ code: 'MISSING_TEST_EVIDENCE' }),
    ]));
  });

  it('preserves PIPE-matched challenge provenance in deterministic fallback reports', async () => {
    const requestText = 'Recruiter requested source-backed evaluation.';
    const fallback = buildDeterministicAssessmentFallback({
      sessionId: 'assessment-session-matched-assignment',
      requestSourceRef: {
        sourceRefType: 'assessment_evaluation_request',
        sourceRefId: 'request-matched',
        exactText: requestText,
        contentHash: await sha256Hex(requestText),
      },
      sourceRefs: [
        await sourceRef({
          type: 'review_challenge_packet',
          id: 'challenge-packet-973',
          role: 'assigned_challenge',
          sequence: 1,
          locator: {
            matchedRepoId: 973,
            repositoryUrl: 'https://github.com/mui/base-ui',
            baseCommitSha: '58dff8444fa56e4444a3a1dd991c76b49cf4ab7e',
            githubPrNumber: 973,
          },
          metadata: {
            source: 'matched_review_challenge_packet',
            qualityScore: 0.91,
          },
          exactText: [
            'Repo: https://github.com/mui/base-ui',
            'Base commit: 58dff8444fa56e4444a3a1dd991c76b49cf4ab7e',
            'Pull request: #973',
            'Task: Fix Base UI popover impatient click handling',
            'Match proof:',
            '- Review packet quality 0.91.',
            '- Demand families: popover, pointer interaction.',
            'Success criteria:',
            '- Change popover behavior.',
            'Expected evidence:',
            '- git_commit',
            '- code_diff',
            '- test_run',
          ].join('\n'),
        }),
        await sourceRef({
          type: 'git_commit',
          id: '81c11363a3b6e31b34b3777fd150de7fe462c64f',
          sequence: 2,
          exactText: 'commit 81c11363a3b6e31b34b3777fd150de7fe462c64f\nfix popover impatient click handling',
        }),
        await sourceRef({
          type: 'code_diff',
          id: 'base..head',
          sequence: 2,
          exactText: 'diff --git a/packages/react/src/popover/root/usePopoverRoot.ts b/packages/react/src/popover/root/usePopoverRoot.ts\n+PATIENT_CLICK_THRESHOLD',
        }),
      ],
    });

    expect(fallback).not.toBeNull();
    expect(fallback?.summary).toContain('PIPE-matched challenge packet');
    expect(fallback?.claims).toEqual(expect.arrayContaining([
      expect.objectContaining({
        polarity: 'positive',
        dimension: 'assignment_fit_provenance',
        narrative: 'The assigned challenge packet preserves source-backed PIPE match proof for reviewer calibration.',
      }),
    ]));
  });

  it('salvages complete source-cited claims from a truncated JSON response', () => {
    const output = parseAiJson(`{
  "summary": "The candidate implemented impatient click handling in the Popover component by modifying the root hook, constants, and tests.",
  "recommendation": "mixed_evidence_human_review",
  "claims": [
    {
      "id": "impatient-click-implementation",
      "polarity": "positive",
      "dimension": "implementation_correctness",
      "narrative": "The candidate introduced PATIENT_CLICK_THRESHOLD to address the impatient click handling requirement in the Popover root hook.",
      "confidence": 1,
      "sourceRefKeys": [
        "code_diff:base..head:submitted_diff:"
      ]
    },
    {
      "id": "targeted-file-changes",
      "polarity": "positive",
      "dimension": "source_comprehension",
      "narrative": "The changes appropriately target the root hook, constants, and relevant test files identified in the task context.",
      "confidence": 1,
      "sourceRefKeys": [
        "review_challenge_packet:challenge_packet_123:assigned_challenge:",
        "test_run:head:test-run:verification_test_output:"
      ]
    }
  ],
  "diagnostics": [
    {
      "code": "MISSING_TEST_EVIDENCE",
      "severity": "warning",
      "message": "Test output only confirms whitespace and file listing checks, not functional test execution.",
      "sourceRefKeys": [
        "test_run:head:test-run:verification_test`);

    expect(output).toMatchObject({
      summary: 'The candidate implemented impatient click handling in the Popover component by modifying the root hook, constants, and tests.',
      recommendation: 'mixed_evidence_human_review',
      claims: [
        {
          id: 'impatient-click-implementation',
          polarity: 'positive',
          dimension: 'implementation_correctness',
          sourceRefKeys: ['code_diff:base..head:submitted_diff:'],
        },
        {
          id: 'targeted-file-changes',
          polarity: 'positive',
          dimension: 'source_comprehension',
          sourceRefKeys: [
            'review_challenge_packet:challenge_packet_123:assigned_challenge:',
            'test_run:head:test-run:verification_test_output:',
          ],
        },
      ],
      diagnostics: [
        {
          code: 'EVALUATOR_OUTPUT_TRUNCATED',
          severity: 'warning',
        },
      ],
    });
  });

  it('extracts structured assessment text when Workers AI ignores the JSON-only instruction', () => {
    const output = parseAiJson(`
The model wrote a review memo before the structured answer.

Summary: The candidate implemented the impatient click handling fix and included corresponding test modifications.
Recommendation: strong_evidence_to_advance

Revised Claims:
- positive | implementation_correctness | The candidate addressed the popover click issue by modifying usePopoverRoot.ts and adding PATIENT_CLICK_THRESHOLD to constants.ts [code_diff:base..head:submitted_diff:, test_run:head:test-run:verification_test_output:].
- positive | test_strategy | The candidate included modifications to PopoverTrigger.test.tsx in the submission [test_run:head:test-run:verification_test_output:].

Diagnostics:
- info | VERIFICATION_UNOBSERVED | The test_run evidence shows file changes via git but lacks test suite execution output [test_run:head:test-run:verification_test_output:].

Final JSON
`);

    expect(output).toMatchObject({
      summary: 'The candidate implemented the impatient click handling fix and included corresponding test modifications.',
      recommendation: 'strong_evidence_to_advance',
      claims: [
        {
          polarity: 'positive',
          dimension: 'implementation_correctness',
          narrative: 'The candidate addressed the popover click issue by modifying usePopoverRoot.ts and adding PATIENT_CLICK_THRESHOLD to constants.ts',
          sourceRefKeys: [
            'code_diff:base..head:submitted_diff:',
            'test_run:head:test-run:verification_test_output:',
          ],
        },
        {
          polarity: 'positive',
          dimension: 'test_strategy',
          narrative: 'The candidate included modifications to PopoverTrigger.test.tsx in the submission',
          sourceRefKeys: ['test_run:head:test-run:verification_test_output:'],
        },
      ],
      diagnostics: [
        {
          code: 'VERIFICATION_UNOBSERVED',
          severity: 'info',
          message: 'The test_run evidence shows file changes via git but lacks test suite execution output',
          sourceRefKeys: ['test_run:head:test-run:verification_test_output:'],
        },
      ],
    });
  });
});
