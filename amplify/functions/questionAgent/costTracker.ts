/**
 * Cost Tracking Middleware
 *
 * Tracks AI API costs against session budget to prevent overruns.
 * Circuit breaker activates at 90% of budget.
 */

export interface CostTracker {
  totalTokensUsed: number;
  estimatedCost: number;
  callCount: number;
  budget: number;
  warningThreshold: number;
}

/**
 * Creates a new cost tracker with specified budget.
 *
 * @param budget - Maximum allowed cost in USD (default: $0.50)
 * @returns Initialized cost tracker
 */
export function createCostTracker(budget: number = 0.50): CostTracker {
  return {
    totalTokensUsed: 0,
    estimatedCost: 0,
    callCount: 0,
    budget,
    warningThreshold: budget * 0.9,  // 90% of budget
  };
}

/**
 * Tracks cost for an AI API call.
 *
 * @param tracker - Cost tracker instance
 * @param inputTokens - Number of input tokens used
 * @param outputTokens - Number of output tokens used
 * @throws Error if budget exceeded
 */
export function trackCost(
  tracker: CostTracker,
  inputTokens: number,
  outputTokens: number
): void {
  const inputCost = (inputTokens / 1_000_000) * parseFloat(process.env.CLAUDE_INPUT_COST_PER_M!);
  const outputCost = (outputTokens / 1_000_000) * parseFloat(process.env.CLAUDE_OUTPUT_COST_PER_M!);

  tracker.totalTokensUsed += inputTokens + outputTokens;
  tracker.estimatedCost += inputCost + outputCost;
  tracker.callCount += 1;

  if (tracker.estimatedCost > tracker.warningThreshold) {
    console.warn('[Cost] Approaching budget limit:', {
      current: tracker.estimatedCost.toFixed(4),
      budget: tracker.budget,
      remaining: (tracker.budget - tracker.estimatedCost).toFixed(4),
      callCount: tracker.callCount,
    });
  }

  if (tracker.estimatedCost > tracker.budget) {
    throw new Error(
      `COST_BUDGET_EXCEEDED: Session cost $${tracker.estimatedCost.toFixed(2)} exceeds budget $${tracker.budget}`
    );
  }
}

/**
 * Returns remaining budget.
 *
 * @param tracker - Cost tracker instance
 * @returns Remaining budget in USD
 */
export function getRemainingBudget(tracker: CostTracker): number {
  return Math.max(0, tracker.budget - tracker.estimatedCost);
}

/**
 * Returns cost tracking summary for client response.
 *
 * @param tracker - Cost tracker instance
 * @returns Cost tracking summary
 */
export function getCostingSummary(tracker: CostTracker): {
  sessionCost: number;
  remainingBudget: number;
  callCount: number;
} {
  return {
    sessionCost: parseFloat(tracker.estimatedCost.toFixed(4)),
    remainingBudget: parseFloat(getRemainingBudget(tracker).toFixed(4)),
    callCount: tracker.callCount,
  };
}
