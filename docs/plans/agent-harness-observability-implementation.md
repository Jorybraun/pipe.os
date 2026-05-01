# Plan: Agent-Harness Observability Implementation

> **Status:** Planned, ready to execute when project stabilizes  
> **Target:** `observability-recruiter-status.md` + `reliability-retry-and-error-classification.md`  
> **Environment:** `agent-harness-demo` worktree container (safe, isolated, `.env`-protected)

---

## Why Observability First

- Entirely D1-native — no Neo4j dependency, no schema conflicts with in-flight work
- Recruiter status SSE gives immediate value (recruiters see pipeline progress instead of opaque "failed")
- Retry helper is foundational — every other reliability plan sits on top of it
- Both plans have clear, delegable subtasks with bounded file scopes

---

## Execution Strategy

### Phase A — Retry Helper (0.5 days)

**Delegate to agent-harness as a single subtask.**

**Inputs for agent:**
- `knowledge/plan/strategy-v2/part5-matching-migration/reliability-retry-and-error-classification.md`
- Existing LLM call sites: `workers/api/src/lib/candidateDiscovery/embed.ts`, `workers/api/src/lib/roleDiscovery/embedRole.ts`, `workers/api/src/lib/candidateDiscovery/candidateSituationFit.ts`

**Agent deliverable:**
- `workers/api/src/lib/ai/retryHelper.ts` + `.test.ts`
- Wrapped call sites in the three files above
- No signature changes — only inner call wrapping

**Verification in container:**
```bash
cd agent-harness && docker compose run --rm agent-harness-demo bash -c \
  "cd /app && npx vitest run workers/api/src/lib/ai/retryHelper.test.ts"
```

---

### Phase B — Recruiter Status Schema (0.5 days)

**Delegate to agent-harness as two parallel subtasks:**

**Subtask B1 — D1 Migration**
- File: `workers/api/migrations/0060_structured_ingestion_status.sql`
- Spec from plan: `current_step`, `step_timestamps_json`, `estimated_completion_at`, `recovery_options_json`, `failure_step`, `failure_reason`

**Subtask B2 — Step Duration Tracker**
- Files: `workers/api/src/lib/telemetry/stepDurationTracker.ts` + `.test.ts`
- Table: `step_duration_samples` (last 500 rows per step)
- Exports: `recordStepDuration`, `getP50Duration`, `estimateCompletion`

**Verification in container:**
```bash
# Apply migration locally (D1 local dev)
npx wrangler d1 migrations apply pipe-dev --local
# Run tracker tests
npx vitest run workers/api/src/lib/telemetry/stepDurationTracker.test.ts
```

---

### Phase C — SSE Endpoint (0.5 days)

**Delegate to agent-harness as a single subtask.**

**Agent inputs:**
- Schema from Phase B
- Existing route patterns in `workers/api/src/routes/cockpit/`

**Agent deliverable:**
- `workers/api/src/routes/cockpit/ingestionStatus.ts`
- Route: `GET /api/v1/candidates/:id/ingestion-status/stream`
- Clerk JWT check, 3-second poll loop, terminal-state auto-close

**Verification in container:**
```bash
# Start local dev server
npm run dev
# In another terminal, curl the SSE endpoint
curl -N -H "Authorization: Bearer $TEST_TOKEN" \
  http://localhost:8787/api/v1/candidates/test-id/ingestion-status/stream
```

---

### Phase D — Orchestrator Integration (0.5 days)

**Manual or delegated — touches the critical path.**

Update `workers/api/src/lib/candidateDiscovery/orchestrate.ts`:
- Call `recordStepDuration` after each step
- Update `candidate_ingestion.current_step` after each transition
- Set `estimated_completion_at` via `estimateCompletion`
- Populate `failure_reason` + `recovery_options` on failure

**This is the riskiest change** — it touches `runCandidateIngestion`, which is production-critical. The agent should make the minimal possible diff and preserve all existing error-handling behavior.

**Verification:**
- Run full ingestion E2E test
- Verify SSE stream shows step progression
- Verify `failed_transient` populates recovery options

---

## Agent-Harness Workflow

### 1. Prep the worktree

```bash
./agent-harness/scripts/demo-reset.sh
```

This resets `demo/harness` to current HEAD, clean state.

### 2. Start the harness in daemon mode

```bash
cd agent-harness
docker compose run -d -p 8765:8765 -p 8766:8766 \
  --name agent-harness-observability \
  agent-harness-demo \
  python -m agent_harness.server --transport sse \
  --host 0.0.0.0 --port 8765 --ws-port 8766 --data-dir /app/.swarm
```

### 3. Send tasks to the agent

Via MCP SSE or WebSocket:
- Task A: "Implement retryHelper.ts per spec in `reliability-retry-and-error-classification.md`"
- Task B1: "Write migration `0060_structured_ingestion_status.sql` per spec"
- Task B2: "Implement stepDurationTracker.ts per spec"
- Task C: "Implement ingestionStatus SSE route per spec"

### 4. Review in worktree

```bash
# Diff the worktree against main
git diff claude-dev..demo/harness
```

### 5. Merge back

```bash
git checkout claude-dev
git merge demo/harness
```

---

## Safety Guardrails

- **No `.env` exposure** — worktree has no `.env` files (gitignored), harness gets keys via docker-compose env vars
- **No main repo mutation** — worktree is isolated; stash/reset only affects `demo/harness`
- **Test-first** — every subtask includes unit tests; agent must make tests pass before claiming completion
- **Minimal diff** — Phase D (orchestrator) should be reviewed manually; agent can scaffold but human signs off

---

## Open Questions to Resolve Before Execution

1. **Migration number** — `0060` assumed; confirm `workers/api/migrations/` highest number at execution time
2. **OTel dependency** — `observability-recruiter-status.md` says it depends on `reliability-idempotency-and-partial-materialization.md` for migration numbering. Since we're skipping OTel, confirm no column conflicts
3. **Clerk admin role** — `ingestionStatus.ts` route requires admin role check; verify current admin middleware location
