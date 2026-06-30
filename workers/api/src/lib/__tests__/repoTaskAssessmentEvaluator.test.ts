import { describe, expect, it } from 'vitest';

import { parseAiJson } from '../repoTaskAssessmentEvaluator';

describe('repo task assessment evaluator output parsing', () => {
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
