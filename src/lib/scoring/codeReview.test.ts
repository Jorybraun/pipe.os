import { describe, it, expect } from 'vitest';
import { scoreCodeReview } from './codeReview';
import { Annotation } from '../../components/ReviewCanvas';
import { Bug } from '../../content/codeReviewSnippets';

describe('scoreCodeReview', () => {
  const mockSnippets = [
    {
      id: 'snippet-1',
      groundTruth: [
        { line: 5, type: 'SECURITY', severity: 'critical', explanation: 'SQL Injection' },
        { line: 10, type: 'LOGIC', severity: 'major', explanation: 'Wrong operator' },
      ] as Bug[],
    },
  ];

  it('scores 100 for perfect submission', () => {
    const submission = {
      annotations: {
        'snippet-1': [
          { line: 5, comment: 'SQL Injection fix here which is long enough', severity: 'critical' },
          { line: 10, comment: 'Wrong operator should be corrected', severity: 'major' },
        ] as Annotation[],
      },
    };

    const result = scoreCodeReview(submission, mockSnippets);
    expect(result.total).toBe(100);
  });

  it('penalizes false positives', () => {
    const submission = {
      annotations: {
        'snippet-1': [
          { line: 5, comment: 'SQL Injection fix here which is long enough', severity: 'critical' },
          { line: 10, comment: 'Wrong operator should be corrected', severity: 'major' },
          { line: 20, comment: 'Random comment', severity: 'minor' }, // False positive
        ] as Annotation[],
      },
    };

    const result = scoreCodeReview(submission, mockSnippets);
    expect(result.total).toBe(90); // 100 - 10 = 90
  });

  it('scores 0 for empty submission', () => {
    const submission = { annotations: {} };
    const result = scoreCodeReview(submission, mockSnippets);
    expect(result.total).toBe(0);
  });
});
