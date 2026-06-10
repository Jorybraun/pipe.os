import { describe, it, expect } from 'vitest';
import {
  startCultureInterview,
  advanceCultureInterview,
  defaultCultureTranscript,
  type CultureTranscript,
} from '../cultureAgent';
import { PROFILE_PROBE_DIMENSIONS, PROFILE_PROBE_BANK } from '../profileProbeBank';
import { COMPETENCY_DIMENSIONS, CULTURE_QUESTION_BANK } from '../cultureQuestionBank';

// A mock provider that returns the analysis we want.
function makeMockProvider(response: unknown) {
  return {
    complete: async () => ({ content: JSON.stringify(response) }),
  };
}

const ADEQUATE_STAR = {
  star_slots: {
    S: { present: true, specificity: 2 },
    T: { present: true, specificity: 2 },
    A: { present: true, specificity: 2 },
    R: { present: true, specificity: 2 },
  },
  acknowledgment: 'Thanks for that.',
  probe_needed: false,
  probe_text: null,
  reasoning: 'Full STAR.',
  running_theme_to_add: null,
};

describe('cultureAgent — profile_builder mode', () => {
  it('startCultureInterview returns a profile probe', () => {
    const result = startCultureInterview({ mode: 'profile_builder' });
    expect(result.transcript.scratchpad.mode).toBe('profile_builder');
    expect(result.nextQuestion.text.length).toBeGreaterThan(0);
    expect(result.transcript.turns.length).toBe(1);
  });

  it('default transcript uses profile_builder mode and profile coverage', () => {
    const transcript = defaultCultureTranscript();
    expect(transcript.scratchpad.mode).toBe('profile_builder');
    for (const dim of PROFILE_PROBE_DIMENSIONS) {
      expect(transcript.scratchpad.dimensionCoverage[dim]).toBe(0);
    }
  });

  it('advances through probes and updates coverage', async () => {
    let result = startCultureInterview({ mode: 'profile_builder' });
    let transcript = result.transcript;

    // Answer the first probe.
    result = await advanceCultureInterview({
      provider: makeMockProvider(ADEQUATE_STAR) as unknown as import('../llm/types').LLMProvider,
      transcript,
      candidateAnswer: 'I worked at Acme for two years as a senior engineer.',
    });

    expect(result.action).toBe('next');
    transcript = result.transcript;

    // Coverage should have been updated for the first probe's dimension.
    const firstDim = transcript.turns[0]!.questionId.startsWith('career-history')
      ? 'career_history'
      : 'behavioral_depth';
    expect(transcript.scratchpad.dimensionCoverage[firstDim]).toBeGreaterThanOrEqual(0);
  });

  it('terminates when all profile dimensions are covered', async () => {
    // Build a transcript with all dimensions covered via rich STAR slots.
    const transcript: CultureTranscript = {
      turns: [],
      scratchpad: {
        dimensionCoverage: {
          career_history: 1,
          behavioral_depth: 1,
          cultural: 1,
          technical: 1,
          motivation: 1,
          context: 1,
        },
        probesUsedForCurrentQ: 0,
        runningThemes: [],
        mode: 'profile_builder',
        questionMetadata: [],
      },
    };

    // Add one completed turn per dimension with full STAR slots.
    const dims = PROFILE_PROBE_DIMENSIONS;
    const probesByDim = new Map<string, typeof PROFILE_PROBE_BANK[number]>();
    for (const probe of PROFILE_PROBE_BANK) {
      if (!probesByDim.has(probe.dimension)) {
        probesByDim.set(probe.dimension, probe);
      }
    }

    let idx = 0;
    for (const dim of dims) {
      const probe = probesByDim.get(dim);
      if (!probe) continue;
      transcript.turns.push({
        idx,
        questionId: probe.id,
        questionText: 'Question text',
        probeOf: null,
        candidateResponse: 'Answer with full STAR.',
        starSlots: {
          S: { present: true, specificity: 2 },
          T: { present: true, specificity: 2 },
          A: { present: true, specificity: 2 },
          R: { present: true, specificity: 2 },
        },
        timestamp: new Date().toISOString(),
      });
      idx++;
    }

    // Add a pending turn.
    const pendingProbe = PROFILE_PROBE_BANK.find(
      (p) => !Array.from(probesByDim.values()).map((q) => q.id).includes(p.id),
    ) ?? PROFILE_PROBE_BANK[0]!;
    transcript.turns.push({
      idx,
      questionId: pendingProbe.id,
      questionText: 'Question text',
      probeOf: null,
      candidateResponse: null,
      starSlots: null,
      timestamp: new Date().toISOString(),
    });

    const result = await advanceCultureInterview({
      provider: makeMockProvider(ADEQUATE_STAR) as unknown as import('../llm/types').LLMProvider,
      transcript,
      candidateAnswer: 'Final answer.',
      minQuestions: 1,
    });

    expect(result.action).toBe('terminate');
    expect(result.terminationReason).toBe('coverage_complete');
  });
});

describe('cultureAgent — probe dedup guard', () => {
  it('never asks the same probe text twice in a session', async () => {
    const q = CULTURE_QUESTION_BANK[0]!;
    const probeText = 'What did you specifically do in that situation?';
    const transcript: CultureTranscript = {
      turns: [
        {
          idx: 0,
          questionId: q.id,
          questionText: q.text,
          probeOf: null,
          candidateResponse: 'A short first answer.',
          starSlots: {
            S: { present: true, specificity: 1 },
            T: { present: false, specificity: 0 },
            A: { present: false, specificity: 0 },
            R: { present: false, specificity: 0 },
          },
          timestamp: new Date().toISOString(),
        },
        {
          idx: 1,
          questionId: `probe-${q.id}-1`,
          questionText: probeText,
          probeOf: q.id,
          candidateResponse: null,
          starSlots: null,
          timestamp: new Date().toISOString(),
        },
      ],
      scratchpad: {
        dimensionCoverage: { ownership: 0, collaboration: 0, 'learning-orientation': 0, 'conflict-handling': 0, 'self-awareness': 0 },
        probesUsedForCurrentQ: 1,
        runningThemes: [],
        mode: 'role_fit',
        questionMetadata: [],
      },
    };

    const result = await advanceCultureInterview({
      provider: makeMockProvider({
        ...ADEQUATE_STAR,
        probe_needed: true,
        probe_text: probeText,
      }) as unknown as import('../llm/types').LLMProvider,
      transcript,
      candidateAnswer: 'Another short answer.',
    });

    const occurrences = result.transcript.turns.filter(
      (t) => t.questionText === probeText,
    );
    expect(occurrences.length).toBe(1);
  });
});

describe('cultureAgent — generative planner wiring', () => {
  const PLANNER_JSON = {
    question: 'You mentioned migrating Acme to Kubernetes — what part of that was yours alone to own?',
    targetDimension: 'ownership',
    targetSlots: ['S', 'T', 'A', 'R'],
    probeStrategy: { missing_A: 'What did you personally do there?' },
    personalizationAnchors: ['Acme Kubernetes migration'],
    reasoning: 'Ownership is uncovered.',
  };

  function makeGenerativeContext() {
    return {
      mode: 'role_fit' as const,
      candidate: { experiences: [], projects: [], skills: [], priorScreening: null },
      role: { teamStories: [], conflicts: [], dealbreakers: [], cultureProfile: {}, barsOverrides: [] },
      coverage: {},
      turnsUsed: 0,
      priorQuestions: [],
      runningThemes: [],
      maxQuestions: 15,
      minQuestions: 5,
    };
  }

  // Routes planner calls (identified by the dedup block in the planner prompt)
  // to planner JSON, and turn-analysis calls to the STAR analysis JSON.
  function makeDualProvider() {
    return {
      complete: async (messages: Array<{ role: string; content: string }>) => {
        const user = messages.find((m) => m.role === 'user')?.content ?? '';
        if (user.includes('DO NOT REPEAT')) {
          return { content: JSON.stringify(PLANNER_JSON) };
        }
        return { content: JSON.stringify(ADEQUATE_STAR) };
      },
    } as unknown as import('../llm/types').LLMProvider;
  }

  it('uses the generative planner for the next question when context is provided', async () => {
    let result = startCultureInterview({ mode: 'role_fit' });

    result = await advanceCultureInterview({
      provider: makeDualProvider(),
      transcript: result.transcript,
      candidateAnswer: 'A full STAR answer about a project I led at my last company.',
      generativeContext: makeGenerativeContext(),
    });

    expect(result.action).toBe('next');
    const pending = [...result.transcript.turns].reverse().find((t) => t.candidateResponse === null)!;
    expect(pending.questionId.startsWith('gen-')).toBe(true);
    expect(pending.questionText).toBe(PLANNER_JSON.question);

    const meta = result.transcript.scratchpad.questionMetadata?.find(
      (m) => m.questionId === pending.questionId,
    );
    expect(meta).toBeDefined();
    expect(meta!.targetDimension).toBe('ownership');
    expect(meta!.probes?.missing_A).toBe('What did you personally do there?');
  });

  it('falls back to the static bank when the planner output is unparseable', async () => {
    let result = startCultureInterview({ mode: 'role_fit' });

    const brokenPlannerProvider = {
      complete: async (messages: Array<{ role: string; content: string }>) => {
        const user = messages.find((m) => m.role === 'user')?.content ?? '';
        if (user.includes('DO NOT REPEAT')) {
          return { content: 'not json at all' };
        }
        return { content: JSON.stringify(ADEQUATE_STAR) };
      },
    } as unknown as import('../llm/types').LLMProvider;

    result = await advanceCultureInterview({
      provider: brokenPlannerProvider,
      transcript: result.transcript,
      candidateAnswer: 'A full STAR answer.',
      generativeContext: makeGenerativeContext(),
    });

    expect(result.action).toBe('next');
    const pending = [...result.transcript.turns].reverse().find((t) => t.candidateResponse === null)!;
    expect(pending.questionId.startsWith('gen-')).toBe(false);
    expect(CULTURE_QUESTION_BANK.some((q) => q.id === pending.questionId)).toBe(true);
  });
});

describe('cultureAgent — role_fit mode', () => {
  it('startCultureInterview returns a competency question', () => {
    const result = startCultureInterview({ mode: 'role_fit' });
    expect(result.transcript.scratchpad.mode).toBe('role_fit');
    expect(result.nextQuestion.text.length).toBeGreaterThan(0);
  });

  it('uses competency coverage in role_fit mode', () => {
    const result = startCultureInterview({ mode: 'role_fit' });
    for (const dim of COMPETENCY_DIMENSIONS) {
      expect(result.transcript.scratchpad.dimensionCoverage[dim]).toBe(0);
    }
  });

  it('terminates when all competency dimensions are covered', async () => {
    const transcript: CultureTranscript = {
      turns: [],
      scratchpad: {
        dimensionCoverage: {
          ownership: 1,
          collaboration: 1,
          'learning-orientation': 1,
          'conflict-handling': 1,
          'self-awareness': 1,
        },
        probesUsedForCurrentQ: 0,
        runningThemes: [],
        mode: 'role_fit',
        questionMetadata: [],
      },
    };

    // Add one completed turn per dimension with full STAR slots.
    const dims = COMPETENCY_DIMENSIONS;
    const qsByDim = new Map<string, typeof CULTURE_QUESTION_BANK[number]>();
    for (const q of CULTURE_QUESTION_BANK) {
      const primary = q.dimensions[0]!;
      if (!qsByDim.has(primary)) {
        qsByDim.set(primary, q);
      }
    }

    let idx = 0;
    for (const dim of dims) {
      const q = qsByDim.get(dim);
      if (!q) continue;
      transcript.turns.push({
        idx,
        questionId: q.id,
        questionText: 'Question',
        probeOf: null,
        candidateResponse: 'Answer with full STAR.',
        starSlots: {
          S: { present: true, specificity: 2 },
          T: { present: true, specificity: 2 },
          A: { present: true, specificity: 2 },
          R: { present: true, specificity: 2 },
        },
        timestamp: new Date().toISOString(),
      });
      idx++;
    }

    const pendingQ = CULTURE_QUESTION_BANK.find(
      (q) => !Array.from(qsByDim.values()).map((qq) => qq.id).includes(q.id),
    ) ?? CULTURE_QUESTION_BANK[0]!;
    transcript.turns.push({
      idx,
      questionId: pendingQ.id,
      questionText: 'Question',
      probeOf: null,
      candidateResponse: null,
      starSlots: null,
      timestamp: new Date().toISOString(),
    });

    const result = await advanceCultureInterview({
      provider: makeMockProvider(ADEQUATE_STAR) as unknown as import('../llm/types').LLMProvider,
      transcript,
      candidateAnswer: 'Final answer.',
      minQuestions: 1,
    });

    expect(result.action).toBe('terminate');
    expect(result.terminationReason).toBe('coverage_complete');
  });
});
