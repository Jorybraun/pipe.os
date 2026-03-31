import { describe, it, expect, vi, beforeEach } from 'vitest';
import { callImplementerAgent, type CallImplementerAgentInput } from '../lib/implementerAgent';

// ─── Mock fetch ─────────────────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function mistralResponse(content: string): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { role: 'assistant', content } }],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

const BASE_INPUT: CallImplementerAgentInput = {
  apiKey: 'test-key',
  provider: 'mistral',
  persona: 'junior',
  prBrief: 'Add search functionality',
  prDiff: '--- search.ts\n+function search() {}',
  previousRounds: [],
  newComments: [
    { id: 1, what: 'URL not encoded', why: 'XSS risk', category: 'security', severity: 'blocking', positive: false },
  ],
};

beforeEach(() => {
  mockFetch.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('callImplementerAgent', () => {
  it('passes through updated_code when move=change', async () => {
    mockFetch.mockResolvedValueOnce(
      mistralResponse(
        JSON.stringify([
          {
            to_comment_id: 1,
            content: 'Good catch, fixing now!',
            move: 'change',
            updated_code: 'function search(q: string) {\n  return encodeURIComponent(q);\n}',
          },
        ]),
      ),
    );

    const results = await callImplementerAgent(BASE_INPUT);
    expect(results).toHaveLength(1);
    expect(results[0]!.move).toBe('change');
    expect(results[0]!.updated_code).toBe('function search(q: string) {\n  return encodeURIComponent(q);\n}');
  });

  it('warns when move=change but no updated_code (soft enforcement)', async () => {
    mockFetch.mockResolvedValueOnce(
      mistralResponse(
        JSON.stringify([
          {
            to_comment_id: 1,
            content: 'I\'ll fix that.',
            move: 'change',
          },
        ]),
      ),
    );

    const results = await callImplementerAgent(BASE_INPUT);
    expect(results).toHaveLength(1);
    expect(results[0]!.move).toBe('change');
    expect(results[0]!.updated_code).toBeUndefined();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('move=change for comment #1 but no updated_code'),
    );
  });

  it('does not include updated_code for pushback moves', async () => {
    mockFetch.mockResolvedValueOnce(
      mistralResponse(
        JSON.stringify([
          {
            to_comment_id: 1,
            content: 'I don\'t think that\'s an issue here.',
            move: 'pushback',
          },
        ]),
      ),
    );

    const results = await callImplementerAgent(BASE_INPUT);
    expect(results).toHaveLength(1);
    expect(results[0]!.move).toBe('pushback');
    expect(results[0]!.updated_code).toBeUndefined();
  });

  it('does not include updated_code for comment moves', async () => {
    mockFetch.mockResolvedValueOnce(
      mistralResponse(
        JSON.stringify([
          {
            to_comment_id: 1,
            content: 'Can you clarify what you mean?',
            move: 'comment',
          },
        ]),
      ),
    );

    const results = await callImplementerAgent(BASE_INPUT);
    expect(results).toHaveLength(1);
    expect(results[0]!.move).toBe('comment');
    expect(results[0]!.updated_code).toBeUndefined();
  });

  it('handles code with newlines and special characters in updated_code', async () => {
    const codeWithSpecials = 'function validate(token: string): boolean {\n  if (!token) return false;\n  // Check for "special" chars\n  return token.length > 0 && token !== \'\\n\';\n}';

    mockFetch.mockResolvedValueOnce(
      mistralResponse(
        JSON.stringify([
          {
            to_comment_id: 1,
            content: 'Fixed the validation.',
            move: 'change',
            updated_code: codeWithSpecials,
          },
        ]),
      ),
    );

    const results = await callImplementerAgent(BASE_INPUT);
    expect(results[0]!.updated_code).toBe(codeWithSpecials);
  });

  it('strips empty updated_code strings', async () => {
    mockFetch.mockResolvedValueOnce(
      mistralResponse(
        JSON.stringify([
          {
            to_comment_id: 1,
            content: 'Fixing now.',
            move: 'change',
            updated_code: '   ',
          },
        ]),
      ),
    );

    const results = await callImplementerAgent(BASE_INPUT);
    expect(results[0]!.updated_code).toBeUndefined();
    expect(console.warn).toHaveBeenCalled();
  });

  it('handles fenced code block wrapping in response', async () => {
    const wrappedResponse = '```json\n' + JSON.stringify([
      { to_comment_id: 1, content: 'Fixed!', move: 'change', updated_code: 'const x = 1;' },
    ]) + '\n```';

    mockFetch.mockResolvedValueOnce(mistralResponse(wrappedResponse));

    const results = await callImplementerAgent(BASE_INPUT);
    expect(results).toHaveLength(1);
    expect(results[0]!.updated_code).toBe('const x = 1;');
  });
});
