import { describe, it, expect } from 'vitest';
import { cultureInterviewReducer } from '../cultureInterviewReducer';
import type { InterviewStateV2, InterviewAction } from '../cultureInterviewState';

function makeInitialState(overrides: Partial<InterviewStateV2> = {}): InterviewStateV2 {
  return {
    version: 'v2',
    turns: [],
    scratchpad: {
      dimensionCoverage: {},
      probesUsedForCurrentQ: 0,
      runningThemes: [],
      mode: 'role_fit',
    },
    phase: 'consent',
    phaseHistory: [],
    coverage: {
      dimensions: [],
      gaps: [],
      isComplete: false,
      probeRecommendations: [],
      summary: '',
    },
    currentDrill: null,
    pendingNodes: [],
    config: { mode: 'role_fit', minQuestions: 5, maxQuestions: 15, maxDrills: 2 },
    ...overrides,
  };
}

describe('cultureInterviewReducer', () => {
  it('START transitions to rapport_building and records history', () => {
    const state = makeInitialState();
    const next = cultureInterviewReducer(state, { type: 'START' });
    expect(next.phase).toBe('rapport_building');
    expect(next.phaseHistory).toHaveLength(1);
    expect(next.phaseHistory[0]!.phase).toBe('rapport_building');
  });

  it('ANSWER updates the target turn and recomputes coverage', () => {
    const state = makeInitialState({
      phase: 'rapport_building',
      turns: [
        {
          idx: 0,
          questionId: 'q1',
          questionText: 'Q1',
          probeOf: null,
          candidateResponse: null,
          starSlots: null,
          timestamp: '2024-01-01T00:00:00Z',
          phase: 'rapport_building',
        },
      ],
    });
    const starSlots = {
      S: { present: true, specificity: 2 },
      T: { present: true, specificity: 2 },
      A: { present: true, specificity: 2 },
      R: { present: true, specificity: 2 },
    };
    const next = cultureInterviewReducer(state, {
      type: 'ANSWER',
      answer: 'My answer.',
      turnIndex: 0,
      starSlots,
    });
    expect(next.turns[0]!.candidateResponse).toBe('My answer.');
    expect(next.turns[0]!.starSlots).toEqual(starSlots);
    // Coverage should have been recomputed (turn has no dimension mapping so stays empty).
    expect(next.coverage).toBeDefined();
  });

  it('ANSWER does not mutate the original state', () => {
    const state = makeInitialState({
      phase: 'rapport_building',
      turns: [
        {
          idx: 0,
          questionId: 'q1',
          questionText: 'Q1',
          probeOf: null,
          candidateResponse: null,
          starSlots: null,
          timestamp: '2024-01-01T00:00:00Z',
          phase: 'rapport_building',
        },
      ],
    });
    const frozen = Object.freeze(state);
    const starSlots = {
      S: { present: true, specificity: 1 },
      T: { present: false, specificity: 0 },
      A: { present: false, specificity: 0 },
      R: { present: false, specificity: 0 },
    };
    const next = cultureInterviewReducer(frozen, {
      type: 'ANSWER',
      answer: 'Answer',
      turnIndex: 0,
      starSlots,
    });
    expect(next).not.toBe(frozen);
    expect(next.turns).not.toBe(frozen.turns);
    expect(next.turns[0]).not.toBe(frozen.turns[0]);
    expect(frozen.turns[0]!.candidateResponse).toBeNull();
  });

  it('DRILL sets currentDrill with maxAttempts from config', () => {
    const state = makeInitialState({ config: { mode: 'role_fit', minQuestions: 5, maxQuestions: 15, maxDrills: 3 } });
    const next = cultureInterviewReducer(state, { type: 'DRILL', targetTurnIndex: 0 });
    expect(next.currentDrill).toEqual({ targetTurnIndex: 0, attempts: 0, maxAttempts: 3 });
  });

  it('DRILL_ANSWER updates pending turn and increments attempts', () => {
    const state = makeInitialState({
      phase: 'drilling',
      currentDrill: { targetTurnIndex: 0, attempts: 0, maxAttempts: 2 },
      turns: [
        {
          idx: 0,
          questionId: 'q1',
          questionText: 'Q1',
          probeOf: null,
          candidateResponse: 'First answer.',
          starSlots: null,
          timestamp: '2024-01-01T00:00:00Z',
          phase: 'rapport_building',
        },
        {
          idx: 1,
          questionId: 'q1',
          questionText: 'Probe?',
          probeOf: 'q1',
          candidateResponse: null,
          starSlots: null,
          timestamp: '2024-01-01T00:00:01Z',
          phase: 'drilling',
        },
      ],
    });
    const starSlots = {
      S: { present: true, specificity: 1 },
      T: { present: true, specificity: 1 },
      A: { present: false, specificity: 0 },
      R: { present: false, specificity: 0 },
    };
    const next = cultureInterviewReducer(state, {
      type: 'DRILL_ANSWER',
      answer: 'Drill answer.',
      starSlots,
    });
    expect(next.turns[1]!.candidateResponse).toBe('Drill answer.');
    expect(next.turns[1]!.starSlots).toEqual(starSlots);
    expect(next.currentDrill!.attempts).toBe(1);
  });

  it('ADVANCE_PHASE updates phase and clears currentDrill when returning to probing', () => {
    const state = makeInitialState({
      phase: 'drilling',
      currentDrill: { targetTurnIndex: 0, attempts: 2, maxAttempts: 2 },
    });
    const next = cultureInterviewReducer(state, {
      type: 'ADVANCE_PHASE',
      nextPhase: 'probing',
    });
    expect(next.phase).toBe('probing');
    expect(next.currentDrill).toBeNull();
    expect(next.phaseHistory).toHaveLength(1);
  });

  it('ADVANCE_PHASE preserves currentDrill when not returning to probing', () => {
    const state = makeInitialState({
      phase: 'probing',
      currentDrill: { targetTurnIndex: 0, attempts: 0, maxAttempts: 2 },
    });
    const next = cultureInterviewReducer(state, {
      type: 'ADVANCE_PHASE',
      nextPhase: 'drilling',
    });
    expect(next.phase).toBe('drilling');
    expect(next.currentDrill).not.toBeNull();
  });

  it('SCORE_COMPLETE transitions to complete', () => {
    const state = makeInitialState({ phase: 'scoring' });
    const next = cultureInterviewReducer(state, {
      type: 'SCORE_COMPLETE',
      scoreReport: { scoredAt: new Date().toISOString() },
    });
    expect(next.phase).toBe('complete');
    expect(next.pendingNodes).toHaveLength(0);
  });

  it('NODES_PERSISTED clears pendingNodes', () => {
    const state = makeInitialState({
      pendingNodes: [
        { id: 'n1', label: 'Node 1', dimension: 'ownership', evidenceTurnIndex: 0 },
      ],
    });
    const next = cultureInterviewReducer(state, { type: 'NODES_PERSISTED' });
    expect(next.pendingNodes).toHaveLength(0);
  });

  it('unknown action returns state unchanged', () => {
    const state = makeInitialState();
    const next = cultureInterviewReducer(state, { type: 'UNKNOWN' } as unknown as InterviewAction);
    expect(next).toBe(state);
  });
});
