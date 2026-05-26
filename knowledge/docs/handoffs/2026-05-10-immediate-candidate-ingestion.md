# Handoff: Immediate Candidate Ingestion Fix

**Date:** 2026-05-10
**Author:** Hermes Agent
**Scope:** Candidate ingestion pipeline — INTAKE and upload-media paths
**Status:** Code changes complete, NOT deployed

---

## Problem Statement

Candidate ingestion was **queued for a cron job** (every 2 hours) instead of running immediately. The candidate graph is a living thing — every stage update needs to reflect in the graph immediately. Candidates were submitting resumes via INTAKE and waiting hours for their profile to be built.

---

## Root Cause

Two code paths were inserting `enrichment_jobs` with `source_type='resume'` instead of running `processResumeFromR2()` inline:

| Path | File | Line | Behavior Before |
|---|---|---|---|
| INTAKE challenge submission | `workers/api/src/routes/rpc.ts` | 891 | Queued `enrichment_jobs` row, returned 200 immediately |
| RPC upload-media (document) | `workers/api/src/routes/rpc.ts` | 1310 | Same — queued for cron |

The recruiter upload path (`candidates.ts:952`) was already correct — it called `processResumeFromR2()` synchronously. The candidate-facing paths were not.

---

## Changes Made

### 1. INTAKE submission path (`rpc.ts:867-906`)

**Before:**
```typescript
// Queue resume ingestion job (processed by enrichment worker cron)
await db.prepare(
  `INSERT INTO enrichment_jobs (id, candidate_id, source_type, source_url, status, created_at)
   VALUES (?1, ?2, 'resume', ?3, 'PENDING', unixepoch())`
).bind(...).run();
```

**After:**
```typescript
// Run ingestion immediately — candidate graph must be live before they proceed
c.executionCtx.waitUntil(
  (async () => {
    const result = await processResumeFromR2({ env: c.env, db: c.env.DB, candidateId, r2Key: resumeR2Key });
    console.log(`[rpc/intake] resume ingestion for candidate ${candidateId}:`, result.success);
  })(),
);
```

### 2. RPC upload-media path (`rpc.ts:1296-1321`)

Same pattern — replaced `enrichment_jobs` INSERT with `waitUntil(processResumeFromR2(...))`.

---

## What This Achieves

- Candidate uploads resume → ingestion starts **immediately** in background
- HTTP response returns in <100ms (no blocking on AI calls)
- `runCandidateIngestion()` runs full pipeline: discover profile → embed → match repos → triangulate → assign challenges
- Candidate graph is live before they proceed to next stage

---

## What Is NOT Changed (Intentionally)

- **GitHub enrichment** still queues `enrichment_jobs` with `source_type='github'` — this is correct. GitHub enrichment hits external APIs and should be batched by the cron.
- **Recruiter upload path** (`candidates.ts`) was already correct — no changes needed.
- **Cron schedule** (`0 */2 * * *`) stays active for GitHub jobs.

---

## Deployment Instructions

1. **Verify changes:**
   ```bash
   cd workers/api
   git diff src/routes/rpc.ts
   ```

2. **Deploy Worker:**
   ```bash
   npx wrangler deploy --env production
   ```

3. **Verify in production:**
   - Submit a test candidate through INTAKE
   - Check logs for `[rpc/intake] resume ingestion for candidate ...: true`
   - Query D1: `SELECT status, updated_at FROM candidate_ingestion WHERE candidate_id = '...'` — should show `matched` within ~30 seconds

---

## Verification Query

```sql
-- Check recent ingestion jobs completed immediately (not via cron)
SELECT 
  candidate_id, 
  status, 
  created_at, 
  updated_at,
  (updated_at - created_at) as seconds_to_complete
FROM candidate_ingestion 
WHERE created_at > unixepoch() - 3600
ORDER BY created_at DESC 
LIMIT 10;
```

Expected: `seconds_to_complete` should be < 60 for recent candidates.

---

## Risk Assessment

| Risk | Mitigation |
|---|---|
| `waitUntil` timeout on long ingestion | `runCandidateIngestion()` already has internal try/catch per step; failures are logged, not thrown |
| Duplicate ingestion if candidate uploads twice | `processResumeFromR2()` is idempotent — upserts candidate_ingestion row |
| Worker memory pressure from concurrent ingestions | `waitUntil` runs after response; Cloudflare limits concurrent subrequests |

---

## Follow-up: Clean Up Dead Code

After this deploys and verifies, remove the dead `enrichment_jobs` resume-handling branch from `enrichmentWorker.ts` (lines 79-99) to avoid confusion. The cron should only process `source_type='github'`.

---

## Related Files

- `workers/api/src/routes/rpc.ts` — modified (2 locations)
- `workers/api/src/routes/cron/enrichmentWorker.ts` — should be cleaned up post-verify
- `workers/api/src/lib/enrichment/resumeIngestion.ts` — unchanged (already correct)
- `workers/api/CHANGELOG.md` — updated under `[Unreleased]`
