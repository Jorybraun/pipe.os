# Culture Agent Audit — Brutal

**Owner:** Culture Agent Team  
**Status:** PENDING  
**Source strategy:** `culture-agent-redesign-master.md` §2.3  
**Blocked by:** None  
**Blocks:** `architecture/agent-flow-spec.md`, `implementation/mode-1-profile-builder.md`  

---

## 1. Problem Statement

This document is a line-by-line audit of every file in the culture interview pipeline. The goal is to identify what must be kept, what must be rewritten, and what must be deleted. No file is sacred.

## 2. File-by-File Audit

### 2.1 `workers/api/src/routes/screening/culture.ts` — Route Handler

**Lines:** 1–1133  
**Verdict:** KEEP but refactor.  

**What works:**
- Scoring runs in `ctx.waitUntil()` (L1071) — non-blocking, correct.
- Compliance audit trail insertion (L1009–1022) — legally required.
- HITL gate on candidate report (L1128–1133) — correct.
- Session state persistence to D1 (L1042–1047) — reliable.

**What is broken:**
- **Resolves role context + probe bank on EVERY advance** (L958–961). Two indexed queries per HTTP request. For a 10-question interview, that's 10 round-trips for data that never changes mid-session. **Fix:** Cache in session row at start.
- **Decomposition blocks the response** (L983–1025). After `advanceAdaptiveCultureInterview()` returns, the handler awaits `decomposeCandidateAnswer()`, then `persistDecomposition()`, then audit INSERT. The candidate's next question is delayed by an LLM call that produces data thrown into the void. **Fix:** Move decomposition to `waitUntil()`.
- **`totalBudget` is always 15** (L802, L908, L1104). Hardcoded `CULTURE_BANK_SIZE`. Even in generative mode. **Fix:** Read from config.
- **Creates a fresh provider on every request** (L949–953). New metered wrapper per HTTP request = 10 metering DB writes per interview. **Fix:** Create once per session, store in session metadata.
- **Mode defaults to `role_fit`** (L843). For a pre-match screener, this is wrong. **Fix:** Derive mode from `candidate_ingestion.status`.

**Lines to change:** 802, 843, 908, 949–953, 958–961, 983–1025, 1042–1047, 1071, 1104, 1128–1133.

---

### 2.2 `workers/api/src/lib/cultureAgent.ts` — Static Bank FSM

**Lines:** 1–584  
**Verdict:** REWRITE. Keep scoring pipeline, replace turn management.  

**What works:**
- `startCultureInterview()` (L172) — clean initialization.
- `cloneTranscript()` (L552) — defensive cloning, never mutates caller state.
- `parseAgentTurnJsonResponse()` (L485) — JSON parser with fallback.
- `clampSpecificity()` (L525) — smart tunable boundary.

**What is broken:**
- **Imperative FSM** (L255–410). No explicit phases. No reducer. State mutated in-place.
- **`runTurnAnalysis()` burns an LLM call on every answer** (L441–477). For a 10-question interview with 3 probes, that's 13 LLM calls just to decide whether to probe. The discovery agent does this with a heuristic in <1ms.
- **Coverage scoring is binary** (L541). Returns 1 if ≥3 slots have `specificity >= 1`, else 0. A near-perfect answer with 2 slots at specificity 2 gets **zero coverage credit**.
- **`evaluateTermination()` is a simple threshold** (L421–437). Cannot express "terminate after wrap-up" or "terminate after drilling completes."
- **`coerceProbePattern()` silently drops themes** (L297–307). The LLM emits `running_theme_to_add`, but 90% of themes are discarded because they don't match a closed vocabulary. The comment at L298–299 admits this.
- **Hardcoded values everywhere:**
  - `DEFAULT_MAX_QUESTIONS = CULTURE_BANK_SIZE` (L249) — conflates bank size with interview length.
  - `DEFAULT_MIN_QUESTIONS = 5` (L250) — no configurability.
  - `maxTokens: 768` (L458) — arbitrary.
  - Theme cap at 5 (L304) — no justification.

**Lines to keep:** 172 (start shape), 485 (parser pattern), 525 (specificity clamp), 552 (clone pattern).

**Lines to delete:** 255–410 (imperative FSM), 441–477 (turn analysis), 541 (coverage scoring).

---

### 2.3 `workers/api/src/lib/cultureAgentAdaptive.ts` — Generative Planner FSM

**Lines:** 1–644  
**Verdict:** DELETE. Merge generative planner into new architecture.  

**What works:**
- `startAdaptiveCultureInterview()` (L93) — clean initialization.
- Fallback path (L322–380) — explicit and logs a warning.

**What is broken:**
- **70% duplicated code from `cultureAgent.ts`.** `evaluateTermination()`, `runTurnAnalysis()`, `parseAgentTurnJsonResponse()`, `scoreTurnCoverage()`, `mockTurnResponse()`, `cloneTranscript()`, `distinctQuestionsAsked()` are all copy-pasted verbatim. The comment at L476 admits it: *"copied from cultureAgent.ts for self-containment."*
- **Generative-to-static fallback over-prunes** (L334–342). When the planner fails, all questions in the same dimension are marked as "asked" — not just one. This can cause premature `bank_exhausted` termination.
- **`resolveCurrentQuestion()` is a hack** (L420–444). Synthesizes a `CultureQuestion` with hardcoded probes and `maxProbes: 2`. The comment at L426–429 confesses: *"We don't store the full probeStrategy in metadata... so we use a generic probe library."* The planner invents bespoke probes; the FSM replaces them with generic hardcoded ones.
- **`generativeId()` is fragile** (L385). If the planner produces two questions with the same target dimension, they get the same ID. Dedup logic won't catch semantic duplicates.

**Lines to keep:** 224–270 (generative planner call pattern). Move to `cultureProbeGenerator.ts`.

**Lines to delete:** Everything else.

---

### 2.4 `workers/api/src/lib/cultureGenerativePlanner.ts` — Generative Planner

**Lines:** 1–320  
**Verdict:** KEEP but refactor. Prompt needs rewrite. Signal loss needs fixing.  

**What works:**
- `buildGenerativePlannerSystemPrompt()` (L90) — Rule #1 and #5 are genuinely good instructions.
- `personalizationAnchors` audit trail (L35) — structurally sound for compliance.
- Parse failure returns `null`, triggering caller fallback — clean.

**What is broken:**
- **User message is a wall of text** (L176–219). No formatting guidance on how to weight inputs. For sparse profiles, the prompt is mostly *"(no experiences on file)"* placeholders.
- **No memory of how previous questions landed** (L224). Sees `priorQuestions` (texts) and `coverage` (counts), but not whether answers were strong or weak.
- **`targetSlots` is parsed but never used downstream** (L35, L294). `cultureAgentAdaptive.ts` ignores it — always sets `expectedSlots: ['S', 'T', 'A', 'R']`.
- **Probe strategy is generated but then lost** (L37–43). `cultureAgentAdaptive.ts` does not store it in `questionMetadata` (L389). The generative planner invents bespoke probes; the adaptive FSM replaces them with generic hardcoded ones.
- **Hardcoded `maxTokens: 1024`** (L240). Not configurable.

**Lines to change:** 90 (prompt rewrite), 176–219 (structured user message), 240 (configurable maxTokens).

---

### 2.5 `workers/api/src/lib/cultureAgentContext.ts` — Context Builder

**Lines:** 1–354  
**Verdict:** REWRITE. This is the primary source of "generic and corny."  

**What works:**
- Defensive coding — every DB miss yields safe empty values (L17).
- Deduplicates skills (L205).

**What is broken:**
- **`loadCandidateBackground()` destroys specificity** (L85–211). This is where the generic feeling originates.
  - `candidate_searchable_profile` (L105–118): Reduced to `company: "Previous role"`, `role: "Engineer"`, `durationMonths: 0`.
  - `career_context_json` (L120–141): Creates synthetic experiences with `durationMonths: 0` every time.
  - `situation_signature_json` (L143–161): Creates a fake project named `"Key work areas"`.
  - `key_concepts_json` (L163–174): Just dumps skills arrays.
- **`priorScreening` is always `null`** (L68, L211). The type declares `PriorScreeningSummary` but it's never populated. Mode-2's advantage — skipping covered dimensions — cannot work.
- **`extractConflicts()` is a complete stub** (L277–282). Always returns `[]`. The prompt tells the model to consider conflicts, but they're never provided.
- **Hardcoded caps:** `experiences.slice(0, 5)` (L208), `projects.slice(0, 5)` (L209), `skills.slice(0, 20)` (L210).

**Lines to rewrite:** 85–211 (background loader), 277–282 (conflicts).

---

### 2.6 `workers/api/src/lib/cultureQuestionBank.ts` — Question Bank

**Lines:** 1–510  
**Verdict:** KEEP as Mode-2 fallback. Build `profile_probe_bank` for Mode-1.  

**What works:**
- 15 curated questions (L113–338) are genuinely good STAR elicitors.
- Scored selector (L419) is a reasonable multi-factor ranking.

**What is broken:**
- **Bank is tiny** (L350). `CULTURE_BANK_SIZE = 15`. The interview can ask up to 15 questions, meaning the bank is fully exhausted in a long interview.
- **`themeBonus` is dead code** (L473). `const themeBonus = probePatterns.some((p) => runningThemes.includes(p)) ? 0.3 : 0;`. But no question in `CURATED_BANK` sets `probe_patterns`. So `themeBonus` is always 0.
- **Scoring formula is uncalibrated** (L487–488). `coverageGap` dominates by an order of magnitude. The "sophisticated selector" is basically "pick the most uncovered dimension."
- **No `probe_patterns` on any question** (L113–338). The entire `runningThemes` machinery is dead.
- **Hardcoded magic numbers:** `themeBonus = 0.3`, `barsBonus = ((bars_fitness ?? 3) - 3) * 0.1`, `tagPreference = ±0.2`, `enrichmentBonus = min(count * 0.05, 0.25)`.

**Lines to keep:** 113–338 (curated questions), 419 (selector shape).

**Lines to change:** 350 (increase bank size or remove cap), 473 (fix themeBonus or delete), 487–488 (calibrate weights).

---

### 2.7 `workers/api/src/lib/cultureScorer.ts` — Scoring Engine

**Lines:** 1–1058  
**Verdict:** KEEP. Expensive but legally defensible. Optimize later.  

**What works:**
- Parallel execution of 10 dimension calls (L537–554) — architecturally correct.
- Re-prompt guard for ungrounded scores (L408, L474) — good compliance mechanism.
- `evaluateDealbreakers()` uses substring matching (L759) — correct for HITL gating.

**What is broken:**
- **11 LLM calls per interview** (L10–13). At current costs, ~$0.50–$2.00 per interview.
- **Re-prompt can add 10 more calls** (L408, L474). Silent and expensive.
- **Silent confidence penalty** (L430–431, L492–493). If re-prompt yields no quotes, confidence is docked 0.3. Not exposed in API response.
- **`applyDispositionalWeight()` is a step function** (L633–642). A weight of 0.4 rounds to 0 (no effect). A weight of 0.6 rounds to 1. Not a calibrated shift.
- **Synthesis gets no dealbreaker context** (L891). `synthesizeReport()` receives competency and profile results but not dealbreaker flags.
- **BARS rubrics are inline and unmaintainable** (L195–299). 300 lines of hardcoded prose. TODO at L186 says Phase C will sync from wiki — unimplemented.
- **`parseScoreInt()` defaults to 3 on error** (L1045). Neutral midpoint hides failures.

**Lines to keep:** 527–554 (parallel scoring), 759 (dealbreakers).

**Lines to optimize later:** 195–299 (BARS rubrics), 390–459 (scoring calls).

---

### 2.8 `workers/api/src/lib/cultureAgentDecomposition.ts` — Decomposition

**Lines:** 1–260  
**Verdict:** REWRITE. This is pure signal-to-void.  

**What works:**
- Non-blocking design — returns `null` on failure, interview continues.
- JSON parser is defensive.

**What is broken:**
- **`persistDecomposition()` is a stub** (L239–242). Every decomposition result is thrown away.
- **The prompt asks for `scoreEstimate` but it's never used** (L22–45). The scorer ignores decomposition and recomputes from transcript.
- **No `WorkingStyle`, `Motivation`, `ConflictHandling`, `SelfAwareness`, or `Skill` extraction.** Only `CulturalSignal`, `Experience`, `Project`.

**Lines to rewrite:** All of it. See `architecture/decomposition-contract.md` for target shape.

---

### 2.9 `workers/api/src/lib/cultureRoleResolution.ts` — Role Resolution

**Lines:** 1–211  
**Verdict:** KEEP but fix overlay derivation.  

**What works:**
- Clean fallback chain: RCD → legacy persona → hardcoded default.
- Never throws — safe baseline on any miss.

**What is broken:**
- **Overlay derivation is regex-based** (L83–86). Only two overlays: `manager` and `senior-ic`. Every IC role collapses to `senior-ic`.
- **`deriveOverlayFromRcd()` duplicates regex logic** (L89) instead of reusing `deriveOverlayFromArchetype()`.
- **`FALLBACK` uses `roleOverlayId: 'universal'`** (L64) — not a valid `RoleOverlayId`. Works by accident.

**Lines to change:** 83–86 (more granular overlays), 89 (deduplicate), 64 (fix fallback).

---

## 3. Cross-File Issues

### 3.1 The generative planner's signal is systematically discarded

**Path:** `cultureGenerativePlanner.ts:37–43` → `cultureAgentAdaptive.ts:389` → `cultureAgentAdaptive.ts:426–429`

1. Planner produces `probeStrategy` with bespoke probes.
2. `resolveCurrentQuestion()` stores only `question`, `targetDimension`, `personalizationAnchors` in metadata.
3. Comment admits: *"We don't store the full probeStrategy in metadata... so we use a generic probe library."*
4. Result: Planner invents personalized probes; FSM replaces them with `"Can you set the scene for me..."`

**Fix:** Store `probeStrategy` in metadata. It's ~200 chars. Transcript size increase is negligible.

### 3.2 The context builder destroys specificity before the planner sees it

**Path:** `cultureAgentContext.ts:105–211` → `cultureGenerativePlanner.ts:176–219`

1. `loadCandidateBackground()` reduces rich ingestion data to `"Previous role"`, `"Engineer"`, `durationMonths: 0`.
2. Planner is told: *"reference at least one specific detail from the candidate's background"*.
3. Background has no specific details.
4. Result: Planner falls back to generic questions.

**Fix:** Pass raw `career_context_json`, `situation_signature_json`, and `key_concepts_json` to the prompt without synthetic reduction.

### 3.3 Decomposition is called synchronously and produces data that is thrown away

**Path:** `culture.ts:983–1025` → `cultureAgentDecomposition.ts:239`

1. Route handler awaits decomposition after every answer.
2. Decomposition LLM extracts structured signals.
3. `persistDecomposition()` logs and returns.
4. Result: Candidate waits for an LLM call that produces nothing.

**Fix:** Move decomposition to `waitUntil()`. Implement real persistence to `candidate_nodes`.

---

## 4. Honest Summary

| File | Verdict | Lines to Keep | Lines to Change/Delete |
|---|---|---|---|
| `culture.ts` (route) | Refactor | ~200 | ~300 |
| `cultureAgent.ts` | Rewrite | ~50 | ~400 |
| `cultureAgentAdaptive.ts` | Delete | ~30 | ~500 |
| `cultureGenerativePlanner.ts` | Refactor | ~80 | ~150 |
| `cultureAgentContext.ts` | Rewrite | ~30 | ~200 |
| `cultureQuestionBank.ts` | Keep + extend | ~300 | ~100 |
| `cultureScorer.ts` | Keep (optimize later) | ~800 | ~200 |
| `cultureAgentDecomposition.ts` | Rewrite | ~20 | ~200 |
| `cultureRoleResolution.ts` | Fix | ~150 | ~50 |

**Total impact:** ~1,500 lines rewritten or deleted, ~1,500 lines kept.
