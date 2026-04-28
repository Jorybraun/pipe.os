import { describe, it, expect, vi } from 'vitest';
import { synthesize } from '../generator';
import type { InterviewState } from '../../interview/types';
import type { LLMProvider } from '../../../llm/types';

// ─── Mock provider ───────────────────────────────────────────────────────────

function makeMockProvider(response: string | Record<string, unknown>): LLMProvider {
  const content = typeof response === 'string' ? response : JSON.stringify(response);
  return {
    name: 'mock',
    supportsTools: false,
    complete: vi.fn().mockResolvedValue({ content }),
    completeStream: undefined,
  } as unknown as LLMProvider;
}

function makeState(overrides: Partial<InterviewState> = {}): InterviewState {
  const base: InterviewState = {
    baseline: { title: 'Backend Engineer', techStack: ['TypeScript', 'PostgreSQL'] },
    participantRole: 'HIRING_MANAGER',
    questionBudget: 8,
    exchanges: [
      {
        questionId: 'q-1',
        acknowledgment: 'Hi.',
        question: 'Tell me about the role.',
        input: { type: 'textarea' },
        answer: 'We need a senior backend engineer to rebuild our API.',
      },
    ],
    knowledgeState: { why: { origin: 'rebuild' }, work: { stack: ['TypeScript', 'PostgreSQL'] } },
    coverage: { why: 'covered', work: 'deep', team: 'sparse', bar: 'partial', codebase: 'covered', process: 'none' },
    phase: 'WRAP_UP',
    questionsAsked: 8,
    synthesisReady: true,
  };
  return { ...base, ...overrides };
}

// ─── synthesize ──────────────────────────────────────────────────────────────

describe('synthesize', () => {
  it('throws when provider is null', async () => {
    await expect(synthesize(makeState(), null)).rejects.toThrow('No AI provider is configured');
  });

  it('parses a valid synthesis response', async () => {
    const provider = makeMockProvider({
      reasoning: 'Coverage is solid on work and why.',
      persona: {
        seniority: 'Senior, 5–8 years',
        archetype: 'Backend-leaning fullstack from Series A-C startup',
        mustHaveSkills: ['TypeScript', 'PostgreSQL', 'REST API design'],
        niceToHaveSkills: ['Kafka', 'Kubernetes'],
        disposition: ['Comfortable pushing back on PMs', 'Opinionated about testing'],
        careerSignal: 'Has shipped at least one greenfield system end-to-end',
        redFlags: ['Avoids on-call'],
        dealbreakers: ['No production experience'],
      },
      jobDescription: '# Senior Backend Engineer\n\n## The Role\n...',
      knowledgeStateUpdate: { why: { urgency: 'high' } },
      domainCoverage: { why: 'deep', work: 'deep', team: 'sparse', bar: 'partial', codebase: 'covered', process: 'none' },
    });

    const result = await synthesize(makeState(), provider);

    expect(result.persona.seniority).toBe('Senior, 5–8 years');
    expect(result.persona.mustHaveSkills).toContain('TypeScript');
    expect(result.jobDescription).toContain('Senior Backend Engineer');
    expect(result.synthesis).toBe('Backend-leaning fullstack from Series A-C startup');
    expect(result.knowledgeStateUpdate.why).toEqual({ urgency: 'high' });
  });

  it('uses explicit synthesis field when present', async () => {
    const provider = makeMockProvider({
      reasoning: 'x',
      persona: { seniority: 'S', archetype: 'A', mustHaveSkills: [], niceToHaveSkills: [], disposition: [], careerSignal: 'C', redFlags: [], dealbreakers: [] },
      jobDescription: 'JD',
      synthesis: 'Custom synthesis text',
    });

    const result = await synthesize(makeState(), provider);
    expect(result.synthesis).toBe('Custom synthesis text');
  });

  it('falls back to archetype when synthesis field is missing', async () => {
    const provider = makeMockProvider({
      reasoning: 'x',
      persona: { seniority: 'S', archetype: 'Backend engineer', mustHaveSkills: [], niceToHaveSkills: [], disposition: [], careerSignal: 'C', redFlags: [], dealbreakers: [] },
      jobDescription: 'JD',
    });

    const result = await synthesize(makeState(), provider);
    expect(result.synthesis).toBe('Backend engineer');
  });

  it('handles missing persona fields with defaults', async () => {
    const provider = makeMockProvider({
      reasoning: 'x',
      persona: {},
      jobDescription: 'JD',
    });

    const result = await synthesize(makeState(), provider);
    expect(result.persona.seniority).toBe('Not specified');
    expect(result.persona.archetype).toBe('Not specified');
    expect(result.persona.mustHaveSkills).toEqual([]);
  });

  it('throws on invalid JSON', async () => {
    const provider = makeMockProvider('not json');
    await expect(synthesize(makeState(), provider)).rejects.toThrow('invalid JSON');
  });

  it('throws on empty provider response', async () => {
    const provider = makeMockProvider('');
    await expect(synthesize(makeState(), provider)).rejects.toThrow('empty content');
  });

  it('strips markdown fences from JSON', async () => {
    const provider = makeMockProvider(
      '```json\n{"reasoning":"x","persona":{"seniority":"S","archetype":"A","mustHaveSkills":[],"niceToHaveSkills":[],"disposition":[],"careerSignal":"C","redFlags":[],"dealbreakers":[]},"jobDescription":"JD"}\n```',
    );

    const result = await synthesize(makeState(), provider);
    expect(result.jobDescription).toBe('JD');
  });

  it('includes state data in the prompt', async () => {
    const provider = makeMockProvider({
      reasoning: 'x',
      persona: { seniority: 'S', archetype: 'A', mustHaveSkills: [], niceToHaveSkills: [], disposition: [], careerSignal: 'C', redFlags: [], dealbreakers: [] },
      jobDescription: 'JD',
    });

    const state = makeState();
    await synthesize(state, provider);

    const callArgs = (provider.complete as ReturnType<typeof vi.fn>).mock.calls[0];
    const messages = callArgs[0] as Array<{ role: string; content: string }>;
    const userMessage = messages.find((m) => m.role === 'user')?.content ?? '';

    expect(userMessage).toContain('Backend Engineer');
    expect(userMessage).toContain('Tell me about the role.');
    expect(userMessage).toContain('We need a senior backend engineer');
  });
});
