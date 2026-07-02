# Assessment Evidence Ingestion Audit

**Status:** Active proof command  
**Last updated:** 2026-07-02  
**Command:** `cd workers/api && npm run assessment-evidence:audit -- --local`

## Contract

Assessment evidence has two layers:

- Raw assessment-session evidence lives in `assessment_sessions`,
  `assessment_evidence_events`, source-ref tables, evaluator reports, claims,
  diagnostics, and human-review records.
- Person-level understanding is a projection into `context_records` with
  `workspace_person_id`, source refs, and optional concepts/entities. This layer
  can be rebuilt; it must not replace the raw interaction record.

Positive evaluator claims are valid person evidence only when
`assessment_claim_source_refs` preserves exact immutable source refs. Replaying
ingestion must not create duplicate person-projected context edges.

## Evidence Families

The verifier audits these required families:

| Family | Raw capture | Person projection |
| --- | --- | --- |
| Candidate profile / resume evidence | profile/resume event or source ref | person-scoped context record with source ref |
| Meeting transcripts | `transcript_span` / transcript source refs | person-scoped transcript-derived context |
| Video-room events | room lifecycle, recording, media, workspace events | person-scoped room-event context |
| Chat | accepted message evidence | person-scoped message context |
| Clippy / Devin interactions | AI prompt, blocked prompt, agent response refs | person-scoped AI-use context |
| Terminal commands / output | terminal command/output refs | person-scoped tool-activity context |
| Code-server / file activity | file observation or diff refs | person-scoped workspace-file context |
| Commit submissions | `git_commit` refs | person-scoped submission context |
| Diffs | `code_diff` refs | person-scoped diff context |
| Test output | `test_run` refs | person-scoped verification context |
| Upstream PR refs | upstream PR refs | person-scoped upstream contribution context |
| Evaluator reports | `assessment_evaluation_report` refs | source-backed evaluation context |
| Human reviewer decisions | human decision events/refs | reviewer decision context |
| Code-review annotations | review annotation/diff refs | annotation context |

## Status Meanings

- `missing`: no raw or projected evidence exists for that family.
- `captured`: raw evidence exists but no person-scoped projection with source
  refs was found.
- `projected`: at least one person-scoped context record preserves a source ref.
- `duplicated`: duplicate person-projected edges were detected for the same
  person, record type, narrative, source ref, and evidence role.

By default, missing families are reported as coverage gaps rather than audit
failures. The audit fails when a requested session is missing, captured raw
events/source refs/assessment context are not projected to person context,
duplicate projected edges exist, or positive evaluator claims lack source refs.
Use `--require-all-families` during full cutover checks when absence of any
family should fail the command.

## Required Proof

Run the local or remote audit after replay/backfill:

```bash
cd workers/api
npm run assessment-evidence:audit -- --local
npm run assessment-evidence:audit -- --local --session-id <assessment_session_id>
npm run assessment-evidence:audit -- --local --session-id <assessment_session_id> --require-all-families
npm run assessment-evidence:audit -- --remote
npm run assessment-evidence:audit -- --remote --session-id <assessment_session_id>
npm run assessment-evidence:audit -- --remote --session-id <assessment_session_id> --require-all-families
npm run assessment-evidence:replay -- --remote --session-id <assessment_session_id>
npm run assessment-evidence:replay -- --remote --all-missing --limit 25
npm run assessment-evidence:replay -- --remote --all-missing --limit 25 --summary
npm run assessment-evidence:replay -- --remote --all-missing --limit 25 --summary --progress --exclude-state IN_PROGRESS
```

For app-dev, prefix remote proof commands with
`CLOUDFLARE_D1_DATABASE_ID=0abe92df-9296-46f5-9f9d-a1fb1bcd3be1`; otherwise
the shell may audit a different configured D1 target.

The goal is not that every environment has every evidence family populated, but
that a real open-source assessment session shows captured and projected rows for
the evidence it actually produced, has zero source-less positive claims, and has
zero duplicate person-projected edges.

## Current Proof

As of 2026-07-02, local D1 has nine assessment sessions, all `REPO_MATCHING`.
The unscoped audit command exits ready with:

- `sourceLessPositiveClaimCount: 0`
- `duplicateProjectedEdgeCount: 0`
- meeting transcript evidence projected
- coverage gaps for open-source assessment families such as commit, diff, test,
  AI interaction, evaluator report, and human decision because no local
  open-source assessment session exists yet

A session-scoped audit of the latest local `REPO_MATCHING` session exits
`not_ready` because transcript source refs are captured in assessment scope but
not projected through that session's person interaction. That is a current
local-data/projection gap, not proof of open-source assessment readiness.

Targeted tests prove replay idempotency and exact source-ref preservation for
candidate profile snapshots, commit, diff, test output, upstream PR refs, AI
interactions, evaluator reports, and human decisions through the real-time
ingestion path.

The app-dev proof session `assessment_session_92da0777bbb5370d1c054a19719fe3cd`
was replayed with:

```bash
CLOUDFLARE_D1_DATABASE_ID=0abe92df-9296-46f5-9f9d-a1fb1bcd3be1 \
  npm run assessment-evidence:replay -- --remote \
  --session-id assessment_session_92da0777bbb5370d1c054a19719fe3cd
```

Replay proof:

- `interaction_type: assessment:OPEN_SOURCE_BUG_FIX`
- `context_record_count: 15`
- `source_ref_count: 39`
- `evaluation_report_record_count: 5`
- `answers.missingPersonProjectionCount: 0`
- `matchingEffects.matchRunCount: 0`

The replay proof's `answers` block is the Definition-of-Done verifier for a
session. It reports:

- `whatHappened`: assessment event-kind and actor-type counts
- `whoDidIt`: actor-type counts
- `sourceProofTypes`: immutable source-ref type counts
- `derivedClaims`: evaluator claim polarity/dimension counts
- `missingPersonProjectionCount`: raw events still lacking person projection
- `matchingEffects`: candidate match-run count and latest selected packet ids

The strict scoped remote audit for that same session exits ready with
`--require-all-families`, `sourceLessPositiveClaimCount: 0`,
`duplicateProjectedEdgeCount: 0`, no failures, and no next actions. Candidate
profile evidence is now captured and projected through one raw event, one exact
`candidate_profile` source ref, one assessment-scoped context record, and one
person-projected context record.

The same replay proof reports no repo-matching side effect for this manual
open-source assessment candidate (`matchRunCount: 0`). That is the current
matching answer for this session: the assessment evidence is available to the
person graph and recruiter surfaces, but no match run has consumed it yet.

The bulk dev-data replay command was also run with `--all-missing --limit 2`.
It repaired two candidate-backed historical `REPO_MATCHING` sessions:

- `assessment_session_0085adca113d75b29aa133b9add90cdc`: 2 context records,
  39 source refs, 4 candidate match runs, latest status `MATCHED`.
- `assessment_session_2ab90b8d76b7531a7ec9179dac74a524`: 2 context records,
  27 source refs, 2 candidate match runs, latest status `MATCHED`.

The unscoped app-dev audit now reports `duplicateProjectedEdgeCount: 0` after
scoping duplicate checks to assessment-origin interactions. It still reports
candidate-backed historical sessions with missing person projections, so broad
dev cutover remains a backlog/backfill task rather than a completed global
state.

Use `--summary` for larger bounded app-dev replay batches. The compact output
preserves the processed session ids, success/failure counts, before/after
context/source-ref totals, remaining missing person projections, and matching
effect counts without printing each full per-session proof object.

Use `--progress` when running remote batches so each selected session is printed
to stderr before and after replay. If an active assessment is still producing
room or AI events, use `--exclude-state IN_PROGRESS` to backfill completed
historical sessions first instead of parking the batch behind an active row.

On 2026-07-02, the filtered app-dev replay was run with:

```bash
CLOUDFLARE_D1_DATABASE_ID=0abe92df-9296-46f5-9f9d-a1fb1bcd3be1 \
  npm run assessment-evidence:replay -- --remote --all-missing \
  --limit 20 --summary --progress --exclude-state IN_PROGRESS
```

That batch replayed 20 non-`IN_PROGRESS` historical sessions successfully:
`processedCount: 20`, `succeededCount: 20`, `failedCount: 0`,
`contextRecordsAfter: 132`, `sourceRefsAfter: 293`, and
`missingPersonProjectionsAfter: 0`.

The follow-up unscoped app-dev audit still exits `not_ready`, but continues to
report `sourceLessPositiveClaimCount: 0` and `duplicateProjectedEdgeCount: 0`.
The broad app-dev historical backlog remains incomplete; the filtered replay
command is the current bounded repair loop for completed rows.
