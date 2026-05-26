# ADR-041: Role Discovery Calibrated Probes

**Date:** 2026-04-22
**Status:** Accepted
**Deciders:** Hans (founder)
**Extends:** [ADR-027](ADR-027-role-discovery-agent.md), [ADR-028](ADR-028-multi-stakeholder-role-discovery.md), [ADR-036](ADR-036-role-discovery-data-contract.md)
**Author:** Claude Opus 4.7 with founder

---

## Context

The Role Discovery agent (ADR-027) originally used an open-ended conversational protocol: the agent chose from seven question types (introductory, grand tour, example, drilling, direct, hypothesis, contrast) and followed energy across six domains. In practice this produced three failures:

1. **Wandering coverage** — The agent chased energy into one domain (typically technical stack) and left Team and Dispositional context sparse. A recruiter who talked enthusiastically about Kafka got 8 follow-ups on event streaming and zero questions about review culture or psychological safety.
2. **Generic responses** — Without a forcing function, the agent asked questions like "Tell me about the biggest challenge your team faces" that produced abstract, resume-like answers rather than concrete behavioral evidence.
3. **Time overrun** — The 10-question budget (ADR-027 §3) was routinely exhausted before actionable data was collected. Recruiters reported the interview felt long but the output felt thin.

ADR-036 identified that the synthesis layer needed laddering chains (`attribute_quote` → `consequence` → `value`) grounded in specific stories. The interviewing layer had no mechanism to reliably surface those stories. This ADR fixes the interviewing layer by replacing open-ended energy-following with a **deterministic probe progression** — six calibrated questions, each designed to elicit a specific category of evidence, delivered in a fixed order with at most one drilling follow-up per probe.

The six probes are drawn from behavioral-interview research (STAR format) and design-thinking contextual inquiry, adapted for recruiter intake rather than candidate assessment. Each probe targets a dual signal: a surface behavior and an underlying team norm.

---

## Decision

Replace the agent's question-type buffet with **six calibrated probes delivered in deterministic order**. The agent may ask at most one drilling follow-up per probe, then must advance to the next probe. Energy-following is scoped to the follow-up, not to the interview arc.

### 1. The Six Calibrated Probes

| Order | Probe | Target Domain | Dual Signal |
|---|---|---|---|
| 1 | "Describe a recent code review that sparked disagreement. How was it resolved?" | Team | Review culture + communication norms |
| 2 | "When a production incident happens, what does the team do first?" | Team | Psychological safety + ownership |
| 3 | "What does 'done' mean for a PR on your team?" | Technical | Quality standards + testing practices |
| 4 | "How do you prefer to give feedback to a peer?" | Dispositional | Directness + mentorship style |
| 5 | "What does 'senior' mean on this team?" | Dispositional | Autonomy level + ownership scope |
| 6 | "Walk me through the last feature shipped — from idea to production." | Technical | Stack + architecture + shipping cadence |

Probes 1, 2, and 4 populate **Team Context**. Probes 3 and 6 populate **Technical Context**. Probes 4 and 5 populate **Dispositional Context**. Probe 6 also captures opportunistic **Why/Process** data (why the feature was prioritized, who decided).

### 2. Probe Discipline Rules

- **One probe per turn.** The agent delivers exactly one calibrated probe as its `question.text`. No compound questions. No "and also" stacking.
- **At most one drilling follow-up.** If the answer is short or vague, the agent may ask ONE follow-up (hypothesis-offering or story-request format), then advances. It does not loop on the same probe.
- **No probe skipping.** The progression is deterministic. The agent does not skip probe 3 because probe 2 was "interesting."
- **No energy-chasing across probes.** If the recruiter gives a 500-word answer to probe 1, the acknowledgment absorbs that energy but the next question is still probe 2 (not probe 1-follow-up-#3).

### 3. Suggested-Answer Hints

Each probe includes 2–3 `suggestedAnswers` in the JSON response — concrete, specific completions a recruiter can tap to answer quickly. Examples for probe 1:

- "A junior proposed rewriting the auth module. We debated it in the PR for two days, then the TL made the call and we documented the decision."
- "We rarely disagree — the HM reviews everything and decides."
- "Last week someone merged without tests. We reverted, added a CI gate, and retro'd it."

These are not multiple-choice options. They are story prompts that demonstrate the specificity level the agent wants.

### 4. Prompt Architecture

The calibrated probes live in the `CORE_PROMPT` of `workers/api/src/lib/roleAgentPrompts.ts` under a dedicated `## Six Calibrated Probes` section. The existing IDEO principles, Five Whys contextual drilling, Laddering, and Beginner's Mind sections remain intact — they govern how the agent crafts the acknowledgment and the drilling follow-up, not which probe to ask.

The `buildPhaseDirective` deterministic controller (RD-P5) is updated so that `probesDelivered` gates phase progression: the agent stays in `DISCOVERY` phase until all 6 probes are delivered, regardless of domain-coverage heuristics.

### 5. Budget Alignment

With 6 probes + up to 6 drilling follow-ups + 2 warm-up/context turns + 2 close/qualify turns = ~16 turns maximum. The default `questionBudget` is reduced from 10 to **8** for the standard tier and **6** for the quick tier. Pro tier may select 10 or 15 for multi-stakeholder or deep-dive modes.

The 5-minute completion target (Brief §AC-1) assumes:
- 30 seconds reading + tapping suggested answer
- 30 seconds typing a short answer
- 2 seconds agent round-trip
- 6 questions × 60 seconds = 6 minutes worst case; 5 minutes with suggested-answer taps.

---

## Consequences

### Positive

- **Predictable coverage.** Every interview now guarantees data in Team, Technical, and Dispositional contexts. No more Kafka-deep, culture-sparse profiles.
- **Shorter interviews.** 6–8 questions vs. the previous 10–15 meandering turns. Recruiter completion rate improves.
- **Better synthesis input.** The probes are designed to elicit STAR-shaped stories. The RCD synthesis prompt (ADR-036 §1.2) receives richer raw material with less noise.
- **Comparable outputs.** Two interviews for the same role produce structurally comparable RCDs, making gap detection and multi-stakeholder conflict flagging more reliable.
- **Faster iteration.** Prompt tuning is scoped to six questions rather than an open-ended conversation strategy.

### Negative / Risks

- **Rigidity for niche roles.** A DevOps-heavy role might need probe 6 to focus on infrastructure rather than features. The agent currently cannot adapt probe content to role type. Mitigation: probe 6 is broad enough ("last feature shipped" can be interpreted as "last infrastructure change" by the acknowledgment framing), and future ADR may add role-type probe variants.
- **False precision on follow-ups.** The "at most one follow-up" rule may leave genuine ambiguity unresolved. Mitigation: the synthesis layer flags sparse coverage; the calibration review loop (ADR-041d) catches gaps.
- **Suggested-answer bias.** Recruiters may tap suggested answers that do not match their reality, producing plausible-but-fabricated signals. Mitigation: suggested answers are framed as "examples of specificity," not as options to select. The input type remains `textarea`.

---

## Alternatives Considered

- **Retain open-ended energy-following (status quo)** — Rejected: produces sparse, uneven coverage. The synthesis layer cannot manufacture data that the interview failed to capture.
- **Dynamic probe selection via LLM (ask the agent which probe to use)** — Rejected: adds latency, cost, and non-determinism. The probe order is a product decision, not an inference problem.
- **Static questionnaire (no agent, just a form)** — Rejected: loses the acknowledgment + drilling dynamics that surface stories. A form produces nouns ("we do code review"); an agent produces verbs ("we debate for two days then the TL decides").
- **More than 6 probes** — Rejected: violates the 5-minute completion target. The 6 probes were selected by coverage necessity (3 contexts × 2 probes minimum).

---

## Open Questions

1. **Role-type probe variants:** Should sales, design, or marketing roles get a different probe set? If so, who selects the variant — baseline form logic, LLM inference, or hardcoded per-department rules?
2. **Suggested-answer effectiveness:** Do recruiters tap suggested answers more often when they are story-shaped vs. keyword-shaped? A/B test telemetry needed.
3. **Probe ordering:** The current order opens with a potentially negative frame (disagreement). Would starting with probe 3 ("what does done mean") build more rapport before surfacing conflict?
4. **Translation layer:** The probes are English-first. German, Dutch, and French recruiter markets need translated probes with culturally adjusted examples. When does localization ship?
