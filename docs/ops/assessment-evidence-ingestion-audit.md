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

## Required Proof

Run the local or remote audit after replay/backfill:

```bash
cd workers/api
npm run assessment-evidence:audit -- --local
npm run assessment-evidence:audit -- --remote
```

The goal is not that every environment has every evidence family populated, but
that a real open-source assessment session shows captured and projected rows for
the evidence it actually produced, has zero source-less positive claims, and has
zero duplicate person-projected edges.
