---
status: current
answers: "What is Pipe and why does it exist"
owner: knowledge/STRATEGY.md
see_also: [migration/PLAN.md, knowledge/STRATEGY.md]
---

# PIPE — The Dream

## What we're building

An AI-native technical interview platform that assesses candidates through realistic work simulations — not toy coding puzzles or trivia quizzes.

The flagship experience: a **multi-turn code review** where the candidate reviews a real PR, leaves comments, and engages in a back-and-forth conversation with the PR author (an AI agent that pushes back, asks for clarification, and makes fixes). The candidate is scored on communication, technical depth, and review practice — not just "did they find the bugs."

## Who it's for

**Recruiters** who want to assess candidates on how they actually work — not how well they memorize algorithms.

**Candidates** who want to show they can read complex code, reason about trade-offs, communicate clearly, and drive a code review to resolution.

## Design Principles

- **Brutalist glassmorphism** — dark #0c0c0e background, Space Mono font, sharp edges with subtle transparency
- **Challenge type badges:** CODE_REVIEW=blue `#60a5fa`, CODE_IMPLEMENTATION=purple `#a78bfa`, QUIZ_MCQ=green `#4ade80`, QUIZ_SHORT_ANSWER=amber `#fbbf24`

## What we are NOT building

- LeetCode-style algorithmic puzzles
- Trivia quizzes about language syntax
- Human-interviewer replacement (AI augments, does not replace)
- A generic HR platform (we own the technical assessment niche)

## How we will win

1. **Multi-turn code review** — nobody else ships this at scale. HackerRank and CodeSignal do static diffs. Woven is human-graded and expensive. GitLab does it internally but can't productize it.
2. **Culture/behavioral as a second pillar** — structured STAR interviews with BARS rubrics, scored by AI with human-expert reliability (QWK ≥ 0.60).
3. **Role Discovery as calibration** — the pipeline starts with understanding the role deeply, so every downstream assessment is team-specific.
4. **Legal defensibility** — content validity, adverse-impact monitoring, EEOC/AIVIA/EU AI Act compliance built in from day one.

## MVP Definition

A real person (not a developer) can:
1. Sign up with an email address
2. Create a pipeline for "Senior Frontend Engineer"
3. Get a shareable candidate link
4. Send it to 3 people
5. Each person completes challenges — no sign-in required
6. Recruiter logs in and sees 3 candidates ranked by score with per-challenge breakdown

Everything else is post-MVP.
