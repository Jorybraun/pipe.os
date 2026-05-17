# Issue Gemma Narratives (Phase 2+ Extension)

**Source:** knowledge/plan/pipe-strategy-v2-part3-repo-ingestion.md (lines 284–285)
**Phase:** 2+
**Status:** NEEDS-REFINEMENT
**Estimate:** TBD

## Source quote
> For the implementation challenge to have the richest possible context, issues should get Gemma-generated narratives too — "what does this issue actually ask the candidate to do, what skills would it exercise, what's the expected complexity band." This is a Phase 2+ extension of the existing issue crawler, not a Phase 0 priority.

## Why
`issue_challenge_signals` currently produces only `difficulty_band`, `implementability_score`, `clarity_score`, and `disqualified` flags from a lightweight classifier. A Gemma-generated narrative per issue would enable semantic issue selection (choosing the issue whose context best matches the candidate's background) and would provide richer context for the implementation scorer.

## Why NEEDS-REFINEMENT
The strategy explicitly defers this to Phase 2+ and calls it "not a Phase 0 priority." No implementation path, prompt design, or storage shape is described beyond the one-sentence description. This plan cannot be delegated until:

1. The implementation scorer (`code-implementation-scorer-sherlock.md`) is shipped and its issue-context consumption pattern is known
2. Phase 2 `repo_nodes` `IssueCandidate` sub-elements are defined — this plan may extend those nodes rather than `repo_issues` directly
3. Cost envelope for adding a Gemma call per issue (potentially thousands of issues) is evaluated against the existing `ai_usage_events` baseline

## Known prerequisites
- `code-implementation-scorer-sherlock.md` Phase 1 DONE
- `repo-decomposition-schema.md` Phase 2 DONE (for `IssueCandidate` node shape)

## Subtasks (delegable)
_To be defined after prerequisites land._

## Dependencies
- Depends on: `repo-decomposition-schema.md`
- Depends on: `code-implementation-scorer-sherlock.md`

## Acceptance criteria
_To be defined after refinement._
