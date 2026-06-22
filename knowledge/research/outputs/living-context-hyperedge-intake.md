# Living Context Hyperedge Intake

**Date:** 2026-06-19
**Status:** Research intake incorporated by the active hypergraph plan
**Related goal:** Production living context graph and deterministic candidate-to-PR matching
**Feeds:** `knowledge/plan/living-context-repo-matching-plan.md`, ADR-043

## Purpose

This note translates the BRAIN research pass into PIPE-OS design constraints.
It is not a competing plan; it is the research-backed rationale for the active
plan's hypergraph direction. The implementation rule is explicit: immutable
source records are the evidentiary proof layer, source-backed hyperedge/context
records are the semantic source of truth, and pairwise graph/search/match views
are rebuildable projections.

`original source evidence -> semantic spans/chunks -> source-backed hyperedge/context records -> rebuildable graph/search projections -> candidate-to-repo/PR matching -> explainable match report with provenance`

## What The Research Supports

### 1. Keep Source Evidence As The Proof Layer

The recurring failure mode across the knowledge-graph research is abstraction
loss: the system extracts a graph and then treats the graph as the evidence.
PIPE should not do that. The immutable source span is the authoritative proof
record. The source-backed hypergraph is the authoritative semantic record.

For PIPE this means:

- A transcript paragraph, resume line, assessment response, message, repo file
  span, PR diff span, or issue comment remains retrievable by stable source
  reference.
- Source-backed hyperedge/context records carry semantic truth.
- Signals, concepts, embeddings, pairwise graph edges, search indexes, and match
  report views are derived records.
- If a projection is deleted or rebuilt, exact source reconstruction must still
  be possible from D1, immutable artifacts, and source-backed hyperedge records.

### 2. Semantic Chunks Should Respect Meaning Boundaries

The semantic chunking paper supports boundary-aware segmentation rather than
fixed-size slicing. It models local semantic changes, discourse structure, and
global coherence, then creates chunks that are useful for retrieval without
destroying meaning.

For PIPE this means:

- Meeting and resume ingestion should preserve paragraph/sentence boundaries
  and attach source offsets before extracting meaning.
- A chunk is not a mini graph by default. It is a source-backed text unit with
  enough surrounding context to support later hyperedge/context records.
- Long chunks can have compact vector/search representations, but those
  representations must point back to exact spans.

### 3. Context Can Be The Relationship

HISR is the most relevant hypergraph input, but the local HISR PDF was not
present in BRAIN. The available evidence is a local paper extraction plus raw
conversation excerpts and the arXiv abstract page. Treat it as a research input,
not as a definitive implementation spec.

The useful design idea is narrow: some meaning is not pairwise. A candidate
statement like "I redesigned order processing with Kafka after checkout latency
spiked" connects multiple entities at once: person, action, business object,
mechanism, failure mode, time/context, and source span. Flattening that into
independent binary edges loses the event-like meaning.

For PIPE this means:

- Use source-backed hyperedge/context records as the canonical semantic unit.
- Require those records to preserve N-participant meaning when one context
  connects more than two participants or concepts.
- Keep pairwise graph edges as rebuildable projections for traversal and UI.
- Do not make a hard-coded list of hyperedge types, semantic edge labels, skills,
  aliases, domains, or signal families.

### 4. Multi-Granularity Retrieval Is Required

FlowRAG supports a multi-granularity retrieval pattern: coarse summaries help
abstract queries find relevant areas; fine sentence/entity nodes preserve exact
evidence and support explicit reasoning paths.

For PIPE this means:

- Candidate, role, and repo data need comparable levels: artifact, source span,
  episode, hyperedge/context record, concept/facet, signal, and accumulated
  snapshot.
- Search should be able to enter through coarse concepts and then descend to
  exact spans.
- Candidate-to-PR matching should align evidence paths, not just embeddings.

### 5. Schema And Projections Must Evolve

WikiKV and the context-rot paper both point to active maintenance of knowledge
structures. Static schemas and stale AI/context artifacts drift away from the
system they describe.

For PIPE this means:

- D1 stores the immutable proof layer and the source-backed hypergraph.
- Neo4j, vectors, search documents, graph UI trees, and matcher views are
  projections.
- Resolver changes, concept merges/splits, schema changes, and extraction model
  updates must be replayable from immutable source artifacts and hyperedge
  records.
- Drift detection should check whether derived projections still agree with
  current source/code state and the source-backed hypergraph.

### 6. Agent Work Must Be Auditable

SearchSwarm, DecomposeR, ScaffoldAgent, and AutoResearch all reinforce the same
operational pattern: decompose work explicitly, preserve rationale and evidence,
verify outputs, and keep append-only traces.

For PIPE this means:

- Backfills and extraction jobs should emit durable run records with source
  inputs, resolver/policy versions, generated hyperedge/context records,
  rejected hyperedge/context records, and verification outcomes.
- The system should be able to explain why a candidate evidence atom was created
  and why it did or did not align to a PR demand.
- Agent orchestration is useful only if it writes reviewable evidence, not just
  chat summaries.

## Design Inference For PIPE

The active living graph should be framed as three layers:

### Layer 1: Immutable Evidence Proof

Authoritative proof records:

- `Artifact`
- `ArtifactVersion`
- `SourceSpan`
- `RepoSnapshot`
- source hashes, offsets, line ranges, timestamps, participants, commit SHAs

This layer is not the semantic graph. It answers: what exact content existed,
where, when, and under which immutable version?

### Layer 2: Source-Backed Hyperedge Context Records

Canonical semantic source-of-truth records:

- `Episode`
- hyperedge/context record
- compatible `SemanticAssertion` projection/name while migration is underway
- context record participants
- open predicate / relation text
- qualifiers
- temporal/workspace/role context
- confidence and resolver metadata
- exact source references

This layer is the hypergraph. A source-backed context record connects N
participants under one contextual relation without forcing the meaning into
separate binary edges.

### Layer 3: Rebuildable Projections

Derived records:

- concept registry views
- signal snapshots
- graph traversal edges
- vector/search documents
- candidate query atoms
- PR demand atoms
- match alignments
- graph visualization trees

This layer is optimized for retrieval, matching, UI, and explanation. It can be
rebuilt from Layers 1 and 2 and must not be treated as semantic truth.

## Matching Implications

Candidate-to-PR matching should compile from source-backed hyperedge/context
records, not from generic summaries.

The matcher should compare:

- candidate hyperedge/context records to PR demands
- candidate mechanisms to repo mechanisms
- candidate business objects to repo business objects
- candidate action/ownership evidence to code-review demand
- candidate source context to repo source context

The matcher should not:

- infer competence from mention-only evidence
- fabricate default evidence strength or confidence
- translate unknown concepts through hard-coded alias maps
- choose a generic fallback repository
- rely on embedding similarity without source-backed hyperedge/context records

## Open Questions Before Implementation

1. What exact D1 shape should represent context record participants without
   turning semantic roles into code-owned enums?
2. Which compatibility projections should remain after hyperedge/context records
   become the canonical semantic model?
3. How much surrounding source context should each hyperedge/context record
   retain for semantic search and explanation?
4. Which projection views are required first for the demo: person tree, repo
   tree, match overlay, or provenance drilldown?
5. What drift checks should run before a projection is trusted by the matcher?

## Guardrails

- This intake does not authorize hard-coded semantic labels.
- Hyperedges are the semantic source of truth, not a taxonomy.
- Immutable source evidence is the proof layer; the source-backed hypergraph is
  the semantic truth layer.
- Pairwise edges are allowed for retrieval and UI only when rebuildable.
- Unknown concepts must survive ingestion and remain searchable.
- Every match explanation must link both sides back to original evidence.
