# ADR-033: Research Brief Integration Strategy & Plan Guardrails

**Date:** 2026-04-08
**Status:** Accepted
**Deciders:** Hans (founder)

---

## Context

Between 2026-04-07 and 2026-04-08, two deep research workflows were completed, producing ~100 KB of cited research briefs + ~200 KB of research files, covering the behavioral/culture interview agent and the code review assessment. The workflows used parallel researcher subagents (on Sonnet 4.6 for the 2026-04-08 run, per explicit user override) and produced verified deliverables with formal citation and evidence-integrity passes.

The research produced **78 concrete findings** (33 for code review, 45 for behavioral/culture) plus **12 open questions** that research could not resolve. Several of those findings have already been codified in ADRs 029, 030, 031 (all written the same day as the behavioral/culture brief). The code review findings are codified in ADR-032 (this commit). But without a dedicated guardrail, the risk is that findings get silently dropped as development proceeds and tradeoffs feel inconvenient.

### The specific risk

On 2026-04-08 the founder observed that the research outputs, the `/calibrate` skill in PIPE-OS, and the standalone arena at `research/code-review-arena/` had all drifted out of sync during active development. Each was being tuned or iterated without explicit reference to the others. The cleanup required to re-synchronize was significant. The founder asked for a guardrail that prevents this drift from recurring.

### What the guardrail must do

1. Every research finding must have a visible home in the plan (no silent drops).
2. If a development decision overrides a research finding, the override must be explicit and documented.
3. Future agents (Claude Code sessions) must be able to load the guardrail automatically so it applies without the founder remembering to re-state it each session.
4. The canonical plan document must be a single file, authoritative, versioned.

---

## Decision

Establish `knowledge/STRATEGY.md` as the **canonical plan document** and enforce three guardrail rules:

### Rule 1: The research plan is `knowledge/STRATEGY.md`

- Every research finding from both briefs is enumerated in `STRATEGY.md` as a numbered row (CR-1 through CR-33, BC-1 through BC-45, OQ-1 through OQ-12).
- Each row maps to a concrete action (code change, ADR, documentation artifact, or explicit deferral).
- If a finding is in the research but not in `STRATEGY.md`, the strategy document is broken — fix the strategy, don't silently drop the finding.
- New research runs append new rows; they do not reset or renumber existing rows.

### Rule 2: Contradicting the plan requires an explicit override

When a founder request or development shortcut contradicts a row in `STRATEGY.md`, the Claude Code session **must**:

1. **Surface the contradiction.** Name the finding (by row ID) and where it lives in the research brief.
2. **Name the risk.** Quote or summarize what the research says the consequence is.
3. **Ask for explicit override.** Wait for the founder's explicit decision before proceeding. A handwave is not an override.
4. **Record the override in the Decision Log** at the bottom of `STRATEGY.md` with a date, the finding being overridden, the rationale, and the initials of who approved it.
5. **Never silently drop a finding.** Deferral is explicit. Removal is explicit. Ignoring is not allowed.

This rule exists because the founder explicitly requested it on 2026-04-08 after noticing that research-driven decisions were being eroded by short-term pressures. The founder said: *"do not let me steer you into neglecting the plan. if i contradict the plan remind me."*

### Rule 3: The guardrail is loaded automatically

The guardrail is anchored in three places so it loads by default in any Claude Code session:

1. **`CLAUDE.md`** (project-level, checked in) — explicit section pointing to `knowledge/STRATEGY.md` as the plan and stating Rule 2.
2. **`knowledge/STRATEGY.md` header** — the guardrail is restated at the top of the plan document.
3. **Auto-memory** — a project-type memory entry at `~/.claude/projects/.../memory/project_code_review_mission.md` persists across sessions and surfaces the guardrail when the assistant is working on any code review / culture agent / assessment topic.

Future sessions do not need the founder to re-explain the guardrail — it is already loaded.

---

## How the research integrates with existing ADRs

The guardrail applies to all research findings, but the implementation touches specific ADRs:

| ADR | Status vs. research | Action |
|---|---|---|
| [ADR-021](ADR-021-deterministic-code-review-scoring.md) | Superseded since 2026-03-29 | No change — already superseded |
| [ADR-024](ADR-024-multi-turn-agentic-code-review.md) | **Directionally correct, 4 specific updates** | See [ADR-032](ADR-032-code-review-research-integration.md) §"What this updates" |
| [ADR-026](ADR-026-implementer-agent-improvements.md) | **Directionally correct, persona YAML update** | See [ADR-032](ADR-032-code-review-research-integration.md) §"What this updates" |
| [ADR-027](ADR-027-role-discovery-agent.md) | Out of research scope | No change |
| [ADR-028](ADR-028-multi-stakeholder-role-discovery.md) | Out of research scope | No change |
| [ADR-029](ADR-029-culture-interview-agent-architecture.md) | **Well-aligned** (written same day as behavioral research brief) | Minor gap notes — see this ADR §"Behavioral/culture minor gaps" below |
| [ADR-030](ADR-030-culture-profile-operationalization.md) | **Fully aligned** with research §3 | No change |
| [ADR-031](ADR-031-ai-hiring-compliance-architecture.md) | **Fully aligned** with research §5 | No change (but hard deadline 2026-08-02 for EU AI Act conformity — surfaced in STRATEGY.md P4) |
| [ADR-032](ADR-032-code-review-research-integration.md) | **This commit — brings code review into alignment** | See ADR-032 |

### Behavioral/culture minor gaps

ADR-029 is already derived from the behavioral/culture research brief and captures most findings. The minor gaps that are tracked in `STRATEGY.md` (rows BC-6, BC-7, BC-15, BC-16, BC-17, BC-18, BC-19) but not currently specified in ADR-029:

| Gap | ADR-029 current | Research target | Priority |
|---|---|---|---|
| Belief-state tracking with Previous Belief Aware (PBA) judge | Stateless scoring at session end | Belief-state updated per turn with PBA for 100% stability on irrelevant inputs | MEDIUM (P2 in strategy) |
| Probe generator with 5 trigger types (Missing STAR / Vague / Attribution / Evidence / Depth) | Generic probing | Explicit trigger taxonomy | MEDIUM |
| Belief-state delta as evasion detector | Not implemented | Information-theoretic evasion detection (no separate classifier) | MEDIUM |
| Reality Monitoring signals for fabrication detection | Not implemented | Episodic-specificity scoring bonus | LOW (P3, research-grade uplift) |
| Cognitive-load via unexpected follow-ups | Not implemented | Probe strategy for fabrication detection | LOW (P3) |
| Rolling compaction + pinned exchanges for long interviews | Not specified | Memory management for 30–45 min interviews | MEDIUM (may not be needed for 5–20 question flows) |
| QWK target | ≥ 0.55 | ≥ 0.60 | LOW (tightening target) |

These are not blockers — ADR-029's core architecture is sound. They are tracked in `STRATEGY.md` Phase 2 and will be addressed via the same /calibrate-style loop once the culture agent has a calibration harness.

---

## Decision Log protocol

`knowledge/STRATEGY.md` has a Decision Log table at the bottom. Every override, deferral, or plan change appends a row with:

- Date (absolute, not relative)
- Decision (what was decided)
- Rationale (why — especially when overriding research)
- Who (initials of decider)

The log is append-only. Never delete rows. If a prior decision is reversed, add a new row that reverses it and explains why.

---

## Alternatives Considered

### A — Leave the plan as research files and trust the assistant to read them

**Rejected.** Research files are 50–100 KB each and cannot be loaded into a single Claude context effectively. Without an enumerated, mapped plan document, findings get forgotten between sessions. The founder already observed this drift on 2026-04-08.

### B — Put the plan in CLAUDE.md itself

**Rejected.** CLAUDE.md is project instructions, not a specification. Mixing them makes CLAUDE.md too long and loses the separation between "how to work on this codebase" (CLAUDE.md) and "what we're building and why" (STRATEGY.md).

### C — Only enforce the guardrail on code review (not culture)

**Rejected.** The drift risk applies to any research-derived decision. The behavioral/culture side is currently better-aligned but could drift just as easily if the culture agent is iterated without reference to the brief. The guardrail applies equally to both domains.

### D — Make the guardrail informal ("try to remember the research")

**Rejected.** The founder explicitly said informal guardrails don't work and requested an enforceable rule. The whole point is that when short-term pressure meets research-derived discipline, short-term pressure wins unless discipline is encoded in the process.

---

## Consequences

### Positive

- Research findings are not lost between sessions or when pressure builds for shortcuts.
- Every development decision has a traceable grounding in either a research finding or an explicit override.
- Future Claude Code sessions load the guardrail automatically without the founder remembering to re-explain.
- Contradictions surface early (at the ask-for-approval step) rather than late (at the "we shipped something the research said was broken" step).
- The Decision Log creates institutional memory for *why* specific tradeoffs were made.

### Negative / Trade-offs

- Slight friction on every request that touches research-backed decisions. This is intentional.
- Founder has to actually engage with the override conversation when steering away from the plan. Also intentional.
- `STRATEGY.md` must be kept current as new research lands. This is workflow discipline.

### Risks

- **The founder overrides the guardrail habitually.** Mitigation: the override log itself is an alarm — if the log grows too fast, it signals the plan is wrong and needs re-scoping, not that the guardrail should be removed.
- **The assistant misidentifies a contradiction and stalls unnecessarily.** Mitigation: the guardrail is conservative — it only triggers when a development decision explicitly contradicts a numbered finding. General code review or refactoring is not affected.
- **The plan document goes stale.** Mitigation: every new research run updates `STRATEGY.md` as part of the workflow (added to the `deep-research` skill). Verification: the monthly plan review checks that all research findings are mapped.

---

## Verification

1. `knowledge/STRATEGY.md` exists and contains:
   - Every finding from `code-review-content-sourcing.md` enumerated as CR-rows
   - Every finding from `behavioral-culture-interview-agent.md` enumerated as BC-rows
   - Every open question enumerated as OQ-rows
   - A phased roadmap
   - A Decision Log table at the bottom

2. `CLAUDE.md` has a Research & Strategy section pointing to `STRATEGY.md` and stating the guardrail.

3. Auto-memory file `project_code_review_mission.md` exists in the project memory directory.

4. The guardrail triggers on the next plan-contradicting request in this or any future session.

---

## Follow-ups

1. Add the "research integration pass" as an automatic step in the `deep-research` skill workflow (after the reviewer pass, before delivery). This ensures future research runs populate STRATEGY.md automatically.
2. Document the STRATEGY.md update protocol in a new skill or command (`/strategy-update`) so findings are ported consistently.
3. Monthly plan review: founder + assistant walk through STRATEGY.md, check for new overrides, check for stale items, update Decision Log.
