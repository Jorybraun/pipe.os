/**
 * Role Discovery Agent Plugin
 *
 * Registers the role discovery agent with the Unified Agent Runtime.
 * Stub for Phase 2 migration.
 */

import type { AgentPlugin, AgentTurn, AgentSession } from '../../unifiedAgentRuntime/types';
import { callProvider } from '../../unifiedAgentRuntime/provider';
import {
  buildRoleAgentSystemPrompt,
  buildRoleAgentUserMessage,
  buildConversationContext,
  buildPhaseDirective,
  selectPhasePrompt,
  buildSynthesisPrompt,
} from './prompts';
import { checkQuestion, buildGuardNudge } from '../question/guard';
import type { RoleExchange, ConversationPhase } from '../../../types';

const MAX_GUARD_RETRIES = 2;

export const roleDiscoveryPlugin: AgentPlugin = {
  type: 'role_discovery',

  fsmConfig: {
    canAdvance: () => true,
    canTerminate: (session) => {
      const budget = (session.transcript.scratchpad.questionBudget as number) ?? 8;
      const isComplete = (session.transcript.scratchpad.isComplete as boolean) ?? false;
      return isComplete || session.transcript.turns.length >= budget;
    },
    minTurns: 1,
    maxTurns: 20,
  },

  async generateTurn(session, context: any, provider): Promise<AgentTurn> {
    if (!provider) {
      throw new Error('LLM provider is required for role discovery');
    }

    const baseline = context?.baseline || {};
    const participantRole = context?.participantRole || 'HIRING_MANAGER';
    const knowledgeState = (session.transcript.scratchpad.knowledgeState as any) || {};
    const questionBudget = (session.transcript.scratchpad.questionBudget as number) ?? 8;
    const questionsAsked = session.transcript.turns.length;

    // 1. Build ConversationContext from knowledgeState
    const exchanges: RoleExchange[] = session.transcript.turns.map((t) => ({
      questionId: t.questionId || `q-${t.idx + 1}`,
      question: t.questionText,
      answer: t.candidateResponse || '',
      acknowledgment: (t.metadata?.acknowledgment as string) || '',
    }));

    const convContext = buildConversationContext(knowledgeState, exchanges);

    // 2. Determine Phase via deterministic controller
    const directive = buildPhaseDirective(convContext, questionsAsked, questionBudget);

    // 3. Select System Prompt based on Phase
    let systemPrompt: string;
    let userMessage: string;

    if (directive.synthesisAllowed && questionsAsked >= questionBudget) {
      // Synthesis Phase
      systemPrompt = buildRoleAgentSystemPrompt(participantRole);
      userMessage = buildSynthesisPrompt({
        baseline,
        exchanges,
        knowledgeState,
      });
    } else {
      // Interviewing Phase
      const phasePrompt = selectPhasePrompt(directive.phase, participantRole);
      // Combine with core logic but use phase-specific posture
      systemPrompt = `${buildRoleAgentSystemPrompt(participantRole)}\n\n${phasePrompt}\n\nCURRENT PHASE FOCUS: ${directive.focusGoal}`;
      userMessage = buildRoleAgentUserMessage({
        baseline,
        exchanges,
        knowledgeState,
        questionsAsked,
        questionBudget,
        domainCoverage: convContext.domainCoverage as any,
      });
    }

    let messages = [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: userMessage },
    ];

    // Guard retry loop — up to MAX_GUARD_RETRIES regenerations on compliance block
    let parsed: any;
    let guardViolations: string[] = [];
    for (let attempt = 0; attempt <= MAX_GUARD_RETRIES; attempt++) {
      const result = await callProvider(provider, messages, {
        forceJson: true,
        maxTokens: 2000,
        budgetLabel: 'role_discovery',
        signal: undefined,
      });
      parsed = JSON.parse(result.content);

      // Skip guard check on synthesis turns (no question to validate)
      if (parsed.persona && parsed.jobDescription) break;

      const questionText = parsed.question?.text ?? '';
      const guardResult = checkQuestion({
        text: questionText,
        acknowledgment: parsed.acknowledgment,
        participantRole,
        previousQuestions: exchanges.map((e) => e.question),
      });

      if (guardResult.passed) {
        guardViolations = [];
        break;
      }

      guardViolations = guardResult.violations.map((v) => `[${v.severity.toUpperCase()}] ${v.ruleId}: ${v.reason}`);
      console.warn(`[roleDiscoveryPlugin] Guard failed (attempt ${attempt + 1}):`, guardViolations);

      if (attempt < MAX_GUARD_RETRIES) {
        // Inject guard nudge and retry
        const nudge = buildGuardNudge(guardResult);
        messages = [
          ...messages,
          { role: 'assistant' as const, content: result.content },
          { role: 'user' as const, content: nudge },
        ];
      } else {
        // Max retries exceeded — log and surface a safe fallback question
        console.error('[roleDiscoveryPlugin] Guard max retries exceeded. Using safe fallback question.');
        parsed.question = {
          ...(parsed.question || {}),
          id: parsed.question?.id ?? `q-fallback`,
          text: 'Tell me more about what success looks like in this role.',
          goal: 'Safe fallback after compliance guard failure',
          input: { type: 'textarea' },
        };
        parsed.acknowledgment = parsed.acknowledgment ?? '';
      }
    }

    const idx = session.transcript.turns.length;

    // Update knowledgeState with phase and coverage
    const updatedKnowledgeState = {
      ...knowledgeState,
      ...(parsed.knowledgeStateUpdate || {}),
      _coverage: parsed.domainCoverage || convContext.domainCoverage,
      _phase: { phase: directive.phase },
    };

    session.transcript.scratchpad.knowledgeState = updatedKnowledgeState;
    session.transcript.scratchpad.domainCoverage = parsed.domainCoverage || convContext.domainCoverage;

    // Check if this is a final synthesis turn
    if (parsed.persona && parsed.jobDescription) {
      session.transcript.scratchpad.isComplete = true;
      session.transcript.scratchpad.persona = parsed.persona;
      session.transcript.scratchpad.jobDescription = parsed.jobDescription;
    }

    return {
      idx,
      questionId: parsed.question?.id,
      questionText: parsed.question?.text || (parsed.jobDescription ? 'Synthesis complete' : 'Next question'),
      candidateResponse: undefined,
      metadata: {
        reasoning: parsed.reasoning,
        acknowledgment: parsed.acknowledgment,
        goal: parsed.question?.goal,
        domainCoverage: parsed.domainCoverage,
        phase: directive.phase,
        directiveReasoning: directive.reasoning,
        guardViolations: guardViolations.length > 0 ? guardViolations : undefined,
      },
      timestamp: new Date().toISOString(),
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
