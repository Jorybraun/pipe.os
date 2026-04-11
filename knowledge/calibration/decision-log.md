# Scorer Calibration — Decision Log

> Append-only record of every CAL-4 decision. Never rewrite history; if a later decision supersedes an earlier one, add a new entry that references the superseded decision. This file is the audit trail for what scorer model was live at any point in time and why.

---

## Entry template

Each decision has the following shape. Copy this block and fill it in when CAL-4 completes.

```markdown
### YYYY-MM-DD — {decision slug}

**Decided by:** {human name}
**Fixture set:** {git SHA of workers/api/fixtures/scorer-calibration/ at decision time}, n={count}
**Run directory:** `workers/api/fixtures/scorer-calibration-runs/{ISO-timestamp}/`
**Report:** `{run-dir}/report.md`

**Pick:** {model name and provider} — e.g. "Gemma 4 26B on Workers AI" or "Sonnet 4.5 on Anthropic"

**Per-dimension κ (against Sonnet oracle):**

| Dimension | Gemma κ | Devstral κ | Pass? |
|---|---|---|---|
| issue_identification | … | … | … |
| prioritization | … | … | … |
| revision_evaluation | … | … | … |
| reasoning_quality | … | … | … |
| question_formation | … | … | … |
| ai_direction | … | … | … |

**Composite ICC(2,1):** Gemma {…}, Devstral {…}

**Rationale:**
{2–5 sentences explaining the pick. Why this model, what the tradeoffs were, any dimensions that were borderline, any fixtures that were outliers.}

**Escalations:**
{If any dimension has κ < 0.70 against Sonnet, document the per-dimension escalation here. E.g. "reasoning_quality is escalated to Sonnet live — all other dimensions run on Gemma."}

**Code changes:**
- `workers/api/src/lib/scorerAgent.ts:SCORER_WORKERS_AI_MODEL` {unchanged | updated from X to Y}
- Other touched files: {list}

**Supersedes:** {none | YYYY-MM-DD entry}
**Superseded by:** {none, filled in later if a future decision overrides this one}
```

---

## Entries

> No decisions recorded yet. CAL-4 blocked on CAL-2 (harness) and CAL-3 (analyzer).

---

## Related decisions outside this file

Some decisions adjacent to scorer calibration live in other places and should be cross-referenced here when CAL-4 happens:

- **Scorer model routing** — `CLAUDE.md` AI model routing table. If CAL-4 changes the production scorer, update that table.
- **Model independence rule** — ADR-032 §"Consistency classifier". The constraint that scorer and implementer must be different model families is load-bearing; any CAL-4 pick must satisfy it.
- **Dispositional weights** — ADR-036 §3 defines the `dispositional_weights` overlay on the scorer's base weights. CAL-4 does not change this — the overlay is a runtime parameter, not a model pick.
- **STRATEGY.md decision log** — the founder's master decision log at the bottom of `knowledge/STRATEGY.md`. A CAL-4 entry should appear in both places: a short one-liner there with a link to the full entry here.

---

## When NOT to append to this file

- **Routine re-calibration where nothing changed.** If the quarterly maintenance run shows the previous pick is still within the CI, no new entry is needed. Note the run in the manifest but do not disturb the decision log — it is for decisions, not for data collection.
- **Failed runs.** A run that aborted halfway, a run whose Sonnet subagent produced malformed JSON, a run that was abandoned mid-debug — none of these belong in the decision log. They belong in the run directory's `manifest.json` where the `status` field reflects the failure.
- **Fixture set edits.** Adding, removing, or revising fixtures does not need a decision log entry unless it is accompanied by a new CAL-4 decision. Fixture history lives in git.

---

## Reading order when picking up this file cold

1. Scan the most recent entry. That is the current production scorer as far as this file knows.
2. Cross-check against `workers/api/src/lib/scorerAgent.ts:SCORER_WORKERS_AI_MODEL`. If they disagree, trust the code and update the log with a correcting entry — the code is what ships.
3. Read the rationale and the escalations. The rationale tells you why the pick is what it is; the escalations tell you which dimensions bypass the pick.
4. Check the `Supersedes` and `Superseded by` chain. If the most recent entry is marked "superseded by" a newer one, follow the chain to the head.
