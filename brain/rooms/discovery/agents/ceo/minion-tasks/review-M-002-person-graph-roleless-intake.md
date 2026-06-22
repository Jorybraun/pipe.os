# Review M-002: Person Graph and Roleless Intake

**Status:** Queued for review
**Primary brief:** M-002
**Review owner:** Minion auditor

## Objective

Review the returned M-002 patch for correctness against ADR-052 and ADR-043.

## Inspect

- `workers/api/src/routes/cockpit/candidates.ts`
- `workers/api/src/routes/cockpit/__tests__/candidates.rest.test.ts`

## Review Questions

- Does roleless intake avoid creating fake applications, roles, seniority, or
  match targets?
- Does same normalized email converge to one person/workspace identity?
- Does existing `workspace_people.context_json` merge rather than overwrite?
- Is the source-backed message artifact/span path real and test-covered?
- Are schema blockers documented honestly without hiding missing
  `TalentPoolMembership`?
- Does any code introduce hard-coded semantic skills/signals/edges?

## Output

Findings first, with file/line references. If no issues, say so and list
remaining test/evidence gaps.
