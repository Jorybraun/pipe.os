# Culture Interview Question Bank

Each question file is one question. The filename is `q-XXX-short-slug.md` where XXX is a zero-padded sequence within the dimension folder.

---

## Question file template

Every question MUST follow this structure. Questions without BARS rubrics and calibration examples are not usable by the agent and will fail the sync step.

```markdown
---
id: ownership-001
dimensions: [ownership, learning-orientation]
seniority: [mid, senior, lead]
allow_followups: true
expected_star_slots: [S, T, A, R]
estimated_response_time_seconds: 180
---

## Question

Tell me about a time you saw a problem at work that wasn't yours to fix, and you fixed it anyway. What was the problem, what did you do, and what happened?

## Why we ask this

Ownership is the hardest dimension to fake. Candidates who perform ownership typically describe assigned work in ownership language; candidates with real ownership describe specific unowned problems they chose to engage with. This question forces specificity about the "chose to engage" part.

Source: research brief §2.3 (probe-for-specificity strategy).

## BARS rubric (5-point)

- **5** — Candidate names a specific unowned problem outside their formal scope, describes staying with it past the handoff point, and takes accountability for the outcome including any downsides. Concrete quotes about what *they* decided. Measurable result.
- **4** — Names a specific problem, describes their actions clearly, names a result. Ownership is clear but within or adjacent to their formal scope.
- **3** — Names a problem and describes actions. Some ambiguity about what was theirs vs. the team's. Result is described but not measured.
- **2** — Describes a problem in general terms. "We" language dominates. Unclear what they specifically did.
- **1** — Cannot produce an example. Or: describes an assigned task as "unowned work." Or: describes a problem that "someone should have fixed" but they did not.

## Calibration examples

### Low (1-2)

> "There was this bug nobody was looking at, and eventually someone from QA filed a ticket and it got assigned to our team and we fixed it in the next sprint."

Passive voice, no agency, "unowned" problem that was actually just un-triaged.

### Medium (3)

> "We had a deployment issue that kept coming up. I noticed it was happening every Monday, so I mentioned it in standup and we ended up assigning it to our SRE team who fixed it."

Pattern recognition, surfacing — but handoff happened at the earliest opportunity, not ownership.

### High (4-5)

> "Our on-call docs were out of date and the oncall engineer kept paging the wrong people during incidents. It wasn't my job — I'm not even on the oncall rotation — but I spent two Fridays rewriting the runbook with the current service owners. When the next incident hit, the oncall engineer reached the right people in ten minutes instead of forty. I also set a calendar reminder to re-check it every quarter because I know I'll forget."

Specific unowned problem, stayed with it (multiple Fridays), measurable outcome, awareness of the follow-through risk.

## Probe library

- *missing Action*: "What did you specifically do in that situation? I want to hear about your actions, not the team's."
- *vague outcome*: "How did you know it worked? What changed after?"
- *unclear scope*: "Was this your responsibility? How did you decide to get involved?"
- *passive voice*: "Walk me through who decided what. Who did what?"

## Notes

Do NOT probe more than twice on a single question. If the second probe does not produce specificity, move on — continued probing crosses into interrogation per research §2.6.
```

---

## Seniority tags

- `entry` — individual contributor, 0-2 years
- `mid` — individual contributor, 2-5 years
- `senior` — senior IC, 5+ years, mentorship
- `lead` — tech lead, team lead
- `staff` — staff/principal IC, cross-team scope
- `manager` — people manager
- `architect` — principal-level IC with architecture focus

A question can be tagged with multiple seniority levels when it generalizes well.

---

## What goes in each dimension folder

See `README.md` in each dimension folder for specific guidance on what separates a good ownership question from a good collaboration question etc.

The minimum viable bank is 3 questions per dimension × 5 dimensions = 15 questions, all with full rubrics and calibration. That is task #5.
