# Provenance: PIPE marketing positioning

- **Date:** 2026-04-19
- **Supervisor:** Claude Opus 4.7 (Lead Researcher; wrote plan + synthesis draft)
- **Researchers:** 4 parallel Sonnet 4.6 general-purpose subagents (R1 ICP, R2 competitors, R3 cheating crisis, R4 compliance)
- **Verifier:** Sonnet 4.6 (inline citations + URL verification pass; PENDING status retained for unchecked URLs)
- **Reviewer:** Sonnet 4.6 (evidence-integrity audit)
- **Rounds:** 1 (initial round blocked by WebSearch/WebFetch permissions; re-launched after .claude/settings.json granted both tools)
- **Sources consulted:** ~138 across all research files (22 R1 + 43 R2 + 38 R3 + 35 R4)
- **Sources accepted:** 63 URLs cited inline in the final brief (PENDING URL-verification status retained; primary attribution fixed per reviewer notes)
- **Sources rejected / downgraded:** 0 dead; 4 citation-attribution fixes applied post-review (HackerRank $13,942 retracted from Vendr URL to HackerRank comparison article; Codility pricing split into published vs. Vendr rows; Karat attribution clarified; Illinois 37-cases qualified as single-source)
- **Reviewer verdict:** PASS WITH NOTES (0 FATAL, 4 MAJOR — all fixed, 6 MINOR — accepted)

## Artifacts

- **Plan:** `outputs/.plans/pipe-marketing-positioning.md`
- **Draft:** `outputs/.drafts/pipe-marketing-positioning-draft.md`
- **Research files:**
  - `outputs/pipe-marketing-positioning-icp.md`
  - `outputs/pipe-marketing-positioning-competitors.md`
  - `outputs/pipe-marketing-positioning-crisis.md`
  - `outputs/pipe-marketing-positioning-compliance.md`
- **Cited brief:** `outputs/pipe-marketing-positioning-brief.md`
- **Reviewer report:** `outputs/pipe-marketing-positioning-verification.md`
- **Final delivery:** `outputs/pipe-marketing-positioning.md`

## Known limitations

1. **URL liveness not exhaustively verified** — the verifier ran out of tool budget before completing the full WebFetch pass; PENDING status retained on many URLs. Recommend a targeted URL sweep before using specific quotes publicly.
2. **No private-sector RFP language located** — compliance-as-switching-factor evidence is inferred from law-firm alerts rather than observed directly. Flagged in Open Questions.
3. **Post-March 2026 developments not captured** — Karat NextGen early reception, CodeSignal "agentic assessments" adoption, EU Digital Omnibus final outcome all post-date the research window. Flagged in Open Questions.
4. **Reviewer MAJOR issues fixed inline** — citation attributions repaired; no content rewrites.
