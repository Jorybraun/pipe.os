/**
 * Role Discovery Phase 1 - Type Definitions
 *
 * Comprehensive types for the multi-agent role discovery system.
 * Supports both client-side React state and Lambda function contracts.
 */

// ============================================================================
// BASELINE (Fixed Schema — Part 1)
// ============================================================================

export interface Baseline {
  title: string;                    // "Senior Backend Engineer"
  level: Level;
  department: string;               // "Engineering", "Platform"
  workModel: WorkModel;
  teamSize: string;                 // "6 engineers", "12 person cross-functional"
  reportsTo: string;                // "Engineering Manager", "VP Engineering"
  stack: string[];                  // ["TypeScript", "Node.js", "PostgreSQL"]
}

export type Level =
  | 'junior'
  | 'mid'
  | 'senior'
  | 'staff'
  | 'principal'
  | 'lead'
  | 'manager';

export type WorkModel = 'remote' | 'hybrid' | 'onsite';

// ============================================================================
// DYNAMIC CONTEXT (Flexible Schema — Part 2)
// ============================================================================

export interface Exchange {
  id: string;                       // UUID
  questionId: string;               // Links to the Question that prompted this
  agentQuestion: string;            // The question text shown to user
  userResponse: string;             // What user entered
  extractedFacts: string[];         // Facts extracted by Extractor
  timestamp: number;                // Unix timestamp
}

// Keys emerge from conversation — not predefined
export type DynamicContext = Record<string, string | string[]>;

// ============================================================================
// ROLE CONTEXT (Full State Object)
// ============================================================================

export interface RoleContext {
  id: string;                       // UUID for this discovery session
  baseline: Baseline | null;        // null until Part 1 complete
  exchanges: Exchange[];            // Conversation history
  context: DynamicContext;          // Accumulated understanding
  status: DiscoveryStatus;
  gaps: string[];                   // What agent still wants to know
  createdAt: number;
  updatedAt: number;

  // Configuration options (Phase 7)
  questionLimit?: string;
  questionMode?: string;
  codeReviewMode?: string;

  // User persona signals (for adaptive questioning)
  userSignals?: {
    knowledgeDepth: 'surface' | 'moderate' | 'deep';
    personaSignals: ('recruiter' | 'hiring_manager' | 'tech_lead')[];
    uncertaintyFlags: string[];  // Topics user seems uncertain about
  };
}

export type DiscoveryStatus =
  | 'baseline'                      // Part 1: Filling structured form
  | 'exploring'                     // Part 2: Active questioning
  | 'almost_ready'                  // 1-2 more questions
  | 'ready';                        // Sufficient for JD generation

// ============================================================================
// QUESTIONS (Agent Output)
// ============================================================================

export interface Question {
  id: string;                       // UUID
  text: string;                     // The question to display
  type: QuestionType;               // Determines input component
  options?: string[];               // For 'select' or 'radio' types
  placeholder?: string;             // Input placeholder text
  helpText?: string;                // Optional explainer shown below input
  targetContext?: string;           // What context key this informs (optional)
}

export type QuestionType =
  | 'text'                          // Single line input
  | 'textarea'                      // Multi-line input
  | 'tags'                          // Tag input (array output)
  | 'select'                        // Dropdown select
  | 'radio';                        // Radio button group

// ============================================================================
// FORM SECTION (UI Grouping)
// ============================================================================

export interface FormSection {
  id: string;
  title: string;                    // "SUCCESS_CRITERIA", "TEAM_CULTURE"
  description?: string;             // Optional section description
  questions: Question[];            // Max 5 questions per Product Brief
}

// ============================================================================
// COST TRACKING
// ============================================================================

export interface CostTracker {
  totalTokensUsed: number;
  estimatedCost: number;
  callCount: number;
  budget: number;  // $0.50
  warningThreshold: number;  // $0.45
}

// ============================================================================
// ERROR TYPES
// ============================================================================

export type AgentErrorCode =
  | 'ANTHROPIC_RATE_LIMIT'
  | 'ANTHROPIC_TIMEOUT'
  | 'ANTHROPIC_API_ERROR'
  | 'COST_BUDGET_EXCEEDED'
  | 'TIME_BUDGET_EXCEEDED'
  | 'EXTRACTION_FAILED'
  | 'ASSESSMENT_FAILED'
  | 'GENERATION_FAILED'
  | 'REVIEW_LOOP_EXCEEDED'
  | 'INVALID_INPUT'
  | 'PARTIAL_FAILURE';

export interface AgentError {
  code: AgentErrorCode;
  message: string;
  userMessage: string;  // User-friendly message for UI
  recoverable: boolean;
  retryable: boolean;   // Can user retry?
  fallback?: unknown;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// LAMBDA REQUEST/RESPONSE CONTRACTS
// ============================================================================

// --- Question Agent ---

export interface QuestionAgentRequest {
  roleContext: RoleContext;
  // If user just answered questions, include responses here
  responses?: Array<{
    questionId: string;
    response: string | string[];
  }>;
}

export interface QuestionAgentResponse {
  // Updated context with extracted facts merged in
  updatedContext: DynamicContext;

  // New exchanges to append (from processing responses)
  newExchanges: Exchange[];

  // Next questions to show (empty if ready)
  nextSection: FormSection | null;

  // Agent's current assessment
  status: DiscoveryStatus;
  gaps: string[];

  // User persona signals
  userSignals?: RoleContext['userSignals'];

  // Explanation for UI (agent panel)
  reasoning: string;

  // Cost tracking
  costTracking: {
    sessionCost: number;
    remainingBudget: number;
    callCount: number;
  };

  // Metadata
  processingTime: number;
}

// --- Job Description Agent ---

export interface JobDescriptionRequest {
  roleContext: RoleContext;         // Must have status === 'ready'
}

export interface JobDescriptionResponse {
  jobDescription: JobDescription;
  candidateFilters: CandidateFilter[];
  suggestedStages: SuggestedStage[];
  processingTime: number;
}

export interface JobDescription {
  title: string;
  summary: string;                  // 2-3 sentence overview
  responsibilities: string[];       // Bullet points
  requirements: {
    required: string[];
    preferred: string[];
  };
  successIndicators: string[];      // What success looks like
  teamContext: string;              // About the team
  growthOpportunity: string;        // Career growth angle
  rawMarkdown: string;              // Full JD as markdown
}

export interface CandidateFilter {
  id: string;
  category: 'experience' | 'skills' | 'traits' | 'logistics';
  label: string;                    // "5+ years backend experience"
  required: boolean;
  derivedFrom: string;              // Which context informed this
}

export interface SuggestedStage {
  id: string;
  type: StageType;
  name: string;                     // "Technical Deep Dive"
  rationale: string;                // Why this stage for this role
  focusAreas: string[];             // What to evaluate
  suggestedDuration: number;        // Minutes
  order: number;
}

export type StageType =
  | 'technical_screen'
  | 'coding'
  | 'system_design'
  | 'behavioral'
  | 'culture_fit'
  | 'hiring_manager'
  | 'team_interview'
  | 'presentation';

// ============================================================================
// LEGACY TYPES (for backward compatibility with existing UI)
// ============================================================================

/**
 * @deprecated Use Baseline instead
 */
export interface RoleBaseline extends Baseline {
  location: WorkModel;  // Alias for workModel
}

/**
 * @deprecated Use DynamicContext instead
 */
export interface RoleDynamicContext {
  [key: string]: string | string[] | undefined;
  successCriteria?: string;
  challenges?: string;
  culture?: string;
}

/**
 * @deprecated Use RoleContext instead
 */
export interface RoleDiscoveryData extends RoleBaseline {
  practices?: string;
  failureSignals?: string;
  growth?: string;
  redFlags?: string;
  successCriteria?: string;
  challenges?: string;
  culture?: string;
}

export type WorkLocation = WorkModel;

export type SeniorityLevel = Capitalize<Level>;

export interface AgentMessage {
  from: 'user' | 'agent';
  text: string;
  timestamp?: Date;
}

export interface RoleDiscoveryProgress {
  completeness: number;
  isReady: boolean;
  gaps: string[];
  filledFields: number;
  totalFields: number;
}

export interface FormSectionDef {
  id: string;
  title: string;
  icon: string;
  fields: (keyof RoleDiscoveryData)[];
}
