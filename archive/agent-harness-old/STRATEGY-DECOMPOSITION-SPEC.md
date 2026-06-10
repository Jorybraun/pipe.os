# Strategy Decomposition Spec

How to break a large strategy document into swarm-executable plan files.

---

## Two-tier architecture

```
knowledge/plan/                          docs/plans/strategy-v2/
├── pipe-strategy-v2-part1-*.md          ├── part1-north-star/
├── pipe-strategy-v2-part2-*.md          │   ├── plan-a.md
├── pipe-strategy-v2-part3-*.md          │   ├── plan-b.md
├── pipe-strategy-v2-part4-*.md          │   └── INDEX.md
├── pipe-strategy-v2-part5-*.md          ├── part2-role-discovery/
└── pipe-strategy-v2-part6-*.md          │   ├── plan-c.md
    (6 source strategy docs)             │   └── INDEX.md
                                         ├── part3-repo-ingestion/
                                         ├── part4-candidate-ingestion/
                                         ├── part5-matching-migration/
                                         ├── part6-market-research/
                                         └── README.md
```

| Tier | Location | Audience | Granularity |
|------|----------|----------|-------------|
| **Source strategy** | `knowledge/plan/pipe-strategy-v2-part{N}-*.md` | Humans, product, leadership | Big themes, 6 documents |
| **Execution plans** | `docs/plans/strategy-v2/part{N}-*/{plan}.md` | Swarm, developers, broker | Delegable chunks, ≤1 week, ≤3 files |

**Rule of thumb:** If a work item needs more than one week or touches more than ~3 files, it gets its own execution plan file.

---

## Execution plan file format

Every `.md` in `docs/plans/strategy-v2/` must follow this structure:

```markdown
# Plan Title

**Source:** knowledge/plan/pipe-strategy-v2-part4-candidate-ingestion.md (lines 86–108)
**Phase:** 2
**Status:** PENDING
**Estimate:** 3 days

## Why

One paragraph explaining the business or technical motivation.

## Acceptance criteria

- [ ] Criterion 1 — evidence: `e2e/foo.spec.ts:42`
- [ ] Criterion 2 — evidence: `workers/api/src/lib/bar.test.ts`

## Subtasks

### Subtask 1 — Create schema migration

**Status:** PENDING

Add `candidate_nodes` table with columns `id`, `candidate_id`, `node_type`, `extracted_properties_json`.

**Files:**
- `workers/api/migrations/0045_candidate_nodes.sql`
- `workers/api/src/lib/candidateDiscovery/schema.ts`

### Subtask 2 — Write insert helper

**Status:** PENDING

Create `insertCandidateNode()` with validation.

**Files:**
- `workers/api/src/lib/candidateDiscovery/nodes.ts`
- `workers/api/src/lib/candidateDiscovery/nodes.test.ts`

## Dependencies

- Depends on: [role-nodes-migration](part2-role-discovery/phase2-role-nodes-migration.md)
- Blocks: [candidate-matching-sub-elements](candidate-matching-sub-elements.md)
```

---

## Required frontmatter

| Field | Required | Values | Purpose |
|-------|----------|--------|---------|
| `**Source:**` | Yes | `knowledge/plan/...md (lines X–Y)` | Traceability back to strategy doc |
| `**Phase:**` | Yes | `0, 1, 2, 3, 4, ...` | Execution ordering. Phase 0 = foundation/cutover. Higher = depends on lower. |
| `**Status:**` | Yes | `PENDING, NEEDS-REFINEMENT, DEFERRED, REDIRECT` | Swarm only picks up `PENDING` |
| `**Estimate:**` | No | `3 days, 1 week` | Rough sizing for sprint planning |

---

## Subtask block format

```markdown
### Subtask {N} — {Title}

**Status:** PENDING

{Spec paragraph — what to build, why, constraints}

**Files:**
- `path/to/file.ts`
- `path/to/migration.sql`
```

**Rules:**
- Each subtask gets a `### Subtask N — Title` heading
- `**Files:**` block is parsed by `plan_walker.py` — use backtick-wrapped paths, one per line
- Migration numbers in filenames (e.g. `0045_*.sql`) are auto-extracted into the `migrations` field
- `**Status:**` inside subtasks is optional; defaults to `PENDING`

---

## Dependencies block format

```markdown
## Dependencies

- Depends on: [plan-title](relative-path-to-plan.md)
- Blocks: [other-plan-title](other-plan.md)
```

**Rules:**
- `Depends on:` means this plan cannot start until the referenced plan is `COMPLETE` or `PR_OPEN`
- `Blocks:` is informational (the blocked plan should list this one as a `Depends on`)
- Paths are relative to `docs/plans/strategy-v2/`
- Only references to plans inside `strategy-v2/` are parsed into the broker DB

---

## Status lifecycle

```
PENDING → [swarm lane starts] → [dev work] → [QA passes] → PR_OPEN → [human merges] → DONE
   ↓
NEEDS-REFINEMENT  (blocked by product/legal decision — swarm skips these)
   ↓
DEFERRED          (postponed — swarm skips these)
   ↓
REDIRECT          (canonical plan lives elsewhere — swarm skips these)
```

**Who transitions status:**

| Transition | Actor | Mechanism |
|------------|-------|-----------|
| `PENDING` → `COMPLETE` | QA-Deploy agent | `mark_plan_complete(plan_id)` in broker |
| `COMPLETE` → `DONE` | Human operator | Manual after merging PR to main |
| `PENDING` → `NEEDS-REFINEMENT` | Human operator | Edit the `.md` file, re-run `broker_sync_plans()` |
| Any → `FAILED` | Supervisor | Lane exceeded budget/handoff caps |

---

## Part & Phase conventions

| Part | Theme | Typical phases |
|------|-------|---------------|
| `part1-north-star` | Foundation, patterns, scoring maturity | 0–1 |
| `part2-role-discovery` | Role decomposition, RCD cutover, UAR | 0–4 |
| `part3-repo-ingestion` | Repo decomposition, PR narratives, enrichment | 0–3 |
| `part4-candidate-ingestion` | Candidate schema, enrichment, scoring | 0–4 |
| `part5-matching-migration` | Matching algorithm, Neo4j, reliability | 0–4 |
| `part6-market-research` | Calibration, compliance, UI polish | 0–4 |

**Phase meaning:**
- **Phase 0** — Cutover, hygiene, migration. Do first across all parts.
- **Phase 1** — Schema + basic infra.
- **Phase 2** — Core algorithms + data pipelines.
- **Phase 3** — Integration + API surfaces.
- **Phase 4** — UI, polish, observability.

---

## How to add a new plan

1. **Identify the source** — Which `knowledge/plan/part{N}` document does this come from?
2. **Pick the part folder** — `docs/plans/strategy-v2/part{N}-{theme}/`
3. **Name the file** — kebab-case, descriptive: `candidate-profile-state-schema.md`
4. **Write the markdown** — Follow the template above.
5. **Add to INDEX.md** — Update the part's `INDEX.md` with a one-line summary.
6. **Sync to broker** — Run `broker_sync_plans()` (MCP tool or CLI).
7. **Verify** — `runnable_set()` should include it if status is `PENDING` and dependencies are met.

---

## How to regenerate from scratch

If the source strategy documents change significantly:

```bash
# 1. Edit knowledge/plan/pipe-strategy-v2-part{N}-*.md

# 2. Break down into new execution plans in docs/plans/strategy-v2/

# 3. Re-sync broker database
python -m agent_harness.broker.plan_walker

# 4. Verify counts
sqlite3 .swarm/broker.db "SELECT COUNT(*) FROM plans;"
sqlite3 .swarm/broker.db "SELECT phase, status, COUNT(*) FROM plans GROUP BY phase, status;"
```

---

## Swarm execution model

```
Supervisor (configured with part_prefix + max_phase)
    │
    ├── Lane 1 ──▶ Plan A (part4-candidate-ingestion/candidate-nodes-schema.md)
    │   └── PM → Dev¹ → Dev² → QA-Deploy → PR_OPEN → COMPLETE
    │
    ├── Lane 2 ──▶ Plan B (part4-candidate-ingestion/candidate-profile-state-schema.md)
    │   └── PM → Dev¹ → QA-Deploy → PR_OPEN → COMPLETE
    │
    └── Lane 3 ──▶ Plan C (part2-role-discovery/phase2-role-nodes-migration.md)
        └── PM → Dev¹ → Dev² → Dev³ → QA-Deploy → PR_OPEN → COMPLETE
```

- **3 lanes max** (configurable)
- **Per-lane serial** — one subtask at a time, devs chain via Handoffs
- **Cross-lane parallel** — no file/migration conflicts allowed (`conflicts_for()` gate)
- **Per-sprint scoped** — `part_prefix` locks team focus to one Part at a time

---

## Sprint planning template

```
Sprint N: part{X}-{theme}, Phase 0–{Y}

Goals:
- Complete N plans from part{X}
- All Phase ≤ {Y}

Runnable set query:
SELECT plan_id FROM plans
WHERE plan_id LIKE 'part{X}-%'
  AND phase <= {Y}
  AND status = 'PENDING'
ORDER BY phase, plan_id;

Expected deliverables:
- [ ] Plan A: {title}
- [ ] Plan B: {title}
- [ ] Plan C: {title}

Risks:
- Dependency on part{Z}/...md (must be COMPLETE first)
- Migration number collision with part{W}/...md
```
