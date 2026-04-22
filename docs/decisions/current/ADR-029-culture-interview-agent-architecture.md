# ADR-029: Behavioral & Culture Interview Agent Architecture

**Date:** 2026-04-07
**Status:** Proposed — **Informational note added 2026-04-08 by [ADR-033](ADR-033-research-integration-strategy-and-guardrails.md)**
**Deciders:** Hans (founder)

> **INFORMATIONAL NOTE — 2026-04-08**
> This ADR was written the same day as the behavioral/culture research brief and is **well-aligned** with its findings. No reversals or contradictions. [ADR-033](ADR-033-research-integration-strategy-and-guardrails.md) documents seven minor gaps that are tracked in `knowledge/STRATEGY.md` Phase 2:
>
> - Belief-state tracking with Previous Belief Aware (PBA) judge (BC-6, BC-7) — this ADR does stateless scoring at session end; research recommends per-turn belief updates
> - Probe generator with 5 explicit trigger types (BC-11) — Missing STAR / Vague / Attribution / Evidence / Depth
> - Belief-state delta as evasion detector (BC-15) — information-theoretic, no separate classifier
> - Reality Monitoring fabrication detection (BC-16) — episodic specificity scoring bonus
> - Cognitive-load unexpected follow-ups for fabrication detection (BC-17)
> - Rolling compaction + pinned exchanges (BC-18) — may not be needed for 5–20 question flows
> - QWK target: this ADR sets ≥ 0.55; research says ≥ 0.60 — tighten when calibration improves
>
> These are enhancements, not corrections. The architecture decisions in this ADR stand. See `knowledge/STRATEGY.md` BC-6 through BC-19 for the tracked work items.

---

## Context

PIPE needs a **Culture Fit Interview Agent** — a multi-turn conversational AI that conducts structured behavioral interviews and produces a defensible, evidence-grounded report for the recruiter. This is a distinct problem from role discovery (which interviews the recruiter) or code review (which evaluates a technical artifact): the candidate is the subject, the conversation *is* the instrument, and the output must withstand employment-law scrutiny.

The research brief at `knowledge/outputs/behavioral-culture-interview-agent.md` (617 lines, 48 sources, 4 parallel researchers) establishes the empirical non-negotiables this ADR honors. Key findings that shape architecture:

- **STAR/PBQ format outperforms situational questions at all seniority levels.** Past-behavior questions achieve ρ = .31 consistently; situational questions degrade from ρ = .29 at entry level to ρ = .18 at senior level (Huynh et al. 2025). Senior candidates articulate what they *would* do in ways that do not track what they *have* done.
- **BARS (Behaviorally Anchored Rating Scales) is the single largest validity lift**, improving scoring reliability by ~35% over holistic rubrics. Each question needs its own 5-point scale with concrete behavior anchors.
- **Multi-agent scoring decomposition matches human inter-rater agreement.** One specialist LLM call per dimension, primed with 3-shot low/medium/high calibration examples, achieves QWK ≈ 0.62 on soft-skill benchmarks. Single holistic scoring prompts fail.
- **Culture is a profile, not a score.** Person-Organization fit predicts retention (ρ = .44) but NOT performance (ρ = .15). Shipping a single "culture fit score" both reduces validity and amplifies legal risk.
- **Evidence grounding is required for explainability.** Every dimension score must link to verbatim transcript quotes — mandated by EU AI Act Article 14 and Illinois HB 3773 (see ADR-031).

### Existing patterns this agent builds on

PIPE already has two server-side agents that establish the architectural spine:

- **`roleAgent.ts`** (ADR-027) — FSM + ReAct loop, deterministic question bank, Knowledge State scratchpad, budget-based termination. The control flow works; I am mirroring it.
- **`implementerAgent.ts`** (ADR-024, ADR-026) — Multi-turn transcript stored as JSON in a dedicated session table (`review_sessions`), one row per interview rather than one row per turn. The storage shape works; I am mirroring it.

The culture agent is NOT a fresh architecture — it is `roleAgent`'s control flow wired to a behavioral-interview prompt discipline, a BARS-backed scoring pipeline, and a compliance gate.

### Stage integration

Rather than introducing a new stage type, the culture agent lives as a single challenge of a new type `AGENT_INTERVIEW` inside the existing `CULTURAL` stage. This preserves the `stage → challenge → submission` uniformity established in ADR-002 and matches the precedent set by the implementer agent, which lives as a challenge of type `CODE_REVIEW`.

---

## Decision

Build a **server-side Culture Interview Agent** as a Hono route module that conducts a multi-turn STAR-format behavioral interview via Cloudflare Workers AI (`@cf/google/gemma-4-26b-a4b-it`), tracks session state in a dedicated `culture_interview_sessions` D1 table, and produces a multi-dimension BARS-scored report via a separate multi-agent scoring pipeline that runs once at session completion.

### 1. Provider: Cloudflare Workers AI Gemma 4

- **Model:** `@cf/google/gemma-4-26b-a4b-it`
- **Pricing:** $0.10 per M input tokens, $0.30 per M output tokens (verified via Cloudflare docs, 2026-04-07)
- **Estimated cost per interview:** ~$0.0155 (1.5¢) — 7 questions + probes + scoring + synthesis
- **Binding:** already live (`env.AI`, see `workers/api/src/lib/transcribe.ts`)
- **Tool calling:** this agent does not use tools. Workers AI tool-calling support for Gemma is not uniformly available; the culture agent's control flow is a deterministic FSM, not ReAct-with-tools, so `supportsTools = false` is acceptable.
- **Factory:** extend `workers/api/src/lib/llm/createProvider.ts` with `createCultureAgentProvider(env)` returning a new `CloudflareAIProvider` implementation of the existing `LLMProvider` interface (`workers/api/src/lib/llm/types.ts`).

The per-interview LLM cost is low enough (~1.5¢) that the culture interview is included in the free tier with no gating logic. See ADR on Free/Pro gating for rationale.

### 2. Question bank: deterministic, not generative

The agent draws questions from a **versioned question bank** authored as markdown files in `knowledge/culture/questions/` with frontmatter metadata (dimensions, seniority, allowed follow-ups, expected STAR slots) and body sections for the question text, rationale, BARS rubric, 3-shot calibration examples, and probe library.

At deploy time, a `scripts/sync-culture-wiki.ts` script parses the markdown and upserts into a D1 `culture_questions` table. The agent reads from D1 at runtime.

**Rationale:** per research §6.1, question *selection* is deterministic but question *delivery* (probing, clarifying, handling evasive responses) is generative. LLM-generated questions without a human-authored BARS rubric cannot be scored defensibly. This is the single most important constraint in the system.

**Initial seed:** 15 questions with full BARS rubrics + 3-shot L/M/H calibration, covering the 5 competency dimensions:
- Ownership
- Collaboration
- Learning orientation
- Conflict handling
- Self-awareness

Fifteen excellent questions are gold; thirty mediocre questions without rubrics are worthless.

### 3. Control flow: FSM + ReAct hybrid

The agent runs a finite state machine with four states:

```
[consent] → [in_progress] → [scoring] → [complete]
                   ↓
                [error]
```

- **`consent`** — initial state on session creation. No question is ever shown until the candidate accepts the disclosure (see ADR-031). The `consent_at` timestamp is the audit anchor for HB 3773 / AI Act.
- **`in_progress`** — the ReAct loop. Each turn: agent picks a question (or probe), candidate responds, agent parses STAR-slot completeness, decides whether to probe further or advance. Scratchpad tracks dimension coverage and running themes.
- **`scoring`** — terminal agent state, spawns the scoring pipeline.
- **`complete`** — score report available, HITL review pending (see ADR-031).

The ReAct decision at each turn answers three questions:
1. **Coverage check:** does the current question's STAR response have all required slots (Situation, Task, Action, Result)?
2. **Probe budget:** have we already used ≥ 2 probes for this question?
3. **Termination check:** are we within budget, and have we covered all 5 competency dimensions at least once?

This is the same control pattern as `roleAgent.ts:212-257`, adapted for behavioral-interview semantics instead of domain-coverage interview semantics.

### 4. Termination rule: adaptive depth with hard floor and cap

**Approved parameters (2026-04-07):**
- **Minimum:** 5 questions — never terminate below this
- **Hard cap:** 20 questions — force wrap-up
- **No fixed target** — the agent decides when it has enough coverage

**Termination rule:**
```
IF question_count >= 5 AND all 5 competency dimensions have >= 1 adequate STAR response
  → wrap up
IF question_count == 20
  → force wrap-up (log partial coverage as a warning)
```

No time cap is enforced server-side in v1. If interviews run long in practice, a soft time cap can be added later without schema changes.

**Rationale:** research §2.5 indicates that fixed question counts either waste the candidate's time (when coverage is achieved early) or cut off important probing (when an evasive answer would have benefited from one more follow-up). An adaptive floor-and-cap matches how a skilled human interviewer works.

Dimension coverage is tracked in the `transcript.scratchpad.dimension_coverage` map. When picking the next question, the agent preferentially selects questions tagged with dimensions that are still uncovered.

### 5. Session storage: one row, transcript as JSON

Mirroring the `review_sessions` schema from `workers/api/migrations/0004_review_sessions.sql`, a new table `culture_interview_sessions` stores one row per candidate interview with the full transcript in a JSON `TEXT` column:

```sql
CREATE TABLE culture_interview_sessions (
  id                       TEXT PRIMARY KEY,
  challenge_id             TEXT NOT NULL,
  challenge_submission_id  TEXT,
  assessment_id            TEXT NOT NULL,
  candidate_id             TEXT NOT NULL,
  state                    TEXT NOT NULL DEFAULT 'consent',
  consent_at               TEXT,
  transcript               TEXT NOT NULL DEFAULT '{"turns":[],"scratchpad":{}}',
  current_question_idx     INTEGER NOT NULL DEFAULT 0,
  score_report             TEXT,
  started_at               TEXT,
  completed_at             TEXT,
  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL,
  FOREIGN KEY (challenge_id) REFERENCES challenges(id),
  FOREIGN KEY (assessment_id) REFERENCES assessments(id),
  FOREIGN KEY (candidate_id) REFERENCES candidates(id)
);
```

`transcript` JSON shape:

```json
{
  "turns": [
    {
      "idx": 0,
      "question_id": "ownership-001",
      "question_text": "...",
      "probe_of": null,
      "candidate_response": "...",
      "star_slots": { "S": {"present": true, "specificity": 2}, ... },
      "timestamp": "..."
    }
  ],
  "scratchpad": {
    "dimension_coverage": { "ownership": 1, "collaboration": 0, ... },
    "probes_used_for_current_q": 0,
    "running_themes": []
  }
}
```

When the session completes, the final score report lands in `challenge_submissions` as a normal row (preserving the existing submission pipeline), and `score_report` on the session row caches the structured BARS output for fast retrieval.

**Rationale:** one row per turn would require joining on every state read and would spread the interview across many rows unnecessarily. The JSON-transcript pattern is already proven in `implementerAgent`.

### 6. Scoring: multi-agent decomposition, run once at completion

Scoring is NOT inline during the interview. It runs once when the session transitions from `in_progress` to `scoring`. The pipeline has three stages:

**Stage 1 — competency dimension specialists (5 calls):**
For each of the 5 competency dimensions, one Gemma call loads:
- The BARS rubric for that dimension
- 3-shot L/M/H calibration examples
- The full transcript
- A strict JSON output schema: `{ score: 1-5, evidence_quotes: string[], confidence: 0-1 }`

**Stage 2 — culture profile specialists (5 calls):**
For each of the 5 culture profile dimensions (see ADR-030), one Gemma call infers the candidate's position on that dimension (1-5 slider) based on transcript cues. Same output schema.

**Stage 3 — narrative synthesis (1 call):**
One Gemma call takes the structured outputs from stages 1 and 2 and produces:
- A 3-paragraph narrative
- An overall recommendation: `hire | flag | pass`
- A list of dimension scores linked to evidence quotes

Total scoring cost: ~11 Gemma calls per interview, ~$0.005.

**Grounding requirement:** every dimension score MUST include evidence quotes. The prompt enforces this via JSON schema and a "if you cannot ground the score in a verbatim quote, output `null`" instruction. Ungrounded scores fail validation and trigger a re-prompt with the score forced to `null`. This is the defensibility floor — without evidence grounding, no score is valid.

### 7. File layout (four new files in `workers/api/src/lib/`)

Mirroring `roleAgent.ts` + `roleAgentPrompts.ts`:

- **`cultureAgent.ts`** — FSM + ReAct loop, session state management, turn handler. Input: provider, session state, question bank. Output: next turn or terminal `scoring` signal.
- **`cultureAgentPrompts.ts`** — system prompt, turn-prompt builders, STAR-slot detection instructions, probe-trigger rules, difficult-response strategies (research §2.4, §2.6).
- **`cultureScorer.ts`** — multi-agent scoring orchestrator. Runs the 11-call pipeline, validates evidence grounding, writes to `score_report`.
- **`cultureScorerPrompts.ts`** — one prompt template per dimension with BARS rubric interpolation, enforces evidence-grounded JSON output.

### 8. Routes

New file `workers/api/src/routes/screening/culture.ts` following the Hono pattern in `roleContexts.ts`:

**Recruiter (Clerk JWT):**
- `POST /api/v1/screening/culture/challenges/:challengeId/config` — set org benchmark profile + focus dimensions (writes to `challenge.server_config`, hidden from candidates per ADR-007)
- `GET /api/v1/screening/culture/sessions/:sessionId/report` — BARS scores + narrative + evidence quotes
- `POST /api/v1/screening/culture/sessions/:sessionId/review` — HITL gate: recruiter confirms or overrides (see ADR-031)

**Candidate (session JWT):**
- `GET /rpc/culture/session/:token` — fetch state + next question; returns consent screen if `state = 'consent'`
- `POST /rpc/culture/session/:token/consent` — writes `consent_at`, advances state to `in_progress`
- `POST /rpc/culture/session/:token/respond` — submit answer, returns next question/probe or terminal state
- `GET /rpc/culture/session/:token/state` — resume support

### 9. Voice support via Whisper large-v3-turbo

The interview is text-first but voice-capable. Voice responses are transcribed server-side via the existing `transcribeAudioWhisper()` helper, which was upgraded to `@cf/openai/whisper-large-v3-turbo` in the commit preceding this ADR (same price, materially better accuracy). Video is deferred to a future ADR.

---

## Alternatives Considered

### A. Single holistic scoring prompt (one Gemma call, full rubric in the prompt)

**Rejected.** Research §2.2 is unambiguous: single-prompt multi-dimension scoring produces inconsistent, regression-to-mean outputs with poor evidence grounding. Multi-agent decomposition adds ~10 calls (~$0.005) but is the only approach that matches human inter-rater agreement. The cost of getting this wrong is a product that cannot be defended in court.

### B. LLM-generated questions with inferred rubrics

**Rejected.** An LLM-generated question has no BARS rubric, no calibration examples, and no versioned history. Scoring such a question is, practically speaking, asking one LLM to rubric another LLM — which collapses to "does the scorer like what the interviewer asked?" This breaks the empirical foundation of structured interviewing. The extra authoring effort of the human-curated bank is the *product*, not a cost.

### C. Fixed question count (e.g., always 7 questions)

**Rejected.** As discussed in §4, a fixed count either wastes time or cuts off necessary probing. The adaptive floor-and-cap (5 min, 20 max, coverage-based early exit) is cheap to implement and matches human interviewer behavior.

### D. Store each turn as a separate `challenge_submissions` row

**Rejected.** ADR-023 established one submission per challenge. A 7-turn interview creating 7 submissions would break that invariant and spray state across multiple tables. The `review_sessions` JSON-transcript pattern (ADR-024) is the right precedent.

### E. Use Mistral instead of Gemma

**Rejected on cost.** Mistral Small is ~7x more expensive than Gemma 4 on Workers AI for this workload. Gemma 4's instruction-following and STAR-parsing quality are adequate per Cloudflare's published benchmarks. If Gemma proves inadequate in calibration runs (see §Verification below), the provider interface is abstracted and Mistral is a one-line factory swap away.

### F. Stream agent responses via SSE

**Rejected at v1, same reasoning as ADR-027.** Agent questions are short. SSE adds plumbing for marginal UX gain. Can upgrade later.

---

## Consequences

**Positive:**
- Scoring is defensible: every score is anchored in a versioned BARS rubric and a verbatim candidate quote.
- Architecture mirrors existing agents — review can reuse prior patterns, reducing cognitive overhead.
- Question bank is a markdown wiki under version control, so craft work lives in reviewable files rather than buried LLM prompts.
- Per-interview cost is low enough (~1.5¢) to ship in the free tier.
- Storage schema matches `review_sessions`, so operational tooling and backup flows already work.

**Negative:**
- Authoring 15 BARS rubrics with 3-shot calibration is real craft work — not a weekend sprint. This is the critical path.
- Scoring calibration (hand-score 10 transcripts, measure QWK vs. agent scores) is mandatory before shipping; if QWK < 0.55, prompts must be iterated.
- 11 LLM calls per scoring run means a ~30-second wait on the recruiter side before the report appears. Acceptable for an async flow.
- The question-bank → D1 sync step adds a build-time requirement; forgetting to run it means stale questions in production. Mitigate with CI check.

**Follow-ups required:**
- ADR-030: Culture Profile Operationalization (the 5-slider benchmark, why no single fit score)
- ADR-031: AI Hiring Compliance Architecture (consent, HITL, deletion, audit)
- Future ADR: video interview support (deferred)
- Future ADR: extending price tracking to other agents once culture agent proves the metering pattern

---

## Verification

**Before shipping:**
1. `npx tsc --noEmit` must pass
2. 5 BDD Playwright specs (consent gate, linear flow, probe budget, coverage termination, recruiter report)
3. Vitest REST tests for the scoring pipeline against fixture transcripts
4. **Scoring calibration run**: hand-score 10 sample transcripts against BARS rubrics, run the scorer against the same transcripts, compute **Quadratic Weighted Kappa**, require QWK ≥ 0.55 per research §2.9. If below target, iterate prompts and re-run.
5. Manually drive a full interview via Chrome browser automation: consent screen → ≥5 questions → scoring → recruiter report

**Ongoing:**
- Every new question added to the bank must include BARS rubric + 3-shot calibration before being usable by the agent
- Calibration QWK must be recomputed whenever the scoring prompt or model changes
