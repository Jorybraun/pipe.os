# Culture Interview Knowledge Base

Source of truth for the Culture Interview Agent (see `docs/decisions/ADR-029-culture-interview-agent-architecture.md`). Every question, rubric, probe, and calibration example used by the agent lives here as markdown and is synced to D1 at deploy time.

This wiki is **version-controlled craft work**, not a CMS. Changes go through PR review. Agent quality lives and dies by the quality of these files.

---

## What is a culture interview?

A structured, STAR-format behavioral interview conducted by an AI agent. The candidate is asked a sequence of past-behavior questions drawn from this bank, probed for missing STAR slots (Situation / Task / Action / Result), and scored after the fact on two kinds of output:

1. **Competency scores** (ADR-029): 5 behavioral dimensions (ownership, collaboration, learning orientation, conflict handling, self-awareness), each rated 1-5 against a BARS rubric with verbatim evidence quotes.
2. **Culture profile** (ADR-030): a 5-axis radial chart (autonomy / risk tolerance / work pace / collaboration style / feedback orientation) comparing the candidate's inferred position against the team's self-declared benchmark. No aggregate score.

The recruiter reviews every report before any decision affects the candidate (ADR-031).

---

## Directory structure

```
knowledge/culture/
├── README.md                     ← this file
├── dimensions/                   ← the 5 competency scoring dimensions
│   ├── ownership.md
│   ├── collaboration.md
│   ├── learning-orientation.md
│   ├── conflict-handling.md
│   └── self-awareness.md
├── culture-profile/              ← the 5 culture-profile dimensions
│   ├── autonomy.md
│   ├── risk-tolerance.md
│   ├── work-pace.md
│   ├── collaboration-style.md
│   └── feedback-orientation.md
├── questions/                    ← the question bank — one file per question
│   ├── ownership/
│   ├── collaboration/
│   ├── learning-orientation/
│   ├── conflict-handling/
│   └── self-awareness/
├── probes/                       ← the probe library — shared across questions
│   └── star-slot-probes.md
├── role-overlays/                ← how role discovery context shifts question selection
│   ├── senior-ic.md
│   ├── manager.md
│   └── README.md
└── .raw/                         ← scraped material (phase C), not synced to D1
    └── .gitkeep
```

---

## Authoring rules

1. **Every question file must include:** frontmatter (id, dimensions, seniority, expected_star_slots, allow_followups) + question text + rationale + BARS rubric (5 points) + 3-shot L/M/H calibration + probe library. See `questions/README.md` for the template.
2. **No question ships without calibration.** A question without L/M/H examples cannot be scored.
3. **BARS anchors describe behavior, not traits.** "Led a cross-team migration of X" not "showed strong leadership."
4. **Each dimension file** defines what is being measured and links to its calibration examples.
5. **Never roast the candidate or the team** in probes or rubric copy — language is diplomatic and constructive (see synthesis tone rule).

---

## Sync to D1

At deploy time, `scripts/sync-culture-wiki.ts` (to be written in task #25) parses every `questions/**/*.md` file and upserts into the D1 `culture_questions` table. The culture agent reads questions from D1 at runtime. The wiki is the source of truth; D1 is the cache.

If the sync script fails, deploy fails. Stale D1 data is worse than no data.

---

## References

- `docs/decisions/ADR-029-culture-interview-agent-architecture.md` — architecture
- `docs/decisions/ADR-030-culture-profile-operationalization.md` — 5-dimension profile
- `docs/decisions/ADR-031-ai-hiring-compliance-architecture.md` — consent, HITL, audit
- `knowledge/outputs/behavioral-culture-interview-agent.md` — research brief (617 lines, 48 sources)
