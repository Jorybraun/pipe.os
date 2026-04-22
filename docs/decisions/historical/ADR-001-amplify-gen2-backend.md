# ADR-001: Use AWS Amplify Gen 2 as Backend Platform

**Date:** 2025-12-26
**Status:** Accepted
**Deciders:** Jory (solo founder)

---

## Context

Pipe needs a backend that provides authentication, a GraphQL API, a database, real-time subscriptions, and serverless compute. It needs to be deployable by one person with no DevOps background, cheap to operate at zero scale, and scalable if the product takes off.

Options evaluated at project start: Amplify Gen 2, Supabase, Firebase, and a custom Node + PostgreSQL stack on Railway or Render.

---

## Decision

Use AWS Amplify Gen 2 as the entire backend platform: Cognito for auth, AppSync for GraphQL, DynamoDB for the database, Lambda for compute, and Amplify Hosting for the frontend.

---

## Alternatives Considered

### Option A — AWS Amplify Gen 2 (chosen)
- **Pros:** TypeScript-first schema, zero config deployments (`npx ampx sandbox`), auth + API + DB + hosting in one tool, real-time subscriptions built in, generous free tier, strong TypeScript client codegen
- **Cons:** DynamoDB NoSQL requires upfront data modeling care, AppSync has a learning curve, vendor lock-in to AWS, some Amplify Gen 2 features are still maturing

### Option B — Supabase
- **Pros:** PostgreSQL (familiar SQL), great DX, real-time via Postgres changes
- **Cons:** No native GraphQL, requires more infra management for production, no integrated Lambda-equivalent, self-host or paid tier for serious use

### Option C — Firebase (Firestore + Auth + Cloud Functions)
- **Pros:** Mature, large community, easy real-time
- **Cons:** NoSQL with weaker query model than DynamoDB, GCP lock-in, TypeScript codegen story is weaker, pricing can spike

### Option D — Custom Node + PostgreSQL (Railway/Render)
- **Pros:** Full control, familiar tech, SQL joins
- **Cons:** Maximum setup time, auth must be built or integrated separately, no real-time out of the box, ops burden for one person is too high at this stage

---

## Rationale

For a solo founder building an MVP, time-to-working-product is the decisive factor. Amplify Gen 2's `npx ampx sandbox` gives a full cloud environment in minutes. The TypeScript schema → codegen → type-safe client flow eliminates an entire category of API bugs. DynamoDB's NoSQL constraints are manageable given Pipe's access patterns (owner-scoped reads, simple filters).

---

## Consequences

### Positive
- Deployed working auth + API + DB in hours, not days
- Type-safe data access across the full stack
- Real-time subscriptions available for free (Kanban live updates, future candidate subscriptions)
- CI/CD via `npx ampx pipeline-deploy` — no manual deploy steps

### Negative / Trade-offs
- No SQL joins — all relational data must be modeled as separate DynamoDB queries or handled via Amplify `selectionSet`
- The N+1 query problem must be actively managed (see Phase 6 bug fix: N+2 query in ListingPage)
- Amplify Gen 2 is newer; some edge cases require workarounds (e.g. the Assessment FK conflict in Phase 7)

### Risks
- DynamoDB at scale can be expensive if not properly indexed/projected
- AppSync costs are per-request — aggressive subscriptions could add up

---

## Follow-up

- Monitor AppSync query costs as candidate volume grows
- Evaluate moving to a relational DB if the data model becomes significantly more complex (post-Series A problem, not now)
