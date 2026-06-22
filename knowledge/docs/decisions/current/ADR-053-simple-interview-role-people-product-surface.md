# ADR-053: Simple Interview, Role, and People Product Surface

**Date:** 2026-06-19
**Status:** Accepted
**Deciders:** Product and engineering
**Depends on:** ADR-043, ADR-051, ADR-052

## Context

PIPE needs to become demoable and usable while the living context graph and
deterministic candidate-to-PR matching system mature. The previous product
surface exposed too many internal process objects: pipelines, stages, clients,
contacts, candidates, role discovery, repo administration, and agent tooling all
competed as primary concepts.

The current product path is intentionally smaller:

- A user can create a role from a simple job description.
- A user can invite a person to interview.
- A person can interview with or without a role.
- Every interaction grows the same source-backed living person graph.
- Clients, contacts, applicants, candidates, and guests are all people in the
  primary product language.

This ADR is a UI/product boundary. It does not delete existing backend tables or
legacy compatibility routes unless a later migration explicitly does that.

## Decision

The primary PIPE product surface is:

- **Interviews**: the default home. Shows scheduled or created interviews and
  starts a new interview invite.
- **Roles**: JD-backed hiring processes. A role may have interview rounds.
- **People**: the unified surface for contacts, clients, applicants, candidates,
  meeting guests, and talent-pool members.

Visible product language uses:

- `Role` instead of `Pipeline`.
- `Round` instead of `Stage`.
- `Person` or `People` instead of separate primary concepts for contact,
  client, applicant, candidate, or guest.
- `Interview` for a scheduled or inviteable interaction.

Backend and compatibility code may continue to use `pipeline`, `stage`,
`candidate`, or `contact` identifiers while migrations are in progress. Those
terms must not be presented as the main user mental model unless the view is an
explicit admin/debug compatibility surface.

The canonical user routes are:

- `/interviews`
- `/roles`
- `/roles/:roleId`
- `/roles/:roleId/round/:roundId`
- `/people`
- `/people/:personId`

Legacy routes such as `/pipeline/*`, `/stage/*`, `/contacts`, `/clients`, and
`/candidates/*` may remain as redirects or compatibility aliases during
migration.

Roleless interviews are valid. Creating an interview without a role must not
fabricate a role, round, seniority, application, or matching target. If the
person is not attached to a role, the interaction contributes to the person
graph and talent-pool context only.

## Required Enforcement

- Primary navigation exposes Interviews, Roles, People, and Settings only.
  Admin/debug surfaces must be secondary, feature-flagged, or explicitly scoped.
- New role creation starts from a simple JD artifact per ADR-051.
- Interview creation supports both roleless and role-attached interviews.
- People views preserve stored source/type information without forcing the user
  into separate Clients, Contacts, Applicants, or Candidates products.
- Any route or UI copy cleanup must preserve existing data and compatibility
  behavior unless a specific migration ADR says otherwise.
- Tests and smoke checks must cover `/interviews`, `/interviews?new=1`,
  `/roles`, `/roles/new`, and `/people`.

## Rejected Patterns

- Treating pipeline/stage as the primary product vocabulary.
- Creating a fake pipeline or fake stage to store a roleless interview.
- Splitting clients and candidates into separate primary apps before the living
  person graph is coherent.
- Hiding broken scheduling behind a simplified UI.
- Deleting existing compatibility code as a shortcut to a cleaner demo.

## Consequences

The MVP becomes easier to understand and demo: create roles, invite people,
interview them, and let the graph grow. The backend can still evolve carefully
behind compatibility aliases while the UI stops teaching users the wrong mental
model.
