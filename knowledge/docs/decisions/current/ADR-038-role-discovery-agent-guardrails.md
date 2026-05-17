# ADR-038. Role Discovery Agent Guardrails — Rationale, Sensitivity, Depth, Compliance

**Date:** 2026-04-17
**Status:** Proposed
**Extends:** [ADR-027](ADR-027-role-discovery-agent.md) (Role Discovery Agent), [ADR-028](ADR-028-multi-stakeholder-role-discovery.md) (Multi-Stakeholder Role Discovery)
**Complements:** [ADR-031](ADR-031-ai-hiring-compliance-architecture.md) (AI Hiring Compliance Architecture), [ADR-036](ADR-036-role-discovery-data-contract.md) (Role Discovery Data Contract)
**Applies pattern from:** [ADR-032](ADR-032-code-review-research-integration.md) (cross-family consistency classifier)
**Research brief:** `knowledge/role-discovery/role-discovery-guardrails.md` (98 cited sources, 4 parallel Sonnet researchers, PASS WITH NOTES)
**Author:** Claude Opus 4.7 (Lead Researcher) with founder

---

## Context

ADR-027 shipped the Role Discovery agent as a single ReAct loop with a self-emitted `reasoning: string` field. ADR-028 added multi-stakeholder variants. Brief 5 (2026-04-11) replaced the monolithic prompt with a phased posture-switching architecture (RD-25 through RD-42, RD-P5, DONE 2026-04-13). What remains missing — and what this ADR addresses — is the agent's *self-awareness* about why it's asking each question, whether the question is legally defensible, and when it should stop probing a thread.

A direct audit of `workers/api/src/lib/roleAgent.ts`, `roleAgentPrompts.ts`, and `routes/discovery/roleContexts.ts` identified five gaps that map 1:1 to findings in the guardrails research brief:

1. **`reasoning` is wasted.** `roleAgent.ts:47–63` declares `reasoning: string` and the model fills it, but it is unstructured free text, unused by any guardrail, invisible to the UI, and not available as a classifier signal. The agent is paying the tokens; we are throwing away the signal.
2. **Zero compliance scaffolding.** Full-text search across `roleAgentPrompts.ts` returns no occurrence of Title VII, EEOC, ADA, ADEA, GINA, protected class, or ADR-031 in any prompt. The agent is free to drift into legally forbidden territory with no prompt-level constraint.
3. **No numeric depth counter.** `buildPhaseDirective` tracks domain-level coverage but has no per-sub-topic follow-up counter. Laddering can run 4–5 rungs on one thread while the controller reads the domain as "covered." Candidates perceive this as invasive.
4. **Single-shot prompting.** The CORE_PROMPT self-checks against five named failure modes; nothing external verifies the output. ADR-032's cross-family consistency classifier pattern (Gemma guards Qwen in code review) is not yet applied to the role-discovery hot path.
5. **"Bad robot" is a binary signal.** No storage, no rubric, no labeling schema, no training-loop consumer. Cannot distinguish "invasive" from "off-topic" from "leading" from "repetitive."

Meanwhile, the legal landscape has sharpened. Mobley v. Workday was class-certified May 2025 with EEOC amicus support for the "agent theory" — platform vendors who substantially shape hiring workflow can face direct liability under Title VII/ADA/ADEA. California FEHA ADS regulations took effect October 2025; Colorado SB24-205 takes effect June 2026; Illinois HB 3773 takes effect January 2026; NYC LL144 has been active since 2023. The federal retreat (Trump administration's January 2025 removal of EEOC AI guidance) is legally irrelevant — the underlying statutes are unchanged and state enforcement is accelerating precisely because federal enforcement has retreated. Enterprise buyers in CA/CO/IL/NY face active state exposure regardless. A compliance-forward agent is a selling advantage, not a cost.

---

## Decision

**Extend `RoleAgentQuestionResponse` with a structured rationale schema, add a four-tier sensitivity ladder grounded in protected-class law, track per-sub-topic follow-up depth with a content-signal pivot heuristic, add a cross-family consistency classifier (Gemma 4 guards the role-discovery output), and wire a structured bad-robot feedback loop into a Karpathy-style offline training loop.**

The guardrails are additive to the phased architecture from RD-P5 — they do not replace it. Every change has a concrete codebase anchor.

### Schema extension

Replace the free-text `reasoning` field with a structured `rationale` object, **ordered before the `question` field** in the JSON schema (Tam et al. EMNLP 2024 key-ordering result — the schema ordering principle is sound; the specific 38.15% magnitude is task-specific to Last Letter Concatenation on LLaMA-3-8B and does not transfer directly).

```typescript
// workers/api/src/lib/roleAgent.ts
export type SensitivityTier = 'low' | 'medium' | 'high' | 'blocked';

export type TurnReference =
  | { kind: 'turn'; turn_id: string; quoted_span: string }
  | { kind: 'baseline'; baseline_field: string }
  | { kind: 'calibration' };

export interface QuestionRationale {
  fills: PersonaDimension;       // which RCD dimension this question populates
  grounded_in: TurnReference;    // what prior turn/baseline this references
  why_now: string;               // ≤ 200 chars, required for sensitivity ∈ {high}
}

export interface RoleAgentQuestionResponse {
  type: 'question';
  rationale: QuestionRationale;  // <-- ordered first (before question)
  sensitivity: SensitivityTier;
  depth_level: number;           // per sub-topic follow-up count (0-indexed)
  sub_topic_id: string;          // stable ID so the controller can count
  acknowledgment: string;        // brief rapport (kept from existing behavior)
  question: { id: string; text: string; input: InputSpec };
  knowledgeStateUpdate: KnowledgeStatePatch;
  domainCoverage: DomainCoverageUpdate;
  toolsUsed?: string[];
}
```

**Validator** (`workers/api/src/lib/roleAgentValidator.ts`, new):

- `rationale.grounded_in.kind === 'turn'` → `turn_id` must exist in actual exchange history; otherwise hard reject (prevents hallucinated prior-answer anchoring — the deceptive-explanation anchoring risk, cross-domain inference from Altay & Acerbi CHI 2025).
- `sensitivity === 'blocked'` → never emit; log + requeue with rejection signal.
- `sensitivity === 'high'` → `rationale.why_now` must be non-empty and contain a compelling job-relevance justification (classifier judges this independently, §Classifier).
- `depth_level ∈ [0, 2]` auto-approved; `depth_level === 3` requires `rationale.why_now`; `depth_level ≥ 4` blocked unless content signals (§Depth) indicate genuine value continues.

### Sensitivity ladder

Four tiers, injected into CORE_PROMPT and every phase prompt via the existing `RESPONSE_FORMAT_REMINDER` (the single injection point confirmed during audit):

| Tier | Category | Example forbidden surface | Statute anchor |
|---|---|---|---|
| **Blocked** | Protected-class-direct | Age, pregnancy, disability, national origin, religion, sexual orientation, marital status, citizenship status | Title VII, ADA, ADEA, GINA, PDA |
| **Blocked (state)** | Salary history, arrest-not-conviction, credit (non-financial roles) | "What did you make at your last job?" | CA FEHA, NYC LL144, various state salary-history bans |
| **High** | Protected-class-adjacent (permissible only with strong job-relevance justification) | Work authorization (for non-federal roles), schedule constraints that may proxy caregiver status, physical requirements | ADA reasonable-accommodation framework, Title VII disparate impact |
| **Medium** | Personal-but-role-defensible | Commute preferences, remote-work capability, time-zone overlap | Generally permissible, but privacy-proportionate (Gilliland 1993, McCarthy 2017) |
| **Low** | Work-content, skills, experience, goals, preferences about work | Stack, prior projects, code-review preferences | No legal constraint beyond general anti-discrimination |

The ladder is codified in `workers/api/src/lib/roleAgentSensitivity.ts` (new) as a YAML-loaded constant with per-tier prompt snippets. Every agent turn receives the ladder in its system prompt plus the explicit instruction: *"if your question would fall in Blocked or Blocked (state), do not ask it. If High, your `rationale.why_now` must justify compelling business necessity."*

### Depth tracking and pivot

Per-sub-topic counter lives on `ConversationContext`:

```typescript
interface ConversationContext {
  // ... existing fields from RD-P5
  subTopicDepth: Record<string, number>;  // sub_topic_id → follow-up count
  pivotTriggers: PivotSignal[];           // audit log of signal-triggered pivots
}

type PivotSignal =
  | { kind: 'depth_ceiling'; sub_topic_id: string; at: number }
  | { kind: 'circular_answer'; sub_topic_id: string; cosine: number }
  | { kind: 'length_collapse'; sub_topic_id: string; ratio: number }
  | { kind: 'dice_exhaustion'; sub_topic_id: string; probe_type: string };
```

**Ceiling:** `depth_level ≤ 3` per sub-topic. Convergent inference from laddering (Reynolds & Gutman 1988 — 3–4 abstraction rungs), motivational interviewing (MITI 4.2 — ≤ 3 consecutive questions is codeable fidelity), NICHD forensic protocol (Lamb 2007 — exhaust free-recall before directive), and 5-Whys. Reflexion's 3-cycles heuristic (Shinn NeurIPS 2023) is a weak analogy (LLM action-loop detection, not discourse), not a primary ground. *No direct empirical study of depth in AI hiring-intake dialogue exists — OQ-29 flags this as the highest-value production experiment.*

**Content signals (supplement the count, provisional thresholds pending calibration):**

| Signal | Measurement | Threshold | Action |
|---|---|---|---|
| Circular answer | Cosine similarity on sentence embedding (bge-small) between current response and prior same-sub-topic response | ≥ 0.82 | Pivot |
| Response-length collapse | Character count ratio vs. first answer in thread | < 20% sustained over 2 turns | Pivot |
| DICE funnel exhaustion | D → I → C → E probe types all used on this sub-topic with no new information | all four used | Pivot |

Controller logs every signal-triggered pivot to `pivotTriggers` for offline calibration (OQ-32).

### Cross-family consistency classifier

Extends ADR-032's Gemma-guards-Qwen pattern, inverted: here Qwen guards Gemma on the role-discovery hot path. The role-discovery agent runs `gemma-4-26b-a4b-it` as its primary model on **Vertex AI MaaS in production** (`ROLE_AGENT_PROVIDER=vertex-ai`), with the Workers AI `env.AI` binding as the resilience fallback when Vertex is unhealthy (same model ID on both paths — only the provider differs; see `workers/api/src/lib/llm/createProvider.ts` and the CLAUDE.md routing table). The classifier must be a different model family — we use `@cf/qwen/qwen3-30b-a3b-fp8` on Workers AI: an MoE with 3B active parameters and FP8 quantization (already used in the codebase as `scorerAgent.ts` fallback), fast enough for a per-turn guard, and cross-family from Gemma (Alibaba Qwen training lineage ≠ Google Gemma). Pinning the classifier to Workers AI regardless of the primary's provider keeps the guardrail available even when Vertex is unhealthy.

Panickssery et al. NeurIPS 2024 established causally (label-swap experiment on GPT-4/GPT-3.5) that same-family judging produces self-preference bias. The Gemma-judges-Gemma case is mechanistically identical; cross-family independence is non-negotiable. Qwen3-judges-Gemma-4 satisfies the cross-family requirement (the inverse pairing of ADR-032's Gemma-judges-Qwen — the causal self-preference finding applies symmetrically to any same-family judging, so different-family in either direction is the load-bearing property).

**Classifier schema (4 axes):**

```typescript
interface GuardrailClassifierOutput {
  on_topic: { pass: boolean; evidence: string };
  proportionate: { pass: boolean; tier_match: SensitivityTier; reason: string };
  probe_type_fit: { pass: boolean; dice_stage: 'D' | 'I' | 'C' | 'E'; expected: string };
  fatigue_risk: { pass: boolean; risk_level: 'low' | 'medium' | 'high'; signal?: PivotSignal };
}
```

If any axis fails, the agent's output is rejected and the agent is re-prompted with the classifier reasoning as additional context. Three consecutive rejections on the same sub-topic escalate to a hard pivot (forced phase advancement).

The classifier runs **after** validator rejection logic — the validator catches hard schema violations (hallucinated `turn_id`, `blocked` sensitivity, missing `why_now` at depth 3); the classifier catches semantic failures that pass the schema.

**Calibration (OQ-36):** classifier launches in shadow mode (logs decisions, does not block) on a % of production traffic. Promote to blocking only once classifier-vs-human κ ≥ 0.60 on D1–D7 labeling.

### Bad-robot feedback loop + Karpathy training loop

New D1 migration `0032_role_context_feedback.sql`:

```sql
CREATE TABLE role_context_feedback (
  id INTEGER PRIMARY KEY,
  role_context_id INTEGER NOT NULL REFERENCES role_contexts(id) ON DELETE CASCADE,
  turn_id TEXT NOT NULL,
  sub_topic_id TEXT,
  reason_category TEXT NOT NULL,   -- 'D1'..'D7' (see rubric below)
  reason_text TEXT,                -- optional user free-text
  classifier_output_json TEXT,     -- snapshot of classifier judgment at emission
  agent_rationale_json TEXT,       -- snapshot of rationale at emission
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL         -- 'candidate' | 'recruiter' | 'admin'
);

CREATE INDEX idx_rcf_role_context ON role_context_feedback(role_context_id);
CREATE INDEX idx_rcf_category ON role_context_feedback(reason_category);
```

**D1–D7 rubric** (from guardrails brief Part 1.2, grounded in 22 sources):

- D1 Job Relevance — "not related to the job"
- D2 Behavioral Specificity — "too vague / too abstract"
- D3 Construct Singularity — "asking about two things at once"
- D4 Non-Leading — "puts words in my mouth"
- D5 Privacy Proportionality — "feels invasive"
- D6 Non-Repetitiveness — "you already asked me that"
- D7 Transparent Purpose — "why are you asking me this?"

The feedback UI reveals D1–D7 after a bad-robot click (single-tap picker; skip allowed, falls back to general flag). The classifier and rationale snapshots are attached at write-time — the dataset for offline eval does not depend on re-running the agent.

**Karpathy-style training loop:**

1. Human labels accumulate in `role_context_feedback`.
2. Offline auto-labeling via Claude Sonnet 4.6 (Agent tool path) produces candidate labels on a broader sample (turns that weren't flagged) using the same D1–D7 rubric.
3. Offline κ agreement (Sonnet vs. production classifier) is measured quarterly.
4. If classifier κ drifts below 0.60 on any D1–D7 dimension, the classifier is retrained (or the agent prompt is patched) and the change is gated on κ recovery in a shadow run before flipping live.

The training loop does not modify production model weights (we don't fine-tune Workers AI). It gates **prompt changes and classifier adjustments** on measured agreement.

---

## Consequences

**Wins:**

- Agent self-censors on Blocked-tier questions — legal exposure on the known-bad categories closes at the prompt layer, not at post-hoc review.
- Structured `rationale` is a classifier signal, not just UX chrome — the guardrail pipeline has something to read.
- Per-sub-topic depth counter fixes the laddering-runaway failure mode the founder reported anecdotally ("some things feel a bit invasive" — the invasiveness is usually a depth problem, not a content problem).
- Cross-family classifier extends ADR-032's independence guarantee to the discovery hot path — no same-family self-preference in guardrails.
- `role_context_feedback` turns the bad-robot button from noise into training data — every flag is now labeled by D1–D7 dimension with classifier/rationale context attached.
- Compliance-forward stance is a selling advantage to CA/CO/IL/NY enterprise buyers regardless of federal posture.

**Costs:**

- Every agent turn now makes two LLM calls (agent + classifier) instead of one. Primary is Gemma 4 26B on Vertex AI MaaS (metered per-token, no daily cap) with Workers AI binding as fallback; classifier is Qwen3-30b-a3b-fp8 (`@cf/qwen/qwen3-30b-a3b-fp8`) on Workers AI. MoE architecture with 3B active params + FP8 quant keeps per-turn classifier latency and neuron cost low at MVP volume, measured explicitly before phase gate.
- `RoleAgentQuestionResponse` schema change is breaking for downstream consumers — all call sites that read `.reasoning` must migrate to `.rationale`. Expected scope: `roleAgent.ts`, `routes/discovery/roleContexts.ts`, any UI that surfaced the reasoning field (none today).
- Validator rejection + classifier re-prompt can add latency on edge cases (we expect ≤ 1% of turns to hit rejection at steady state; gated by classifier κ).
- The D1–D7 feedback UI adds one tap to the bad-robot flow. Accept in favor of data quality.

**Risks accepted:**

- **3-turn threshold is inference, not empirical fact in our domain.** The ceiling rests on four converging traditions (laddering, MI, NICHD, 5-Whys) but no direct study has measured depth yield vs. bad-robot rate in AI hiring intake specifically. Open question OQ-29 flags this as the highest-value production experiment — vary k ∈ {1, 2, 3, 4} on a subset of traffic, measure bad-robot rate + information yield per dimension.
- **Mobley v. Workday is a live legal risk, not adjudicated liability.** Class cert + EEOC amicus is sufficient to design around (the agent theory survived dismissal), but the court has not ruled on the merits. If Mobley settles or loses on the merits, the agent-theory framing weakens — but the state-law overlay (CA/CO/IL/NY) remains and is the primary design constraint regardless.
- **Deceptive-explanation anchoring (β=0.32) is cross-domain inference.** The effect size was measured on misinformation-belief change (Altay & Acerbi CHI 2025), not hiring-conversation anchoring. The directional concern — that incorrect rationale is more persuasive than no rationale — is supported by the broader deceptive-explanation literature, but the specific magnitude does not transfer. Mitigation: validator hard-rejects hallucinated `turn_id` references, so the failure mode is blocked at the schema layer regardless of transfer fidelity.
- **Cross-family classifier with Qwen-guards-Gemma is architecturally sound but untested on role-discovery dimensions.** Panickssery 2024 establishes the cross-family requirement causally for GPT-family models; extension to the Qwen/Gemma pairing is inference (though ADR-032 makes the converse inference for Gemma-guards-Qwen in code review). Mitigation: OQ-36 shadow-mode rollout with κ ≥ 0.60 gate before blocking.

---

## Sequencing

Five implementation milestones, grouped into three PRs:

### PR1 — M1 (schema) + M3 (depth) — recommended first

Both are schema-level and cheap. Together they unblock M2, M4, M5.

**M1 — Question schema:**
- `roleAgent.ts` — add `QuestionRationale`, `SensitivityTier`, `TurnReference`, `GuardrailClassifierOutput` types
- Replace `reasoning: string` with `rationale: QuestionRationale` on `RoleAgentQuestionResponse`; order before `question`
- Update `RESPONSE_FORMAT_REMINDER` in `roleAgentPrompts.ts` to describe the new schema (avoid constrained-decoding JSON-mode; use two-pass NL-to-Format per Tam 2024)
- New `roleAgentValidator.ts` — schema + `turn_id` existence + `blocked` hard-stop
- Migrate any call site reading `.reasoning` (audit shows: none surface it today)

**M3 — Depth tracking:**
- Add `subTopicDepth: Record<string, number>` and `pivotTriggers: PivotSignal[]` to `ConversationContext`
- Controller tracks depth per `sub_topic_id`; pivot at 3 unless `rationale.why_now` justifies extension
- Implement three content signals (cosine similarity, length collapse, DICE exhaustion) in controller
- Log all pivots to `pivotTriggers` for offline calibration

**Gate:** TypeScript clean + unit tests green + no behavior change on the happy path (rationale is emitted but not exposed to user; depth ceiling is set to 5 in PR1 to avoid disruption, tightened to 3 in PR2).

### PR2 — M2 (sensitivity) + M4 (classifier)

**M2 — Sensitivity ladder:**
- `roleAgentSensitivity.ts` — tier definitions + per-tier prompt snippets
- Inject into CORE_PROMPT and every phase prompt via `RESPONSE_FORMAT_REMINDER`
- Validator enforces `blocked` hard-stop and `high` requires `why_now`

**M4 — Cross-family classifier:**
- `roleDiscoveryGuardrailClassifier.ts` — Qwen3-30b-a3b-fp8 MoE (`@cf/qwen/qwen3-30b-a3b-fp8`) system prompt + 4-axis judgment schema; invoked via `env.AI.run(...)` regardless of the primary agent's provider
- Runs after validator, before emission
- Shadow mode initially (logs decisions, does not block); blocking mode once κ ≥ 0.60 on D1–D7 in offline eval
- Three-strike rule: three consecutive rejections on same sub-topic → forced phase advancement

**Gate:** shadow-mode κ measured for 2 weeks; promote to blocking only if κ ≥ 0.60.

### PR3 — M5 (feedback loop + training loop)

- Migration `0032_role_context_feedback.sql`
- API: `POST /api/v1/role-contexts/:id/feedback` with D1–D7 category + optional text + auto-attach classifier + rationale snapshots
- UI: bad-robot button reveals D1–D7 picker; skip falls back to general flag
- Offline skill (`.claude/commands/auto-label-role-discovery.md`) — Sonnet 4.6 via Agent tool, D1–D7 labels on unflagged turns, output to `role_context_feedback_auto`
- Quarterly κ measurement; gate prompt/classifier changes on κ recovery in shadow run

---

## Verification

**Unit tests (green required before merge):**

- `workers/api/src/lib/__tests__/roleAgentValidator.test.ts` — turn_id existence, blocked hard-stop, high-without-why_now rejection, depth ceiling enforcement
- `workers/api/src/lib/__tests__/roleAgentSensitivity.test.ts` — tier assignment for ~30 example questions spanning D1–D7
- `workers/api/src/lib/__tests__/guardrailClassifier.test.ts` — 4-axis judgment against fixture cases
- `workers/api/src/lib/__tests__/depthTracking.test.ts` — sub_topic_id counting, content-signal triggering, pivot log

**Integration/BDD:**

- `workers/api/src/__tests__/roleAgentGuardrails.e2e.test.ts` — full turn with rationale → validator → classifier → emission; reject path with re-prompt
- One "tripwire" test that asks an explicitly Blocked question via a forced prompt and verifies: validator rejects, counter increments, emission never reaches UI

**Offline calibration (OQ-29, OQ-32, OQ-36):**

- CAL-RD-1: 3-turn threshold experiment — 500 turns per k ∈ {1, 2, 3, 4} on shadow traffic; measure bad-robot rate + information yield per D1–D7
- CAL-RD-2: cosine similarity threshold — calibrate against human "circular" labels on 500 production turns
- CAL-RD-3: classifier κ — D1–D7 agreement with human labels; gate blocking mode on κ ≥ 0.60

---

## Decision log

| Date | Decision | Rationale |
|---|---|---|
| 2026-04-17 | Rationale ordered *before* question in JSON schema | Tam et al. EMNLP 2024 key-ordering principle; domain-specific magnitude (38.15% on Last Letter Concatenation) does not transfer, but the ordering direction does |
| 2026-04-17 | Avoid JSON-mode constrained decoding | Tam 2024 second finding — constrained-decoding JSON-mode suppresses free-form reasoning; use two-pass NL-to-Format instead |
| 2026-04-17 | Gemma-4-26B primary (Vertex AI prod / Workers AI default) + Llama-3.1-8B classifier on Workers AI (not Gemma-4-12B, not Qwen-3B) | Different family from primary is required; Gemma-4-12B shares lineage with the role-discovery primary and would reintroduce self-preference bias (Panickssery 2024 establishes this causally). `@cf/meta/llama-3.1-8b-instruct` is confirmed available on Workers AI, is cross-family from Gemma, and keeps the guardrail available on the `env.AI` binding even when the Vertex path is unhealthy. (Qwen-3B was considered during drafting but no `@cf/qwen/qwen2.5-3b-instruct` model ID was verified against the Cloudflare catalog — rejected at the time.) |
| 2026-04-18 | **Superseded:** classifier = `@cf/qwen/qwen3-30b-a3b-fp8` MoE on Workers AI (replaces 2026-04-17 Llama-8B pick) | Qwen3-30b-a3b-fp8 is already used in the codebase as `scorerAgent.ts` fallback — verified on Workers AI. MoE architecture (3B active params) + FP8 quant keeps per-turn latency low. Still cross-family from Gemma (Alibaba Qwen ≠ Google Gemma per Panickssery 2024 independence requirement) — satisfies the load-bearing property that Llama-8B would also have satisfied, at higher capability for classifier judgments. Classifier stays pinned to Workers AI regardless of primary provider so the guardrail is independent of Vertex availability. |
| 2026-04-18 | **All Gemma usage migrates to Vertex AI MaaS (prod) with Workers AI binding as fallback** | Covers role-discovery (already routed), culture interview agent, culture scorer, issue-scorer cron, production code-review scorer (via provider), and the planned ADR-032 code-review consistency classifier (CR-5, not yet built). Rationale: Vertex is per-token with no daily cap; Workers AI free-tier neurons/day would be exhausted by culture scorer (11 calls/run) × per-turn classifier × role-discovery at scale. Same `gemma-4-26b-a4b-it` model on both paths; only the provider differs. Qwen Coder (code-review implementer), Qwen3-30b-a3b-fp8 (RD classifier), Whisper, and BGE embeddings stay on Workers AI — not available on Vertex MaaS and edge-binding latency is fine for their profile. |
| 2026-04-17 | Validator hard-blocks hallucinated `turn_id` | Closes deceptive-explanation anchoring at schema layer; removes the need for the β=0.32 cross-domain transfer to be precise |
| 2026-04-17 | `sensitivity: 'blocked'` hard stop, never emit | iTutorGroup $365K settlement establishes this exact category as live enforcement; Mobley class cert extends to platform vendors |
| 2026-04-17 | 3-turn depth ceiling is soft, extensible via `why_now` | Convergent inference from 4 traditions + 1 weak analogy; no direct study in AI hiring intake. Soft ceiling + content signals + OQ-29 empirical experiment path |
| 2026-04-17 | Classifier launches in shadow mode | ADR-032 precedent — don't block production on untested classifier. Promote to blocking on κ ≥ 0.60 |
| 2026-04-17 | D1–D7 feedback rubric, single-tap picker | Grounded in 22 sources from I/O psych + item-writing + HCI chatbot-failure taxonomies; single-tap preserves response rate while labeling the signal |
