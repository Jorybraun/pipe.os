import { describe, it, expect } from 'vitest';
import { runEvalGate } from '../evalGate';
import type { AgentSession, AgentTurn, EvalConfig } from '../types';
import type { LLMProvider, LLMCompletion } from '../../llm/types';

function makeSession(turns: AgentTurn[] = []): AgentSession {
  return {
    id: 'test-1',
    agentType: 'role_discovery',
    state: 'in_progress',
    transcript: { turns, scratchpad: {} },
    evalResults: [],
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    challengeId: undefined,
    candidateId: undefined,
    consentAt: undefined,
    scoreReport: undefined,
  };
}

describe('runEvalGate', () => {
  it('short-circuits to approved when provider is null', async () => {
    const result = await runEvalGate(
      null,
      { idx: 0, questionText: 'hello', timestamp: 't', questionId: undefined, candidateResponse: undefined, metadata: undefined },
      makeSession(),
      { dimensions: [{ id: 'tone', promptTemplate: 'check tone', weight: undefined, model: undefined }], approvalRule: 'all_pass', minScore: undefined, maxRetries: undefined },
    );
    expect(result.approved).toBe(true);
    expect(result.dimensions).toHaveLength(0);
  });

  it('short-circuits to approved when no dimensions configured', async () => {
    const provider: LLMProvider = {
      name: 'mock',
      supportsTools: false,
      async complete(): Promise<LLMCompletion> {
        return { content: '{}' };
      },
    };
    const result = await runEvalGate(
      provider,
      { idx: 0, questionText: 'hello', timestamp: 't', questionId: undefined, candidateResponse: undefined, metadata: undefined },
      makeSession(),
      { dimensions: [], approvalRule: 'all_pass', minScore: undefined, maxRetries: undefined },
    );
    expect(result.approved).toBe(true);
  });

  it('approves when all dimensions pass with all_pass rule', async () => {
    let callCount = 0;
    const provider: LLMProvider = {
      name: 'passer',
      supportsTools: false,
      async complete(): Promise<LLMCompletion> {
        callCount++;
        return { content: '{"id":"dim","verdict":"pass","score":0.9,"reason":"good"}' };
      },
    };

    const config: EvalConfig = {
      dimensions: [
        { id: 'tone', promptTemplate: 'check tone', weight: undefined, model: undefined },
        { id: 'redundancy', promptTemplate: 'check redundancy', weight: undefined, model: undefined },
      ],
      approvalRule: 'all_pass',
      minScore: undefined,
      maxRetries: undefined,
    };

    const result = await runEvalGate(
      provider,
      { idx: 0, questionText: 'hello', timestamp: 't', questionId: undefined, candidateResponse: undefined, metadata: undefined },
      makeSession(),
      config,
    );

    expect(result.approved).toBe(true);
    expect(result.dimensions).toHaveLength(2);
    expect(result.dimensions.every((d) => d.verdict === 'pass')).toBe(true);
    expect(callCount).toBe(2);
  });

  it('rejects when any dimension fails with all_pass rule', async () => {
    let callCount = 0;
    const provider: LLMProvider = {
      name: 'mixed',
      supportsTools: false,
      async complete(): Promise<LLMCompletion> {
        callCount++;
        const verdict = callCount === 1 ? 'pass' : 'fail';
        return { content: `{"id":"dim","verdict":"${verdict}","score":0.5,"reason":"mixed"}` };
      },
    };

    const config: EvalConfig = {
      dimensions: [
        { id: 'tone', promptTemplate: 'check tone', weight: undefined, model: undefined },
        { id: 'redundancy', promptTemplate: 'check redundancy', weight: undefined, model: undefined },
      ],
      approvalRule: 'all_pass',
      minScore: undefined,
      maxRetries: undefined,
    };

    const result = await runEvalGate(
      provider,
      { idx: 0, questionText: 'hello', timestamp: 't', questionId: undefined, candidateResponse: undefined, metadata: undefined },
      makeSession(),
      config,
    );

    expect(result.approved).toBe(false);
    expect(result.dimensions[0]!.verdict).toBe('pass');
    expect(result.dimensions[1]!.verdict).toBe('fail');
  });

  it('approves with no_fail rule when no dimension fails', async () => {
    const provider: LLMProvider = {
      name: 'warn-only',
      supportsTools: false,
      async complete(): Promise<LLMCompletion> {
        return { content: '{"id":"dim","verdict":"warn","score":0.6,"reason":"caution"}' };
      },
    };

    const config: EvalConfig = {
      dimensions: [{ id: 'tone', promptTemplate: 'check tone', weight: undefined, model: undefined }],
      approvalRule: 'no_fail',
      minScore: undefined,
      maxRetries: undefined,
    };

    const result = await runEvalGate(
      provider,
      { idx: 0, questionText: 'hello', timestamp: 't', questionId: undefined, candidateResponse: undefined, metadata: undefined },
      makeSession(),
      config,
    );

    expect(result.approved).toBe(true);
    expect(result.dimensions[0]!.verdict).toBe('warn');
  });

  it('rejects with no_fail rule when any dimension fails', async () => {
    const provider: LLMProvider = {
      name: 'fail-one',
      supportsTools: false,
      async complete(): Promise<LLMCompletion> {
        return { content: '{"id":"dim","verdict":"fail","score":0.2,"reason":"bad"}' };
      },
    };

    const config: EvalConfig = {
      dimensions: [{ id: 'tone', promptTemplate: 'check tone', weight: undefined, model: undefined }],
      approvalRule: 'no_fail',
      minScore: undefined,
      maxRetries: undefined,
    };

    const result = await runEvalGate(
      provider,
      { idx: 0, questionText: 'hello', timestamp: 't', questionId: undefined, candidateResponse: undefined, metadata: undefined },
      makeSession(),
      config,
    );

    expect(result.approved).toBe(false);
  });

  it('approves with weighted rule when score exceeds threshold', async () => {
    const provider: LLMProvider = {
      name: 'weighted-pass',
      supportsTools: false,
      async complete(): Promise<LLMCompletion> {
        return { content: '{"id":"dim","verdict":"pass","score":0.8,"reason":"solid"}' };
      },
    };

    const config: EvalConfig = {
      dimensions: [
        { id: 'a', promptTemplate: 'check a', weight: 0.7, model: undefined },
        { id: 'b', promptTemplate: 'check b', weight: 0.3, model: undefined },
      ],
      approvalRule: 'weighted',
      minScore: 0.6,
      maxRetries: undefined,
    };

    const result = await runEvalGate(
      provider,
      { idx: 0, questionText: 'hello', timestamp: 't', questionId: undefined, candidateResponse: undefined, metadata: undefined },
      makeSession(),
      config,
    );

    expect(result.approved).toBe(true);
  });

  it('rejects with weighted rule when score is below threshold', async () => {
    const provider: LLMProvider = {
      name: 'weighted-fail',
      supportsTools: false,
      async complete(): Promise<LLMCompletion> {
        return { content: '{"id":"dim","verdict":"warn","score":0.3,"reason":"weak"}' };
      },
    };

    const config: EvalConfig = {
      dimensions: [{ id: 'a', promptTemplate: 'check a', weight: 1, model: undefined }],
      approvalRule: 'weighted',
      minScore: 0.6,
      maxRetries: undefined,
    };

    const result = await runEvalGate(
      provider,
      { idx: 0, questionText: 'hello', timestamp: 't', questionId: undefined, candidateResponse: undefined, metadata: undefined },
      makeSession(),
      config,
    );

    expect(result.approved).toBe(false);
  });

  it('fails closed when provider throws', async () => {
    const provider: LLMProvider = {
      name: 'thrower',
      supportsTools: false,
      async complete(): Promise<LLMCompletion> {
        throw new Error('network error');
      },
    };

    const config: EvalConfig = {
      dimensions: [{ id: 'tone', promptTemplate: 'check tone', weight: undefined, model: undefined }],
      approvalRule: 'all_pass',
      minScore: undefined,
      maxRetries: undefined,
    };

    const result = await runEvalGate(
      provider,
      { idx: 0, questionText: 'hello', timestamp: 't', questionId: undefined, candidateResponse: undefined, metadata: undefined },
      makeSession(),
      config,
    );

    expect(result.approved).toBe(false);
    expect(result.dimensions[0]!.verdict).toBe('fail');
    expect(result.dimensions[0]!.reason).toContain('failed');
  });
});
