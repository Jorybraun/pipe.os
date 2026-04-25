/**
 * Culture Interview Agent Plugin
 *
 * Registers the culture interview agent with the Unified Agent Runtime.
 * Stub for Phase 4 build.
 */

import type { AgentPlugin, AgentTurn } from '../../unifiedAgentRuntime/types';

export const cultureInterviewPlugin: AgentPlugin = {
  type: 'culture_interview',

  fsmConfig: {
    canAdvance: () => true,
    canTerminate: (session) => {
      const covered = (session.transcript.scratchpad.dimensionsCovered as string[]) ?? [];
      return covered.length >= 5;
    },
    minTurns: 5,
    maxTurns: 20,
  },

  async generateTurn(session): Promise<AgentTurn> {
    const idx = session.transcript.turns.length;
    return {
      idx,
      questionText: `Mock culture interview turn #${idx + 1}`,
      timestamp: new Date().toISOString(),
      questionId: undefined,
      candidateResponse: undefined,
      metadata: { dimension: 'teamwork' },
    };
  },

  evalConfig: {
    dimensions: [
      {
        id: 'star_completeness',
        promptTemplate: `Check that the candidate's response contains STAR elements. Return JSON: { "verdict": "pass"|"fail"|"warn", "score": 0-1, "reason": "..." }`,
        model: undefined,
        weight: 0.5,
      },
      {
        id: 'probe_appropriateness',
        promptTemplate: `Check that the probe is appropriate for the dimension. Return JSON: { "verdict": "pass"|"fail"|"warn", "score": 0-1, "reason": "..." }`,
        model: undefined,
        weight: 0.3,
      },
      {
        id: 'evasion_detection',
        promptTemplate: `Check for evasion or deflection in the candidate response. Return JSON: { "verdict": "pass"|"fail"|"warn", "score": 0-1, "reason": "..." }`,
        model: undefined,
        weight: 0.2,
      },
    ],
    approvalRule: 'weighted',
    minScore: 0.6,
    maxRetries: undefined,
  },

  scoringConfig: {
    dimensions: [
      { id: 'ownership', weight: 0.1, promptTemplate: 'Score ownership 1-5', model: undefined },
      { id: 'collaboration', weight: 0.1, promptTemplate: 'Score collaboration 1-5', model: undefined },
      { id: 'adaptability', weight: 0.1, promptTemplate: 'Score adaptability 1-5', model: undefined },
      { id: 'communication', weight: 0.1, promptTemplate: 'Score communication 1-5', model: undefined },
      { id: 'problem_solving', weight: 0.1, promptTemplate: 'Score problem solving 1-5', model: undefined },
      { id: 'clan_affinity', weight: 0.1, promptTemplate: 'Score clan affinity 1-5', model: undefined },
      { id: 'adhocracy_affinity', weight: 0.1, promptTemplate: 'Score adhocracy affinity 1-5', model: undefined },
      { id: 'market_affinity', weight: 0.1, promptTemplate: 'Score market affinity 1-5', model: undefined },
      { id: 'hierarchy_affinity', weight: 0.1, promptTemplate: 'Score hierarchy affinity 1-5', model: undefined },
      { id: 'psychological_safety', weight: 0.1, promptTemplate: 'Score psychological safety 1-5', model: undefined },
    ],
    groundingRequirement: true,
    synthesisTemplate: `Synthesize a culture fit assessment. Return JSON: { "narrative": "...", "recommendation": "hire"|"flag"|"pass" }`,
  },
};
