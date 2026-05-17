---
id: conflict-001
dimensions: [conflict-handling, collaboration]
seniority: [mid, senior, lead, staff, architect]
allow_followups: true
expected_star_slots: [S, T, A, R]
estimated_response_time_seconds: 210
tags: [technical-disagreement, peer-conflict]
---

## Question

Tell me about a technical disagreement you had with a peer that took a while to resolve. What was the disagreement, how did you engage with it, and what happened?

## Why we ask this

Technical disagreements are the lowest-stakes form of conflict and therefore the easiest place to observe conflict-handling behavior honestly. A candidate who cannot engage productively in a technical disagreement will have much worse patterns in higher-stakes conflicts.

The "took a while to resolve" framing is intentional — it blocks the lazy answer of "we just talked it through and agreed." Real disagreements take more than one conversation.

## BARS rubric

- **5** — Specific disagreement, specific peer, can articulate the *peer's* position fairly (a steelman, not a strawman). Describes concrete actions beyond just talking — writing it up, prototyping, bringing in a third opinion, revisiting after some time. Outcome includes either a genuine resolution or a principled agreement-to-disagree. Includes what the candidate learned from the peer's position.
- **4** — Specific, fair steelman, concrete actions, clean outcome. Less detail on what they took from the peer's view.
- **3** — Specific disagreement and engagement. Steelman is weak or absent. Outcome is "we compromised."
- **2** — Describes a disagreement where the other person's position is clearly framed as wrong. Candidate's engagement is mostly repeating their own argument more forcefully.
- **1** — Cannot produce an example. Or: describes a disagreement where the other person eventually "came around" and the candidate was right all along. Or: describes avoiding the disagreement and letting the other person have their way.

## Calibration examples

### Low (1-2)

> "I had a disagreement with another engineer about whether to use Redux or Zustand on our frontend. He kept pushing Redux because it was familiar to him, but Zustand is just obviously simpler for our use case. I eventually just wrote the first few components in Zustand and it was so much cleaner that he agreed."

Strawmanned peer ("because it was familiar"), own position presented as obviously correct, resolution by candidate unilaterally shipping their choice. Scores 2.

### Medium (3)

> "A senior engineer and I disagreed on how to structure our new service's error handling. He wanted centralized error boundaries; I wanted errors to be returned as values from each function. We went back and forth in design reviews for a while, ended up doing a mix of both. It worked out fine."

Specific, both positions roughly acknowledged, compromise without any deeper synthesis. Scores 3.

### High (4-5)

> "A peer and I disagreed about whether to add optimistic UI updates to our order management flow. I was against because the failure modes were scary — a stale order state could cause real problems for the ops team. She was for, because the product team was getting complaints about lag. We argued in the PR and then in a synchronous meeting and didn't resolve it. I wrote up my concerns as a doc, and halfway through writing I realized I hadn't actually talked to anyone on the ops team about which specific failure modes they'd noticed. I did, and two of the three things I was worried about they said they'd rather tolerate than keep the lag. The third was a real dealbreaker. We shipped optimistic updates with a server-side lockout on that one specific state. The conversation that unstuck us was the one with the ops team — neither of us had actually asked them. She and I now have a habit of 'who haven't we asked?' when we're arguing past each other."

Specific disagreement, both positions fairly represented, concrete action (writing up, consulting the affected team), unexpected realization through the process, nuanced resolution that took both concerns seriously, durable shared habit. Scores 5.

## Probe library

- *strawmanned peer*: "Can you describe their position as they would have described it? What were they seeing that you weren't?"
- *unilateral resolution*: "How did they feel about the outcome? Did you check in with them after?"
- *no steelman*: "What was the strongest version of their argument? Is there any scenario where they'd have been right?"
- *just-talked-it-through*: "Specifically — what did you do beyond talking? Any writing, prototyping, pulling in others?"
