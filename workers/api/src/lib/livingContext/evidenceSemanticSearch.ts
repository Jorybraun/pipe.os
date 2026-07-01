/**
 * evidenceSemanticSearch.ts — Unified cross-evidence search by text and concept.
 *
 * Combines source span text search (LIKE), concept-based lookup (via
 * assertion_concepts → concepts), and assertion narrative search into a single
 * ranked result set with full provenance on each hit.
 *
 * This fulfills criterion #2: "Original content remains semantically searchable —
 * PIPE can always explain where a conclusion originated."
 *
 * Three search strategies:
 * - text: LIKE match across source_spans.exact_text and semantic_assertions.narrative
 * - concept: resolve query to concept keys, return all evidence linked to those concepts
 * - hybrid: combine text hits + concept hits, deduplicate, rank by relevance
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type SearchStrategy = 'text' | 'concept' | 'hybrid';
export type EvidenceHitType = 'source_span' | 'assertion' | 'signal_evidence';

export interface EvidenceSearchOptions {
  strategy?: SearchStrategy;
  limit?: number;
  minConfidence?: number;
  interactionTypes?: string[];
  since?: string;
  until?: string;
}

export interface EvidenceHitProvenance {
  interactionId: string | null;
  interactionType: string | null;
  interactionOccurredAt: string | null;
  artifactId: string | null;
  artifactType: string | null;
  artifactLogicalKey: string | null;
}

export interface EvidenceSearchHit {
  id: string;
  hitType: EvidenceHitType;
  text: string;
  matchedOn: 'text' | 'concept';
  relevanceScore: number;
  conceptKeys: string[];
  confidence: number | null;
  provenance: EvidenceHitProvenance;
  sourceSpanId: string | null;
  charStart: number | null;
  charEnd: number | null;
  lineStart: number | null;
  lineEnd: number | null;
  timestampStartMs: number | null;
  timestampEndMs: number | null;
}

export interface EvidenceSearchResult {
  candidateId: string;
  query: string;
  strategy: SearchStrategy;
  hits: EvidenceSearchHit[];
  totalHits: number;
  conceptsMatched: string[];
  truncated: boolean;
}

// ── D1 row types ─────────────────────────────────────────────────────────────

interface SpanHitRow {
  source_span_id: string;
  exact_text: string;
  char_start: number | null;
  char_end: number | null;
  line_start: number | null;
  line_end: number | null;
  timestamp_start_ms: number | null;
  timestamp_end_ms: number | null;
  interaction_id: string | null;
  interaction_type: string | null;
  started_at: string | null;
  artifact_id: string | null;
  artifact_type: string | null;
  logical_key: string | null;
}

interface AssertionHitRow {
  assertion_id: string;
  narrative: string;
  confidence: number | null;
  observed_at: string | null;
}

// ── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

// ── Core search function ─────────────────────────────────────────────────────

export async function searchEvidence(
  db: D1Database,
  workspacePersonId: string,
  query: string,
  options: EvidenceSearchOptions = {},
): Promise<EvidenceSearchResult> {
  const {
    strategy = 'hybrid',
    limit = DEFAULT_LIMIT,
    minConfidence,
    interactionTypes,
    since,
    until,
  } = options;
  const effectiveLimit = Math.min(limit, MAX_LIMIT);
  const trimmed = query.trim();

  const result: EvidenceSearchResult = {
    candidateId: workspacePersonId,
    query: trimmed,
    strategy,
    hits: [],
    totalHits: 0,
    conceptsMatched: [],
    truncated: false,
  };

  if (!trimmed) return result;

  const hits: EvidenceSearchHit[] = [];
  const conceptsMatched = new Set<string>();

  // ─── Text search ────────────────────────────────────────────────────────
  if (strategy === 'text' || strategy === 'hybrid') {
    const escaped = trimmed.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
    const like = `%${escaped}%`;

    // Search source spans via interactions → artifacts → artifact_versions → source_spans
    const spanHits = await db.prepare(
      `SELECT ss.id AS source_span_id, ss.exact_text, ss.char_start, ss.char_end,
              ss.line_start, ss.line_end, ss.timestamp_start_ms, ss.timestamp_end_ms,
              i.id AS interaction_id, i.interaction_type, i.started_at,
              a.id AS artifact_id, a.artifact_type, a.logical_key
         FROM source_spans ss
         JOIN artifact_versions av ON av.id = ss.artifact_version_id
         JOIN artifacts a ON a.id = av.artifact_id
         JOIN interactions i ON i.id = a.interaction_id
        WHERE i.workspace_person_id = ?1
          AND LOWER(ss.exact_text) LIKE LOWER(?2) ESCAPE '\\'
        ORDER BY COALESCE(i.started_at, i.created_at) DESC, ss.char_start
        LIMIT ?3`,
    ).bind(workspacePersonId, like, effectiveLimit).all<SpanHitRow>();

    for (const row of spanHits.results ?? []) {
      if (interactionTypes && row.interaction_type && !interactionTypes.includes(row.interaction_type)) continue;
      if (since && row.started_at && row.started_at < since) continue;
      if (until && row.started_at && row.started_at > until) continue;

      hits.push({
        id: row.source_span_id,
        hitType: 'source_span',
        text: row.exact_text,
        matchedOn: 'text',
        relevanceScore: computeTextRelevance(trimmed, row.exact_text),
        conceptKeys: [],
        confidence: null,
        provenance: {
          interactionId: row.interaction_id,
          interactionType: row.interaction_type,
          interactionOccurredAt: row.started_at,
          artifactId: row.artifact_id,
          artifactType: row.artifact_type,
          artifactLogicalKey: row.logical_key,
        },
        sourceSpanId: row.source_span_id,
        charStart: row.char_start,
        charEnd: row.char_end,
        lineStart: row.line_start,
        lineEnd: row.line_end,
        timestampStartMs: row.timestamp_start_ms,
        timestampEndMs: row.timestamp_end_ms,
      });
    }

    // Search assertion narratives
    const assertionHits = await db.prepare(
      `SELECT sa.id AS assertion_id, sa.narrative, sa.confidence, sa.observed_at
         FROM semantic_assertions sa
        WHERE sa.workspace_person_id = ?1
          AND LOWER(sa.narrative) LIKE LOWER(?2) ESCAPE '\\'
        ORDER BY sa.observed_at DESC, sa.id
        LIMIT ?3`,
    ).bind(workspacePersonId, like, effectiveLimit).all<AssertionHitRow>();

    for (const row of assertionHits.results ?? []) {
      if (minConfidence != null && row.confidence != null && row.confidence < minConfidence) continue;
      if (since && row.observed_at && row.observed_at < since) continue;
      if (until && row.observed_at && row.observed_at > until) continue;

      hits.push({
        id: row.assertion_id,
        hitType: 'assertion',
        text: row.narrative,
        matchedOn: 'text',
        relevanceScore: computeTextRelevance(trimmed, row.narrative),
        conceptKeys: [],
        confidence: row.confidence,
        provenance: {
          interactionId: null,
          interactionType: null,
          interactionOccurredAt: row.observed_at,
          artifactId: null,
          artifactType: null,
          artifactLogicalKey: null,
        },
        sourceSpanId: null,
        charStart: null,
        charEnd: null,
        lineStart: null,
        lineEnd: null,
        timestampStartMs: null,
        timestampEndMs: null,
      });
    }
  }

  // ─── Concept search ─────────────────────────────────────────────────────
  if (strategy === 'concept' || strategy === 'hybrid') {
    const normalizedQuery = trimmed.toLowerCase().replace(/[\s\-_]+/g, '_');
    const conceptLike = `%${normalizedQuery}%`;

    // Resolve query to matching concept keys
    const matchedConcepts = await db.prepare(
      `SELECT DISTINCT c.id, c.canonical_key
         FROM concepts c
        WHERE (LOWER(c.canonical_key) LIKE LOWER(?1) ESCAPE '\\'
           OR c.id IN (
             SELECT cs.concept_id FROM concept_surfaces cs
             WHERE LOWER(cs.normalized_surface) LIKE LOWER(?1) ESCAPE '\\'
           ))
          AND c.superseded_at IS NULL
        LIMIT 20`,
    ).bind(conceptLike).all<{ id: string; canonical_key: string }>();

    const conceptIds = (matchedConcepts.results ?? []).map((c) => c.id);
    for (const c of matchedConcepts.results ?? []) {
      conceptsMatched.add(c.canonical_key);
    }

    if (conceptIds.length > 0) {
      // Find assertions linked to these concepts that belong to this workspace person
      const placeholders = conceptIds.map((_, i) => `?${i + 1}`).join(',');
      const linkedAssertions = await db.prepare(
        `SELECT DISTINCT ac.assertion_id, c.canonical_key
           FROM assertion_concepts ac
           JOIN concepts c ON c.id = ac.concept_id
           JOIN semantic_assertions sa ON sa.id = ac.assertion_id
          WHERE ac.concept_id IN (${placeholders})
            AND sa.workspace_person_id = ?${conceptIds.length + 1}
          LIMIT ?${conceptIds.length + 2}`,
      ).bind(...conceptIds, workspacePersonId, effectiveLimit * 2).all<{ assertion_id: string; canonical_key: string }>();

      const conceptKeysByAssertion = new Map<string, string[]>();
      for (const link of linkedAssertions.results ?? []) {
        const existing = conceptKeysByAssertion.get(link.assertion_id) ?? [];
        existing.push(link.canonical_key);
        conceptKeysByAssertion.set(link.assertion_id, existing);
      }

      const assertionIds = [...conceptKeysByAssertion.keys()];
      if (assertionIds.length > 0) {
        const aPlaceholders = assertionIds.map((_, i) => `?${i + 1}`).join(',');
        const assertionDetails = await db.prepare(
          `SELECT sa.id AS assertion_id, sa.narrative, sa.confidence, sa.observed_at
             FROM semantic_assertions sa
            WHERE sa.id IN (${aPlaceholders})
            ORDER BY sa.observed_at DESC
            LIMIT ?${assertionIds.length + 1}`,
        ).bind(...assertionIds, effectiveLimit).all<AssertionHitRow>();

        for (const row of assertionDetails.results ?? []) {
          if (minConfidence != null && row.confidence != null && row.confidence < minConfidence) continue;
          if (since && row.observed_at && row.observed_at < since) continue;
          if (until && row.observed_at && row.observed_at > until) continue;

          // Deduplicate with existing text hits
          const existingHit = hits.find((h) => h.id === row.assertion_id);
          if (existingHit) {
            existingHit.conceptKeys = conceptKeysByAssertion.get(row.assertion_id) ?? [];
            existingHit.relevanceScore = Math.min(1, existingHit.relevanceScore + 0.2);
            continue;
          }

          hits.push({
            id: row.assertion_id,
            hitType: 'assertion',
            text: row.narrative,
            matchedOn: 'concept',
            relevanceScore: computeConceptRelevance(conceptKeysByAssertion.get(row.assertion_id)?.length ?? 0),
            conceptKeys: conceptKeysByAssertion.get(row.assertion_id) ?? [],
            confidence: row.confidence,
            provenance: {
              interactionId: null,
              interactionType: null,
              interactionOccurredAt: row.observed_at,
              artifactId: null,
              artifactType: null,
              artifactLogicalKey: null,
            },
            sourceSpanId: null,
            charStart: null,
            charEnd: null,
            lineStart: null,
            lineEnd: null,
            timestampStartMs: null,
            timestampEndMs: null,
          });
        }
      }
    }
  }

  // ─── Rank and deduplicate ───────────────────────────────────────────────
  hits.sort((a, b) => b.relevanceScore - a.relevanceScore);
  const deduped = deduplicateHits(hits);
  const truncated = deduped.length > effectiveLimit;
  const finalHits = deduped.slice(0, effectiveLimit);

  result.hits = finalHits;
  result.totalHits = deduped.length;
  result.conceptsMatched = [...conceptsMatched];
  result.truncated = truncated;

  return result;
}

// ── Relevance scoring ────────────────────────────────────────────────────────

function computeTextRelevance(query: string, text: string): number {
  const lowerQuery = query.toLowerCase();
  const lowerText = text.toLowerCase();

  if (lowerText === lowerQuery) return 1.0;
  if (lowerText.startsWith(lowerQuery)) return 0.9;

  const wordBoundaryPattern = new RegExp(`\\b${escapeRegex(lowerQuery)}\\b`, 'i');
  if (wordBoundaryPattern.test(text)) return 0.8;

  const ratio = query.length / Math.max(text.length, 1);
  return Math.min(0.7, 0.3 + ratio * 0.4);
}

function computeConceptRelevance(matchedConceptCount: number): number {
  return Math.min(0.9, 0.5 + matchedConceptCount * 0.15);
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function deduplicateHits(hits: EvidenceSearchHit[]): EvidenceSearchHit[] {
  const seen = new Set<string>();
  return hits.filter((hit) => {
    const key = `${hit.hitType}:${hit.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
