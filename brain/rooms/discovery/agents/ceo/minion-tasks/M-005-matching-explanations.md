# M-005: Deterministic Matching and Explanations

**Status:** Queued  
**Primary ADR:** ADR-043  
**Supporting ADRs:** ADR-051, ADR-052

## Objective

Match people to specific reviewable PR challenges using only source-backed
person, role, and repository evidence. Persist an explanation that links every
alignment and gap back to original evidence.

## Ownership

- `workers/api/src/lib/challengeMatching/*`
- `workers/api/src/lib/match/*`
- matcher route/tests that call these modules
- evaluation module under `workers/api/src/lib/challengeMatching/evaluation/*`

## Non-Goals

- Do not add hard-coded skill/package aliases.
- Do not fabricate seniority, confidence, evidence level, evidence strength, or
  role constraints.
- Do not use embedding similarity as a standalone match decision.
- Do not fall back to generic repos or smallest PRs.

## Acceptance Checks

- Matcher compiles candidate atoms from source-backed person context records.
- Role constraints compile from simple JD context records.
- Repo demands compile from validated PR challenge packets.
- Outcomes include `MATCHED`, `NEEDS_MORE_EVIDENCE`,
  `NO_ROLE_SAFE_CHALLENGE`, and `PENDING_INTAKE` where appropriate.
- Match explanation includes selected PR, aligned candidate spans, aligned repo
  spans, rejected packets with reasons, missing evidence, and stretch areas.
- Tests cover unseen concepts, null evidence exclusion, missing source refs, and
  deterministic repeated runs.

## Output Required

- Changed paths.
- Test evidence.
- Example match explanation JSON or fixture.
- Any remaining assumptions explicitly documented.
