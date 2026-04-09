# PIPE — Work Tracker

Status as of 2026-04-09. This replaces following migration phases in order — the work has diverged. Grouped by what a paying customer needs, not by which phase doc it came from.

---

## MVP — a recruiter can send a link and get scored results back

### Recruiter pipeline setup
- [x] Pipeline listing (`/`) — CRUD, filters, status badges
- [x] Pipeline create (`/pipeline/new`) — title, level, stack, presets
- [x] Pipeline overview (`/pipeline/:id`) — stages, role profile, stepper
- [x] Stage panel with tabs — type-aware (cultural, code review, generic)
- [x] Stage CRUD — create, reorder, delete, title edit
- [x] Challenge CRUD — create, reorder, delete
- [x] Challenge editor (`/pipeline/:id/challenges/:id`) — per-type editors
- [x] Kanban view (`/pipeline/:id/kanban`)
- [ ] **Publish pipeline flow** — currently a button, but does it actually generate invite links?
- [ ] **Invite link generation** — shareable URL that resolves to a candidate session

### Stage configuration (new UX — built today)
- [x] Cultural Fit → Details tab (AI interview description, dimensions, profile axes)
- [x] Cultural Fit → Benchmark tab (5 sliders, save to challenge config)
- [x] Code Review → Details tab (protocol description, PR status, scoring panel)
- [x] Code Review → Interview mode (multi-turn toggle, AI assistant, follow-up debrief, persona, rounds)
- [ ] **Code Review → PR selection inline** — currently links to challenge editor, should be inline or at least not broken
- [ ] **Screening stage UX** — currently shows VIDEO_SCREENING on wrong stages, needs same treatment as cultural/code-review
- [ ] **Generic stage config** — the old CHALLENGES/CONFIGURE tabs work but feel outdated vs the new detail pages

### Candidate assessment flow
- [x] Token resolution (`/assess/:token`) — invite token → session
- [x] Welcome screen
- [x] Challenge renderer — per-type UI (diff viewer, quiz, short answer)
- [x] Code review flow — view PR, leave annotations, verdict
- [ ] **Multi-turn conversation** — implementer agent responding to review comments (backend wired?)
- [ ] **Follow-up generation** — AI generates debrief questions from submission
- [ ] **Culture interview candidate flow** — `/rpc/culture/session/:token/*` routes exist, frontend page exists, but is the full loop working end-to-end?

### Scoring
- [x] Code review scoring panel — 3 dimensions (Communication, Technical, Review Practice)
- [x] Culture scorer — 5 competency dimensions + 5 profile axes, 11 Gemma calls
- [x] Culture calibration harness — 10 fixtures, QWK math
- [ ] **Run the QWK calibration** — harness exists, never executed against Gemma (audit rec #1)
- [ ] **Code review scoring integration** — Devstral scorer wired in Worker?

### Candidate results
- [x] Candidate profile page (`/candidates/:id`) — submissions, scores, tabs
- [ ] **Culture report display** — does the recruiter see the culture score report?
- [ ] **HITL review gate** — recruiter must confirm/override before candidate sees results (ADR-031)
- [ ] **Candidate report page** — candidate-facing sanitized report

---

## Compliance (required before shipping to Illinois or EU candidates)

- [x] Consent gate — state default `consent`, consent payload, audit event
- [x] HITL gate — candidate report 403 until review_decision set
- [x] Audit log — 13 event types, append-only
- [x] Cost tracking + metering
- [ ] **Deletion path** — ADR-031 §3, two routes, zero code exists
- [ ] **Non-AI alternative** — consent payload links to dead page
- [ ] **HITL friction (viewed_at + scroll gate)** — one-click Confirm is a rubber stamp
- [ ] **Flag review decision** — third button from ADR-031, schema exists, no code path
- [ ] **Dead-man switch for stuck scoring** — fire-and-forget with no retry

---

## Code review content pipeline

- [ ] **PR library** — curated set of PRs with planted bugs for different skill levels
- [ ] **Bug templates** — 10 templates per ADR-032 (Claude Opus, one-time)
- [ ] **Variant generation** — Claude Sonnet batch offline
- [ ] **Consistency classifier** — Gemma 4 12B per-turn guardrail (ADR-032, highest priority)
- [ ] **Gold-standard corpus** — 10 seed transcripts for calibration

---

## Culture agent cleanup (from audit)

- [ ] **Wire L/M/H calibration examples** into scorer prompts (BC-5, wiki has them, code doesn't use them)
- [ ] **5 probe trigger types** (BC-11) — currently just "probe if short"
- [ ] **STAR scratchpad with specificity scores** (BC-13)
- [ ] **Retag 15 curated questions** to match role overlay preferredTags (or strip dead tag fields)
- [ ] **Fix wiki README** — claims per-question rubrics are source of truth, they're not
- [ ] **Remove stale TODOs** in cultureScorer.ts (promise wiki-sync that doesn't exist)
- [ ] **Update STRATEGY.md** — flip 13 `CHECK CURRENT STATE` items to real status

---

## Infrastructure

- [x] Cloudflare Workers + Hono router
- [x] D1 database + migrations
- [x] R2 storage
- [x] Clerk auth (recruiter) + custom JWT (candidate)
- [x] Workers AI (Gemma 4) for culture + role agents
- [ ] **CI/CD pipeline** — phase 5, not started
- [ ] **Custom domain + DNS**
- [ ] **Billing** — Clerk Billing / Stripe integration

---

## Decided to defer

- BC-6/BC-7 — belief-state tracking / PBA judge (P2)
- BC-16/BC-17 — fabrication detection (P3)
- BC-18 — rolling compaction (P2)
- BC-24 — OCAI culture archetypes (POST-MVP)
- Phase 4 — video/realtime (POST-MVP)
- Phase 7 — sourcing/matching (POST-MVP)
- Fly.io dev containers — post-MVP replacement for ECS
