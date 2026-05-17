# Phase 0 — Dealbreaker Gate Enforcement — see part5-matching-migration/dealbreaker-gate-enforcement.md

This work item's canonical plan lives at:

**[../part5-matching-migration/dealbreaker-gate-enforcement.md](../part5-matching-migration/dealbreaker-gate-enforcement.md)**

This file is kept as a pointer because the strategy mentions the work in Part 2's role-discovery context. All execution details, subtasks, dependencies, and acceptance criteria are in the canonical file.

> **Implementation note:** Part 2's version used substring text matching against `candidateProfileText`; the canonical Part 5 version uses Vectorize ANN cosine similarity (threshold 0.75) and requires CANDIDATE_INDEX to be populated. Coordinate dependency on candidate sub-element embeddings before executing.
