# Provenance: Base Repo Discovery for the Hybrid AIG Content Pipeline

- **Date:** 2026-04-09
- **Rounds:** 1 (3 parallel researchers)
- **Sources consulted:** 76 total across 3 research files (20 R1, 18 R2, 38 R3)
- **Sources accepted:** 75 (1 dead link — R1-S1 SEART GHS SSL error, likely transient)
- **Sources rejected:** 0 (dead link retained with note)
- **Verification:** PASS WITH NOTES (2 FATAL fixed, 4 MAJOR fixed/caveated, 4 MINOR accepted)
- **Plan:** `outputs/.plans/repo-discovery-pipeline.md`
- **Research files:**
  - `outputs/repo-discovery-pipeline-research-tools.md` (R1 — discovery tools & APIs)
  - `outputs/repo-discovery-pipeline-research-quality.md` (R2 — repo quality criteria + benchmark selection)
  - `outputs/repo-discovery-pipeline-research-matching.md` (R3 — role-to-repo matching + dependency detection)
- **Draft:** `outputs/.drafts/repo-discovery-pipeline-draft.md`
- **Cited version:** `outputs/repo-discovery-pipeline-brief.md`
- **Reviewer report:** `outputs/repo-discovery-pipeline-verification.md`
- **Final deliverable:** `outputs/repo-discovery-pipeline.md`

## FATAL issues fixed before delivery

1. **Star threshold convergence overstated.** Exec summary claimed SWE-Bench, Multi-SWE-bench, and SWE-Bench++ all converge on ≥500 stars. SWE-bench uses no star filter (PyPI popularity); SWE-Bench++ uses >100 stars. Fixed to attribute ≥500 only to Multi-SWE-bench.

2. **"≥2,000 stars for senior track" unsourced.** Quality table repurposed RepoCod's 2,000-star corpus criterion as a seniority recommendation. RepoCod is a code completion benchmark, not an assessment seniority guide. Fixed to separate benchmark criteria from PIPE's inferred seniority mapping.

## MAJOR issues fixed/caveated

1. ">100 files for senior" ceiling had no source — removed, replaced with "calibrate empirically."
2. "Flaky tests — #1 failure cause" ranking overstated — rephrased to "disqualifying."
3. Temporal freshness gate 2024-07-01 noted as PIPE's own operationalization, not sourced from benchmarks.
4. Competitive differentiation claim hedged with "(based on publicly available vendor documentation)."
