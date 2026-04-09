# Research Plan: Challenge Graph System

## Core question

How should Pipe build a graph-based system that links job descriptions/roles to assessment challenges — where agents generate new challenges that accumulate into a global library, and future pipeline creation pulls matching existing challenges before generating new ones?

**The loop:**
1. Recruiter creates a role (JD, level, stack)
2. System decomposes the role into skill/competency nodes
3. Graph query finds existing challenges that cover those nodes
4. Agent generates challenges ONLY for uncovered nodes
5. New challenges get added to the global library with graph edges
6. Over time, the library grows and generation decreases

## Sub-questions

### A. Skill/Competency Graph Design
1. **A1:** What skill taxonomy / ontology structures exist for mapping software engineering roles? (ESCO, O*NET, LinkedIn Skills Graph, Lightcast/EMSI, custom skill trees)
2. **A2:** How do you decompose a job description into a structured skill graph? (NLP extraction, LLM-based parsing, standardized skill taxonomies)
3. **A3:** What graph database patterns work for skill-to-assessment mapping? (property graphs, knowledge graphs, embedding-based similarity, hybrid approaches)

### B. Challenge-to-Skill Linking
4. **B1:** How do assessment platforms tag/link challenges to skills? (manual tagging, auto-tagging via AI, skill coverage matrices, psychometric item-skill mapping)
5. **B2:** What does item banking look like in educational/assessment science? (item response theory, item banks, adaptive testing, content balancing)
6. **B3:** How do you measure "coverage" — knowing which skills are tested and which gaps remain?

### C. Retrieval-Augmented Generation Pattern
7. **C1:** What RAG-like patterns exist for "retrieve existing, generate missing"? (semantic search over challenge embeddings, graph traversal for related items, hybrid retrieval)
8. **C2:** How do you prevent duplicate/near-duplicate challenges in a growing library? (deduplication, similarity thresholds, canonical challenge resolution)
9. **C3:** How should the system decide "close enough to reuse" vs "need to generate fresh"? (matching thresholds, freshness/staleness, difficulty calibration)

### D. Graph-Aware Pipeline Assembly
10. **D1:** How do you assemble a balanced assessment from a challenge pool? (constraint satisfaction, coverage optimization, time budgeting, difficulty distribution)
11. **D2:** What UX patterns show recruiters "here's what we found vs what we'll generate" in a trust-building way?

## Strategy

| Researcher | Dimension | Sub-questions | Source types |
|---|---|---|---|
| R1 — Skill Graphs & Taxonomies | Ontologies, JD decomposition, graph structures | A1, A2, A3 | O*NET/ESCO docs, LinkedIn engineering blogs, knowledge graph papers |
| R2 — Assessment Science & Item Banking | Psychometric item banks, skill tagging, coverage | B1, B2, B3 | Educational testing literature, IRT papers, platform case studies |
| R3 — RAG + Dedup + Assembly | Retrieve-then-generate, deduplication, pipeline assembly | C1, C2, C3, D1, D2 | RAG papers, search/retrieval engineering, constraint optimization |

## Acceptance criteria

- [ ] At least 2 concrete skill taxonomy options evaluated with pros/cons
- [ ] JD-to-skill decomposition approach with example
- [ ] Item banking best practices from assessment science (not just tech)
- [ ] RAG pattern for "reuse or generate" with decision criteria
- [ ] Deduplication strategy for growing challenge library
- [ ] Coverage optimization approach for balanced assessments
- [ ] All sub-questions answered with >=2 independent sources

## Task ledger

| ID | Owner | Task | Status | Output |
|---|---|---|---|---|
| T1 | R1 | Skill graphs, taxonomies, JD decomposition | todo | research-r1.md |
| T2 | R2 | Item banking, skill tagging, coverage measurement | todo | research-r2.md |
| T3 | R3 | RAG retrieval, dedup, pipeline assembly UX | todo | research-r3.md |
| T4 | Lead | Synthesize into architecture + implementation plan | todo | draft.md |
| T5 | verifier | Citations + URL verification | todo | brief.md |
| T6 | reviewer | Evidence integrity check | todo | verification.md |

## Verification log

| Item | Method | Status | Evidence |
|---|---|---|---|

## Decision log

| Date | Decision | Rationale |
|---|---|---|
| 2026-04-09 | Existing challengeLibrary.ts is throwaway | User: "we dont want to use the existing library" |
| 2026-04-09 | System is generative + accumulative | Challenges created by agents get added to global library for reuse |
| 2026-04-09 | Graph links roles → skills → challenges | User wants graph-based matching, not keyword search |
| 2026-04-09 | Generate only what's missing | Pull existing matches first, generate for uncovered skill nodes |
