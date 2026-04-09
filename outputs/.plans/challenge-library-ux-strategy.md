# Research Plan: Challenge Library UX Strategy

## Core question

How should Pipe design its challenge library, pipeline creation flow, and multi-language challenge curation system — using a mix of predefined content and AI generation — to deliver a seamless recruiter experience from role creation through stage configuration?

**Context:** The existing `challengeLibrary.ts` (2,500 lines of hardcoded templates) and `pipelineTemplates.ts` (4 basic presets) are being replaced. The challenge type system (CODE_REVIEW, CODE_IMPLEMENTATION, QUIZ_MCQ, QUIZ_SHORT_ANSWER, FOLLOW_UP, AGENT_INTERVIEW) and the frontend components (editors, panels, layouts, shells) remain. We need a new content strategy and UX layer on top.

## Sub-questions

### A. Challenge Content at Scale
1. **A1:** What are the best sources/strategies for building a large multi-language challenge library for developer assessments? (LeetCode, HackerRank, open-source problem sets, academic sources)
2. **A2:** How do existing platforms (Codility, TestGorilla, HackerRank, CodeSignal) structure their challenge libraries — taxonomies, difficulty tiers, language coverage, topic tagging?
3. **A3:** What multi-language patterns work for coding challenges? (polyglot test harnesses, language-agnostic problem specs, per-language starter code/test generation)

### B. AI-Assisted Challenge Curation
4. **B1:** How can LLMs generate high-quality assessment challenges? What are the failure modes? (trivial questions, solvable by AI, ambiguous specs, hallucinated test cases)
5. **B2:** What human-in-the-loop workflows exist for AI-generated assessment content? (review queues, validation pipelines, quality scoring)
6. **B3:** How can AI personalize challenge selection based on role, level, and tech stack? (adaptive testing, item response theory, role-based filtering)

### C. Pipeline Creation UX
7. **C1:** What UX patterns do leading hiring platforms use for pipeline/workflow builders? (drag-and-drop stages, wizard flows, template galleries, AI-suggested pipelines)
8. **C2:** How should the "role → stages → challenges" flow work to minimize recruiter friction? (smart defaults, progressive disclosure, one-click presets with customization)
9. **C3:** How do platforms handle the cold-start problem — a new recruiter with no content who needs a working pipeline in under 5 minutes?

### D. Multi-Language & Localization
10. **D1:** How do coding assessment platforms handle multi-language execution? (containerized runners, WASM, language-specific test harness patterns)
11. **D2:** What's the minimum viable language set for a developer assessment platform, and how do you expand it?

## Strategy

| Researcher | Dimension | Sub-questions | Source types |
|---|---|---|---|
| R1 — Challenge Library Design | Content structure, taxonomy, multi-language patterns | A1, A2, A3, D2 | Competitor analysis, open-source repos, platform docs |
| R2 — AI Curation & Generation | LLM generation, quality control, personalization | B1, B2, B3 | Academic papers, AI/ML blogs, platform case studies |
| R3 — Pipeline UX Patterns | Recruiter workflows, cold-start, wizard design | C1, C2, C3 | UX case studies, competitor teardowns, design pattern libraries |
| R4 — Multi-Language Execution | Runtime patterns, test harness design, language expansion | D1, A3 (execution angle) | Engineering blogs, open-source judge systems, platform docs |

**Expected rounds:** 1 primary, 1 targeted follow-up if gaps remain.

## Acceptance criteria

- [ ] All 11 sub-questions answered with >=2 independent sources
- [ ] At least 3 competitor platforms analyzed in depth (not surface-level)
- [ ] Multi-language challenge generation strategy with concrete examples
- [ ] AI generation failure modes documented with mitigations
- [ ] Pipeline UX flow recommendation with specific interaction patterns
- [ ] Cold-start solution that gets a recruiter to a working pipeline in <5 minutes
- [ ] Contradictions between sources identified and addressed
- [ ] No single-source claims on critical findings

## Task ledger

| ID | Owner | Task | Status | Output |
|---|---|---|---|---|
| T1 | R1 | Challenge library taxonomy + multi-language content strategies | todo | research-r1.md |
| T2 | R2 | AI challenge generation, quality control, personalization | todo | research-r2.md |
| T3 | R3 | Pipeline creation UX patterns + cold-start solutions | todo | research-r3.md |
| T4 | R4 | Multi-language execution patterns + test harness design | todo | research-r4.md |
| T5 | Lead | Synthesize into UX strategy + implementation plan | todo | draft.md |
| T6 | verifier | Add citations, verify URLs | todo | brief.md |
| T7 | reviewer | Evidence integrity check | todo | verification.md |

## Verification log

| Item | Method | Status | Evidence |
|---|---|---|---|

## Decision log

| Date | Decision | Rationale |
|---|---|---|
| 2026-04-09 | Existing challengeLibrary.ts content is throwaway | User explicitly said "we dont want to use the existing library" |
| 2026-04-09 | Keep existing challenge TYPE system (6 types) and frontend components | These are the rendering/editor infrastructure, not the content |
| 2026-04-09 | Research scope includes AI generation AND curated content | User asked about both predefined and AI-generated |
