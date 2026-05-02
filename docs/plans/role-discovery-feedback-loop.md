# Role Discovery Feedback Loop — Automated Adaptive Plan

**Goal:** Turn recruiter feedback into immediate, compounding prompt improvements without human intervention.

**Inspiration:** Karpathy loop — generate → evaluate → correct → generate better.

---

## Architecture Overview

```
┌─────────────────┐     ┌──────────────┐     ┌──────────────────┐
│  LLM generates  │────▶│  Guard check │────▶│ Show to recruiter│
│    question     │     │ (regex + emb)│     │                  │
└─────────────────┘     └──────────────┘     └────────┬─────────┘
                                                      │
                                                      ▼
┌─────────────────┐     ┌──────────────┐     ┌──────────────────┐
│ Patch injected  │◀────│  D1 store    │◀────│ Recruiter flags  │
│ into next prompt│     │  (patches +  │     │ question as bad  │
│                 │     │   corpus)    │     │                  │
└─────────────────┘     └──────┬───────┘     └────────┬─────────┘
                               │                      │
                               ▼                      ▼
                        ┌──────────────┐      ┌──────────────┐
                        │ Embedding    │      │ Async analyzer│
                        │ similarity   │      │ (categorize + │
                        │ search       │      │  LLM patch)  │
                        └──────────────┘      └──────────────┘
```

---

## Phase 0 — Foundation (DONE ✅)

| Component | Status | File |
|---|---|---|
| Deterministic guard | ✅ Live | `lib/agents/question/guard.ts` |
| Guard retry loop | ✅ Live | `lib/roleAgent.ts`, `lib/agents/question/generator.ts` |
| Negative examples in prompts | ✅ Live | `lib/agents/roleDiscovery/prompts.ts`, `lib/agents/question/prompt.ts` |
| Feedback aggregation reporter | ✅ Live | `lib/agents/question/feedbackReport.ts` |
| In-memory prompt patch store | ✅ Live | `lib/agents/question/promptPatch.ts` |
| Seed patches (5 known bad patterns) | ✅ Live | `lib/agents/question/promptPatch.ts` |

---

## Phase 1 — Durable Patch Storage (Next)

**Why:** Right now patches are in-memory only. Worker restarts wipe them.

**What:**
1. Migration `0013_prompt_patches.sql` creates two tables:
   - `prompt_patches` — negative/corrected examples, flag counts, auto-generated flag
   - `bad_question_corpus` — every flagged question with its BGE embedding

2. Update `promptPatch.ts` to load from D1 on startup, write to D1 on change.

3. Add a `reloadPatchesFromD1()` function called at worker boot.

---

## Phase 2 — Async Feedback Analyzer (Next)

**Why:** When a recruiter hits "Bad Bot," the system should learn immediately.

**What:**
1. `feedbackAnalyzer.ts` (drafted) — when feedback arrives:
   - Categorize the feedback (`categorizeExchange()`)
   - Generate BGE embedding for the bad question
   - Check cosine similarity against `bad_question_corpus`
   - If similar patch exists → increment `flag_count`, add corpus entry
   - If new pattern → call LLM to generate `correctedExample` + `reason`
   - Insert new patch + corpus entry into D1
   - Refresh in-memory patch store

2. Wire into `POST /:id/feedback` route:
   ```ts
   // AFTER storing feedback in exchanges
   c.executionCtx.waitUntil(
     analyzeFeedback({ db: c.env.DB, ai: c.env.AI, provider, ...exchange })
   );
   ```

**Key design decision:** `waitUntil` makes it async — the recruiter gets `200 OK` immediately, analysis happens in the background.

---

## Phase 3 — Fuzzy Guard (Embedding-Based)

**Why:** Regex guards catch exact patterns. Embeddings catch *variations*.

**What:**
1. Augment `guard.ts` with an embedding similarity check:
   ```ts
   const sim = cosineSimilarity(questionEmbedding, badCorpusEmbeddings);
   if (sim > 0.85) block("Too similar to known bad question");
   ```

2. Cache the top-N bad question embeddings in memory (LRU, ~500 entries).

3. For each new generated question:
   - Run deterministic regex guard first (<1ms)
   - If regex passes, run embedding similarity check (~50ms with cached vectors)
   - If similarity > 0.85, block and retry

---

## Phase 4 — Per-Session Patch Cache (Tightest Loop)

**Why:** If question 3 is bad and flagged, question 4 in the SAME interview should already know not to repeat the mistake.

**What:**
1. Add `sessionPatchCache` to `callRoleAgent` / `generateQuestion`:
   - Keyed by `roleContextId + participantId`
   - New patches from `analyzeFeedback` are pushed into this cache immediately
   - The guard checks BOTH the global patch store AND the session cache

2. This makes the loop intra-interview, not just cross-interview.

---

## Phase 5 — Self-Critique Step (Optional, Higher Latency)

**Why:** Before showing ANY question to the user, the model critiques itself.

**What:**
1. After generating a question, send a second LLM call:
   ```
   System: You are a question-quality critic. Flag any issues with this question.
   User: {generated_question}
   
   Respond with JSON: { "issues": [...], "rewrite": "..." }
   ```

2. If issues found, use the rewrite instead of the original.

**Trade-off:** +200-500ms latency. Only worth it if guard misses are frequent.

---

## Operational Workflow

### What happens when a recruiter hits "Bad Bot"

```
T+0ms    Recruiter clicks Bad Bot on "What are your responsibilities?"
T+50ms   Frontend calls POST /:id/feedback
T+100ms  Backend stores feedback in exchanges JSONB, returns 200 OK
T+100ms  Backend queues async analyzeFeedback via waitUntil
T+500ms  Analyzer categorizes → role_confusion
T+600ms  Analyzer generates BGE embedding for the question
T+700ms  Analyzer checks similarity against bad_question_corpus
T+800ms  Analyzer calls LLM to generate corrected example + reason
T+2s     Analyzer inserts new patch into prompt_patches table
T+2.1s   Analyzer inserts corpus entry into bad_question_corpus
T+2.2s   In-memory patch store reloads from D1

Result: Every future question (including next turn in this interview)
        now sees the new negative example in its system prompt.
```

### What happens on the next question generation

```
1. Prompt builder injects all patches (global + session cache)
2. LLM generates question
3. Deterministic guard checks regex rules (<1ms)
4. Fuzzy guard checks embedding similarity against bad corpus (~50ms)
5. If either blocks → inject guard nudge → regenerate (max 2 retries)
6. Return question to user
```

---

## Success Metrics

| Metric | Target | How to measure |
|---|---|---|
| Flag rate (questions flagged / total) | <5% | `feedbackReport.ts` weekly report |
| Guard catch rate | >90% of flagged questions blocked before user sees them | Compare guard logs to feedback |
| Patch generation time | <3s from feedback to patch storage | Analyzer logs |
| Time to first patch for new pattern | <5s | Analyzer logs |

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Garbage patches from unclear feedback | Only auto-patch when `categorizeExchange()` returns a non-uncategorized rule. Require ≥1 flag for new patch, ≥3 flags before hard guard rule. |
| Embedding similarity false positives | Threshold at 0.85 (high). Only fuzzy-blocks when regex also would have warned. Never fuzzy-block without regex also flagging. |
| LLM patch generation cost | Use cheap model (`@cf/meta/llama-3.1-8b-instruct`). Cache prompts. Skip LLM generation if feedback is just `[BAD_ROBOT]` with no text. |
| Patch store bloat | Prune patches with `flag_count = 1` and `created_at > 90 days`. Keep top 100 by flag count in prompt injection. |

---

## Implementation Order

1. ✅ **Phase 0** — Guard + reporter + seed patches (DONE)
2. 🔲 **Phase 1** — D1 schema + D1-backed patch store
3. 🔲 **Phase 2** — Wire `analyzeFeedback` into feedback endpoint
4. 🔲 **Phase 3** — Fuzzy guard with embedding similarity
5. 🔲 **Phase 4** — Per-session patch cache
6. 🔲 **Phase 5** — Self-critique step (deferred until metrics show need)
