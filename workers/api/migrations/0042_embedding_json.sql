-- Migration 0042: Dual-layer embedding ground truth (D1 JSON + Vectorize ANN)
--
-- Adds embedding_json columns so D1 becomes the source of truth for exact
-- cosine computation and index rebuilds. Vectorize remains the fast ANN
-- query layer. Also adds role_searchable_profile so role contexts can be
-- embedded and searched against candidates and repos.
--
-- See ADR-040 and STRATEGY Decision Log 2026-04-22.

ALTER TABLE candidate_ingestion ADD COLUMN embedding_json TEXT;

ALTER TABLE repo_engineering_signals ADD COLUMN embedding_json TEXT;

ALTER TABLE role_contexts ADD COLUMN role_searchable_profile TEXT;
ALTER TABLE role_contexts ADD COLUMN embedding_json TEXT;
