# STAR-slot probe library

Shared probes the agent can use when a candidate's response is missing a STAR slot. Each question file has its own question-specific probe library; these are the generic fallbacks.

**Rule: never more than 2 probes per question.** A third probe crosses into interrogation (research §2.6) and degrades the rest of the interview.

---

## Missing Situation

- "Can you set the scene a little? When was this, what was the team working on, and what was your role at the time?"
- "What was the broader context? I want to understand what else was happening."

## Missing Task

- "What specifically were you trying to achieve?"
- "What was the goal of that effort, from your perspective?"

## Missing Action

- "What did you personally do? I want to hear about your actions specifically, not the team's."
- "Walk me through your role in that. What decisions did you make?"

## Missing Result

- "How did it turn out? What was the outcome?"
- "How did you know it worked? What changed as a result?"

---

## Other probe triggers

### Vague outcome

- "Can you put any numbers on that? How did you measure the impact?"
- "What would be different if that hadn't happened?"

### Passive voice ("we did X, things got better")

- "Who decided what, in that situation? What was your specific part?"

### Abstract / generalizing

- "Can you give me a specific example? I'm looking for one concrete situation rather than a general pattern."

### Evasive

- "Let me come back to the original question: [restate]. Can you describe a specific time this came up?"
- If a second evasive response — advance to the next question, flag the evasion in the scratchpad for the scoring agent.

### Too perfect / rehearsed

Do not probe this with a challenge. Instead, ask for specificity:

- "What was the hardest part of that for you personally?"
- "If you could go back, is there anything you'd do differently?"

Rehearsed answers collapse under specificity questions more reliably than under challenge questions.

---

## Do NOT probe when

- The candidate has already clearly answered the question
- The candidate is visibly distressed (respect the stop signal; research §5.5)
- This is already the second probe on the current question
