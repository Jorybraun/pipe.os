# Verification Report: Human Judgment in AI-Augmented Engineering: Assessment Framework

**Draft:** `knowledge/rnd/outputs/.drafts/human-judgment-ai-assessment-draft.md`
**Verification date:** 2026-04-10
**Overall status:** PASS WITH NOTES

## Summary

The draft is well-grounded in the research files with proper citations for most claims. The reviewer found one FATAL structural contradiction between the proposed 60-minute single-bug session and the research's explicit requirement for multi-sample assessment. Two MAJOR issues involved ambiguous statistical presentation and terminology precision. Evidence integrity was otherwise strong.

All FATAL and MAJOR issues were fixed before delivery to `knowledge/rnd/papers/human-judgment-ai-assessment.md`.

## FATAL issues (fixed)

### F1. Single-sample session contradicts research-mandated multi-sample structure

- **Location:** Section 7 "The Candidate Session" and Executive Summary
- **Problem:** Executive Summary stated "you need 6-8 independent samples across varied contexts" but Section 7 described one planted bug, one variant problem, and one code review round — totaling 3 samples at most. The research files explicitly state "Multi-PR structure is non-negotiable" and "single-sample assessments have insufficient reliability for high-stakes decisions."
- **Fix applied:** Section 7 restructured to clearly separate two product concepts (code review challenge vs. dev container assessment) and enforce multi-station design in both. Exec summary rewritten to reference 7-15 independent samples range from MMI/OSCE source domains, with Pipe's 6-8 target framed as a design adaptation, not a research finding.

## MAJOR issues (fixed)

### M1. Ambiguous percentage presentation

- **Quote:** "experienced radiologists' accuracy drops 44% with incorrect AI suggestions"
- **Problem:** Relative percentage decrease (82% → 45.5% = 44% relative drop) could be misread as an absolute 44 percentage point drop (actual absolute drop is 36.5 points).
- **Fix applied:** Rewritten as "experienced radiologists' accuracy fell from 82% to 45.5%" — matches source language and eliminates ambiguity.

### M2. SWE-bench methodology characterization

- **Quote:** "SWE-bench methodology: plant a known bug with a test suite that fails without the fix and passes with it"
- **Problem:** SWE-bench uses real GitHub issues and PRs, not planted bugs. The draft was proposing a SWE-bench-inspired adaptation but calling it "SWE-bench methodology" implied direct citation of SWE-bench's process.
- **Fix applied:** Rewritten as "Adapting SWE-bench's test-based evaluation principle: revert a known fix to plant a bug, candidate must restore functionality with tests as ground truth." Clear attribution as adaptation, not direct citation.

### M3. "6-8 independent samples" presented as research finding

- **Problem:** Research files state OSCEs use 10-15 stations, MMI uses 7-12 stations, reliability requires 14+ questions. The "6-8" number was the research author's proposed application to Pipe, not an empirical finding.
- **Fix applied:** Exec summary now cites the source range (7-15 across MMI and OSCE) and explicitly frames 6-8 as "adapted from MMI's 7-12 station model" — making it a design decision grounded in but not directly cited from research.

## MINOR issues (accepted)

- LangSmith overhead claim cites industry comparison source (AImultiple, 2026), not peer-reviewed study. Supported but source strength weaker than implied. Accepted.
- Second-person pronoun inconsistency ("your repo catalog") in otherwise third-person analytical tone. Stylistic, not evidence issue. Accepted.
- Section 2 "Design principle for Pipe" statements are recommendations not research findings — clearly labeled as such, but readers scanning might conflate them with empirical evidence. Accepted.

## Spot-check log

Verified the following citations against source files:

| Claim | Draft location | Source confirmed |
|---|---|---|
| Automation bias 6-11% and 26% RR | Line 14 | cognitive research line 13 [S1] |
| 92.8% → 23.6% physician accuracy | Line 16 | cognitive research line 21 [S6] |
| 82% → 45.5% radiologist accuracy | Line 16 | cognitive research line 21 [S7] |
| 17% lower quiz scores | Line 82 | telemetry research line 34 [S8] |
| 41% higher churn rate | Line 81 | telemetry research line 26 [S4] |
| Null results for cognitive forcing RCTs | Line 26 | cognitive research line 89 [S17] |
| OSCEs 10-15 stations | Line 42 | assessment research line 13 [S2] |
| 14+ independent questions | Line 44 | assessment research line 82 [S12] |
| 27-30% Copilot acceptance rates | Line 79 | telemetry research line 14 [S1, S2, S3] |
| 25-35% healthy acceptance range | Line 79 | telemetry research line 16 [S6] |
| 3-5× longer debugging for multi-agent | Line 135 | agentic research line 34 [S9] |
| 40% sprint time on agent failures | Line 135 | agentic research line 34 [S9] |
| LangSmith/AgentOps/Langfuse overhead | Line 125 | agentic research line 102, 445 [S53] |

## Overall assessment

Strong evidence discipline with proper citations for statistical claims and research findings. The single FATAL issue was the structural contradiction between advocating multi-sample assessment (well-supported) while proposing a single-sample session design. Resolved by restructuring Section 7. Two MAJOR issues around presentational precision also resolved. Delivered version is ready for use as an implementation guide.

**Totals:**
- FATAL: 1 (fixed)
- MAJOR: 3 (fixed)
- MINOR: 3 (accepted)
