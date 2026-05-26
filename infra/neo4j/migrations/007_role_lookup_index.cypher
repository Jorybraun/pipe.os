/**
 * Migration 007: Lookup indexes for Role and Candidate root nodes.
 *
 * The matching queries do frequent lookups by role_context_id and candidate_id.
 * Without indexes, these are label scans. Lookup indexes make them O(log n).
 *
 * These are NOT unique constraints — uniqueness is enforced by application logic.
 */

CREATE INDEX role_context_id_lookup IF NOT EXISTS
  FOR (r:Role)
  ON (r.role_context_id);

CREATE INDEX candidate_id_lookup IF NOT EXISTS
  FOR (c:Candidate)
  ON (c.candidate_id);
