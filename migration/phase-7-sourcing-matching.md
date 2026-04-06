# Phase 7: Sourcing & Matching — Two-Lane Candidate Ingestion

> **Status: DEFERRED.** Do not start until Phases 0–6 ship. This document captures the design commitment so the decision survives, not a build plan to execute now.

---

## Why deferred

Pipe currently has too much unfinished integration work in flight (Cloudflare migration Phases 0–5, challenge experience Phase 6, code review arena, role discovery agent). Adding a sourcing layer on top of an unstable foundation would compound the surface area and slow everything down.

**Rule:** Phase 7 work does not begin until the post-sourcing pipeline is fully shipped, tested, and used by real recruiters. Auto-sourcing without a working pipeline to drop candidates into is worthless.

---

## The problem

Today, candidates only enter Pipe when a recruiter manually shares the pipeline link. The entire post-sourcing experience (screening → code review → scoring → intelligence reports) is built and works, but the top of the funnel is empty until the recruiter does the sourcing themselves on LinkedIn, GitHub, etc.

We want candidates to flow IN automatically — sourced, matched against the role spec the Discovery Agent already produced, and funneled into existing stages — **without eliminating the recruiter's ability to search manually when they have specific intent.**

---

## The decision: two lanes, one backend

Sourcing has two trigger mechanisms that share the same data layer, scoring function, and outcome surface:

### Autonomous lane
- Pipeline created → Discovery Agent produces structured role spec → background worker continuously finds + scores candidates against it
- Recruiter sees a "Suggested" inbox that fills over time
- Compounding moat: feedback from actual interview outcomes (who passed screening, who crushed the code review) tunes the matcher month over month
- This is the lane Serra-style competitors optimize for

### Manual lane
- Recruiter has specific intent the autonomous matcher can't encode ("Rust devs who've contributed to tokio")
- Search bar over the same data sources
- Same scoring function, same one-click invite
- Catches the long tail autonomous matching always misses

### Why both survive long-term
1. **Volume vs. intent.** Autonomous handles continuous discovery; manual captures recruiter intuition.
2. **Trust building.** Recruiters won't trust autonomous matching until they've used the system for weeks. Manual gives them control on day one.
3. **Manual is training data.** Every manual query is a labeled example feeding the autonomous tuner.
4. **Different failure modes.** When one lane returns nothing useful, the other covers.

---

## Architectural shape

```
                    ┌─────────────────────┐
                    │  Data source layer  │  (GitHub, PDL, etc — adapters)
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │   Scoring function  │  (Mistral + role spec)
                    └──────────┬──────────┘
                               │
              ┌────────────────┴────────────────┐
              │                                 │
    ┌─────────▼─────────┐             ┌─────────▼─────────┐
    │  Manual search    │             │  Autonomous cron  │
    │  (recruiter UI)   │             │  (background job) │
    └─────────┬─────────┘             └─────────┬─────────┘
              │                                 │
              └────────────────┬────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │  Candidate inbox    │  ← unified surface
                    │  + invite button    │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │  Existing Pipe flow │  (Resend → session JWT → stages)
                    └─────────────────────┘
```

Three shared layers (data, scoring, inbox). Two trigger mechanisms on top. One outcome.

The critical architectural commitment: **the search bar and the autonomous matcher must share the same backend code.** Same source adapters, same scoring function, same candidate schema, same invite mechanism. The only difference is who pulls the trigger — a human typing a query, or a Cron Trigger firing on a role spec.

---

## What we explicitly will NOT build

These are Serra features that would bloat Pipe and pull a solo founder into wars we cannot win:

- **Warm intro mapping** through employee networks
- **Full CRM** (candidate notes, stages, pipelines beyond Pipe's own)
- **Multi-channel outreach sequencing** (InMail, SMS, calendar booking)
- **Reply tracking and conversation management**
- **A general-purpose recruiting platform** for non-developer roles
- **A graph database.** A flat skill taxonomy in D1, enriched into per-pipeline JSON skill graphs by Mistral at pipeline creation time, gives 80% of the value at 5% of the complexity. Revisit only if we expand beyond developer hiring or hit 10K+ candidates.

---

## Knowledge graph: explicit non-decision

Recurring suggestion from outside advisors: "you need a knowledge graph for skill matching." We are explicitly choosing **not** to build one for this phase. Reasoning:

1. **Role spec is already structured** by the Discovery Agent — no free-text query parsing needed.
2. **Developer-only matching** is a small enough ontology that Mistral handles relationships reliably.
3. **Ground truth corrects LLM inconsistency** — the actual interview pipeline catches matching errors that a graph would prevent at the top of the funnel. We need recall at the top, not precision.
4. **Per-pipeline JSON skill graphs** generated by Mistral at pipeline-creation time and stored in D1 give us skill ecosystem awareness without graph DB infrastructure.

Revisit this decision only if: matching quality measurably blocks recruiter outcomes, we expand beyond developer roles, or candidate volume crosses 10K in a single account.

---

## Sequencing inside Phase 7

When this phase eventually starts, build in this order. Do not parallelize — each step depends on the previous one being real.

### 7.1 — Shared backend foundation
- Data source adapter interface (GitHub first; PDL or Proxycurl second)
- Scoring function that takes `(roleSpec, candidateProfile) → (score, reasons)`
- D1 tables: `sourced_candidates`, `source_queries`, `match_scores`
- Outcome surface: a "candidate inbox" page on the pipeline detail route

### 7.2 — Manual lane first
- Search bar UI on `/pipeline/:id/sourcing`
- Pre-filled from role spec on first open
- Results table with score + reasons + one-click invite (wires into existing Resend + session JWT flow)
- This proves the shared backend works end-to-end with a human in the loop

### 7.3 — Autonomous lane
- Cron Trigger that runs the same scoring pass on a schedule
- Writes results into `sourced_candidates` with a `discovered_by: 'autonomous'` flag
- Inbox surfaces both manual and autonomous results in one list, marked by source
- Quality starts dumb (basic keyword filter against role spec). Improves over time.

### 7.4 — Feedback loop
- Once ~50 pipelines have completed candidates, start logging outcomes back to `match_scores`
- Tune the scoring prompt or weights based on which sourced candidates actually performed
- Manual queries become labeled training signal for the autonomous matcher
- This is where the moat compounds

---

## Acceptance criteria (when phase eventually runs)

- A recruiter can open a pipeline and see suggested candidates without typing a query
- A recruiter can also type a query and get ranked results from the same backend
- One click sends a personalized email via Resend with the existing pipeline link
- Candidates land in the existing post-sourcing flow with no special handling
- Outcome data from the existing pipeline flows back to inform future matching
- Nothing in `/api/v1/sourcing/*` or the autonomous worker exposes internal IDs to candidates

---

## Pre-phase validation (do this before starting Phase 7)

Before writing any production code for Phase 7, validate the premise with real users:

1. **Talk to 3 active Pipe recruiters.** Ask: *"Walk me through the last role you tried to fill. Where did you get stuck?"* Listen for whether the binding constraint is sourcing, matching, outreach, or evaluation. If sourcing isn't the bottleneck, defer Phase 7 further.
2. **Spike one data source API** (GitHub GraphQL is the obvious first choice for developer hiring) in a throwaway Worker. Confirm it can return useful candidate signal in under 2 seconds.
3. **Mock the inbox UI** in a static React page. Show it to the same 3 recruiters. If they don't lean in, rethink.

If any of those return weak signal, this phase stays deferred. **Do not let the existence of this document trigger the build.**

---

## Related decisions

- ADR-027 (Role Discovery Agent) — produces the structured role spec this phase consumes
- ADR-028 (Multi-Stakeholder Role Discovery) — multiple interviewees synthesize into one spec; matching uses the synthesized version
- Phase 6 (Challenge Experience) — must ship before Phase 7 so there's a quality post-sourcing experience to drop candidates into
