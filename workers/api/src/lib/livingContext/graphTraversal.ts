/**
 * graphTraversal.ts — Navigable graph traversal engine for living context.
 *
 * Given a starting entity (person, interaction, assertion, concept, artifact,
 * match_run), returns connected entities and their relationships up to a
 * configurable depth. Every returned edge carries source evidence so the graph
 * remains fully explainable.
 *
 * Criteria advanced: #7 (navigable person and context graph).
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type GraphEntityType =
  | 'person'
  | 'workspace_person'
  | 'interaction'
  | 'artifact'
  | 'assertion'
  | 'concept'
  | 'signal_evidence'
  | 'source_span'
  | 'match_run';

export interface GraphNode {
  id: string;
  entityType: GraphEntityType;
  label: string;
  metadata: Record<string, unknown>;
  depth: number;
}

export interface GraphEdge {
  fromId: string;
  fromType: GraphEntityType;
  toId: string;
  toType: GraphEntityType;
  relationship: string;
  sourceEvidence: EdgeSourceEvidence | null;
}

export interface EdgeSourceEvidence {
  sourceSpanId: string | null;
  exactText: string | null;
  confidence: number | null;
}

export interface GraphTraversalResult {
  root: GraphNode;
  nodes: GraphNode[];
  edges: GraphEdge[];
  truncated: boolean;
}

export interface GraphTraversalOptions {
  maxDepth?: number;
  maxNodes?: number;
  entityTypeFilter?: GraphEntityType[];
}

const DEFAULT_MAX_DEPTH = 2;
const DEFAULT_MAX_NODES = 200;

// ── Row types for D1 queries ────────────────────────────────────────────────

interface PersonRow {
  id: string;
  display_name: string | null;
  primary_email: string | null;
}

interface WorkspacePersonRow {
  id: string;
  person_id: string;
  relationship_summary: string | null;
}

interface InteractionRow {
  id: string;
  workspace_person_id: string;
  interaction_type: string;
  external_reference: string | null;
  started_at: string | null;
}

interface ArtifactRow {
  id: string;
  workspace_person_id: string | null;
  interaction_id: string | null;
  artifact_type: string;
  logical_key: string | null;
}

interface AssertionRow {
  id: string;
  workspace_person_id: string;
  episode_id: string | null;
  predicate: string;
  narrative: string;
  confidence: number | null;
}

interface AssertionConceptRow {
  assertion_id: string;
  concept_id: string;
  relationship: string;
  weight: number;
}

interface ConceptRow {
  id: string;
  canonical_key: string;
  namespace: string;
  label: string;
}

interface SignalEvidenceRow {
  id: string;
  workspace_person_id: string;
  interaction_id: string | null;
  assertion_id: string;
  concept_id: string | null;
  signal_key: string;
  evidence_level: string;
  strength: number;
}

interface AssertionSourceSpanRow {
  assertion_id: string;
  source_span_id: string;
  evidence_role: string;
}

interface SourceSpanRow {
  id: string;
  artifact_version_id: string;
  exact_text: string;
  stable_segment_id: string | null;
}

interface MatchRunRow {
  id: string;
  candidate_id: string;
  status: string;
  selected_packet_id: string | null;
}

interface ArtifactInteractionRow {
  artifact_id: string;
  interaction_id: string;
}

// ── Traversal engine ────────────────────────────────────────────────────────

export async function traverseLivingContextGraph(
  db: D1Database,
  candidateId: string,
  startEntityType: GraphEntityType,
  startEntityId: string,
  options: GraphTraversalOptions = {},
): Promise<GraphTraversalResult> {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxNodes = options.maxNodes ?? DEFAULT_MAX_NODES;
  const typeFilter = options.entityTypeFilter ?? null;

  const visitedIds = new Set<string>();
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  let truncated = false;

  const workspacePersonId = await resolveWorkspacePersonId(db, candidateId);
  if (!workspacePersonId) {
    return {
      root: {
        id: startEntityId,
        entityType: startEntityType,
        label: 'Unknown',
        metadata: {},
        depth: 0,
      },
      nodes: [],
      edges: [],
      truncated: false,
    };
  }

  const rootNode = await loadNode(db, startEntityType, startEntityId, 0);
  if (!rootNode) {
    return {
      root: {
        id: startEntityId,
        entityType: startEntityType,
        label: 'Not found',
        metadata: {},
        depth: 0,
      },
      nodes: [],
      edges: [],
      truncated: false,
    };
  }

  visitedIds.add(nodeKey(rootNode.entityType, rootNode.id));
  nodes.push(rootNode);

  const frontier: Array<{ node: GraphNode; depth: number }> = [
    { node: rootNode, depth: 0 },
  ];

  while (frontier.length > 0) {
    const entry = frontier.shift()!;
    if (entry.depth >= maxDepth) continue;

    const neighbors = await loadNeighbors(
      db,
      workspacePersonId,
      entry.node.entityType,
      entry.node.id,
    );

    for (const neighbor of neighbors) {
      if (typeFilter && !typeFilter.includes(neighbor.node.entityType)) continue;

      const key = nodeKey(neighbor.node.entityType, neighbor.node.id);
      const isNew = !visitedIds.has(key);

      if (isNew) {
        if (nodes.length >= maxNodes) {
          truncated = true;
          continue;
        }
        neighbor.node.depth = entry.depth + 1;
        visitedIds.add(key);
        nodes.push(neighbor.node);
        frontier.push({ node: neighbor.node, depth: entry.depth + 1 });
      }

      const edgeExists = edges.some(
        (e) =>
          e.fromId === neighbor.edge.fromId &&
          e.fromType === neighbor.edge.fromType &&
          e.toId === neighbor.edge.toId &&
          e.toType === neighbor.edge.toType &&
          e.relationship === neighbor.edge.relationship,
      );
      if (!edgeExists) {
        edges.push(neighbor.edge);
      }
    }
  }

  return { root: rootNode, nodes, edges, truncated };
}

function nodeKey(entityType: GraphEntityType, id: string): string {
  return `${entityType}:${id}`;
}

// ── Resolve workspace_person_id from candidate_id ───────────────────────────

async function resolveWorkspacePersonId(
  db: D1Database,
  candidateId: string,
): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT a.workspace_person_id
       FROM applications a
       WHERE a.legacy_candidate_id = ?`,
    )
    .bind(candidateId)
    .first<{ workspace_person_id: string }>();
  return row?.workspace_person_id ?? null;
}

// ── Load a single node ──────────────────────────────────────────────────────

async function loadNode(
  db: D1Database,
  entityType: GraphEntityType,
  entityId: string,
  depth: number,
): Promise<GraphNode | null> {
  switch (entityType) {
    case 'person': {
      const row = await db
        .prepare('SELECT id, display_name, primary_email FROM people WHERE id = ?')
        .bind(entityId)
        .first<PersonRow>();
      if (!row) return null;
      return {
        id: row.id,
        entityType: 'person',
        label: row.display_name ?? row.primary_email ?? 'Unknown person',
        metadata: { email: row.primary_email },
        depth,
      };
    }
    case 'workspace_person': {
      const row = await db
        .prepare(
          `SELECT wp.id, wp.person_id, wp.relationship_summary,
                  p.display_name, p.primary_email
           FROM workspace_people wp
           JOIN people p ON p.id = wp.person_id
           WHERE wp.id = ?`,
        )
        .bind(entityId)
        .first<WorkspacePersonRow & { display_name: string | null; primary_email: string | null }>();
      if (!row) return null;
      return {
        id: row.id,
        entityType: 'workspace_person',
        label: row.display_name ?? row.primary_email ?? 'Workspace member',
        metadata: { personId: row.person_id, summary: row.relationship_summary },
        depth,
      };
    }
    case 'interaction': {
      const row = await db
        .prepare(
          `SELECT id, workspace_person_id, interaction_type,
                  external_reference, started_at
           FROM interactions WHERE id = ?`,
        )
        .bind(entityId)
        .first<InteractionRow>();
      if (!row) return null;
      return {
        id: row.id,
        entityType: 'interaction',
        label: row.interaction_type + (row.external_reference ? ` (${row.external_reference})` : ''),
        metadata: {
          type: row.interaction_type,
          externalRef: row.external_reference,
          startedAt: row.started_at,
        },
        depth,
      };
    }
    case 'artifact': {
      const row = await db
        .prepare(
          `SELECT id, workspace_person_id, interaction_id,
                  artifact_type, logical_key
           FROM artifacts WHERE id = ?`,
        )
        .bind(entityId)
        .first<ArtifactRow>();
      if (!row) return null;
      return {
        id: row.id,
        entityType: 'artifact',
        label: row.artifact_type + (row.logical_key ? `: ${row.logical_key}` : ''),
        metadata: {
          type: row.artifact_type,
          logicalKey: row.logical_key,
          interactionId: row.interaction_id,
        },
        depth,
      };
    }
    case 'assertion': {
      const row = await db
        .prepare(
          `SELECT id, workspace_person_id, episode_id,
                  predicate, narrative, confidence
           FROM semantic_assertions WHERE id = ?`,
        )
        .bind(entityId)
        .first<AssertionRow>();
      if (!row) return null;
      return {
        id: row.id,
        entityType: 'assertion',
        label: row.predicate,
        metadata: {
          narrative: row.narrative,
          confidence: row.confidence,
          episodeId: row.episode_id,
        },
        depth,
      };
    }
    case 'concept': {
      const row = await db
        .prepare(
          'SELECT id, canonical_key, namespace, label FROM concepts WHERE id = ?',
        )
        .bind(entityId)
        .first<ConceptRow>();
      if (!row) return null;
      return {
        id: row.id,
        entityType: 'concept',
        label: row.label,
        metadata: { canonicalKey: row.canonical_key, namespace: row.namespace },
        depth,
      };
    }
    case 'signal_evidence': {
      const row = await db
        .prepare(
          `SELECT id, workspace_person_id, interaction_id, assertion_id,
                  concept_id, signal_key, evidence_level, strength
           FROM signal_evidence WHERE id = ?`,
        )
        .bind(entityId)
        .first<SignalEvidenceRow>();
      if (!row) return null;
      return {
        id: row.id,
        entityType: 'signal_evidence',
        label: `${row.signal_key} (${row.evidence_level})`,
        metadata: {
          signalKey: row.signal_key,
          evidenceLevel: row.evidence_level,
          strength: row.strength,
        },
        depth,
      };
    }
    case 'source_span': {
      const row = await db
        .prepare(
          `SELECT id, artifact_version_id, exact_text, stable_segment_id
           FROM source_spans WHERE id = ?`,
        )
        .bind(entityId)
        .first<SourceSpanRow>();
      if (!row) return null;
      const preview =
        row.exact_text.length > 80
          ? row.exact_text.slice(0, 80) + '…'
          : row.exact_text;
      return {
        id: row.id,
        entityType: 'source_span',
        label: preview,
        metadata: {
          segmentId: row.stable_segment_id,
          artifactVersionId: row.artifact_version_id,
        },
        depth,
      };
    }
    case 'match_run': {
      const row = await db
        .prepare(
          `SELECT id, candidate_id, status, selected_packet_id
           FROM match_runs WHERE id = ?`,
        )
        .bind(entityId)
        .first<MatchRunRow>();
      if (!row) return null;
      return {
        id: row.id,
        entityType: 'match_run',
        label: `Match: ${row.status}`,
        metadata: {
          status: row.status,
          selectedPacketId: row.selected_packet_id,
        },
        depth,
      };
    }
  }
}

// ── Load neighbors of a node ────────────────────────────────────────────────

interface NeighborResult {
  node: GraphNode;
  edge: GraphEdge;
}

const NEIGHBOR_LIMIT = 50;

async function loadNeighbors(
  db: D1Database,
  workspacePersonId: string,
  entityType: GraphEntityType,
  entityId: string,
): Promise<NeighborResult[]> {
  const results: NeighborResult[] = [];

  switch (entityType) {
    case 'person': {
      const wpRows = await db
        .prepare(
          `SELECT id, person_id, relationship_summary
           FROM workspace_people WHERE person_id = ? LIMIT ?`,
        )
        .bind(entityId, NEIGHBOR_LIMIT)
        .all<WorkspacePersonRow>();
      for (const wp of wpRows.results) {
        results.push({
          node: {
            id: wp.id,
            entityType: 'workspace_person',
            label: wp.relationship_summary ?? 'Workspace member',
            metadata: { personId: wp.person_id },
            depth: 0,
          },
          edge: {
            fromId: entityId,
            fromType: 'person',
            toId: wp.id,
            toType: 'workspace_person',
            relationship: 'has_workspace_presence',
            sourceEvidence: null,
          },
        });
      }
      break;
    }

    case 'workspace_person': {
      const interactionRows = await db
        .prepare(
          `SELECT id, workspace_person_id, interaction_type,
                  external_reference, started_at
           FROM interactions
           WHERE workspace_person_id = ?
           ORDER BY started_at DESC
           LIMIT ?`,
        )
        .bind(entityId, NEIGHBOR_LIMIT)
        .all<InteractionRow>();
      for (const row of interactionRows.results) {
        results.push({
          node: {
            id: row.id,
            entityType: 'interaction',
            label: row.interaction_type + (row.external_reference ? ` (${row.external_reference})` : ''),
            metadata: { type: row.interaction_type, startedAt: row.started_at },
            depth: 0,
          },
          edge: {
            fromId: entityId,
            fromType: 'workspace_person',
            toId: row.id,
            toType: 'interaction',
            relationship: 'participated_in',
            sourceEvidence: null,
          },
        });
      }

      const assertionRows = await db
        .prepare(
          `SELECT id, workspace_person_id, episode_id,
                  predicate, narrative, confidence
           FROM semantic_assertions
           WHERE workspace_person_id = ?
           ORDER BY observed_at DESC
           LIMIT ?`,
        )
        .bind(entityId, NEIGHBOR_LIMIT)
        .all<AssertionRow>();
      for (const row of assertionRows.results) {
        results.push({
          node: {
            id: row.id,
            entityType: 'assertion',
            label: row.predicate,
            metadata: { narrative: row.narrative, confidence: row.confidence },
            depth: 0,
          },
          edge: {
            fromId: entityId,
            fromType: 'workspace_person',
            toId: row.id,
            toType: 'assertion',
            relationship: 'has_assertion',
            sourceEvidence: null,
          },
        });
      }

      const matchRunRows = await db
        .prepare(
          `SELECT id, candidate_id, status, selected_packet_id
           FROM match_runs
           WHERE candidate_id IN (
             SELECT legacy_candidate_id FROM applications
             WHERE workspace_person_id = ?
           )
           ORDER BY created_at DESC
           LIMIT ?`,
        )
        .bind(entityId, NEIGHBOR_LIMIT)
        .all<MatchRunRow>();
      for (const row of matchRunRows.results) {
        results.push({
          node: {
            id: row.id,
            entityType: 'match_run',
            label: `Match: ${row.status}`,
            metadata: { status: row.status, selectedPacketId: row.selected_packet_id },
            depth: 0,
          },
          edge: {
            fromId: entityId,
            fromType: 'workspace_person',
            toId: row.id,
            toType: 'match_run',
            relationship: 'matched_to',
            sourceEvidence: null,
          },
        });
      }
      break;
    }

    case 'interaction': {
      const artifactRows = await db
        .prepare(
          `SELECT a.id, a.workspace_person_id, a.interaction_id,
                  a.artifact_type, a.logical_key
           FROM artifacts a
           LEFT JOIN artifact_interactions ai ON ai.artifact_id = a.id
           WHERE a.interaction_id = ? OR ai.interaction_id = ?
           LIMIT ?`,
        )
        .bind(entityId, entityId, NEIGHBOR_LIMIT)
        .all<ArtifactRow>();
      for (const row of artifactRows.results) {
        results.push({
          node: {
            id: row.id,
            entityType: 'artifact',
            label: row.artifact_type + (row.logical_key ? `: ${row.logical_key}` : ''),
            metadata: { type: row.artifact_type, logicalKey: row.logical_key },
            depth: 0,
          },
          edge: {
            fromId: entityId,
            fromType: 'interaction',
            toId: row.id,
            toType: 'artifact',
            relationship: 'produced',
            sourceEvidence: null,
          },
        });
      }

      // Assertions linked to this interaction via signal_evidence
      const signalRows = await db
        .prepare(
          `SELECT id, workspace_person_id, interaction_id, assertion_id,
                  concept_id, signal_key, evidence_level, strength
           FROM signal_evidence
           WHERE interaction_id = ?
           LIMIT ?`,
        )
        .bind(entityId, NEIGHBOR_LIMIT)
        .all<SignalEvidenceRow>();

      const seenAssertionIds = new Set<string>();
      for (const row of signalRows.results) {
        results.push({
          node: {
            id: row.id,
            entityType: 'signal_evidence',
            label: `${row.signal_key} (${row.evidence_level})`,
            metadata: { strength: row.strength },
            depth: 0,
          },
          edge: {
            fromId: entityId,
            fromType: 'interaction',
            toId: row.id,
            toType: 'signal_evidence',
            relationship: 'surfaced_signal',
            sourceEvidence: null,
          },
        });

        if (!seenAssertionIds.has(row.assertion_id)) {
          seenAssertionIds.add(row.assertion_id);
          const assertionNode = await loadNode(db, 'assertion', row.assertion_id, 0);
          if (assertionNode) {
            results.push({
              node: assertionNode,
              edge: {
                fromId: entityId,
                fromType: 'interaction',
                toId: row.assertion_id,
                toType: 'assertion',
                relationship: 'yielded',
                sourceEvidence: null,
              },
            });
          }
        }
      }
      break;
    }

    case 'artifact': {
      const spanRows = await db
        .prepare(
          `SELECT ss.id, ss.artifact_version_id, ss.exact_text, ss.stable_segment_id
           FROM source_spans ss
           JOIN artifact_versions av ON av.id = ss.artifact_version_id
           WHERE av.artifact_id = ?
           LIMIT ?`,
        )
        .bind(entityId, NEIGHBOR_LIMIT)
        .all<SourceSpanRow>();
      for (const row of spanRows.results) {
        const preview =
          row.exact_text.length > 80
            ? row.exact_text.slice(0, 80) + '…'
            : row.exact_text;
        results.push({
          node: {
            id: row.id,
            entityType: 'source_span',
            label: preview,
            metadata: { segmentId: row.stable_segment_id },
            depth: 0,
          },
          edge: {
            fromId: entityId,
            fromType: 'artifact',
            toId: row.id,
            toType: 'source_span',
            relationship: 'contains_span',
            sourceEvidence: {
              sourceSpanId: row.id,
              exactText: row.exact_text.length > 200
                ? row.exact_text.slice(0, 200) + '…'
                : row.exact_text,
              confidence: null,
            },
          },
        });
      }

      const interactionRows = await db
        .prepare(
          `SELECT ai.interaction_id
           FROM artifact_interactions ai
           WHERE ai.artifact_id = ?
           LIMIT ?`,
        )
        .bind(entityId, NEIGHBOR_LIMIT)
        .all<ArtifactInteractionRow>();
      for (const row of interactionRows.results) {
        const interactionNode = await loadNode(db, 'interaction', row.interaction_id, 0);
        if (interactionNode) {
          results.push({
            node: interactionNode,
            edge: {
              fromId: entityId,
              fromType: 'artifact',
              toId: row.interaction_id,
              toType: 'interaction',
              relationship: 'belongs_to',
              sourceEvidence: null,
            },
          });
        }
      }
      break;
    }

    case 'assertion': {
      const conceptRows = await db
        .prepare(
          `SELECT ac.assertion_id, ac.concept_id, ac.relationship, ac.weight,
                  c.canonical_key, c.namespace, c.label
           FROM assertion_concepts ac
           JOIN concepts c ON c.id = ac.concept_id
           WHERE ac.assertion_id = ?
           LIMIT ?`,
        )
        .bind(entityId, NEIGHBOR_LIMIT)
        .all<AssertionConceptRow & ConceptRow>();
      for (const row of conceptRows.results) {
        results.push({
          node: {
            id: row.concept_id,
            entityType: 'concept',
            label: row.label,
            metadata: { canonicalKey: row.canonical_key, namespace: row.namespace },
            depth: 0,
          },
          edge: {
            fromId: entityId,
            fromType: 'assertion',
            toId: row.concept_id,
            toType: 'concept',
            relationship: row.relationship,
            sourceEvidence: { sourceSpanId: null, exactText: null, confidence: row.weight },
          },
        });
      }

      const spanRows = await db
        .prepare(
          `SELECT ass.assertion_id, ass.source_span_id, ass.evidence_role,
                  ss.exact_text
           FROM assertion_source_spans ass
           JOIN source_spans ss ON ss.id = ass.source_span_id
           WHERE ass.assertion_id = ?
           LIMIT ?`,
        )
        .bind(entityId, NEIGHBOR_LIMIT)
        .all<AssertionSourceSpanRow & { exact_text: string }>();
      for (const row of spanRows.results) {
        const preview =
          row.exact_text.length > 80
            ? row.exact_text.slice(0, 80) + '…'
            : row.exact_text;
        results.push({
          node: {
            id: row.source_span_id,
            entityType: 'source_span',
            label: preview,
            metadata: { evidenceRole: row.evidence_role },
            depth: 0,
          },
          edge: {
            fromId: entityId,
            fromType: 'assertion',
            toId: row.source_span_id,
            toType: 'source_span',
            relationship: 'sourced_from',
            sourceEvidence: {
              sourceSpanId: row.source_span_id,
              exactText: row.exact_text.length > 200
                ? row.exact_text.slice(0, 200) + '…'
                : row.exact_text,
              confidence: null,
            },
          },
        });
      }

      const signalRows = await db
        .prepare(
          `SELECT id, workspace_person_id, interaction_id, assertion_id,
                  concept_id, signal_key, evidence_level, strength
           FROM signal_evidence
           WHERE assertion_id = ?
           LIMIT ?`,
        )
        .bind(entityId, NEIGHBOR_LIMIT)
        .all<SignalEvidenceRow>();
      for (const row of signalRows.results) {
        results.push({
          node: {
            id: row.id,
            entityType: 'signal_evidence',
            label: `${row.signal_key} (${row.evidence_level})`,
            metadata: { strength: row.strength, evidenceLevel: row.evidence_level },
            depth: 0,
          },
          edge: {
            fromId: entityId,
            fromType: 'assertion',
            toId: row.id,
            toType: 'signal_evidence',
            relationship: 'produced_signal',
            sourceEvidence: null,
          },
        });
      }
      break;
    }

    case 'concept': {
      const assertionRows = await db
        .prepare(
          `SELECT sa.id, sa.workspace_person_id, sa.episode_id,
                  sa.predicate, sa.narrative, sa.confidence
           FROM assertion_concepts ac
           JOIN semantic_assertions sa ON sa.id = ac.assertion_id
           WHERE ac.concept_id = ? AND sa.workspace_person_id = ?
           LIMIT ?`,
        )
        .bind(entityId, workspacePersonId, NEIGHBOR_LIMIT)
        .all<AssertionRow>();
      for (const row of assertionRows.results) {
        results.push({
          node: {
            id: row.id,
            entityType: 'assertion',
            label: row.predicate,
            metadata: { narrative: row.narrative, confidence: row.confidence },
            depth: 0,
          },
          edge: {
            fromId: entityId,
            fromType: 'concept',
            toId: row.id,
            toType: 'assertion',
            relationship: 'evidenced_by',
            sourceEvidence: null,
          },
        });
      }

      const signalRows = await db
        .prepare(
          `SELECT id, workspace_person_id, interaction_id, assertion_id,
                  concept_id, signal_key, evidence_level, strength
           FROM signal_evidence
           WHERE concept_id = ? AND workspace_person_id = ?
           LIMIT ?`,
        )
        .bind(entityId, workspacePersonId, NEIGHBOR_LIMIT)
        .all<SignalEvidenceRow>();
      for (const row of signalRows.results) {
        results.push({
          node: {
            id: row.id,
            entityType: 'signal_evidence',
            label: `${row.signal_key} (${row.evidence_level})`,
            metadata: { strength: row.strength },
            depth: 0,
          },
          edge: {
            fromId: entityId,
            fromType: 'concept',
            toId: row.id,
            toType: 'signal_evidence',
            relationship: 'has_signal',
            sourceEvidence: null,
          },
        });
      }
      break;
    }

    case 'signal_evidence': {
      const row = await db
        .prepare(
          `SELECT id, workspace_person_id, interaction_id, assertion_id,
                  concept_id, signal_key, evidence_level, strength
           FROM signal_evidence WHERE id = ?`,
        )
        .bind(entityId)
        .first<SignalEvidenceRow>();
      if (row) {
        const assertionNode = await loadNode(db, 'assertion', row.assertion_id, 0);
        if (assertionNode) {
          results.push({
            node: assertionNode,
            edge: {
              fromId: entityId,
              fromType: 'signal_evidence',
              toId: row.assertion_id,
              toType: 'assertion',
              relationship: 'derived_from',
              sourceEvidence: null,
            },
          });
        }
        if (row.concept_id) {
          const conceptNode = await loadNode(db, 'concept', row.concept_id, 0);
          if (conceptNode) {
            results.push({
              node: conceptNode,
              edge: {
                fromId: entityId,
                fromType: 'signal_evidence',
                toId: row.concept_id,
                toType: 'concept',
                relationship: 'measures',
                sourceEvidence: null,
              },
            });
          }
        }
        if (row.interaction_id) {
          const interactionNode = await loadNode(db, 'interaction', row.interaction_id, 0);
          if (interactionNode) {
            results.push({
              node: interactionNode,
              edge: {
                fromId: entityId,
                fromType: 'signal_evidence',
                toId: row.interaction_id,
                toType: 'interaction',
                relationship: 'observed_in',
                sourceEvidence: null,
              },
            });
          }
        }
      }
      break;
    }

    case 'source_span': {
      const assertionRows = await db
        .prepare(
          `SELECT ass.assertion_id, ass.evidence_role,
                  sa.predicate, sa.narrative, sa.confidence
           FROM assertion_source_spans ass
           JOIN semantic_assertions sa ON sa.id = ass.assertion_id
           WHERE ass.source_span_id = ?
           LIMIT ?`,
        )
        .bind(entityId, NEIGHBOR_LIMIT)
        .all<{ assertion_id: string; evidence_role: string; predicate: string; narrative: string; confidence: number | null }>();
      for (const row of assertionRows.results) {
        results.push({
          node: {
            id: row.assertion_id,
            entityType: 'assertion',
            label: row.predicate,
            metadata: { narrative: row.narrative, confidence: row.confidence },
            depth: 0,
          },
          edge: {
            fromId: entityId,
            fromType: 'source_span',
            toId: row.assertion_id,
            toType: 'assertion',
            relationship: 'supports',
            sourceEvidence: {
              sourceSpanId: entityId,
              exactText: null,
              confidence: row.confidence,
            },
          },
        });
      }
      break;
    }

    case 'match_run': {
      const row = await db
        .prepare(
          `SELECT id, candidate_id, status, selected_packet_id
           FROM match_runs WHERE id = ?`,
        )
        .bind(entityId)
        .first<MatchRunRow>();
      if (row) {
        const appRow = await db
          .prepare(
            `SELECT workspace_person_id FROM applications
             WHERE legacy_candidate_id = ?`,
          )
          .bind(row.candidate_id)
          .first<{ workspace_person_id: string }>();
        if (appRow) {
          const wpNode = await loadNode(db, 'workspace_person', appRow.workspace_person_id, 0);
          if (wpNode) {
            results.push({
              node: wpNode,
              edge: {
                fromId: entityId,
                fromType: 'match_run',
                toId: appRow.workspace_person_id,
                toType: 'workspace_person',
                relationship: 'matched_candidate',
                sourceEvidence: null,
              },
            });
          }
        }
      }
      break;
    }
  }

  return results;
}
