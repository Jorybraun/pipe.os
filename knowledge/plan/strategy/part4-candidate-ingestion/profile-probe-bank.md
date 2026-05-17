# Profile Probe Bank — Role-Agnostic Screener Probes

**Source:** knowledge/plan/pipe-strategy-v2-part4-candidate-ingestion.md (lines 163–166)
**Phase:** 3
**Status:** NEEDS-REFINEMENT
**Estimate:** 2 weeks (split: 0.5 weeks code, 1.5 weeks content curation)

## Source quote
> For Mode 1, there's no equivalent — a role-agnostic probe bank needs to exist. It's a new `profile_probe_bank` table, curated upfront with probes designed to elicit signal across the five coverage dimensions without being role-specific. Each probe carries a `dimension` tag and an `expected_sub_element_types` array indicating what the answer should contribute to. Recruiter-approved probes only (NYC Local Law 144 and EU AI Act Art 14 compliance — no dynamic per-candidate generation, every probe traces to a finite approved bank).

## Why
A finite, recruiter-approved probe bank is both a compliance requirement (NYC LL144, EU AI Act Art 14) and a quality gate. Dynamic per-candidate probe generation from an LLM is not permissible in automated hiring-adjacent systems. The probe bank makes the screener auditable — every question a candidate is ever asked can be traced to an approved bank entry.

## Subtasks (delegable)

### Subtask 1 — `profile_probe_bank` table migration
**Files:**
- `workers/api/migrations/0051_profile_probe_bank.sql`

**Spec:**
```sql
CREATE TABLE profile_probe_bank (
  id TEXT PRIMARY KEY,
  dimension TEXT NOT NULL,
  -- 'experience' | 'cultural' | 'technical' | 'motivation' | 'context'
  probe_text TEXT NOT NULL,
  follow_up_text TEXT,       -- optional follow-up if first answer is thin
  expected_node_types TEXT NOT NULL,  -- JSON array of CandidateNodeType
  approved_by TEXT NOT NULL, -- recruiter user id
  approved_at INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
)
```
Indexes on `(dimension, active)`. The `approved_by` + `approved_at` fields are the compliance audit trail. Inactive probes (`active=0`) are never surfaced to candidates but remain for audit history.

**Status:** ⏳ PENDING

---

### Subtask 2 — Seed migration with initial probe set
**Files:**
- `workers/api/migrations/0052_profile_probe_bank_seed.sql`

**Spec:**
Write INSERTs for ~60 probes covering all 5 dimensions (~12 per dimension). This is content work as much as code. Probe requirements: must elicit a STAR-shaped answer (Situation, Task, Action, Result); must not assume a specific tech stack; must not ask for demographic information; must not be leading (no "tell me about a time you led a team" — instead "describe a project where you had to coordinate with others"). Example probes per dimension:
- experience: "Walk me through the most technically complex project you've owned end-to-end."
- cultural: "Tell me about a time you disagreed with a technical decision your team made. What did you do?"
- technical: "Describe a specific production incident you debugged. Walk me through how you approached it."
- motivation: "What does a role you'd leave for look like? What conditions would make you actively seek something new?"
- context: "What kind of team size and company stage have you thrived in most? Give me a specific example."
`approved_by` field: use a placeholder recruiter ID `'system_seed'`, `approved_at=0` for seed records. Real probes added through recruiter admin UI will have real values.

**Status:** ⏳ NEEDS-REFINEMENT (actual probe text needs founder review and compliance sign-off before shipping)

---

### Subtask 3 — Probe bank admin API (recruiter-facing)
**Files:**
- `workers/api/src/routes/cockpit/probeBank.ts`

**Spec:**
`GET /api/v1/probe-bank?dimension=<dim>` — returns active probes for dimension, Clerk-authed. `POST /api/v1/probe-bank` — create probe, sets `approved_by=clerkUserId`, `approved_at=now()`. `DELETE /api/v1/probe-bank/:id` — sets `active=0` (soft delete, never hard delete per compliance). `GET /api/v1/probe-bank/:id/history` — returns the probe text history via a `probe_bank_history` side table (append-only log of all edits). No editing probe text in-place — changes create new probe + deactivate old (audit requirement). All routes require Clerk org-admin role.

**Status:** ⏳ PENDING

## Dependencies
- Depends on: `screener-mode-generalization.md` (needs to know what dimensions the screener uses)
- Blocks: `screener-mode-generalization.md` Subtask 2 (probe selection query needs the table to exist)

## Acceptance criteria
- [ ] Migration applies cleanly
- [ ] Seed migration inserts >= 60 probes with at least 10 per dimension
- [ ] `GET /api/v1/probe-bank` returns only active probes
- [ ] Deactivating a probe sets `active=0`, probe no longer returned in screener probe selection query
- [ ] Each probe's `approved_by` + `approved_at` is set (non-null, non-zero for non-seed records)
- [ ] `npx tsc --noEmit` clean
