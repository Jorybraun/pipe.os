# Documented Contradictions

**Rule:** Before overriding any finding from `knowledge/plan/`, document the contradiction here. Get explicit user approval.

---

## Contradiction #1: RCD vs. persona_json consumption

**Finding:** The strategy says RCD is the source of truth and all consumers should read it.
**Current state:** `autoStageBuilder.ts`, `repoDiscovery/discover.ts`, cockpit routes still read `persona_json`.
**Risk:** Rich RCD signal is invisible to matching. Role-candidate cosine compares thin-to-thin.
**Resolution:** Phase 0.1 — migrate all consumers to RCD primary, `persona_json` fallback only.
**Status:** [NOT_STARTED] — tracked in `tasks.md`

---

## Contradiction #2: Vector signal slots exist but are unreachable

**Finding:** `VECTOR_WEIGHTS` preset defines `vector_role_repo`, `vector_role_cand`, `vector_cand_repo` at 0.05 each.
**Current state:** `orchestrate.ts` never passes these parameters. `match_feedback` table lacks columns.
**Risk:** Triangulation weights are hardcoded defaults, not tuned per match.
**Resolution:** Phase 0.2 — wire vector signal slots in orchestrator and schema.
**Status:** [NOT_STARTED] — tracked in `tasks.md`

---

## Contradiction #3: Dealbreakers are advisory-only

**Finding:** RCD captures dealbreakers with `job_relatedness_strength` (strong/moderate/weak).
**Current state:** Only `cultureScorer.ts` reads dealbreakers, and it raises `hitlReviewRequired: true` without auto-failing.
**Risk:** Candidates who violate must-have dealbreakers are still routed into assessments.
**Resolution:** Phase 0.4 + Phase 3.4 — enforce dealbreaker gates in matching layer.
**Status:** [NOT_STARTED] — tracked in `tasks.md`

---

## Contradiction #4: Pass 3 has 1000s of repos stuck at pass=2

**Finding:** Pass 3 auto-runs after Pass 2 with `skipVectorize=true`.
**Current state:** Human admin must manually approve each repo before it enters REPO_INDEX.
**Risk:** Matchable corpus is a fraction of gathered corpus.
**Resolution:** Phase 0.9 — auto-approve via confidence thresholds.
**Status:** [NOT_STARTED] — tracked in `tasks.md`

---

## Contradiction #5: UAR migration stalled at Phase 1

**Finding:** ADR-034 UAR has FSM, provider wrapper, eval gate, session stores, plugin registry.
**Current state:** Three plugins exist but `generateTurn` returns "Mock question #N". No real logic.
**Risk:** New runtime exists but no agents use it. Legacy agents still work.
**Resolution:** Phase 4.3–4.5 — build real plugins on UAR, migrate culture first.
**Status:** [NOT_STARTED] — tracked in `tasks.md`

---

## Contradiction #6: Skill aliases fail silently

**Finding:** `skill_aliases` lookup should normalize skill slugs.
**Current state:** If lookup fails, falls back to `.toLowerCase()`, so "Node.js" → "node.js" won't match "nodejs".
**Risk:** Zero matches when even one must-have skill fails normalization. Pipelines dead-end.
**Resolution:** Phase 0.8 — add unknown-slug alerting, stop silent fallback.
**Status:** [NOT_STARTED] — tracked in `tasks.md`

---

## Contradiction #7: Three embedding call sites bypass preprocessing

**Finding:** `preprocessForEmbedding` should normalize all embedding inputs.
**Current state:** `adminRepos.ts:698`, `adminRepos.ts:1136`, `discover.ts:414` bypass it.
**Risk:** Inconsistent preprocessing creates subtle vector-space drift.
**Resolution:** Phase 0.7 — normalize all call sites.
**Status:** [NOT_STARTED] — tracked in `tasks.md`

---

## Contradiction #8: Architect's scaffolded code has broken imports

**Finding:** `lib/roleDiscovery/evaluator.ts` and `evaluatorPrompt.ts` reference types not in `types.ts`.
**Current state:** `tsc --noEmit` fails. Route exists but is not registered in `index.ts`.
**Risk:** Dead code with broken imports blocks typecheck.
**Resolution:** Phase 0.5 — fix types or delete dead code.
**Status:** [NOT_STARTED] — tracked in `tasks.md`

---

## Contradiction #9: BARS overrides captured but not fully consumed

**Finding:** RCD captures team-specific BARS anchor text overrides.
**Current state:** Scorer reads `dispositional_weights` scalar (±50% weight shift) but not actual anchor text.
**Risk:** Team-specific calibration is partially applied.
**Resolution:** Phase 4.6 — full Sherlock rubric with BARS anchor consumption.
**Status:** [NOT_STARTED] — tracked in `tasks.md`

---

## Contradiction #10: `candidateSituationFit` not cached

**Finding:** Every ingestion pays full Gemma cost for same candidate-repo pair.
**Current state:** No deduplication or caching.
**Risk:** Redundant LLM calls waste tokens and money.
**Resolution:** Phase 0.10 — cache by `candidate_id + repo_id`.
**Status:** [NOT_STARTED] — tracked in `tasks.md`

---

## Contradiction #11: Staging shares production D1

**Finding:** Staging and test environments should be isolated.
**Current state:** D1, R2, Vectorize bindings commented out in `wrangler.jsonc` for staging.
**Risk:** Staging tests can corrupt production data.
**Resolution:** Unassigned — needs ops work, not in original strategy phases.
**Status:** [NOT_STARTED] — add to backlog or escalate

---

## Format for new contradictions

```
## Contradiction #N: <short name>
**Finding:** <what the strategy says>
**Current state:** <what the code actually does>
**Risk:** <consequence of the gap>
**Resolution:** <phase and task number>
**Status:** [NOT_STARTED] | [IN_PROGRESS] | [RESOLVED]
```
