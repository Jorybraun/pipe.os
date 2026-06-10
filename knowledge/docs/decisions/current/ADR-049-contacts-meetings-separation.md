# ADR-049: Contacts & Meetings — Separate Service Architecture

**Date:** 2026-06-09  
**Status:** Proposed  
**Deciders:** Jory (solo founder)

---

## Context

Pipe currently models video meetings as implicit properties on `scheduled_interviews` rows, tightly coupled to the candidate assessment pipeline (`candidate_id`, `pipeline_id`, `stage_id`). The `VideoRoom` Durable Object uses `{stageId}--{candidateId}` as its session key.

New requirements expand meetings beyond candidates:

1. **Discovery calls** with potential customers (recruiters, hiring managers) — not tied to any pipeline
2. **Unified contact list** — candidates are one contact type among many (prospects, hiring managers, recruiters)
3. **Meeting transcription** — every meeting recorded, transcribed, and stored against the contact
4. **Separate deployable** — meetings should not bloat the recruiter SPA bundle or the main API Worker

---

## Decision

Build meetings as a **separate Cloudflare Worker + separate React SPA**, backed by the **same D1 database** (`pipe-db`). New tables: `contacts`, `meetings`, `meeting_participants`. Transcriptions stored as text in D1 with raw recordings in R2. Domain: `meet.hire-pipe.com`.

---

## Alternatives Considered

### Option A — Separate Worker + Separate SPA (chosen)

- **Pros:** Independent deploys, smaller bundles, clean API boundary, meetings can evolve without touching recruiter code
- **Cons:** Two deploy targets, shared code duplication (auth middleware, video components), Service Binding needed for VideoRoom DO

### Option B — Monorepo + Microfrontends (module federation)

- **Pros:** Shared code via packages, single deploy orchestration
- **Cons:** Massive tooling overhead (Nx/Turborepo, module federation config), solo founder doesn't benefit from deploy independence between "teams"

### Option C — Keep everything in the monolith

- **Pros:** Simplest, no new infrastructure
- **Cons:** Bundle grows, meetings code coupled to pipeline code, harder to reason about boundaries as features grow

---

## Rationale

Option A strikes the right balance. The Worker split is clean (different route namespace, same DB), the SPA split keeps bundles small, and there's no heavy build tooling. Shared code starts as copy-paste and moves to `packages/` if duplication becomes painful. The VideoRoom DO stays in the API Worker (no migration) and the meetings Worker reaches it via Service Binding.

---

## Consequences

### Positive

- Meetings app ships and deploys independently
- Recruiter SPA bundle stays lean
- Contacts become a first-class entity usable across the platform
- Transcription pipeline is self-contained within the meetings Worker

### Negative / Trade-offs

- Auth middleware duplicated across Workers (until extracted to shared package)
- Two Cloudflare Pages deploys to manage
- Cross-Worker communication for VideoRoom DO adds one hop of latency

### Risks

- D1 shared database means migrations must be coordinated — a bad migration in `workers/meetings/` can break `workers/api/`
- If meetings traffic spikes independently, the shared D1 becomes a bottleneck for both services

---

## Follow-up

See `TASKS-meetings.md` in this directory for the phased implementation plan.
