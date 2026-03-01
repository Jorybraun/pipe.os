# ADR-014 — Scheduling IoC: Plugin Registry + Webhook Automation

**Date:** 2026-03-01
**Status:** Proposed
**Author:** Archer (Principal Architect)
**Stakeholders:** Paige (Product), Devin (Engineering)

**Spec:** [docs/specs/scheduling-ioc-technical-spec.md](../specs/scheduling-ioc-technical-spec.md)
**Vision:** [docs/specs/scheduling-ioc-architecture.md](../specs/scheduling-ioc-architecture.md)
**Prereq ADR:** [ADR-013 — Interview Scheduling Provider Architecture (MVP)](ADR-013-interview-scheduling-architecture.md)

---

## Context

The MVP scheduling system (ADR-013) shipped a **Manual Bridge**: recruiters paste a Calendly URL, candidates see an embedded widget, and status updates require the recruiter to manually mark `SCHEDULED | COMPLETED | CANCELLED | NO_SHOW` after receiving email notifications from Calendly. This works for early usage but creates friction at scale:

- Recruiters must context-switch to email to learn when a candidate books
- Status can be stale (candidate booked 10 minutes ago, dashboard still says `INVITED`)
- No programmatic access to the recruiter's event types (they paste a generic URL, not the specific event)
- Adding a new provider (Cal.com, Google Calendar Appointments) still requires manual status sync

The brief calls this out explicitly: "Post-MVP: add webhook-based status sync." The attached IoC architecture vision doc proposes a full OAuth + webhook layer.

Constraints:
- Must be **purely additive** — manual flow must continue to work for recruiters who don't connect OAuth
- Must support multiple providers interchangeably (Calendly today, Cal.com next)
- Tokens must never be sent to the frontend
- No changes to candidate authorization model

---

## Decision

Extend the existing `SchedulingProviderDef` interface into a full **SchedulingPlugin** with server-side capabilities. Introduce a `SchedulingConnection` model for OAuth token storage. Add two Lambda functions: `schedulingOAuth` (token exchange + refresh + event type fetching) and `schedulingWebhook` (public-facing webhook receiver with provider-specific normalizers).

The IoC pattern: core Pipe code calls `plugin.getAuthUrl()`, `plugin.Widget`, and the webhook router calls `normalizer.normalize()` — none of these import Calendly or Cal.com code directly. Adding a new provider = implement the interface + register.

---

## Alternatives Considered

### Option A — Keep manual sync, improve UX only

Add polling: frontend periodically checks if the recruiter has updated the status. Add push notifications via email when a status change is overdue.

**Pros:**
- Zero new Lambda functions
- Zero OAuth complexity
- Ships in 1 day

**Cons:**
- Doesn't solve the core problem — recruiter still manually updates status
- Polling adds latency (status is still stale until recruiter acts)
- Scales poorly — at 10+ interviews/week, manual overhead is unacceptable

**Verdict:** Rejected — delays the inevitable. The manual bridge was explicitly scoped as MVP-only.

### Option B — Calendly-specific webhook, no abstraction

Hard-code a Calendly webhook Lambda. No plugin interface, no multi-provider support.

**Pros:**
- Simpler implementation (~3 days vs ~5 days)
- No plugin registry overhead

**Cons:**
- Adding Cal.com later requires forking the webhook Lambda or adding provider-specific conditionals
- Violates brief's non-negotiable: "decoupled provider abstraction"
- Calendly-specific code in the webhook handler becomes a maintenance burden when the second provider ships

**Verdict:** Rejected — same mistake as Option 1 in ADR-013. We've already learned to build the abstraction upfront.

### Option C — SchedulingPlugin interface + registry + webhook normalizers (chosen)

Full IoC with typed plugin interface (client + server), `SchedulingConnection` model, two Lambdas, provider-specific normalizers.

**Pros:**
- New provider = implement interface + register (zero changes to core code)
- Webhook normalizers are independently testable
- OAuth tokens are server-side only (never reach the frontend)
- `ManualProvider` fallback ensures recruiters without OAuth still work
- Mirrors the `resolveLayout` / `resolveShells` / `resolveSchedulingProvider` patterns already established

**Cons:**
- 5 days of engineering effort
- Two new Lambdas to maintain
- OAuth adds external dependency (Calendly API uptime, token rotation)
- Webhook endpoint is public-facing (HMAC verification required)

**Verdict:** Accepted.

---

## Rationale

The pattern is proven: ADR-005 (composable shells), ADR-013 (scheduling providers), and ADR-012 (editor layout) all use the same IoC approach. This is the natural extension from UI-only IoC to full-stack IoC. The 2-day delta over Option B (~3 days vs ~5 days) buys us permanent extensibility and a clean testing surface. Given that Cal.com support is already on the roadmap and Google Calendar Appointments is a likely future addition, the abstraction pays for itself on the second provider.

---

## Consequences

### Positive
- **Auto-sync eliminates manual status updates** — recruiter's dashboard reflects reality within seconds of a booking
- **New provider = one new normalizer file + one Widget update** — no changes to dashboard, candidate step, or webhook router
- **Token isolation** — frontend never sees OAuth tokens, reducing attack surface
- **Backward compatible** — existing manual-only recruiters are unaffected

### Negative / Trade-offs
- **Two new Lambdas** — `schedulingOAuth` and `schedulingWebhook` — maintenance + cold start cost
- **OAuth requires Calendly Standard plan** ($10/seat/mo) — free-tier recruiters can't use auto-sync
- **Webhook endpoint is public** — requires HMAC verification and rate limiting
- **Token refresh failure mode** — if Calendly revokes the token, recruiter must manually reconnect

### Risks
- **Calendly API changes** — Calendly is a third-party service; API or webhook format may change. Mitigation: normalizer layer isolates changes to one file.
- **Webhook delivery reliability** — Calendly may drop webhooks. Mitigation: manual override always works as a fallback; add retry polling post-MVP.
- **DynamoDB token exposure** — tokens are encrypted at rest (SSE) but plaintext in table scans. Mitigation: accept for now; KMS client-side encryption is a documented follow-up if security audit requires it.

---

## Follow-up

1. Implement per the spec: [docs/specs/scheduling-ioc-technical-spec.md](../specs/scheduling-ioc-technical-spec.md)
2. Handoff runbook: [docs/ops/HANDOFF-scheduling-ioc.md](../ops/HANDOFF-scheduling-ioc.md)
3. Post-MVP: Cal.com OAuth integration (implement `CalComPlugin` server-side capabilities)
4. Post-MVP: Google Calendar Appointments plugin
5. Post-MVP: KMS client-side encryption for tokens (if audit requires it)
6. Post-MVP: Retry polling for missed webhooks
