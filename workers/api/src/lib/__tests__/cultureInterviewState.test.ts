import { describe, it, expect } from 'vitest';
import {
  reconstructStateFromTranscript,
  serializeStateToTranscript,
  recomputeCoverage,
  seedQuestionsAsked,
  findPendingTurnIndex,
} from '../cultureInterviewState';
import type { CultureTranscriptLike } from '../cultureInterviewState';
import { COMPETENCY_DIMENSIONS } from '../cultureQuestionBank';
import { PROFILE_PROBE_DIMENSIONS } from '../profileProbeBank';

describe('reconstructStateFromTranscript', () => {
  it('reconstructs a fresh v1 transcript into valid v2 state', () => {
    const transcript: CultureTranscriptLike = {
      turns: [],
      scratchpad: {
        dimensionCoverage: { ownership: 0, collaboration: 0 },
        probesUsedForCurrentQ: 0,
        runningThemes: [],
        mode: 'role_fit',
      },
    };
    const state = reconstructStateFromTranscript(transcript);
    expect(state.version).toBe('v2');
    expect(state.phase).toBe('consent');
    expect(state.turns).toHaveLength(0);
    expect(state.config.mode).toBe('role_fit');
  });

  it('restores saved v2 fields from scratchpad', () => {
    const transcript: CultureTranscriptLike = {
      turns: [
        {
          idx: 0,
          questionId: 'q1',
          questionText: 'Q1',
          probeOf: null,
          candidateResponse: 'A1',
          starSlots: {
            S: { present: true, specificity: 2 },
            T: { present: true, specificity: 2 },
            A: { present: true, specificity: 2 },
            R: { present: true, specificity: 2 },
          },
          timestamp: '2024-01-01T00:00:00Z',
        },
      ],
      scratchpad: {
        dimensionCoverage: {},
        probesUsedForCurrentQ: 0,
        runningThemes: [],
        mode: 'role_fit',
        phase: 'probing',
        phaseHistory: [{ phase: 'rapport_building', enteredAt: 1_700_000_000_000 }],
        currentDrill: { targetTurnIndex: 0, attempts: 1, maxAttempts: 2 },
      },
    };
    const state = reconstructStateFromTranscript(transcript);
    expect(state.phase).toBe('probing');
    expect(state.phaseHistory).toHaveLength(1);
    expect(state.currentDrill).toEqual({ targetTurnIndex: 0, attempts: 1, maxAttempts: 2 });
  });

  it('computes coverage from STAR-analyzed turns', () => {
    const transcript: CultureTranscriptLike = {
      turns: [
        {
          idx: 0,
          questionId: 'ownership-001',
          questionText: 'Q1',
          probeOf: null,
          candidateResponse: 'A1',
          starSlots: {
            S: { present: true, specificity: 2 },
            T: { present: true, specificity: 2 },
            A: { present: true, specificity: 2 },
            R: { present: true, specificity: 2 },
          },
          timestamp: '2024-01-01T00:00:00Z',
        },
      ],
      scratchpad: {
        dimensionCoverage: {},
        probesUsedForCurrentQ: 0,
        runningThemes: [],
        mode: 'role_fit',
      },
    };
    const state = reconstructStateFromTranscript(transcript);
    const ownership = state.coverage.dimensions.find((d) => d.dimension === 'ownership');
    expect(ownership).toBeDefined();
    expect(ownership!.depthScore).toBeGreaterThan(0);
  });

  it('ignores probe turns for coverage computation', () => {
    const transcript: CultureTranscriptLike = {
      turns: [
        {
          idx: 0,
          questionId: 'ownership-001',
          questionText: 'Q1',
          probeOf: null,
          candidateResponse: 'A1',
          starSlots: {
            S: { present: true, specificity: 2 },
            T: { present: true, specificity: 2 },
            A: { present: false, specificity: 0 },
            R: { present: false, specificity: 0 },
          },
          timestamp: '2024-01-01T00:00:00Z',
        },
        {
          idx: 1,
          questionId: 'ownership-001',
          questionText: 'Probe?',
          probeOf: 'ownership-001',
          candidateResponse: 'A2',
          starSlots: {
            S: { present: true, specificity: 2 },
            T: { present: true, specificity: 2 },
            A: { present: true, specificity: 2 },
            R: { present: true, specificity: 2 },
          },
          timestamp: '2024-01-01T00:00:01Z',
        },
      ],
      scratchpad: {
        dimensionCoverage: {},
        probesUsedForCurrentQ: 1,
        runningThemes: [],
        mode: 'role_fit',
      },
    };
    const state = reconstructStateFromTranscript(transcript);
    // Only the seed turn should contribute.
    const ownership = state.coverage.dimensions.find((d) => d.dimension === 'ownership');
    expect(ownership).toBeDefined();
    // Seed turn has 2/4 slots present with avg specificity 2 -> depthScore = 1.0.
    expect(ownership!.depthScore).toBe(1);
  });

  it('sets profile_builder dimensions correctly', () => {
    const transcript: CultureTranscriptLike = {
      turns: [],
      scratchpad: {
        dimensionCoverage: {},
        probesUsedForCurrentQ: 0,
        runningThemes: [],
        mode: 'profile_builder',
      },
    };
    const state = reconstructStateFromTranscript(transcript);
    expect(state.config.mode).toBe('profile_builder');
    expect(state.coverage.dimensions.map((d) => d.dimension)).toEqual(
      expect.arrayContaining(PROFILE_PROBE_DIMENSIONS as string[]),
    );
  });
});

describe('serializeStateToTranscript', () => {
  it('round-trips v2 fields through scratchpad', () => {
    const state = reconstructStateFromTranscript({
      turns: [],
      scratchpad: {
        dimensionCoverage: {},
        probesUsedForCurrentQ: 0,
        runningThemes: [],
        mode: 'role_fit',
      },
    });
    const tx = serializeStateToTranscript(state);
    expect(tx.scratchpad.phase).toBeDefined();
    expect(tx.scratchpad.phaseHistory).toBeDefined();
    expect(tx.scratchpad.currentDrill).toBeDefined();
  });

  it('produces a structurally valid transcript', () => {
    const state = reconstructStateFromTranscript({
      turns: [
        {
          idx: 0,
          questionId: 'q1',
          questionText: 'Q1',
          probeOf: null,
          candidateResponse: 'A1',
          starSlots: null,
          timestamp: '2024-01-01T00:00:00Z',
        },
      ],
      scratchpad: {
        dimensionCoverage: {},
        probesUsedForCurrentQ: 0,
        runningThemes: [],
        mode: 'role_fit',
      },
    });
    const tx = serializeStateToTranscript(state);
    expect(tx.turns).toHaveLength(1);
    expect(tx.turns[0]!.questionId).toBe('q1');
    expect(tx.scratchpad.mode).toBe('role_fit');
  });
});

describe('recomputeCoverage', () => {
  it('recalculates coverage after turns change', () => {
    const state = reconstructStateFromTranscript({
      turns: [
        {
          idx: 0,
          questionId: 'ownership-001',
          questionText: 'Q1',
          probeOf: null,
          candidateResponse: 'A1',
          starSlots: {
            S: { present: true, specificity: 2 },
            T: { present: true, specificity: 2 },
            A: { present: true, specificity: 2 },
            R: { present: true, specificity: 2 },
          },
          timestamp: '2024-01-01T00:00:00Z',
        },
      ],
      scratchpad: {
        dimensionCoverage: {},
        probesUsedForCurrentQ: 0,
        runningThemes: [],
        mode: 'role_fit',
      },
    });
    const coverage = recomputeCoverage(state);
    const ownership = coverage.dimensions.find((d) => d.dimension === 'ownership');
    expect(ownership!.completeness).toBe(1);
    expect(ownership!.depthScore).toBeGreaterThan(0);
  });
});

describe('seedQuestionsAsked', () => {
  it('counts only seed turns', () => {
    const state = reconstructStateFromTranscript({
      turns: [
        { idx: 0, questionId: 'q1', questionText: 'Q1', probeOf: null, candidateResponse: 'A1', starSlots: null, timestamp: '' },
        { idx: 1, questionId: 'q1', questionText: 'Probe', probeOf: 'q1', candidateResponse: 'A2', starSlots: null, timestamp: '' },
        { idx: 2, questionId: 'q2', questionText: 'Q2', probeOf: null, candidateResponse: 'A3', starSlots: null, timestamp: '' },
      ],
      scratchpad: { dimensionCoverage: {}, probesUsedForCurrentQ: 0, runningThemes: [], mode: 'role_fit' },
    });
    expect(seedQuestionsAsked(state)).toBe(2);
  });
});

describe('findPendingTurnIndex', () => {
  it('returns the last turn with no candidateResponse', () => {
    const state = reconstructStateFromTranscript({
      turns: [
        { idx: 0, questionId: 'q1', questionText: 'Q1', probeOf: null, candidateResponse: 'A1', starSlots: null, timestamp: '' },
        { idx: 1, questionId: 'q2', questionText: 'Q2', probeOf: null, candidateResponse: null, starSlots: null, timestamp: '' },
      ],
      scratchpad: { dimensionCoverage: {}, probesUsedForCurrentQ: 0, runningThemes: [], mode: 'role_fit' },
    });
    expect(findPendingTurnIndex(state)).toBe(1);
  });

  it('returns -1 when no pending turn', () => {
    const state = reconstructStateFromTranscript({
      turns: [
        { idx: 0, questionId: 'q1', questionText: 'Q1', probeOf: null, candidateResponse: 'A1', starSlots: null, timestamp: '' },
      ],
      scratchpad: { dimensionCoverage: {}, probesUsedForCurrentQ: 0, runningThemes: [], mode: 'role_fit' },
    });
    expect(findPendingTurnIndex(state)).toBe(-1);
  });
});
