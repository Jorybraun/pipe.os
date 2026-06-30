import { describe, expect, it } from 'vitest';

import { parseAiJson } from '../repoTaskAssessmentEvaluator';

describe('repo task assessment evaluator output parsing', () => {
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
