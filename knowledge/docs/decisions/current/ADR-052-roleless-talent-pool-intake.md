# ADR-052: Roleless Talent Pool Intake

**Date:** 2026-06-19
**Status:** Accepted
**Deciders:** Product and engineering
**Depends on:** ADR-043, ADR-051

## Context

People should be able to join a talent pool before there is a specific open role.
The living context graph treats contacts and applicants as the same underlying
person, so intake should not require fabricating a role, application, seniority,
or target job just to store evidence.

## Decision

Talent-pool intake is roleless by default.

- Create or update `Person` and workspace-private `WorkspacePerson` records.
- Create a `TalentPoolMembership` for the workspace relationship when no role is
  selected.
- Ingest resumes, profile text, messages, meetings, assessments, public-source
  artifacts, recruiter notes, and consent state as source-backed artifacts and
  hyperedge/context records on the person graph.
- Do not create an `Application` unless the person is being considered for a
  specific JD-backed role/process.
- Do not synthesize a default role, seniority, skill list, or match target for a
  roleless talent-pool member.
- Candidate-to-PR matching requires either a JD-backed role or an explicit
  exploration request. Without one, PIPE should show accumulated evidence,
  missing evidence, graph coverage, and suggested next evidence to collect.

## Consequences

The candidate graph can grow continuously before role matching starts. When a
real JD later appears, matching compiles role demands from that JD and compares
them against the existing source-backed person hypergraph without re-ingesting
or inventing context.
