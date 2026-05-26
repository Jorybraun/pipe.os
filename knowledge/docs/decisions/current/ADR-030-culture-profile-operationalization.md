# ADR-030: Culture Profile Operationalization

**Date:** 2026-04-07
**Status:** Proposed
**Deciders:** Hans (founder)

---

## Context

The Culture Interview Agent (ADR-029) produces two categories of output: behavioral competency scores (how the candidate *behaves*) and a culture profile (how the candidate *fits* the organization's working environment). This ADR is about the second category: what a "culture profile" actually is in PIPE, how it is operationalized, and — critically — what it is *not*.

### The research is unambiguous

`knowledge/outputs/behavioral-culture-interview-agent.md` §3 synthesizes the P-O (Person-Organization) fit literature across the last three decades. Two findings drive this ADR:

1. **P-O fit predicts retention (ρ ≈ .44) but NOT performance (ρ ≈ .15).** A candidate who "fits" is more likely to stay, not more likely to do good work. These are separate constructs and conflating them is the primary failure mode of commercial culture-fit products.
2. **"Culture fit" as a single score amplifies bias without improving predictive validity.** A scalar "fit" is a laundering mechanism for pattern-matching on demographic and class signals. The research literature has been moving away from "culture fit" toward "culture add" for over a decade.

Commercial platforms (reviewed in §4 of the brief) that ship a single 0-100 "culture fit score" have repeatedly been challenged in EEOC complaints and, in two cases, settled. PIPE cannot ship such a score and remain defensible.

### What the recruiter needs

At the same time, recruiters have a legitimate need: they want to know whether a candidate will be comfortable and effective in the team's actual working environment. A person who needs daily in-person collaboration will struggle on an async-first distributed team. A person who thrives on ambiguous ownership will chafe under detailed process. These are real compatibility facts and the product should surface them — without reducing them to a number.

---

## Decision

Operationalize culture as a **5-dimension profile**, presented as a visual comparison between the candidate's inferred position and the organization's self-declared benchmark. **Do not ship a single aggregate culture-fit score.** Frame the feature as "culture add" — showing *where the candidate differs* from the current team, not how well they "match."

### 1. The five dimensions

Each dimension is a 1-5 slider. Both the org benchmark (set by the recruiter) and the candidate's inferred position (output by the scoring pipeline per ADR-029 §6 stage 2) are points on the same scale, so they can be rendered on the same radial chart.

| Dimension | Low (1) | High (5) |
|---|---|---|
| **Autonomy** | Structured direction, clear tasks, frequent check-ins | Ambiguous ownership, self-directed priorities |
| **Risk Tolerance** | Cautious, process-driven, measured experimentation | Ship-first, learn-in-public, bias to action |
| **Work Pace** | Steady, sustainable, deep focus blocks | Fast, reactive, multi-context switching |
| **Collaboration Style** | Solo deep work, async communication | Pairing, real-time sync, high interrupt tolerance |
| **Feedback Orientation** | Diplomatic, private, structured reviews | Direct, public, continuous |

These five were selected from the research brief §3.4 as the dimensions with the strongest published evidence for P-O fit predictive validity at the individual-work-environment level. The OCAI (Organizational Culture Assessment Instrument) and Competing Values Framework were considered (see Alternatives) and rejected — they describe *organizations*, not the individual working experience, and generate categorical outputs that do not map cleanly to slider-based candidate inference.

### 2. Org benchmark: recruiter-configured at challenge creation

When a recruiter adds a culture interview to a pipeline, the `StageConfigPanel` renders 5 sliders and asks the recruiter to set their team's actual position on each dimension. This is stored in `challenge.server_config` (hidden from candidates per ADR-007) as:

```json
{
  "culture_benchmark": {
    "autonomy": 4,
    "risk_tolerance": 3,
    "work_pace": 4,
    "collaboration_style": 2,
    "feedback_orientation": 5
  },
  "focus_dimensions": ["autonomy", "feedback_orientation"]
}
```

The `focus_dimensions` field (optional, 0-2 entries) lets the recruiter flag dimensions they especially want the agent to probe — e.g., "we've had three hires in a row struggle with our feedback culture, probe this one hard." The agent uses this to adjust question selection weight.

The benchmark is mutable across the life of the challenge — a team's culture actually changes, and last quarter's benchmark shouldn't bind this quarter's hiring.

### 3. Candidate inference: scoring pipeline stage 2

Per ADR-029 §6, the scoring pipeline runs 5 specialist Gemma calls after the interview completes, one per culture dimension. Each call:
- Receives the full transcript
- Receives the dimension's definition + 3-shot calibration examples (low/medium/high candidate excerpts)
- Outputs `{ position: 1-5, evidence_quotes: string[], confidence: 0-1 }`

Evidence quotes are mandatory. A position with no evidence grounding is coerced to `null` and flagged to the recruiter as "insufficient signal."

### 4. Presentation: radial chart, no composite score

The recruiter report (`src/components/Culture/CultureReport.tsx`) renders a 5-axis radar chart showing:
- **Org benchmark** as a solid filled polygon
- **Candidate profile** as an outlined polygon overlaid on top
- Each axis labeled with the dimension name
- Each candidate point clickable to reveal the evidence quotes that drove the inference

**No overall percentage, no "fit score", no green/red indicator.** The recruiter reads the shape, clicks on dimensions where the candidate diverges from the benchmark, reads the evidence quotes, and forms their own judgment.

Above the chart, a short narrative (produced in scoring pipeline stage 3) highlights the 1-3 most significant divergences in diplomatic language:

> "This candidate's responses suggest a stronger preference for structured direction than your team's current norm. If ownership ambiguity is core to the role, this is worth probing further in the next stage."

The narrative is constrained by prompt to be **constructive** — never "roast" the candidate or the team. This matches the tone guidance from the role-discovery synthesis memory.

### 5. "Culture add" framing in copy

Every user-facing label uses "culture add" framing, not "culture fit":
- Challenge type label: **"Culture Fit Interview"** is internal; candidate-facing copy says **"Culture & Values Interview"**
- Report section header: **"Culture Profile"** not **"Culture Fit Score"**
- Narrative language: "This candidate *differs from* the team on X" not "This candidate *does not fit* on X"
- No thresholds, no pass/fail, no colored dots that imply a good/bad binary

### 6. Explicit non-goals

- **No aggregate score.** The product will never display a "culture fit %" or "culture score out of 100". Attempts to add one must be rejected in PR review with a pointer to this ADR.
- **No automatic filtering.** The culture profile is never used as an input to ranking, sorting, or "strong candidate" badges. It is a decision-support artifact, not a gatekeeper.
- **No benchmark without consent.** Recruiters cannot compare a candidate against a benchmark the candidate was not told existed (see ADR-031).

---

## Alternatives Considered

### A. OCAI / Competing Values Framework

**Rejected.** OCAI describes organizations along four archetypes (Clan / Adhocracy / Market / Hierarchy) and is designed to be self-administered by existing employees. Adapting it to infer a *candidate's* position from a behavioral interview requires assumptions the framework was not built for. Moreover, OCAI outputs are categorical, which cannot be rendered as a comparison chart and lose the "culture add" framing.

### B. Single aggregate "Culture Fit" score

**Rejected on legal and empirical grounds.** Research brief §3.2: P-O fit predicts retention, not performance, and a single score is ρ ≈ .15 against performance. Research §5.1-5.3 documents two EEOC settlements against platforms that shipped aggregate culture scores. The upside (a simple number for recruiters to glance at) is not worth the validity and legal downside.

### C. Binary "fit / no-fit" flag

**Rejected for the same reasons as B**, amplified: a binary is worse than a score because it hides the underlying evidence entirely.

### D. Big Five personality inference

**Rejected.** Inferring OCEAN personality dimensions from a behavioral interview has weak construct validity (research §3.3). The Big Five is a self-report instrument; converting it to an inference task on transcript data produces unreliable scores that look authoritative. If a candidate wants a Big Five assessment, they can take one — we will not fake one.

### E. Let recruiters define their own dimensions

**Rejected at v1.** Custom dimensions without published calibration examples cannot be scored reliably. Once the 5-dimension baseline is proven and calibrated, a "custom dimension" feature can be added with the recruiter required to supply their own calibration examples — but that is a future ADR.

---

## Consequences

**Positive:**
- The product is defensible: no aggregate score means no single number to challenge in court.
- Recruiters get a tool that surfaces real compatibility signals without encouraging pattern-matching on demographics.
- The "culture add" framing aligns with current HR research and signals to sophisticated recruiters that PIPE takes this seriously.
- The 5-dimension scale makes the evidence-quote requirement tractable — each dimension gets ~2-3 quotes.

**Negative:**
- Recruiters who are used to aggregate scores may initially find the radial chart less "actionable." Product copy and onboarding must explicitly explain why there is no score.
- Sales conversations with teams that ask "what's your culture fit score?" require education; the answer is "we don't ship one, here's why." Expect friction with less-sophisticated buyers.
- Authoring calibration examples for the 5 culture dimensions is additional craft work on top of the 5 competency dimensions from ADR-029.

**Follow-ups:**
- Onboarding copy for first-time recruiters must explain the culture-add framing
- A future "custom dimensions" feature requires calibration-example authoring by the recruiter, gated on Pro tier
