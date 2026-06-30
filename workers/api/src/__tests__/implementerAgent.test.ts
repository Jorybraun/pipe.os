import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  AiDeveloperUnavailableError,
  callImplementerAgent,
  type CallImplementerAgentInput,
} from '../lib/implementerAgent';

// ─── Mock Workers AI binding ────────────────────────────────────────────────

const mockAiRun = vi.fn();
const mockAi = { run: mockAiRun } as unknown as Ai;

function workersAiResponse(content: string): { response: string } {
  return { response: content };
}

const BASE_INPUT: CallImplementerAgentInput = {
  apiKey: 'test-key',
  provider: 'workers-ai',
  ai: mockAi,
  persona: 'junior',
  prBrief: 'Add search functionality',
  prDiff: '--- search.ts\n+function search() {}',
  previousRounds: [],
  newComments: [
    { id: 1, what: 'URL not encoded', why: 'XSS risk', category: 'security', severity: 'blocking', positive: false },
  ],
};

beforeEach(() => {
  mockAiRun.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('callImplementerAgent', () => {
  it('passes through updated_code when move=change', async () => {
    mockAiRun.mockResolvedValueOnce(
      workersAiResponse(
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
    mockAiRun.mockResolvedValueOnce(
      workersAiResponse(
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
    mockAiRun.mockResolvedValueOnce(
      workersAiResponse(
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
    mockAiRun.mockResolvedValueOnce(
      workersAiResponse(
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

    mockAiRun.mockResolvedValueOnce(
      workersAiResponse(
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
    mockAiRun.mockResolvedValueOnce(
      workersAiResponse(
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

    mockAiRun.mockResolvedValueOnce(workersAiResponse(wrappedResponse));

    const results = await callImplementerAgent(BASE_INPUT);
    expect(results).toHaveLength(1);
    expect(results[0]!.updated_code).toBe('const x = 1;');
  });

  it('extracts a JSON array from provider prose around the response', async () => {
    const wrappedResponse = [
      'Here is the author response:',
      JSON.stringify([
        { to_comment_id: 1, content: 'Please justify why this blocks the PR.', move: 'pushback' },
      ]),
      'Let me know if you need another round.',
    ].join('\n');

    mockAiRun.mockResolvedValueOnce(workersAiResponse(wrappedResponse));

    const results = await callImplementerAgent(BASE_INPUT);
    expect(results).toHaveLength(1);
    expect(results[0]!.move).toBe('pushback');
  });

  it('unwraps model responses that incorrectly wrap the array in a responses object', async () => {
    mockAiRun.mockResolvedValueOnce(workersAiResponse(JSON.stringify({
      responses: [
        { to_comment_id: 1, content: 'I will add the missing regression test.', move: 'change', updated_code: 'it("covers encoding", () => {});' },
      ],
    })));

    const results = await callImplementerAgent(BASE_INPUT);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      to_comment_id: 1,
      move: 'change',
      updated_code: 'it("covers encoding", () => {});',
    });
  });

  it('accepts a single structured response object without fabricating content', async () => {
    mockAiRun.mockResolvedValueOnce(workersAiResponse(JSON.stringify({
      to_comment_id: 1,
      content: 'I need a failing case before changing the implementation.',
      move: 'pushback',
    })));

    const results = await callImplementerAgent(BASE_INPUT);
    expect(results).toEqual([{
      to_comment_id: 1,
      content: 'I need a failing case before changing the implementation.',
      move: 'pushback',
    }]);
  });

  it('repairs raw newlines inside model string fields', async () => {
    mockAiRun.mockResolvedValueOnce(workersAiResponse(`[
      {
        "to_comment_id": 1,
        "content": "I agree with the test gap.
I will add a regression before merge.",
        "move": "change",
        "updated_code": "test('encodes urls', () => {
  expect(encode('a b')).toBe('a%20b');
});"
      }
    ]`));

    const results = await callImplementerAgent(BASE_INPUT);
    expect(results).toHaveLength(1);
    expect(results[0]!.content).toContain('I will add a regression');
    expect(results[0]!.updated_code).toContain("expect(encode('a b')).toBe('a%20b');");
  });

  it('reads nested Workers AI text response objects', async () => {
    mockAiRun.mockResolvedValueOnce({
      response: {
        text: JSON.stringify([
          { to_comment_id: 1, content: 'I will add the missing regression.', move: 'change', updated_code: 'expect(encoded).toBe(true);' },
        ]),
      },
    });

    const results = await callImplementerAgent(BASE_INPUT);
    expect(results).toHaveLength(1);
    expect(results[0]!.move).toBe('change');
    expect(results[0]!.updated_code).toBe('expect(encoded).toBe(true);');
  });

  it('tries the next current Workers AI model when the primary response is empty', async () => {
    mockAiRun
      .mockResolvedValueOnce(workersAiResponse(''))
      .mockResolvedValueOnce(workersAiResponse(JSON.stringify([
        { to_comment_id: 1, content: 'I need a concrete failing case before changing this.', move: 'pushback' },
      ])));

    const results = await callImplementerAgent(BASE_INPUT);
    expect(mockAiRun).toHaveBeenCalledTimes(2);
    expect(mockAiRun.mock.calls[0]?.[0]).toBe('@cf/openai/gpt-oss-20b');
    expect(mockAiRun.mock.calls[1]?.[0]).toBe('@cf/google/gemma-4-26b-a4b-it');
    expect(results).toHaveLength(1);
    expect(results[0]!.move).toBe('pushback');
  });

  it('continues across current Workers AI models when earlier models return empty responses', async () => {
    mockAiRun
      .mockResolvedValueOnce(workersAiResponse(''))
      .mockResolvedValueOnce(workersAiResponse(''))
      .mockResolvedValueOnce(workersAiResponse(JSON.stringify([
        { to_comment_id: 1, content: 'I will add the regression coverage.', move: 'change', updated_code: 'test(\"encodes urls\", () => {});' },
      ])));

    const results = await callImplementerAgent(BASE_INPUT);
    expect(mockAiRun).toHaveBeenCalledTimes(3);
    expect(mockAiRun.mock.calls[0]?.[0]).toBe('@cf/openai/gpt-oss-20b');
    expect(mockAiRun.mock.calls[1]?.[0]).toBe('@cf/google/gemma-4-26b-a4b-it');
    expect(mockAiRun.mock.calls[2]?.[0]).toBe('@cf/qwen/qwen3-30b-a3b-fp8');
    expect(results[0]!.move).toBe('change');
    expect(results[0]!.updated_code).toBe('test("encodes urls", () => {});');
  });

  it('repairs malformed real-provider output before trying another model', async () => {
    mockAiRun
      .mockResolvedValueOnce(workersAiResponse('I agree this is risky, I will add the regression before merge.'))
      .mockResolvedValueOnce(workersAiResponse(JSON.stringify({
        responses: [
          {
            to_comment_id: 1,
            content: 'Sure - pushing a small regression test now.',
            move: 'change',
            updated_code: 'test("keeps popover open after impatient click", () => {});',
          },
        ],
      })));

    const results = await callImplementerAgent(BASE_INPUT);

    expect(mockAiRun).toHaveBeenCalledTimes(2);
    expect(mockAiRun.mock.calls[0]?.[0]).toBe('@cf/openai/gpt-oss-20b');
    expect(mockAiRun.mock.calls[1]?.[0]).toBe('@cf/google/gemma-4-26b-a4b-it');
    const repairPayload = mockAiRun.mock.calls[1]?.[1] as { messages?: Array<{ content?: string }> };
    expect(repairPayload.messages?.[1]?.content).toContain('RAW_RESPONSE');
    expect(results).toEqual([
      {
        to_comment_id: 1,
        move: 'change',
        content: 'Sure - pushing a small regression test now.',
        updated_code: 'test("keeps popover open after impatient click", () => {});',
      },
    ]);
  });

  it('returns an AI_DEVELOPER_UNAVAILABLE diagnostic instead of a fake author response', async () => {
    await expect(callImplementerAgent({
      ...BASE_INPUT,
      ai: undefined,
      provider: 'workers-ai',
    })).rejects.toMatchObject({
      name: 'AiDeveloperUnavailableError',
      diagnostic: {
        mode: 'AI_DEVELOPER_UNAVAILABLE',
        verdict: 'AI_DEVELOPER_UNAVAILABLE',
        provider: 'workers-ai',
        retryable: true,
      },
    } satisfies Partial<AiDeveloperUnavailableError>);
  });

  it('does not fall back to fake author responses when the provider call fails', async () => {
    mockAiRun.mockRejectedValueOnce(new Error('provider unavailable'));

    await expect(callImplementerAgent(BASE_INPUT)).rejects.toMatchObject({
      name: 'AiDeveloperUnavailableError',
      diagnostic: {
        mode: 'AI_DEVELOPER_UNAVAILABLE',
        verdict: 'AI_DEVELOPER_UNAVAILABLE',
        provider: 'workers-ai',
        retryable: true,
      },
    } satisfies Partial<AiDeveloperUnavailableError>);
  });
});
