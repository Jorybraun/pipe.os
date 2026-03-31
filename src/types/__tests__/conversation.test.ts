import { describe, it, expect } from 'vitest';
import { buildThreadsFromRounds, type ReviewRound } from '../conversation';

// ─── buildThreadsFromRounds ─────────────────────────────────────────────────

describe('buildThreadsFromRounds', () => {
  it('creates one thread per comment from a single round', () => {
    const rounds: ReviewRound[] = [
      {
        round: 1,
        reviewer_comments: [
          { id: 1, what: 'Bug here', why: '', category: 'functionality', severity: 'major', positive: false },
          { id: 2, what: 'Style nit', why: '', category: 'style_nit', severity: 'nit', positive: false },
        ],
        implementer_responses: [
          { to_comment_id: 1, move: 'change', content: 'Fixed!' },
          { to_comment_id: 2, move: 'pushback', content: 'I prefer this style.' },
        ],
      },
    ];

    const threads = buildThreadsFromRounds(rounds);
    expect(threads).toHaveLength(2);

    const thread1 = threads.find((t) => t.comment_id === 1)!;
    expect(thread1.comment.what).toBe('Bug here');
    expect(thread1.exchanges).toHaveLength(1);
    expect(thread1.exchanges[0]!.actor).toBe('implementer');
    expect(thread1.exchanges[0]!.move).toBe('change');
    expect(thread1.resolution).toBe('fix_agreed');

    const thread2 = threads.find((t) => t.comment_id === 2)!;
    expect(thread2.exchanges[0]!.move).toBe('pushback');
    expect(thread2.resolution).toBe('dangling');
  });

  it('groups follow-up comments by comment_id across rounds', () => {
    const rounds: ReviewRound[] = [
      {
        round: 1,
        reviewer_comments: [
          { id: 1, what: 'SQL injection risk', why: '', category: 'security', severity: 'blocking', positive: false },
        ],
        implementer_responses: [
          { to_comment_id: 1, move: 'pushback', content: 'It works fine in my tests.' },
        ],
      },
      {
        round: 2,
        reviewer_comments: [
          // Follow-up on the same comment_id — reviewer re-uses id 1
          { id: 1, what: 'No, try this input: " OR 1=1', why: '', category: 'security', severity: 'blocking', positive: false },
        ],
        implementer_responses: [
          { to_comment_id: 1, move: 'change', content: 'OK good catch, parameterizing the query now.' },
        ],
      },
    ];

    const threads = buildThreadsFromRounds(rounds);
    expect(threads).toHaveLength(1);

    const thread = threads[0]!;
    expect(thread.comment_id).toBe(1);
    // Round 1: implementer pushback, Round 2: reviewer follow-up + implementer change
    expect(thread.exchanges).toHaveLength(3);
    expect(thread.exchanges[0]!.actor).toBe('implementer');
    expect(thread.exchanges[0]!.move).toBe('pushback');
    expect(thread.exchanges[1]!.actor).toBe('reviewer');
    expect(thread.exchanges[2]!.actor).toBe('implementer');
    expect(thread.exchanges[2]!.move).toBe('change');
    // Last move was change → fix_agreed
    expect(thread.resolution).toBe('fix_agreed');
  });

  it('handles move=change setting resolution to fix_agreed', () => {
    const rounds: ReviewRound[] = [
      {
        round: 1,
        reviewer_comments: [
          { id: 1, what: 'Missing null check', why: '', category: 'functionality', severity: 'major', positive: false },
        ],
        implementer_responses: [
          { to_comment_id: 1, move: 'change', content: 'Added null check.' },
        ],
      },
    ];

    const threads = buildThreadsFromRounds(rounds);
    expect(threads[0]!.resolution).toBe('fix_agreed');
  });

  it('returns empty array for empty rounds', () => {
    expect(buildThreadsFromRounds([])).toEqual([]);
  });

  it('handles rounds with no implementer responses', () => {
    const rounds: ReviewRound[] = [
      {
        round: 1,
        reviewer_comments: [
          { id: 1, what: 'Looks good!', why: '', category: 'positive', severity: null, positive: true },
        ],
        implementer_responses: [],
      },
    ];

    const threads = buildThreadsFromRounds(rounds);
    expect(threads).toHaveLength(1);
    expect(threads[0]!.exchanges).toHaveLength(0);
    expect(threads[0]!.resolution).toBe('dangling');
  });

  it('propagates updated_code on change moves', () => {
    const rounds: ReviewRound[] = [
      {
        round: 1,
        reviewer_comments: [
          { id: 1, what: 'Use encodeURIComponent', why: 'XSS', category: 'security', severity: 'blocking', positive: false },
        ],
        implementer_responses: [
          { to_comment_id: 1, move: 'change', content: 'Fixed!', updated_code: 'encodeURIComponent(q)' },
        ],
      },
    ];

    const threads = buildThreadsFromRounds(rounds);
    expect(threads[0]!.exchanges[0]!.updated_code).toBe('encodeURIComponent(q)');
  });

  it('does not include updated_code for pushback moves', () => {
    const rounds: ReviewRound[] = [
      {
        round: 1,
        reviewer_comments: [
          { id: 1, what: 'Consider useMemo', why: '', category: null, severity: null, positive: false },
        ],
        implementer_responses: [
          { to_comment_id: 1, move: 'pushback', content: 'Not needed here.' },
        ],
      },
    ];

    const threads = buildThreadsFromRounds(rounds);
    expect(threads[0]!.exchanges[0]!.updated_code).toBeUndefined();
  });

  it('ignores implementer responses to unknown comment IDs', () => {
    const rounds: ReviewRound[] = [
      {
        round: 1,
        reviewer_comments: [
          { id: 1, what: 'Real comment', why: '', category: null, severity: null, positive: false },
        ],
        implementer_responses: [
          { to_comment_id: 1, move: 'comment', content: 'Got it.' },
          { to_comment_id: 999, move: 'change', content: 'Ghost response' },
        ],
      },
    ];

    const threads = buildThreadsFromRounds(rounds);
    expect(threads).toHaveLength(1);
    expect(threads[0]!.exchanges).toHaveLength(1);
  });
});
