/**
 * Role Discovery Agent Plugin
 *
 * Registers the role discovery agent with the Unified Agent Runtime.
 * Stub for Phase 2 migration.
 */

import type { AgentPlugin, AgentTurn } from '../../unifiedAgentRuntime/types';

export const roleDiscoveryPlugin: AgentPlugin = {
  type: 'role_discovery',

  fsmConfig: {
    canAdvance: () => true,
    canTerminate: (session) => {
      const budget = (session.transcript.scratchpad.questionBudget as number) ?? 8;
      return session.transcript.turns.length >= budget;
    },
    minTurns: 1,
    maxTurns: 20,
  },

  async generateTurn(session): Promise<AgentTurn> {
    const idx = session.transcript.turns.length;
    return {
      idx,
      questionText: `Mock question #${idx + 1} for role discovery`,
      timestamp: new Date().toISOString(),
      questionId: undefined,
      candidateResponse: undefined,
      metadata: { phase: 'DISCOVERY' },
    };
  },

  evalConfig: {
    dimensions: [
      {
        id: 'goal_alignment',
        promptTemplate: `Evaluate whether this question advances the goal of understanding the role. Return JSON: { "verdict": "pass"|"fail"|"warn", "score": 0-1, "reason": "..." }`,
        model: undefined,
        weight: undefined,
      },
      {
        id: 'tone',
        promptTemplate: `Evaluate whether the tone is conversational (not interrogative). Return JSON: { "verdict": "pass"|"fail"|"warn", "score": 0-1, "reason": "..." }`,
        model: undefined,
        weight: undefined,
      },
    ],
    approvalRule: 'all_pass',
    minScore: undefined,
    maxRetries: undefined,
  },

  scoringConfig: undefined,
};
