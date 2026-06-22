# Living Context Graph and Deterministic Code Matching

**Status:** Active implementation  
**Date:** 2026-06-12  
**Supersedes for this scope:** ADR-050's candidate-to-repo matching direction  
**Preserves:** ADR-050 contextual extraction and the June 10 Devin handoff

## Goal

Build one source-backed semantic system for people and repositories.

## Hypergraph Implementation Directive

All semantic work in this scope targets the source-backed hypergraph.

- Immutable artifacts, versions, and source spans are the evidence/provenance
  layer. They prove what was said, written, committed, merged, or reviewed.
- Source-backed hyperedge/context records are the semantic source of truth. They
  preserve N-participant meaning units across people, roles, repositories, PRs,
  concepts, mechanisms, actions, constraints, and outcomes.
- Existing pairwise edges, `semantic_assertions`, signals, summaries, search
  documents, vectors, Neo4j views, matcher atoms, and UI graph views are
  rebuildable projections from the hypergraph. They are not semantic truth.
- Implementation should add, harden, and query the hypergraph/context-record
  layer first. Projection work is valid only when it is derived from source-
  backed hyperedge records and can link back to exact source evidence.

- A contact and applicant are the same global `Person`.
- Workspace-private accumulated context belongs to `WorkspacePerson`.
- Users may join a talent pool without a role. Roleless talent-pool intake
  creates or updates the same `Person` and `WorkspacePerson` graph; it must not
  fabricate an application, role, seniority, or target job to make matching run.
- A person can have many roles, interactions, and applications.
- Every claim remains traceable to immutable original content.
- Repositories are decomposed into exact source spans, symbols, structural facts,
  episodes, hyperedge/context records, projection signals, and reviewable PR
  challenge packets.
- Matching selects a specific code-review PR challenge. The winning PR determines
  the repository; generic repo summaries and smallest-PR fallbacks are not valid.

Research-backed hypergraph direction:
[Living Context Hyperedge Intake](../research/outputs/living-context-hyperedge-intake.md)
is incorporated into this plan as the semantic architecture direction. The
active implementation target is not a pairwise graph with provenance attached;
it is a source-backed hypergraph where context records are first-class semantic
truth and immutable source evidence is the proof layer beneath them.

## No-Faked-Evidence Invariant

Nothing in the production matching path may be fabricated, inferred as a default,
or silently substituted when source evidence is missing.

- Candidate/person evidence must come from an immutable resume, transcript,
  message, assessment response, meeting artifact, public-source artifact, or
  explicit human-authored note.
- Repository evidence must come from a real repository artifact: commit, file,
  line span, PR, issue, review comment, test, manifest, lockfile, CI config, or
  documentation source.
- Role evidence must come from a simple job description artifact and optional
  explicit human-authored notes with source spans. The current path does not use
  role-discovery orchestration, synthesized RCDs, or stakeholder-interview state
  as the required source of truth.
- Hyperedge/context records, projection assertions, signals, challenge demands,
  aliases, scores, and match explanations must carry source references and
  resolver/policy versions.
- Test fixtures, demos, and synthetic seed data are allowed only when clearly
  labelled as non-production fixtures and cannot be used as match evidence.
- If required evidence is absent, the system must return `NEEDS_MORE_EVIDENCE`,
  `NO_ROLE_SAFE_CHALLENGE`, or a clearly degraded diagnostic state. It must not
  fabricate seniority, confidence, evidence strength, default skills, default
  aliases, generic repositories, generic PRs, or smallest-PR fallbacks.
- Any projection record used for search or UI must be rebuildable from immutable
  source artifacts. If it cannot reconstruct its source chain, it is invalid for
  matching.

## Person Living Context Graph

The canonical semantic path is:

`SourceSpan -> Episode -> SourceBackedHyperedgeContextRecord -> projection records`

Core records:

- `Person`: global searchable identity card.
- `WorkspacePerson`: private workspace relationship and accumulated context.
- `TalentPoolMembership`: roleless workspace membership for people who join a
  pool before any specific job exists. It can accumulate resumes, messages,
  meetings, assessments, public-source artifacts, recruiter notes, and consent
  state without creating an application.
- `Application`: process record linked to a workspace person; legacy candidate IDs
  remain available during migration. An application is created only when a person
  is considered for a specific role/JD-backed process.
- `Interaction`: meeting, resume intake, message, interview, assessment, or review.
- `Artifact` and immutable `ArtifactVersion`: original source content.
- `SourceSpan`: exact content hash, stable segment, offsets, lines, and timestamps.
- `Episode`: a connected section of an interaction.
- `SourceBackedHyperedgeContextRecord`: flexible N-participant semantic record
  with open predicate/relation text, qualifiers, narrative, temporal/workspace
  context, confidence, resolver metadata, and exact source provenance. This is
  the canonical hypergraph record: one source-backed meaning unit can connect
  many entities, concepts, mechanisms, actions, constraints, and outcomes in
  one context.
- `SemanticAssertion`: compatibility name/view for existing code and older docs.
  Subject/predicate/object triples are projections of source-backed hyperedge
  context records, not the canonical shape for meaning.
- `SignalEvidence`: source-backed evidence with protocol-level observation
  grades such as `mentioned`, `used`, `explained`, `selected`, `implemented`,
  `demonstrated`, or `validated`. These grades describe how directly the source
  supports a claim; they are not semantic skills, signal families, or a
  code-owned taxonomy of meaning.
- `SignalSnapshot`: interaction score and accumulated score across interactions.

Identity, tenancy, ownership, participation, artifact versioning, and provenance
may use rigid graph edges. Semantic meaning belongs in flexible hyperedge
context records rather than fixed pairwise edges or a Neo4j relationship
whitelist.
[ADR-043](../docs/decisions/current/ADR-043-no-hard-coded-semantic-taxonomy.md)
is a load-bearing invariant: no application-code list may define semantic
skills, signals, concepts, aliases, node types, or meaning-bearing edges.
Pairwise semantic edges are allowed only as rebuildable traversal/search/UI
projections from source-backed hyperedge context records.

Legacy `candidate_nodes` remain a compatibility projection. New writes use
deterministic ingestion keys and mirror into the living graph. Meetings are a
first-class interaction producer, and transcripts become immutable artifacts
for every participant.

Talent-pool intake is valid without a role. It may ingest a resume, profile,
GitHub/public artifacts, messages, interviews, and assessments into the person
graph. Candidate-to-PR matching waits until there is a JD-backed role or an
explicit exploration request; until then PIPE should report accumulated evidence,
coverage, and useful next-evidence prompts rather than invent a target role.

## Repository Semantic Graph

Repository understanding is tied to an immutable `RepoSnapshot` and exact commit
SHA.

The current implementation wedge is intentionally concrete: prove the full loop
on one real GitHub PR before expanding crawler breadth. The first demo must take
one reviewable PR from source capture to `ChallengePacket` to candidate match
explanation with links back to both candidate evidence and exact code spans.

Repo ingestion flow:

1. Capture immutable GitHub evidence first: repository identity, commit SHAs,
   PR metadata, issue metadata, review comments, patch hunks, file contents,
   manifests, lockfiles, CI config, tests, and docs.
2. Persist content-addressed `SourceArtifactVersion` and `SourceSpan` records
   before semantic extraction. These records are the evidentiary proof layer.
3. Build deterministic structural facts: language/parser support, file tree,
   symbols, imports, calls, routes, changed symbols, test links, config links,
   and PR diff spans. Parser support is infrastructure capability metadata, not
   a skill taxonomy.
4. Form `CodeEpisode` records for source-backed behavior or change: PR change
   sets, issue-to-fix flows, test-to-implementation relationships, API route
   behavior, data-flow slices, and failure/fix narratives.
5. Extract source-backed hyperedge/context records with open predicates, open
   concept keys, resolver metadata, confidence, and exact source provenance.
   This hypergraph layer is the semantic source of truth. Do not canonicalize
   repository meaning into fixed semantic node types such as `Feature`,
   `TechnicalStack`, `QualitySignal`, `DomainContext`, or `ChallengeSurface`.
   Those names may exist only as rebuildable projection/UI labels.
6. Generate deterministic PR `ChallengePacket`s from real reviewable PRs. A
   packet must include changed spans, symbols, demand context records, concepts,
   mechanisms, problems, tests, issue context, review operations, quality gates,
   hidden ground truth, resolver version, and provenance validation.
7. Build search/vector/graph projections from the source-backed hyperedge
   records and packets. Projection buckets can help recall/ranking, but they are
   never the authoritative semantic record.
8. Backfill append-only and idempotently. Given the same commit SHA, resolver
   versions, and policy versions, rebuilds must produce the same semantic
   records and must not overwrite immutable source artifacts.

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
- `SourceBackedHyperedgeContextRecord`: source-backed repository meaning using
  open concept data. Repo records follow the same N-participant context model as
  person records so changed spans, symbols, mechanisms, tests, failures,
  ownership, and business objects can stay connected to the source event that
  created them.
- `Facet`, `SemanticAssertion`, and `RepoSignal`: compatibility/projection
  records derived from the source-backed hypergraph.

Each eligible PR produces a deterministic `ChallengePacket` containing changed
spans, symbols, demands, concepts, mechanisms, problems, tests, issue context,
review operations, quality gates, and hidden ground truth.

Production challenge packets initially support TypeScript/JavaScript, Python,
and Go. Other languages remain structural-search-only until validated. Repository
code is never executed during decomposition.

## Deterministic Candidate-to-PR Matching

Matching compiles at most 12 source-backed candidate query atoms:

- At most three atoms per persisted concept family/projection bucket.
- At most two atoms per source episode.
- Mentions participate in recall but never establish competence.
- Validation atoms represent demonstrated capability.
- Deepening atoms represent one useful adjacent capability to test.

Candidate atoms and PR demands align only when they share source-backed
concepts, problems, mechanisms, contextual roles, or persisted concept-registry
relationships. Embedding similarity alone is insufficient, and code-owned alias
maps or hard-coded semantic edges are not valid evidence.

The matcher uses deterministic maximum-weight, non-duplicative alignment so one
candidate hyperedge/context record cannot satisfy every demand. Repeated
evidence from one episode receives diminishing weight: 100%, 35%, then 0%.

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
resolver versions, projection versions, recalled and excluded challenges,
alignments, scores, stretch path, explanation, and final ordering. Missing
evidence returns `NEEDS_MORE_EVIDENCE`; no eligible challenge returns
`NO_ROLE_SAFE_CHALLENGE`. Neither status may fall back to a generic repository
or smallest PR.

## Persistence and Rollout

- D1 stores both the immutable evidence proof layer and the source-backed
  hypergraph/context-record layer. The hypergraph is the semantic source of
  truth. Neo4j, vector indexes, search documents, and pairwise graph views are
  rebuildable projections.
- Projection work uses a retryable outbox rather than `pending_graph_backfill`.
- Existing candidate/contact APIs continue through compatibility adapters.
- Existing `SIMILAR_TO` edges are retrieval hints only and are never migrated as
  semantic truth.
- Backfills are append-only and idempotent.
- Shadow the new matcher against the legacy path, then canary at 10%, 50%, and
  100% behind a versioned policy pointer.

Acceptance:

- exact source reconstruction from every hyperedge/context record and match
  explanation
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
- add the tree projection UI over the semantic hypergraph
