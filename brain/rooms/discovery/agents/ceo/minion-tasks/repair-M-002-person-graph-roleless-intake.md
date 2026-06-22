# Repair M-002: Remove Fake Roleless Application

**Status:** Dispatch now  
**Source review:** review-M-002  

## Objective

Fix roleless intake so it satisfies ADR-052:

- Do not create `applications` rows for roleless talent-pool intake.
- Do not create default `person_roles` rows such as `Candidate`.
- Preserve normalized-email person/workspace convergence.
- Preserve/merge `workspace_people.context_json`.
- Add/adjust tests so roleless intake proves no application or role rows are
  created.
- Add test coverage for optional message artifact/version/source_span evidence.

## Ownership

- `workers/api/src/routes/cockpit/candidates.ts`
- `workers/api/src/routes/cockpit/__tests__/candidates.rest.test.ts`

## Non-Goals

- Do not add a full `TalentPoolMembership` migration in this repair.
- Do not edit living-context persistence or matcher files.
- Do not weaken ADR-052 by redefining a null-role application as acceptable.

## Acceptance

- Candidate route tests pass from `workers/api`.
- Worker type-check passes if feasible.
- Tests assert no roleless `applications`/`person_roles` rows.
- Tests assert message source artifact/span persists exact original text.
