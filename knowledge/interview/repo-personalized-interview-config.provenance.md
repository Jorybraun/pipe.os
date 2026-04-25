# Provenance: Repo-Personalized Interview Config

- **Topic:** Repo-personalized interview — matching philosophy, fairness architecture, configuration UX
- **Blocker for:** ADR-039 (Bi-directional vectorization + 3-station interview trajectory)
- **Date delivered:** 2026-04-18
- **Lead:** Claude (deep-research workflow)
- **Researchers:** 3 parallel Sonnet sub-researchers
  - R1 — philosophy (Q1 precedent, Q2 familiarity confound, Q4e purpose-conditional scoring) — 25 sources
  - R2 — fairness (Q3 disparate impact, Q4 transparency, Q4d monitoring) — 25 sources
  - R3 — psychometrics (Q4a calibration, Q4b time-limit, Q4c difficulty banding) — 20 sources
- **Rounds:** 1 researcher round + competitor scan + UX design pass
- **Sources consulted (total across all research files):** 70 numbered entries (25 + 25 + 20)
- **Sources accepted (verified or source-located-by-PMID/DOI):** 28 URL-verified + 12 PDF-binary-resolving = 40
- **Sources flagged:** 19 URLs 4xx / wrong content (documented in Verifier Notes §Dead Links Summary); 2 unsourced claims (β=0.32 in guardrails file; Qualified.io per-candidate variation)
- **Author misattributions found and corrected in body:** Wilson & Caliskan 2024 (was "Kotek et al." in R2); Lance 2008 + Sackett & Dreher 1982 (was "Lance et al. 2000" phantom citation)
- **Date correction:** Colorado SB 24-205 effective date corrected from 2026-06-30 (R2) → 2026-02-01 (Colorado General Assembly page)
- **Magnitude correction:** "23–331 percentage-point" score-inflation claim corrected to distinguish 23 pp absolute (Liang) from ~332% relative (Chen)

## Verification result

- **Verifier (citation + URL):** 59 citations placed; 19 dead-link flags; 13 Verifier Notes (§A–§M); Qualified.io differentiation claim unverifiable from public sources.
- **Reviewer (evidence-integrity):** PASS WITH NOTES. 1 FATAL (23–331 pp framing) — corrected. 4 MAJOR (Gilliland 2003 PMID; NCLEX 400 threshold; Appendix Lance 2000 vestige; Qualified.io unverified) — Appendix + body corrections applied; remaining issues tracked in §7 Open Questions. 5 MINOR — accepted.

## Deliverable paths

- **Plan:** `knowledge/outputs/.plans/repo-personalized-interview-config.md` (decision log recorded the path amendment from `knowledge/outputs/` → `knowledge/interview/`)
- **Research files:**
  - `knowledge/interview/repo-personalized-interview-config-research-philosophy.md`
  - `knowledge/interview/repo-personalized-interview-config-research-fairness.md`
  - `knowledge/interview/repo-personalized-interview-config-research-psychometrics.md`
- **Design-track drafts:**
  - `knowledge/interview/.drafts/repo-personalized-interview-config-competitor-scan.md`
  - `knowledge/interview/.drafts/repo-personalized-interview-config-ux-design.md`
- **Outline:** `knowledge/interview/.drafts/repo-personalized-interview-config-outline.md`
- **Pre-verifier draft:** `knowledge/interview/.drafts/repo-personalized-interview-config-draft.md`
- **Final brief:** `knowledge/interview/repo-personalized-interview-config.md`
- **Reviewer report:** `knowledge/interview/repo-personalized-interview-config-verification.md`

## Known follow-ups (not part of this deliverable)

1. **ADR-039** to be authored next, using this brief as its research base. Outline sketched in brief §6.1.
2. **β = 0.32 correction** in `knowledge/outputs/role-discovery-guardrails.md` — standalone file edit, unverified external citation to be removed.
3. **Qualified.io verification** — product trial or direct vendor contact required to confirm or refute the per-candidate-variation differentiation claim before it appears in customer-facing materials.
4. **R2 research file internal corrections** — Wilson & Caliskan author attribution; Colorado SB 24-205 date; Gilliland 2003 PMID.
5. **R3 research file internal corrections** — Trejo-Mejía attribution (was Rezigalla); Falcão attribution (was Alowais); Onwudiegwu attribution (was Gormley, in R1).
6. **Demographic data collection decision** (Open Question 5) — product-legal decision required before §3.2 runtime monitoring can ship.
