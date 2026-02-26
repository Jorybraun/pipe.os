/**
 * Role Discovery Phase 1 - Type Definitions
 *
 * These types support the two-part role discovery flow:
 * - Part 1: Structured Baseline (7 required fields)
 * - Part 2: Dynamic Agent Exploration (contextual Q&A)
 */

/**
 * Work location model for the role
 */
export type WorkLocation = 'Remote' | 'Hybrid' | 'Onsite';

/**
 * Seniority level for the role
 */
export type SeniorityLevel =
  | 'Junior'
  | 'Mid'
  | 'Senior'
  | 'Staff'
  | 'Principal'
  | 'Lead'
  | 'Manager';

/**
 * Part 1: Structured Baseline Data
 *
 * Seven required fields that provide scaffolding for agent exploration
 */
export interface RoleBaseline {
  // Identity section (4 fields)
  title: string; // Job title (e.g., "Senior Software Engineer")
  level: SeniorityLevel; // Seniority level
  department: string; // Department/team (e.g., "Engineering", "Platform")
  location: WorkLocation; // Work model

  // Team context (2 fields)
  teamSize: string; // Team size description (e.g., "6 engineers")
  reportsTo: string; // Reporting structure (e.g., "Engineering Manager")

  // Technical environment (1 field, but array)
  stack: string[]; // Technology stack tags
}

/**
 * Part 1 (Optional): Additional structured fields
 *
 * Optional fields that enrich the baseline context
 */
export interface RoleBaselineOptional {
  practices?: string; // Engineering practices (code review, testing, etc.)
  failureSignals?: string; // What indicates this hire isn't working out
  growth?: string; // Growth opportunities
  redFlags?: string; // Behavioral red flags
}

/**
 * Part 2: Dynamic Context
 *
 * Context keys that emerge from agent conversation.
 * NOT a fixed schema - keys are dynamic based on role type.
 */
export interface RoleDynamicContext {
  successCriteria?: string; // 90-day goals
  challenges?: string; // Key challenges for the role
  culture?: string; // Team culture and working style
  [key: string]: string | undefined; // Additional dynamic keys
}

/**
 * Complete Role Discovery Data
 *
 * Combines structured baseline + optional fields + dynamic context
 */
export interface RoleDiscoveryData extends RoleBaseline, RoleBaselineOptional {
  allowFollowUps?: boolean;
  // Dynamic context fields (optional)
  successCriteria?: string;
  challenges?: string;
  culture?: string;
  // Additional dynamic keys can be added here as needed
}

/**
 * Agent chat message
 */
export interface AgentMessage {
  from: 'user' | 'agent';
  text: string;
  timestamp?: Date;
}

/**
 * Progress calculation
 */
export interface RoleDiscoveryProgress {
  completeness: number; // 0-100 percentage
  isReady: boolean; // True if completeness >= 60%
  gaps: string[]; // List of missing critical sections
  filledFields: number; // Count of non-empty fields
  totalFields: number; // Total number of tracked fields
}

/**
 * Form section definition
 */
export interface FormSectionDef {
  id: string;
  title: string;
  icon: string; // Icon component name
  fields: (keyof RoleDiscoveryData)[];
}
