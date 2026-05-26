# Culture Agent Redesign — Work Item Index

**Source strategy:** `knowledge/plan/culture-agent-redesign/culture-agent-redesign-master.md`  
**Generated:** 2026-05-02  

---

## Phase 0 — Foundation

### Already covered / linked elsewhere

| Item | Subagent | Status | Notes |
|---|---|---|---|
| Split orchestrate.ts into discovery/matching | Backend Team | IN-PROGRESS | See `orchestrate.ts` refactor |
| Add `status='enriched'` to candidate_ingestion | Backend Team | PENDING | Needs migration |

### New work items — full plan files

| Item | File | Status | Subtasks | Owner |
|---|---|---|---|---|
| Blocking gate in stage progression | `integration/stage-progression-gate.md` | PENDING | 4 | Backend Team |
| Async post-screener enrichment orchestrator | `integration/post-screener-matching-trigger.md` | PENDING | 5 | Backend Team |

---

## Phase 1 — Graph Write + Re-embed

### Already covered / linked elsewhere

| Item | Subagent | Status | Notes |
|---|---|---|---|
| `candidate_nodes` table schema | Infrastructure Team | COMPLETE | Exists in D1 since migration 00xx |
| BGE embedding pipeline | Backend Team | COMPLETE | `embed.ts` already works |

### New work items — full plan files

| Item | File | Status | Subtasks | Owner |
|---|---|---|---|---|
| Decomposition pipeline (transcript → candidate_nodes) | `implementation/decomposition-pipeline.md` | PENDING | 6 | Culture Agent Team |
| Culture agent audit (brutal) | `implementation/culture-agent-audit.md` | PENDING | 8 | Culture Agent Team |
| Discovery agent pattern analysis | `implementation/discovery-agent-analysis.md` | PENDING | 5 | Culture Agent Team |

---

## Phase 2 — Mode-1 Probe Bank

### New work items — full plan files

| Item | File | Status | Subtasks | Owner |
|---|---|---|---|---|
| Mode-1 Profile Builder specification | `implementation/mode-1-profile-builder.md` | PENDING | 7 | Culture Agent Team |
| Mode-2 Role Fit specification | `implementation/mode-2-role-fit.md` | PENDING | 5 | Culture Agent Team |
| Profile probe bank curation | *(content work, no plan file)* | PENDING | — | Recruiter + Content Team |

---

## Phase 3 — Discovery-Agent Patterns

### New work items — full plan files

| Item | File | Status | Subtasks | Owner |
|---|---|---|---|---|
| Agent flow specification (new E2E) | `architecture/agent-flow-spec.md` | PENDING | 6 | Culture Agent Team |
| State machine specification | `architecture/state-machine-spec.md` | PENDING | 5 | Culture Agent Team |
| Decomposition contract | `architecture/decomposition-contract.md` | PENDING | 4 | Culture Agent Team |
| Prompt system specification | `architecture/prompt-system-spec.md` | PENDING | 5 | Culture Agent Team |
| Scoring engine redesign | `implementation/scoring-engine.md` | PENDING | 4 | Culture Agent Team |
| Telemetry and observability | `implementation/telemetry-and-observability.md` | PENDING | 3 | Culture Agent Team |

---

## Phase 4 — Prompt Enrichment

### New work items — full plan files

| Item | File | Status | Subtasks | Owner |
|---|---|---|---|---|
| Matching consumption of behavioral nodes | `integration/candidate-nodes-consumer.md` | PENDING | 4 | Matching Team |
| Frontend changes (WAITING_FOR_MATCH UX) | `integration/frontend-changes.md` | PENDING | 3 | Frontend Team |

---

## Phase 5 — Validation + Hardening

### New work items — full plan files

| Item | File | Status | Subtasks | Owner |
|---|---|---|---|---|
| Evaluation criteria | `validation/evaluation-criteria.md` | PENDING | 3 | QA Team |
| Golden set definition | `validation/golden-set-definition.md` | PENDING | 2 | QA Team |
| A/B test protocol | `validation/ab-test-protocol.md` | PENDING | 3 | QA Team |
| Rollback plan | `validation/rollback-plan.md` | PENDING | 2 | DevOps Team |

---

## Ambiguous items flagged

1. **Does Mode-1 run for ALL candidates or only those in tailored/hybrid pipelines?** — The master plan says block tailored/hybrid only. But if a validate-pipeline candidate completes Mode-1, their graph is enriched for free. Should validate also run Mode-1 (non-blocking)? — **Recommended resolution:** Run Mode-1 for all philosophies. Only block progression for tailored/hybrid. Validate gets the enriched graph as a bonus.

2. **What happens if a candidate abandons Mode-1 after 3 questions?** — Partial graph exists but coverage is thin. Do we still run matching? Do we mark `status = 'failed'` or `status = 'embedded'` with a partial flag? — **Recommended resolution:** Add `status = 'partial'` and a `coverage_json` field. Matching runs with a discounted confidence. Recruiter can see partial coverage and decide.

3. **Who curates the `profile_probe_bank`?** — Engineering can build the table and schema, but the probes must be recruiter-approved for compliance. NYC Local Law 144 requires every probe to trace to a finite approved bank. — **Recommended resolution:** Recruiter team owns curation. Engineering owns the schema and ingestion pipeline. ~~Block Phase 2 on recruiter availability.~~ **Decision 2026-05-02:** Not blocking — pre-launch workaround acceptable; will address compliance before first customer.

4. **Do we retire `cultureAgent.ts` (static bank) entirely or keep it as Mode-2 fallback?** — The generative planner is flaky (falls back to static on any failure). The static bank is reliable. — **Recommended resolution:** Keep static bank as fallback for Mode-2. Mode-1 uses `profile_probe_bank` exclusively. No generative planner for Mode-1 (too risky for a blocking gate).

5. **How does the frontend handle `WAITING_FOR_MATCH`?** — Current stage progression assumes every stage has a challenge with a repo/PR. A synthetic challenge with no repo is a new pattern. — **Recommended resolution:** Frontend renders a spinner + progress message. Polls `get-stage-config` every 30s. No code changes needed beyond handling `type = 'WAITING_FOR_MATCH'`.
