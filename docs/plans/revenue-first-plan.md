# Revenue-First Plan — From Built Product to First Dollars

**Status:** APPROVED — Streams 1 + 2 (2026-07-07). Stream 3 (self-serve SaaS) DEFERRED until platform readiness; revisit after pilots convert.
**Owner:** Hans
**Goal:** Convert existing PIPE assets (product loop + marketing site) into revenue, starting this week. Stretch target: $5M run-rate within 12 months.

---

## 1. What exists vs. what blocks money

Audit of PIPE-OS + `pipe-marketing` (hire-pipe.com), July 2026:

| Asset                                                                     | State                                                              | Money-blocker                                                                                 |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Assessment loop (invite → `/assess/:token` → code review → scored report) | Built, e2e-tested (`e2e/standalone-code-review-mvp.spec.ts`)       | Recruiter-invite only; no self-serve entry                                                    |
| Talent pool intake (`/talent/:token`, `TalentPoolIntakePage`)             | Built: profile ingest → discovery → challenge matching → dashboard | Token minted only by recruiter; no public join                                                |
| Marketing site (hire-pipe.com)                                            | Live, single page                                                  | One CTA → waitlist table nobody reads; no booking, no pricing, no app link, no candidate path |
| Waitlist endpoint (`workers/api/src/routes/waitlist.ts`)                  | Inserts to D1, returns 201                                         | No founder notification, no auto-reply, no admin surface — leads silently rot                 |
| Recruiter auth (Clerk)                                                    | Mounted in `src/main.tsx`                                          | No marketing → sign-up handoff; no onboarding; no plan gating                                 |
| Billing                                                                   | **Does not exist**                                                 | No Stripe, no Clerk Billing, no checkout, no pricing page                                     |

Conclusion: the product can deliver the service today. The commercial shell (capture → charge → activate) is 100% missing. Every phase below removes one blocker, cheapest-first.

---

## 2. Revenue model — three streams, ordered by time-to-cash

| #   | Stream                                                                | Price point                                                                                                                    | Time to first dollar | Product work needed                                        |
| --- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------- | ---------------------------------------------------------- |
| 1   | **Managed recruiting pilots** (you operate PIPE as the service)       | $1.5k–2.5k pilot fee per role, credited toward placement; placement fee 15–20% of first-year salary (~$25–40k) or flat $15–20k | **Days**             | ~None. Stripe payment link + booking link + lead flow      |
| 2   | **Talent pool intros** (verified engineers, evidence attached)        | $2–5k per accepted intro, or pool-access retainer                                                                              | Weeks                | Public candidate join (`/rpc/talent/join`) + supply volume |
| 3   | **Platform seats** (self-serve SaaS: teams run their own assessments) | $500–1,500/mo per active role                                                                                                  | 2–3 months           | Clerk Billing, pricing page, onboarding, plan gating       |

**Why this order:** Stream 1 needs zero engineering and validates pricing with real invoices. Stream 2 gives the marketing site its "reason to enter" and compounds (every self-ingested candidate is inventory). Stream 3 is the scalable margin engine but only converts once 1–2 prove demand.

### The $5M math (honest version)

- Placements alone: $5M ÷ ~$30k avg fee = **~165 placements/yr ≈ 14/mo**. Not solo-feasible manually; only feasible if the platform automates screening/shortlisting (which it does) _and_ demand generation works.
- Blend that gets there: 6 placements/mo ($2.2M) + 60 platform-role subscriptions @ $1k/mo ($720k) + 40 intros/mo @ $3k ($1.4M) + pilots (~$300k) ≈ **$4.6M run-rate**.
- Realistic year-1 revenue is more likely $300k–$1M; $5M is the run-rate target the flywheel must be _designed_ for. Every phase below is a required gear in that flywheel — none are optional at that number.

---

## 3. Phase 1 — Stop leaking demand, become payable (Week 1)

Goal: every visitor with intent reaches Hans within 1 minute, and money can change hands.

| Item                                   | Where                                | Detail                                                                                                                                           |
| -------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1.1 Waitlist → founder alert           | `workers/api/src/routes/waitlist.ts` | On insert, send Resend email to founder with lead details + reply-to lead. BDD: unit test asserts send called with lead fields                   |
| 1.2 Waitlist → lead auto-reply         | same                                 | Immediate email to lead: what happens next + booking link (Cal.com/Calendly). Doubles as email verification                                      |
| 1.3 Primary CTA: "Book a pilot"        | `pipe-marketing/public/index.html`   | Replace passive "Request Access" hero CTA with direct calendar booking. Keep form as secondary                                                   |
| 1.4 Pilot offer + price anchor on site | same                                 | "Pilot: one role, two weeks, ranked shortlist with evidence — $1,995, credited to your first placement." A price makes it a business, not a demo |
| 1.5 Stripe payment link                | Stripe dashboard (no code)           | One link for pilot fee; invoices for placement fees. Defer all billing engineering                                                               |
| 1.6 Admin: waitlist visibility         | cockpit (small)                      | Minimal authed list of waitlist rows (or defer if 1.1 suffices)                                                                                  |

**Exit metric:** first booked call; first pilot invoiced.

---

## 4. Phase 2 — Candidate self-serve join: the "reason to enter" (Weeks 2–4)

Goal: an engineer landing on hire-pipe.com can ingest themselves, take a real code review, and join the talent pool — no recruiter in the loop. This builds sellable inventory for Stream 2 and gives the site a compounding hook.

| Item                                   | Where                                  | Detail                                                                                                                                                                                                                                                             |
| -------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2.1 `POST /rpc/talent/join`            | `workers/api/src/routes/talentPool.ts` | Public. Accepts name + email + Turnstile token. Creates standalone candidate (no pipeline) + intake row under a designated house workspace; mints `invite_token`; sends `/talent/:token` link via Resend (email-verified entry). Rate-limited. Idempotent on email |
| 2.2 Bot protection                     | Turnstile                              | Public minting endpoint must not be scriptable into the pool                                                                                                                                                                                                       |
| 2.3 Marketing: "For engineers" section | `pipe-marketing/public/index.html`     | Second audience track: "Prove it once. Get matched to real roles." Form → `/rpc/talent/join`. Show pool count once ≥50                                                                                                                                             |
| 2.4 BDD coverage                       | `e2e/`                                 | New spec: join → email link → `/talent/:token` → submit profile → challenge ready → complete code review → appears in recruiter talent pool. Extends `standalone-code-review-mvp.spec.ts` invariants (no fabricated evidence, ground truth never leaks)            |
| 2.5 Post-completion candidate state    | `TalentPoolIntakePage`                 | "You're in the pool — here's what companies see" moment. Existing `COMPLETED` state, sharpened copy                                                                                                                                                                |

**Existing rails reused:** `TalentPoolIntakePage`, `/rpc/talent/*` endpoints, `ensureRolelessTalentPoolIdentity`, discovery + challenge matching, `/assess/:token`. Only the front door is new.

**Exit metric:** ≥25 self-ingested candidates with a completed, scored code review.

---

## 5. Phase 3 — Paid pilots as the sales engine (Weeks 3–8, overlaps)

Goal: 3–5 paying pilot customers; 1–2 placements or platform conversions.

- Outbound: 20 targeted contacts/week (hiring EMs/CTOs with open senior-eng reqs). The pitch is the artifact: send a real (anonymized) PIPE evidence report — the product demos itself.
- Operate pilots through the existing recruiter flow (`/schedule → INVITE CANDIDATE → CODE_REVIEW`), sourcing from the growing pool first.
- Every pilot feeds testimonials + report samples back to the marketing site (replace the current fictional scorecard with real, anonymized ones).
- Product work only where pilots hit friction; recruiter invite UX spec already exists (`docs/plans/design-recruiter-invite-creation-mvp.md`).

**Exit metric:** $10–20k collected; 2 referenceable customers.

---

## 6. Phase 4 — Self-serve platform + billing (Months 2–4)

Goal: a recruiter can sign up, pay, and run their first assessment with zero founder involvement.

- Clerk Billing (Stripe) plans: Pilot / Team / Scale; plan gating in Worker middleware.
- Public pricing page on hire-pipe.com; "Get started" → Clerk sign-up → onboarding (create first role → invite first candidate ≤10 min).
- Demo without sign-up: canned interactive evidence report at `hire-pipe.com/demo` (static, no backend) — the recruiter-side hook mirroring the candidate-side challenge.

**Exit metric:** first self-serve subscription with no sales call.

---

## 7. Flywheel (why each phase compounds)

```
Engineers self-join (P2) ──► verified pool grows ──► pilots deliver faster (P3)
        ▲                                                   │
        │                                                   ▼
   pool credibility ◄── real reports on site ◄── paying teams (P3/P4)
```

Site visitors now have a reason to enter on both sides: engineers enter to get matched; companies enter because verified engineers are already inside.

## 8. Sequencing summary

| Week | Ship                                                                | Revenue event                         |
| ---- | ------------------------------------------------------------------- | ------------------------------------- |
| 1    | Lead alerts + auto-reply + booking CTA + pilot price + Stripe link  | First booked call                     |
| 2–3  | `/rpc/talent/join` + Turnstile + "For engineers" section + BDD spec | Pool inventory starts                 |
| 3–8  | Outbound + pilots via existing flow                                 | First pilot fees; first placement fee |
| 8–16 | Clerk Billing + pricing page + onboarding + `/demo`                 | First self-serve MRR                  |

## 9. Explicit non-goals (for now)

- No new assessment types; CODE_REVIEW is the wedge.
- No free-tier SaaS; pilots are paid from day one.
- No paid ads until pilot → placement conversion is measured.
- No marketplace automation (intro matching stays manual until Stream 2 has volume).
