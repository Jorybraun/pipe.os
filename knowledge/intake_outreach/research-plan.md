# Research Plan: Intake, Outreach & CRM for Pipe

## Core question

How should Pipe build a Serra-like intake + outreach system — seamless role intake, candidate sourcing, multi-channel outreach, and CRM/communication — leveraging existing tools (Apollo, HubSpot, etc.) rather than building from scratch?

## Sub-questions

1. **Serra deep-dive**: What is Serra's full feature set, UX flow, and architecture? How do intake → sourcing → outreach → scheduling → CRM work end-to-end? What can we learn from their approach?

2. **Sourcing APIs — Apollo vs. alternatives**: What APIs exist for candidate search/enrichment (Apollo, RocketReach, People Data Labs, Proxycurl, LinkedIn)? Compare: data quality, coverage, pricing, API ergonomics, compliance (GDPR/CCPA). Is Apollo the right choice for Pipe?

3. **CRM & outreach platforms — build vs. buy**: What existing platforms (HubSpot, Instantly, Smartlead, Woodpecker, etc.) handle multi-channel outreach + CRM for recruiting? Can HubSpot or similar be integrated as the CRM layer so Pipe doesn't build one? What are the integration patterns (APIs, webhooks, embeds)?

4. **Communication orchestration**: How should multi-channel candidate communication work (email sequences, LinkedIn, SMS)? What are deliverability best practices? How do tools like Resend (already in Pipe's stack) fit? How do replies get routed back?

5. **Warm intro / network-based sourcing**: Serra's differentiator is warm intros via employee networks. How does this work technically? Is this feasible for Pipe to build or is it out of scope?

6. **Integration architecture for Pipe**: Given Pipe's Cloudflare Workers stack, how would sourcing + outreach + CRM integrate? What's the build-vs-buy boundary? What does the data model look like?

## Strategy

- **R1 (researcher)**: Serra product teardown + competitor landscape (Tapflow, Humanly, Gem, Ashby). Covers sub-questions 1, 5.
- **R2 (researcher)**: Sourcing API comparison — Apollo, RocketReach, People Data Labs, Proxycurl, Cognism, LinkedIn. Covers sub-question 2.
- **R3 (researcher)**: CRM/outreach platforms — HubSpot recruiting use cases, Instantly, Smartlead, Woodpecker, Mailshake. Integration patterns, APIs, webhooks. Covers sub-questions 3, 4.
- **R4 (researcher)**: Technical integration architecture — how to wire sourcing + outreach + CRM into a Cloudflare Workers app. Covers sub-question 6.

Expected rounds: 1-2

## Acceptance criteria

- [ ] All 6 sub-questions answered with ≥2 independent sources
- [ ] Apollo evaluated against ≥3 alternatives with concrete data (pricing, coverage, API)
- [ ] HubSpot integration feasibility assessed with API details
- [ ] At least 2 outreach platforms compared for recruiting use case
- [ ] Build-vs-buy recommendation with rationale
- [ ] Contradictions identified and addressed
- [ ] No single-source claims on critical findings

## Task ledger

| ID | Owner | Task | Status | Output |
|---|---|---|---|---|
| T1 | R1 | Serra teardown + competitor landscape | todo | serra-teardown.md |
| T2 | R2 | Sourcing API comparison (Apollo + alts) | todo | sourcing-apis.md |
| T3 | R3 | CRM/outreach platform analysis + HubSpot | todo | crm-outreach.md |
| T4 | R4 | Integration architecture for CF Workers | todo | integration-arch.md |

## Verification log

| Item | Method | Status | Evidence |
|---|---|---|---|

## Decision log

(Updated as the workflow progresses)
