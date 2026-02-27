# Pipe — Pricing Model & Feature Gating

**Status:** Vision / Pre-implementation
**Last updated:** 2026-02-27

> This document captures the intended pricing structure so feature decisions are made with the business model in mind. No pricing or billing infrastructure exists yet — this is a planning document only.

---

## The ladder

Pipe's pricing follows a natural upsell path based on how much AI involvement the recruiter wants:

| Tier | Who it's for | What they get |
|---|---|---|
| **Free** | Solo recruiters, early adopters | Blank + preset pipelines, manual scoring, unlimited candidates |
| **Pro** | Growing teams, high-volume hiring | AI Discovery Agent (candidate probing), AI Review (submission scoring), AI pipeline generation |
| **Enterprise** | Large orgs | Custom challenge libraries, SSO, audit logs, SLA, dedicated support |

---

## Feature map

### Free tier (ships with MVP)

- Pipeline creation: **Blank** and **Preset** modes
- All challenge types: `CODE_REVIEW`, `CODE_IMPLEMENTATION`, `QUIZ_MCQ`, `QUIZ_SHORT_ANSWER`
- Manual scoring by recruiter
- Signal labels: STRONG / YES / MAYBE / NO
- Candidate invite links (no sign-in required)
- Recruiter dashboard with per-challenge breakdown

### Pro tier (post-MVP AI features)

Three independent AI features — each can be toggled per pipeline:

**1. AI Pipeline Generator**
- Recruiter describes the role → AI proposes stages, challenge types, and challenge content
- Right panel in pipeline creation shows AI proposal as editable cards before committing
- Maps to `creationMode = 'AI_DRIVEN'` on the `Pipeline` model
- Schema flag: `creationMode` (already extensible in current schema)

**2. AI Discovery Agent**
- During candidate assessment, an AI agent asks follow-up questions based on candidate responses
- Recruiter sets `probeLimit` (0–10 follow-ups) per pipeline at creation time
- Partially scaffolded in the legacy UI (AI DISCOVERY AGENT toggle, probe limit field)
- Schema flag: `aiDiscoveryEnabled: Boolean`, `probeLimit: Int` on `Pipeline`

**3. AI Review**
- After submission, AI scores `SHORT_ANSWER` and `CODE_IMPLEMENTATION` challenges
- Recruiter sees AI commentary + suggested score alongside their own manual scoring interface
- Does not replace recruiter judgment — surfaces evidence, recruiter decides
- Schema flag: `aiReviewEnabled: Boolean` on `Pipeline`

---

## Implementation approach (when the time comes)

- Feature flags stored on `Pipeline` model, checked at runtime
- Plan tier stored on recruiter's Cognito user record (custom attribute) or a separate `Account` model
- Gate checks: `if (!isPro && challenge.requiresAI) → show upsell prompt`
- No in-app billing at MVP — manual plan assignment by admin initially
- Stripe integration is the likely path for self-serve Pro subscriptions

---

## What NOT to build yet

- No Stripe, no billing UI, no plan management
- No usage metering (token costs, API call limits)
- No `aiDiscoveryEnabled` / `aiReviewEnabled` fields on the schema until the AI features are actually being built
- The `creationMode` enum on `Pipeline` currently only needs `BLANK | PRESET` — `AI_DRIVEN` is reserved for later
