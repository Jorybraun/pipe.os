# QUIZ_SHORT_ANSWER Scorer

**Source:** knowledge/plan/pipe-strategy-v2-part1-north-star.md (lines 110–111)
**Status:** DEFERRED

> LLM scoring for QUIZ_SHORT_ANSWER submissions (score is always null).

The strategy mentions QUIZ_SHORT_ANSWER scoring once and assigns no design. The other automated assessment scorers (`CODE_REVIEW`, `CODE_IMPLEMENTATION` via Sherlock, culture interview) live under [`../part4-candidate-ingestion/`](../part4-candidate-ingestion/) — but no `quiz-short-answer-scorer.md` exists there because Part 4 doesn't specify the scoring framework for this type.

**No canonical plan file yet.** Defer until product decides whether QUIZ_SHORT_ANSWER stays in the assessment catalog. If retained, create the canonical plan in `part4-candidate-ingestion/` alongside `implementation-scorer.md` and `code-review-graph-decomposition.md`. The candidate-graph mapping would target `TechnicalDemonstration` sub-elements, mirroring the code-review pattern.
