---
id: ownership-002
dimensions: [ownership, self-awareness]
seniority: [entry, mid, senior, lead]
allow_followups: true
expected_star_slots: [S, T, A, R]
estimated_response_time_seconds: 180
tags: [accountability, failure, incident-response]
---

## Question

Tell me about a time you shipped something that broke. What was it, how did you find out, and how did you handle it?

## Why we ask this

Ownership is most visible in failure. Candidates who own outcomes describe breakage in first-person, name what they did wrong, and describe repair actions. Candidates who don't own outcomes describe breakage as something that happened *to* their code — passive, blameless to the point of disappearance.

This is not a "gotcha" question and the agent's tone should make clear that every engineer has shipped breakage. The rubric rewards honesty and accountability, not heroism.

## BARS rubric

- **5** — Candidate describes a specific thing they shipped that broke, names the root cause in first person ("I didn't handle X"), describes how they found out (ideally including that *they* found out before a customer did), describes the repair, AND describes a durable change to how they work (process change, test they now write, etc.).
- **4** — Specific breakage, clear first-person cause, clear repair. No durable change but clean accountability.
- **3** — Describes a breakage but frames it partly as someone else's fault or as an unpredictable accident. Repair is described.
- **2** — Describes a breakage in passive voice. "The deploy broke," "the test didn't catch it." No clear ownership of the cause.
- **1** — Cannot describe a breakage. Or: describes one in which they were blameless and others are at fault. Or: the "breakage" is actually a minor cosmetic issue framed as a dramatic failure.

## Calibration examples

### Low (1-2)

> "We had an outage once, but it turned out to be a networking thing on the AWS side. Not really our fault but we had to deal with the fallout."

No ownership, no specificity about their role, blames infrastructure. Scores 1.

### Medium (3)

> "I merged a PR that had a subtle bug in the checkout flow. QA missed it, and it went to production and a few customers had issues for about an hour before we caught it and rolled back. We added a test for that case after."

Specific breakage, names the team response, but softens their personal role ("QA missed it"). Scores 3.

### High (4-5)

> "I shipped a caching change that invalidated keys in the wrong order. I ran the staging check, it passed, I merged and deployed on a Friday afternoon — which is the first thing I'd change. A paying customer called support two hours later because they were seeing stale data. I got paged, reverted in six minutes, wrote a postmortem that weekend, and added a cache-invalidation ordering test. I stopped shipping caching changes on Fridays entirely — that's a rule I still follow three years later."

Specific, first-person cause, names the surfacing path (customer, not them — honest), repair, durable change, and self-enforcing rule. Scores 5.

## Probe library

- *no first-person cause*: "What do you think you missed? Walk me through your thought process when you shipped it."
- *blames team/tools*: "Setting the team aside — what was your specific role in how that happened?"
- *no durable change*: "What did you change about how you work after that?"
- *dramatic cosmetic issue*: "Can you walk me through the actual impact? How many people were affected?"
