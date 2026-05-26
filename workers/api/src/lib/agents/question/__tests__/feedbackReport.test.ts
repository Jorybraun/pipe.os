import { describe, it, expect } from 'vitest';
import { categorizeExchange, formatReportMarkdown } from '../feedbackReport';

describe('feedbackReport', () => {
  describe('categorizeExchange', () => {
    it('detects role_confusion pattern', () => {
      const patterns = categorizeExchange(
        'What are your primary responsibilities as a team member for this role?',
        'This is confusing — I am not the hire.',
      );
      expect(patterns).toContain('role_confusion');
    });

    it('detects too_vague pattern', () => {
      const patterns = categorizeExchange(
        "Can you give me an overview of this role's scope?",
        'Too vague and generic.',
      );
      expect(patterns).toContain('too_vague');
    });

    it('detects leading_question pattern', () => {
      const patterns = categorizeExchange(
        'Your team probably values clean code, right?',
        'This is leading.',
      );
      expect(patterns).toContain('leading_question');
    });

    it('detects bad_bot pattern', () => {
      const patterns = categorizeExchange(
        'What are your responsibilities?',
        '[BAD_ROBOT] User flagged this question as bad',
      );
      expect(patterns).toContain('bad_bot');
    });

    it('returns uncategorized for unknown feedback', () => {
      const patterns = categorizeExchange(
        'What is your favorite color?',
        'I just do not like this question.',
      );
      expect(patterns).toContain('uncategorized');
    });
  });

  describe('formatReportMarkdown', () => {
    it('renders a concise markdown report', () => {
      const report = {
        totalExchanges: 100,
        totalFlagged: 10,
        flagRate: 0.1,
        topPatterns: [
          { pattern: 'role_confusion', count: 5, examples: ['Bad question 1'] },
          { pattern: 'too_vague', count: 3, examples: ['Bad question 2'] },
        ],
        byParticipantRole: {
          TEAM_MEMBER: { total: 50, flagged: 8, flagRate: 0.16 },
          HIRING_MANAGER: { total: 50, flagged: 2, flagRate: 0.04 },
        },
        sampleFlagged: [],
      };
      const md = formatReportMarkdown(report);
      expect(md).toContain('# Question Quality Report');
      expect(md).toContain('100');
      expect(md).toContain('10');
      expect(md).toContain('10.0%');
      expect(md).toContain('role_confusion');
      expect(md).toContain('TEAM_MEMBER');
    });
  });
});
