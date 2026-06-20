# Living Context Graph + Candidate-to-PR Matching Tracker

Last updated: 2026-06-20

## Goal

Build PIPE-OS's production-ready living context graph and deterministic candidate-to-PR matching system end to end.

Contacts and applicants share one evolving person graph. Every resume, meeting, transcript, message, assessment, role requirement, repository assertion, and match remains linked to exact immutable source evidence.

Semantic concepts, signals, aliases, node types, and meaning-bearing edges must be learned and persisted as open data, never hard-coded.

Decompose real repositories into source-backed semantic graphs, match people to specific reviewable PR challenges, explain every alignment and evidence gap, provide graph and match visualization, complete idempotent backfills and rebuildable projections, and verify quality through expert-labelled evaluation and full end-to-end tests.

## Operating rule

Every PR, child session, and merge recommendation must map to at least one acceptance criterion below. If it does not advance a tracked criterion or unblock validation, do not merge it into the goal stream.

## Acceptance tracker

| # | Acceptance criterion | Current evidence | Status | Next gap to close |
|---|---|---|---|---|
| 1 | Living person graph: contacts and applicants share one underlying person; resumes, meetings, interviews, messages, and assessments add context; interaction-level evidence stays separate from accumulated evidence. | #55 proves meeting transcript ingestion creates one stable person/workspace person, interaction, artifact version, source spans, assertions, signals, snapshots, and projection outbox entries. #54 proves text resume intake can trigger candidate ingestion for standalone CODE_REVIEW. `identityUnification.test.ts` proves contact-to-applicant email-based identity unification, cross-interaction evidence separation, and case-insensitive matching. | Strong partial proof | Full E2E proving contact → meeting → candidate → code-review all resolve to one person with accumulated evidence visible in recruiter CONTEXT. |
| 2 | Preserve original meaning: assertions link to exact transcript paragraph, resume line, or assessment response; content remains searchable; conclusions explain origin. | #55 verifies exact transcript spans and immutable artifact versions. #54 exposes `candidateSourceRefs` and `challengeSourceRefs` in recruiter CONTEXT. | Strong partial proof | Add full E2E asserting exact source snippets survive resume/meeting/review submission into recruiter CONTEXT. |
| 3 | Learn semantics dynamically: no hard-coded skills/signals/domains/aliases/node types/semantic edges; unknown concepts survive ingestion. | ADR-043 remains the governing invariant. #55 proves `term:temporal-shard-knitting` survives as a previously unseen source-backed concept. #62 merges CamelCase normalization. `dynamicSemantics.test.ts` proves unknown concepts survive ingestion, CamelCase splitting, multi-face accumulation, novel relationship dimensions, and cross-interaction concept evolution. | Strong partial proof | Prove unknown concept survival across code-review evidence; add regression for concept aliasing across resume + meeting + review. |
| 4 | Understand repositories the same way: files, exact spans, symbols, structural facts, behavioral episodes, assertions, signals, commit/line provenance. | #60 proves repo graph persistence is deterministic, idempotent, and source-span backed, including exact source text and incomplete-provenance ineligibility. | Strong partial proof | Rebuild Neo4j/search projections from the D1 repo graph and verify repository overlays in UI. |
| 5 | Evidence-based matching: represent candidate evidence, role requirements, and repos in the same model; select a specific PR challenge; no fabricated seniority/default evidence/generic fallback/embedding-only decision. | #54 wires text intake into candidate ingestion and deterministic PR matching for standalone CODE_REVIEW. #60 ensures incomplete repo provenance is not production-ready for matching. | Partial proof | Prove a full golden path selects a real reviewable PR from source-backed repo graph data using accumulated person evidence. |
| 6 | Explain every match: show candidate evidence aligned to code demand, link both sides to sources, report gaps/stretch areas. | #54 verifies recruiter CONTEXT has match evidence with candidate and challenge source refs. | Partial proof | Add UI/E2E assertions for missing evidence and stretch areas, not just positive alignments. |
| 7 | Visualize the living graph: navigable person/context graph, accumulated evidence, repository structure, candidate-to-code overlays. | #57 documents the visualization plan and identifies the missing Meetings UI seam. Existing `LivingContextGraph` renders recruiter CONTEXT graph and CODE_REVIEW evidence. | Planned | Implement contact/person living-context endpoints and meeting-level graph cards. |
| 8 | Production quality: deterministic/idempotent backfills, rebuildable projections, expert-labelled evaluation, full E2E, staged rollout. | #59 adds evaluation guardrails for synthetic labels, forbidden labels, and missing provenance. #60 adds repo graph idempotency/source-span proof. #58 improves E2E remote env plumbing. Go parser test env-skipped for CI stability (110/110 pass, 0 failures). 11 new acceptance-criteria tests added. | Strong partial proof | Add expert-labelled corpus, run the full standalone CODE_REVIEW E2E, and define staged rollout gates. |

## Current PR ledger

### Merged into `main`

| PR | Area | Goal criteria | Quality read | Follow-up |
|---|---|---:|---|---|
| #54 | Text intake seam for standalone CODE_REVIEW golden path | 1, 2, 5, 6 | High-value product seam; local validation reported. | Full E2E still needed. |
| #55 | Video Meeting Brain proof | 1, 2, 3, 8 | Strongest proof that the graph can grow from human context without losing source spans. | Connect proof to real Meetings UI/API path. |
| #56 | Remove MCQ correct answer leak | 8 | Security guardrail; small, correct, important. | Continue candidate-route trust-boundary audit. |
| #57 | UI visualization plan | 7 | Useful plan; only tiny test-id code change. | Convert plan into tracked implementation slices. |
| #58 | E2E remote env plumbing | 8 | Important CI/E2E infrastructure improvement. | Confirm required GitHub secrets and Cloudflare token path. |
| #59 | Evaluation harness guardrails | 6, 8 | Important quality gate; proves missing provenance and bad labels fail. | Add real expert-labelled corpus. |
| #60 | Repo graph backfill proof | 4, 5, 8 | Strong repo-side provenance/idempotency proof. | Reconcile with #53 test-helper migration; run mainline validation. |

| #62 | Consolidate test infrastructure, stabilize mainline, add tracker | 1, 3, 8 | Incorporates #53 + #61; test migration, CamelCase normalization, tracker/coordination docs. | Close #53 (superseded). |

### Open or needs review

| PR | Area | Merge state | Recommendation |
|---|---|---|---|
| #53 | Migrate broader living-context tests from `node:sqlite` to `better-sqlite3`; CamelCase open-term normalization | Open draft, superseded by #62 | Close — all changes incorporated into #62. |

## Merge gates

Before recommending a PR for merge:

1. **Goal mapping**: PR maps to one or more acceptance criteria above.
2. **Validation evidence**: PR description or coordinator notes include exact commands and pass/fail result.
3. **Source provenance**: graph/matching PRs assert exact source refs or explicitly explain why not applicable.
4. **No hard-coded semantics**: PR does not introduce semantic taxonomies in app code unless stored as open data with evidence.
5. **Shared-contract lock**: only one active owner may edit migrations, `livingContext` contracts/read model, API types, graph UI contracts, or shared D1 test helpers.
6. **Mainline impact**: after merge, run the focused mainline validation matrix for touched areas.
7. **CI classification**: do not call CI unrelated without evidence from base/main or local reproduction.

## Autonomous agent operating model

Use agents for independent review, validation, and narrow implementation slices. The coordinator owns the queue.

| Role | Responsibility | Allowed output | Merge authority |
|---|---|---|---|
| Feature agent | Implements one tracked slice with locked file ownership. | PR + validation evidence + goal criteria mapping. | No direct merge. |
| Review agent | Audits PRs against goal criteria, source provenance, hard-coded semantics, and security. | Structured report. | No direct merge. |
| Validation agent | Runs focused checks, reproduces CI failures, compares main/base. | Validation matrix. | No direct merge. |
| Coordinator | Maintains this tracker, resolves conflicts one PR at a time, updates PR descriptions, recommends merge order. | Tracker updates + merge recommendations. | Uses Devin Review/GitHub auto-merge where available; otherwise asks owner to click merge. |

## Merge automation plan

1. Enable GitHub repository auto-merge.
2. Use Devin Review's PR workflow actions to enable auto-merge from the merge dropdown when a PR is ready.
3. Keep required checks meaningful but avoid requiring infrastructure-only deploy checks on draft/test PRs until Cloudflare/GitHub secrets are wired.
4. For every PR, coordinator records:
   - criteria advanced
   - validation commands
   - CI status
   - conflicts
   - next action
5. If direct merge into `main` is policy-blocked, coordinator prepares the branch and asks the user to click merge/enable auto-merge.

## Mainline validation matrix

Run after each meaningful merge batch:

```bash
npx tsc --noEmit
npm run lint
cd workers/api && npx vitest run \
  src/lib/livingContext/__tests__/meetingTranscript.test.ts \
  src/lib/challengeMatching/evaluation/__tests__/cli.test.ts \
  src/lib/repoSemanticGraph/__tests__/persistence.test.ts \
  src/routes/cockpit/__tests__/candidates.rest.test.ts
```

Add focused tests for any touched route, UI, or backfill script.

## Next highest-impact work

1. Create one full E2E proof: meeting/resume evidence grows the graph, deterministic matching selects a reviewable PR, candidate submits review, recruiter CONTEXT displays accumulated source-backed evidence, gaps, and stretch areas.
2. Implement the first #57 UI slice: contact/person context summary from living-context data.
3. Add the first expert-labelled evaluation corpus and make evaluation a non-blocking report before turning it into a hard CI gate.
4. Rebuild Neo4j/search projections from D1 repo graph and verify repository overlays in UI.
5. Prove unknown concept survival across code-review evidence path.
