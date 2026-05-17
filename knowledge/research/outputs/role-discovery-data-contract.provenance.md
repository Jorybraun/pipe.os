# Provenance: Role Discovery + Repo Understanding Data Contract

- **Date:** 2026-04-10
- **Slug:** role-discovery-data-contract
- **Rounds:** 1 researcher round (4 parallel researchers)
- **Sources consulted:** 84 total across 4 research files
  - R1 (methodology): 18
  - R2 (culture): 24
  - R3 (code review): 25
  - R4 (validation): 17
- **Sources accepted:** 84 (all resolved to research file entries)
- **URL verification:** 15 verified live, 1 redirected, 2 PDF-binary (unverifiable via HTTP body parse), 1 blank page, 4 dead, 61 not individually verified (book ISBNs, paywalled journals, and sources spot-checked within research files)
- **Attribution corrections during verifier pass:** 2
  - R2-S7: Quinn → Heritage et al. (correct paper author)
  - R3-S4: Gousios → Kudrjavets et al. (correct paper author)
- **Verification verdict:** PASS WITH NOTES
  - **FATAL:** 0
  - **MAJOR:** 3 — all patched in the final brief before delivery:
    1. OCAI Cronbach's α per-archetype values softened to the reported range (.69–.83) with a note flagging the need to reconfirm per-dimension alphas against the primary Heritage et al. paper before the ADR specifies per-dimension thresholds.
    2. SWE-bench ~40 % BM25 oracle-file recovery claim softened to "meaningfully limited rates" with the specific figure flagged for primary-source reconfirmation before it is quoted in the ADR.
    3. Mobley v. Workday characterization softened from "established that" to "the court's certification analysis indicates" — explicitly noting the case is in active litigation and the cited secondary source (Norton Rose Fulbright client alert) is not an appellate opinion.
  - **MINOR:** 5 — accepted as-is per skill rules.

- **Plan:** `knowledge/outputs/.plans/role-discovery-data-contract.md`
- **Handoff:** `knowledge/outputs/.plans/role-discovery-data-contract-handoff.md`
- **Research files:**
  - `knowledge/outputs/role-discovery-data-contract-research-methodology.md` (R1)
  - `knowledge/outputs/role-discovery-data-contract-research-culture.md` (R2)
  - `knowledge/outputs/role-discovery-data-contract-research-codereview.md` (R3)
  - `knowledge/outputs/role-discovery-data-contract-research-validation.md` (R4)
- **Draft:** `knowledge/outputs/.drafts/role-discovery-data-contract-draft.md`
- **Cited brief:** `knowledge/outputs/role-discovery-data-contract-brief.md`
- **Reviewer findings:** patched directly into the brief; no standalone report file written (3 MAJOR — OCAI α range, SWE-bench 40 % figure, Mobley v. Workday characterization — fixed inline before delivery)
- **Final deliverable:** `knowledge/outputs/role-discovery-data-contract.md`

## Workflow notes

- **Parallel researcher launch.** The pre-written handoff file suggested sequential launches to conserve lead context. This was overridden in favour of the `/deep-research` skill's parallel-in-one-message default because researchers write full outputs to files and return only short summaries, so context pressure is bounded at synthesis time rather than during the fan-out. Decision recorded in the plan's Decision Log.
- **Synthesis discipline.** The draft brief was written by the Lead (this conversation) from the research files, not delegated to a subagent. Every `[R#-S#]` marker in the brief maps to a source that actually appears in the named research file, as re-checked by the verifier.
- **Reviewer fixes applied before delivery.** All three MAJOR issues were patched in the brief via targeted prose edits before the copy to the final deliverable path. No FATAL issues were found, so no second reviewer pass was run (per skill rules: MAJOR → patch or move to Open Questions, FATAL → re-review).

## Load-bearing recommendations the brief is grounded on

1. **Role Context Document schema** — hybrid of framework analysis matrix (Ritchie & Spencer 1994), IPA evidence anchors (Smith et al. 2009), grounded theory axial links (Charmaz 2014), Means-End Chain laddering (Reynolds & Gutman 1988). Four independent methodological traditions triangulate; not single-sourced.
2. **Synthesis prompting** — three-layer pattern (schema-guided generation + constrained JSON decoding + Haiku 4.5 verification pass). Grounded in Chain-of-Density, PARSE/SCOPE, Self-Refine, and constrained-decoding libraries (Outlines, jsonformer, llguidance).
3. **Multi-stakeholder three-tier aggregation** — (1) domain-authoritative anchoring, (2) per-source preservation with conflict flags on shared domains, (3) explicit-formula aggregates only on genuine consensus fields. Grounded in Conway & Huffcutt (supervisor-peer ρ = .34) and RAND/UCLA Appropriateness Method.
4. **Five-signal team culture set** — four OCAI archetypes (Current-culture framing, not Ideal) + Edmondson psychological safety. Explicitly rejects Harver's Ideal-culture framing as a candidate screen on validity grounds.
5. **BARS: universal base + RCD-derived anchor overrides** — per-dimension overrides derived from laddering chains at role setup, not per-candidate.
6. **Probe bank: static base + role-setup-time enrichment** — never per-candidate dynamic generation. Dynamic generation fails NYC Local Law 144 auditability and EU AI Act Article 14 interpretability.
7. **Dealbreaker gates: auto-flag-then-HITL, never auto-fail** — grounded in Griggs, Uniform Guidelines four-fifths rule, EEOC v. iTutorGroup (2023), Mobley v. Workday (2025, in litigation), EU AI Act Article 14 (effective 2026-08-02).
8. **Two-stage repo understanding architecture** — Pass 3 offline on Haiku 4.5 (role-agnostic `repo_engineering_signals`) + runtime Gemma 4 reranking on (role × repo) pairs. Grounded in ColBERT offline/online split, cross-encoder reranker literature, AIF asynchronous preranking, and SWE-bench query-agnostic retrieval limits.
9. **Staged validation ladder** — N=0 face → N=30–50 construct → N=100–200 transportability → N=300–500 criterion-suggestive. Grounded in Sackett et al. 2022 (r_op = .42), Hoffman 1999 (transportability), SIOP 2018 Principles, Shadish/Cook/Campbell quasi-experimental.

## Items that did not make the brief but should inform ADR-036

- **Primary-source reconfirmation needed before the ADR quotes specific figures:** (a) OCAI per-archetype Cronbach's α values, (b) SWE-bench BM25 oracle-file recovery percentage with exact context size.
- **Open Questions section in the brief has 11 items** — the ADR should either resolve them or carry them forward as explicit deferrals.
- **Mobley v. Workday is a moving case.** The ADR should include a "legal landscape last verified on 2026-04-10" note and flag a quarterly re-check.

## Next actions (post-delivery, not part of this run)

1. Draft ADR-036 at `docs/decisions/current/ADR-036-role-discovery-data-contract.md` using the scaffold at `/Users/hans/.claude/plans/streamed-squishing-waterfall.md`.
2. Update `knowledge/STRATEGY.md` RD-1 through RD-24 rows with the new recommendations.
3. Commit the outputs folder additions with a changelog entry under `[Unreleased]`.
