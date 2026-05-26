# Synthesis Outline: Repo-Personalized Interview Config

## Brief title
**Repo-Personalized Interview: Matching Philosophy, Fairness Architecture, and Configuration UX**

---

## 1. Executive Summary (~500 words)
Three-mode (T/V/H) framing is a recruiter-facing UX; under the measurement surface, the research forces an asymmetric model where **role-fit is the primary validity anchor** and candidate-fit is a **completion-rate floor** (R1 [S1]–[S11], load-bearing). A naïve symmetric T/V/H design contradicts the AC/OSCE construct-validity literature and would produce scores whose validity arguments cannot be sustained under Kane 2013 IUA scrutiny.

Fairness-of-scale is a **distribution-of-difficulty** problem, not a pass-rate problem. The UGESP 4/5ths rule must be reinterpreted for the personalization regime — applied to assigned difficulty tiers, not selection rates (R2 [S8] Kotek + novel inference).

The three-station design is **marginal for summative use at launch** (R3 G-coefficient 0.60–0.75 at n=3 stations); ship with an N≥100 reliability gate before allowing hire/no-hire decisions to be anchored on composite score (R3 [S8, S9]).

## 2. Context and Scope (~400 words)
- Recap STRATEGY.md 2026-04-18 exploratory direction (bi-directional vectorization + 3-station OSCE).
- Explicit: brief is a **blocker on ADR-039**; no ADR-039 without resolving these questions.
- Criterion-referenced framing locked in (STRATEGY.md 2026-04-18). This brief does not revisit it.
- What's in-scope: the 4 config axes (philosophy × tolerance × linkage × automation), disqualification semantics, guardrails, config UX, calibration staging.
- Out of scope: ADR-034 challenge authoring changes; culture interview; scoring rubric implementation details.

## 3. Research Track Findings (~2500 words)

### 3.1 Philosophy: role-fit primary, candidate-fit floor (Q1, Q2, Q4e)
- **Core claim:** Literature is unambiguous — OSCE/MMI/AC/SJT all role-tuned, not experience-tuned (R1 [S1]–[S11]).
- **Exercise effect insight:** situational specificity is the dominant variance component; personalizing to candidate background amplifies rather than reduces this confound (R1 [S4] Lance, [S5] Lievens).
- **Codebase familiarity confound:** quantified in LLM literature (23–331% inflation), directional for humans, magnitude unknown (R1 [S12]–[S15], [S17]).
- **Purpose-conditional scoring (Kane/Messick/AERA):** T-mode fail → diagnostic of role-unfit; V-mode fail → diagnostic of claim inflation; H-mode → two-dimensional scorecard required (R1 [S19]–[S23]).

**Reframing of T/V/H:**
- T-mode is the **default philosophical grounding**.
- V-mode is **not a co-equal alternative** — it is a *candidate-fit floor* applied under role-fit to control completion rate and reduce construct-irrelevant stack-syntax variance.
- H-mode is the operational default — enforce role-fit threshold first, then apply candidate-fit floor as a secondary filter.

### 3.2 Fairness: distribution-of-difficulty, not pass-rates (Q3, Q4d)
- **Legal exposure: HIGH.** Griggs/UGESP applies directly; EEOC 2023 TA + Mobley agent theory puts PIPE (as tool developer) in the liability chain (R2 [S1]–[S6]).
- **Kotek 2024 evidence generalizes to code-repo embeddings by analogy** (R2 [S8]), but no direct study of code-repo-embedding bias in hiring exists — **flagged gap**.
- **Novel architectural contribution (single-source inference, explicitly flagged):** applying UGESP 4/5ths rule to assigned *difficulty-tier distributions* by demographic proxy, not just selection rates.
- **Five-layer monitoring architecture (R2 Q4d):** WEAT pre-deployment audit → runtime distribution monitoring → equalized-odds on stratified pass rates → audit trail → re-audit on model updates.
- **Legal ceiling dates — near-term compliance constraints:**
  - NYC LL 144: already live (July 2023).
  - Illinois HB 3773: effective 2026-01-01.
  - Colorado SB 24-205: effective 2026-06-30.
  - EU AI Act Art. 13: effective 2026-08-02.
- **β=0.32 deceptive-explanation figure** attributed to Altay & Acerbi 2025 in the 2026-04-17 guardrails brief **could not be verified** against a primary source (R2 explicit note). Correction required in `role-discovery-guardrails.md` before citing externally.

### 3.3 Transparency: disclose class, not parameters (Q4)
- Gilliland 1993 + Hausknecht 2004: disclosing job-relatedness framing is the key justice improver, not parameter disclosure (R2 [S15], [S16]).
- Fok & Weld 2023: wrong explanations with right AI recommendations cause humans to reject correct recommendations. **Don't over-explain** (R2 [S18]).
- **Recommended candidate-facing text:** *"Your coding challenge was selected to match the technologies and problem types relevant to this role based on your background."* (R2-derived). No difficulty tier, no embedding distance, no stack-specific rationale.
- Legal-minimum disclosures (AI-used notification) handled separately per jurisdiction.

### 3.4 Psychometrics: template-level calibration, N-staged (Q4a, 4b, 4c)
- **N-staged calibration plan (R3 [S1]–[S7]):**
  - N=10: expert estimation only; no empirical calibration.
  - N=100: Rasch template-level pooling; dimension-level G-study begins.
  - N=1000: 2PL + DIF screening; full empirical calibration.
- **3-station design marginal for summative use — verdict:** *keep 3 stations, compensate with multiple BARS dimensions scored per station, and gate summative hire/no-hire on N≥100 per-dimension G≥0.70* (R3 [S8, S9]). Rationale: adding stations linearly degrades candidate time-budget and push-back risk; per-station dimensional expansion lifts composite reliability without lengthening the interview. Until the gate clears, composite label is "early estimate" and individual dimensional reads (not composite rank) drive the debrief.
- **Time-budget formula (R3 [S13]–[S15]):** 300 LOC/hour inspection rate is empirically well-grounded; file_count and bug_count coefficients are weak priors, calibrate in first 50 sessions.
- **Difficulty-band filter (R3 [S16]–[S20]):** ±1 seniority band is the defensible rule; derived from IRT information function (|b−θ|≤2 logits retains meaningful info; ≤1 logit retains ≥80% of max info).
- Mode-differentiated filter widths:
  - T-mode: {role−1, role}
  - V-mode: {role−2, role−1, role}
  - H-mode: {role−1, role, role+1} (symmetric ±1)

### 3.5 Cross-findings and contradictions (~300 words)
- Exercise effect ≡ familiarity confound at different levels of abstraction.
- Non-compensatory scoring precedent (OSCE yellow card): safety-critical dimensions can be non-compensatory.
- V-mode reduces disqualification validity — never auto-reject on V-mode fail.
- SJT experience confound partially contradicts clean T-mode story; role-tuned doesn't eliminate familiarity effect.

## 4. Design Track Findings (~1800 words)

### 4.1 Competitor scan summary (~400 words)
- 9 platforms evaluated (HireVue, Karat, Triplebyte, Codility, CoderPad, HackerRank, Qualified.io, Meta AI-coding, LinkedIn Skills).
- **Key finding: no competitor offers per-candidate repo-personalized multi-station match.**
- Incumbent personalization layers: within-test item adaptation (CAT), JD→template, candidate-choose-language.
- Qualified.io Projects is closest-in-surface; differs on match algorithm.
- **Flag for verifier:** confirm Qualified.io had not added per-candidate variation as of 2026-04-18.

### 4.2 Configuration locus recommendation (Q5)
- **Pattern A + D** (conversational elicitation + single chip + override).
- Role Discovery elicits philosophy + tolerance via one question during intake.
- Pipeline Setup shows chip: `Match: [philosophy · tolerance ✎]`.
- Rejected: dedicated wizard step (Pattern B — too much airtime); per-challenge config (Pattern C — surface trap).

### 4.3 Stage linkage recommendation (Q6)
- **Default: shared-repo.**
- Grounding: OSCE MS-OSCE 4–9% scenario variance is acceptable within single-repo multi-station (candidate builds context); no competitor precedent for per-stage-different-repo.
- Per-stage-different-repo deferred to v2.

### 4.4 Automation granularity recommendation (Q7)
- **Default: per-candidate auto-match.**
- Per-pipeline exposed as option for recruiters wanting identical-stimulus fairness framing.
- Per-stage rematch: deferred to v2.
- Recruiter-override: enterprise-tier (Karat-like).

### 4.5 Guardrails (Q8)
Cross-checked against R2 legal findings. Five BLOCK/WARN rules:

1. **BLOCK:** T-strict + uncommon-stack + auto-reject + no recruiter review → "Mobley-style agent-liability exposure; violates Colorado SB 24-205 reasonable-care standard (effective 2026-06-30)."
2. **WARN:** T-strict + auto-reject without human review → "Mobley agent-theory ruling (MTD denied July 2024) makes auto-reject litigable."
3. **WARN:** V-mode + sparse candidate profile → "V-mode scoring validity requires candidate profile signal; fallback to H-mode for sparse candidates."
4. **BLOCK:** per-stage linkage + per-pipeline automation → "contradictory config; can't rematch per stage if pipeline is fixed."
5. **BLOCK:** match philosophy = V + config allows auto-disqualify → "V-fail is claim-inflation signal, not disqualification signal; never auto-reject on V-fail (R1 [S19]–[S21] Kane IUA)."

### 4.6 Role-agent integration (required by plan acceptance criteria)
- Role Discovery adds one conversational turn after competency collection.
- Writes `match_philosophy` + `match_tolerance` to `role_contexts`.
- Agent prompts (3 phrasings) per UX design doc.
- Does not turn intake into settings form — conversational, not declarative.

### 4.7 Decision: config on role_contexts (default) + pipeline_match_config (override)
- Explicitly called out (plan open question resolution).
- Rationale: role_contexts holds the *recommended* default from Role Discovery; pipeline_match_config holds the *applied* config per pipeline (same role, different pipelines may differ).

## 5. Migration Plan (~600 words)

### 5.1 What ships in v1 (ADR-039 first implementation)
- `role_contexts` columns: `match_philosophy`, `match_tolerance`.
- `pipeline_match_config` table (schema in UX doc).
- Role Discovery prompt extension (1 new conversational turn).
- Pipeline Setup chip + modal.
- Pre-flight guardrail at Launch.
- Per-candidate auto-match using existing BGE-large embeddings against REPO_INDEX Vectorize.
- Candidate-side XAI disclosure (one sentence, variant per philosophy).

### 5.2 What ships in v2
- Per-stage-different-repo linkage.
- Per-stage automation (rematch at each station).
- Account-level match defaults.
- Recruiter-override enterprise feature.
- DIF analysis pipeline (requires N≥1000).

### 5.3 MVP config surface if we defer
- If v1 can't ship the full modal: ship chip as read-only showing default-from-RCD.
- If v1 can't ship guardrails: ship with WARN logging to audit table but no UI block.

### 5.4 Reliability gates
- N<100: scores labeled "early estimate," no summative hire/no-hire surface.
- N≥100 + G≥0.70 per dimension: enable summative composite.
- N≥1000 + DIF pass: enable confidence intervals and per-dimension normative anchors.

## 6. Three Concrete Next Artifacts (~400 words)

### 6.1 ADR-039 outline (next blocker to lift)
Title: **Bi-directional Vectorization + 3-Station Interview with Role-Fit-Primary / Candidate-Fit-Floor Match Philosophy**
Sections: context → decision → rationale → consequences → migration → alternatives-rejected.
Key decisions to codify:
- Match philosophy T/V/H semantics with R1-derived asymmetric reframing.
- 4 config axes schema.
- Calibration staging gate (N≥100).
- Guardrail block/warn rules.
- Candidate-side XAI text.
Estimated length: 1200–1500 words (medium ADR).

### 6.2 D1 schema (already sketched in UX doc; lock in ADR-039)
See `repo-personalized-interview-config-ux-design.md` — `pipeline_match_config` + `role_contexts` additions.

### 6.3 Wizard mock (chip + modal)
See UX doc — production hi-fidelity mock to be built in Figma during ADR-039 implementation.

## 7. Open Questions (~300 words)

1. **Within-template difficulty spread** — if repo varies substantially across template instances, Rasch pool estimate masks within-family variance. Template authoring guidelines must control this (ADR-034 follow-up).
2. **Qualified.io per-candidate variation** — verifier must confirm.
3. **Candidate pool composition** — PIPE has not yet run candidates through the pipeline in production. N=100 reliability gate timeline is unclear.
4. **ADR Review timing coefficients** — no empirical precedent for ADR review cognitive load.
5. **Demographic data collection** — PIPE doesn't collect race/gender at registration; NYC LL 144 compliance requires either collection or third-party audit. Product-legal decision required.
6. **Fallback when Vectorize returns no match** — not answered by research; requires founder decision.
7. **β=0.32 correction** — update `role-discovery-guardrails.md` to remove unverified external citation.

## 8. Appendix: Source Reference
Pointers to:
- `repo-personalized-interview-config-research-philosophy.md` (25 sources, R1)
- `repo-personalized-interview-config-research-fairness.md` (25 sources, R2)
- `repo-personalized-interview-config-research-psychometrics.md` (20 sources, R3)
- `repo-personalized-interview-config-competitor-scan.md` (9 platforms)
- `repo-personalized-interview-config-ux-design.md` (wireframes + schema)

---

## Structural notes for synthesis
- Prose-led, not bulleted-led. Each claim cites its source.
- Inline cite format: "(R1 [S4])" for research-track, "(competitor scan §X)" for design-track.
- Where multiple sources converge, cite top 2 and footnote the rest.
- Contradictions and single-source claims explicitly flagged.
- Anticipated final length: 5500–6500 words before verifier.
