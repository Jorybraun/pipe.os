/**
 * RCD decomposition into role_nodes sub-elements.
 *
 * Pure extractor (`decomposeRcdIntoNodes`) + persistence layer (`persistRoleNodes`).
 * Called as a post-write hook after RCD synthesis in roleContexts.ts.
 */

import { preprocessForEmbedding, EMBEDDING_MODEL } from '../embedding/preprocess';
import type {
  BarsOverride,
  ConflictRecord,
  DealbreakerRecord,
  Domain,
  DomainCell,
  DomainMatrix,
  RedFlagRecord,
  RoleContextDocument,
  StakeholderType,
  TeamCultureProfile,
  TechnicalContext,
} from '../../types';
import type { Env } from '../../types';
import { writeRoleGraphFireAndForget, resolvePolicyFromConfig } from '../neo4j/writeRoleGraph';
import { deterministicEntityId } from '../livingContext/persistence';
import {
  OPEN_TERM_RESOLVER_VERSION,
  openSemanticTerm,
} from '../livingContext/openTerms';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Open, source-backed semantic classification. */
export type RoleNodeType = string;

export interface RoleNodeRow {
  id: string;
  role_context_id: string;
  rcd_version: string;
  node_type: RoleNodeType;
  narrative_text: string;
  extracted_properties_json: string;
  source_section: string;
  source_stakeholder: string | null;
  weight: number | null;
}

const EXPECTED_DIM = 1024;

// ─── Public API ──────────────────────────────────────────────────────────────

export function decomposeRcdIntoNodes(
  rcd: RoleContextDocument,
  roleContextId: string,
): RoleNodeRow[] {
  const nodes: RoleNodeRow[] = [];

  nodes.push(...extractRequirements(rcd, roleContextId));
  nodes.push(...extractResponsibilities(rcd, roleContextId));
  nodes.push(...extractCulturalSignals(rcd, roleContextId));
  nodes.push(...extractTeamContexts(rcd, roleContextId));
  nodes.push(...extractDealbreakers(rcd, roleContextId));
  nodes.push(...extractRedFlags(rcd, roleContextId));
  nodes.push(...extractTechnicalContexts(rcd, roleContextId));
  nodes.push(...extractCodebaseExpectations(rcd, roleContextId));
  nodes.push(...extractProcessExpectations(rcd, roleContextId));
  nodes.push(...extractConflicts(rcd, roleContextId));
  nodes.push(...extractBarsOverrides(rcd, roleContextId));

  return nodes;
}

export async function persistRoleNodes(
  nodes: RoleNodeRow[],
  env: Env,
  db: D1Database,
): Promise<void> {
  if (nodes.length === 0) return;

  const roleContextId = nodes[0]!.role_context_id;
  const persistedNodes = await Promise.all(nodes.map(async (node) => {
    const ingestionKey = [
      node.role_context_id,
      node.rcd_version,
      node.node_type,
      node.source_section,
      node.source_stakeholder ?? '',
      node.narrative_text,
    ].join('\u0000');
    return {
      ...node,
      id: await deterministicEntityId('role_node', ingestionKey),
      ingestion_key: ingestionKey,
    };
  }));

  await db.prepare(
    `UPDATE role_nodes
        SET superseded_at = unixepoch(), updated_at = unixepoch()
      WHERE role_context_id = ?1
        AND superseded_at IS NULL
        AND (rcd_version != ?2 OR ingestion_key IS NULL)`,
  ).bind(roleContextId, persistedNodes[0]!.rcd_version).run();

  await db.batch(persistedNodes.map((node) => db.prepare(
    `INSERT INTO role_nodes (
       id, ingestion_key, role_context_id, rcd_version, node_type,
       narrative_text, extracted_properties_json, embedding_json,
       source_section, source_stakeholder, weight, superseded_at,
       created_at, updated_at
     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, ?8, ?9, ?10, NULL, unixepoch(), unixepoch())
     ON CONFLICT(ingestion_key) DO UPDATE SET
       narrative_text = excluded.narrative_text,
       extracted_properties_json = excluded.extracted_properties_json,
       source_section = excluded.source_section,
       source_stakeholder = excluded.source_stakeholder,
       weight = excluded.weight,
       superseded_at = NULL,
       updated_at = unixepoch()`,
  ).bind(
    node.id,
    node.ingestion_key,
    node.role_context_id,
    node.rcd_version,
    node.node_type,
    node.narrative_text,
    node.extracted_properties_json,
    node.source_section,
    node.source_stakeholder,
    node.weight,
  )));

  // 1. Generate embeddings in batches of 10 (BGE rate-limit friendly)
  const batchSize = 10;
  const embeddedNodes: Array<RoleNodeRow & { ingestion_key: string; embedding_json: string }> = [];

  for (let i = 0; i < persistedNodes.length; i += batchSize) {
    const batch = persistedNodes.slice(i, i + batchSize);
    const texts = batch.map((n) => preprocessForEmbedding(n.narrative_text, 'document'));

    const embedResult = (await env.AI.run(EMBEDDING_MODEL, {
      text: texts,
    })) as { data?: number[][] };

    const vectors = embedResult?.data;
    if (!vectors || vectors.length !== batch.length) {
      throw new Error(
        `[persistRoleNodes] embedding batch mismatch: expected ${batch.length}, got ${vectors?.length ?? 0}`,
      );
    }

    for (let j = 0; j < batch.length; j++) {
      const vector = vectors[j];
      if (!vector || vector.length !== EXPECTED_DIM) {
        throw new Error(
          `[persistRoleNodes] bad vector shape for node ${batch[j]!.id}: ${vector?.length ?? 0}`,
        );
      }
      embeddedNodes.push({
        ...batch[j]!,
        embedding_json: JSON.stringify(vector),
      });
    }
  }

  await db.batch(embeddedNodes.map((node) => db.prepare(
    `UPDATE role_nodes
        SET embedding_json = ?1, updated_at = unixepoch()
      WHERE ingestion_key = ?2`,
  ).bind(node.embedding_json, node.ingestion_key)));

  // 3. Write to Neo4j (fire-and-forget, non-blocking)
  const rcd = persistedNodes[0]!;

  // Load pipeline_id and match config for policy resolution
  let realPipelineId = '';
  let policy = resolvePolicyFromConfig({});
  try {
    const configRow = await db
      .prepare(
        `SELECT rc.pipeline_id, rc.match_philosophy, rc.tolerance,
                pmc.match_philosophy AS pmc_phil, pmc.tolerance AS pmc_tol, pmc.hybrid_mix_ratio
         FROM role_contexts rc
         LEFT JOIN pipeline_match_config pmc ON pmc.pipeline_id = rc.pipeline_id
         WHERE rc.id = ?1`,
      )
      .bind(roleContextId)
      .first<{
        pipeline_id: string;
        match_philosophy: string | null;
        tolerance: string | null;
        pmc_phil: string | null;
        pmc_tol: string | null;
        hybrid_mix_ratio: number | null;
      }>();

    if (configRow) {
      realPipelineId = configRow.pipeline_id;
      policy = resolvePolicyFromConfig({
        tolerance: configRow.pmc_tol ?? configRow.tolerance,
        match_philosophy: configRow.pmc_phil ?? configRow.match_philosophy,
        hybrid_mix_ratio: configRow.hybrid_mix_ratio ?? undefined,
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[persistRoleNodes] failed to load match config for policy:', msg);
  }

  writeRoleGraphFireAndForget({
    roleContextId: rcd.role_context_id,
    pipelineId: realPipelineId || rcd.role_context_id,
    rcdVersion: rcd.rcd_version,
    nodes: embeddedNodes,
    policy,
    env,
  });

  console.error('[persistRoleNodes] wrote nodes for role', {
    roleContextId,
    count: nodes.length,
  });
}

// ─── Extractors ──────────────────────────────────────────────────────────────

function makeNode(
  roleContextId: string,
  rcdVersion: string,
  nodeType: RoleNodeType,
  narrative: string,
  props: Record<string, unknown>,
  sourceSection: string,
  sourceStakeholder: string | null,
  weight: number | null,
): RoleNodeRow {
  return {
    id: crypto.randomUUID(),
    role_context_id: roleContextId,
    rcd_version: rcdVersion,
    node_type: nodeType,
    narrative_text: `${nodeType}: ${narrative}`,
    extracted_properties_json: JSON.stringify(props),
    source_section: sourceSection,
    source_stakeholder: sourceStakeholder,
    weight,
  };
}

function walkDomainMatrix(
  matrix: DomainMatrix,
  cb: (stakeholder: StakeholderType, domain: Domain, cell: DomainCell) => void,
): void {
  for (const [stakeholder, domains] of Object.entries(matrix)) {
    if (!domains) continue;
    for (const [domain, cell] of Object.entries(domains)) {
      if (!cell) continue;
      cb(stakeholder as StakeholderType, domain as Domain, cell);
    }
  }
}

function extractRequirements(rcd: RoleContextDocument, roleContextId: string): RoleNodeRow[] {
  const nodes: RoleNodeRow[] = [];
  const targetDomains: Domain[] = ['work', 'bar', 'codebase'];

  walkDomainMatrix(rcd.domain_matrix, (stakeholder, domain, cell) => {
    if (!targetDomains.includes(domain)) return;
    for (const chain of cell.laddering_chains) {
      const isMustHave = chain.energy_signal === 'high' && domain === 'bar';
      const weight = isMustHave ? 1.0 : 0.5;
      const narrative = `Must have ${chain.attribute_quote.trim()} because ${chain.consequence.trim()}, which matters for ${chain.value.trim()}.`;
      nodes.push(
        makeNode(
          roleContextId,
          rcd.rcd_version,
          'Requirement',
          narrative,
          { domain, stakeholder, energy_signal: chain.energy_signal, confidence: chain.confidence },
          `domain_matrix.${domain}.${stakeholder}.laddering_chains`,
          stakeholder,
          weight,
        ),
      );
    }
  });

  return nodes;
}

function extractResponsibilities(rcd: RoleContextDocument, roleContextId: string): RoleNodeRow[] {
  const nodes: RoleNodeRow[] = [];
  const targetDomains: Domain[] = ['work', 'team'];

  walkDomainMatrix(rcd.domain_matrix, (stakeholder, domain, cell) => {
    if (!targetDomains.includes(domain)) return;
    for (const story of cell.stories) {
      const narrative = `Responsibility: ${story.situation.trim()} — ${story.action.trim()} — ${story.outcome.trim()}.`;
      nodes.push(
        makeNode(
          roleContextId,
          rcd.rcd_version,
          'Responsibility',
          narrative,
          { domain, stakeholder, moral: story.moral },
          `domain_matrix.${domain}.${stakeholder}.stories`,
          stakeholder,
          null,
        ),
      );
    }
  });

  return nodes;
}

function extractCulturalSignals(rcd: RoleContextDocument, roleContextId: string): RoleNodeRow[] {
  const nodes: RoleNodeRow[] = [];
  const profile = rcd.team_culture_profile;
  if (!profile) return nodes;

  const dimensions: Array<keyof NonNullable<typeof profile.per_stakeholder[StakeholderType]>> = [
    'clan_affinity',
    'adhocracy_affinity',
    'market_affinity',
    'hierarchy_affinity',
    'psychological_safety',
  ];

  for (const [stakeholder, scores] of Object.entries(profile.per_stakeholder)) {
    if (!scores) continue;
    for (const dim of dimensions) {
      const value = scores[dim];
      if (value == null) continue;
      const narrative = `${dim.replace('_affinity', '').replace('_', ' ')} score ${value}/5 for ${stakeholder.toLowerCase().replace('_', ' ')} perspective.`;
      nodes.push(
        makeNode(
          roleContextId,
          rcd.rcd_version,
          'CulturalSignal',
          narrative,
          { dimension: dim, score: value, stakeholder },
          `team_culture_profile.per_stakeholder.${stakeholder}.${dim}`,
          stakeholder,
          null,
        ),
      );
    }
  }

  return nodes;
}

function extractTeamContexts(rcd: RoleContextDocument, roleContextId: string): RoleNodeRow[] {
  const nodes: RoleNodeRow[] = [];

  walkDomainMatrix(rcd.domain_matrix, (stakeholder, domain, cell) => {
    if (domain !== 'team') return;
    const openCodes = cell.open_codes.join(', ');
    if (!openCodes) return;
    const narrative = `Team context from ${stakeholder.toLowerCase().replace('_', ' ')}: ${openCodes}.`;
    nodes.push(
      makeNode(
        roleContextId,
        rcd.rcd_version,
        'TeamContext',
        narrative,
        { domain, stakeholder, primary_authority: cell.primary_authority, coverage: cell.coverage },
        `domain_matrix.${domain}.${stakeholder}.open_codes`,
        stakeholder,
        null,
      ),
    );
  });

  return nodes;
}

function extractDealbreakers(rcd: RoleContextDocument, roleContextId: string): RoleNodeRow[] {
  return (rcd.dealbreakers ?? []).map((db: DealbreakerRecord) =>
    makeNode(
      roleContextId,
      rcd.rcd_version,
      'Dealbreaker',
      `${db.label}. Pattern: ${db.pattern}. Evidence: ${db.evidence_quote}`,
      { pattern: db.pattern, source_chain_id: db.source_chain_id, job_relatedness_strength: db.job_relatedness_strength },
      'dealbreakers',
      db.source_stakeholder,
      db.job_relatedness_strength === 'strong' ? 1.0 : 0.5,
    ),
  );
}

function extractRedFlags(rcd: RoleContextDocument, roleContextId: string): RoleNodeRow[] {
  return (rcd.red_flags ?? []).map((rf: RedFlagRecord) =>
    makeNode(
      roleContextId,
      rcd.rcd_version,
      'RedFlag',
      `${rf.label}. Evidence: ${rf.evidence_quote}`,
      { source_chain_id: rf.source_chain_id },
      'red_flags',
      rf.source_stakeholder,
      null,
    ),
  );
}

function extractTechnicalContexts(rcd: RoleContextDocument, roleContextId: string): RoleNodeRow[] {
  const tc = rcd.technical_context;
  if (!tc) return [];

  const nodes: RoleNodeRow[] = [];

  for (const stackItem of tc.stack ?? []) {
    const term = openSemanticTerm(stackItem);
    nodes.push(
      makeNode(
        roleContextId,
        rcd.rcd_version,
        'TechnicalContext',
        `Stack component: ${stackItem}`,
        {
          kind: 'stack',
          value: stackItem,
          semantic_terms: term ? [{
            surface: term.surface,
            canonical_key: term.canonicalKey,
            resolver: OPEN_TERM_RESOLVER_VERSION,
          }] : [],
        },
        'technical_context.stack',
        null,
        null,
      ),
    );
  }

  for (const construct of tc.constructs ?? []) {
    const term = openSemanticTerm(construct);
    nodes.push(
      makeNode(
        roleContextId,
        rcd.rcd_version,
        'TechnicalContext',
        `Construct: ${construct}`,
        {
          kind: 'construct',
          value: construct,
          semantic_terms: term ? [{
            surface: term.surface,
            canonical_key: term.canonicalKey,
            resolver: OPEN_TERM_RESOLVER_VERSION,
          }] : [],
        },
        'technical_context.constructs',
        null,
        null,
      ),
    );
  }

  return nodes;
}

function extractCodebaseExpectations(rcd: RoleContextDocument, roleContextId: string): RoleNodeRow[] {
  const tc = rcd.technical_context;
  if (!tc?.codebase_expectations) return [];

  return tc.codebase_expectations.map((expectation: string) =>
    makeNode(
      roleContextId,
      rcd.rcd_version,
      'CodebaseExpectation',
      expectation,
      {},
      'technical_context.codebase_expectations',
      null,
      null,
    ),
  );
}

function extractProcessExpectations(rcd: RoleContextDocument, roleContextId: string): RoleNodeRow[] {
  const nodes: RoleNodeRow[] = [];

  walkDomainMatrix(rcd.domain_matrix, (stakeholder, domain, cell) => {
    if (domain !== 'process') return;
    const openCodes = cell.open_codes.join(', ');
    if (!openCodes) return;
    nodes.push(
      makeNode(
        roleContextId,
        rcd.rcd_version,
        'ProcessExpectation',
        `Process expectation from ${stakeholder.toLowerCase().replace('_', ' ')}: ${openCodes}.`,
        { stakeholder, coverage: cell.coverage },
        `domain_matrix.${domain}.${stakeholder}.open_codes`,
        stakeholder,
        null,
      ),
    );
  });

  return nodes;
}

function extractConflicts(rcd: RoleContextDocument, roleContextId: string): RoleNodeRow[] {
  return (rcd.conflicts ?? []).map((c: ConflictRecord) =>
    makeNode(
      roleContextId,
      rcd.rcd_version,
      'Conflict',
      `${c.stakeholder_a} says: "${c.position_a}" vs ${c.stakeholder_b} says: "${c.position_b}" (${c.conflict_flag}). Resolution: ${c.resolution_strategy}.`,
      { domain: c.domain, field: c.field, conflict_flag: c.conflict_flag, resolution_strategy: c.resolution_strategy },
      `conflicts.${c.domain}.${c.field}`,
      null,
      null,
    ),
  );
}

function extractBarsOverrides(rcd: RoleContextDocument, roleContextId: string): RoleNodeRow[] {
  return (rcd.bars_overrides ?? []).map((bo: BarsOverride) =>
    makeNode(
      roleContextId,
      rcd.rcd_version,
      'BarsOverride',
      `Dimension "${bo.dimension}" level ${bo.anchor_level}: override anchor text: "${bo.override_anchor_text}" (source: ${bo.source_chain_id}).`,
      { dimension: bo.dimension, anchor_level: bo.anchor_level, source_chain_id: bo.source_chain_id },
      'bars_overrides',
      null,
      null,
    ),
  );
}
