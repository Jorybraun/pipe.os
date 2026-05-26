/**
 * Shared types for the question-generation subsystem (guard, eval, patches).
 */

export interface PromptPatch {
  /** Unique patch ID. */
  id: string;
  /** The guard rule ID this patch addresses. */
  ruleId: string;
  /** If set, only apply this patch to these participant roles. */
  participantRoles?: string[];
  /** The bad question text that must NOT be generated. */
  negativeExample: string;
  /** A corrected version that shows what TO do. */
  correctedExample: string;
  /** Human-readable explanation of why this is bad. */
  reason: string;
  /** How many times this pattern was flagged. Higher = more urgent. */
  flagCount: number;
  /** When this patch was created. */
  createdAt: string;
}
