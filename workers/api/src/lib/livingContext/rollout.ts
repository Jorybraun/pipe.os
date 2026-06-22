/**
 * Staged rollout configuration for living context graph features.
 *
 * Gates are stored in D1 (rollout_gates table) and loaded at request time.
 * Hardcoded defaults serve as fallback when D1 is unavailable or for tests.
 *
 * Acceptance criterion #8: controlled staged rollout without redeployment.
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

const VALID_STAGES: readonly string[] = ['disabled', 'internal_only', 'canary', 'general_availability'];

/** Hardcoded defaults — used as fallback when D1 is unavailable. */
const DEFAULT_GATES: readonly RolloutGate[] = [
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

const defaultGateMap = new Map(DEFAULT_GATES.map((g) => [g.key, g]));

// --- In-memory fallback API (used by tests and middleware when no D1 context) ---

export function getRolloutGate(key: string): RolloutGate | undefined {
  return defaultGateMap.get(key);
}

export function isGateEnabled(key: string): boolean {
  const gate = defaultGateMap.get(key);
  if (!gate) return false;
  return gate.stage !== 'disabled';
}

export function isGateGA(key: string): boolean {
  const gate = defaultGateMap.get(key);
  if (!gate) return false;
  return gate.stage === 'general_availability';
}

export function getGatesByStage(stage: RolloutStage): readonly RolloutGate[] {
  return DEFAULT_GATES.filter((g) => g.stage === stage);
}

export function getAllGates(): readonly RolloutGate[] {
  return DEFAULT_GATES;
}

export function validateGatePrerequisites(): string[] {
  return validateGatePrerequisitesFrom(DEFAULT_GATES);
}

// --- D1-backed API ---

interface RolloutGateRow {
  gate_key: string;
  label: string;
  description: string;
  stage: string;
  prerequisites: string;
  updated_at: string;
  updated_by: string | null;
}

function parseGateRow(row: RolloutGateRow): RolloutGate {
  let prereqs: string[] = [];
  try {
    const parsed: unknown = JSON.parse(row.prerequisites);
    if (Array.isArray(parsed)) {
      prereqs = parsed.filter((p): p is string => typeof p === 'string');
    }
  } catch {
    prereqs = [];
  }
  const stage = VALID_STAGES.includes(row.stage)
    ? row.stage as RolloutStage
    : 'disabled';
  return {
    key: row.gate_key,
    label: row.label,
    description: row.description,
    stage,
    prerequisiteGates: prereqs,
  };
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes: number } }>;
  first<T>(): Promise<T | null>;
}

export async function loadGatesFromD1(db: D1Database): Promise<readonly RolloutGate[]> {
  try {
    const { results } = await db
      .prepare('SELECT gate_key, label, description, stage, prerequisites, updated_at, updated_by FROM rollout_gates ORDER BY gate_key')
      .all<RolloutGateRow>();
    if (results.length === 0) return DEFAULT_GATES;
    return results.map(parseGateRow);
  } catch {
    return DEFAULT_GATES;
  }
}

export async function getGateFromD1(db: D1Database, key: string): Promise<RolloutGate | undefined> {
  try {
    const row = await db
      .prepare('SELECT gate_key, label, description, stage, prerequisites, updated_at, updated_by FROM rollout_gates WHERE gate_key = ?')
      .bind(key)
      .first<RolloutGateRow>();
    if (!row) return defaultGateMap.get(key);
    return parseGateRow(row);
  } catch {
    return defaultGateMap.get(key);
  }
}

export async function updateGateStage(
  db: D1Database,
  key: string,
  stage: RolloutStage,
  updatedBy: string,
): Promise<{ success: boolean; error?: string }> {
  if (!VALID_STAGES.includes(stage)) {
    return { success: false, error: `Invalid stage: ${stage}` };
  }

  const allGates = await loadGatesFromD1(db);
  const gateMap = new Map(allGates.map((g) => [g.key, g]));
  const target = gateMap.get(key);
  if (!target) {
    return { success: false, error: `Unknown gate: ${key}` };
  }

  if (stage !== 'disabled') {
    for (const prereq of target.prerequisiteGates) {
      const prereqGate = gateMap.get(prereq);
      if (!prereqGate || prereqGate.stage === 'disabled') {
        return {
          success: false,
          error: `Cannot enable "${key}" — prerequisite "${prereq}" is disabled.`,
        };
      }
    }
  }

  if (stage === 'disabled') {
    const dependents = allGates.filter(
      (g) => g.prerequisiteGates.includes(key) && g.stage !== 'disabled',
    );
    if (dependents.length > 0) {
      const names = dependents.map((g) => g.key).join(', ');
      return {
        success: false,
        error: `Cannot disable "${key}" — it is required by enabled gates: ${names}.`,
      };
    }
  }

  try {
    await db
      .prepare(
        'UPDATE rollout_gates SET stage = ?, updated_at = datetime(\'now\'), updated_by = ? WHERE gate_key = ?',
      )
      .bind(stage, updatedBy, key)
      .run();
    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

function validateGatePrerequisitesFrom(gates: readonly RolloutGate[]): string[] {
  const errors: string[] = [];
  const gateMap = new Map(gates.map((g) => [g.key, g]));
  for (const gate of gates) {
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

export async function validateD1GatePrerequisites(db: D1Database): Promise<string[]> {
  const gates = await loadGatesFromD1(db);
  return validateGatePrerequisitesFrom(gates);
}
