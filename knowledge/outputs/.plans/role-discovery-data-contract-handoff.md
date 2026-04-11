# Handoff — Role Discovery + Repo Understanding Data Contract research run

**Date:** 2026-04-10
**Plan file:** `knowledge/outputs/.plans/role-discovery-data-contract.md`
**Purpose:** Operational runbook for Steps 3–4 of the plan. Sequential launch (not parallel) due to context budget. Copy-paste-ready Agent-tool calls for each researcher.

**Status at handoff:**
- Plan file approved. `## Background for researchers` section landed + 11 self-contained sub-questions rewritten (`What this informs` / `Research question` / `HMW` / `Deliverable` / `Assigned to`).
- `knowledge/STRATEGY.md` carries goal statement, RD-1 through RD-24 finding rows, Current-drift rows, Decision Log entries dated 2026-04-10.
- `knowledge/INDEX.md` has a pointer under §2.6.
- ADR-036 scaffold captured in `/Users/hans/.claude/plans/streamed-squishing-waterfall.md`.

---

## Why sequential, not parallel

Context budget. The original plan assumed 4 parallel `researcher` subagents, but each returns a long evidence table with ≥2 sources per answer. Landing all four at once saturates the lead's context window and makes synthesis harder. Running sequentially lets us review each output between runs, update the plan's Decision Log if a researcher surfaces a scope change, and stop early if we hit a context wall.

## Launch sequence

| # | Researcher | Questions | Rationale | Output |
|---|---|---|---|---|
| 1 | R1 | Q1, Q8 | Defines the Role Context Document schema shape — every other researcher builds on it | `knowledge/outputs/role-discovery-data-contract-research-methodology.md` |
| 2 | R3 | Q6, Q7, Q11 | Q11 is the ADR's load-bearing architecture question; the Repo Understanding Contract cannot be written without it | `knowledge/outputs/role-discovery-data-contract-research-codereview.md` |
| 3 | R2 | Q2, Q4, Q5, Q9 | 4 questions — culture-layer + legal; informs consequences, not core architecture | `knowledge/outputs/role-discovery-data-contract-research-culture.md` |
| 4 | R4 | Q3, Q10 | Multi-stakeholder aggregation + validation methodology; cross-cutting, can land last | `knowledge/outputs/role-discovery-data-contract-research-validation.md` |

**If context runs out mid-run**, stop after R3. R1 + R3 together carry both halves of ADR-036 (Role Context Document schema + Repo Understanding Contract architecture). R2 and R4 inform consequences and can be deferred to a follow-up pass without blocking the ADR's core.

## Model per researcher

All four run on **Sonnet 4.6** via the `researcher` subagent. Justification: literature-review work is source-finding-heavy, not reasoning-heavy; Sonnet handles academic citation weight at ~20% the cost of Opus without material quality loss on this task class.

**Optional upgrade:** Run R3 on Opus 4.6 if you want maximum confidence on Q11's architectural recommendation. It is the single most load-bearing answer in the run. Do not upgrade R1/R2/R4 to Opus.

---

## Shared prompt elements (every researcher gets these, verbatim)

1. **Plan file pointer.** The plan is at `knowledge/outputs/.plans/role-discovery-data-contract.md`. Read it in full before searching.
2. **Background section is required reading.** The `## Background for researchers` section is shared context. Do not re-derive any claim it makes about PIPE's architecture, the IDEO interview, the Six Domains, laddering, CandidatePersona, the downstream consumers, or the crawler's current state. Treat it as ground truth.
3. **Acceptance criteria.** ≥2 independent sources per claim. Load-bearing questions (Q1, Q4, Q5, Q8, Q11) must evaluate ≥3 concrete alternatives with empirical data. No single-source claims on critical findings.
4. **Deliverable structure.** One H2 per sub-question. Under each: (a) question restated, (b) answer with inline `[R#-S#]` citations, (c) a "What this implies for the Role Context Document AND the Repo Understanding Contract" closing note, (d) contradictions between sources flagged explicitly. Numbered Sources list at the bottom of the file with full URL + access date + source type.
5. **Decision requirement.** Load-bearing questions must return a specific "I recommend X because Y" paragraph grounded in the evidence. The ADR cannot be written from a tradeoff menu.
6. **Honest gaps.** If a sub-question cannot be answered from available sources, say so in a `Known gaps` section at the bottom. Do not fabricate citations.

---

## Launch commands

Run these in order. Do not launch the next until the previous run's output file exists and passes the between-runs checklist below.

### Run 1 — R1 (Q1 + Q8) — Qualitative methodology & synthesis prompting

```
Agent({
  description: "R1 research — schema + synthesis prompting",
  subagent_type: "researcher",
  model: "sonnet",
  prompt: `You are R1 in the Role Discovery + Repo Understanding Data Contract research run. Your job is to answer Q1 and Q8 in the plan file.

Plan file: knowledge/outputs/.plans/role-discovery-data-contract.md — read it in full before searching.

Required reading: The "## Background for researchers" section in the plan file is shared context. Do not re-derive any claim it makes about PIPE's architecture, the IDEO design-thinking interview, the Six Domains, laddering via Means-End Chain Theory, CandidatePersona, or the downstream consumers. Treat it as ground truth.

Your sub-questions:
- Q1 — Role Context Document schema. Literature: grounded theory (Glaser & Strauss, Charmaz), thematic analysis (Braun & Clarke), interpretative phenomenological analysis (Smith), narrative analysis, qualitative-to-structured conventions in healthcare / UX / market research.
- Q8 — Synthesis prompting to preserve laddering chains. Literature: chain-of-density (Adams et al. 2023), schema-guided generation, constrained JSON decoding (Outlines, jsonformer, llguidance), multi-pass refinement, role-conditioned extraction.

Both questions are load-bearing. Read the full "What this informs / Research question / HMW / Deliverable" blocks for each in the plan file.

Acceptance criteria: ≥3 concrete alternatives per question with empirical data; ≥2 independent sources per claim; no single-source claims on critical findings; each answer ends with a "what this implies for the Role Context Document AND the Repo Understanding Contract" note; load-bearing questions return specific recommendations not tradeoff menus.

Output file: knowledge/outputs/role-discovery-data-contract-research-methodology.md

Output structure:
- H1: "R1 Research — Qualitative Methodology & Synthesis Prompting"
- H2 "Q1 — Role Context Document schema": question restated, answer with inline [R1-S#] citations, 3-alternatives evaluation, recommendation, RCD+RUC implications
- H2 "Q8 — Synthesis prompting to preserve laddering chains": same structure
- H2 "Contradictions"
- H2 "Known gaps"
- H2 "Sources" — numbered list, full URL + access date + source type

Citation format: [R1-S#] inline. Do not fabricate citations.`
})
```

### Run 2 — R3 (Q6 + Q7 + Q11) — Codebase signals + competitor pairing + 3rd AI pass architecture

```
Agent({
  description: "R3 research — codebase signals + 3rd AI pass architecture",
  subagent_type: "researcher",
  model: "sonnet",
  prompt: `You are R3 in the Role Discovery + Repo Understanding Data Contract research run. Your job is to answer Q6, Q7, and Q11 in the plan file.

Plan file: knowledge/outputs/.plans/role-discovery-data-contract.md — read it in full before searching.

Required reading: The "## Background for researchers" section is shared context. Do not re-derive claims about PIPE's crawler state (Pass 1 + Pass 2, zero LLM calls, repo_sample_prs metadata-only), matchRepos.ts SQL-only structure, or the qualified_repos / repo_skills / repo_constructs tables. Treat it as ground truth.

Your sub-questions:
- Q6 — Codebase-shape signals beyond skill keywords. Literature: MSR (Mining Software Repositories), ICSE empirical tracks, FSE, EMSE.
- Q7 — How competitors pair challenges to team context. Sources: Codility, HackerRank, Coderbyte, CodeSignal, Woven, TripleByte/Karat, GreenHouse Prelude — product docs, engineering blogs, whitepapers, HR Tech / UNLEASH / SIOP conference talks.
- Q11 — 3rd AI pass architecture (offline per-repo vs. runtime per-role). Literature: RepoBench, SWE-bench, CodeT5, RepoFusion, long-context retrieval benchmarks (offline side); rec-sys two-stage ranking, candidate generation + re-ranking, learning-to-rank over structured features, cold-start caching (runtime side).

Q11 is the single most load-bearing question in the entire run. ADR-036 Half 2 (Repo Understanding Contract) cannot be written without a specific offline-only / runtime-only / two-stage recommendation with a table-schema sketch. Read the full Q11 block in the plan file including the "PIPE state specific to this question" paragraph.

Acceptance criteria: ≥3 concrete alternatives per load-bearing question with empirical data; ≥2 independent sources per claim; Q11 must return a specific architectural recommendation, not a tradeoff menu; each answer ends with a "what this implies for the Role Context Document AND the Repo Understanding Contract" note.

Output file: knowledge/outputs/role-discovery-data-contract-research-codereview.md

Output structure:
- H1: "R3 Research — Codebase Signals, Competitor Pairing, 3rd AI Pass Architecture"
- H2 per sub-question: question restated, answer with inline [R3-S#] citations, alternatives evaluation, recommendation, RCD+RUC implications
- Q11 section must additionally include a proposed D1 table-schema sketch for whichever tables the recommendation requires (repo_engineering_signals, repo_role_alignment, or alternatives)
- H2 "Contradictions"
- H2 "Known gaps"
- H2 "Sources"

Citation format: [R3-S#]. Do not fabricate citations.`
})
```

### Run 3 — R2 (Q2 + Q4 + Q5 + Q9) — Culture platforms + BARS + probes + dealbreaker legal

```
Agent({
  description: "R2 research — culture platforms + BARS + probes + legal",
  subagent_type: "researcher",
  model: "sonnet",
  prompt: `You are R2 in the Role Discovery + Repo Understanding Data Contract research run. Your job is to answer Q2, Q4, Q5, and Q9 in the plan file. You have the heaviest load — four sub-questions spanning competitive intel, psychometrics, and legal research.

Plan file: knowledge/outputs/.plans/role-discovery-data-contract.md — read it in full before searching.

Required reading: The "## Background for researchers" section is shared context, including the culture interview agent state (ADR-029, 5-competency × 5-axis BARS scoring, universal rubric, focus-dimensions hook unwired) and the dealbreakers/redFlags fields that exist in CandidatePersona today but reach no downstream consumer. Treat it as ground truth.

Your sub-questions:
- Q2 — Team-signal extraction taxonomy. Sources: HireVue, Plum, Culture Amp, Lattice, Harver, Pymetrics — product docs + academic validation studies (Cronbach's alpha, inter-rater reliability, κ).
- Q4 — Team-specific BARS anchor calibration. Literature: Smith & Kendall 1963 founding paper, Campion structured-interview meta-analyses, Hodges medical-education BARS, Landy performance-appraisal. Legal: Uniform Guidelines on Employee Selection Procedures, EU AI Act high-risk hiring provisions.
- Q5 — Team-specific probe generation vs. static bank. Literature: behavioral / structured interview research (Campion, Huffcutt, Arthur). Legal: EU AI Act audit-trail requirements, EEOC guidance on adverse impact.
- Q9 — Dealbreaker propagation as auto-fail or HITL gate. Legal: EEOC Title VII enforcement history, Griggs v. Duke Power (disparate impact), Uniform Guidelines four-fifths rule, EU AI Act Article 14 (human oversight), NYC Local Law 144 (AEDT audits), Illinois AI Video Interview Act, EEOC v. iTutorGroup 2023.

Q4 and Q9 are load-bearing. Legal defensibility claims and psychometric property claims must be triangulated — no single-source critical claims.

Acceptance criteria: ≥3 concrete alternatives per load-bearing question with empirical data; ≥2 independent sources per claim; zero single-source claims on legal defensibility or psychometric property claims in Q4/Q9; each answer ends with a "what this implies for the Role Context Document AND the Repo Understanding Contract" note; load-bearing questions return specific recommendations.

Output file: knowledge/outputs/role-discovery-data-contract-research-culture.md

Output structure:
- H1: "R2 Research — Culture Platforms, BARS Calibration, Probe Generation, Dealbreaker Legal"
- H2 per sub-question (Q2, Q4, Q5, Q9): question restated, answer with inline [R2-S#] citations, alternatives evaluation, recommendation, RCD+RUC implications
- H2 "Contradictions"
- H2 "Known gaps"
- H2 "Sources"

Citation format: [R2-S#]. Legal claims must be grounded in actual case law or regulatory text, not third-party summaries. Do not fabricate citations.`
})
```

### Run 4 — R4 (Q3 + Q10) — Multi-stakeholder aggregation + validation methodology

```
Agent({
  description: "R4 research — multi-stakeholder + validation",
  subagent_type: "researcher",
  model: "sonnet",
  prompt: `You are R4 in the Role Discovery + Repo Understanding Data Contract research run. Your job is to answer Q3 and Q10 in the plan file.

Plan file: knowledge/outputs/.plans/role-discovery-data-contract.md — read it in full before searching.

Required reading: The "## Background for researchers" section is shared context, including ADR-028 multi-stakeholder variants (HIRING_MANAGER, TEAM_MEMBER, INTERNAL_RECRUITER, EXTERNAL_RECRUITER), the current synthesis behavior of averaging across stakeholders, and PIPE's current baseline (universal BARS rubric + skill-keyword SQL join). Treat it as ground truth.

Your sub-questions:
- Q3 — Multi-stakeholder aggregation. Literature: 360-degree feedback meta-analyses (Smither, London, Conway, Atwater), Delphi method, consensus-building protocols in medical guideline development (RAND/UCLA appropriateness method).
- Q10 — Validation methodology for role-tailored assessment at low-to-moderate hiring volumes (<500 candidates/quarter). Literature: Shadish / Cook / Campbell quasi-experimental designs, criterion validity studies with small-sample challenges, construct validity bootstrapping, synthetic validation, validity generalization, transportability analysis.

Acceptance criteria: ≥2 independent sources per claim; Q3 must address both "when to preserve disagreements" and "when to aggregate" with weighting schemes from the literature; Q10 must produce a validation protocol sketch that includes sample-size estimates and defines what counts as "credible evidence" at <500 candidates/quarter; each answer ends with a "what this implies for the Role Context Document AND the Repo Understanding Contract" note.

Output file: knowledge/outputs/role-discovery-data-contract-research-validation.md

Output structure:
- H1: "R4 Research — Multi-Stakeholder Aggregation & Validation Methodology"
- H2 per sub-question: question restated, answer with inline [R4-S#] citations, recommendation, RCD+RUC implications
- H2 "Contradictions"
- H2 "Known gaps"
- H2 "Sources"

Citation format: [R4-S#]. Meta-analysis results must report the effect sizes or confidence intervals the original source published. Do not fabricate citations.`
})
```

---

## Between-runs checklist

After each run returns, before launching the next:

1. Output file exists at the declared path.
2. Sources list is populated — numbered, with real URLs + access dates.
3. Load-bearing questions end with a specific "I recommend X because Y" paragraph, not a tradeoff menu.
4. Each answer closes with a "what this implies for the Role Context Document AND the Repo Understanding Contract" note.
5. `Known gaps` section exists — even if empty, the researcher should explicitly say "no gaps".
6. Spot-check 2–3 URLs per file for fabrication (WebFetch or curl HEAD).

If any check fails: feed the researcher a targeted follow-up naming the specific deficiency, re-verify. If fundamentally broken, log in the plan file's Decision Log and re-launch with an amended prompt.

If clean: mark that researcher's row `done` in the plan file task ledger, then proceed to the next run.

---

## After all four runs land — T5 through T8

Per the plan file task ledger:
- **T5 — Lead synthesizes draft** → `knowledge/outputs/.drafts/role-discovery-data-contract-draft.md`. Reads all four `-research-*.md` files, writes the unified brief with two halves (Role Context Document + Repo Understanding Contract). Cite as `[R#-S#]` throughout.
- **T6 — Verifier (citation + URL pass)** → `knowledge/outputs/role-discovery-data-contract-brief.md`. Every claim carries an inline citation; every URL resolves. Use the `verifier` subagent.
- **T7 — Reviewer (evidence integrity pass)** → `knowledge/outputs/role-discovery-data-contract-verification.md`. Flags single-source critical findings, logical gaps, confidence overstated relative to evidence strength. Use the `reviewer` subagent. Verdict: PASS / PASS WITH NOTES / FAIL.
- **T8 — Lead finalizes** → `knowledge/outputs/role-discovery-data-contract.md` + `role-discovery-data-contract.provenance.md`. Only proceed if T7 verdict is PASS or PASS WITH NOTES.

After T8: draft **ADR-036 — Role Discovery + Repo Understanding Data Contract** at `docs/decisions/ADR-036-role-discovery-data-contract.md` using the scaffold in `/Users/hans/.claude/plans/streamed-squishing-waterfall.md`. Every load-bearing claim must carry a `[R#-S#]` citation traceable back to the final brief's Sources table.

Update STRATEGY.md RD-* finding rows: Source column → point at the brief; Status column → NOT STARTED → IN PROGRESS once ADR-036 lands.

---

## Current status

- [x] Plan file approved (Background + 11 self-contained questions)
- [x] STRATEGY.md aligned (RD-1 through RD-24 + Decision Log entries)
- [x] INDEX.md pointer added
- [x] Handoff written (this file)
- [ ] **NEXT: Launch R1 (Run 1)** — awaiting go-ahead
- [ ] Launch R3 (Run 2)
- [ ] Launch R2 (Run 3)
- [ ] Launch R4 (Run 4)
- [ ] T5 — Synthesize draft
- [ ] T6 — Verifier pass
- [ ] T7 — Reviewer pass
- [ ] T8 — Finalize brief + provenance
- [ ] Draft ADR-036
