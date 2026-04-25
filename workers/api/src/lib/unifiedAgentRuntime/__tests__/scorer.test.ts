import { describe, it, expect } from 'vitest';
import { scoreSession } from '../scorer';
import type { AgentSession, ScoringConfig } from '../types';
import type { LLMProvider, LLMCompletion } from '../../llm/types';

function makeSession(turns: { questionText: string; candidateResponse?: string }[] = []): AgentSession {
  return {
    id: 'test-1',
    agentType: 'code_review',
    state: 'scoring',
    transcript: {
      turns: turns.map((t, i) => ({
        idx: i,
        questionText: t.questionText,
        candidateResponse: t.candidateResponse,
        timestamp: '2024-01-01T00:00:00Z',
        questionId: undefined,
        metadata: undefined,
      })),
      scratchpad: {},
    },
    evalResults: [],
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    challengeId: undefined,
    candidateId: undefined,
    consentAt: undefined,
    scoreReport: undefined,
  };
}

describe('scoreSession', () => {
  it('returns empty report when provider is null', async () => {
    const config: ScoringConfig = {
      dimensions: [{ id: 'issue_depth', weight: 0.5, promptTemplate: 'Score issue depth', model: undefined }],
      groundingRequirement: true,
      synthesisTemplate: undefined,
    };
    const result = await scoreSession(null, makeSession(), config);
    expect(result.dimensions).toHaveLength(0);
    expect(result.narrative).toContain('No scoring');
  });

  it('returns empty report when no dimensions configured', async () => {
    const provider: LLMProvider = {
      name: 'mock',
      supportsTools: false,
      async complete(): Promise<LLMCompletion> {
        return { content: '{}' };
      },
    };
    const config: ScoringConfig = { dimensions: [], groundingRequirement: false, synthesisTemplate: undefined };
    const result = await scoreSession(provider, makeSession(), config);
    expect(result.dimensions).toHaveLength(0);
  });

  it('scores multiple dimensions in parallel', async () => {
    let callCount = 0;
    const provider: LLMProvider = {
      name: 'parallel',
      supportsTools: false,
      async complete(): Promise<LLMCompletion> {
        callCount++;
        return {
          content: `{"id":"dim","score":4,"confidence":0.8,"evidenceQuotes":["quote ${callCount}"]}`,
        };
      },
    };

    const config: ScoringConfig = {
      dimensions: [
        { id: 'issue_depth', weight: 0.3, promptTemplate: 'Score issue depth', model: undefined },
        { id: 'reasoning', weight: 0.3, promptTemplate: 'Score reasoning', model: undefined },
        { id: 'prioritization', weight: 0.4, promptTemplate: 'Score prioritization', model: undefined },
      ],
      groundingRequirement: false,
      synthesisTemplate: undefined,
    };

    const result = await scoreSession(provider, makeSession(), config);
    expect(result.dimensions).toHaveLength(3);
    expect(result.dimensions[0]!.score).toBe(4);
    expect(result.dimensions[0]!.weight).toBe(0.3);
    expect(callCount).toBe(3);
  });

  it('includes synthesis when synthesisTemplate is provided', async () => {
    let callCount = 0;
    const provider: LLMProvider = {
      name: 'synth',
      supportsTools: false,
      async complete(): Promise<LLMCompletion> {
        callCount++;
        if (callCount === 1) {
          return { content: '{"score":4,"confidence":0.9,"evidenceQuotes":["evidence"]}' };
        }
        return { content: '{"narrative":"Strong candidate","recommendation":"hire"}' };
      },
    };

    const config: ScoringConfig = {
      dimensions: [{ id: 'quality', weight: 1, promptTemplate: 'Score quality', model: undefined }],
      groundingRequirement: false,
      synthesisTemplate: 'Synthesize a hiring narrative.',
    };

    const result = await scoreSession(provider, makeSession(), config);
    expect(result.narrative).toBe('Strong candidate');
    expect(result.recommendation).toBe('hire');
    expect(callCount).toBe(2);
  });

  it('reduces confidence for ungrounded evidence', async () => {
    const provider: LLMProvider = {
      name: 'ungrounded',
      supportsTools: false,
      async complete(): Promise<LLMCompletion> {
        return {
          content: '{"score":3,"confidence":0.8,"evidenceQuotes":["this quote is not in the transcript"]}',
        };
      },
    };

    const session = makeSession([{ questionText: 'What is your approach?', candidateResponse: 'I review carefully.' }]);
    const config: ScoringConfig = {
      dimensions: [{ id: 'quality', weight: 1, promptTemplate: 'Score quality', model: undefined }],
      groundingRequirement: true,
      synthesisTemplate: undefined,
    };

    const result = await scoreSession(provider, session, config);
    expect(result.dimensions[0]!.confidence).toBeLessThan(0.8);
  });

  it('returns zeroed dimension on provider error', async () => {
    const provider: LLMProvider = {
      name: 'error',
      supportsTools: false,
      async complete(): Promise<LLMCompletion> {
        throw new Error('LLM failure');
      },
    };

    const config: ScoringConfig = {
      dimensions: [{ id: 'quality', weight: 1, promptTemplate: 'Score quality', model: undefined }],
      groundingRequirement: false,
      synthesisTemplate: undefined,
    };

    const result = await scoreSession(provider, makeSession(), config);
    expect(result.dimensions[0]!.score).toBe(0);
    expect(result.dimensions[0]!.confidence).toBe(0);
  });
});
