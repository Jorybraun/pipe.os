# Candidate Assessment Cockpit Backlog

**Status:** Active product direction
**Date:** 2026-06-29  
**Related:** [`ux-plan.md`](./ux-plan.md), [`code-review-product-readiness.md`](./code-review-product-readiness.md), [`open-source-repo-task-assessment-contract.md`](./open-source-repo-task-assessment-contract.md), [`open-source-repo-task-interview-session.md`](./open-source-repo-task-interview-session.md)

## Purpose

Keep the candidate assessment flow centered on real open-source work.

PIPE-OS should read as a real open-source coding assessment product. The
candidate experience is an assessment cockpit: VS Code/dev workspace as the
primary surface, task packet visible, video/chat/AI available, and Submit Work
obvious. The architectural spine is the assessment event stream, not layout
replay.

## Target Outcomes

- Candidates land in a code-first cockpit for workspace-backed assessments.
- The first viewport makes the real task legible: repo, base commit, branch,
  task text, success criteria, expected evidence, and submit requirements.
- VS Code/code-server is the primary work area, not a panel inside a decorative
  metaphor.
- Video, chat, recording, presence, and the AI agent bridge are available as support
  surfaces without competing with the workspace.
- Submit Work is always visible or one click away, validates source-backed
  commit/test evidence, and makes the final state unambiguous.
- Recruiter results continue to rely on the canonical assessment event spine,
  not on replaying layout state.

## Core Sync Boundary

Keep only evidence-critical sync in the default assessment flow:

- room phase and participant presence,
- video and recording lifecycle,
- chat and transcript evidence,
- assigned challenge packet and assessment session state,
- workspace lifecycle, status, and diagnostics,
- AI agent bridge status, diagnostics, prompt handoff, and real agent replies,
- terminal command/output evidence,
- code-server file create/update/delete observations,
- git branch, commit, diff, PR URL, and submission evidence,
- test command/output evidence,
- final Submit Work bundle and evaluation diagnostics.

Defer or remove from the critical path:

- synced layout position, size, focus, minimize, and maximize state,
- shared scratchpad state,
- shared browser navigation/state unless a future assessment explicitly tests browser behavior,
- full-layout collaboration semantics,
- raw pointer trails and cursor replay beyond lightweight live presence,
- any candidate-required action that only exists inside a non-assessment UI.

## Non-Goals

- Do not rewrite the assessment event spine.
- Do not expose internal assessment ids, D1 row ids, R2 keys, planted bugs, or
  server-only rubrics to candidate clients.
- Do not make layout replay a prerequisite for scoring.
- Do not replace CODE_REVIEW's standalone diff assessment flow.
- Do not add fake AI assistants, fake Devin, simulated agent replies, or optimistic
  score claims.

## Migration Sequence

### Slice 0: Default-route proof

Write a failing Playwright scenario before runtime changes: an
`OPEN_SOURCE_BUG_FIX` or dev-container invite opens a code-first cockpit and
does not require entering an alternate presentation layer to see the task, workspace, AI,
chat, or Submit Work.

Acceptance:

- The URL and product copy describe an assessment, not an alternate presentation layer.
- No internal ids appear in the candidate DOM.
- The test fails against any default route that hides the assessment behind non-assessment UI first.

### Slice 1: Cockpit shell

Create the default assessment cockpit layout:

- primary workspace region,
- persistent task packet panel,
- compact video/chat/AI rail,
- assessment status strip,
- Submit Work affordance.

Acceptance:

- Workspace is visually dominant on large screens and usable on mobile/tablet.
- Task packet remains available while coding.
- Chat/video/AI can be opened without covering Submit Work.

### Slice 2: Task packet and status contract

Move candidate-safe task data into a cockpit-owned packet model backed by the
existing source-backed challenge packet.

Acceptance:

- Shows repo URL, base commit, working branch, task, success criteria, expected
  evidence, and constraints.
- Hides server-only ground truth and internal ids.
- Shows diagnostics when packet evidence is incomplete instead of falling back
  to a generic challenge.

### Slice 3: Workspace-first evidence

Make workspace lifecycle, file observations, terminal output, git state, tests,
and AI agent bridge status the visible assessment progress model.

Acceptance:

- Status strip reflects real workspace state and evidence counts.
- Terminal/file/test evidence is source-backed before it affects assessment
  progress.
- AI agent unavailable states appear as diagnostics, not simulated help.

### Slice 4: Submit Work path

Promote Submit Work to a cockpit-level completion flow.

Acceptance:

- Candidate can submit commit SHA, branch, diff summary, PR URL when allowed,
  test command/output, and missing-test notes.
- If live workspace finalization finds dirty or untracked files, the cockpit
  shows exact recovery commands instead of leaving the candidate stuck.
- Server validates exact source-backed evidence before final submission.
- Final state is visible to candidate and recruiter.

### Slice 5: Sync reduction

Keep the room event model focused on core assessment sync.

Acceptance:

- Core flow persists only evidence-critical events listed in this backlog.
- Layout/scratchpad/browser sync is disabled, ignored, or marked
  non-critical for default assessments.
- Existing replay/evaluation paths do not depend on layout state.

### Slice 6: Product cleanup and docs

Remove default-flow language that treats non-assessment presentation as the runtime.

Acceptance:

- Candidate docs/screenshots show the cockpit as the default.
- Smoke tests and plan docs use "assessment cockpit" for default
  workspace-backed assessments.

## Backlog Items

| ID | Item | Outcome | First test |
| --- | --- | --- | --- |
| CAC-01 | Default candidate route audit | Inventory routes that still enter non-assessment UI first | Playwright route smoke fails when the cockpit is not default |
| CAC-02 | Cockpit information architecture | Workspace, packet, status, video/chat/AI, Submit Work hierarchy | Component or Playwright layout assertion |
| CAC-03 | Candidate-safe packet panel | Source-backed task packet visible without ids/ground truth | Packet render test with missing-evidence diagnostic |
| CAC-04 | Workspace evidence status strip | File/terminal/test/git/AI state shown from accepted evidence | Durable Object/API evidence replay test |
| CAC-05 | Cockpit Submit Work | Final bundle available in the cockpit | End-to-end submit test from cockpit |
| CAC-06 | Runtime boundary hardening | Room UI state removed from critical scoring path | Replay test proves scoring ignores room UI state |
| CAC-07 | Recruiter result continuity | Results read assessment events, not layout replay | Recruiter result test with no layout replay events |

## Design Notes

- Treat the cockpit as an operational tool, not a landing page.
- Keep controls dense and predictable: tabs for packet/status/chat, icon
  buttons for call controls, and a clear submit button.
- Avoid decorative nostalgia in the default flow. The candidate should know
  they are doing real work in a real repo.
- Preserve the brutalist glassmorphic dark system language, but let code,
  evidence, and task clarity carry the experience.
