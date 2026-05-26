import { describe, it, expect } from 'vitest';
import { evaluateDomainDepth } from '../depthEvaluator';
import type { InterviewState } from '../../interview/types';

function makeState(overrides: Partial<InterviewState> = {}): InterviewState {
  const base: InterviewState = {
    baseline: { title: 'Engineer' },
    participantRole: 'HIRING_MANAGER',
    questionBudget: 12,
    exchanges: [],
    knowledgeState: {},
    coverage: { why: 'none', work: 'none', team: 'none', bar: 'none', codebase: 'none', process: 'none' },
    phase: 'DISCOVERY',
    questionsAsked: 0,
    synthesisReady: false,
  };
  return { ...base, ...overrides };
}

describe('evaluateDomainDepth', () => {
  it('returns deep when coverage is covered', () => {
    const state = makeState({ coverage: { team: 'covered', work: 'none', why: 'none', bar: 'none', codebase: 'none', process: 'none' } });
    const result = evaluateDomainDepth('team', state);
    expect(result.isDeep).toBe(true);
    expect(result.recommendedFollowUps).toBe(0);
  });

  it('returns deep when coverage is deep', () => {
    const state = makeState({ coverage: { team: 'deep', work: 'none', why: 'none', bar: 'none', codebase: 'none', process: 'none' } });
    const result = evaluateDomainDepth('team', state);
    expect(result.isDeep).toBe(true);
    expect(result.recommendedFollowUps).toBe(0);
  });

  it('returns deep when partial with 3+ knowledge keys', () => {
    const state = makeState({
      coverage: { team: 'partial', work: 'none', why: 'none', bar: 'none', codebase: 'none', process: 'none' },
      knowledgeState: { team: { size: 6, culture: 'async', rituals: 'daily standup' } },
    });
    const result = evaluateDomainDepth('team', state);
    expect(result.isDeep).toBe(true);
    expect(result.recommendedFollowUps).toBe(0);
  });

  it('returns shallow when partial with < 3 knowledge keys', () => {
    const state = makeState({
      coverage: { team: 'partial', work: 'none', why: 'none', bar: 'none', codebase: 'none', process: 'none' },
      knowledgeState: { team: { size: 6 } },
    });
    const result = evaluateDomainDepth('team', state);
    expect(result.isDeep).toBe(false);
    expect(result.recommendedFollowUps).toBe(2);
  });

  it('returns shallow when coverage is sparse', () => {
    const state = makeState({ coverage: { team: 'sparse', work: 'none', why: 'none', bar: 'none', codebase: 'none', process: 'none' } });
    const result = evaluateDomainDepth('team', state);
    expect(result.isDeep).toBe(false);
    expect(result.recommendedFollowUps).toBe(2);
  });

  it('returns shallow with 3 follow-ups when coverage is none', () => {
    const state = makeState({ coverage: { team: 'none', work: 'none', why: 'none', bar: 'none', codebase: 'none', process: 'none' } });
    const result = evaluateDomainDepth('team', state);
    expect(result.isDeep).toBe(false);
    expect(result.recommendedFollowUps).toBe(3);
  });

  it('handles missing domain coverage gracefully', () => {
    const state = makeState({ coverage: { why: 'none', work: 'none', team: 'none', bar: 'none', codebase: 'none', process: 'none' } });
    // @ts-expect-force — test missing key handling
    const coverage = { ...state.coverage };
    delete (coverage as Record<string, unknown>).team;
    const result = evaluateDomainDepth('team', { ...state, coverage });
    expect(result.isDeep).toBe(false);
    expect(result.recommendedFollowUps).toBe(3);
  });
});
