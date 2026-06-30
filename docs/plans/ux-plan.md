# PIPE UX Plan

## Core UX Principles
- **Evidence-first output:** The match report (with per-requirement evidence attribution to specific candidate sub-elements, role requirements, and repo features) is the primary user-facing artifact. Scores are secondary summaries.
- **Transparency and override:** Recruiters must see exactly why a candidate matches (or doesn't) at the sub-element level, with ability to override or weight signals.
- **Living graph visibility:** Candidate profiles should surface the accumulated graph (experiences, projects, skills, screenings, assessments) with provenance and temporal layers.
- **Structured discovery:** Role Context Document (RCD) capture via multi-stakeholder interview is the foundation for role intent. UX must support laddering, dealbreaker capture, BARS calibration, and dispositional weights.
- **Compliance UX:** Clear indicators for HITL review flags, dealbreaker evidence, without auto-failing candidates.

## Key UX Flows
1. **Recruiter Onboarding & Role Discovery:** Structured interview agent (UAR or legacy) to build rich RCD. Wizard for match philosophy (validate/tailored/hybrid).
2. **Candidate Intake & Enrichment:** Form for seed data (resume/LinkedIn/GitHub), automated public data enrichment, loose match preview.
3. **Screening:** Automated conversational screener (profile_builder or role_fit modes) that fills graph gaps with calibrated probes. Coverage tracking and termination logic.
4. **Technical Validation:** Code review challenge (multi-turn agent) and implementation challenge (issue-based). Scoring with BARS rubric and evidence. See [`code-review-product-readiness.md`](./code-review-product-readiness.md) for the CODE_REVIEW hypergraph, AI-pushback, recruiter-evidence, and feedback-loop contract. See [`candidate-assessment-cockpit-backlog.md`](./candidate-assessment-cockpit-backlog.md) for the code-first candidate cockpit plan that demotes Win95 to an optional skin.
5. **Matching & Review:** Per-element match reports with drill-down to evidence. Triangulation summary. Recruiter dashboard for override and decision.
6. **Ongoing Relationship:** Candidate profile evolution view, opt-in updates.

## UX Priorities (tied to phases)
- **Phase 0:** RCD consumer cutover in cockpit and discover flows. Ensure structural RCD depth is visible/used in matching UI.
- **Phase 1-3:** Decomposition enables richer match reports and candidate profile views. Sub-element level drill-down.
- **Phase 4:** Screener UX consolidation (shared FSM for modes).
- **Phase 5:** Graph DB enables advanced traversal UX (trajectory analysis, cross-assessment evidence).
- **Phase 6:** Calibration studies feed into UX for score explanation and feedback collection.

## Design System & Accessibility
- Maintain consistency with existing production UI (cockpit, admin queues, challenge interfaces).
- Full compliance with accessibility and legal requirements for automated decision systems.
- Voice + Mermaid architecture review panel for ongoing UX validation (as per user preference for visual review).

## Validation
Every UX change or new flow must include chrome-devtools-mcp validation proving "done" state (e.g., actual UI rendering, interaction flows, evidence display) before Kanban completion.

**Last Updated:** 2026-05-28 (Derived from north-star architecture and entity lifecycles in pipe-strategy-v2 after audit of knowledge/plan/)
**Status:** Living. Update with user research, feedback loops, and new requirements. Planning priority over implementation.
