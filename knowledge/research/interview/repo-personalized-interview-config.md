# Repo-Personalized Interview: Matching Philosophy, Fairness Architecture, and Configuration UX

**Status:** Cited + URL-verified + reviewer-checked synthesis (PASS WITH NOTES). Blocker on ADR-039.
**Date:** 2026-04-18.
**Provenance:** `repo-personalized-interview-config.provenance.md` (alongside this file).
**Reviewer report:** `repo-personalized-interview-config-verification.md` (alongside this file).
**Authors:** Lead researcher + three sub-researcher streams (R1 philosophy, R2 fairness, R3 psychometrics).
**Source documents:**
- `repo-personalized-interview-config-research-philosophy.md` (R1, 25 sources)
- `repo-personalized-interview-config-research-fairness.md` (R2, 25 sources)
- `repo-personalized-interview-config-research-psychometrics.md` (R3, 20 sources)
- `.drafts/repo-personalized-interview-config-competitor-scan.md` (9 platforms)
- `.drafts/repo-personalized-interview-config-ux-design.md` (wireframes + D1 schema)

---

## 1. Executive Summary

The central design question — *how should PIPE match a repository-based multi-station code-review interview to a specific candidate* — does not collapse to a three-way switch between tailoring (T), validation (V), and hybrid (H). The research evidence forces an **asymmetric reframing**: role-fit is the primary validity anchor for scoring, and candidate-fit functions as a completion-rate floor that sits *underneath* role-fit. OSCE, multiple-mini-interview (MMI), assessment-center, and situational-judgment literature converge on role-derived station content as the only approach with a sustainable validity argument [S1]–[S11]. A nominally symmetric recruiter-facing UX is acceptable — recruiters legitimately care about validating stated experience — but the *measurement surface* must enforce the asymmetry or the scoring model's interpretive argument fails under Kane's (2013) Interpretation-Use Argument framework [S19].

Fairness is primarily a **distribution-of-difficulty problem**, not a selection-rate problem. Embedding-based matching operates on code-repository semantics that are demonstrably demographically correlated (Wilson & Caliskan 2024 found 85.1% White-associated name preference in LLM-based resume retrieval; [S32]). The UGESP 4/5ths rule must be reinterpreted to apply to *assigned difficulty tiers* stratified by demographic proxy, not just overall selection rates — a novel application of a 1978 rule to a 2026 architecture that no competitor currently monitors (R2 novel inference). Colorado SB 24-205 (effective 2026-02-01 per Colorado General Assembly; see Verifier Note §F for date-source history), Illinois HB 3773 (effective 2026-01-01), and EU AI Act Article 13 (effective 2026-08-02) form a hard compliance ceiling. Mobley v. Workday (MTD denied July 2024) established tool-developer co-liability under Title VII — PIPE sits directly in that liability chain [S29], [S31].

The three-station design is **marginal for summative hire/no-hire use**. D-study inferences from OSCE literature put a 3-station G-coefficient at 0.60–0.75, below the 0.80 preferred threshold and at the floor of the 0.70 minimum for consequential decisions [S46] OSCE G-theory reliability; [S47] OSCE G-theory validation. The verdict adopted here: keep three stations, compensate by scoring **multiple BARS dimensions per station** (not a flat per-station composite), and gate summative decisions on an **N≥100 calibration milestone with per-dimension G≥0.70**. Until that gate clears, the composite is labeled "early estimate" and dimensional reads drive recruiter debriefs.

Configuration UX should live in two places: **Role Discovery** elicits philosophy and tolerance conversationally during role intake and writes defaults into `role_contexts`; **Pipeline Setup** exposes a single chip (`Match: Hybrid · Moderate ✎`) that opens a modal for per-pipeline override, persisted in a new `pipeline_match_config` table. This keeps recruiter airtime minimal, preserves per-pipeline flexibility, and produces a clean audit trail for regulatory disclosure.

Three concrete follow-up artifacts are required before implementation begins: (a) ADR-039 codifying the above; (b) a D1 migration sketching `role_contexts` extensions and `pipeline_match_config`; (c) a candidate-side XAI text pass that stays inside the Gilliland/Hausknecht "disclose job-relatedness, not parameters" envelope while meeting Colorado/Illinois/EU disclosure minimums.

---

## 2. Context and Scope

STRATEGY.md (2026-04-18) committed PIPE to a criterion-referenced measurement framing with bi-directional vectorization across candidate background and repository content, and to a three-station OSCE-style interview trajectory. This brief is the research blocker on that commitment; without it, ADR-039 cannot be written, schema cannot be migrated, and the Role Discovery agent cannot start asking match-intent questions.

**In scope**: the four configuration axes (match philosophy × match tolerance × stage linkage × automation granularity), disqualification semantics per philosophy, pre-flight guardrails, the configuration UX locus, calibration staging under small N, and the candidate-side explainability surface.

**Out of scope**: ADR-034 challenge authoring template changes, culture interview agent architecture, code-review scoring rubric implementation (the BARS dimensions are referenced but not enumerated here), and the criterion-referenced vs. norm-referenced debate (closed in STRATEGY.md).

---

## 3. Research Track Findings

### 3.1 Philosophy: role-fit primary, candidate-fit floor

**Core claim.** The multi-station assessment literature is unambiguous: station content is role-derived, not candidate-derived. OSCE ([S1], [S2]), MMI ([S1]), assessment-center exercises ([S4], [S5]), and situational-judgment tests ([S9], [S10]) all map content to a job-analysis competency model, then sample across contexts to minimize construct-irrelevant variance. There is no peer-reviewed precedent for adapting station content to the individual candidate's prior experience.

**Exercise effect is the dominant variance component.** Lance (2008), extending Sackett & Dreher's (1982) foundational finding, established that in assessment centers, exercise-by-exercise variance swamps dimension-by-dimension variance — the "exercise effect" [S4]. Personalizing stations to candidate background *amplifies* this effect, because candidate-familiar stations and candidate-unfamiliar stations will not be comparable on any construct the scorer claims to measure. This is a direct threat to the validity argument for inter-candidate comparison.

**Codebase familiarity is a quantified confound.** Evaluations of LLM coding agents on software-engineering benchmarks produced **23 percentage-point absolute** score inflation on repositories the model had seen during training versus de-contaminated hold-out sets (Liang et al., SWE-Bench Illusion [S12]), and up to **~332% relative** score inflation at 100% contamination (Chen et al. 2025 [S14], 0.19 → 0.82 on HumanEval). (Correction per Reviewer: earlier draft framed both as "23–331 percentage-point" which conflated absolute and relative figures.) The mechanism is straightforward: familiarity substitutes recall for reasoning. Barnett and Ceci's (2002) near-transfer / far-transfer taxonomy generalizes this to human cognition: near-transfer (familiar context) *overestimates* far-transfer aptitude [S17]. The research team flagged explicitly that no direct peer-reviewed human software-engineering hiring study quantifies the confound at a specific effect size; the LLM evidence and the cognitive-psychology taxonomy establish direction, not magnitude.

**Purpose-conditional scoring is structurally required.** Kane's (2013) Interpretation-Use Argument framework and the AERA/APA/NCME Standards (2014) hold that validity is specific to the interpretation *and* the use [S19], [S21]. The same raw ability estimate θ implies different decisions under different purposes. This has a direct structural consequence for PIPE: the scoring model must produce a **two-dimensional scorecard**, not a flat composite:

- **Role-gap** — distance below the role's minimum proficiency threshold. Used for hire/no-hire.
- **Claim-gap** — distance below the candidate's stated proficiency from their profile. Used for reference-check and honesty signal.

Under T-mode (station content matched to role, not candidate), a failed station is diagnostic of role-unfit. Under V-mode (station content matched to candidate's claimed experience), a failed station is diagnostic of claim inflation — *not* role-unfit. Under H-mode, both readings are available and both dimensions of the scorecard are populated.

This is where the asymmetric reframing is forced. A symmetric T/V/H UI that produces a flat composite score will silently mix these interpretations. A candidate who fails a V-mode station will appear identical on the composite to one who fails a T-mode station, but the two signals have different meanings and different consequences. Kane's framework says this is incoherent: the validity argument for "hire/no-hire based on composite" cannot be sustained when the composite was produced by scoring under incompatible interpretations.

**The asymmetric reframe.** T-mode is the philosophical default because only T-mode supports a clean hire/no-hire validity argument. V-mode is *not* a co-equal alternative; it is a candidate-fit *floor* applied underneath T-mode to control completion rate and reduce construct-irrelevant variance from unfamiliar syntax and unfamiliar tooling. H-mode is the operational default: enforce the role-fit threshold first (stations must come from the role-relevant competency model), then apply the candidate-fit floor as a secondary constraint (prefer stations where the candidate's profile shows ±1 band familiarity, to keep completion rate above the Swineford 80% power-test threshold).

**OSCE yellow-card precedent for non-compensatory failure.** OSCE summative scoring allows certain station failures — typically safety-critical — to be non-compensatory: a candidate who fails a yellow-card station cannot be rescued by strong performance elsewhere [S2]. This precedent transfers directly: PIPE's scoring rubric should permit per-dimension non-compensatory rules for role-critical skills in T-mode, but should never apply non-compensatory rules to V-mode stations, because the V-mode failure is a signal about claim honesty, not role capability.

### 3.2 Fairness: distribution-of-difficulty, not pass-rates

**Legal exposure is high and the clock is running.** The Griggs v. Duke Power (1971) disparate-impact doctrine applies to any selection procedure that produces different outcomes across protected classes, regardless of intent [S26]. The EEOC's May 2023 Technical Assistance document on "Assessing Adverse Impact in Software, Algorithms, and AI Used in Employment Selection Procedures" [S29] explicitly brings ML-driven assessment under this framework. Mobley v. Workday, Inc. (N.D. Cal., motion to dismiss denied July 2024) extended the theory to *tool developers*: Workday's AI-driven candidate screening tool was held to be an agent of the employer under Title VII, creating direct co-liability [S30], [S31]. PIPE, as the developer of the matching algorithm and scoring panel, sits in the same liability chain.

**Near-term regulatory ceiling dates:**

- **NYC Local Law 144** — live since July 2023. Annual bias audit and candidate notice requirements apply to automated employment decision tools [S36].
- **Illinois HB 3773** — effective 2026-01-01. Employer notification requirement when AI is used in hiring [S38].
- **Colorado SB 24-205** — effective 2026-02-01 per the Colorado General Assembly bill page retrieved 2026-04-18 (R2 research file cited 2026-06-30; Verifier Note §F flags the discrepancy — compliance window is ~5 months earlier than originally researched). Reasonable-care standard for developers and deployers of high-risk AI systems, including consequential decisions in employment. PIPE is a *developer* under this statute [S35].
- **EU AI Act Article 13** — effective 2026-08-02. Transparency obligations for high-risk AI systems, including employment-related systems. Extraterritorial reach to any system used in the EU [S37].

**Wilson & Caliskan 2024 generalizes to code-repo embeddings by analogy.** Wilson and Caliskan found that LLM-based resume retrieval preferred White-associated names over Black-associated names 85.1% of the time, with White male names preferred in 100% of White/Black male pairwise tests [S32]. (This paper was misattributed to "Kotek et al." in the R2 research file and the pre-verifier draft; corrected here per Verifier Note §E.) This finding was produced on name tokens, not repository content, so the direct evidence is name-level. The generalization to code-repository embeddings is an *analogical inference*: if general-purpose embeddings encode demographic associations at the token level, there is strong prior reason to suspect that code-repository embeddings (built on similar base models like BGE-large) encode latent demographic signal via correlates — school affiliation in commit signatures, time-zone patterns, language frequency distributions, tooling choices correlated with workplace demographics. The research team flagged that no direct study of code-repository-embedding bias in hiring has been published. This is a known gap and a research priority.

**Novel architectural contribution — UGESP 4/5ths applied to difficulty-tier distributions.** The UGESP 4/5ths rule (selection rate for any protected group must be at least 4/5ths of the rate for the highest-selected group) was written in 1978 for pass/fail selection procedures [S27]. Applying it unchanged to personalization produces a blind spot: two groups can have identical selection rates but systematically different *difficulty of the assessment they faced*. This is single-source inference (no precedent in the literature), flagged explicitly. The architectural recommendation is to stratify difficulty-tier assignment by demographic proxy where available and apply the 4/5ths rule to the distribution of *assigned tiers*, not just pass rates. If protected-class candidates are systematically assigned higher-difficulty stations (because embedding similarity pushes them toward less-familiar repos), that is a disparate-impact signal even if pass rates look equal.

**Five-layer monitoring architecture (R2 Q4d).** The proposed runtime monitoring stack:

1. **Pre-deployment embedding audit** using WEAT (Word Embedding Association Test) or its code-repo analogue, run against a held-out demographic probe set before any model rollout.
2. **Runtime distribution monitoring** — track difficulty-tier assignment distributions by demographic proxy (where lawfully collected), alert on >10% disparity.
3. **Equalized-odds monitoring** on stratified pass rates — standard fairness metric, applied per demographic group and per station type.
4. **Audit trail** — persist per-candidate match decisions (philosophy, tolerance, selected repo, tier) for regulatory access under NYC LL 144 and Colorado SB 24-205.
5. **Re-audit on model updates** — any change to the BGE-large embedding version, the scoring rubric, or the role-context prompt triggers a full audit rerun before deployment.

**β = 0.32 figure correction.** The file `knowledge/outputs/role-discovery-guardrails.md` cites a β = 0.32 deceptive-explanation effect size attributed to Altay & Acerbi (2025). The research team was unable to verify this figure against a primary source in the Altay & Acerbi 2025 paper's accessible excerpts (R2 explicit note). This is flagged as a **required pre-publication correction**: the citation must be removed or replaced with a verified source before any external reference to this figure.

### 3.3 Transparency: disclose class, not parameters

**Organizational justice literature steers toward class-level disclosure.** Gilliland's (1993) organizational-justice framework and Hausknecht's (2004) meta-analysis converge on one finding: *job-relatedness perception* is the single strongest predictor of candidate procedural-justice ratings, and explanations of procedure rather than of parameters produce the largest improvement [S39], [S40]. Candidates do not need to know the embedding distance; they need to know *that the challenge was matched to the role*.

**Fok & Weld 2023 warns against over-explanation.** Fok and Weld (2023) found that wrong explanations paired with correct AI recommendations cause humans to *reject* the correct recommendations — a failure mode they call "explanation over-reliance" [S42]. Applied here: if PIPE exposes a candidate-facing text like "your challenge was selected because your top technology is Python and the role requires Python at senior level, which aligns with repo X at difficulty tier 3," any wrongness in any clause will propagate rejection of the correct underlying decision. The safer surface is class-level.

**Recommended candidate-facing text (one-sentence variants):**

- **Hybrid (default):** "Your coding challenge was selected to match the technologies and problem types relevant to this role based on your background."
- **Tailored (T-strict):** "Your coding challenge reflects the technical stack this role requires."
- **Validate (V-mode):** "Your coding challenge gives you a chance to demonstrate the skills you listed in your profile on a realistic problem."

No difficulty tier disclosed. No embedding distance disclosed. No stack-specific rationale disclosed. Legal-minimum disclosures (AI-used notification under Illinois HB 3773, Colorado SB 24-205 reasonable-care documentation, EU AI Act Article 13 transparency) are handled as separate surfaces — a footer link to a "how this works" page, not inline text.

### 3.4 Psychometrics: template-level calibration, N-staged

**N-staged calibration plan.** Licensure-grade assessments defer empirical calibration until sufficient response data exists, and use expert anchoring in the interim. NCLEX, USMLE, and CPA all follow this pattern [S43], [S44], [S45]. Rasch calibration standard error is approximately 2/√N [S46a]; at N=100, the 95% confidence interval on item difficulty is ±0.5 logits, which is sufficient for rank-ordering but not for precise comparison. Proposed PIPE staging:

- **N < 10**: expert estimation only. Scores are directional, labeled "early estimate."
- **10 ≤ N < 100**: expert estimation continues; begin collecting structured response data for future calibration.
- **100 ≤ N < 1000**: Rasch 1PL pooling across template-family instances (Automatic Item Generation approach, [S49], [S50], [S51]). Per-dimension G-study begins.
- **N ≥ 1000**: 2PL fitting with discrimination parameters; Differential Item Functioning screening across demographic groups.

**3-station summative verdict.** D-study inferences from OSCE literature put a 3-station G-coefficient in the 0.60–0.75 range — marginal for high-stakes use against the conventional G ≥ 0.80 target and at the floor of the G ≥ 0.70 minimum for consequential decisions [S46] OSCE G-theory reliability; [S47] OSCE G-theory validation. The research verdict adopted here: **keep three stations, compensate with multiple BARS dimensions per station, and gate summative hire/no-hire on N ≥ 100 with per-dimension G ≥ 0.70.** Rationale: adding stations linearly degrades candidate time-budget and push-back risk; per-station dimensional expansion lifts composite reliability without lengthening the interview. Until the gate clears, the composite is labeled "early estimate" and individual dimensional reads (not composite rank) drive the recruiter debrief. This matches OSCE's own evolution — early formative use before multi-year accumulation of response data unlocked summative use.

**Time-budget formula.** The empirical inspection rate from SmartBear and Cisco code-review studies is 300 LOC/hour [S52] SmartBear/Cisco case study. Proposed formula:

```
reading_minutes = reading_chars / 750
diff_minutes = diff_loc / 5
file_minutes = file_count × 1.5
bug_minutes = bug_count × 3.0
raw_minutes = reading_minutes + diff_minutes + file_minutes + bug_minutes
time_minutes = raw_minutes × unfamiliarity_factor × 1.25
```

Floor: 15 minutes. Ceiling: 90 minutes. The `reading_chars / 750` term and the `diff_loc / 5` term are grounded in SmartBear's 300 LOC/hour inspection rate (5 LOC/minute). The file-count and bug-count coefficients are engineering priors — reasonable but not empirically validated for this assessment format. The 1.25 buffer is defensive. First 50 sessions will provide calibration data against actual completion time.

**Difficulty-band filter.** IRT item information function concentrates around |b−θ| ≤ 1 logit, with 80% of maximum information retained [S54]. Filter rule:

```
T-mode: allowed = {role.band − 1, role.band}
V-mode: allowed = {role.band − 2, role.band − 1, role.band}
H-mode: allowed = {role.band − 1, role.band, role.band + 1}
```

Band-to-logit spacing of 1 logit per band is an engineering convention, medium confidence, and must be validated against observed θ distributions once N ≥ 100. The asymmetric allowance in V-mode reflects the asymmetric scoring interpretation: V-mode is probing claim-gap, so showing the candidate a slightly easier station is informative; showing a candidate an above-role-band station under V-mode produces no usable signal.

### 3.5 Cross-findings and contradictions

**Exercise effect and codebase familiarity are the same phenomenon at different levels of abstraction.** Lance's "exercise effect" in AC literature and the SWE-Bench contamination finding both describe the same underlying problem: station content drives performance independently of construct ability. The implication is that *any* multi-station assessment needs to sample across stations to average out this variance — and that personalizing stations to the candidate's experience amplifies rather than damps it.

**SJT experience confound partially contradicts clean T-mode story.** Research on situational-judgment tests has found that more-experienced respondents score higher on SJTs even after controlling for ability [S9], [S17]. T-mode is not immune to a familiarity effect — candidates with more exposure to the role's technical stack will score better on a role-tuned SJT than equally-able candidates with less exposure, even without the role being explicitly tailored to them. This is why the reframe is H-mode-as-default (role-fit primary + candidate-fit floor), not pure T-mode.

**V-mode failure is not a disqualification signal.** The non-compensatory OSCE yellow-card precedent transfers only to T-mode role-critical stations. A V-mode failure is a signal about claim honesty or claim inflation, not role capability. Auto-rejecting on V-mode failure would be a category error with direct validity and fairness consequences, and is codified as a guardrail BLOCK in §4.5.

---

## 4. Design Track Findings

### 4.1 Competitor scan summary

Nine platforms were evaluated for match-personalization patterns: HireVue, Karat, Triplebyte, Codility, CoderPad, HackerRank, Qualified.io, Meta's AI coding interview work, and LinkedIn Skills Assessments. **The headline finding: no competitor offers per-candidate repo-personalized multi-station matching.**

Personalization layers that *are* in market:

- **Within-test item adaptation (CAT)** — HackerRank and Codility adjust question difficulty in real time during a single-assessment session.
- **JD→template matching** — Karat and HireVue match pre-built question templates to job-description keywords at the pipeline level, not the candidate level.
- **Candidate-choose-language** — Codility, CoderPad, and HackerRank let the candidate pick their preferred programming language at the start of a challenge.

**Qualified.io Projects** is the closest-surface competitor (realistic code scenarios in browser-based IDE with a running test suite), but to our current knowledge does not vary challenges per candidate; same repo is shown to all candidates for a given role. *This claim requires verifier confirmation* — it is load-bearing in the differentiation story (see §7 Open Questions).

PIPE's repo-personalized multi-station design is, if Qualified.io confirmation holds, unprecedented in the market. That is an opportunity and a risk: no competitor has solved the fairness and validity problems this design surfaces, and no competitor has operational data to borrow from.

### 4.2 Configuration locus recommendation

Four UI patterns were evaluated (see competitor scan §competitor-ui-patterns): (A) conversational elicitation, (B) dedicated wizard step, (C) per-challenge config, (D) single-chip summary with modal override. Pattern B uses too much recruiter airtime for a decision most recruiters won't revisit. Pattern C surfaces the detail at the wrong level — per-challenge config turns every pipeline into a configuration exercise and invites accidental drift. The recommendation is **A + D combined**: Role Discovery conversationally elicits default philosophy and tolerance once per role, and Pipeline Setup shows a single chip that opens a modal for per-pipeline override.

```
┌─────────────────────────────────────────┐
│ Match: Hybrid · Moderate           ✎   │
└─────────────────────────────────────────┘
```

Modal content: philosophy radio group (tailored / hybrid / validate), tolerance radio group (strict / moderate / lenient), stage linkage dropdown (shared repo / per-stage repo), automation dropdown (per-candidate / per-pipeline), and optional guardrail overrides (advanced collapsible section).

### 4.3 Stage linkage recommendation

**Default: shared repo across all stations in a single interview.** Grounding: OSCE multi-station scenario variance studies find 4–9% variance attributable to scenario within a single-theme multi-station block [S46], [S47] — acceptable for a candidate who builds context within a single repo. Per-stage-different-repo introduces unnecessary context-switching cost and has no precedent in multi-station assessment literature. Deferred to v2 as an enterprise option for recruiters who specifically want cross-repo breadth sampling.

### 4.4 Automation granularity recommendation

**Default: per-candidate auto-match.** This is the flow that produces the differentiation: each candidate gets a repo matched to their background at intake. Per-pipeline (same repo for all candidates in a pipeline) is exposed as an option for recruiters who want identical-stimulus fairness framing — useful for compliance-sensitive organizations that want to simplify their audit story. Per-stage rematch (candidate gets a different repo at each of the three stations) is deferred to v2. Recruiter-override (manual match approval before candidate start) is deferred to enterprise-tier, mirroring Karat's workflow.

### 4.5 Guardrails

Five pre-flight BLOCK/WARN rules, cross-checked against R2 legal findings:

1. **BLOCK** — T-strict + uncommon-stack + auto-reject + no recruiter review. *Rationale:* "Mobley-style agent-liability exposure; violates Colorado SB 24-205 reasonable-care standard (effective 2026-02-01 per Colorado General Assembly)." The combination of strict tailoring on an uncommon stack with automated rejection and no human-in-the-loop review is the exact fact pattern in active litigation.
2. **WARN** — T-strict + auto-reject without human review (weaker fact pattern than rule 1). *Rationale:* "Mobley agent-theory ruling (MTD denied July 2024) makes auto-reject litigable even where no single rule on its own triggers a hard block." Logged to audit, not blocked.
3. **WARN** — V-mode + sparse candidate profile. *Rationale:* "V-mode scoring validity requires candidate profile signal; fallback to H-mode for sparse candidates." Surfaced at pipeline launch, not silent.
4. **BLOCK** — per-stage linkage + per-pipeline automation. *Rationale:* "Contradictory config; can't rematch per stage if the pipeline fixes the repo." Internal coherence check.
5. **BLOCK** — match philosophy = V + config allows auto-disqualify. *Rationale:* "V-fail is a claim-inflation signal, not a disqualification signal; never auto-reject on V-fail [S19]–[S21], Kane IUA." Direct application of the asymmetric-reframe principle to the config surface.

### 4.6 Role-agent integration

Plan acceptance criteria require the recommendation to integrate with the Role Discovery agent. The recommended integration: after the existing competency-collection turn, insert one additional conversational turn that elicits match intent. Agent prompt phrasings (three variants to test):

- *"For this role, do you want candidates assessed on what the role needs, what they say they know, or a mix of both?"*
- *"When someone hasn't used a specific technology before but has transferable skills, should the challenge still test that technology strictly, or adapt to their background?"*
- *"Is it more important that the challenge matches the role's technical requirements, or that it gives the candidate a fair chance to demonstrate their actual experience?"*

The agent writes `match_philosophy` and `match_tolerance` to the `role_contexts` row as recommended defaults. It does *not* turn Role Discovery into a settings form — the elicitation is one conversational exchange, recorded as agent inference, with the recruiter able to override at Pipeline Setup. This is the pattern the Role Discovery agent already uses for competency collection.

### 4.7 Decision: dual-home schema (role_contexts + pipeline_match_config)

The plan flagged as an open question whether match configuration lives on `role_contexts` (role-level) or on the pipeline. The decision codified here: **both**, with clear semantics.

- `role_contexts` gets two new columns: `match_philosophy` and `match_tolerance`. These are the **recommended defaults** inferred by Role Discovery from recruiter intent. They represent the role's stance on matching and are reused across any pipeline for that role.
- A new `pipeline_match_config` table holds the **applied configuration** per pipeline. Columns: `pipeline_id`, `match_philosophy`, `match_tolerance`, `stage_linkage`, `automation_mode`, `overridden_from_role_context` (boolean), `guardrail_overrides_json`, standard timestamps.

When a recruiter creates a new pipeline, `pipeline_match_config` is initialized from the `role_contexts` defaults. If the recruiter opens the modal and changes anything, `overridden_from_role_context` flips to 1. This gives the audit trail a clean answer to "what was configured, was it an override, and what was the role-level default?"

Schema sketch (locked in UX doc):

```sql
CREATE TABLE pipeline_match_config (
  pipeline_id INTEGER PRIMARY KEY,
  match_philosophy TEXT NOT NULL CHECK (match_philosophy IN ('tailored','hybrid','validate')),
  match_tolerance TEXT NOT NULL CHECK (match_tolerance IN ('strict','moderate','lenient')),
  stage_linkage TEXT NOT NULL DEFAULT 'shared_repo',
  automation_mode TEXT NOT NULL DEFAULT 'per_candidate',
  overridden_from_role_context INTEGER DEFAULT 0,
  guardrail_overrides_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (pipeline_id) REFERENCES pipelines(id)
);

ALTER TABLE role_contexts ADD COLUMN match_philosophy TEXT
  CHECK (match_philosophy IN ('tailored','hybrid','validate'));
ALTER TABLE role_contexts ADD COLUMN match_tolerance TEXT
  CHECK (match_tolerance IN ('strict','moderate','lenient'));
```

---

## 5. Migration Plan

### 5.1 What ships in v1 (ADR-039 first implementation)

- **Schema:** `role_contexts.match_philosophy`, `role_contexts.match_tolerance`, and the new `pipeline_match_config` table (migration written alongside ADR-039).
- **Role Discovery:** extend the existing agent prompt with one additional conversational turn for match intent; persist to `role_contexts`.
- **Pipeline Setup:** single chip with modal override; writes to `pipeline_match_config`.
- **Pre-flight guardrail:** five BLOCK/WARN rules from §4.5, enforced at pipeline launch.
- **Match engine:** per-candidate auto-match using existing BGE-large embeddings against REPO_INDEX Vectorize binding. Filter logic applies the per-mode difficulty-band allowance from §3.4.
- **Candidate-side XAI:** one-sentence variant per philosophy (§3.3); footer link to "how this works" page for legal-minimum disclosures.
- **Scoring label:** composite displayed with "early estimate" label until N ≥ 100 + per-dimension G ≥ 0.70 gate clears; dimensional reads are the primary debrief surface.

### 5.2 What ships in v2

- Per-stage-different-repo linkage as an enterprise option.
- Per-stage automation (rematch at each station) for long-running interviews.
- Account-level match defaults that seed new roles.
- Recruiter-override enterprise feature (manual approval before candidate start).
- DIF analysis pipeline (requires N ≥ 1000 response data).

### 5.3 MVP config surface if we defer

If v1 cannot ship the full modal: ship the chip as read-only showing the role-context default. If v1 cannot ship all five guardrails: ship the two BLOCK rules (1 and 4 and 5) and log the WARN rules to audit without a UI block. The Mobley-style exposure in rule 1 must ship in v1 — deferral of rule 1 re-opens direct legal exposure.

### 5.4 Reliability gates

- **N < 100**: composite labeled "early estimate." No summative hire/no-hire surface. Dimensional reads only.
- **N ≥ 100 + G ≥ 0.70 per dimension**: enable summative composite. Hire/no-hire surface unlocked.
- **N ≥ 1000 + DIF pass**: enable confidence intervals, per-dimension normative anchors, cross-role comparability.

The gates are not optional. They are part of the validity argument that supports the score's use for hire/no-hire decisions. Shipping summative scores before the gate clears is a direct validity failure and a disparate-impact liability risk (because the composite's reliability across demographic subgroups is unknown).

---

## 6. Three Concrete Next Artifacts

### 6.1 ADR-039 outline (next blocker to lift)

**Title:** *Bi-directional Vectorization + 3-Station Interview with Role-Fit-Primary / Candidate-Fit-Floor Match Philosophy*

**Sections:**
- **Context** — what STRATEGY.md 2026-04-18 committed to, what this brief resolves.
- **Decision** — the four config axes, the asymmetric reframe, the N ≥ 100 gate, the five guardrails.
- **Rationale** — cite this brief and the three research files.
- **Consequences** — implementation cost, operational cost, open risks (Qualified.io verification, embedding bias audit cost, demographic data collection decision).
- **Migration** — schema migration sketch, Role Discovery prompt extension, Pipeline Setup UI work, guardrail enforcement.
- **Alternatives rejected** — symmetric T/V/H UI, pure T-mode, pure V-mode, per-challenge config UI, dedicated wizard step.

Estimated length: 1200–1500 words (medium ADR). This is an explicit commitment required by the plan's acceptance criteria.

### 6.2 D1 migration (already sketched; lock in ADR-039 implementation)

See §4.7 and the UX design doc for the schema. The migration is small (one table, two columns, two check constraints) and carries no backfill obligation for existing roles — `role_contexts.match_philosophy` and `match_tolerance` start NULL and are populated by the Role Discovery agent on next role edit.

### 6.3 Wizard mock (chip + modal)

The wireframe in the UX design doc is the handoff artifact. Figma hi-fidelity production mock will be built during ADR-039 implementation. Modal shows: philosophy radio, tolerance radio, stage linkage dropdown, automation dropdown, advanced-options collapsible with guardrail overrides.

---

## 7. Open Questions

1. **Within-template difficulty spread.** If repos vary substantially across template instances, the Rasch pool estimate at N=100 may mask within-family variance. Template authoring guidelines must control this as part of ADR-034 follow-up work.
2. **Qualified.io per-candidate variation.** The differentiation claim ("no competitor offers per-candidate repo-personalized multi-station match") rests on this. Verifier must check Qualified.io's current marketing and docs for any contradicting evidence.
3. **Candidate pool composition and N ≥ 100 timeline.** PIPE has not yet run candidates through the pipeline in production. The N ≥ 100 reliability gate timeline depends on adoption and is a founder-business question, not a research question.
4. **ADR Review timing coefficients.** The `file_count × 1.5` and `bug_count × 3.0` coefficients in the time-budget formula are engineering priors without direct empirical basis in code-review assessment literature. First 50 sessions must produce calibration data.
5. **Demographic data collection.** PIPE does not currently collect candidate race or gender at registration. NYC LL 144 compliance requires either self-reported collection or a third-party audit. This is a product-legal decision that blocks the runtime distribution monitoring in §3.2.
6. **Fallback when Vectorize returns no adequate match.** What happens if a candidate's embedding produces no repo match above threshold? Research does not answer this; founder decision required (options: manual recruiter match, default-to-role-template, reject as unmatch-eligible).
7. **β = 0.32 citation correction.** The figure in `role-discovery-guardrails.md` attributed to Altay & Acerbi 2025 could not be verified. Correction required before any external citation. Tracked as a standalone file edit, not bundled into ADR-039.

8. **Gilliland 2003 field-study PMID.** Reviewer flagged that the three-point "fairness explanations must be timely / specific / reasonable" claim in §3.3 rests on PMID 12558210, which resolves to a different paper (Truxillo et al. 2002). Before ADR-039 cites this three-point list, either locate the correct Gilliland 2003 DOI/PMID or fall back to Gilliland (1993) plus Hausknecht (2004), both of which are verified.

9. **NCLEX 400-response threshold.** Reviewer flagged that the 400-response pretest threshold attributed to NCLEX is not on the public FAQ and derives from NCSBN technical documentation not publicly accessible. The Rasch SE formula and USMLE's verified 200-response precedent carry the N=100 gate on their own; the NCLEX 400 framing is illustrative rather than load-bearing.

---

## 8. Appendix: Source Reference

- `repo-personalized-interview-config-research-philosophy.md` — 25 sources, R1 stream, covers Q1 (philosophy precedent), Q2 (familiarity confound), Q4e (purpose-conditional scoring). Key sources: Sackett & Dreher 1982 (foundational exercise-effect); Lance 2008; Eva et al. 2004 MMI; SWE-rebench 2025; SWE-Bench Illusion 2025 (Liang et al.); Chen et al. 2025 (contamination review); Barnett & Ceci 2002; Kane 2013 IUA; AERA/APA/NCME Standards 2014; NCLEX Passing Standard documentation.
- `repo-personalized-interview-config-research-fairness.md` — 25 sources, R2 stream, covers Q3 (stack disparate impact), Q4 (transparency), Q4d (monitoring architecture). Key sources: Griggs v. Duke Power 1971; EEOC 2023 TA; Mobley v. Workday 2024 MTD ruling; Colorado SB 24-205; Illinois HB 3773; EU AI Act Article 13; NYC LL 144; Wilson & Caliskan 2024 (misattributed "Kotek et al." in R2 source file; corrected per Verifier Note §E); Gilliland 1993; Hausknecht 2004; Fok & Weld 2023.
- `repo-personalized-interview-config-research-psychometrics.md` — 20 sources, R3 stream, covers Q4a (calibration), Q4b (time-limit), Q4c (difficulty banding). Key sources: NCLEX / USMLE / CPA calibration practice; Rasch SE ≈ 2/√N; AIG literature (Gierl and colleagues); OSCE G-theory studies; SmartBear/Cisco 300 LOC/hour; Lord 1980 IRT information function.
- `.drafts/repo-personalized-interview-config-competitor-scan.md` — 9 platforms evaluated (HireVue, Karat, Triplebyte, Codility, CoderPad, HackerRank, Qualified.io, Meta, LinkedIn).
- `.drafts/repo-personalized-interview-config-ux-design.md` — chip + modal wireframe, D1 schema, XAI text variants.

---

## Sources

Source IDs are sequential across all three research streams (R1, R2, R3). Draft references to research-file internal source numbers (e.g., "R1 [S4]") have been resolved to this unified numbered list. Discrepancies between draft numbering and actual research-file source tables are documented in Verifier Notes.

**R1 — Philosophy Track**

[S1] Eva, K.W., Rosenfeld, J., Reiter, H.I., & Norman, G.R. (2004). An admissions OSCE: the multiple mini-interview. *Medical Education*, 38, 314–326. https://pubmed.ncbi.nlm.nih.gov/14996341/ [verified]

[S2] Gormley, G. (2011). Summative OSCEs in undergraduate medical education. *Ulster Medical Journal*, 80(3), 127–132. PMC3605523. https://pmc.ncbi.nlm.nih.gov/articles/PMC3605523/ [verified]

[S3] Onwudiegwu, U. (2018). OSCE: Design, Development and Deployment. *Journal of the West African College of Surgeons*, 8(1), 1–22. PMC6398515. https://pmc.ncbi.nlm.nih.gov/articles/PMC6398515/ [verified — NOTE: R1 attributes this URL to "Gormley et al."; actual author is Onwudiegwu; see Verifier Notes §A]

[S4] Lance, C.E. (2008). Where have we been, how did we get here, and where shall we go? *Industrial and Organizational Psychology*, 1(1), 14–17. https://www.cambridge.org/core/journals/industrial-and-organizational-psychology/article/abs/construct-validity-of-the-assessment-center-method-and-usefulness-of-dimensions-as-focal-constructs/6583678C137EDAA1AA6016E6D77A547B [verified — page is the Rupp, Thornton & Gibbons 2008 focal article in the same journal that cites and discusses Lance 2008; accepted as context locator]

[S5] Lievens, F., & Christiansen, N. (2010). Assessment center exercise factors represent cross-situational specificity, not method bias. *Human Performance*, 13(4), 363–381. https://www.tandfonline.com/doi/abs/10.1207/S15327043HUP1304_1 [dead link — 403]

[S6] Arthur, W., Woehr, D.J., & Maldegen, R. (2000). Convergent and discriminant validity of assessment center dimensions. *Journal of Management*, 26, 813–835. https://journals.sagepub.com/doi/abs/10.1177/014920630002600410 [dead link — 403]

[S7] Arthur, W., Jr., Day, E.A., McNelly, T.L., & Edens, P.S. (2003). A meta-analysis of the criterion-related validity of assessment center dimensions. *Personnel Psychology*, 56, 125–153. https://onlinelibrary.wiley.com/doi/abs/10.1111/j.1744-6570.2003.tb00146.x [dead link — 403]

[S8] Lievens, F., & Patterson, F. (2011). The validity and incremental validity of knowledge tests, low-fidelity simulations, and high-fidelity simulations. *Journal of Applied Psychology*, 96(5), 927–940. https://pubmed.ncbi.nlm.nih.gov/21480685/ [verified]

[S9] Campion, M.A., Ployhart, R.E., & MacKenzie, W.I., Jr. (2014). The state of research on situational judgment tests. *Industrial and Organizational Psychology*, 7, 59–98. https://www.cambridge.org/core/journals/industrial-and-organizational-psychology/article/situational-judgment-tests-from-measures-of-situational-judgment-to-measures-of-general-domain-knowledge/718BE0B998FE9FE2E91EF670879A4B82 [dead link — URL resolves to Lievens & Motowidlo 2015/2016, not Campion et al. 2014; see Verifier Notes §B]

[S10] Motowidlo, S.J., Hooper, A.C., & Jackson, H.L. (2006). Implicit policies about relations between personality traits and behavioral effectiveness in SJTs. *Journal of Applied Psychology*, 91, 749–761. (Cited via PMC7829683.) https://pmc.ncbi.nlm.nih.gov/articles/PMC7829683/ [verified — PMC7829683 is Wolcott et al. 2021 (pharmacy SJT study); Motowidlo 2006 is cited therein as a secondary reference]

[S11] Thornton, G.C., III, & Rupp, D.E. (2006). *Assessment Centers in Human Resource Management*. Lawrence Erlbaum Associates. https://books.google.com/books/about/Assessment_Centers_in_Human_Resource_Man.html?id=okt4AgAAQBAJ [verified — redirects to books.google.ca; Thornton & Rupp 2006 confirmed]

[S12] Liang, S., Garg, S., & Zilouchian Moghaddam, R. (2025). The SWE-Bench Illusion: When State-of-the-Art LLMs Remember Instead of Reason. arXiv:2506.12286. https://arxiv.org/abs/2506.12286 [verified]

[S13] Jimenez, C.E., et al. (2024). SWE-bench: Can Language Models Resolve Real-World GitHub Issues? ICLR 2024. arXiv:2310.06770. https://arxiv.org/abs/2310.06770 [verified — ICLR 2024 confirmed]

[S14] Chen et al. (2025). Benchmarking Large Language Models Under Data Contamination: A Survey. arXiv:2502.17521. https://arxiv.org/html/2502.17521v2 [verified — NOTE: the 331% figure framing is inaccurate; see Verifier Notes §C]

[S15] SWE-rebench Team (Nebius). SWE-rebench: An Automated Pipeline for Task Collection and Decontaminated Evaluation. arXiv:2505.20411 (NeurIPS 2025). https://arxiv.org/abs/2505.20411 [verified]

[S16] Barnett, S.M., & Ceci, S.J. (2002). When and where do we apply what we learn? A taxonomy for far transfer. *Psychological Bulletin*, 128(4), 612–637. https://pubmed.ncbi.nlm.nih.gov/12081085/ [verified]

[S17] Wolcott, M.D., Lobczowski, N.G., Zeeman, J.M., & McLaughlin, J.E. (2021). Role of knowledge and experience in SJT responses of pharmacists and pharmacy students. *American Journal of Pharmaceutical Education*, 85(1), article 8194. PMC7829683. https://pmc.ncbi.nlm.nih.gov/articles/PMC7829683/ [verified — NOTE: R1 source list attributes this to "Haines, S.T. et al."; actual authors are Wolcott et al.; see Verifier Notes §D]

[S18] Educational Testing Service. (2022). ETS Guidelines for Developing Fair Tests and Communications. https://www.ets.org/pdfs/about/fair-tests-and-communications.pdf [verified — PDF loads; binary-encoded but URL resolves]

[S19] Kane, M.T. (2013). Validating the interpretations and uses of test scores. *Journal of Educational Measurement*, 50(1), 1–73. https://onlinelibrary.wiley.com/doi/abs/10.1111/jedm.12000 [dead link — 403]

[S20] Messick, S. (1989). Validity. In R.L. Linn (Ed.), *Educational Measurement* (3rd ed., pp. 13–103). American Council on Education. https://psycnet.apa.org/record/1989-97348-002 [unverified — page returned loading indicator only; no content confirmed]

[S21] AERA, APA, & NCME. (2014). *Standards for Educational and Psychological Testing*. American Educational Research Association. https://www.aera.net/publications/books/standards-for-educational-psychological-testing-2014-edition [verified]

[S22] National Council of State Boards of Nursing. (2022). NCLEX Passing Standard. https://www.nclex.com/passing-standard.page [verified — RN: 0.00 logits; PN: −0.18 logits confirmed]

[S23] Luo, X., et al. (2018). Projection-Based Stopping Rules for CAT in Licensure Testing. *Applied Psychological Measurement*. PMC5978606. https://pmc.ncbi.nlm.nih.gov/articles/PMC5978606/ [verified]

[S24] Glaser, R. (1963). Instructional technology and the measurement of learning outcomes. *American Psychologist*, 18, 519–521. [no open-access URL available; not verified by WebFetch]

[S25] Assessment Systems. Norm-Referenced vs. Criterion-Referenced Testing. https://assess.com/norm-referenced-vs-criterion-referenced-testing/ [dead link — 403]

**R2 — Fairness Track**

[S26] Griggs v. Duke Power Co., 401 U.S. 424 (1971). https://www.law.cornell.edu/supremecourt/text/401/424 [verified]

[S27] Civil Rights Act of 1991, §703(k). 42 U.S.C. §2000e-2(k). https://www.eeoc.gov/statutes/title-vii-civil-rights-act-1964 [not separately fetched; URL is EEOC Title VII landing page]

[S28] Uniform Guidelines on Employee Selection Procedures (1978). 43 Fed. Reg. 38290. https://www.uniformguidelines.com/uniformguidelines.html [verified]

[S29] EEOC Technical Assistance on AI (2023). Select Issues: Assessing Adverse Impact in Software, Algorithms, and AI. https://data.aclum.org/storage/2025/01/EOCC_www_eeoc_gov_laws_guidance_select-issues-assessing-adverse-impact-software-algorithms-and-artificial.pdf [verified — PDF loads]

[S30] Mobley v. Workday, Inc., Docket 3:23-cv-00770 (N.D. Cal.). CRLC locator: https://clearinghouse.net/case/44074/ [dead link — 403; docket number remains the primary identifier]

[S31] Law and the Workplace. AI Bias Lawsuit Against Workday Reaches Next Stage. 2025. https://www.lawandtheworkplace.com/2025/06/ai-bias-lawsuit-against-workday-reaches-next-stage-as-court-grants-conditional-certification-of-adea-claim/ [verified — MTD denied July 2024 confirmed; ADEA collective certified May 16, 2025 confirmed]

[S32] Kotek et al. (2024). Gender, Race, and Intersectional Bias in Resume Screening via Language Model Retrieval. arXiv:2407.20371. https://arxiv.org/abs/2407.20371 [verified — NOTE: actual authors are Wilson, K. & Caliskan, A.; first author is Kyra Wilson, not Kotek; the 85.1% figure is confirmed correct; see Verifier Notes §E]

[S33] Bolukbasi, T., et al. (2016). Man is to Computer Programmer as Woman is to Homemaker? Debiasing Word Embeddings. NeurIPS 2016, arXiv:1607.06520. https://arxiv.org/abs/1607.06520 [verified]

[S34] Caliskan, A., et al. (2017). Semantics derived automatically from language corpora contain human-like biases. *Science*, 356(6334), 183–186. https://www.science.org/doi/10.1126/science.aal4230 [dead link — 403 paywall]

[S35] Colorado SB 24-205 Consumer Protections for Artificial Intelligence. Colorado General Assembly, 2024. https://leg.colorado.gov/bills/sb24-205 [verified — see Verifier Notes §F for date discrepancy]

[S36] NYC Local Law 144 Final Regulations on AEDT. https://natlawreview.com/article/nyc-s-local-law-144-and-final-regulations-regulation-ai-driven-hiring-tools-united [verified — effective July 5, 2023 confirmed]

[S37] EU Artificial Intelligence Act, Article 13. https://artificialintelligenceact.eu/article/13/ [verified — effective August 2, 2026 confirmed]

[S38] Illinois HB 3773. https://www.workforcebulletin.com/illinois-prohibits-discriminatory-artificial-intelligence-in-employment-decisions [verified — effective January 1, 2026 confirmed]

[S39] Gilliland, S.W. (1993). The perceived fairness of selection systems. *Academy of Management Review*, 18(4), 694–734. https://journals.aom.org/doi/abs/10.5465/amr.1993.9402210155 [dead link — 403]

[S40] Hausknecht, J.P., et al. (2004). Applicant reactions to selection procedures. *Personnel Psychology*, 57(3), 639–683. https://onlinelibrary.wiley.com/doi/abs/10.1111/j.1744-6570.2004.00003.x [dead link — 403]

[S41] Gilliland, S.W., et al. (2003). Selection fairness information and applicant reactions. *Journal of Applied Psychology*, 88(3), 540–553. https://pubmed.ncbi.nlm.nih.gov/12558210/ [dead link — page loads as Truxillo et al. 2002, not Gilliland 2003; see Verifier Notes §G]

[S42] Fok, R., & Weld, D.S. (2023). In Search of Verifiability: Explanations Rarely Enable Complementary Performance in AI-Advised Decision Making. arXiv:2305.07722. https://arxiv.org/abs/2305.07722 [verified]

[S43-R2] Tam, Z.R., et al. (2024). Let Me Speak Freely? A Study on the Impact of Format Restrictions on LLM Performance. EMNLP 2024. https://aclanthology.org/2024.emnlp-industry.91/ [verified]

[S44-R2] Hardt, M., Price, E., & Srebro, N. (2016). Equality of Opportunity in Supervised Learning. NeurIPS 2016, arXiv:1610.02413. https://arxiv.org/abs/1610.02413 [verified]

[S45-R2] Dwork, C., et al. (2012). Fairness Through Awareness. ITCS 2012, arXiv:1104.3913. https://arxiv.org/abs/1104.3913 [verified]

[S45a] Pleiss, G., et al. (2017). On Fairness and Calibration. NeurIPS 2017, arXiv:1709.02012. https://arxiv.org/abs/1709.02012 [verified]

[S45b] MIT Technology Review (2021). Auditors are testing hiring algorithms for bias. https://www.technologyreview.com/2021/02/11/1017955/auditors-testing-ai-hiring-algorithms-bias-big-questions-remain/ [verified — Pymetrics audit confirmed]

[S45c] Panickssery, N., et al. (2024). LLM Evaluators Recognize and Favor Their Own Generations. arXiv:2404.13076. https://arxiv.org/abs/2404.13076 [verified — NOTE: NeurIPS 2024 venue not confirmed on arXiv page; listed as preprint]

[S45d] EEOC. (2007). Employment Tests and Selection Procedures. https://www.eeoc.gov/laws/guidance/employment-tests-and-selection-procedures [verified]

[S45e] Martins-Costa, F., et al. (2025). Reflection on Code Contributor Demographics in the Rust Community. arXiv:2503.22066. https://arxiv.org/abs/2503.22066 [verified]

**R3 — Psychometrics Track**

[S43] NCSBN / NCLEX FAQ and Pretest Calibration Documentation (2023–2024). https://www.nclex.com/faqs.page [verified — NOTE: the public FAQ page does not explicitly describe the 400-response pretest threshold; the calibration claim may derive from NCSBN technical documentation not publicly accessible]

[S44] Swanson, D.B., Holtzman, K.Z., & Johnson, D.A. (2009). Developing Test Content for the USMLE. *Journal of Medical Regulation*, 95(2), 22. https://www.jmronline.org/content/95/2/22 [verified]

[S45] AICPA CPA Exam Blueprints (2022–2024). https://www.aicpa-cima.com/news/article/aicpa-unveils-blueprints-for-redesigned-cpa-exam [verified]

[S46a] Rasch Measurement Transactions Vol. 7 No. 4 (1994). Sample Size and Item Calibration Stability. https://www.rasch.org/rmt/rmt74m.htm [verified — 2/sqrt(N) formula and N=100 ±0.5 logit confirmed]

[S46] Trejo-Mejía, J.A., et al. (2016). Reliability analysis of the OSCE using generalizability theory. *Medical Education Online*, 21:31650. PMC4991996. https://pmc.ncbi.nlm.nih.gov/articles/PMC4991996/ [verified — NOTE: R3 and the draft attribute this URL to "Rezigalla et al."; actual authors are Trejo-Mejía et al. (UNAM); see Verifier Notes §H]

[S47] Peeters, M.J., et al. (2021). Validation Evidence using Generalizability Theory for an OSCE. *Innovations in Pharmacy*. PMC8102968. https://pmc.ncbi.nlm.nih.gov/articles/PMC8102968/ [verified — G=0.72 at 14 stations; 7 stations/week → G>0.80 confirmed]

[S48] Cintron, D.W., et al. (2021). Methods for Measuring Speededness. *ETS Research Report Series*. https://onlinelibrary.wiley.com/doi/full/10.1002/ets2.12337 [dead link — 403]

[S48a] UK Ofqual (2025). Time limits and speed of working in assessments. https://www.gov.uk/government/publications/time-limits-and-speed-of-working-in-assessments/time-limits-and-speed-of-working-in-assessments-when-and-to-what-extent-should-speed-of-working-be-part-of-what-is-assessed [verified]

[S49] Gierl, M.J., Lai, H., & Turner, S. (2012). Using automatic item generation to create multiple-choice test items. *Medical Education*. https://mcc.ca/wp-content/uploads/AIG-Gierl-Lai-Turner-Medical-Education-Journal.pdf [dead link — PDF binary unreadable; citation confirmed via secondary sources]

[S50] Alowais et al. (2022). Feasibility assurance: a review of AIG in medical assessment. *BMC Medical Education*. https://pmc.ncbi.nlm.nih.gov/articles/PMC8886703/ [dead link — page loads as Falcão et al. 2022 in a different journal; see Verifier Notes §I]

[S51] Tian, C., & Choi, J. (2023). Item Model Parameter Variations in CAT With Automatically Generated Items. *Applied Psychological Measurement*. https://journals.sagepub.com/doi/10.1177/01466216231165313 [dead link — 403]

[S52] SmartBear / Cisco Systems (2009). Code Review at Cisco Systems. Industry empirical study. https://static0.smartbear.co/support/media/resources/cc/book/code-review-cisco-case-study.pdf [verified — PDF loads; binary-encoded]

[S53] Sadowski, C., et al. (2018). Modern Code Review: A Case Study at Google. *ICSE 2018*. https://storage.googleapis.com/gweb-research2023-media/pubtools/4476.pdf [verified — PDF loads; binary-encoded]

[S53a] Rigby, P.C., & Bird, C. (2013). Convergent contemporary software peer review practices. *ESEC/FSE 2013*, ACM. https://dl.acm.org/doi/10.1145/2491411.2491444 [dead link — 403]

[S54] Lord, F.M. (1980). Applications of Item Response Theory to Practical Testing Problems. Lawrence Erlbaum Associates. (Tutorial derivation confirmed at: https://www.thetaminusb.com/intro-measurement-r/irt.html) [not separately verified — tutorial URL; IRT formula is foundational textbook content]

[S55] Han, K.T. (2018). Components of the item selection algorithm in CAT. *Journal of Educational Evaluation for Health Professions*, 15:7. PMC5968224. https://pmc.ncbi.nlm.nih.gov/articles/PMC5968224/ [verified]

[S56] Linacre, J.M. (2006). CAT stopping rules. *Rasch Measurement Transactions*, 20:2. https://www.rasch.org/rmt/rmt202f.htm [verified]

[S57] Hambleton, R.K., & Swaminathan, H. (1985). Item Response Theory: Principles and Applications. Kluwer Academic. https://link.springer.com/chapter/10.1007/978-94-009-2195-5_1 [dead link — 303 redirect only]

[S58] Yang, F.M., & Kao, S.T. (2014). Item response theory for measurement validity. *Shanghai Archives of Psychiatry*, 26(3), 171–177. PMC4118016. https://pmc.ncbi.nlm.nih.gov/articles/PMC4118016/ [verified]

[S59] Van der Linden, W.J. (2009). Predictive control of speededness in adaptive testing. *Applied Psychological Measurement*, 33, 25–41. https://journals.sagepub.com/doi/10.1177/0146621607314042 [dead link — 403]

---

## Verifier Notes

### A. PMC6398515 — author mismatch

R1 [S3] lists the URL https://pmc.ncbi.nlm.nih.gov/articles/PMC6398515/ under "Gormley et al. (2018). OSCE: Design, Development and Deployment. Postgraduate Medical Journal." WebFetch confirms this URL resolves to **Onwudiegwu, U. (2018)**, "OSCE: Design, Development and Deployment," published in the *Journal of the West African College of Surgeons*. The author and journal are different from those claimed. The substantive content (OSCE design principles) is consistent with the draft's claims, but the attribution must be corrected in the R1 source file and in the Appendix source reference above.

### B. Cambridge Core URL (R1 S9) — wrong paper

The URL provided for Campion, Ployhart & MacKenzie (2014) resolves to a Lievens & Motowidlo (2015/2016) article in the same journal. A correct URL for Campion et al. 2014 must be located.

### C. 331% contamination figure — framing imprecise

R1 [S14] (Chen et al. 2025, arXiv:2502.17521) is cited for a "331 percentage-point score inflation" claim. WebFetch of the paper found no "331%" value stated. The paper shows an increase from 0.19 to 0.82 on HumanEval at 100% contamination for Llama-3.2-1B, which is approximately a 332% *relative* increase — not a 331 percentage-point increase (that would be 19% → 350%, which is not claimed). The direction of effect is fully supported; the specific figure and its framing in R1 require precision correction.

### D. PMC7829683 — author mismatch in R1 source list

R1 source list [S17] reads "Haines, S.T., et al. (2021)." WebFetch confirms the actual authors at PMC7829683 are **Wolcott, M.D., Lobczowski, N.G., Zeeman, J.M., & McLaughlin, J.E. (2021)**. The paper's content (pharmacy SJT, pharmacist vs. student knowledge references) matches the draft's claims. Attribution in R1 must be corrected.

### E. Kotek et al. 2024 — author misattribution (load-bearing)

The paper cited throughout the draft and R2 as "Kotek et al. 2024" is **Wilson, K., & Caliskan, A. (2024)**, "Gender, Race, and Intersectional Bias in Resume Screening via Language Model Retrieval," arXiv:2407.20371. The first author is **Kyra Wilson**, not Kotek. The 85.1% preference for White-associated names figure is confirmed correct. The claim about White male names being preferred in 100% of White/Black male pairwise tests is confirmed. Every reference to "Kotek et al." in this document, in R2, and in the draft must be corrected to "Wilson & Caliskan 2024." This misattribution exists in the research source (R2) and was reproduced in the draft; it must be corrected before external citation.

### F. Colorado SB 24-205 effective date — date discrepancy (load-bearing)

The draft and R2 research file state the effective date of Colorado SB 24-205 as "2026-06-30." WebFetch of the Colorado General Assembly statute page (leg.colorado.gov/bills/sb24-205) confirmed the compliance date is **February 1, 2026**, not June 30, 2026. The draft body has been left with the original "2026-06-30" wording; the lead must decide whether to correct this, and must correct the R2 research file accordingly. This affects the urgency framing in §4.5 guardrail rule 1 and §5.3. The compliance deadline is approximately 5 months earlier than the draft states.

### G. PubMed 12558210 — wrong paper

R2 [S17] (Gilliland et al. 2003, Journal of Applied Psychology) uses PMID 12558210. WebFetch shows this PMID resolves to **Truxillo, D.M., et al. (2002)**, a different study on applicant perceptions during police recruitment. A correct PMID or DOI for the Gilliland 2003 longitudinal field study must be located.

### H. PMC4991996 — author mismatch

R3 [S8] attributes PMC4991996 to "Rezigalla, A.A. et al. (2016)." WebFetch confirms the actual authors are **Trejo-Mejía, J.A. et al.** from UNAM (Mexico). The article is a 2016 OSCE G-theory study consistent with the claims made in the draft (G=0.93 at 18 stations; student×station interaction dominant). The substantive claims appear supported by the actual article content; the attribution must be corrected in R3 and in ADR-039 when it cites this source.

### I. PMC8886703 — author and journal mismatch

R3 [S6] attributes PMC8886703 to "Alowais et al. (2022), BMC Medical Education." WebFetch confirms the article at that PMCID is **Falcão et al. (2022)** in *Advances in Health Sciences Education Theory and Practice* (not BMC Medical Education). The topic (AIG feasibility in medical assessment) is consistent with the draft's claims; attribution must be corrected in R3.

### J. Qualified.io per-candidate variation — unverifiable from public sources (load-bearing)

The draft's §4.1 claim that Qualified.io "does not vary challenges per candidate; same repo is shown to all candidates for a given role" was flagged for verifier confirmation and is load-bearing for the differentiation story. Verification attempts:
- https://www.qualified.io/product — **404**
- https://help.qualified.io/en/articles/4069700-project-challenges — **404**
- https://www.qualified.io/blog — loaded but contained no information about per-candidate vs. per-role variation
- https://www.qualified.io/assess — loaded but returned only minimal content

**Conclusion:** The Qualified.io claim cannot be confirmed or refuted from any publicly accessible source as of 2026-04-18. The differentiation story in §4.1 remains unverified. This requires a product trial, a direct conversation with Qualified.io, or access to non-public product documentation.

### K. Draft source-number mismatches (corrected in this document)

The draft used R1/R2/R3-internal source numbers that did not match the actual source tables in the research files. Key mismatches corrected in the body and Sources section above:

| Draft reference | Draft claim | Actual R-file source | Correct S-number (this doc) |
|---|---|---|---|
| R1 [S1]–[S11] | OSCE/MMI/AC/SJT claim | Matches R1 S1–S11 | [S1]–[S11] |
| R1 [S12] "SWE-rebench" | SWE-rebench 2025 | R1 S12 = SWE-Bench Illusion; SWE-rebench = R1 S15 | Swapped: [S12]=Illusion, [S15]=rebench |
| R1 [S13] "SWE-Bench Illusion" | Illusion 2025 | R1 S13 = Jimenez SWE-bench ICLR 2024 | [S13]=Jimenez |
| R1 [S17] "Barnett & Ceci" | Near/far transfer | R1 S17 = Wolcott et al.; Barnett & Ceci = R1 S16 | [S16]=Barnett & Ceci |
| R2 [S2] "EEOC 2023 TA" | EEOC Technical Assistance | R2 S2 = CRA 1991 §703(k); TA = R2 S4 | [S29]=EEOC TA |
| R2 [S3] "Mobley" | Mobley MTD | R2 S3 = UGESP; Mobley = R2 S5/S6 | [S30]/[S31]=Mobley |
| R2 [S4] "NYC LL 144" | NYC law | R2 S4 = EEOC TA; NYC = R2 S12 | [S36]=NYC |
| R2 [S5] "Illinois HB 3773" | Illinois law | R2 S5 = Mobley docket; Illinois = R2 S14 | [S38]=Illinois |
| R2 [S6] "Colorado SB 24-205" | Colorado law | R2 S6 = Mobley MTD blog; Colorado = R2 S11 | [S35]=Colorado |
| R2 [S7] "EU AI Act Art. 13" | EU law | R2 S7 = Rust demographics; EU = R2 S13 | [S37]=EU |

### L. "Lance et al. (2000)" — unsourced [unsourced — flagged for lead]

The draft §3.1 states "Lance et al. (2000) and Lance (2008) established…" R1 contains Lance 2008 (S4) but no Lance 2000 source. No Lance 2000 paper was found in the R1 source list. The "Lance et al. (2000)" attribution is unsourced in the research files. This may refer to a different paper (possibly Sackett & Dreher 1982 as the foundational exercise-effect source) or a misremembered date for Lance 2008. Requires correction before external citation.

### M. β = 0.32 Altay & Acerbi 2025 — unsourced [unsourced — flagged for lead]

Referenced in §3.2 and §7. Not found in any research source file. Cannot be verified against any published primary source. Must be removed or replaced with a verified citation before any external reference.

### Dead links summary

19 URLs returned 4xx errors or loaded the wrong content. All are documented in the Sources section above and summarized here:

| Source | URL | Status |
|---|---|---|
| S5 Lievens & Christiansen 2010 | tandfonline.com | 403 |
| S6 Arthur et al. 2000 | sagepub.com | 403 |
| S7 Arthur et al. 2003 | wiley.com | 403 |
| S9 Campion et al. 2014 URL | cambridge.org | loads wrong paper |
| S19 Kane 2013 | wiley.com | 403 |
| S20 Messick 1989 | psycnet.apa.org | loading only |
| S25 Assessment Systems | assess.com | 403 |
| S30 Mobley CRLC | clearinghouse.net | 403 |
| S34 Caliskan 2017 Science | science.org | 403 paywall |
| S39 Gilliland 1993 | aom.org | 403 |
| S40 Hausknecht 2004 | wiley.com | 403 |
| S41 Gilliland 2003 PubMed | pubmed.ncbi.nlm.nih.gov | loads wrong paper (Truxillo 2002) |
| S48 ETS speededness | wiley.com | 403 |
| S49 Gierl 2012 | mcc.ca | PDF binary unreadable |
| S50 Alowais 2022 | pmc.ncbi.nlm.nih.gov | loads wrong paper (Falcão et al.) |
| S51 Tian & Choi 2023 | sagepub.com | 403 |
| S53a Rigby & Bird 2013 | dl.acm.org | 403 |
| S57 Hambleton 1985 | springer.com | 303 redirect only |
| S59 van der Linden 2009 | sagepub.com | 403 |
| qualified.io/product | qualified.io | 404 |

---

**End of document.**
