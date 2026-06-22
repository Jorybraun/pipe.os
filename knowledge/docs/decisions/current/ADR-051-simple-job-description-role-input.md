# ADR-051: Simple Job Description Role Input

**Date:** 2026-06-19
**Status:** Accepted
**Deciders:** Product and engineering
**Supersedes for current matching scope:** ADR-027, ADR-028, ADR-036, ADR-038, ADR-041b, ADR-041c, ADR-041e, ADR-041f role-discovery orchestration paths
**Depends on:** ADR-043

## Context

PIPE's current goal is deterministic candidate-to-PR matching from source-backed
evidence. The role side should not require a separate role-discovery product,
stakeholder interview workflow, synthesized RCD, or agent-managed discovery
session before matching can run.

For the current implementation path, a role is a plain job description artifact
plus optional explicit human-authored notes. The job description is immutable
source content with spans, just like resumes, transcripts, and repository files.

## Decision

The current matching path uses a simple job description as the role source of
truth.

- Persist the original job description as an immutable artifact version.
- Extract role requirements, constraints, responsibilities, and context as
  source-backed hyperedge/context records linked to exact JD spans.
- Optional human-authored notes are allowed only when persisted as source
  artifacts with author, timestamp, and exact spans or note body provenance.
- Role constraints and guardrails compile from persisted JD/note hyperedge
  records and concept-registry relationships.
- Missing role evidence returns a degraded diagnostic state; it must not be
  filled by synthesized RCD defaults, persona defaults, fabricated seniority,
  inferred non-negotiables, or fallback skill lists.

Role-discovery agents, multi-stakeholder interviews, and RCD synthesis may be
reintroduced later as optional evidence producers. They are not required for the
current product path and are not the authoritative source for matching unless
their outputs are persisted as immutable source artifacts and source-backed
hyperedge/context records with provenance.

## Consequences

The first end-to-end demo can start from a normal JD, a candidate/person graph,
and real repository PR evidence. This removes orchestration overhead and keeps
the system honest: the matcher can explain role demand directly from the text the
recruiter supplied.

Existing role-discovery documents remain historical or future-design material.
New current work should start from `knowledge/plan/living-context-repo-matching-plan.md`
and this ADR, not from RCD-first plans.
