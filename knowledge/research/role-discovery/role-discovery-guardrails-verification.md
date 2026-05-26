# Verification Report: Role Discovery Agent Guardrails

**Draft:** `/Users/hans/Code/PIPE/PIPE-OS/knowledge/role-discovery/role-discovery-guardrails.md`
**Verification date:** 2026-04-17
**Overall status:** PASS WITH NOTES

## Summary

The draft is broadly well-sourced, with most critical claims traceable to peer-reviewed work cited accurately in the research files. The strongest weaknesses are (1) a domain-transfer overstatement for the 38.15% Tam 2024 gap — applied as if measured on open-ended question generation when it was measured on a character-manipulation task — and (2) a confidence overstatement on the deceptive-explanation anchoring effect, which originates from a misinformation-belief study and is applied as a "Critical design rule" for a hiring context without flagging the domain gap. One source-numbering collision exists in the consolidated reference list. No fabricated sources were found; all named papers exist and are cited by the research files with accurate enough summaries.

---

## FATAL issues

None found.

---

## MAJOR issues

### M1. 38.15% JSON-mode performance gap — domain mismatch presented as direct evidence

- **Location:** Executive Summary (paragraph 2), Part 2 §2.5, Part 7 M1, Open Questions #3
- **Quote:** "Tam et al. EMNLP 2024 [36] documented a **38.15% performance gap** when JSON-mode forced GPT-3.5 to place `answer` before `reason`, validating that rationale-*before*-question is a genuine output-quality lever, not just UX chrome."
- **Problem:** The research file (R3-xai §4) correctly names the specific task: "Last Letter Concatenation, LLaMA-3-8B" — a character-level string manipulation task measuring whether a model can concatenate the last letters of a list of words. This is a memorization/attention task, not an open-ended reasoning task analogous to interview question generation. The draft promotes this number as directly validating that rationale-before-question improves the quality of *role-discovery questions*, a completely different task domain. The research file itself hedges: "Synthesis: Forcing a model to articulate a `rationale` field *before* the `question` field in a JSON schema is empirically grounded as an output-quality lever, but only if: (a) the schema does not use constrained-decoding/JSON-mode..." — the draft's executive summary drops this conditionality. Additionally, the gap was measured on LLaMA-3-8B, but the primary model being discussed is GPT-3.5 Turbo (the model where the key-ordering was documented). The 38.15% is not the GPT-3.5 figure; it is the LLaMA-3-8B figure on a different task. The draft conflates two different findings from the same paper.
- **Suggested action:** Qualify the 38.15% claim in the executive summary and Part 2 §2.5 with its actual domain ("a character-manipulation task") and the fact that the scale of gain on a question-generation task is unknown. Retain the schema-ordering recommendation — it remains valid — but strip the specific percentage from the top-line narrative since it cannot be applied with confidence to this use case. Add to Open Questions.

### M2. Deceptive-explanation anchoring (β=0.32) — misinformation study applied as hiring design rule

- **Location:** Executive Summary (paragraph 2), Part 2 §2.4
- **Quote:** "A hallucinated prior-answer reference makes a bad question *more* persuasive, not less — the deceptive-explanation anchoring effect β=0.32, p=0.009 [23] is the single sharpest design risk in the stack."
- **Problem:** Source [23] is Altay & Acerbi CHI 2025, "Deceptive Explanations by Large Language Models Lead People to Change their Beliefs About Misinformation More Often than Honest Explanations." The study measured *belief change about news headlines* — specifically whether false misinformation labels paired with deceptive AI explanations caused participants to believe false headlines. This is a one-way belief-formation task about external facts, not a hiring-intake conversation where a candidate is deciding how to answer a question about their own experience. The research file (R3-xai §2) accurately describes this study as about "false headlines" and notes the concern correctly as an *inference*. The draft, however, elevates this to a "Critical design rule, derived from [23]" with a hard quantitative β value and calls it "the single sharpest design risk in the stack" — this is a confidence overstatement for a cross-domain transfer. The β=0.32 is a domain-specific effect size that cannot be quoted as applying to hiring-interview anchoring without a qualifying hedge.
- **Suggested action:** In Part 2 §2.4 and the executive summary, replace "Critical design rule, derived from [23]" with "Design rule, inferred from [23] applied cross-domain" and note that the cited study measures misinformation belief, not interview-context anchoring. Add a hedge: "The effect size (β=0.32) is domain-specific and may not transfer; the directional concern — that incorrect rationale anchors users more than no rationale — is supported by the broader deceptive-explanation literature." This preserves the actionable recommendation without overstating the evidence grade.

### M3. Mobley v. Workday — "confirmed" overstates the legal precedent stage

- **Location:** Part 3 §3.2, Part 7 M2, Executive Summary (paragraph 2)
- **Quote:** "The agent-theory principle established: *a platform vendor with substantial influence over the hiring workflow… can face direct statutory liability*… PIPE shapes the JD and scoring criteria. That is sufficient control for agent liability to attach under the Mobley framework." And: "Platform liability is confirmed, not theoretical."
- **Problem:** The research file (R2-compliance §7.2) accurately describes the status: class certification was granted on May 16, 2025 for the ADEA claim; the "agent theory" was allowed to proceed to discovery in July 2024. Class certification means the court found common questions suitable for collective treatment — it does not adjudicate the merits. The court has not ruled that Workday is in fact liable. The legal principle that a vendor *can* be subject to this theory is confirmed to proceed; that a vendor *is* liable under that theory is not yet decided. The draft's phrase "Platform liability is confirmed, not theoretical" goes one step beyond what the source says.
- **Suggested action:** Change "Platform liability is confirmed, not theoretical" to "Platform liability under the agent theory is confirmed to be a live legal risk — the theory survived dismissal and class certification — though the merits have not been adjudicated." Retain all substantive warnings; only the confidence phrasing needs correction.

### M4. 3-turn depth threshold — the Reflexion "convergent source" is a category error

- **Location:** Part 4 §4.1, Executive Summary (paragraph 2), Part 7 M3
- **Quote:** "Five independent research traditions converge on a 3–4 rung ceiling [60][61][63][64][65]: … **Reflexion** (Shinn et al. NeurIPS 2023 [62]): same-action-for-3-cycles triggers self-reflection."
- **Problem:** Reflexion's "3-cycle" heuristic (R4-depth §4.2) is about an LLM agent that executes the *same action* and receives *the same response from the environment* for 3 consecutive cycles — meaning a tool-use loop that is stuck. It is a technical stopping criterion for a robotics/coding/HotPotQA agent that is in an execution loop, not a protocol for interview follow-up depth. Counting Reflexion as one of the five "independent traditions" that converge on "3 follow-ups per topic" in human conversation is a category error. The other four traditions (laddering, MI, NICHD, 5-Whys) are genuinely about discourse depth in interviews or conversational probing; Reflexion is not.
- **Suggested action:** Downgrade Reflexion from the primary "convergence" list to a supporting observation: "The 3-cycles heuristic in Reflexion (a different domain: LLM action-loop detection) is weakly analogous and directionally consistent." The four genuine traditions (laddering, MI, NICHD, 5-Whys) remain sufficient grounding for the recommendation; no change to the recommendation itself is needed.

### M5. Cross-family classifier effectiveness — Panickssery 2024 measures GPT-family models, not Gemma-vs-Qwen

- **Location:** Part 5 §5.1, Executive Summary (paragraph 2)
- **Quote:** "Panickssery et al. NeurIPS 2024 [40] is the load-bearing citation. The paper established, *causally via label-swap experiment*, that GPT-4 and GPT-3.5 evaluators preferred summaries labeled as their own even when they weren't."
- **Problem:** The research file (R3-xai §6) accurately describes the paper: it studies GPT-4 and Llama-2 self-preference, and the label-swap causality experiment specifically uses GPT-4 and GPT-3.5. The paper does not study Gemma evaluating Qwen outputs or vice versa. The inference that "cross-family independence is mechanistically necessary" is sound as a general architectural principle — same-family bias is a documented mechanism. However, the draft and research file both say "Gemma-guards-Qwen is architecturally sound" as if Panickssery 2024 directly validates that specific pairing. It validates the *category* of cross-family independence, not the specific models used in PIPE. This is a single-source inference step that should be labeled as such.
- **Suggested action:** Add a qualifier: "Panickssery 2024 validated same-family self-preference causally for GPT-family models. By extension, the same mechanism is expected to apply to Gemma evaluating Qwen — but this specific pairing has not been empirically tested. The architectural principle is sound; the specific model pairing involves one inference step."

### M6. Source numbering collision on source 60

- **Location:** Sources section, R2 sources block
- **Problem:** In the consolidated source list, source 60 is assigned to the NY State Comptroller audit (an R2-compliance source). However, in the body text of Part 4 (depth tracking), source [60] is used to cite Reynolds & Gutman 1988 ("Laddering theory"), which is the first entry in the R4 sources section (source 61 in the consolidated list). The inline citation "[60][61][63][64][65]" in Part 4 §4.1 therefore maps source 60 to the Comptroller audit document rather than to Reynolds & Gutman, which is the intended citation.
- **Suggested action:** Renumber the NY Comptroller audit to avoid collision, or use the R2 internal code (R2-S12) for that reference. The inline citations in Part 4 §4.1 need to be updated to match.

---

## MINOR issues

- Source 11 (Gilliland 1993) — acknowledged as cited via derivative sources only, no direct URL. Three secondary sources (Hausknecht 2004, McCarthy 2017, SIOP 2024) all cite it, so the underlying claim is sufficiently backed. Acceptable to leave as-is with the existing note.
- The Vereschak et al. IUI 2025 study should include N (N=306) in the inline citation where cited.
- The APA/SIOP Principles URL may not be a stable route; consider citing SIOP's own host if available.
- 26 dead links self-annotated by the draft are paywalls (not broken records). Acceptable.
- Draft describes Altay & Acerbi as "CHI 2025" while the paper URL is an arXiv preprint. Venue acceptance was not verified.
- Research file R4 single-source AI figure (5–7 rungs) did not propagate into the draft. Acceptable.

---

## Spot-check log

1. **Tam 2024 (S36) — 38.15% gap:** Task confirmed as Last Letter Concatenation on LLaMA-3-8B. MAJOR M1.
2. **Altay & Acerbi 2025 (S23) — β=0.32:** Study confirmed as misinformation-belief domain. MAJOR M2.
3. **Mobley v. Workday (S55):** Class certification stage confirmed; merits not adjudicated. MAJOR M3.
4. **Panickssery 2024 (S40):** GPT-family causal result; extension to Gemma/Qwen is inference. MAJOR M5.
5. **Reynolds & Gutman 1988 (S61):** Draft characterization accurate.
6. **Miller & Rollnick / MITI (S67-68):** Draft derivation from R4 accurate.
7. **iTutorGroup (S53):** Settlement facts match research file.
8. **NICHD Protocol (S70-71):** Funnel principle correctly described.
9. **Source numbering collision at S60:** Confirmed. MAJOR M6.
10. **Reflexion (S62):** Category error confirmed. MAJOR M4.

---

## Overall assessment

The draft has strong evidence integrity in its three legally-grounded sections (sensitivity ladder, Mobley liability, state-law overlay) and in the cross-family classifier rationale. The research files are cited accurately at the level of individual claims. The main evidence-integrity weaknesses are confidence calibration failures — the 38.15% gap is real but applied outside its domain, and the deceptive-explanation anchoring effect is presented as a "Critical design rule" for a domain the study did not measure. Both should be demoted from top-line claims to inference with qualification. The 3-turn threshold is properly labeled as "convergent inference" in both the research file and Open Questions, but the Reflexion co-citation in the executive summary's convergence list introduces a category error that should be corrected. No fabricated sources were found. Dead-link disclosure is honest and appropriate.

**Status:** PASS WITH NOTES — FATAL: 0, MAJOR: 6, MINOR: 6

Per `/deep-research` skill rules: FATAL issues must be fixed before delivery; MAJOR issues are noted in Open Questions; MINOR issues are accepted. This brief has no FATAL issues. M6 (source numbering collision) is a citation bug and is fixed inline. M1–M5 are confidence-calibration notes added to Open Questions in the brief.
