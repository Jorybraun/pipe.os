-- Concept evolution events — tracks merges, splits, and supersessions.
-- Enables criterion #3: concepts and relationships evolve through persisted evidence.

CREATE TABLE IF NOT EXISTS concept_evolution_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL CHECK(event_type IN ('merge', 'split', 'alias_added', 'superseded')),
  survivor_concept_id TEXT NOT NULL REFERENCES concepts(id),
  survivor_canonical_key TEXT NOT NULL,
  absorbed_concept_ids_json TEXT NOT NULL DEFAULT '[]',
  absorbed_canonical_keys_json TEXT NOT NULL DEFAULT '[]',
  reason TEXT NOT NULL DEFAULT '',
  performed_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_concept_evolution_survivor
  ON concept_evolution_events(survivor_concept_id, performed_at DESC);

CREATE INDEX IF NOT EXISTS idx_concept_evolution_type
  ON concept_evolution_events(event_type, performed_at DESC);
