# ADR-004: Static TypeScript Files for Challenge Library at MVP

**Date:** 2026-02-27
**Status:** Superseded by [ADR-034](ADR-034-challenge-authoring-system.md)
**Deciders:** Jory (solo founder)

---

## Context

The Challenge Picker UI needs a library of pre-built challenge templates for recruiters to select from. There are three ways to store and serve this content, each with different complexity and capabilities.

The content seeding strategy is documented in full at `docs/design/content-seeding-strategy.md`.

---

## Decision

At MVP, challenge templates are stored as static TypeScript objects in `src/content/challengeLibrary.ts`. No network requests — the templates are bundled with the app.

---

## Alternatives Considered

### Option A — Static TypeScript files (chosen)
- **Pros:** Zero latency (no AppSync round trip when Challenge Picker opens), version-controlled content (changes go through code review), zero operational complexity, can be imported directly by `pipelinePresets.ts`, format is designed to be DynamoDB-compatible for easy future migration
- **Cons:** Templates are identical for all users (no per-org customization), updating content requires a code deployment, bundle size increases slightly (~50KB uncompressed for 90 templates)

### Option B — DynamoDB `ChallengeTemplate` records seeded via script
- **Pros:** Enables per-org libraries, recruiter-created templates, sharing across organizations
- **Cons:** Requires new `ChallengeTemplate` global data model, seed script, AppSync query on picker open (adds latency), requires resolving the Phase 7 FK conflict before the seeding infrastructure can be built
- **Decision:** This is the right Phase 2 approach; premature for MVP

### Option C — AI-generated per job description
- **Pros:** Maximum relevance; challenges are tailored to the specific role
- **Cons:** Requires `questionAgent` Lambda extension, cold start latency on picker open, needs a solid static library as baseline and fallback, quality bar requires iteration
- **Decision:** Post-MVP; this becomes the AI_DRIVEN `creationMode`

---

## Rationale

The static approach eliminates an entire category of network/latency/error-handling complexity at the exact moment when simplicity matters most (pre-launch). The `ChallengeTemplate` type is designed to be directly mappable to DynamoDB records, so the migration path to Option B is mechanical: read `ALL_CHALLENGE_TEMPLATES`, create one `CodeArtifact` record per template with a `codeArtifact` field, create one `Challenge` record per template.

The bundle size increase is acceptable — the templates compress well and the picker doesn't need to be code-split.

---

## Consequences

### Positive
- Challenge Picker opens instantly — no loading state needed
- Content changes go through code review — accidental quality regression is caught before deploy
- No new AppSync models or auth rules needed for MVP

### Negative / Trade-offs
- All users see the same template library — no per-recruiter or per-org customization
- Adding or editing a template requires a code change + deployment (not a big deal for a solo founder, but will become a bottleneck as content grows)

### Risks
- Bundle size: 90 templates with code snippets may add ~100KB to the bundle. Monitor with `npx vite-bundle-visualizer` before shipping.

---

## Follow-up

- Phase 2 (post-MVP): Write `scripts/seedChallengeLibrary.ts` once `ChallengeTemplate` DynamoDB model is designed
- Phase 3 (post-MVP): Extend `questionAgent` with `generateChallengeSet(jobDescription, challengeTypes[])` for AI-driven mode
- Update Challenge Picker to read from `ALL_CHALLENGE_TEMPLATES` with search + filter by `topic` and `type`
