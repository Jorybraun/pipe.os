import { describe, it, expect } from 'vitest';
import { buildPhaseDirective } from '../culturePhaseDirective';
import type { InterviewStateV2 } from '../cultureInterviewState';

function makeState(overrides: Partial<InterviewStateV2> = {}): InterviewStateV2 {
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

describe('buildPhaseDirective', () => {
  it('consent → rapport_building', () => {
    const d = buildPhaseDirective(makeState({ phase: 'consent' }));
    expect(d.nextPhase).toBe('rapport_building');
  });

  it('rapport_building stays until 2 seed turns', () => {
    const state = makeState({
      phase: 'rapport_building',
      turns: [
        { idx: 0, questionId: 'q1', questionText: 'Q1', probeOf: null, candidateResponse: 'A1', starSlots: null, timestamp: '', phase: 'rapport_building' },
      ],
    });
    const d = buildPhaseDirective(state);
    expect(d.nextPhase).toBe('rapport_building');
  });

  it('rapport_building → probing after 2 seed turns', () => {
    const state = makeState({
      phase: 'rapport_building',
      turns: [
        { idx: 0, questionId: 'q1', questionText: 'Q1', probeOf: null, candidateResponse: 'A1', starSlots: null, timestamp: '', phase: 'rapport_building' },
        { idx: 1, questionId: 'q2', questionText: 'Q2', probeOf: null, candidateResponse: 'A2', starSlots: null, timestamp: '', phase: 'rapport_building' },
      ],
    });
    const d = buildPhaseDirective(state);
    expect(d.nextPhase).toBe('probing');
  });

  it('probing stays when coverage incomplete and under max', () => {
    const state = makeState({
      phase: 'probing',
      turns: [
        { idx: 0, questionId: 'q1', questionText: 'Q1', probeOf: null, candidateResponse: 'A1', starSlots: null, timestamp: '', phase: 'probing' },
      ],
      coverage: { dimensions: [], gaps: ['ownership'], isComplete: false, probeRecommendations: [], summary: '' },
    });
    const d = buildPhaseDirective(state);
    expect(d.nextPhase).toBe('probing');
  });

  it('probing → wrap_up when hard cap reached', () => {
    const state = makeState({
      phase: 'probing',
      turns: Array.from({ length: 15 }, (_, i) => ({
        idx: i,
        questionId: `q${i}`,
        questionText: `Q${i}`,
        probeOf: null,
        candidateResponse: 'A',
        starSlots: null,
        timestamp: '',
        phase: 'probing' as const,
      })),
      coverage: { dimensions: [], gaps: ['ownership'], isComplete: false, probeRecommendations: [], summary: '' },
    });
    const d = buildPhaseDirective(state);
    expect(d.nextPhase).toBe('wrap_up');
  });

  it('probing → wrap_up when coverage complete and min met', () => {
    const state = makeState({
      phase: 'probing',
      turns: Array.from({ length: 5 }, (_, i) => ({
        idx: i,
        questionId: `q${i}`,
        questionText: `Q${i}`,
        probeOf: null,
        candidateResponse: 'A',
        starSlots: null,
        timestamp: '',
        phase: 'probing' as const,
      })),
      coverage: { dimensions: [], gaps: [], isComplete: true, probeRecommendations: [], summary: '' },
    });
    const d = buildPhaseDirective(state);
    expect(d.nextPhase).toBe('wrap_up');
  });

  it('probing → drilling when currentDrill exists', () => {
    const state = makeState({
      phase: 'probing',
      currentDrill: { targetTurnIndex: 0, attempts: 0, maxAttempts: 2 },
    });
    const d = buildPhaseDirective(state);
    expect(d.nextPhase).toBe('drilling');
  });

  it('drilling stays when attempts under max', () => {
    const state = makeState({
      phase: 'drilling',
      currentDrill: { targetTurnIndex: 0, attempts: 1, maxAttempts: 2 },
    });
    const d = buildPhaseDirective(state);
    expect(d.nextPhase).toBe('drilling');
  });

  it('drilling → probing when max attempts reached', () => {
    const state = makeState({
      phase: 'drilling',
      currentDrill: { targetTurnIndex: 0, attempts: 2, maxAttempts: 2 },
    });
    const d = buildPhaseDirective(state);
    expect(d.nextPhase).toBe('probing');
  });

  it('wrap_up stays until 2 seed turns', () => {
    const state = makeState({
      phase: 'wrap_up',
      turns: [
        { idx: 0, questionId: 'q1', questionText: 'Q1', probeOf: null, candidateResponse: 'A1', starSlots: null, timestamp: '', phase: 'wrap_up' },
      ],
    });
    const d = buildPhaseDirective(state);
    expect(d.nextPhase).toBe('wrap_up');
  });

  it('wrap_up → scoring after 2 seed turns', () => {
    const state = makeState({
      phase: 'wrap_up',
      turns: [
        { idx: 0, questionId: 'q1', questionText: 'Q1', probeOf: null, candidateResponse: 'A1', starSlots: null, timestamp: '', phase: 'wrap_up' },
        { idx: 1, questionId: 'q2', questionText: 'Q2', probeOf: null, candidateResponse: 'A2', starSlots: null, timestamp: '', phase: 'wrap_up' },
      ],
    });
    const d = buildPhaseDirective(state);
    expect(d.nextPhase).toBe('scoring');
  });

  it('scoring stays in scoring', () => {
    const d = buildPhaseDirective(makeState({ phase: 'scoring' }));
    expect(d.nextPhase).toBe('scoring');
  });

  it('complete stays in complete', () => {
    const d = buildPhaseDirective(makeState({ phase: 'complete' }));
    expect(d.nextPhase).toBe('complete');
  });
});
