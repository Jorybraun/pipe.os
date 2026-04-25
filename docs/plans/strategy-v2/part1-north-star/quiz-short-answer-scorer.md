# QUIZ_SHORT_ANSWER Scorer

**Source:** knowledge/plan/pipe-strategy-v2-part1-north-star.md (lines 110–111)
**Phase:** 4
**Status:** NEEDS-REFINEMENT
**Estimate:** See Part 4

## Source quote

> LLM scoring for QUIZ_SHORT_ANSWER submissions (score is always null).

## Why

Short-answer quiz submissions currently have no automated scoring — score is always null. Unlike `CODE_IMPLEMENTATION`, Part 1 does not specify a scoring framework for this type; the design is deferred to Part 4.

## Subtasks (delegable)

Spec deferred to Part 4. See `docs/plans/strategy-v2/part4-candidate-ingestion/` for the QUIZ_SHORT_ANSWER scorer design.

## Dependencies

- Depends on: Phase 0 complete
- Blocks: Part 4 candidate ingestion pipeline

## Acceptance criteria

- [ ] Subtasks defined from Part 4 specification
- [ ] `QUIZ_SHORT_ANSWER` submissions scored by LLM
- [ ] Score no longer always null
