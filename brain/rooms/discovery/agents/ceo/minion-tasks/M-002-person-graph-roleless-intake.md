# M-002: Person Graph and Roleless Intake

**Status:** Queued  
**Primary ADR:** ADR-052  
**Supporting ADRs:** ADR-043, ADR-051, ADR-053, ADR-054

## Objective

Ensure contacts, clients, applicants, candidates, meeting guests, and roleless
talent-pool members converge on one living person graph without fabricated role
context.

## Ownership

- `workers/api/src/lib/livingContext/*`
- `workers/api/src/routes/cockpit/candidates.ts`
- contact/person intake routes and tests under `workers/api/src/routes/cockpit`
- migrations needed for person/workspace-person/talent-pool compatibility
- focused tests under `workers/api/src/lib/livingContext/__tests__`

## Non-Goals

- Do not introduce semantic taxonomy lists.
- Do not alter repo ingestion or matcher scoring.
- Do not create an `Application` unless there is a specific JD-backed role.
- Do not overwrite existing workspace person context.

## Acceptance Checks

- Same normalized email maps contact plus roleless candidate/applicant intake to
  one person identity.
- Roleless intake creates or updates workspace person/talent-pool context, not a
  fake application.
- Existing `workspace_people.context_json` is merged, not overwritten.
- Resume, note, meeting, message, and assessment artifacts can attach exact
  source provenance to the person graph.
- Missing role context returns an honest roleless/talent-pool state, not a
  fabricated match target.
- Focused living-context compatibility tests pass.

## Output Required

- Changed paths.
- Schema/migration notes.
- Test evidence.
- Any data migration risks.
