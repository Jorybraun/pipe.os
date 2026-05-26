# ADR-042: Review Session Initialization on Stage Entry

**Date:** 2026-04-22
**Status:** Accepted
**Deciders:** Solo founder

---

## Context

The CODE_REVIEW stage currently defers session creation until the candidate first interacts with a challenge component (lazy creation). This was originally chosen to avoid orphaned session rows if a candidate abandons the stage without starting. However, it creates several operational problems:

1. **No proactive resource allocation.** The implementer agent, consistency classifier, and scoring panel all need a session context to operate. Lazy creation forces every endpoint to handle a "session does not exist yet" branch, complicating the orchestration layer.

2. **Recruiter dashboard blindness.** The dashboard cannot display session status, elapsed time, or transcript previews until the candidate has clicked into the challenge. A candidate who opens the stage but does not submit an initial annotation appears as "not started" even though they are actively reviewing the diff.

3. **Race conditions on first interaction.** Two simultaneous requests from the initial page load (diff fetch + annotation preload) can both trigger session creation, producing duplicate rows that must be deduplicated.

4. **Inconsistent with other stage types.** SCREENING, CULTURAL, and OPEN_SOURCE all initialize their session records on stage entry. CODE_REVIEW is the only outlier.

---

## Decision

**Create the review session row synchronously when the candidate enters the CODE_REVIEW stage, with status `PENDING`.**

### Session lifecycle

| Status | Meaning | Transition trigger |
|---|---|---|
| `PENDING` | Session created, candidate has not submitted initial review | Automatic on stage entry |
| `ACTIVE` | Candidate has submitted first review, conversation ongoing | First `/message` from candidate |
| `AWAITING_VERDICT` | All PR rounds complete, candidate must submit final verdict | After last implementer response in final PR |
| `COMPLETE` | Verdict submitted, scoring triggered | Candidate submits `/complete` |
| `SCORED` | Scoring panel finished, report available | Async scorer callback |
| `ABANDONED` | Candidate left stage without completing | Timeout or explicit recruiter action |

### Worker endpoint

`POST /rpc/review/session/init` — idempotent, returns existing session if one already exists for this `(candidate_id, stage_id)` pair.

Request:
```json
{
  "candidate_id": "...",
  "stage_id": "...",
  "challenge_id": "..."
}
```

Response (201 created, or 200 existing):
```json
{
  "session_id": "...",
  "status": "PENDING",
  "challenge_id": "...",
  "created_at": "..."
}
```

### Schema

Extend `review_sessions` (or create if absent) with:
- `candidate_id TEXT NOT NULL`
- `stage_id TEXT NOT NULL`
- `challenge_id TEXT NOT NULL`
- `status TEXT NOT NULL CHECK(status IN ('PENDING','ACTIVE','AWAITING_VERDICT','COMPLETE','SCORED','ABANDONED'))`
- `transcript_json TEXT` — array of turns
- `score_json TEXT` — output of scoring panel
- `started_at TEXT`
- `completed_at TEXT`

Unique constraint: `UNIQUE(candidate_id, stage_id)`

---

## Consequences

### Positive
- Eliminates lazy-creation race conditions
- Recruiter dashboard can show real-time status from the moment the candidate opens the stage
- Simplifies endpoint logic: every `/message` and `/complete` handler can assume the session exists
- Aligns CODE_REVIEW session lifecycle with SCREENING, CULTURAL, and OPEN_SOURCE
- Enables pre-warming: consistency classifier and implementer prompt caches can be loaded while the candidate reads the brief

### Negative / Risks
- Orphaned `PENDING` rows if candidates abandon without starting. Mitigation: nightly job transitions `PENDING` rows older than 7 days to `ABANDONED`
- Slightly higher D1 write volume (one row per stage entry vs. per first interaction). Negligible at expected scale

## Alternatives Considered
- **Lazy creation with upsert** — Rejected: does not solve dashboard blindness or race conditions; just moves the deduplication problem into the application layer
- **Session creation on first annotation** — Rejected: same problems as lazy creation; also inconsistent with other stage types

## Open Questions
- Should `PENDING` sessions be garbage-collected or retained for analytics? (Leaning toward retain for 90 days, then archive)
- Should the implementer agent pre-generate its first response (a "hello, thanks for the review" ack) while the candidate reads the PR, to reduce first-turn latency?
