---
status: current
answers: "What is Pipe and why it exists"
owner: knowledge/STRATEGY.md
see_also: [docs/project-brief.md, knowledge/STRATEGY.md, migration/PLAN.md]
---

# PIPE — The Dream

## What we're building

An AI-native developer interview platform that assesses candidates through realistic work simulations — not toy coding puzzles or trivia quizzes.

The flagship experience: a **multi-turn code review** where the candidate reviews a real PR from a real open-source repo, matched to both the role and the candidate. An AI agent plays the PR author — pushing back, asking for clarification, making fixes. The candidate is scored on communication, technical depth, review practice, and decision-making — not just "did they find the bugs."

Secondary pillar: a structured behavioral/culture interview conducted by an AI agent using STAR-format questions and BARS rubrics, producing evidence-linked, legally defensible reports.

Tertiary experience: an **open-source implementation challenge** where the candidate fixes a live issue in a dev container, using AI copilot, with all interactions logged and scored.

## Who it's for

- **Recruiters** who want async, high-signal technical screening without setup complexity
- **Developer managers / tech leads** who want to see *how* a candidate thinks, not just *what* they know
- **Candidates** who want to demonstrate real engineering judgment in realistic scenarios

## Design Principles

- **Brutalist glassmorphism** — dark #0c0c0e background, Space Mono font, sharp edges with subtle transparency
- **Challenge type badges:** CODE_REVIEW=blue `#60a5fa`, CODE_IMPLEMENTATION=purple `#a78bfa`, QUIZ_MCQ=green `#4ade80`, QUIZ_SHORT_ANSWER=amber `#fbbf24`

## What we are NOT building

- LeetCode-style algorithmic puzzles
- Trivia quizzes about language syntax
- Human-interviewer replacement (AI augments; humans approve and live-interview)
- A generic HR platform (we own the technical assessment niche)
- Our own scheduling system (we integrate Calendly/Cal.com, not reinvent)
- Our own email infrastructure (Resend/Cloudflare, not AWS SES)

## How we will win

1. **Multi-turn code review** — nobody else ships this at scale. HackerRank and CodeSignal do static diffs. Woven is human-graded and expensive. GitLab does it internally but can't productize it.
2. **Culture/behavioral as a second pillar** — structured STAR interviews with BARS rubrics, scored by AI with human-expert reliability (QWK ≥ 0.60).
3. **Role Discovery as calibration** — the pipeline starts with understanding the role deeply, so every downstream assessment is team-specific.
4. **Open-source implementation as the moat** — candidates fix real issues on real repos, not toy problems. Every competitor uses synthetic challenges.
5. **Legal defensibility** — content validity, adverse-impact monitoring, EEOC/AIVIA/EU AI Act compliance built in from day one.

## The product thesis

PIPE doesn't test skills in isolation. It simulates *how the candidate actually works*:
- Reading complex code and finding bugs (code review)
- Arguing with an AI agent about trade-offs (multi-turn review)
- Making decisions under constraints (open-source implementation)
- Communicating clearly in written and spoken form (screening + culture)
- Collaborating with AI tools (dev container with copilot logging)

The assessment *is* the work.

## MVP Definition (Phase 2)

A real person (not a developer) can:
1. Sign up with an email address
2. Describe a role in natural language
3. The system interviews them briefly, then auto-generates a pipeline
4. They review, tweak 3-4 toggles, and approve
5. Get a shareable candidate link
6. Send it to 3 people
7. Each person completes async AI stages — no sign-in required
8. Recruiter logs in and sees 3 candidates with per-stage scores, transcripts, and video recordings

Everything else is post-MVP.

## Full vision (September 2026)

See `docs/project-brief.md` for the complete phased roadmap, glossary, and current state.
