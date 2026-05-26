# Rollback Plan

**Owner:** DevOps Team  
**Status:** PENDING  
**Source strategy:** `culture-agent-redesign-master.md` §6  
**Blocked by:** None  
**Blocks:** None  

---

## 1. Problem Statement

If the culture agent redesign causes production issues — increased drop-off, broken matching, legal complaints — we need a way to revert to the old flow within minutes. This document specifies the rollback triggers, procedure, and verification steps.

## 2. Rollback Triggers

| Trigger | Severity | Auto-rollback? |
|---|---|---|
| Drop-off rate > baseline + 15% | Critical | Yes |
| Candidate stuck at `WAITING_FOR_MATCH` > 30 min | Critical | Yes |
| Legal complaint related to screener | Critical | Yes |
| Scoring cost > $5 per interview | High | No (alert only) |
| Match quality thumbs-down rate > baseline + 20% | High | No (alert only) |
| Decomposition validation failure rate > 30% | High | No (alert only) |
| BGE rate limit causing enrichment failures | Medium | No (alert only) |

## 3. Rollback Procedure

### 3.1 Feature flag rollback (preferred)

```typescript
// In worker environment
ENABLE_CULTURE_AGENT_V2 = 'false'
ENABLE_SCREENER_EXPERIMENT = 'false'
```

**Steps:**
1. Update Wrangler secret: `wrangler secret put ENABLE_CULTURE_AGENT_V2`
2. Enter value: `false`
3. Deploy: `wrangler deploy`
4. Verify: Check `get-stage-config` returns old flow for new candidates.

**Time to complete:** < 2 minutes.

### 3.2 Code rollback (if feature flag insufficient)

```bash
# Revert to last known good commit
git revert HEAD  # or git checkout <last-good-commit>
git push origin main
# CI/CD deploys automatically
```

**Time to complete:** < 10 minutes (depends on CI).

### 3.3 Database rollback (if schema changes broke data)

```sql
-- If candidate_ingestion.status_v2 is corrupt
UPDATE candidate_ingestion SET status_v2 = status WHERE status_v2 IS NULL;

-- If candidate_nodes has bad data
-- Do NOT delete. Add flag: is_active = 0
UPDATE candidate_nodes SET is_active = 0 WHERE source_type = 'automated_screener';
```

**Time to complete:** < 5 minutes.

### 3.4 Vectorize rollback

If the enriched vectors are worse than resume-only vectors:

```typescript
// Re-embed from resume-only
await reEmbedCandidateFromResume(candidateId, env);
```

This is a per-candidate operation. For bulk rollback:

```sql
-- Update all enriched candidates back to resume vector
UPDATE candidate_ingestion
SET embedding_json = embedding_json_backup,
    status = 'matched'
WHERE status = 'enriched';
```

**Requires:** Pre-migration backup of `embedding_json`.

## 4. Verification Steps

After rollback:

1. **New candidates:** Upload resume → verify old flow (no screener, direct matching).
2. **In-flight candidates:** Verify `get-stage-config` returns valid challenge (not `WAITING_FOR_MATCH`).
3. **Recruiter dashboard:** Verify no error messages.
4. **Support tickets:** Monitor for 24 hours.
5. **Cost dashboard:** Verify LLM call count returns to baseline.

## 5. Rollback Readiness Checklist

Before deploying the redesign:

- [ ] Feature flag `ENABLE_CULTURE_AGENT_V2` is implemented and tested.
- [ ] Feature flag can be toggled without deploy (env var or KV).
- [ ] Database backup of `candidate_ingestion.embedding_json` exists.
- [ ] Runbook is documented and team has practiced rollback once in staging.
- [ ] PagerDuty/on-call rotation knows rollback procedure.
- [ ] Auto-rollback alerts are configured in Cloudflare Workers Analytics.

## 6. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Feature flag does not cover all code paths | Medium | High | Comprehensive feature flag audit before deploy |
| Database rollback loses data | Low | High | Do not delete; use soft-delete flags |
| Rollback takes too long | Low | High | Practice in staging; optimize CI pipeline |
| Team does not know rollback procedure | Medium | High | Runbook + drill |
