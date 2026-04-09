# Culture Agent — Code Audit

**Date:** 2026-04-08
**Auditor:** Claude Opus 4.6 (1M context), session-driven
**Scope:** Full read of every culture-specific TypeScript module, prompts, routes, calibration harness, and migrations. ~3,938 lines of culture-specific code.
**Trigger:** Founder asked "read culture scorer, read every piece of code that was written. And tell me whats up" after yesterday's Exponent layer removal.

**Read completely during this audit:**

| File | Lines | Purpose |
|---|---:|---|
| `workers/api/src/lib/cultureAgent.ts` | 583 | FSM + per-turn LLM analysis loop |
| `workers/api/src/lib/cultureAgentPrompts.ts` | 248 | Per-turn system + user prompts for STAR detection |
| `workers/api/src/lib/cultureQuestionBank.ts` | 474 | Bank (15 curated post-cleanup) + scored selector |
| `workers/api/src/lib/cultureProbePatterns.ts` | 66 | 30-tag closed vocab + coercion helpers |
| `workers/api/src/lib/cultureRoleOverlay.ts` | 91 | senior-ic / manager / universal overlays |
| `workers/api/src/lib/cultureRoleResolution.ts` | 83 | Persona → seniority + overlay lookup |
| `workers/api/src/lib/cultureSeniorityNormalize.ts` | 35 | Free-text seniority → enum |
| `workers/api/src/lib/cultureScorer.ts` | 728 | 11-call scoring pipeline + dimension-level BARS rubrics |
| `workers/api/src/lib/cultureScorerPrompts.ts` | 411 | Competency / profile / synthesis system+user prompts |
| `workers/api/src/lib/cultureScorerCalibration.ts` | 256 | QWK harness |
| `workers/api/src/lib/__tests__/cultureScorerCalibration.fixtures.ts` | 441 | 10 hand-authored fixtures with ground-truth scores |
| `workers/api/src/routes/screening/culture.ts` | 963 | Recruiter + candidate routes + background scoring job |
| `workers/api/migrations/0014_culture_interview.sql` | 93 | Session + audit tables |
| `workers/api/migrations/0014b_culture_review_columns.sql` | 25 | HITL review columns |
| `workers/api/migrations/0015_culture_usage_tracking.sql` | ~30 | AI usage events table (header only) |

**Not fully read but grepped / header-checked:** frontend components, meteredProvider, createProvider, wrangler config, e2e specs.

---

## 0. Correction on prior-session claim

When I pushed to rip out the 1,015 Exponent questions yesterday, I justified it with: *"the selector unions 1015 Exponent with 15 curated, the selector picks any of 1030, but the scorer can't grade Exponent questions because they have no BARS rubric, so candidates get asked questions that produce null scores — live landmine."*

**That justification was wrong.** I based it on the header comment at `cultureQuestionBank.ts:8–11` which claims *"the scorer can load the full BARS rubric by ID"*. That comment is aspirational, not what the code does.

The actual scorer (`cultureScorer.ts:147–252` + `cultureScorerPrompts.ts:138–178`) is **dimension-level**, not question-level:

1. For each of 5 competencies, it uses a dimension-level BARS rubric hardcoded in `COMPETENCY_BARS_RUBRICS`. It does NOT look up by question ID.
2. It flattens the whole transcript to a `Q: ... / A: ...` list and hands it to Gemma with the dimension rubric + dimension-level L/M/H calibration.
3. Gemma scores the dimension based on whatever behavioral evidence is in the transcript, regardless of which question was asked.

**Consequence:** Exponent questions would have been scored fine. The scorer doesn't care what question was asked — it reads the answers. The cleanup is still defensible on narrower grounds (Haiku-tagged-from-titles-alone was low signal, the selector was over-engineered for MVP, 15 > 1030 is easier to reason about), but **"live landmine" was the wrong framing**.

The CHANGELOG entry for the Exponent removal should be amended to drop the "live landmine" language and replace it with the narrower justification.

---

## 1. How the system actually works (end-to-end)

```
1. Candidate opens GET /rpc/culture/session/:token/state
   → Returns consent payload (ADR-031 disclosures)
   → Writes audit event: consent_shown

2. Candidate hits POST /session/:token/consent
   → resolveCultureRoleContext walks assessments → role_contexts → persona_json
   → startCultureInterview picks first question via scored selector
   → Session transitions consent → in_progress
   → Audit: consent_given + interview_started

3. Each answer → POST /respond → advanceCultureInterview:
   a. Attach answer to pending turn
   b. ONE Gemma turn-analysis call (STAR slots + probe decision + running theme)
   c. Coerce running_theme_to_add via closed probe-pattern vocab
   d. If seed turn (not probe) and ≥3 STAR slots present with specificity ≥1:
      bump dimensionCoverage[primary-dimension-of-question]
   e. Decide: probe / next / terminate
   f. If next: scored selector picks from curated bank

4. On terminate: state → scoring, ctx.waitUntil(runScoringJob)
   Returns {done: true} to candidate immediately

5. runScoringJob (background via waitUntil):
   → Load session + orgBenchmark from challenges.server_config
   → scoreCultureInterview fires 11 Gemma calls:
     - 5 competency specialists in Promise.all (parallel)
     - 5 profile specialists in Promise.all (parallel, concurrent with competency)
     - 1 sequential synthesis with aggregated results
   → Every call: {score, evidence_quotes, confidence, reasoning}
   → Parse failures → fallback: score 3, confidence 0, reasoning "parse_failure"
   → Write score_report, state → complete
   → Audit: scoring_complete

6. Recruiter: GET /sessions/:id/report → full report + cost aggregation
   POST /sessions/:id/review → {decision: 'confirm'|'override'}
   → Writes review_decision, reviewed_at, reviewed_by
   → Audit: review_confirmed | review_overridden

7. Candidate: GET /session/:token/report
   → HITL gate: 403 until review_decision is set
   → Sanitized: strips evidence_quotes, reasoning, raw BARS
```

---

## 2. What's working — the real parts

- **Scoring architecture matches research brief §2.2.** Multi-agent criterion decomposition with L/M/H calibration, evidence-grounding requirement in the prompt, parallel call structure. Matches the Huynh et al. 2025 MMI multi-agent framework (QWK 0.62 on frontier models).
- **The agent loop is disciplined.** One LLM call per turn, everything else deterministic. STAR slot extraction is the only LLM-dependent logic during the interview. Termination is deterministic (hard cap 20, coverage-complete after min 5).
- **Compliance scaffolding is real.** `consent_at` enforcement at the route layer, append-only audit log (`culture_compliance_audit` table with 13 event types), `withCultureMetering` wrapper on every LLM call, HITL gate enforced before candidate can see report.
- **Cost tracking is real.** `culture_ai_usage_events` per-call ledger + `/cost-dashboard` endpoint with monthly aggregate + top-10 expensive sessions.
- **The QWK calibration harness is real and the math is correct.** 10 hand-authored fixtures with honest expert scores across LOW/MEDIUM/HIGH bands (plus two deliberately ambiguous borderline cases). Sequential scoring, proper weighted-kappa math with the standard confusion-matrix formulation.
- **Fallbacks are disciplined.** Every LLM call has try/catch → returns neutral midpoint + confidence 0 + `reasoning: 'parse_failure'`. Never throws. The synthesis agent and recruiter can tell a fallback apart from a real score by the confidence field.
- **Mock path works.** `provider === null` returns deterministic mid-point reports without hitting Workers AI.
- **Resume-agnostic scoring is enforced.** Transcript is rendered as flat Q+A only, no candidate profile, no name, no demographics. Matches CoMAI §2.3 design and ADR-031 §5.3.
- **BARS anchors themselves are craft quality.** Ownership Level 5: *"Multiple-turn evidence of taking on unassigned responsibility at meaningful scope and risk. Personal actions are granular and causally linked to a quantified outcome. Explicit reflection on what they learned AND a downstream change they made to prevent recurrence or scale the solution. No passivity — active subject throughout."* Observable, specific, non-evaluative, gradient. Calibration examples are hand-written and plausible.

---

## 3. Dead code after yesterday's Exponent removal

Things that were alive with the Exponent layer and are now wasted cycles:

### 3.1 Theme-resonance bonus in `pickNextQuestion`

`pickNextQuestion` at `cultureQuestionBank.ts:457-458` computes:
```typescript
const themeBonus = probePatterns.some((p) => runningThemes.includes(p)) ? 0.3 : 0;
```

**None of the 15 curated questions set `probe_patterns`.** The agent still emits running themes per turn, still coerces them through the closed vocab, still stores up to 5 in the scratchpad. The selector still checks for intersection. The intersection is always empty. The bonus is always 0.

**Cost:** one `running_theme_to_add` field per turn in the agent's LLM output + scratchpad state + zero selection signal.

### 3.2 Role overlay `preferredTags` / `deprioritizedTags`

`cultureRoleOverlay.ts`:
- `senior-ic.preferredTags = ['technical-disagreement', 'cross-team-influence', 'mentorship-without-authority', 'deep-debugging', 'pattern-recognition']`
- `manager.preferredTags = ['direct-reports', 'performance-conversations', 'hiring-decisions', 'difficult-feedback', 'team-health', 'trade-off-decisions']`

**None of these appear in the 15 curated questions' `tags` fields.** Curated questions use `'unowned-work'`, `'initiative'`, `'mistake'`, `'incident-response'`, `'commitment'`, `'disagreement'`, `'decision-making'`, `'working-style'`, `'adaptation'`, `'feedback'`, `'blind-spot'`, etc.

`tagPreference` in the selector (lines 462–465) always returns 0 for curated questions under both overlays.

### 3.3 Net effect on the "scored selector"

After the cleanup the selector scoring collapses to:
```
score ≈ coverageGap * overlayWeight + barsBonus
```
with `themeBonus` and `tagPreference` always 0, and `barsBonus` always 0 because no curated question sets `bars_fitness`. Only the dimension-weight multipliers (senior-ic.ownership=1.2, manager.conflict-handling=1.4, etc.) still do meaningful work. The "role-aware scored graph selector" is degraded to **coverage-pressure-weighted by overlay dimension weights** with at most 15 candidates.

Not broken, but **the commit message for 5cec8ff oversells the remaining infrastructure**.

---

## 4. Decorative code — exists in the wiki, not loaded by runtime

### 4.1 The 15 per-question BARS rubrics in the wiki

Every file under `knowledge/culture/questions/{dim}/q-001..003.md` has a question-specific 5-level BARS rubric + question-specific L/M/H calibration examples + question-specific probe library.

**None of it reaches the runtime scorer.** The scorer uses the dimension-level `COMPETENCY_BARS_RUBRICS` in `cultureScorer.ts:147-252`. The TODO at lines 38–43 says:

> *"Phase C will introduce a wiki-sync script that reads `knowledge/culture/dimensions/*.md` and regenerates this file's rubric constants automatically. Until then, rubric changes must be made here and in the wiki by hand."*

This wiki-sync script has never been written. The Exponent sync script (`sync-culture-wiki.ts`, now deleted) was for the 1,015 stubs, not for the dimension rubrics. The rubrics currently in `cultureScorer.ts` are authored inline in TypeScript — they haven't been synced from either `knowledge/culture/dimensions/*.md` (which has different, more generic anchor text) or `knowledge/culture/questions/{dim}/q-*.md` (which has more specific question-level anchors).

**Also note:** the TODO for `CULTURE_PROFILE_BARS` at line 260 says *"Sync from `knowledge/culture/dimensions/profiles/*.md`"* — a path that **doesn't exist**. The real path is `knowledge/culture/culture-profile/*.md`. The TODO is wrong.

### 4.2 Two parallel rubric systems in the wiki

1. **Generic dimension-level** — `knowledge/culture/dimensions/{5 files}` — 5 files, 5-level generic descriptions per dimension, aligned with what the scorer needs.
2. **Per-question-level** — `knowledge/culture/questions/{dim}/q-{001,002,003}.md` — 15 files, question-specific 5-level descriptions, aligned with what the scorer *could* use if the scoring architecture were question-aware.

The scorer uses neither directly. It uses hardcoded TS const rubrics. Both wiki paths can drift from the TS silently.

---

## 5. ADR gaps — what the ADRs promise that the code doesn't deliver

### ADR-029 (Architecture)

- ⚠️ **§2 Wiki-sync for BARS rubrics.** Spec: *"A script parses the markdown and upserts into a D1 `culture_questions` table."* Reality: dimension rubrics live hardcoded in `cultureScorer.ts` with a stale TODO. No markdown → TS sync.
- ⚠️ **§6 Grounding requirement.** Spec: *"If you cannot ground the score in a verbatim quote, output null. Ungrounded scores fail validation and trigger a re-prompt with the score forced to null."* Reality: The prompt tells Gemma to do this. The parser (`parseCompetencyResponse` at line 420) accepts whatever comes back. **No re-prompt. No null coercion on empty evidence_quotes.** Soft prompt enforcement, zero code enforcement.
- ⚠️ **§Verification step 4 — QWK calibration run.** Harness exists, fixtures exist, endpoint exists. **Run has never been executed.** No recorded output. ADR says "require QWK ≥ 0.55 before shipping" — the gate has not been evaluated.
- ⚠️ **§Verification step 2 — 5 BDD Playwright specs (consent gate, linear flow, probe budget, coverage termination, recruiter report).** Not verified in this audit.
- ⚠️ **§2 `focusDimensions` recruiter override.** The config route accepts it, writes it to `challenge.server_config`. **Nothing downstream reads it.** The agent never sees `focusDimensions`. Dead spec.
- ⚠️ **Informational note gaps (from the 2026-04-08 header).** BC-6/BC-7 PBA belief state, BC-11 5-trigger probe generator, BC-15 belief-state delta evasion detector, BC-16 Reality Monitoring, BC-17 cognitive-load probes, BC-18 rolling compaction, BC-19 QWK target 0.60 vs ADR-029 0.55 — **none implemented.** Header calls these "minor" but there's no tracked work.

### ADR-030 (Culture Profile)

- ✅ 5 dimensions, recruiter benchmark, 5 specialist scoring calls, no aggregate score, "culture add" framing in synthesis prompt, non-goals enforced.
- ⚠️ **§3 "A position with no evidence grounding is coerced to `null` and flagged to the recruiter as 'insufficient signal'."** Same as ADR-029 §6 — prompt asks, parser doesn't enforce, ungrounded positions ship.

### ADR-031 (Compliance) — ★ this is where the real gaps are ★

**Built:**
- ✅ §1 Consent gate — state default `consent`, consent payload, `consent_at` write, audit
- ✅ §2 HITL gate — candidate report endpoint returns 403 until `review_decision` is set
- ✅ §4 Audit log with 13 event types
- ✅ Most of §5 obligations-to-code mapping
- ✅ Metering path + cost dashboard

**Missing or only partial:**

- ❌ **§2 Three-button review (Confirm / Override / Flag).** Only Confirm and Override are implemented. The route (`culture.ts:408`) explicitly only accepts `decision === 'confirm' | 'override'`. Migration 0014b comment confirms the schema is `'confirm' | 'override'`. The audit log CHECK constraint defines `review_flagged` but **no code path ever writes it**.
- ❌ **§2 Friction by design: `viewed_at` timestamp + intersection-observer scroll gate before Confirm.** Zero implementation. No `viewed_at` column in the session row. No scroll tracking. The Confirm button is one-click. ADR-031 explicitly says *"rubber-stamp confirmation does not satisfy Article 14"* — the rubber stamp is possible today.
- ❌ **§3 Deletion path.** Spec: `POST /rpc/culture/session/:token/request-deletion` (candidate) and `POST /api/v1/screening/culture/sessions/:sessionId/delete` (recruiter). **Neither route exists.** Grep returns no matches. The consent payload (line 110) returns `deletionLink: '/data-deletion'` as a static string pointing to a page that doesn't exist. The audit log has `deletion_requested` / `deletion_fulfilled` event types that never fire.
- ❌ **§1 Non-AI alternative path.** Same pattern: consent payload advertises `nonAiAlternativeLink: '/request-human-interview'` — points nowhere. Audit event `alternative_requested` never fires.
- ❌ **§1 Illinois 30-day deletion SLA.** No tracking, no monitoring, no cleanup. Not even possible to track because no deletion flow exists.
- ❌ **§1 DB-level consent trigger.** ADR says *"pre-write assertion in `cultureAgent.ts`, with a test that confirms a pre-consent turn write throws."* No such assertion in cultureAgent.ts — the consent gate is enforced only at the route layer (`if (session.state !== 'consent') return conflict`).
- ⚠️ **§2 "pending_review" state.** ADR describes the score staying pending_review indefinitely. Code has no `pending_review` state — the session is in `state='complete'` with a nullable `review_decision` column. Functionally equivalent, but dashboards that filter by `state` won't catch "scored but unreviewed" cleanly.

**Bottom line on ADR-031:** Consent, HITL, and audit work. Deletion path (one of the three core features) is entirely absent. "Flag for second opinion" is absent. The evidence-scroll gate is absent. The non-AI alternative is a dead link. **These are the compliance-critical gaps for Illinois HB 3773 (already in effect) and EU AI Act Article 14 (going live 2026-08-02).**

---

## 6. Subtle failure modes

### 6.1 Scoring is fire-and-forget with no retry

`POST /respond` on the terminating turn calls `c.executionCtx.waitUntil(runScoringJob(...))` and returns `{done: true}` immediately. If:
- Transient Gemma network failure → scoring aborts → state=error → no retry
- Worker cold-start timeout mid-scoring → scoring never completes → state=scoring forever
- The scorer has per-call try/catch → the job has try/catch on top-level → but there's no outer retry, no dead-letter queue, no cron to find stuck sessions

**Observability gap:** a recruiter would see "candidate completed interview" but the report never appears. No alerting.

### 6.2 Parse-failure sentinels look identical to legitimate mid-range scores

When Gemma returns malformed JSON or the call fails:
```typescript
function competencyFallback(dimension) {
  return { dimension, score: 3, evidenceQuotes: [], confidence: 0, reasoning: 'parse_failure' };
}
```

A real "this candidate is average" score and a "parse failed, defaulted" score differ only in `confidence: 0` and `reasoning: 'parse_failure'`. **If the recruiter UI doesn't surface confidence prominently, parse failures silently become 3/5s in the aggregate.** The synthesis call then averages these and produces a narrative around the fake midpoint. A single dimension's parse failure can flip the aggregate recommendation from HIRE to FLAG_FOR_REVIEW undetectably.

### 6.3 Synthesis has no guard against hallucinated evidence

The synthesis prompt says *"Do not invent evidence not supported by the transcript or the scorer outputs."* The synthesis receives `score + reasoning` from each specialist (not the `evidence_quotes`). The narrative's "evidence" could reference text that never appeared in the transcript. No code verifies paraphrase fidelity. Gemma is usually good enough, but there's no structural guarantee.

### 6.4 Empty evidence_quotes ship without retry

Already noted under ADR-029 §6 — the prompt requires non-empty, the parser accepts empty. A score with no evidence quotes violates the "defensibility floor" but ships anyway.

### 6.5 Per-turn agent call has no retry either

`runTurnAnalysis` → one `provider.complete` call → on failure or empty, fall back to `mockTurnResponse` which is a naive heuristic (probe if answer < 200 chars, else advance). A real candidate whose Gemma call fails once gets a mock turn response and may be probed or advanced incorrectly. Logged via `console.warn`, not visible to the recruiter.

### 6.6 `review_flagged` is in the audit vocabulary but unreachable

The schema at `0014_culture_interview.sql:75` defines `review_flagged` as a valid event type. No code path writes it. Dead schema slot.

### 6.7 `deletion_requested` / `deletion_fulfilled` — same problem

Schema defines them, no code writes them, no route accepts them, consent payload links to pages that don't exist.

### 6.8 The Storage flow has one silent failure

`runScoringJob` loads orgBenchmark from `challenges.server_config`. If the benchmark is missing: logs an error, sets state to `error`, returns. **A recruiter who forgets to configure the benchmark gets a session stuck at error with no surfaced alert.** The cost-dashboard doesn't surface it. The session list would need a state=error filter.

---

## 7. Recommendations, ordered by urgency

### Urgent (before any paying customer in a covered jurisdiction)

1. **Run the calibration harness.** It exists. Run it against the 10 fixtures on Gemma 4 26B. Record the overall QWK. Until you do, everything downstream of the scorer is suspect and ADR-029 §Verification is an unverified claim. This is a 1-tool-call action.

2. **Implement the deletion path.** ADR-031 §3 mandates two routes — `POST /rpc/culture/session/:token/request-deletion` and `POST /api/v1/screening/culture/sessions/:sessionId/delete`. Compliance-critical for Illinois HB 3773 (already in effect). Need to:
   - Add candidate route that accepts a deletion request and logs `deletion_requested` event
   - Add recruiter route that hard-deletes the transcript, nulls `score_report`, anonymizes `candidate_id`, logs `deletion_fulfilled`
   - Retain `consent_at`, audit log rows, usage events for billing/audit
   - Remove the dead `deletionLink: '/data-deletion'` string from the consent payload or wire it to a real page

3. **Implement the non-AI alternative path.** Same urgency. Consent payload currently lies by advertising a link to nothing. Either wire it to a recruiter notification + audit event, or remove the advertised link.

4. **Implement the HITL friction (viewed_at + scroll gate).** ADR-031 §2 explicitly required it, code doesn't have it. EU AI Act goes live 2026-08-02. One-click Confirm is exactly the rubber-stamp failure mode Article 14 forbids. Options:
   - Add `viewed_at TEXT` column to `culture_interview_sessions`
   - Require it be non-null before Confirm is accepted
   - Frontend: track intersection observer on the evidence-quotes section + POST a "viewed" ping before enabling Confirm

5. **Add dead-man-switch for stuck scoring sessions.** Simple cron: find sessions where `state='scoring' AND updated_at < 5 minutes ago` and mark them `state='error'`. Optional: retry queue.

### Load-bearing but not compliance-critical

6. **Harden the `evidence_quotes MUST NOT be empty` contract at the parser layer.** Either retry on empty, or coerce `score → null` with `confidence: 0`. The current "prompt asks, parser accepts" is not the defensibility floor ADR-029 promises.

7. **Surface `parse_failure` sentinel in the recruiter UI.** A score with `confidence: 0` and `reasoning: 'parse_failure'` should be visually distinct from a genuine mid-range score. Otherwise silent bias into the synthesis aggregate.

8. **Implement the `review_flagged` decision** (the third ADR-031 button) OR remove it from the audit log schema. Either do it or stop promising it.

9. **Run the calibration after any change to `COMPETENCY_BARS_RUBRICS` or `cultureScorerPrompts.ts`.** There's no drift detection. A rubric text tweak can invalidate the 10 fixtures' expert-scored ground truth silently.

### Cleanups that are safe to do now

10. **Retag the 15 curated questions to match `preferredTags` in the overlays** OR **strip the dead tag fields from the overlay data.** Right now the tag preference is theater.

11. **Add `probe_patterns` to the 15 curated questions** OR **strip the running-themes plumbing** (agent output field, scratchpad state, selector bonus). Same pattern.

12. **Remove the `focusDimensions` spec until it's wired.** It accepts and persists input nothing reads.

13. **Fix the wiki README's claim that per-question rubrics are "the source of truth."** They're not — `COMPETENCY_BARS_RUBRICS` in TypeScript is. Either document that honestly or refactor the scorer to actually load them.

14. **Update or remove the stale TODO comments** in `cultureScorer.ts:38–43` and `260` that promise a wiki-sync script for dimension rubrics. The only sync script that existed was for Exponent and has been deleted.

15. **Record the Exponent-removal decision in STRATEGY.md's Decision Log** with the corrected rationale (not "live landmine").

### Bigger questions to decide

16. **Decide whether the per-question wiki rubrics have a future.** If yes, implement them properly (scorer loads question-specific rubric, falls back to dimension-level). If no, delete them from the markdown and shrink the wiki.

17. **Decide whether per-turn belief state (BC-6/BC-7 PBA judge) is on the roadmap.** Both "yes" and "no" are defensible. The informational note in ADR-029's header treats it as "minor" — nothing is moving. Pretending it's about-to-ship when it isn't is the thing to avoid.

18. **Reconcile QWK 0.55 vs 0.60.** ADR-029 says 0.55. STRATEGY BC-19 says 0.60. Code uses 0.55 (both in `QWK_TARGET` const and the calibration response). Suggested resolution: 0.55 as the release floor, 0.60 as an aspirational target — but document it in STRATEGY.md decision log.

---

## 8. Summary

**The culture agent is more complete than the audit going in suggested.** The agent loop, scorer, calibration harness, route surface, compliance audit schema, and cost metering are all real, wired, and tested (26 passing tests in culture test files). BARS anchors are craft quality. QWK math is correct. The 10 calibration fixtures are real.

**What's genuinely missing:**

1. **Proof that Gemma 4 26B actually hits QWK ≥ 0.55 on the rubrics.** The harness exists. The run hasn't happened. Until it does, the whole scoring tier is built on an unverified assumption.

2. **Compliance ADR-031 features.** Deletion path, non-AI alternative, HITL friction (viewed_at + scroll gate), Flag review decision. All required by ADR-031, none implemented. Compliance-critical before shipping to Illinois or EU candidates.

3. **Dead-man switch for stuck scoring sessions.** Fire-and-forget with no retry leaves sessions stranded on any transient failure.

4. **The wiki-to-code sync story.** Dimension rubrics in TS are hand-authored and drifting from the wiki markdown. Per-question rubrics in the wiki are decorative. Either wire them up or stop pretending the wiki is the source of truth.

**What's under-promised:**

- The "scored role-aware graph selector" from commit `5cec8ff` is, post-cleanup, a coverage-pressure-weighted selector over 15 candidates with dimension-weight bias and nothing else firing. That's fine for MVP. Don't market it as sophisticated.

**What I got wrong yesterday:**

- The Exponent "live landmine" framing. Retracted above. The cleanup is still defensible on narrower grounds but I argued it on a false premise and should have read the scorer first. Audit trail: CHANGELOG entry needs amendment.

---

*End of audit. Generated 2026-04-08 from a full code read in a single session.*
