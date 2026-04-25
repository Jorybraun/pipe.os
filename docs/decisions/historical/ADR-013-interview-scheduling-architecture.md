# ADR-013 — Interview Scheduling Provider Architecture

**Date:** 2026-02-28
**Status:** Accepted
**Author:** Archer (Principal Architect)
**Stakeholders:** Paige (Product), Devin (Engineering)

**Spec:** [docs/specs/interview-scheduling.md](../specs/interview-scheduling.md)
**Brief:** [docs/briefs/interview-scheduling.md](../briefs/interview-scheduling.md)

---

## Context and Problem Statement

When a candidate is invited to a `LIVE_VIDEO` stage, they need a way to self-schedule their interview. The recruiter already has an external scheduling tool (Calendly, Cal.com, Google Calendar Appointments, etc.). Pipe needs to present that tool's booking interface to the candidate without becoming a scheduling product itself.

The key tension: we want to render the third-party scheduling UI inside the candidate assessment flow, but different providers have different embed APIs (Calendly uses an inline `<script>` widget, Cal.com uses an iframe, a future native solution won't need an embed at all). If we couple the candidate-facing `SchedulingStep` component directly to Calendly, swapping providers later requires touching candidate flow, recruiter dashboard, and every status-handling callsite simultaneously.

Constraints:
- No new Lambda for MVP — direct Amplify Data only
- No new Cognito auth for candidates — they stay on `inviteToken` flow
- Provider-swap must require zero changes to `SchedulingStep` or `SchedulingDashboard`
- `schedulingUrl` must be snapshotted at invite time so changing the pipeline URL doesn't break in-flight invites

---

## Decision Drivers

- **Swap cost must be low** — Calendly is MVP; Cal.com or a native solution may follow. The brief explicitly requires decoupled provider abstraction.
- **URL is the only configuration** — Pipe doesn't ask the recruiter which provider they use. The provider is inferred from the URL domain (no extra setup step).
- **Amplify Data is the authority** — `ScheduledInterview` model records status, scheduling metadata, and the snapshotted URL. The provider only decides how to render.
- **Candidate must never call authenticated APIs** — authorization model: recruiter owns `ScheduledInterview`, candidate reads via API key (`allow.publicApiKey().to(['read'])`).

---

## Considered Options

### Option 1: Direct Calendly integration (no abstraction)

Hard-code Calendly embed logic inside `SchedulingStep`. Use Calendly's inline widget script directly.

**Pros:**
- Zero abstraction overhead
- Fastest to ship

**Cons:**
- Swapping to Cal.com or a native solution requires rewriting `SchedulingStep`, `useSchedulingProvider`, and all render paths
- Violates the brief's non-negotiable constraint ("decoupled provider abstraction")
- No mechanism to fall back gracefully if the URL is not a Calendly URL

**Effort:** 0.5 days
**Verdict:** Rejected — brief explicitly prohibits this.

---

### Option 2: Feature-flag per provider (conditional render)

Add a `provider: 'CALENDLY' | 'CAL_COM' | 'MANUAL'` enum to `Pipeline` or `ScheduledInterview`. `SchedulingStep` switches on this value.

**Pros:**
- Explicit — no inference, recruiter declares their provider
- Easy to extend with new enum values

**Cons:**
- Adds a required setup field the recruiter must fill in (friction)
- Provider enum in the component is still direct coupling — adding a new provider still requires editing `SchedulingStep`
- Recruiter may select wrong provider for their URL

**Effort:** 1 day
**Verdict:** Rejected — the URL already encodes the provider; requiring the recruiter to declare it is redundant friction.

---

### Option 3: `SchedulingProvider` interface + URL-based factory (chosen)

Define a `SchedulingProvider` interface with `type`, `label`, `Widget` (React component), and `matches(url)` predicate. Implement `CalendlyProvider`, `CalComProvider`, and `ManualProvider`. Expose `resolveSchedulingProvider(url)` which tests each provider's `matches()` in order and returns the first match (falling back to `ManualProvider`).

`SchedulingStep` calls `resolveSchedulingProvider(interview.schedulingUrl)` and renders `provider.Widget`. It never imports a concrete provider directly.

**Pros:**
- Adding a new provider = create a new file + register in `index.ts`. Zero changes to `SchedulingStep` or dashboard.
- URL-based detection removes the recruiter setup step
- `ManualProvider` fallback is a safe default (shows a plain link — always works)
- Interface is independently testable (unit test `matches()`, unit test `Widget` render)
- Exactly matches the existing `resolveLayout` / `resolveShells` pattern already established in Phase 7

**Cons:**
- Small abstraction layer to write upfront (~1 day)
- URL detection could theoretically misfire if a recruiter pastes a non-provider URL — covered by `ManualProvider` fallback

**Effort:** 1 day
**Verdict:** Accepted.

---

## Decision Outcome

**Chosen Option:** Option 3 — `SchedulingProvider` interface + URL-based factory.

### Interface contract

```typescript
// src/components/Scheduling/provider/types.ts

export interface SchedulingProviderConfig {
  schedulingUrl: string;
  candidateName: string;
  candidateEmail?: string;
}

export interface SchedulingProvider {
  type: 'CALENDLY' | 'CAL_COM' | 'MANUAL';
  label: string;
  Widget: React.FC<SchedulingProviderConfig>;
  matches: (url: string) => boolean;
}

export function resolveSchedulingProvider(url: string): SchedulingProvider {
  if (CalendlyProvider.matches(url)) return CalendlyProvider;
  if (CalComProvider.matches(url))   return CalComProvider;
  return ManualProvider;
}
```

### Provider detection rules

| Provider | `matches(url)` predicate |
|---|---|
| Calendly | `url.includes('calendly.com')` |
| Cal.com | `url.includes('cal.com')` |
| Manual (fallback) | Always `true` |

### Data model side

`ScheduledInterview.schedulingProvider` stores the **detected** provider type at invite creation time (for analytics / debugging). It is not the source of truth for rendering — the factory re-resolves at render time from `schedulingUrl`.

### Authorization boundary

- Recruiter (authenticated, owner) — full CRUD on `ScheduledInterview`
- Candidate (unauthenticated, API key) — `read` only, filtered by their `candidateId`

The `schedulingUrl` embedded in `ScheduledInterview` is a public Calendly/Cal.com link by definition — no PII exposed.

---

## Consequences

### Positive

- **Provider swap = 1 new file** — implement `Widget` + `matches()`, register in `index.ts`.
- **`SchedulingStep` is stable** — zero changes required when adding providers.
- **Test surface is small** — unit test `resolveSchedulingProvider()` with 3 URL patterns; unit test each `Widget` in isolation.
- **Consistent with existing patterns** — mirrors `resolveLayout` / `resolveShells` from ADR-005.
- **Graceful degradation** — unknown provider URLs fall back to a plain link (always works, even for custom enterprise scheduling tools).

### Negative

- Adds a `provider/` directory and interface layer that adds ~1 day of upfront work vs. direct Calendly integration.
- URL-based detection could fail for white-labeled scheduling tools that don't use `calendly.com` in their URL — `ManualProvider` fallback handles this but the widget won't be embedded.

### Neutral

- `ScheduledInterview.schedulingProvider` enum field is stored but not used for rendering. It serves as an audit/analytics field and a post-MVP hook for webhook routing.
- Calendly's inline embed requires a third-party `<script>` tag. Loaded lazily only when `SchedulingStep` mounts — not at app load. If CSP blocks CDN scripts, `CalendlyProvider` can degrade to a redirect link (open question documented in spec).

---

## Implementation

### Files to create

```
src/components/Scheduling/provider/
  types.ts           — SchedulingProvider interface + resolveSchedulingProvider factory
  CalendlyProvider.tsx — Calendly inline widget embed
  CalComProvider.tsx   — Cal.com embed (stub for MVP; redirect link acceptable)
  ManualProvider.tsx   — Plain anchor link fallback
  index.ts             — Re-exports resolveSchedulingProvider + all providers

src/lib/scheduling/
  types.ts             — InterviewStatus enum, ScheduledInterview client type
  statusTransitions.ts — VALID_TRANSITIONS map + canTransition() guard
```

### Amplify resources affected

- `amplify/data/resource.ts` — Add `ScheduledInterview` model; add `schedulingUrl` to `Pipeline` model.

### Rollback plan

If the provider abstraction causes unforeseen complexity, `SchedulingStep` can be temporarily hardcoded to Calendly by replacing the `resolveSchedulingProvider` call with a direct import of `CalendlyProvider`. The interface layer adds zero runtime risk — it's pure TypeScript.

---

## Validation

- `resolveSchedulingProvider()` unit tests: Calendly URL → `CalendlyProvider`, Cal.com URL → `CalComProvider`, random URL → `ManualProvider`.
- `statusTransitions.ts` unit tests: all valid + invalid transitions per status.
- Manual smoke test: configure Calendly URL on pipeline → invite candidate → open `/assess/:token` → see Calendly widget → recruiter marks `SCHEDULED` → "Join Call" appears.

**Review Date:** 2026-05-01 (before Post-MVP webhook sprint)

---

## References

- [Product Brief — Interview Scheduling](../briefs/interview-scheduling.md)
- [Technical Specification — Interview Scheduling](../specs/interview-scheduling.md)
- [ADR-005 — Composable Shell + Panel architecture](ADR-005-composable-challenge-system.md) — precedent for the `resolve*` factory pattern
- [ADR-011 — WebRTC Video Interview Architecture](ADR-011-video-interview-webrtc.md) — the video session this scheduling step feeds into

---

## Related Decisions

- [ADR-005](ADR-005-composable-challenge-system.md) — Established the `resolveLayout` / `resolveShells` factory pattern this ADR extends.
- [ADR-011](ADR-011-video-interview-webrtc.md) — The live video session that candidates join after scheduling.
