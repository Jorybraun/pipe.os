# ADR-041f: Single-Stakeholder Default

**Date:** 2026-04-22
**Status:** Accepted
**Deciders:** Hans (founder)
**Extends:** [ADR-028](ADR-028-multi-stakeholder-role-discovery.md), [ADR-041](ADR-041-role-discovery-calibrated-probes.md)
**Author:** Claude Opus 4.7 with founder

---

## Context

ADR-028 designed a multi-stakeholder Role Discovery architecture: the Hiring Manager, Team Members, Internal Recruiters, and External Recruiters each participate in a separate calibrated interview, and their perspectives are merged into a shared domain matrix with conflict records. The architecture is sound, but the default UX exposes it unconditionally.

In practice, 80%+ of pipeline creations on the platform are by solo recruiters who have no team member to invite and no external recruiter relationship. Presenting these users with an "Invite Participants" flow adds friction, delays pipeline creation, and creates the impression that the product requires a committee to set up a role. The 5-minute completion target (Brief §AC-1) is impossible if the user must wait for asynchronous team-member responses.

The multi-stakeholder architecture remains correct for enterprise accounts and for roles where cultural alignment is critical. But it should not be the default. This ADR changes the default flow to **single-stakeholder (Hiring Manager)** with multi-stakeholder as an explicit, post-synthesis opt-in.

---

## Decision

### 1. Default Flow: Single Stakeholder

When a user creates a role context, the system creates **one participant row** with `participant_role = 'HIRING_MANAGER'` and `is_creator = true`. There is no "Invite others" step in the baseline form. There is no email flow. The interview begins immediately after baseline submission.

The calibrated probes (ADR-041) are delivered to the creator as the sole interviewee. The RCD synthesis produces a domain matrix with one stakeholder row (`HIRING_MANAGER`). All six domains are populated by the HM's answers. `primary_authority` is `true` for all HM domains per ADR-036 §1.3.

### 2. Multi-Stakeholder Opt-In

After the RCD is synthesized and displayed on the review page (ADR-041d), a secondary action appears: **"Add perspectives from team members"**. Clicking this opens the invite flow from ADR-028:

1. Recruiter enters names and emails.
2. `POST /api/v1/role-contexts/:id/invite` creates participant rows + sends Resend emails.
3. Each invitee receives a tokenized link to `/role-interview/:token`.
4. Their interviews are shorter (3–5 questions) because the facts are already established.
5. Their transcripts merge into the shared RCD via incremental re-synthesis (ADR-041e).

The review page re-opens after each new participant completes their interview, showing updated cells and any new `ConflictRecord` entries.

### 3. Role Calibration Simplification

The hardcoded calibration question ("What's your relationship to this role?") is **skipped** in single-stakeholder mode. The system already knows the participant is the Hiring Manager (or the creator acting as proxy). The first question is probe 1 directly, preceded by a brief warm-up acknowledgment.

If the creator explicitly selects a different participant role in the baseline form (future feature), the calibration question is shown. For now, the baseline form does not expose participant-role selection.

### 4. Question Budget per Mode

| Mode | Default Budget | Rationale |
|---|---|---|
| Single stakeholder (quick) | 6 questions | 2 context turns + 6 probes, no follow-ups |
| Single stakeholder (standard) | 8 questions | 2 context + 6 probes + 2 follow-ups |
| Multi-stakeholder (creator) | 8 questions | Same as standard |
| Multi-stakeholder (invitee) | 4 questions | Facts established; perspective-only |

The budget selector UI is simplified: "Quick (5 min)" vs. "Thorough (8 min)" rather than the old 5/10/15/20 numeric slider. Pro tier unlocks "Thorough."

### 5. UI State Machine Update

The `useRoleDiscovery` hook transitions are simplified for the default path:

```
IDLE → BASELINE → INTERVIEWING → SYNTHESIZING → REVIEW → APPROVED → PIPELINE_CREATED
```

The `REVIEW` state is new. It replaces the old `COMPLETE` state as the terminal pre-pipeline state. `COMPLETE` still exists as an internal synthesis status, but the user-facing milestone is `REVIEW` (or `APPROVED` after they click the approval button).

Multi-stakeholder flows add two substates under `REVIEW`:
- `REVIEW_PENDING_INVITES` — RCD approved but waiting for team members
- `REVIEW_CONFLICTS` — new participant data surfaced conflicts; recruiter must resolve

### 6. Backwards Compatibility

Existing role contexts created before this ADR may have `status = 'COMPLETE'` and no `APPROVED` flag. They are grandfathered: pipeline creation is allowed from `COMPLETE` status for 30 days after deployment. New role contexts must reach `APPROVED`.

The `role_context_participants` table already supports single-participant rows — no schema change is required.

---

## Consequences

### Positive

- **Faster time-to-pipeline.** Solo recruiters can create a tailored pipeline in 5 minutes without coordinating others.
- **Lower cognitive load.** The baseline form has fewer fields (no team-member emails, no role-selection dropdown). The interview is a straight line.
- **Higher completion rate.** Removing the invite step eliminates a major drop-off point in the funnel.
- **Preserved depth for complex roles.** Teams that need multi-perspective data can still opt in. The architecture is not removed; it is deferred.

### Negative / Risks

- **Shallower RCDs by default.** A single Hiring Manager's perspective may miss team-culture ground truth. Mitigation: the review page (ADR-041d) surfaces coverage gaps explicitly ("Team domain: only one stakeholder — consider inviting a team member").
- **Recruiter acting as HM proxy.** Many recruiters are not the hiring manager. In single-stakeholder mode, they answer as if they were. Mitigation: the baseline form captures their actual relationship; if they are an internal recruiter, the system prompt adapts (ADR-028 §4) and probes are adjusted to focus on process, timeline, and HM-relayed priorities rather than deep technical architecture.
- **Multi-stakeholder discoverability.** The "Add perspectives" button may be ignored. Mitigation: it is prominently placed on the review page, and coverage gaps trigger a contextual nudge.

---

## Alternatives Considered

- **Keep multi-stakeholder as default (status quo)** — Rejected: contradicts the 5-minute completion target and creates unnecessary friction for the majority use case.
- **Remove multi-stakeholder entirely** — Rejected: the architecture is correct for enterprise and high-stakes roles. The data contract (ADR-036) and conflict-resolution logic assume multi-source input.
- **Auto-detect when to offer multi-stakeholder** — Rejected: would require heuristics (company size, role seniority) that are unreliable at baseline time. Explicit opt-in is clearer.

---

## Open Questions

1. **Proxy participant detection:** Should the system ask "Are you the hiring manager for this role?" in the baseline form, and if the answer is "No," auto-enable multi-stakeholder mode with a prompt to invite the HM? This would improve data quality but add a decision point.
2. **Team-member interview timing:** If a recruiter adds perspectives after approving the RCD and creating the pipeline, should the pipeline be re-synthesized automatically, or should the recruiter manually trigger an update? Automatic re-synthesis could change active challenge configs mid-candidate.
3. **Minimum viable multi-stakeholder:** Is one team member sufficient, or should the system require at least two non-creator perspectives before surfacing conflict records? A single additional perspective cannot produce a conflict — it merely adds a second row.
4. **Enterprise default flip:** Should enterprise-tier accounts default to multi-stakeholder mode because they have larger teams? If so, what is the tier gating logic?
