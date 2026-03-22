/**
 * Cost Tracking for codeReviewFollowUpAgent
 *
 * Tracks AI API costs against a per-invocation budget.
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
 * Creates a new cost tracker with the specified budget.
 */
export function createCostTracker(budget: number = 0.10): CostTracker {
  return {
    totalTokensUsed: 0,
    estimatedCost: 0,
    callCount: 0,
    budget,
    warningThreshold: budget * 0.9,
  };
}

/**
 * Tracks cost for a single AI API call.
 *
 * @throws Error if budget is exceeded
 */
export function trackCost(
  tracker: CostTracker,
  inputTokens: number,
  outputTokens: number
): void {
  const inputCostPerM = parseFloat(process.env.MODEL_INPUT_COST_PER_M ?? '3');
  const outputCostPerM = parseFloat(process.env.MODEL_OUTPUT_COST_PER_M ?? '9');

  const inputCost = (inputTokens / 1_000_000) * inputCostPerM;
  const outputCost = (outputTokens / 1_000_000) * outputCostPerM;

  tracker.totalTokensUsed += inputTokens + outputTokens;
  tracker.estimatedCost += inputCost + outputCost;
  tracker.callCount += 1;

  if (tracker.estimatedCost > tracker.warningThreshold) {
    console.warn('[CodeReviewFollowUpAgent] Approaching budget limit:', {
      current: tracker.estimatedCost.toFixed(4),
      budget: tracker.budget,
      remaining: (tracker.budget - tracker.estimatedCost).toFixed(4),
    });
  }

  if (tracker.estimatedCost > tracker.budget) {
    throw new Error(
      `COST_BUDGET_EXCEEDED: $${tracker.estimatedCost.toFixed(4)} exceeds budget $${tracker.budget}`
    );
  }
}

/**
 * Returns cost tracking summary for the response.
 */
export function getCostingSummary(tracker: CostTracker): {
  sessionCost: number;
  remainingBudget: number;
  callCount: number;
} {
  return {
    sessionCost: parseFloat(tracker.estimatedCost.toFixed(4)),
    remainingBudget: parseFloat(Math.max(0, tracker.budget - tracker.estimatedCost).toFixed(4)),
    callCount: tracker.callCount,
  };
}
