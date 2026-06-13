# Living Context Graph and Deterministic Code Matching

**Status:** Active implementation  
**Date:** 2026-06-12  
**Supersedes for this scope:** ADR-050's candidate-to-repo matching direction  
**Preserves:** ADR-050 contextual extraction and the June 10 Devin handoff

## Goal

Build one source-backed semantic system for people and repositories.

- A contact and applicant are the same global `Person`.
- Workspace-private accumulated context belongs to `WorkspacePerson`.
- A person can have many roles, interactions, and applications.
- Every claim remains traceable to immutable original content.
- Repositories are decomposed into exact source spans, symbols, structural facts,
  episodes, assertions, signals, and reviewable PR challenge packets.
- Matching selects a specific code-review PR challenge. The winning PR determines
  the repository; generic repo summaries and smallest-PR fallbacks are not valid.

## Person Living Context Graph

The canonical semantic path is:

`SourceSpan -> Episode -> SemanticAssertion -> SignalEvidence -> SignalSnapshot`

Core records:

- `Person`: global searchable identity card.
- `WorkspacePerson`: private workspace relationship and accumulated context.
- `Application`: process record linked to a workspace person; legacy candidate IDs
  remain available during migration.
- `Interaction`: meeting, resume intake, message, interview, assessment, or review.
- `Artifact` and immutable `ArtifactVersion`: original source content.
- `SourceSpan`: exact content hash, stable segment, offsets, lines, and timestamps.
- `Episode`: a connected section of an interaction.
- `SemanticAssertion`: flexible subject, predicate, object, qualifiers, narrative,
  confidence, and provenance.
- `SignalEvidence`: source-backed evidence graded as `mentioned`, `used`,
  `explained`, `selected`, `implemented`, `demonstrated`, or `validated`.
- `SignalSnapshot`: interaction score and accumulated score across interactions.

Identity, tenancy, ownership, participation, and provenance may use rigid graph
edges. Semantic meaning remains flexible assertion data rather than a fixed
Neo4j relationship whitelist. [ADR-043](../docs/decisions/current/ADR-043-no-hard-coded-semantic-taxonomy.md)
is a load-bearing invariant: no application-code list may define semantic
skills, signals, concepts, aliases, or meaning-bearing edges.

Legacy `candidate_nodes` remain a compatibility projection. New writes use
deterministic ingestion keys and mirror into the living graph. Meetings are a
first-class interaction producer, and transcripts become immutable artifacts
for every participant.

## Repository Semantic Graph

Repository understanding is tied to an immutable `RepoSnapshot` and exact commit
SHA.

Source records:

- `SourceArtifact`: source, test, manifest, documentation, CI, issue, PR, patch,
  or commit metadata.
- `SourceArtifactVersion`: content-addressed immutable content.
- `SourceSpan`: exact path, blob/content hash, byte/line range, PR side, base SHA,
  head SHA, and source text.
- `Symbol`: language-aware qualified symbol and defining span.
- `StructuralFact`: import, call, read, write, route, test, inheritance, or changed
  symbol relationship.
- `CodeEpisode`: connected behavior or change across symbols and spans.
- `SemanticAssertion`, `Facet`, and `RepoSignal`: source-backed repository meaning
  using the shared concept vocabulary.

Each eligible PR produces a deterministic `ChallengePacket` containing changed
spans, symbols, demands, concepts, mechanisms, problems, tests, issue context,
review operations, quality gates, and hidden ground truth.

Production challenge packets initially support TypeScript/JavaScript, Python,
and Go. Other languages remain structural-search-only until validated. Repository
code is never executed during decomposition.

## Deterministic Candidate-to-PR Matching

Matching compiles at most 12 source-backed candidate query atoms:

- At most three atoms per concept family.
- At most two atoms per source episode.
- Mentions participate in recall but never establish competence.
- Validation atoms represent demonstrated capability.
- Deepening atoms represent one useful adjacent capability to test.

Candidate atoms and PR demands align only when they share a concept, problem,
mechanism, or an approved one-hop concept relationship. Embedding similarity
alone is insufficient.

The matcher uses deterministic maximum-weight, non-duplicative alignment so one
candidate assertion cannot satisfy every demand. Repeated evidence from one
episode receives diminishing weight: 100%, 35%, then 0%.

Pair score:

- 30% semantic narrative similarity
- 25% concept correspondence
- 20% problem/mechanism correspondence
- 15% domain/business-object context
- 10% ownership/action correspondence

Final score:

- 40% candidate evidence alignment
- 20% role relevance
- 15% contextual specificity
- 15% deterministic challenge quality
- 10% validation/deepening value

Eligibility requires:

- candidate alignment at least `0.60`
- role relevance at least `0.60`
- challenge quality at least `0.70`
- at least two demand families
- at least one non-generic alignment
- at least one high-weight role requirement
- complete source provenance

At most one adjacent stretch is allowed, one concept-registry hop away, covering
no more than 20% of challenge demand weight. Language, security, seniority, and
other non-negotiable role constraints cannot be stretches.

Every run persists its candidate and role snapshots, policy/model versions,
recalled and excluded challenges, alignments, scores, stretch path, explanation,
and final ordering. Missing evidence returns `NEEDS_MORE_EVIDENCE`; no eligible
challenge returns `NO_ROLE_SAFE_CHALLENGE`. Neither status may fall back to a
generic repository or smallest PR.

## Persistence and Rollout

- D1 is authoritative. Neo4j and vector indexes are rebuildable projections.
- Projection work uses a retryable outbox rather than `pending_graph_backfill`.
- Existing candidate/contact APIs continue through compatibility adapters.
- Existing `SIMILAR_TO` edges are retrieval hints only and are never migrated as
  semantic truth.
- Backfills are append-only and idempotent.
- Shadow the new matcher against the legacy path, then canary at 10%, 50%, and
  100% behind a versioned policy pointer.

Acceptance:

- exact source reconstruction from every assertion and match explanation
- replay creates no duplicate semantic records
- Neo4j can be rebuilt entirely from D1 and immutable artifacts
- Recall@50 at least `0.95`
- Precision@3 at least `0.80`
- nDCG@5 at least `0.80`
- zero role-guardrail or multi-stretch violations
- byte-identical deterministic reruns

## Current Implementation

Implemented foundations:

- living context D1 schema and persistence API
- immutable person artifacts and exact source spans
- candidate/contact compatibility adapters
- meeting transcript ingestion into participant graphs
- retryable Neo4j projection outbox
- repository semantic graph types and deterministic builders
- PR challenge packet extraction, provenance validation, and quality gates
- deterministic candidate-to-PR matching engine
- persisted `match_runs`
- standalone code review routed through the PR matcher

Remaining production work:

- build the repository crawler adapters that populate source artifacts, symbols,
  facts, episodes, and challenge packets from real GitHub PR content
- backfill existing candidates, contacts, transcripts, and repository PRs
- add role-specific guardrail compilation to the pipeline matching path
- run the frozen expert-labelled evaluation corpus and staged rollout
- add the tree projection UI over the semantic DAG
