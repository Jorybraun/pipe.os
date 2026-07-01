---
status: current
owner: Codex
date: 2026-06-30
scope: repo matching, CODE_REVIEW, open-source workspace assessment
---

# Repo Matching Value Audit — 2026-06-30

## Product Standard

PIPE repo matching is valuable only when it helps a hiring manager answer:

- Is this the right challenge for this candidate and role?
- Why was this repository or PR selected?
- What candidate evidence supports the match?
- What repository evidence supports the match?
- What is missing, uncertain, or too weak to assess?
- What happened after the candidate completed the challenge?
- Can I trust the score enough to decide the next action?

Candidate-facing repo matching must never fall back into a fake or infinite loading path. It must end in one of three states:

- `matched`: a real source-backed repo/PR/task is assigned.
- `blocked`: no safe challenge exists yet, with a clear reason and no auto-refresh loop.
- `needs_evidence`: the system needs more candidate or role context before a fair match.

## Feature Inventory

### Candidate CODE_REVIEW Flow

- Assessment invite resolves by token.
- Candidate profile/CV evidence is decomposed into source-backed matchable nodes.
- Repo matcher selects a real PR challenge from indexed repository evidence.
- Candidate receives a CODE_REVIEW challenge, not the video-room fallback.
- Candidate submits review annotations and decision.
- AI author pushback/reply loop produces review interaction evidence.
- Scoring persists to the review session, challenge submission, and recruiter projections.

### Candidate Open-Source Workspace Flow

- Interview is assigned a real repository and base commit.
- Room workspace launch creates a dev-container session.
- Container bridge exposes health, terminal, VS Code proxy, and assessment finalizer.
- Candidate makes a real git commit in the workspace.
- Finalizer captures commit SHA, diff, changed files, and test command output.
- Assessment progress moves to `READY_FOR_EVALUATION`.

### Recruiter/Hiring Manager Flow

- Interview detail shows assessment invite state and link delivery state.
- Review assignment shows repo/PR provenance and automatic-vs-manual trust.
- Scheduling remains scoped to the interview.
- Person profile rolls up related context without pretending every meeting is the same event.
- CODE_REVIEW results expose score, band, match status, evidence hyperedges, and validator verdict.
- Blocked matching renders as a clear decision state rather than an infinite spinner.

## Proof Captured

### CODE_REVIEW App-Dev Matrix

Command:

```bash
npm run smoke:code-review-assess-dev:matrix
```

Result: `3 / 3` profiles passed on 2026-07-01 after the standalone
`/assess` boundary was tightened. All three CV-only profiles now prove that
candidate evidence intake is separated from challenge assignment inside the
CODE_REVIEW runtime:

- `react-interaction-platform`: `PROFILE_RECEIVED`,
  `candidate-intake-queued`, recruiter browser smoke passed, interview
  `e33eb6dd-35e2-402b-9cb0-43fc93d9df64`.
- `accessibility-state-systems`: `PROFILE_RECEIVED`,
  `candidate-intake-queued`, recruiter browser smoke passed, interview
  `b4e244fd-46ba-4e88-bdd0-71cbdbc8d089`.
- `frontend-quality-infra`: `PROFILE_RECEIVED`,
  `candidate-intake-queued`, recruiter browser smoke passed, interview
  `f8955b42-2d2b-40c8-931b-ab1c517d8de3`.

This matrix is intentionally not a repo-fit quality score. It proves that
standalone `/assess` no longer exposes candidate-visible matching progress,
repo diagnostics, or an infinite waiting screen when no source-backed PR
assignment is ready.

### Open-Source Workspace App-Dev Smoke

Command:

```bash
npm run smoke:code-review-workspace-dev
```

Run parameters:

- `WORKSPACE_SMOKE_INTERVIEW_TYPE=OPEN_SOURCE_BUG_FIX`
- `WORKSPACE_SMOKE_REPO_URL=https://github.com/octocat/Hello-World`
- `WORKSPACE_SMOKE_BASE_COMMIT_SHA=7fd1a60b01f91b314f59955a4e4d4e80d8edf11d`

Manual-packet result:

- Interview `6ff86b75-a312-4646-a10c-3746c9e8c2ff`
- Challenge status `repo_task_assigned`
- Workspace status `READY`
- Bridge revision `2026-06-30-terminal-crlf-v3`
- Real terminal commit `e371c0dbead9bc7d2a027886b4f73e062c3adb94`
- Finalizer submitted `true`
- Progress stage `READY_FOR_EVALUATION`
- Next action `START_EVALUATION`
- Evaluation started `true`
- Evaluation stage `EVALUATED`
- Evaluation report `assessment_evaluation_report_23c4be552a7d3a58df52cc7216788937`

Matched-packet result after the packet precedence fix:

- Interview `2bc8ea3a-5dfe-4a0b-9b09-f10210f7d32b`
- Matched repo `973`, repo `https://github.com/mui/base-ui`, PR `973`
- Challenge source `scheduled_interview.challenge_packet`
- Workspace status `READY` during smoke, then `SLEEPING` after completion
- Bridge revision `2026-06-30-terminal-crlf-v3`
- Real terminal commit `0ff8c5e8e35190f1143ee94cf600985847f578d4`
- Finalizer moved progress to `READY_FOR_EVALUATION`
- Evaluation stage `EVALUATED`
- Evaluation report `assessment_evaluation_report_6ef1d3e5c629cdfeeb6af6d759dfe736`
- Evaluator correctly judged the smoke commit as insufficient for the real task, proving the evaluator does not rubber-stamp placeholder workspace work.

### Workspace Status Projection

The scheduling list/detail API now returns the latest linked workspace session without exposing raw session ids:

- status
- repository URL
- base commit
- expiry
- last update
- error message

App-dev browser proof: interview `2bc8ea3a-5dfe-4a0b-9b09-f10210f7d32b` renders `Sleeping · mui/base-ui · base 58dff8444f` on the recruiter detail page.

### Person Profile App-Dev Proof

Person profile `64d40e72-1c43-4279-a9d7-92612122c668` renders the decision cockpit first and keeps raw performance/context/source panels inside a collapsed `Evidence audit trail` by default. Browser proof confirmed:

- `Decision cockpit` visible
- `Evidence audit trail` visible and closed
- `Original sources` hidden before expansion
- `Performance signals`, `Learned context`, and `Original sources` visible after expansion

## What Works

- CODE_REVIEW repo matching can produce a real source-backed challenge and complete scoring end to end.
- Weak or unsupported profiles now block instead of pretending a match exists.
- The old infinite matching screen is no longer the only outcome; the system can say no.
- The workspace path can now prove real candidate work from the container, not pasted evidence.
- The dev-container smoke now proves the deployed bridge revision, so stale container rollouts are visible.
- Matched open-source challenge packets now remain authoritative even when the interview row also has a PR number, so the room launches from the immutable packet base commit instead of accidentally treating it as a plain PR assignment.
- Recruiter surfaces can now distinguish workspace readiness, sleep/expiry, repo, base commit, and failure state.
- Candidate rooms now keep a proof checklist beside the task brief so candidates can see whether the challenge packet, workspace telemetry, work evidence, assessment branch commit, tests/verification note, AI usage, and interview context have been captured before they submit.
- Workspace assessment detail pages now lead with the hiring-manager decision readout and candidate work packet while keeping raw evaluator claims, cautions, exact snippets, coverage chips, and source-ref counts in a collapsed evidence audit trail.
- Assessment setup gaps now give recruiters a concrete next action instead of only a diagnostic: send/collect candidate evidence, rerun or enrich matching, or attach a source-backed challenge packet.
- The assessment room now opens terminal and submission as focused assessment tools, keeping the candidate flow centered on the repo task and evidence capture.
- Remaining room controls and assessment panels now use the core PIPE assessment styling, and the agent bridge no longer accepts obsolete action aliases.
- Repo-task progress now computes a canonical readiness snapshot: required proof, confidence signals, missing-proof count, ready-for-evaluation, and usable-hiring-signal. Candidate room panels and recruiter list/detail readouts use that same snapshot instead of separate local heuristics.

## What Still Needs Improvement

- Repo-matching blocked states should recommend a next evidence-gathering action, not just explain failure.
- Match explanations need a stronger hiring-manager summary: selected repo, why this PR, why not the alternatives, and what risk remains.
- Person profile and interview detail need stricter visual hierarchy so related meetings feel like context, not duplicate current-interview facts.
- CODE_REVIEW score needs a concise “valid because…” panel with rubric coverage, source evidence, and scorer confidence.
- The indexed repo set is still narrow. A blocked match is honest, but product value improves only if there are enough high-quality PR challenges for common frontend/backend/infra profiles.
- WebBridge real-browser control was unavailable during this audit because the daemon reported `extension_connected:false`; validation used deployed Playwright/browser smokes instead.
- The workspace smoke now defaults to a positive task-aligned `mui/base-ui#973` bug-fix path instead of placeholder work, while keeping placeholder mode as an explicit local-only plumbing escape hatch.

## Next Build Slice

1. Make the recruiter decision panel the default top-level artifact: verdict, score, challenge fit, risk, next action.
2. Collapse raw hypergraph/evidence panels behind an audit trail.
3. Add a blocked-match next-action generator: schedule background call, request CV detail, add role requirements, or ingest more repo challenges.
4. Expand the repo challenge corpus with labelled PRs and planted-review rubrics for common role families.
5. Add an app-dev smoke that clicks from interview detail to candidate link/result and verifies the hiring-manager “decision cockpit” copy directly.
6. Run the positive task-aligned workspace smoke in app-dev with real dev credentials on every deploy so scoring proves both rejection and acceptance paths.
7. Grow the repo packet corpus beyond the current frontend-heavy `mui/base-ui` proof so fewer realistic candidates land in honest-but-low-value blocked states.
