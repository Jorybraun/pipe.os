# Per-Candidate PR Override UI (Recruiter)

**Source:** knowledge/plan/pipe-strategy-v2-part3-repo-ingestion.md (lines 201–204)
**Phase:** 2
**Status:** NEEDS-REFINEMENT
**Estimate:** TBD

## Source quote
> The existing `candidate_challenge_assignment.github_pr_number` column already supports per-candidate PR overrides. Use it more. `autoStageBuilder` picks a default PR for the role's code review stage, but per-candidate tuning should be an option when a candidate's specific background suggests a better PR match than the role-level default. This is recruiter-facing functionality — a "reassign PR" button on the candidate detail page.

## Why
The override column exists but there is no recruiter UI to exercise it. Per-candidate PR tuning is the "manual semantic selection" fallback that a recruiter uses when automated assignment misses a nuance.

## Why NEEDS-REFINEMENT
The strategy provides one sentence of specification ("a 'reassign PR' button on the candidate detail page") with no detail on:
- Which cockpit page hosts the button and how PR options are displayed
- Whether the recruiter sees PR narratives (requiring `pr-narrative-enrichment.md` to land first) or only PR metadata
- How the PATCH flows from cockpit frontend through the API to `candidate_challenge_assignment`
- Whether the override triggers re-scoring or only affects future challenge delivery

This plan cannot be delegated until those questions are answered. Refinement requires reviewing the candidate detail page layout in the cockpit frontend and the existing `candidate_challenge_assignment` write path.

## Known prerequisites
- `pr-narrative-enrichment.md` should land first to give recruiters meaningful PR descriptions to choose from
- The `candidate_challenge_assignment.github_pr_number` column must be verified to flow through to `DevContainerDO` challenge setup correctly

## Subtasks (delegable)
_To be defined after refinement._

## Dependencies
- Depends on: `pr-narrative-enrichment.md`
- Depends on: Cockpit candidate detail page audit (not in scope here)

## Acceptance criteria
_To be defined after refinement._
