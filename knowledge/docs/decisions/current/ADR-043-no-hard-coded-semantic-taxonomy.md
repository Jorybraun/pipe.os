# ADR-043: No Hard-Coded Semantic Taxonomy

**Date:** 2026-06-12
**Status:** Accepted
**Deciders:** Product and engineering

---

## Context

PIPE builds living context graphs from resumes, conversations, meetings, role
discovery, repositories, and assessments. A single sentence can express several
technologies, mechanisms, constraints, business objects, and outcomes. Those
meanings evolve as more source material arrives.

Encoding known skills, signals, concepts, or semantic relationship types as
application-code lists makes the graph brittle. Unknown concepts disappear,
new terminology requires a deployment, aliases become scattered translation
tables, and matching silently reflects the vocabulary known by the developer
who wrote the list rather than the source evidence.

## Decision

PIPE must not hard-code semantic skills, signals, concepts, labels, aliases, or
meaning-bearing edge types in application code.

Semantic meaning is data:

- Extracted meaning must retain an exact reference to immutable source content.
- Concepts and aliases belong in the persisted concept registry with versions,
  provenance, confidence, and resolver metadata.
- Signals are accumulated from source-backed assertions and evidence; they are
  not selected from a code-owned whitelist.
- Semantic relationships use open predicates or reified assertions. New
  predicates do not require a schema or code release.
- Role constraints must reference persisted role assertions/concepts, not
  translate free text through a code-owned skill map.
- Candidate-to-repository matching must compare the same shared semantic
  representation on both sides.
- Unknown or unresolved meaning remains searchable source-backed evidence. It
  must not be discarded merely because the current registry cannot label it.

Rigid relationships are allowed only for non-semantic system structure:
identity, workspace ownership, tenancy, participation, artifact versioning,
source provenance, lifecycle state, and projection bookkeeping. Enumerations
that enforce protocol or storage integrity are not semantic taxonomies.

## Rejected Patterns

- `if skill === "kafka"` or maps from skill strings to concept keys.
- Fixed arrays of supported skills, candidate signals, role signals, domains,
  business objects, or semantic predicates.
- Neo4j relationship whitelists representing meaning such as `KNOWS`,
  `EXPERT_IN`, or `MATCHES_TECHNOLOGY`.
- Dropping unrecognized concepts during extraction or query compilation.
- Treating embedding similarity as semantic truth without source-backed
  assertions and provenance.

## Required Enforcement

- Semantic extractors emit open, normalized keys plus the original source span.
- Concept resolution is versioned and replayable; resolver changes can rebuild
  projections from immutable artifacts.
- Match runs persist the candidate snapshot, role snapshot, concept resolver
  version, policy version, and evidence references used.
- Tests include previously unseen concepts and predicates and prove they survive
  ingestion, retrieval, and replay without code changes.
- Code review must reject new semantic alias maps or meaning-bearing enums unless
  they are explicitly protocol/storage classifications covered by this ADR.

## Consequences

The system can learn new terminology without deployments and can explain every
match from original evidence. Resolver and registry quality become explicit
runtime concerns, and unresolved concepts must be handled rather than hidden.

