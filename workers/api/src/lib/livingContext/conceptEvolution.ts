/**
 * conceptEvolution.ts — Tracks how concepts merge, split, and evolve over time.
 *
 * The concept registry persists `superseded_at` and `superseded_by_id` on the
 * concepts table but does not expose lifecycle operations (merge, split) or a
 * queryable evolution timeline. This module provides:
 *
 * 1. mergeConcepts — folds multiple concepts into one canonical survivor;
 *    repoints all surfaces, adjacencies, and assertion links.
 * 2. splitConcept — creates a new concept from a subset of an existing one's
 *    surfaces, moving provenance with them.
 * 3. queryConceptEvolution — returns a timeline of all evolution events
 *    (merges, splits, alias additions) for a concept or workspace.
 *
 * Criteria advanced: #3 (learn semantics dynamically — concepts evolve).
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type EvolutionEventType = 'merge' | 'split' | 'alias_added' | 'superseded';

export interface ConceptEvolutionEvent {
  id: string;
  eventType: EvolutionEventType;
  survivorConceptId: string;
  survivorCanonicalKey: string;
  absorbedConceptIds: string[];
  absorbedCanonicalKeys: string[];
  reason: string;
  performedAt: string;
  metadata: Record<string, unknown>;
}

export interface ConceptEvolutionTimeline {
  conceptId: string;
  canonicalKey: string;
  events: ConceptEvolutionEvent[];
  currentAliases: string[];
  supersessionChain: SupersessionLink[];
}

export interface SupersessionLink {
  fromConceptId: string;
  fromCanonicalKey: string;
  toConceptId: string;
  toCanonicalKey: string;
  supersededAt: string;
}

export interface MergeConceptsInput {
  survivorConceptId: string;
  absorbedConceptIds: string[];
  reason: string;
}

export interface MergeConceptsResult {
  survivorConceptId: string;
  survivorCanonicalKey: string;
  mergedCount: number;
  surfacesRepointed: number;
  adjacenciesRepointed: number;
  assertionLinksRepointed: number;
  eventId: string;
}

export interface SplitConceptInput {
  sourceConceptId: string;
  newCanonicalKey: string;
  newLabel: string;
  newNamespace?: string;
  surfaceIdsToMove: string[];
  reason: string;
}

export interface SplitConceptResult {
  newConceptId: string;
  newCanonicalKey: string;
  surfacesMoved: number;
  eventId: string;
}

export interface ConceptEvolutionOptions {
  limit?: number;
  since?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function generateId(prefix: string): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${ts}_${rand}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

// ── D1 row types ─────────────────────────────────────────────────────────────

interface ConceptRow {
  id: string;
  canonical_key: string;
  namespace: string;
  label: string;
  superseded_at: number | null;
  superseded_by_id: string | null;
}

interface SurfaceRow {
  id: string;
  concept_id: string;
  surface: string;
}

interface EvolutionEventRow {
  id: string;
  event_type: string;
  survivor_concept_id: string;
  survivor_canonical_key: string;
  absorbed_concept_ids_json: string;
  absorbed_canonical_keys_json: string;
  reason: string;
  performed_at: string;
  metadata_json: string;
}

// ── Core functions ───────────────────────────────────────────────────────────

/**
 * Merge multiple concepts into a single survivor. All surfaces, adjacencies,
 * and assertion_concepts links from absorbed concepts are repointed to the
 * survivor. Absorbed concepts are marked superseded.
 */
export async function mergeConcepts(
  db: D1Database,
  input: MergeConceptsInput,
): Promise<MergeConceptsResult> {
  const { survivorConceptId, absorbedConceptIds, reason } = input;

  if (absorbedConceptIds.length === 0) {
    throw new Error('mergeConcepts requires at least one absorbed concept');
  }
  if (absorbedConceptIds.includes(survivorConceptId)) {
    throw new Error('Survivor concept cannot be in absorbed list');
  }

  // Load survivor
  const survivor = await db.prepare(
    `SELECT id, canonical_key, namespace, label FROM concepts WHERE id = ?1`,
  ).bind(survivorConceptId).first<ConceptRow>();
  if (!survivor) throw new Error(`Survivor concept not found: ${survivorConceptId}`);

  // Load absorbed concepts
  const absorbedKeys: string[] = [];
  for (const absId of absorbedConceptIds) {
    const absorbed = await db.prepare(
      `SELECT id, canonical_key FROM concepts WHERE id = ?1`,
    ).bind(absId).first<ConceptRow>();
    if (!absorbed) throw new Error(`Absorbed concept not found: ${absId}`);
    absorbedKeys.push(absorbed.canonical_key);
  }

  const nowTs = Math.floor(Date.now() / 1000);
  let surfacesRepointed = 0;
  let adjacenciesRepointed = 0;
  let assertionLinksRepointed = 0;

  // Repoint concept_surfaces
  for (const absId of absorbedConceptIds) {
    const surfaceResult = await db.prepare(
      `UPDATE concept_surfaces SET concept_id = ?1 WHERE concept_id = ?2`,
    ).bind(survivorConceptId, absId).run();
    surfacesRepointed += surfaceResult.meta?.changes ?? 0;
  }

  // Repoint concept_adjacency (from side)
  for (const absId of absorbedConceptIds) {
    const fromResult = await db.prepare(
      `UPDATE concept_adjacency SET from_concept_id = ?1 WHERE from_concept_id = ?2 AND to_concept_id != ?1`,
    ).bind(survivorConceptId, absId).run();
    adjacenciesRepointed += fromResult.meta?.changes ?? 0;

    // Repoint to side
    const toResult = await db.prepare(
      `UPDATE concept_adjacency SET to_concept_id = ?1 WHERE to_concept_id = ?2 AND from_concept_id != ?1`,
    ).bind(survivorConceptId, absId).run();
    adjacenciesRepointed += toResult.meta?.changes ?? 0;

    // Remove self-loops created by merge
    await db.prepare(
      `DELETE FROM concept_adjacency WHERE from_concept_id = ?1 AND to_concept_id = ?1`,
    ).bind(survivorConceptId).run();
  }

  // Repoint assertion_concepts
  for (const absId of absorbedConceptIds) {
    const assertResult = await db.prepare(
      `UPDATE assertion_concepts SET concept_id = ?1 WHERE concept_id = ?2`,
    ).bind(survivorConceptId, absId).run();
    assertionLinksRepointed += assertResult.meta?.changes ?? 0;
  }

  // Mark absorbed concepts as superseded
  for (const absId of absorbedConceptIds) {
    await db.prepare(
      `UPDATE concepts SET superseded_at = ?1, superseded_by_id = ?2, updated_at = datetime('now') WHERE id = ?3`,
    ).bind(nowTs, survivorConceptId, absId).run();
  }

  // Update survivor observation count (aggregate absorbed counts)
  await db.prepare(
    `UPDATE concepts SET
       observation_count = observation_count + (
         SELECT COALESCE(SUM(observation_count), 0)
         FROM concepts WHERE id IN (${absorbedConceptIds.map(() => '?').join(',')})
       ),
       updated_at = datetime('now')
     WHERE id = ?`,
  ).bind(...absorbedConceptIds, survivorConceptId).run();

  // Record evolution event
  const eventId = generateId('cev');
  await db.prepare(
    `INSERT INTO concept_evolution_events (id, event_type, survivor_concept_id, survivor_canonical_key, absorbed_concept_ids_json, absorbed_canonical_keys_json, reason, performed_at, metadata_json)
     VALUES (?1, 'merge', ?2, ?3, ?4, ?5, ?6, ?7, '{}')`,
  ).bind(
    eventId,
    survivorConceptId,
    survivor.canonical_key,
    JSON.stringify(absorbedConceptIds),
    JSON.stringify(absorbedKeys),
    reason,
    nowIso(),
  ).run();

  return {
    survivorConceptId,
    survivorCanonicalKey: survivor.canonical_key,
    mergedCount: absorbedConceptIds.length,
    surfacesRepointed,
    adjacenciesRepointed,
    assertionLinksRepointed,
    eventId,
  };
}

/**
 * Split a concept by moving a subset of its surfaces to a new concept.
 * The original concept retains remaining surfaces. Both concepts track the
 * split event.
 */
export async function splitConcept(
  db: D1Database,
  input: SplitConceptInput,
): Promise<SplitConceptResult> {
  const { sourceConceptId, newCanonicalKey, newLabel, newNamespace, surfaceIdsToMove, reason } = input;

  if (surfaceIdsToMove.length === 0) {
    throw new Error('splitConcept requires at least one surface to move');
  }

  // Load source concept
  const source = await db.prepare(
    `SELECT id, canonical_key, namespace FROM concepts WHERE id = ?1`,
  ).bind(sourceConceptId).first<ConceptRow>();
  if (!source) throw new Error(`Source concept not found: ${sourceConceptId}`);

  // Verify surfaces belong to source
  for (const surfId of surfaceIdsToMove) {
    const surf = await db.prepare(
      `SELECT id, concept_id FROM concept_surfaces WHERE id = ?1`,
    ).bind(surfId).first<SurfaceRow>();
    if (!surf) throw new Error(`Surface not found: ${surfId}`);
    if (surf.concept_id !== sourceConceptId) {
      throw new Error(`Surface ${surfId} does not belong to source concept ${sourceConceptId}`);
    }
  }

  // Create new concept
  const newConceptId = generateId('con');
  const namespace = newNamespace ?? source.namespace;
  const nowTs = Math.floor(Date.now() / 1000);

  const ingestionKey = `ik-split-${newConceptId}`;
  await db.prepare(
    `INSERT INTO concepts (id, ingestion_key, canonical_key, namespace, label, first_observed_at, last_observed_at, observation_count, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, 0, datetime('now'), datetime('now'))`,
  ).bind(newConceptId, ingestionKey, newCanonicalKey, namespace, newLabel, nowTs).run();

  // Move surfaces
  let surfacesMoved = 0;
  for (const surfId of surfaceIdsToMove) {
    const res = await db.prepare(
      `UPDATE concept_surfaces SET concept_id = ?1 WHERE id = ?2`,
    ).bind(newConceptId, surfId).run();
    surfacesMoved += res.meta?.changes ?? 0;
  }

  // Update observation counts
  await db.prepare(
    `UPDATE concepts SET observation_count = (SELECT COUNT(*) FROM concept_surfaces WHERE concept_id = ?1), updated_at = datetime('now') WHERE id = ?1`,
  ).bind(newConceptId).run();
  await db.prepare(
    `UPDATE concepts SET observation_count = (SELECT COUNT(*) FROM concept_surfaces WHERE concept_id = ?1), updated_at = datetime('now') WHERE id = ?1`,
  ).bind(sourceConceptId).run();

  // Record evolution event
  const eventId = generateId('cev');
  await db.prepare(
    `INSERT INTO concept_evolution_events (id, event_type, survivor_concept_id, survivor_canonical_key, absorbed_concept_ids_json, absorbed_canonical_keys_json, reason, performed_at, metadata_json)
     VALUES (?1, 'split', ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
  ).bind(
    eventId,
    newConceptId,
    newCanonicalKey,
    JSON.stringify([sourceConceptId]),
    JSON.stringify([source.canonical_key]),
    reason,
    nowIso(),
    JSON.stringify({ surfacesMoved }),
  ).run();

  return { newConceptId, newCanonicalKey, surfacesMoved, eventId };
}

/**
 * Query the evolution history for a concept — all merges, splits, and
 * supersessions that have affected it.
 */
export async function queryConceptEvolution(
  db: D1Database,
  conceptId: string,
  options: ConceptEvolutionOptions = {},
): Promise<ConceptEvolutionTimeline> {
  const { limit = 50, since } = options;

  // Load concept
  const concept = await db.prepare(
    `SELECT id, canonical_key FROM concepts WHERE id = ?1`,
  ).bind(conceptId).first<ConceptRow>();
  if (!concept) throw new Error(`Concept not found: ${conceptId}`);

  // Load evolution events (where this concept is survivor or absorbed)
  let query = `SELECT id, event_type, survivor_concept_id, survivor_canonical_key,
                      absorbed_concept_ids_json, absorbed_canonical_keys_json,
                      reason, performed_at, metadata_json
                 FROM concept_evolution_events
                WHERE (survivor_concept_id = ?1
                   OR absorbed_concept_ids_json LIKE ?2)`;
  const params: unknown[] = [conceptId, `%${conceptId}%`];

  if (since) {
    query += ` AND performed_at >= ?${params.length + 1}`;
    params.push(since);
  }
  query += ` ORDER BY performed_at DESC LIMIT ?${params.length + 1}`;
  params.push(limit);

  const eventsResult = await db.prepare(query).bind(...params).all<EvolutionEventRow>();
  const events: ConceptEvolutionEvent[] = (eventsResult.results ?? []).map((row) => ({
    id: row.id,
    eventType: row.event_type as EvolutionEventType,
    survivorConceptId: row.survivor_concept_id,
    survivorCanonicalKey: row.survivor_canonical_key,
    absorbedConceptIds: JSON.parse(row.absorbed_concept_ids_json) as string[],
    absorbedCanonicalKeys: JSON.parse(row.absorbed_canonical_keys_json) as string[],
    reason: row.reason,
    performedAt: row.performed_at,
    metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
  }));

  // Load current aliases (all surfaces for this concept)
  const surfaces = await db.prepare(
    `SELECT DISTINCT surface FROM concept_surfaces WHERE concept_id = ?1 ORDER BY observed_at DESC`,
  ).bind(conceptId).all<{ surface: string }>();
  const currentAliases = (surfaces.results ?? []).map((r) => r.surface);

  // Load supersession chain
  const supersessionChain: SupersessionLink[] = [];
  let currentId: string | null = conceptId;
  const visited = new Set<string>();
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const conceptRow: ConceptRow | null = await db.prepare(
      `SELECT id, canonical_key, superseded_at, superseded_by_id FROM concepts WHERE id = ?1`,
    ).bind(currentId).first<ConceptRow>();
    if (!conceptRow || !conceptRow.superseded_by_id) break;
    const successor: ConceptRow | null = await db.prepare(
      `SELECT id, canonical_key FROM concepts WHERE id = ?1`,
    ).bind(conceptRow.superseded_by_id).first<ConceptRow>();
    if (!successor) break;
    supersessionChain.push({
      fromConceptId: conceptRow.id,
      fromCanonicalKey: conceptRow.canonical_key,
      toConceptId: successor.id,
      toCanonicalKey: successor.canonical_key,
      supersededAt: conceptRow.superseded_at ? new Date(conceptRow.superseded_at * 1000).toISOString() : nowIso(),
    });
    currentId = conceptRow.superseded_by_id;
  }

  return {
    conceptId,
    canonicalKey: concept.canonical_key,
    events,
    currentAliases,
    supersessionChain,
  };
}
