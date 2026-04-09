# Research Plan: Base Repo Discovery for Hybrid AIG Pipeline

**Slug:** `repo-discovery-pipeline`
**Date:** 2026-04-09
**Parent:** `code-review-content-sourcing` (Part 4.1, CR-13)
**Context:** PIPE's hybrid approach uses real open-source repos as code skeletons, then plants bugs via AIG templates. The unresolved question: how do we *find* the right repos for a given role? A "Senior React Engineer" needs a React codebase, not a Go CLI tool. Current research says "use SEART GHS with star/license filters" but that's not enough — we need to assess whether a repo is actually good assessment material, and match it to the role description the recruiter defined.

## Core question

How should PIPE discover, evaluate, and select open-source repositories as base skeletons for the hybrid AIG content pipeline, such that each repo matches a target role's tech stack, domain, and seniority level?

## Sub-questions

1. **Discovery tools & APIs** — Beyond SEART GHS and GitHub Search API, what tools exist for finding repos by tech stack, framework, domain, and quality signals? (GitHub Topics, dependency graph, package ecosystem crawlers, SourceGraph, Libraries.io, etc.) What filters and metadata are available programmatically?

2. **Repo quality assessment for assessment use** — What makes a codebase good skeleton material for a code review assessment? Criteria might include: test coverage, code structure clarity, documentation, realistic patterns vs. toy examples, appropriate complexity for seniority level. How do existing coding assessment/benchmark platforms (SWE-Bench, CodeReviewBench, DevBench, RepoBench) select and evaluate their base repos? What signals predict "this repo will work as assessment material"?

3. **Role-to-repo matching** — How to map a role description (tech stack, domain, seniority) to repo characteristics? What metadata is available on repos to enable this matching? How do we handle the long tail of niche stacks? Can we use dependency manifests (package.json, requirements.txt, go.mod) as a more precise signal than language alone?

## Strategy

3 parallel researcher subagents (Sonnet), disjoint dimensions:
- **R1:** Discovery tools, APIs, and metadata sources for repo search
- **R2:** Repo quality criteria + how benchmarks/assessment platforms select repos
- **R3:** Role-to-repo mapping strategies + dependency-based tech stack detection

1 round expected. Targeted follow-up if gaps found.

## Acceptance criteria

- [ ] ≥3 discovery tools/APIs compared with filtering capabilities
- [ ] Concrete quality criteria for "good assessment skeleton" with ≥2 sources
- [ ] At least 1 existing benchmark's repo selection methodology documented
- [ ] Role-to-repo matching approach grounded in available metadata
- [ ] Practical recommendation for PIPE's pipeline (not just theory)
- [ ] No single-source claims on critical findings

## Task ledger

| ID | Owner | Task | Status | Output |
|---|---|---|---|---|
| T1 | researcher R1 (sonnet) | Discovery tools, APIs, metadata for repo search | **done** | `knowledge/outputs/repo-discovery-pipeline-research-tools.md` |
| T2 | researcher R2 (sonnet) | Repo quality criteria + benchmark selection methods | **done** | `knowledge/outputs/repo-discovery-pipeline-research-quality.md` |
| T3 | researcher R3 (sonnet) | Role-to-repo matching + dependency-based detection | **done** | `knowledge/outputs/repo-discovery-pipeline-research-matching.md` |
| T4 | lead | Synthesize draft | **done** | `knowledge/outputs/.drafts/repo-discovery-pipeline-draft.md` |
| T5 | verifier | Cite + URL-check | **done** | `knowledge/outputs/repo-discovery-pipeline-brief.md` |
| T6 | reviewer | Evidence integrity | **done** | `knowledge/outputs/repo-discovery-pipeline-verification.md` |
| T7 | lead | Final deliverable + provenance | **done** | `knowledge/outputs/repo-discovery-pipeline.md` + `.provenance.md` |

## Verification log

| Item | Method | Status | Evidence |
|---|---|---|---|
| SEART GHS capabilities | direct tool documentation | verified | R1-S1, R1-S2, R1-S3 (SSL error on live site, may be transient) |
| GitHub API filtering options | GitHub REST/GraphQL docs | verified | R1-S4, R1-S5, R1-S6, R1-S7 |
| SWE-Bench repo selection method | primary paper (ICLR 2024) | verified | R2-S1, R2-S2 |
| Dependency manifest parsing feasibility | package ecosystem docs | verified | R3-S2, R3-S3, R3-S8 |

## Decision log

- **2026-04-09** — Scoped to repo discovery only, not the full AIG pipeline (bug planting, variant generation, etc. already covered in parent research)
- **2026-04-09** — Focus on the gap: parent research says "scrape" but doesn't address how to find repos that match a role, or how to assess repo quality for assessment use
- **2026-04-09** — Researcher model: Sonnet per user request
- **2026-04-09** — All tasks completed. Verification: PASS WITH NOTES. 2 FATAL fixed (star threshold convergence, senior track mapping). 4 MAJOR fixed/caveated. Delivered.
