/**
 * Staged rollout configuration for living context graph features.
 *
 * Controls which living-context capabilities are active in production.
 * Each gate must be explicitly enabled — new features default OFF.
 *
 * Acceptance criterion #8: controlled staged rollout.
 */

export interface RolloutGate {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly stage: RolloutStage;
  readonly prerequisiteGates: readonly string[];
}

export type RolloutStage =
  | 'disabled'
  | 'internal_only'
  | 'canary'
  | 'general_availability';

const ROLLOUT_GATES: readonly RolloutGate[] = [
  {
    key: 'living_context_ingestion',
    label: 'Living Context Ingestion',
    description: 'Ingest meetings, resumes, code reviews, and phone calls into the person graph.',
    stage: 'general_availability',
    prerequisiteGates: [],
  },
  {
    key: 'living_context_read_model',
    label: 'Living Context Read Model',
    description: 'Load and serve the full living context graph via recruiter API.',
    stage: 'general_availability',
    prerequisiteGates: ['living_context_ingestion'],
  },
  {
    key: 'contact_living_context',
    label: 'Contact Living Context',
    description: 'Serve living context for contacts (pre-candidate people).',
    stage: 'canary',
    prerequisiteGates: ['living_context_read_model'],
  },
  {
    key: 'deterministic_matching',
    label: 'Deterministic PR Matching',
    description: 'Match candidates to specific reviewable PRs via the deterministic challenge matcher.',
    stage: 'general_availability',
    prerequisiteGates: ['living_context_ingestion'],
  },
  {
    key: 'match_explanation',
    label: 'Match Explanation',
    description: 'Show structured evidence gaps, stretch areas, and source provenance in match explanations.',
    stage: 'canary',
    prerequisiteGates: ['deterministic_matching'],
  },
  {
    key: 'repo_graph_backfill',
    label: 'Repo Graph Backfill',
    description: 'Idempotent backfill of repository semantic graphs from D1 source data.',
    stage: 'general_availability',
    prerequisiteGates: [],
  },
  {
    key: 'neo4j_projection_rebuild',
    label: 'Neo4j Projection Rebuild',
    description: 'Rebuild Neo4j projections from D1 source-of-truth via projection outbox.',
    stage: 'canary',
    prerequisiteGates: ['living_context_ingestion', 'repo_graph_backfill'],
  },
  {
    key: 'repo_overlay_visualization',
    label: 'Repo Overlay Visualization',
    description: 'Show file-level repo structure with matched spans in recruiter CONTEXT.',
    stage: 'internal_only',
    prerequisiteGates: ['deterministic_matching', 'repo_graph_backfill'],
  },
  {
    key: 'expert_labelled_evaluation',
    label: 'Expert-Labelled Evaluation',
    description: 'Run matching evaluation against expert-labelled corpus as a CI quality gate.',
    stage: 'internal_only',
    prerequisiteGates: ['deterministic_matching'],
  },
] as const;

const gateMap = new Map(ROLLOUT_GATES.map((g) => [g.key, g]));

export function getRolloutGate(key: string): RolloutGate | undefined {
  return gateMap.get(key);
}

export function isGateEnabled(key: string): boolean {
  const gate = gateMap.get(key);
  if (!gate) return false;
  return gate.stage !== 'disabled';
}

export function isGateGA(key: string): boolean {
  const gate = gateMap.get(key);
  if (!gate) return false;
  return gate.stage === 'general_availability';
}

export function getGatesByStage(stage: RolloutStage): readonly RolloutGate[] {
  return ROLLOUT_GATES.filter((g) => g.stage === stage);
}

export function getAllGates(): readonly RolloutGate[] {
  return ROLLOUT_GATES;
}

export function validateGatePrerequisites(): string[] {
  const errors: string[] = [];
  for (const gate of ROLLOUT_GATES) {
    if (gate.stage === 'disabled') continue;
    for (const prereq of gate.prerequisiteGates) {
      const prereqGate = gateMap.get(prereq);
      if (!prereqGate) {
        errors.push(`Gate "${gate.key}" requires unknown gate "${prereq}".`);
        continue;
      }
      if (prereqGate.stage === 'disabled') {
        errors.push(
          `Gate "${gate.key}" (${gate.stage}) requires "${prereq}" which is disabled.`,
        );
      }
    }
  }
  return errors;
}
