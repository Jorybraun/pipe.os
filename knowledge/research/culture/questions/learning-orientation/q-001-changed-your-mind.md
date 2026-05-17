---
id: learning-001
dimensions: [learning-orientation, self-awareness]
seniority: [entry, mid, senior, lead, staff]
allow_followups: true
expected_star_slots: [S, T, A, R]
estimated_response_time_seconds: 150
tags: [belief-update, intellectual-honesty]
---

## Question

Tell me about something you changed your mind about recently in your work. What did you think before, what changed, and what do you think now?

## Why we ask this

The cleanest single test of learning orientation. Candidates who actively update their mental models can name specific beliefs they held, specific evidence that shifted them, and specific new positions. Candidates who don't update either produce nothing ("I can't think of anything"), produce stale examples from early career ("I used to hate TypeScript"), or produce non-beliefs ("I used to think we had enough time for X").

"Recently" matters — the scoring agent should probe if the example is older than six months, because stale examples suggest the candidate is reaching for a memorized answer.

## BARS rubric

- **5** — Names a specific, recent (within 6 months) belief they held about their work, names the specific evidence or experience that shifted them, and articulates the new position clearly. Includes some reflection on why they held the old belief in the first place.
- **4** — Recent, specific, clear before/after. Less reflection on the origin of the old belief.
- **3** — Names a belief shift but it is older, or the shift is about something mild (a tool, a process). Before/after is clear.
- **2** — Describes "learning" in general terms. Cannot quite name a belief that changed, just "adjusted my thinking."
- **1** — Cannot produce an example. Or: the "change of mind" is a standard career narrative (e.g., "I used to think I wanted to be a manager and then realized I preferred IC") that sounds rehearsed. Or: the new belief is indistinguishable from the old belief.

## Calibration examples

### Low (1-2)

> "I guess I used to be more of a perfectionist and now I've learned you have to ship. Everybody goes through that."

No specific belief, no specific evidence, no articulation of the new position. Scores 1.

### Medium (3)

> "Early in my last job I thought microservices were the right default for any new backend. After we hit some painful distributed-systems bugs I started thinking a monolith is fine for most teams until you have clear scaling pain. I'd probably start new projects as a monolith now."

Specific before/after, but a widely-circulated opinion and no personal origin story. Scores 3.

### High (4-5)

> "Three months ago I thought our team's habit of pairing on every non-trivial PR was wasteful — I'd been pushing people to pair less and ship faster. Then I took a two-week vacation, came back, and reviewed everything that had merged while I was out. Four of the seven PRs had subtle issues that would have been caught by a pair. I looked at the git history for the previous six months and realized pair-reviewed PRs had a 30% lower rate of follow-up fix commits. I was treating pairing as overhead because I'd done most of my career on solo-first teams and I hadn't actually measured it. I've stopped pushing people to pair less, and now I pair more often myself. The part I'm still working through: I'm not sure if pairing is universally worth it or just for our particular team."

Recent, specific belief, concrete measurement that shifted it, clear origin of the old belief (solo-first background), intellectually honest about residual uncertainty. Scores 5.

## Probe library

- *older example*: "That's helpful — is there something more recent? Within the last six months or so."
- *vague belief*: "What specifically did you think before? And what do you think now?"
- *no evidence*: "What changed your mind? Was it a specific event or more gradual?"
- *rehearsed narrative*: "Is there a smaller, more specific example? Something about a technical decision or a process?"
