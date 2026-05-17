# Intake, Outreach & CRM for Pipe — Research Brief

**Date:** 2026-04-09  
**Research streams:** 4 parallel researchers, 102 combined sources  
**Core question:** How should Pipe build a Serra-like intake + outreach system, leveraging existing tools rather than building from scratch?

---

## Executive Summary

Pipe can build a compelling intake-to-outreach pipeline without building a CRM from scratch. The research reveals three key findings:

1. **Apollo is the wrong choice for sourcing.** Its 65-70% email accuracy and 2-3x hidden credit costs make it the worst-performing option among 8 evaluated APIs. RocketReach (90-98% email deliverability, recruiting-optimized) + People Data Labs (1.5B profiles, 200+ skills fields for technical hiring) is the recommended core stack. If Pipe ever serves EU recruiters, Cognism ($15K+/year) becomes mandatory for GDPR compliance.

2. **Don't build a CRM — assemble one from existing tools.** HubSpot is overpriced ($890/mo Pro) and not purpose-built for recruiting. Instead: use **Instantly** ($97/mo for 5 users) or **Smartlead** ($39-94/mo) for multi-channel outreach + reply automation, **Resend** (already in stack) for transactional email, and **Cloudflare Email Workers** for inbound reply routing. This gives you 80% of Serra's outreach capability at ~$150/mo.

3. **The architecture is queue-first on Cloudflare.** Workers' 30-second CPU limit means every external API call (sourcing, email sends, CRM sync) must flow through Cloudflare Queues. For MVP, Cron + D1 handles sequence scheduling. For production (10K+ enrollments), migrate to Cloudflare Workflows for durable, exactly-once execution with built-in `waitForEvent()` for reply-driven branching.

---

## Part 1: What Serra Does (And What Pipe Can Learn)

Serra (YC S23, ~100 companies including Waymo/Verkada/Replit) automates the recruiter's core loop: intake → sourcing → outreach → scheduling. Key patterns Pipe should adopt:

### Natural-language intake
Serra accepts a plain-English job description and generates a ranked candidate shortlist in <60 seconds. No form-filling. This maps directly to Pipe's **Role Discovery Agent** (ADR-027) — the agent should accept a JD narrative, extract criteria, and scope the assessment pipeline. R1 found this is a UX lever that reduces hiring manager friction across all competitors.

### Continuous background sourcing
Serra runs 24/7 sourcing agents that surface new candidates as they appear. No competitor replicates this. For Pipe, this suggests a Cloudflare Workflow that periodically queries sourcing APIs (RocketReach, PDL) against active pipeline criteria and queues new matches.

### Warm intro network (Serra's moat)
Serra claims a 5-10x reply rate advantage from mapping employee LinkedIn/GitHub networks into a shared graph and surfacing warm introduction paths. This is a vendor claim consistent with industry research on referral hiring, but not independently verified. This is technically feasible but data-constrained (LinkedIn API is restrictive). **Recommendation: don't build this for MVP.** It requires significant data infrastructure and employee opt-in. Pipe's differentiator is assessment quality, not sourcing.

### Transparent scoring
Serra's explainable candidate scorecards reduce recruiter/hiring-manager misalignment. Pipe already does this via the scoring panel (ADR-032) and consistency classifier. Reinforce during implementation.

---

## Part 2: Don't Use Apollo — Use RocketReach + PDL

Apollo.io looks attractive at $49/mo but fails on the metrics that matter for recruiting:

| Metric | Apollo | RocketReach | People Data Labs | Cognism |
|---|---|---|---|---|
| Email accuracy | 65-70% | 90-98% | 95% | 83-91% |
| Phone accuracy | ~40% | 90-98% | 90% | 98% |
| Skills indexing | Weak | Moderate | Strong (200+ fields) | Weak |
| Recruiting fit | Moderate | Strong | Strong (technical) | Moderate |
| Effective cost | 2-3x advertised | Transparent | Transparent | $15K-100K/yr |
| GDPR | Includes personal emails | User responsibility | Not optimized | Certified (ISO 27001/27701) |

### Recommended sourcing stack

**Tier 1 — Core (US technical hiring):**
- **RocketReach Ultimate** ($2,099/year) — 90-98% email deliverability, recruiting-optimized filters, skills/technology search, role-switch detection
- **People Data Labs Enterprise** ($5K-15K/year) — 1.5B unique profiles, 200+ data fields per profile (work history, education, certifications), monthly data refresh

**Tier 2 — EU compliance (if needed):**
- **Cognism** ($15K-100K+/year) — GDPR-first, 16-step verification, 98% mobile accuracy, screens 13-15+ DNC lists. Non-negotiable if serving EU recruiters.

**Tier 3 — Enrichment:**
- **Hunter.io** ($49/mo) — Cold email verification + intent signals (hiring, funding)

**Avoid:**
- Apollo.io (accuracy gap, hidden credit costs)
- Proxycurl (shut down July 2025 — fake account lawsuit)
- LinkedIn scraping (97.1% of fake accounts blocked; legal risk per hiQ v. LinkedIn)
- ZoomInfo ($40K+/year, built for B2B sales not recruiting)

### Sourcing architecture pattern

```
Recruiter provides candidate identifier (name, email, LinkedIn URL)
  → Query RocketReach first (fast, recruiting-optimized)
  → If no match, fallback to PDL (identity graph breadth)
  → If EU candidate, re-enrich via Cognism (audit trail)
  → Async Hunter.io for intent signals
  → Store lookup keys only (never raw PII in D1)
  → Fetch enriched data on-demand at session time
```

Build a provider abstraction layer (`workers/api/src/lib/sourcing/createProvider.ts`) following the same pattern as `createProvider.ts` for LLM routing.

---

## Part 3: Don't Build a CRM — Assemble Outreach From Existing Tools

### HubSpot verdict: skip it

HubSpot CRM Pro costs $890/mo, its email sequences lack recruiting primitives (candidate pools, interview scheduling), and the contact-tier pricing scales with database size, not activity. You'd still need to layer Smartlead or Instantly on top for multi-channel outreach. Net: you pay $890/mo for a glorified contact database.

### Recommended outreach stack

**For MVP ($150/mo total):**

| Layer | Tool | Cost | Role |
|---|---|---|---|
| Outbound sequences | **Instantly** | $97/mo (5 users) | Multi-channel email + LinkedIn, AI Reply Agent, unlimited sending accounts |
| Transactional email | **Resend** | $0-20/mo | Invite emails, status updates, interview confirmations (already in stack) |
| Inbound reply routing | **CF Email Workers** | Free | Receive candidate replies, parse, route to D1 |
| Sequence state | **D1 + Workers** | Included | Track enrollment status, step execution, delivery events |
| Campaign analytics | **Instantly dashboard** | Included | Open rates, reply rates, bounce rates |

**Alternative:** Swap Instantly for **Smartlead** ($39-94/mo) if you want cheaper pricing and stronger API/webhook support, but lose the AI Reply Agent.

### Why not a recruiting CRM (Gem, Ashby, Lever)?

These are excellent products ($300-800/mo) but they're **ATS+CRM bundles** designed to replace your entire hiring stack. Pipe IS the hiring stack — you don't need another ATS on top. What you need is the outreach plumbing, which Instantly/Smartlead provides at 5x lower cost.

### Multi-channel matters

Research shows email + LinkedIn combinations get **3.5x better reply rates** than email alone, and multi-channel campaigns achieve **27-45% response rates vs. 1-3% for single-channel**. This is why Instantly or Smartlead (which support email + LinkedIn sequences) are preferable to Resend alone.

---

## Part 4: Communication Orchestration

### How sequences work

A typical 3-touch recruiting sequence:
1. **Day 0:** Personalized email (via Instantly/Smartlead or Resend)
2. **Day 3:** Follow-up email if no reply
3. **Day 5:** LinkedIn connection request + message (via Instantly/Smartlead)
4. **On reply:** Auto-pause sequence, notify recruiter, route to conversation thread

### Deliverability requirements (non-negotiable)

- **SPF + DKIM + DMARC** — enforced by Gmail (Feb 2024) and Outlook (May 2025). Resend handles this automatically.
- **Domain warmup** — 30 days, 5-10 emails/day on new sending domains. Instantly/Smartlead include warmup services; Resend does not.
- **Separate sending domain** — Never send outreach from your primary domain. Use a subdomain (e.g., `outreach.pipe.dev`) to protect deliverability.

### Reply routing architecture

```
Candidate replies to outreach email
  → Cloudflare Email Workers receives inbound
  → Parse: from, to, subject, body, headers
  → Match to candidate via email lookup in D1
  → Update outreach_enrollments.status = 'replied'
  → Pause active sequences for this candidate
  → Store in communication_threads + communication_messages
  → Notify recruiter (webhook or in-app notification)
```

Key threading headers: `In-Reply-To`, `References`, `Subject` (prefix `Re:`) — these ensure replies appear in the same email thread.

---

## Part 5: Integration Architecture on Cloudflare

### Core constraint: Workers have 30-second CPU limit

Every external API call (RocketReach, Instantly, Resend, HubSpot) must be async via Cloudflare Queues. The pattern:

```
Recruiter action (Hono endpoint)
  → Validate + queue message
  → Return 202 immediately
  → Consumer Worker processes async
  → Update D1 with results
```

### Data model (6 core tables)

| Table | Purpose |
|---|---|
| `sourced_profiles` | Candidates from Apollo/RocketReach/manual import. Links to pipeline. |
| `outreach_sequences` | Sequence templates (steps, delays, channels). JSON step definitions. |
| `outreach_enrollments` | Candidate × sequence execution state. Status: active/paused/completed/replied. |
| `sequence_step_executions` | Individual step delivery tracking. Scheduled time, delivery status, external message ID. |
| `communication_threads` | Email/LinkedIn conversation threads per candidate. |
| `communication_messages` | Individual messages (inbound + outbound) within threads. |

Plus `queue_message_log` for idempotency tracking. Full DDL in R4 research file.

### Sequence engine: Cron (MVP) → Workflows (production)

**MVP (weeks 1-4):** Cron Trigger fires every 5 minutes, queries D1 for due steps, queues sends via Resend/Instantly API. Simple, works for <10K enrollments. Risk: duplicate sends on crash (mitigate with idempotency keys).

**Production (week 5+):** Migrate to **Cloudflare Workflows** — each enrollment becomes a Workflow instance with durable step execution:

```typescript
// Each candidate enrollment is a Workflow
const step1 = await workflow.do("send_email_day_0", async () => {
  return await resend.emails.send({ ... });
});

await workflow.sleep(Duration.days(3));

// Check if reply received before sending follow-up
const replied = await workflow.waitForEvent("reply", { timeout: Duration.days(2) });
if (!replied) {
  await workflow.do("send_followup", async () => { ... });
}
```

Workflows guarantee no duplicate sends, resume from exact step on failure, and support event-driven branching (reply received → skip follow-up).

### Webhook ingestion

External services (Instantly, Resend, sourcing APIs) push events to Workers:
1. Verify signature (HMAC-SHA256)
2. Return 202 immediately
3. Queue for async processing
4. Consumer updates D1 (delivery status, reply received, bounce)
5. Idempotency via `queue_message_log` with unique webhook ID

### Rate limiting via queue tuning

| External API | Queue max_batch_size | Reason |
|---|---|---|
| Resend | 2 | 2 req/sec rate limit |
| HubSpot | 10 | Batch API supports 10 ops |
| RocketReach | 5 | Conservative estimate |
| Instantly | 5 | API rate limit |

---

## Part 6: Build vs. Buy Recommendation

### The boundary

| Component | Build or Buy | Rationale |
|---|---|---|
| Role intake (JD → criteria) | **Build** | Core to Pipe's Role Discovery Agent (ADR-027). Differentiating. |
| Candidate sourcing API calls | **Build** (thin wrapper) | Provider abstraction layer in Workers. Simple API proxy. |
| Multi-channel outreach sequences | **Buy** (Instantly/Smartlead) | Complex deliverability, LinkedIn integration, reply automation. Not worth building. |
| Sequence scheduling | **Build** (Cron → Workflows) | Cloudflare-native, tight D1 integration, scoring-aware branching. |
| Reply routing | **Build** | CF Email Workers + D1. Simple parsing + state update. |
| CRM (contact management) | **Neither** | D1 `sourced_profiles` + `communication_threads` IS the CRM. Don't buy HubSpot. |
| Candidate scoring | **Build** | Already Pipe's core product. Feeds into outreach personalization. |
| Email sending | **Buy** (Resend) | Already in stack. Handles SPF/DKIM/DMARC. |
| Analytics / reporting | **Buy** (Instantly dashboard) | Not differentiating. Use vendor dashboards. |

### Cost projection

| Scale | Monthly cost | Components |
|---|---|---|
| MVP (1-2 recruiters, <500 candidates) | ~$225/mo | Instantly $97 + RocketReach $175/mo ($2,099/year Ultimate) + Resend free |
| Small (5 recruiters, 2K candidates) | ~$600/mo | Instantly $97 + RocketReach $175 + PDL $420 (Pro) + Resend $20 |
| Growth (10 recruiters, 10K candidates) | ~$2,500/mo | Instantly $197 + RocketReach $500 + PDL $1,250 + Resend $90 + Hunter $49 |
| EU expansion | +$1,250-8,000/mo | Add Cognism ($15K-100K/year) |

---

## Part 7: The Serra Gap — What Pipe Can Do That Serra Can't

No competitor in the sourcing/outreach space combines sourcing with live coding assessments or behavioral interviews. This is Pipe's unique position:

**Serra flow:** Source → Outreach → Schedule interview → ???  
**Pipe flow:** Source → Outreach → Candidate lands on assessment → Code review + Culture interview → Scored + ranked → Recruiter sees results

The integration point: when Instantly/Smartlead outreach gets a positive reply, the candidate receives a Pipe assessment link. Assessment completion triggers scoring. Recruiter sees sourced candidates ranked by assessment performance, not just profile match.

This closes the loop that Serra leaves open — Serra finds candidates, but can't evaluate them. Pipe evaluates candidates, but currently can't find them. Combining sourcing + assessment is a new capability in the market.

---

## Open Questions

1. **Warm intro feasibility:** Serra's network graph is their moat. Building this requires employee LinkedIn data opt-in and a graph database. Not feasible for MVP, but worth tracking as a Phase 3+ feature if Pipe expands into sourcing.

2. **Instantly vs. Smartlead final choice:** Both work. Instantly has AI Reply Agent (auto-responds to common reply types); Smartlead has stronger API/webhook support. Recommend trying both on free trials before committing.

3. **Resend burst limits:** Resend's documentation doesn't clarify burst handling (e.g., 1,000 invites at once). Test this before relying on Resend for batch outreach.

4. **LinkedIn API partnership:** Official LinkedIn Recruiter API access requires partnership agreement. Worth exploring for Phase 2+ — reduces dependency on third-party sourcing APIs.

5. **Sequence abort on reply:** Should the sequence auto-pause when a candidate replies (requires Workflows' `waitForEvent`), or does the recruiter manually pause? Design decision needed.

6. **Data residency for EU:** If Pipe routes EU candidates to Cognism, should their `sourced_profiles` rows live in a separate D1 database for GDPR data residency? Cloudflare D1 supports location hints but not strict geo-fencing.

7. **Apollo webhook coverage:** R2 didn't find documentation on Apollo webhook events. If Apollo is avoided (recommended), this is moot. But if used, need to verify whether enrichment-complete and bounce events are available via webhook.

---

## Competitive Landscape Summary

| Platform | Sourcing | Outreach | CRM | Assessment | Pricing |
|---|---|---|---|---|---|
| **Serra** | AI + warm graph | Automated sequences | Lightweight | None | $200-400/seat/mo |
| **Gem** | 800M profiles | Email sequences | Full ATS+CRM | None | ~$300/mo |
| **Ashby** | Native + integrations | Email + LinkedIn | Full ATS+CRM | None | ~$300-800/mo |
| **Instantly** | None | Email + LinkedIn | Campaign-level | None | $47-97/mo |
| **Pipe (proposed)** | Via RocketReach/PDL | Via Instantly + Resend | D1 native | Code review + Culture interview | TBD |

Pipe's position: **assessment-first platform that integrates sourcing and outreach as a pipeline accelerator**, not a CRM or ATS replacement.

---

## Research Files

| File | Scope | Sources |
|---|---|---|
| `intake-outreach-crm-R1-serra-teardown.md` | Serra deep-dive + competitor landscape | 21 sources |
| `intake-outreach-crm-R2-sourcing-apis.md` | Sourcing API comparison (8 providers) | 30 sources |
| `intake-outreach-crm-R3-crm-outreach.md` | CRM/outreach platforms + HubSpot | 30 sources |
| `intake-outreach-crm-R4-integration-arch.md` | CF Workers integration architecture | 21 sources |
