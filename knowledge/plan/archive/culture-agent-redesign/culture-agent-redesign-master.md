# Culture Agent Redesign — Master Plan

**Source strategy:** `knowledge/plan/archive/superseded-strategy-v2-2026-06-19/pipe-strategy-v2-part4-candidate-ingestion.md` §The screener design
**Generated:** 2026-05-02  
**Status:** PENDING — awaiting implementation  
**Owner:** Culture Agent Team  

---

## 1. The Core Reframe

### 1.1 What is wrong with the current mental model

The culture interview is currently positioned as an **assessment stage** in the candidate funnel: scored, HITL-gated, pass/fail. It sits at stage index 1 (`SCREENING → CULTURAL → CODE_REVIEW → CODE_IMPLEMENTATION`), produces a score report, and its output goes to a recruiter review gate. The candidate experience is a 15-question behavioral interrogation that feels generic because it *is* generic — the agent has no memory of the candidate's resume, no model of what it still needs to learn, and no ability to adapt its tone or depth based on the quality of answers.

The new mental model: **the culture agent is a graph construction engine** that turns behavioral claims into structured, auditable evidence. The interview is not the product. The candidate graph is the product. The interview is merely the most reliable mechanism for eliciting signal that a resume cannot provide.

### 1.2 Why this matters for matching

Matching currently runs on resume prose. The `candidateSituationFit` prompt (v3) reads `CareerArc/Experience/Project/Skill` nodes for context, but:

- The aggregate embedding is `meanPoolVectors(decompositionEmbeddings)` from **resume decomposition only**
- `candidate_nodes` exists in D1 but matching ignores it
- The culture interview's decomposition output is written to logs and discarded (`cultureAgentDecomposition.ts:239`)
- A candidate who completes the culture interview has the same flat vector they had at upload

When the culture agent writes `CulturalSignal`, `WorkingStyle`, `Motivation`, and `ConflictHandling` nodes to `candidate_nodes`, and those nodes are embedded and mean-pooled into the aggregate vector, matching gains behavioral signal it currently has zero visibility into.

### 1.3 The two-mode distinction

| Dimension | Mode-1: Profile Builder | Mode-2: Role Fit |
|---|---|---|
| **Trigger** | After resume upload, before matching | After matching, before hiring decision |
| **Goal** | Graph construction, not evaluation | Role-specific evaluation |
| **Probe bank** | Role-agnostic, coverage-driven | RCD-enriched, team-calibrated |
| **Output** | `candidate_nodes` with `source='automated_screener'` | `candidate_nodes` with `source='culture_interview'` + `rcd_version` |
| **HITL gate** | None — candidate-facing profile building | Required — recruiter confirms/overrides |
| **Blocking** | Matching blocked until Mode-1 completes | No blocking — candidate already matched |
| **Temporal** | First layer | May supersede Mode-1 nodes for same dimension |

Both modes write to the same graph. Both modes use the same underlying FSM, decomposition pipeline, and scoring engine. The difference is the probe bank source, the BARS anchor set, and whether the output feeds a hiring decision.

---

## 2. Current State — Brutal Audit

### 2.1 What exists today

The culture agent E2E flow:

```
[consent] → [in_progress] → ReAct loop per turn → [scoring] → [complete]
                    ↑_________↓
           1. Candidate answers
           2. LLM analyzes STAR slots (S/T/A/R presence + specificity)
           3. Decision: probe (max 2), next question, or terminate
           4. If probe: go to 1
           5. If next: pick from 15-question bank (coverage + overlay + theme scoring)
           6. If terminate: 5 min questions, 15 max, 20 hard cap

Termination → 11 LLM scoring calls (parallel 5+5, then 1 synthesis)
           → Score report written to culture_interview_sessions
           → Decomposition runs → writes to LOGS ONLY
           → Status = 'complete'
           → Recruiter gets HITL review gate
```

**Files in the critical path:**
- `workers/api/src/routes/screening/culture.ts` — route handler, consent/respond/report
- `workers/api/src/lib/cultureAgent.ts` — static bank FSM (start, advance, terminate, turn analysis)
- `workers/api/src/lib/cultureAgentAdaptive.ts` — generative planner FSM (70% duplicated from cultureAgent.ts)
- `workers/api/src/lib/cultureGenerativePlanner.ts` — LLM-driven question generator
- `workers/api/src/lib/cultureAgentContext.ts` — context builder (candidate background + role context)
- `workers/api/src/lib/cultureQuestionBank.ts` — 15-question static bank
- `workers/api/src/lib/cultureScorer.ts` — 11-call scoring pipeline
- `workers/api/src/lib/cultureAgentDecomposition.ts` — answer decomposition (stub — writes to logs)
- `workers/api/src/lib/cultureRoleResolution.ts` — RCD → team context resolver

### 2.2 What works (do not rewrite)

- **The ReAct loop** (`cultureAgent.ts:255–410`). The start/advance/terminate separation is clean. The transcript shape is sound.
- **The 15-question bank** (`cultureQuestionBank.ts:113–338`). The curated questions are genuinely good STAR elicitors. The BARS rubrics are well-calibrated.
- **STAR analysis** (`cultureAgent.ts:441–477`). Slot presence + specificity is the right primitive for answer quality.
- **BARS scoring rubric** (`cultureScorer.ts:195–299`). The 5-level behavioral anchors are legally defensible and evidence-grounded.
- **HITL gate** (`culture.ts:1128–1133`). Recruiter must confirm/override before scores are final.
- **Compliance audit trail** (`culture_compliance_audit` table, 13 event types). Legally required; do not change.
- **Cost metering** (`culture_ai_usage_events`). Per-call cost tracking is production-grade.

### 2.3 What is broken (cite files/lines)

**Decomposition writes to logs, not the graph.**
- `cultureAgentDecomposition.ts:239`: `persistDecomposition()` is a stub that logs and returns.
- `culture.ts:983–1025`: The route handler awaits decomposition, gets structured signals, calls the stub, then writes audit counts only.
- **Impact:** Every answer's extracted `CulturalSignal`, `Experience`, and `Project` nodes are discarded. The LLM call is pure waste.

**The culture agent is a "cheap toy" compared to the discovery agent.**
- The discovery agent uses a **pure reducer** (`interviewReducer.ts:314–401`) with deterministic phase selection (`selectPhase`, `buildPhaseDirective`). The culture agent uses an **imperative FSM** with implicit phase (`cultureAgent.ts:255–410`).
- The discovery agent has **heuristic answer evaluation** (`answerEvaluator.ts:56–97`, <1ms, zero LLM cost). The culture agent runs an **LLM on every answer** just to decide whether to probe (`cultureAgent.ts:441–477`).
- The discovery agent has **guard retry loops** (`generateQuestionWithGuardRetry`, `generator.ts:239–338`). The culture agent has **simple JSON.parse with mock fallback** (`cultureAgent.ts:470–476`).
- The discovery agent generates **per-domain question batches** with caching (`domainOrchestrator.ts:126–258`). The culture agent serves **one question at a time** from a static bank or a single generative call.
- The discovery agent has **multi-phase prompts** (CONTEXT → DISCOVERY → PRIORITIZE → EVP_FRICTION → WRAP_UP). The culture agent has **one system prompt** focused only on STAR analysis (`cultureAgentPrompts.ts:106–196`).

**Coverage scoring is absurdly binary.**
- `cultureAgent.ts:541`: `scoreTurnCoverage()` returns **1** if ≥3 STAR slots have `specificity >= 1`, else **0`. A near-perfect answer with 2 slots at specificity 2 gets zero credit.
- `cultureAgent.ts:433`: Termination requires `>= 1` coverage per dimension. Four mediocre answers in a dimension all score 0 → interview never terminates early → candidate is forced to answer more questions than needed.

**The generative planner's signal is systematically discarded.**
- `cultureGenerativePlanner.ts:37–43`: The planner produces `probeStrategy` with bespoke probes per question.
- `cultureAgentAdaptive.ts:426–429`: The comment admits *"We don't store the full probeStrategy in metadata (to keep transcript small), so we use a generic probe library."*
- **Impact:** The planner invents personalized probes; the FSM replaces them with `"Can you set the scene for me — when was this and who was involved?"` This is why it feels generic.

**The context builder destroys specificity.**
- `cultureAgentContext.ts:105–118`: `candidate_searchable_profile` is reduced to `company: "Previous role"`, `role: "Engineer"`, `durationMonths: 0`.
- `cultureAgentContext.ts:120–141`: `career_context_json` creates synthetic experiences with `durationMonths: 0` every time.
- **Impact:** The generative planner is told *"reference at least one specific detail from the candidate's background"* — but the background has been stripped of all specificity.

**The scoring pipeline is insanely expensive.**
- `cultureScorer.ts:10–13`: 11 LLM calls per interview (5 competency + 5 profile + 1 synthesis).
- `cultureScorer.ts:408, 474`: Re-prompt logic can add up to 10 more calls.
- `cultureAgentDecomposition.ts`: 1 decomposition call per answer (10 answers = 10 more calls).
- **Total: 21+ LLM calls per interview**, only 11 of which produce visible output.

**The `profile_probe_bank` does not exist.**
- The strategy v2 plan calls for a role-agnostic probe bank with 50–100 probes across 5 coverage dimensions.
- What exists: 15 competency-focused questions in `cultureQuestionBank.ts`.
- The gap: No probes for Experience, Technical, Motivation, or Context coverage.

**No temporal layering between Mode-1 and Mode-2.**
- If a candidate completes Mode-1, then Mode-2 for a role, the two sets of signals live in isolated `culture_interview_sessions` rows.
- There is no `supersedes` pointer. There is no "Mode-2 overwrites Mode-1 for this dimension."

### 2.4 Why the discovery agent is better — specific patterns to steal

| Pattern | Discovery Agent Location | Culture Agent Gap |
|---|---|---|
| **Pure reducer + deterministic phase** | `interviewReducer.ts:314–401` | Imperative FSM with implicit phase |
| **Heuristic answer evaluator** | `answerEvaluator.ts:56–97` | LLM on every answer |
| **Guard retry loop** | `generator.ts:239–338` | JSON.parse + mock fallback |
| **Per-domain batch generation + cache** | `domainOrchestrator.ts:126–258` | One question at a time |
| **Multi-phase prompt architecture** | `prompts.ts:439–740` | Single static prompt |
| **State patches (immutable)** | `domainOrchestrator.ts:42–46` | In-place mutation of scratchpad |
| **Partial JSON regex fallback** | `domainGenerator.ts:30–62` | Simple parse failure → mock |
| **Synthesis leak detection** | `generator.ts:210–212` | No equivalent |
| **Pre-collected field suppression** | `prompts.ts:336–347` | Re-asks facts from resume |

---

## 3. Target Architecture — The Discovery-Agent Pattern

### 3.1 The pattern

The discovery agent pattern is: **LLM call → structured JSON output → validation → DB write → embedding → downstream consumption.**

Every turn in the discovery agent produces:
1. **TurnAnalysis** — what happened this turn (answer quality, slots filled, gaps identified)
2. **ProbeDecision** — whether to probe, what to probe, or whether to advance
3. **NodeExtraction** (optional) — new sub-elements extracted from the answer

Termination produces:
1. **FinalDecomposition** — all extracted nodes batched for write
2. **ScoreReport** — BARS scores with evidence quotes

### 3.2 How the culture agent adopts this pattern

**Phase 1: Turn-level (per answer)**
```
Candidate answers
  → Heuristic answer evaluation (<1ms, no LLM)
    → If thin: serve warm follow-up (no LLM)
    → If adequate: run STAR analysis (1 LLM call)
      → Extract NodeExtraction via decomposition (1 LLM call, batched async)
        → Update coverage state
          → Decide: probe, next question, or terminate
```

**Phase 2: Termination-level**
```
Terminate triggered
  → Run scoring pipeline (11 LLM calls, parallel, in waitUntil)
    → Batch write all extracted nodes to candidate_nodes
      → Re-embed candidate (mean-pool resume + screener nodes)
        → Update status = 'enriched'
          → Fire matching asynchronously
```

### 3.3 The graph contract + profile synthesis

The culture agent produces **two parallel outputs** at termination:

**Output 1: `candidate_nodes` (matching signal)**

These node types are written to `candidate_nodes` for embedding and matching:

| Node Type | Source | Fields in `extracted_properties_json` |
|---|---|---|
| `CulturalSignal` | Mode-1, Mode-2 | `dimension`, `score_estimate`, `confidence`, `evidence_quote`, `turn_index` |
| `WorkingStyle` | Mode-1, Mode-2 | `style`, `evidence_quote`, `confidence` |
| `Motivation` | Mode-1 | `theme`, `evidence_quote`, `strength` |
| `ConflictHandling` | Mode-1, Mode-2 | `pattern`, `evidence_quote`, `confidence` |
| `SelfAwareness` | Mode-1, Mode-2 | `signal`, `evidence_quote`, `confidence` |
| `Experience` | Mode-1, Mode-2 | `company`, `role`, `start_date`, `end_date`, `duration_months`, `team_size`, `reporting_to`, `scope`, `narrative`, `key_accomplishments`, `technologies`, `inferred_skills` |
| `Project` | Mode-1, Mode-2 | `name`, `narrative`, `tech_stack`, `outcome`, `my_contribution` |
| `Skill` | Mode-1, Mode-2 | `name`, `proficiency_signal`, `evidence_source` |

**Critical distinction:** `Experience` nodes are not behavioral anecdotes. They are **chronological career history entries** — structured role descriptions with dates, scope, team size, and accomplishments. The profile builder explicitly elicits career history ("Walk me through your roles chronologically") before drilling for behavioral depth.

All nodes carry:
- `source_type`: `'automated_screener'` (Mode-1) or `'culture_interview'` (Mode-2)
- `source_reference`: `<session_id>`
- `captured_at`: epoch ms
- `confidence`: 0.0–1.0
- `supersedes`: pointer to prior node for same dimension (Mode-2 only)

**Output 2: `candidate_profile_json` (presentable profile)**

A single synthesis LLM call reads the full transcript and produces a rich structured profile:

```typescript
interface CandidateProfile {
  careerTimeline: Array<{
    company: string;
    role: string;
    startDate: string;
    endDate: string | null;
    durationMonths: number;
    teamSize: number | null;
    reportingTo: string | null;
    scope: string;
    narrative: string;
    keyAccomplishments: string[];
    technologies: string[];
  }>;
  skillsInventory: Array<{
    name: string;
    proficiency: 'mentioned' | 'demonstrated' | 'expert';
    evidenceQuote: string;
    yearsOfExposure: number | null;
  }>;
  projectPortfolio: Array<{
    name: string;
    narrative: string;
    techStack: string[];
    outcome: string;
    myContribution: string;
  }>;
  workingStyle: {
    summary: string;
    signals: Array<{ style: string; evidenceQuote: string }>;
  };
  motivation: {
    summary: string;
    optimizingFor: string[];
    badFitIndicators: string[];
  };
  context: {
    location: string | null;
    availability: string | null;
    preferredArrangement: string | null;
    preferredCompanyStage: string | null;
  };
  synthesizedAt: number;
  sourceSessionId: string;
}
```

This profile is:
- **Presentable** — renders as a structured career timeline for recruiters
- **Editable** — candidate can review and correct any field post-interview
- **Derived** — the `candidate_nodes` are extracted FROM this profile (not from per-turn decomposition)
- **Versioned** — `synthesizedAt` + `sourceSessionId` for audit

**Cost:** One additional LLM call at termination (~$0.20, ~3s). Runs in parallel with scoring and decomposition.

### 3.4 The new state machine

```
[consent]
   │ candidate clicks "Start Interview"
   ▼
[rapport_building] ──→ asks 1–2 warm-up questions, establishes baseline
   │ candidate answers, system evaluates specificity
   ▼
[probing] ──→ coverage-driven probe selection from profile_probe_bank
   │ candidate answers, NodeExtraction runs, coverage scores update
   │ loop until coverage_complete OR budget_exhausted
   ▼
[drilling] ──→ thin answers trigger warm follow-ups (heuristic, no LLM)
   │ loop back to [probing]
   ▼
[wrap_up] ──→ 1–2 summary/clarification questions
   │ candidate answers
   ▼
[scoring] ──→ 11 LLM calls (parallel), HITL gate (Mode-2 only)
   │
   ▼
[complete] ──→ decomposition batch write + transcript synthesis → re-embed → match trigger
```

**States removed from current FSM:** `in_progress` (split into `rapport_building`, `probing`, `drilling`, `wrap_up`).

**States added:** `rapport_building`, `drilling`, `wrap_up`.

**State transitions are deterministic** — computed by `buildPhaseDirective()` equivalent, not by LLM.

---

## 4. Two-Mode Specification

### 4.1 Mode-1: Profile Builder (Pre-Match)

**Trigger:** Candidate completes resume upload. `candidate_ingestion.status` transitions `embedded → enriching`.

**Goal:** Graph construction, not evaluation. Build enough behavioral signal that matching can make informed decisions.

**Probe bank:** `profile_probe_bank` table (new). Role-agnostic, coverage-driven across 5 dimensions. **Experience is split into two sub-dimensions:**

- **Career History** — chronological walkthrough of roles, companies, dates, responsibilities, team size, scope. Probes ask: *"Walk me through your career from first job to now."*
- **Behavioral Depth** — STAR stories extracted from specific roles. Probes ask: *"At [COMPANY], tell me about a time when..."*
- **Cultural** — ownership, collaboration, learning, conflict, self-awareness
- **Technical** — specific technology depth, system design exposure, debugging approach
- **Motivation** — what the candidate optimizes for, what bad fit looks like
- **Context** — location, availability, constraints, preferences

**Coverage target:** At least 2 probes per dimension, minimum 8 total turns, maximum 15. Career history probes run first (turns 1–3) to build the timeline; behavioral depth probes run later to enrich specific roles.

**Output (two parallel artifacts):**

1. **`candidate_nodes`** with `source_type = 'automated_screener'` — structured nodes for matching signal.
2. **`candidate_ingestion.profile_json`** — rich synthesized profile for presentation and candidate review.

No score report. No HITL gate.

**Candidate-facing:** After completion, the candidate sees their synthesized profile (career timeline, skills, projects) and can edit or correct any field. The profile is candidate-owned data.

**Blocking behavior:** `get-stage-config` returns `WAITING_FOR_MATCH` synthetic challenge until `status = 'enriched'`.

### 4.2 Mode-2: Role Fit (Post-Match)

**Trigger:** Candidate is matched to a role and reaches the culture interview stage.

**Goal:** Role-specific evaluation against RCD-calibrated BARS anchors.

**Probe bank:** `role_probe_bank` (existing) + RCD-enriched probes. Team-specific BARS overrides apply.

**Coverage target:** All 5 competency dimensions with at least 1 strong evidence quote. Maximum 15 turns.

**Output:** `candidate_nodes` with `source_type = 'culture_interview'` + `rcd_version` + `role_context_id`. Score report with HITL gate.

**Temporal layering:** Mode-2 nodes may supersede Mode-1 nodes for the same dimension. The `supersedes` pointer links Mode-2 → Mode-1. Matching against this role prefers Mode-2 nodes; matching against other roles falls back to Mode-1.

**Blocking behavior:** None. Candidate is already matched.

---

## 5. Integration with the Wider Pipeline

### 5.1 Stage progression gate

`get-stage-config` (`rpc.ts:314`) and `get-challenge` (`rpc.ts:501`) enforce blocking behavior:

```typescript
// Pseudocode for the gate
const ingestion = await db.prepare(`
  SELECT status FROM candidate_ingestion WHERE candidate_id = ?
`).bind(candidateId).first();

const isTailoredOrHybrid = pipelinePhilosophy !== 'validate';
const isCodeStage = nextStageType === 'CODE_REVIEW' || nextStageType === 'CODE_IMPLEMENTATION';

if (isTailoredOrHybrid && isCodeStage) {
  if (ingestion?.status !== 'enriched' && ingestion?.status !== 'matched') {
    return {
      id: 'waiting-for-match',
      type: 'WAITING_FOR_MATCH',
      title: 'Building your personalized challenge',
      instructions: 'We are analyzing your profile to find the best open-source project match. This takes 2–3 minutes.',
      config: { autoRefresh: true, refreshIntervalSeconds: 30 },
    };
  }
}
```

`submit-challenge-response` rejects submissions for `WAITING_FOR_MATCH` challenges.

### 5.2 Post-screener enrichment

The async pipeline triggered on Mode-1 termination:

```
screener termination
  → decompose transcript → candidate_nodes (batch insert)
    → embed any unembedded nodes (BGE, sequential)
      → mean-pool all vectors (resume + screener)
        → upsert aggregate to CANDIDATE_INDEX
          → update candidate_ingestion.status = 'enriched'
            → fire runCandidateMatching(candidateId, env) in waitUntil
```

Runs in `ctx.waitUntil()` so the HTTP response returns immediately. Total time: ~15–20s.

### 5.3 Matching consumption

`candidateSituationFit` (v4 prompt) consumes behavioral nodes:

```
# Candidate behavioral profile (from candidate_nodes)
## Cultural signals
- ownership: "quote" (score_estimate: 4, confidence: 0.85)
- collaboration: "quote" (score_estimate: 3, confidence: 0.72)
...

## Working style
- pair_programming: "quote" (confidence: 0.8)
- async_communication: "quote" (confidence: 0.6)

## Motivation
- optimizing_for: "impact" (strength: 5)
- bad_fit: "micromanagement" (strength: 4)
```

`triangulateMatch` adds a `behavioral_coverage` dimension from screener output.

### 5.4 Feedback loop

Assessment-derived nodes improve subsequent matching if:
- The candidate switches roles (Mode-2 nodes from Role A don't apply to Role B; Mode-1 nodes do)
- The candidate re-engages after 6+ months (new screener session supersedes old nodes)
- A recruiter overrides a score (AdjudicationNode records the correction)

---

## 6. Sequencing and Phases

### Phase 0: Foundation (1 week)
- Split `orchestrate.ts` into `runCandidateDiscovery` + `runCandidateMatching`
- Add `'enriched'` to `candidate_ingestion.status` enum
- Add blocking gate in `get-stage-config` / `get-challenge`
- **Validation:** Upload resume, verify status stops at `'embedded'`

### Phase 1: Graph Write + Re-embed (1–2 weeks)
- Implement `cultureAgentDecomposition.ts` → write to `candidate_nodes`
- Build `postScreenerEnrichment.ts` (async handoff)
- Wire `cultureAgent.ts` termination to trigger enrichment
- **Validation:** Complete screener, verify nodes written, verify vector updated

### Phase 2: Mode-1 Probe Bank (1–2 weeks)
- Create `profile_probe_bank` table
- Curate 25–50 role-agnostic probes (5–10 per dimension)
- Add `candidate_coverage` computation
- **Validation:** Run 5 test candidates, verify coverage gaps are probed

### Phase 3: Discovery-Agent Patterns (2–3 weeks)
- Add heuristic answer evaluator (`answerEvaluator.ts` pattern)
- Add guard retry loop (`generator.ts` pattern)
- Add state patches (immutable updates)
- Replace imperative FSM with reducer + phase directive
- **Validation:** Unit tests for reducer, E2E tests for full flow

### Phase 4: Prompt Engineering (1–2 weeks)
- Update `candidateSituationFit` to v4 (consumes behavioral nodes)
- Add `behavioral_coverage` to `triangulateMatch`
- **Validation:** A/B test match quality (old vs. enriched vector)

### Phase 5: Hardening (1–2 weeks)
- Retry logic in `postScreenerEnrichment`
- Failure recovery (candidate stuck at `'enriched'`)
- Recruiter retry button
- **Validation:** Chaos testing (kill worker mid-enrichment)

**Total: 6–9 weeks** for core resequencing.

### Dependencies

```
Phase 0 (blocking gate)
  └── No dependencies

Phase 1 (graph write)
  └── Requires Phase 0

Phase 2 (probe bank)
  └── Requires Phase 1
  └── BLOCKED BY: content curation (recruiter time, not engineering)

Phase 3 (redesign)
  └── Requires Phase 1
  └── CAN RUN IN PARALLEL with Phase 2

Phase 4 (prompt enrichment)
  └── Requires Phase 1 + Phase 2

Phase 5 (hardening)
  └── Requires all prior phases
```

### Riskiest assumptions

1. **BGE mean-pooling of screener nodes improves match quality.** Must validate with A/B test before declaring success.
2. **Candidates will complete a 10–15 minute screener before seeing their challenge.** Drop-off rate unknown.
3. **The `profile_probe_bank` can be curated without legal review.** Every probe must be job-related and non-discriminatory.

---

## 7. Honest Caveats

### What this plan does NOT fix

- **The Neo4j migration.** This plan stays on D1 + Vectorize. Per-element matching with Cypher queries is out of scope.
- **The UAR plugin migration.** The culture agent stays on its bespoke path. UAR integration is a separate workstream.
- **The frontend interview UI.** The plan mentions `WAITING_FOR_MATCH` UX but does not redesign the interview experience itself.
- **The implementation challenge scorer.** `/rpc/score-submission` returning null is a gap, but not in this workstream.
- **Public data enrichment (GitHub scraping).** Still not built. Still valuable. Still out of scope.

### What depends on other workstreams

- **Per-element matching (Part 5 of strategy v2):** The plan adds behavioral nodes to the graph, but matching still uses aggregate vectors. Full per-element matching requires Neo4j.
- **RCD v2 schema:** Mode-2's temporal layering assumes RCD versioning. If `rcd_version` is not stable, `supersedes` pointers become unreliable.
- **Skill adjacency table:** The plan does not build this. `matchRepos.ts` still does `skill.toLowerCase()` fallback.

### What will remain "good enough"

- **The 15-question static bank** will remain the fallback for Mode-2 when generative planning fails. It is good enough.
- **The 11-call scoring pipeline** will remain expensive. The plan does not optimize it.
- **D1 + Vectorize constraints** will remain limiting. The plan works within them.
- **The mock turn response** (`"Got it."`) will remain in tests. It does not affect production.
