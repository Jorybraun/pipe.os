---
id: conflict-002
dimensions: [conflict-handling, collaboration]
seniority: [senior, lead, staff, manager]
allow_followups: true
expected_star_slots: [S, T, A, R]
estimated_response_time_seconds: 180
tags: [stakeholder-management, pushback, scope-negotiation]
---

## Question

Tell me about a time a stakeholder — a product manager, a designer, a business leader — pushed back hard on something you'd built or were planning to build. What was the pushback, and what did you do?

## Why we ask this

Stakeholder conflict is distinct from peer conflict because the asymmetry is different — the stakeholder often has more authority over the *what* while the candidate has more authority over the *how*. Strong candidates navigate this asymmetry by engaging with the underlying need, not just the stated position. Weaker candidates either capitulate (do whatever the stakeholder says) or dig in (protect their technical choices as non-negotiable).

## BARS rubric

- **5** — Specific stakeholder, specific pushback, clear engagement with the *underlying* concern not just the stated position. Describes a concrete action — often a prototype, a numbers workup, a different framing — that moved the conversation. Outcome preserves the legitimate stakeholder concern AND the candidate's technical integrity. Includes what they learned about the stakeholder.
- **4** — Specific, engages underlying concern, concrete action, clean outcome.
- **3** — Specific pushback and response. Engages the stated position more than the underlying concern. Compromise reached.
- **2** — Describes the stakeholder as unreasonable or uninformed. Response is mostly education ("I explained why we had to do it this way"). Outcome is either capitulation or stakeholder eventually gave up.
- **1** — Stakeholder is the villain. Or: candidate capitulated entirely and rebuilt whatever was asked without engaging. Or: cannot produce an example.

## Calibration examples

### Low (1-2)

> "Our PM kept asking us to add features to a core library without understanding the maintenance burden. I put together a long document explaining why we couldn't just keep piling things on, and eventually she accepted that we needed to be more selective."

Framed as stakeholder ignorance, "educated her" response, outcome is grudging acceptance. Scores 2.

### Medium (3)

> "A designer pushed back on the loading state I'd built because she thought it felt slow. I disagreed because the backend response times were actually fine, but I added a skeleton state and a slight animation and she was happy."

Specific, responsive, decent outcome — but the candidate doesn't engage with *why* it felt slow, just with the surface complaint. Scores 3.

### High (4-5)

> "A senior PM pushed back hard on a feature flag architecture I was proposing for our experimentation platform. His position was that it was too complex and would slow down experimenters. I initially thought he just didn't understand the engineering tradeoffs. I spent an hour listening to the last three experiments his team had run and heard three stories about experimenters waiting on engineering support for config changes — exactly the problem I thought my design would solve. But I also heard that my design required experimenters to understand a dependency graph, which was new cognitive load. His concern wasn't about complexity in the abstract — it was specifically about complexity landing on experimenters. I redesigned the API so that for 90% of experiments you didn't need to think about the dependency graph at all — it only surfaced when you were doing something unusual. He signed off the same week. I also realized I'd been treating his pushback as uninformed when he actually had better data about user behavior than I did. That reframe has been useful in every PM conversation since."

Specific, real engagement with underlying concern (listened to actual experiments), redesign based on new understanding, explicit acknowledgment of own initial dismissiveness, durable lesson. Scores 5.

## Probe library

- *stakeholder as villain*: "What were they actually worried about? Not what they said, but the underlying concern."
- *education-only*: "Did you change anything about what you were building, or just how you explained it?"
- *capitulation*: "Did you agree with their concern, or did you just do what they asked? What did you think was the right call?"
- *no underlying need*: "Why do you think they felt that way? What were they protecting?"
