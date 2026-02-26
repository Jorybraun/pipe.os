# ADR-001: Pipeline Creation — MVP Architecture

**Status:** Accepted
**Date:** 2026-02-26
**Deciders:** Jory (sole founder)

---

## Context

Pipe's core loop is: recruiter creates pipeline → candidate completes assessment → recruiter sees ranked result. The pipeline creation step is the entry point to everything. Without it working end-to-end, nothing else can be tested or validated.

The existing implementation (`RoleDiscoveryPage`) is a multi-phase agentic flow: the recruiter fills in a structured baseline, then an AI agent asks follow-up questions, then a Lambda function generates a job description. This is the right long-term vision, but it is built on mock data, disconnected state management (the `useRoleDiscovery` hook is not used by the page), and Lambda functions that aren't implemented. It cannot ship as-is.

The goal is to unblock the MVP end-to-end flow as fast as possible, without throwing away the existing agentic work.

---

## Decision

**For MVP, replace the agentic role discovery flow with a simplified 4-field form that saves directly to DynamoDB.**

The original `RoleDiscoveryPage`, `AgentPanel`, `BaselineForm`, and `useRoleDiscovery` are preserved in their entirety and will be wired up in the post-MVP phase when the Lambda functions are implemented.

---

## Options Considered

### Option A: Fix the existing RoleDiscoveryPage (wire up the hook + Lambda)

| Dimension | Assessment |
|---|---|
| Complexity | High — Lambda implementation required, hook-page disconnect must be resolved |
| Time to ship | 2–3 weeks minimum |
| Data persisted | Yes (via `useRoleDiscovery.generateJobDescription`) |
| Blocks MVP? | Yes — Code Review stage can't be tested without this working |
| Team familiarity | Medium |

**Pros:** Preserves the product vision, delivers the differentiated experience from day one
**Cons:** Blocks the entire MVP for 2–3 weeks, requires Claude API integration, significant state management refactor, unproven Lambda pattern

### Option B: Simplified MVP form (selected)

| Dimension | Assessment |
|---|---|
| Complexity | Low — reuses existing form components |
| Time to ship | 1 day |
| Data persisted | Yes (Amplify Data Pipeline model) |
| Blocks MVP? | No |
| Team familiarity | High |

**Pros:** Unblocks Code Review stage immediately, uses existing form primitives, clean and maintainable, easy to test end-to-end
**Cons:** Loses the "wow" of the agentic UX for early demos, job description quality is lower (just freeform description field)

### Option C: No creation page — seed data manually

| Dimension | Assessment |
|---|---|
| Complexity | Trivial |
| Time to ship | Hours |
| Blocks MVP? | No, but blocks real user testing |

**Pros:** Fastest path to testing Code Review
**Cons:** Not a real product. Can't share with users.

---

## Trade-off Analysis

The core trade-off is **speed vs. first-impression quality**. Option A ships the better product but delays everything by 2–3 weeks. For a solo founder with ADHD who has already stalled on this project once, a 2–3 week prerequisite before seeing anything end-to-end is a real risk of another stall.

Option B ships in a day and unblocks the Code Review stage — which is the actual differentiator. A recruiter filling out 4 fields to create a pipeline is not a bad experience; it just isn't the *memorable* experience. The agentic flow returns in post-MVP without needing to re-architect anything.

---

## Architecture

### New components (MVP)

```
src/
├── pages/
│   └── PipelineCreatePage.tsx     ← NEW: 4-field create form
├── hooks/
│   └── usePipelineCreate.ts       ← NEW: form state + Amplify mutation
amplify/
└── data/
    └── resource.ts                ← UPDATED: Pipeline model added
```

### Preserved (post-MVP)

```
src/
├── pages/
│   └── RoleDiscoveryPage.tsx      ← PRESERVED, route moved to /pipeline/new/discovery
├── hooks/
│   └── useRoleDiscovery.ts        ← PRESERVED, all TODO blocks intact
├── components/RoleDiscovery/
│   ├── AgentPanel.tsx             ← PRESERVED
│   └── BaselineForm.tsx           ← PRESERVED
amplify/
└── data/
    └── resource.ts                ← RoleContext model still present
```

### Route table

| Route | Component | Status |
|---|---|---|
| `/pipeline/new` | `PipelineCreatePage` | ✅ MVP |
| `/pipeline/new/discovery` | `RoleDiscoveryPage` | 🔒 Post-MVP |
| `/pipeline/:id` | `OverviewPage` | 🟡 Needs real data |
| `/` | `ListingPage` | 🟡 Needs real data |

### Data flow (MVP)

```
PipelineCreatePage
  └── usePipelineCreate
        └── client.models.Pipeline.create()
              └── DynamoDB via AppSync
                    └── redirect to /pipeline/:id
```

### Pipeline model (Amplify schema)

```typescript
Pipeline: a.model({
  title:       a.string().required(),   // "Senior Frontend Engineer"
  level:       a.enum([...]),           // Junior | Mid | Senior | ...
  stack:       a.string().array(),      // ["React", "TypeScript"]
  description: a.string(),             // free text
  status:      a.enum([...]),          // DRAFT | ACTIVE | ARCHIVED
}).authorization((allow) => [allow.owner()])
```

---

## Consequences

**What becomes easier:**
- Code Review stage can be built and tested immediately
- End-to-end user flow (create → invite → assess → view) is testable within the 6-week MVP window
- The form components are already built — this is assembly, not invention

**What becomes harder:**
- Early demo quality — a 4-field form isn't as impressive as the agentic discovery
- Job description generation requires a separate step (or is skipped entirely at MVP)

**What we'll revisit:**
- Post-MVP: wire `useRoleDiscovery` → `questionAgent` Lambda → `jobDescriptionAgent` Lambda
- The `RoleContext` model will eventually link to the `Pipeline` model (a pipeline will have an optional `roleContextId`)
- The 4-field `Pipeline` model may need additional fields when the agentic flow returns

---

## Action Items

See `TASKS.md` for the full implementation checklist.
