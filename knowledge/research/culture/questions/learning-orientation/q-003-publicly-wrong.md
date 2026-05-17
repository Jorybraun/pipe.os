---
id: learning-003
dimensions: [learning-orientation, self-awareness]
seniority: [senior, lead, staff, manager, architect]
allow_followups: true
expected_star_slots: [S, T, A, R]
estimated_response_time_seconds: 180
tags: [public-wrongness, intellectual-humility, psychological-safety]
---

## Question

Tell me about a time you took a strong position in a meeting or discussion and turned out to be wrong. What happened, how did you find out, and what did you do?

## Why we ask this

Strong learning orientation includes tolerance for public wrongness. Candidates who cannot produce an example either don't take strong positions (conflict avoidant), don't notice when they're wrong (low self-awareness), or do notice but cannot admit it (ego-protection). All three are distinct failure modes and each shows up in the scoring.

This question is also a good signal for psychological-safety contribution: candidates who handle their own public wrongness with grace make it safer for others to be wrong.

## BARS rubric

- **5** — Specific situation, specific strong position, specific moment of realizing they were wrong, and a clear acknowledgment to the people they'd argued with. Describes their internal experience of being wrong honestly (including any ego discomfort). Shows what they now do differently, not just "I learned to be humble."
- **4** — Specific and honest. Clear acknowledgment. Less detail on the internal experience.
- **3** — Names a time they were wrong but the framing softens the error — "turned out there was more context I didn't have at the time."
- **2** — Names a time where "we" were collectively wrong. Individual position is less clear.
- **1** — Cannot produce an example. Or: the "wrong" position was actually correct in retrospect ("I was right but the political situation made my position untenable"). Or: describes being wrong without any emotional truth — purely intellectual.

## Calibration examples

### Low (1-2)

> "Sometimes I take strong positions and I'm open to being wrong, but I try to make sure I have good reasons before I argue something. I can't think of a specific time I was wrong in a way that mattered."

No example, implied claim of good judgment, evasion dressed as humility. Scores 1.

### Medium (3)

> "I argued pretty hard in a design review that we should use GraphQL for our new service. The team went with REST in the end, and looking back they were right given our team size and the tooling we already had. I would probably make a similar argument now but I'd listen more to the cost of learning curve."

Specific position, admission of wrongness, some reflection — but the "probably make a similar argument" softens it. Scores 3.

### High (4-5)

> "We were debating whether to migrate our main API from Python to Go. I was strongly pro-migration — I wrote a whole doc, presented it in an architecture review, and pushed back on everyone who raised concerns. Two months later I joined a team that had done the exact migration I was advocating. It was a disaster, for reasons I had completely missed: our team's operational maturity was the bottleneck, not the language. The languages were roughly equivalent for our workload, but the switching cost landed on a team that didn't have the runbooks, metrics, or on-call experience to handle a new stack. I had built a technical argument that ignored the organizational reality. I wrote a doc retracting my position and sent it to the people I'd argued with most strongly. Two of them told me later it was the thing that made them most willing to disagree with me — because they'd seen me actually change my mind in public. I still take strong positions, but now I explicitly ask 'what would have to be true for me to be wrong about this?' before I commit to one."

Specific strong position, concrete realization with causal detail, public retraction, awareness of the psychological-safety payoff, explicit process change. Scores 5.

## Probe library

- *no example*: "Take your time. It doesn't have to be a big one — any time you argued a position and later realized you were off."
- *softened wrongness*: "When you say 'more context you didn't have' — was your original position actually wrong, or just under-informed?"
- *no acknowledgment*: "Did you tell the people you'd argued with? How did that conversation go?"
- *no internal truth*: "What did it feel like when you realized? Did you want to admit it right away?"
