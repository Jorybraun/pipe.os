import { describe, it, expect } from 'vitest';
import { reflectOnSynthesis } from '../reflector';
import type { InterviewState } from '../../interview/types';

function makeState(overrides: Partial<InterviewState> = {}): InterviewState {
  const base: InterviewState = {
    baseline: { title: 'Engineer' },
    participantRole: 'HIRING_MANAGER',
    questionBudget: 12,
    exchanges: [],
    knowledgeState: {},
    coverage: { why: 'none', work: 'none', team: 'none', bar: 'none', codebase: 'none', process: 'none' },
    phase: 'WRAP_UP',
    questionsAsked: 10,
    synthesisReady: true,
  };
  return { ...base, ...overrides };
}

describe('reflectOnSynthesis', () => {
  it('returns strong when all domains are covered', () => {
    const state = makeState({
      coverage: { why: 'covered', work: 'covered', team: 'deep', bar: 'covered', codebase: 'covered', process: 'covered' },
    });
    const result = reflectOnSynthesis(state);
    expect(result.overallQuality).toBe('strong');
    expect(result.gaps).toHaveLength(0);
    expect(result.userPrompt).toBeUndefined();
  });

  it('returns adequate when one domain is partial and rest are covered', () => {
    const state = makeState({
      coverage: { why: 'covered', work: 'covered', team: 'partial', bar: 'covered', codebase: 'covered', process: 'covered' },
      knowledgeState: { team: { size: 6, culture: 'async', rituals: 'standup' } },
    });
    const result = reflectOnSynthesis(state);
    expect(result.overallQuality).toBe('adequate');
    expect(result.gaps.length).toBeGreaterThan(0);
    expect(result.gaps[0].recommendedAction).toBe('acceptable_gap');
  });

  it('returns thin when one domain is sparse', () => {
    const state = makeState({
      coverage: { why: 'covered', work: 'covered', team: 'sparse', bar: 'covered', codebase: 'covered', process: 'covered' },
    });
    const result = reflectOnSynthesis(state);
    expect(result.overallQuality).toBe('thin');
    expect(result.gaps.some((g) => g.targetDomain === 'team')).toBe(true);
    expect(result.userPrompt).toContain('team');
  });

  it('returns thin when two domains are partial', () => {
    const state = makeState({
      coverage: { why: 'partial', work: 'partial', team: 'covered', bar: 'covered', codebase: 'covered', process: 'covered' },
    });
    const result = reflectOnSynthesis(state);
    expect(result.overallQuality).toBe('thin');
  });

  it('flags continue_interview for none coverage', () => {
    const state = makeState({
      coverage: { why: 'none', work: 'covered', team: 'covered', bar: 'covered', codebase: 'covered', process: 'covered' },
    });
    const result = reflectOnSynthesis(state);
    const whyGap = result.gaps.find((g) => g.targetDomain === 'why');
    expect(whyGap).toBeDefined();
    expect(whyGap!.recommendedAction).toBe('continue_interview');
    expect(result.userPrompt).toContain('why');
  });

  it('counts knowledge keys in missing reasons', () => {
    const state = makeState({
      coverage: { why: 'sparse', work: 'covered', team: 'covered', bar: 'covered', codebase: 'covered', process: 'covered' },
      knowledgeState: { why: { origin: 'growth' } },
    });
    const result = reflectOnSynthesis(state);
    const whyGap = result.gaps.find((g) => g.targetDomain === 'why');
    expect(whyGap!.missing.some((m) => m.includes('1 knowledge keys'))).toBe(true);
  });
});
