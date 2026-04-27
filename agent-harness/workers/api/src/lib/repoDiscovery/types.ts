/**
 * Core types for the repoDiscovery subsystem.
 * RCD primary, persona_json fallback — see ADR-040
 */

export interface TechnicalContext {
  stack: string[];
  constructs: string[];
  seniority_band: string;
}

export interface DomainMatrix {
  domains: string[];
  weights: Record<string, number>;
}

export interface RCD {
  technical_context: TechnicalContext;
  seniority_band: string;
  domain_matrix: DomainMatrix;
}

export interface Persona {
  mustHaveSkills: string[];
  niceToHaveSkills: string[];
  seniority: string;
}

export interface RoleContext {
  roleContextId: string;
  roleId: string;
  rcd_json?: RCD | null;
  persona_json?: Persona | null;
  consumer_slice?: Persona | null;
}

export interface MatchedRepo {
  repoId: string;
  score: number;
  confidence: number;
  pass3_confidence?: number;
}

export interface DiscoveryResult {
  roleContextId: string;
  roleId: string;
  mustHaveSkills: string[];
  niceToHaveSkills: string[];
  seniority: string;
  matchedRepos: MatchedRepo[];
  vectorizeSkipped?: boolean;
}

export interface RepoDiscoveryAgent {
  discover(roleContext: RoleContext): Promise<DiscoveryResult>;
  matchRepos(roleContext: RoleContext): Promise<MatchedRepo[]>;
  runPass3(repoId: string): Promise<{ confidence: number; approved: boolean }>;
}

export type DiscoveryMessageType = 'DISCOVER' | 'MATCH' | 'PASS3' | 'VECTORIZE';

export interface DiscoveryMessage {
  type: DiscoveryMessageType;
  payload: RoleContext | { repoId: string; roleContext: RoleContext };
  correlationId: string;
  timestamp: number;
}

export interface SkillAlias {
  canonical: string;
  aliases: string[];
}

export interface SkillAdjacency {
  source_skill_id: string;
  target_skill_id: string;
  weight: number;
}

export type MatchPhilosophy = 'validate' | 'tailored';

export interface MatchOptions {
  philosophy: MatchPhilosophy;
  coverageThreshold?: number;
  skillAdjacencyEnabled?: boolean;
}
