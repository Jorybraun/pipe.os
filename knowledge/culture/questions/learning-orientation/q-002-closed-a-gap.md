---
id: learning-002
dimensions: [learning-orientation, ownership]
seniority: [entry, mid, senior, lead]
allow_followups: true
expected_star_slots: [S, T, A, R]
estimated_response_time_seconds: 180
tags: [deliberate-learning, skill-acquisition]
---

## Question

Describe a gap in your knowledge or skills you closed deliberately in the last year or two. How did you notice the gap, what did you do, and how do you know it's closed?

## Why we ask this

Passive learning (absorbing things as they come up) is common. Deliberate learning (noticing a specific gap and closing it on purpose) is less common and more indicative of a growth mindset. This question also tests whether the candidate has any working metacognition — can they recognize what they don't know?

The "how do you know it's closed" probe is critical. Candidates with weak learning orientation describe the input (courses, books) but not the output (what they can now do).

## BARS rubric

- **5** — Names a specific gap, describes how they *noticed* it (not just "I decided I should learn X"), describes deliberate actions taken, AND describes concrete evidence the gap is closed — ideally a specific situation where they used the new skill effectively. Includes what they got wrong in the first few attempts.
- **4** — Specific gap, clear actions, decent evidence of closure. Less detail on noticing or stumbles.
- **3** — Describes learning something new and using it, but the framing is closer to "I took a course" than "I noticed a gap and closed it."
- **2** — Describes general skill growth. Gap is vague, evidence of closure is vague.
- **1** — Cannot produce an example. Or: the "gap" is something they haven't actually closed yet. Or: describes learning in purely input terms (courses taken, books read) with no output evidence.

## Calibration examples

### Low (1-2)

> "I've been trying to learn more about systems design this year. I bought a couple of books and I watch videos on YouTube sometimes."

Vague gap, input-only, no evidence of output. Scores 1.

### Medium (3)

> "I hadn't done much with Kubernetes and my new team was all on k8s. I took a few courses on Udemy and paired with a senior engineer for my first few deploys. I can ship k8s workloads on my own now."

Specific, clear actions, output evidence. But the gap-noticing was external (new team required it) rather than self-directed. Scores 3.

### High (4-5)

> "I noticed I was avoiding database work on my team. Whenever a ticket was database-heavy I'd pick up something else. I realized I was avoiding it because I didn't really understand query plans — I could read an EXPLAIN output and sort of nod, but I couldn't diagnose a slow query on my own. I spent about six weeks going through the PostgreSQL docs on indexing and query planning, and I deliberately grabbed the three slowest queries in our production dashboards to optimize as practice. The first one I made *worse* — I added an index that the planner didn't pick up, because I'd missed that our query had a function wrapper that killed the index. That was the most useful mistake of the whole project. By the fourth query I was faster than our DBA. The evidence is: I no longer dodge database tickets. I also catch N+1 queries in code review that I would have missed before."

Self-noticed gap (behavioral self-observation), deliberate and specific actions, honest about stumble, concrete before/after evidence. Scores 5.

## Probe library

- *input-only*: "What were you able to do after that you couldn't do before? Give me a specific example."
- *externally imposed*: "Did you spot the gap yourself, or was it more that the situation made it obvious?"
- *still-open gap*: "So the gap is closed now? What would tell you it wasn't?"
- *no stumbles*: "What did you get wrong along the way?"
