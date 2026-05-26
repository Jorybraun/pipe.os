# ADR-042c: Review Session Endpoint Shape

**Date:** 2026-04-22
**Status:** Accepted
**Deciders:** Solo founder

---

## Context

The current Worker API has ad-hoc code review endpoints scattered across route modules:
- `POST /api/v1/assessments/:id/submit` — generic submission endpoint used by all challenge types
- `POST /rpc/review/:sessionId/respond` — implementer agent response (from ADR-024)
- `POST /api/v1/assessments/:id/score` — scoring panel trigger (from ADR-024)

These endpoints were designed for the research arena and the single-turn deterministic flow. The golden path requires:
1. Session-scoped conversation (send message, receive implementer response)
2. Explicit completion (candidate signals they are done, triggering scoring)
3. Backward compatibility with any existing e2e tests or mock clients that still call the old endpoints

---

## Decision

**Introduce a new `/rpc/review/session` route namespace with three core endpoints. Keep old endpoints as thin shims for backward compatibility.**

### New endpoints

#### 1. `POST /rpc/review/session/init`
Idempotently create a review session. See [ADR-042](ADR-042-review-session-init.md) for full specification.

#### 2. `POST /rpc/review/session/:id/message`
Append a candidate message to the transcript and return the implementer response(s).

Request:
```json
{
  "turns": [
    {
      "actor": "candidate",
      "type": "annotation",
      "content": "This null check is redundant because...",
      "line_references": [{"file": "src/auth.ts", "line": 42}]
    }
  ]
}
```

Response (200):
```json
{
  "session_id": "...",
  "status": "ACTIVE",
  "turns": [
    {
      "actor": "candidate",
      "type": "annotation",
      "content": "This null check is redundant because...",
      "turn_number": 3,
      "timestamp": "..."
    },
    {
      "actor": "implementer",
      "type": "response",
      "content": "Hmm, I thought that was needed for the legacy flow. Can you show me where it's covered?",
      "turn_number": 4,
      "timestamp": "..."
    }
  ],
  "implementer_pending": false
}
```

Behavior:
- If `status` was `PENDING`, transitions to `ACTIVE`.
- Runs the consistency classifier on the implementer response before returning it (see ADR-032).
- If the session has a multi-PR challenge and the current PR round is exhausted, the response contains a `system_event` turn announcing the next PR.

#### 3. `POST /rpc/review/session/:id/complete`
Candidate submits their final verdict. Triggers the scoring panel asynchronously.

Request:
```json
{
  "verdict": "request_changes",
  "summary": "The auth refactor looks promising but needs stronger validation..."
}
```

Response (202 accepted):
```json
{
  "session_id": "...",
  "status": "COMPLETE",
  "score_url": "/rpc/review/session/:id/score"
}
```

Behavior:
- Validates that all PR rounds have been addressed.
- Transitions status to `COMPLETE`.
- Enqueues scoring panel job (Durable Object or async queue).
- Returns 202 immediately; scoring is async.

#### 4. `GET /rpc/review/session/:id/score`
Poll for scoring result. Returns 404 if scoring is not yet complete.

Response (200 when ready):
```json
{
  "session_id": "...",
  "status": "SCORED",
  "overall_score": 78,
  "band": "Strong",
  "dimensions": {
    "issue_identification_depth": { "score": 82, "evidence": "..." },
    "reasoning": { "score": 75, "evidence": "..." },
    "prioritization": { "score": 80, "evidence": "..." },
    "question_formation": { "score": 70, "evidence": "..." },
    "revision_evaluation": { "score": 85, "evidence": "..." },
    "ai_direction": { "score": 76, "evidence": "..." }
  },
  "narrative": "..."
}
```

### Old endpoint shims

| Old endpoint | Shim behavior |
|---|---|
| `POST /api/v1/assessments/:id/submit` | 307 redirect to `/rpc/review/session/:id/complete` if the assessment is a CODE_REVIEW; otherwise passthrough to existing handler |
| `POST /rpc/review/:sessionId/respond` | Deprecated. Returns `410 Gone` with `Location: /rpc/review/session/:sessionId/message` |
| `POST /api/v1/assessments/:id/score` | Deprecated. Returns `410 Gone` with `Location: /rpc/review/session/:sessionId/score` |

Shims are removed in a future cleanup ADR after all clients migrate.

---

## Consequences

### Positive
- Clean RESTful resource model: session is the noun, message/complete are the verbs
- Old clients get clear deprecation signals (410 + Location header) rather than silent failures
- Scoring async boundary is explicit — no long-polling inside the completion handler
- Easy to add future endpoints (e.g., `POST /rpc/review/session/:id/abort`, `GET /rpc/review/session/:id/transcript`) without polluting the generic assessment namespace

### Negative / Risks
- Three active endpoint namespaces for code review (old generic, old `/rpc/review`, new `/rpc/review/session`) during the transition period
- 307 shim for `/submit` adds one hop for legacy clients; may complicate CORS preflight
- Scoring async queue adds infrastructure (Durable Object or Cloudflare Queues)

## Alternatives Considered
- **Reuse generic assessment endpoints with a `type=code_review` discriminator** — Rejected: would require the generic submission handler to branch into conversation state management, implementer agent orchestration, and multi-PR flow. The generic handler would become a God endpoint.
- **GraphQL mutations** — Rejected: adds schema and client complexity for no benefit. The golden path has exactly three operations (init, message, complete).
- **Keep old endpoints and version them (`/v2`)** — Rejected: the old endpoints do not map cleanly to the new session model. A redirect/shim is cleaner than maintaining two parallel implementations.

## Open Questions
- Should `POST /message` support batching multiple candidate turns in one request? (Leaning toward no — one turn per request preserves turn-by-turn consistency classifier checks)
- Should the async scoring queue use Cloudflare Queues or a Durable Object alarm? (Leaning toward Durable Object for session affinity and retry logic)
- What is the shim removal timeline? (Proposed: 60 days after this ADR is accepted)
