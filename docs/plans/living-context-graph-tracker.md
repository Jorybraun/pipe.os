# Living Context Graph + Candidate-to-PR Matching Tracker

Last updated: 2026-06-22

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
| 1 | Living person graph: contacts and applicants share one underlying person; resumes, meetings, interviews, messages, and assessments add context; interaction-level evidence stays separate from accumulated evidence. | #55 proves meeting transcript ingestion creates one stable person/workspace person, interaction, artifact version, source spans, assertions, signals, snapshots, and projection outbox entries. #54 proves text resume intake can trigger candidate ingestion for standalone CODE_REVIEW. Local branch proof now ingests a meeting transcript for a contact, then adds the same email as a roleless talent-pool candidate and verifies one person/workspace graph, one application, preserved meeting interaction, and accumulated transcript assertion/signal evidence in the candidate read model. Resume decomposition now persists decomposed resume nodes through `insertCandidateNode`, so resume evidence reaches D1 candidate nodes and triggers living-context mirroring instead of only building in-memory/Neo4j nodes. | Strong partial proof | Prove the same convergence through the real browser/API Meetings + People/Roles product flow, not only worker integration tests. |
| 2 | Preserve original meaning: assertions link to exact transcript paragraph, resume line, or assessment response; content remains searchable; conclusions explain origin. | #55 verifies exact transcript spans and immutable artifact versions. #54 exposes `candidateSourceRefs` and `challengeSourceRefs` in recruiter CONTEXT. Local branch read-model proof now exposes shared meeting transcript artifacts and exact source spans through `artifact_interactions` after the contact becomes a roleless candidate. Resume decomposition now supports validated `source_quote` fields copied from raw resume text; living-context mirroring uses those quotes as exact source spans while keeping the generated assertion narrative separate. | Strong partial proof | Add full browser E2E asserting exact source snippets survive resume/meeting/review submission into recruiter CONTEXT. |
| 3 | Learn semantics dynamically: no hard-coded skills/signals/domains/aliases/node types/semantic edges; unknown concepts survive ingestion. | ADR-043 remains the governing invariant. #55 proves `term:temporal-shard-knitting` survives as a previously unseen source-backed concept. #53, if merged, improves CamelCase open-term normalization. Local branch proof now carries `term:crystalline-quorum-ledger` from distinct resume and meeting interactions into candidate query atoms and matches it to repo source without taxonomy or alias tables. Meeting transcript ingestion now links extracted open concepts directly onto the source-backed `meeting_transcript_assertion` context record, not only the legacy `semantic_assertions` projection, and read-model coverage proves the context record can stand as the semantic hyperedge. | Partial proof | Add the same unknown-concept survival regression through the real browser/API resume + meeting + code-review flow. |
| 4 | Understand repositories the same way: files, exact spans, symbols, structural facts, behavioral episodes, assertions, signals, commit/line provenance. | #60 proves repo graph persistence is deterministic, idempotent, and source-span backed, including exact source text and incomplete-provenance ineligibility. Local branch matcher proof now builds a production-ready packet through `buildChallengePacket` + `persistReviewChallengeGraph` with exact repo spans, symbols, structural fact, episode, assertion, facet, and repo signal before matching. Repo-discovery conversion proof now fetches mocked GitHub PR metadata/files/head content, normalizes exact source spans/structural facts, persists the production-ready packet, and feeds it into matching. Backfill proof now exercises the `backfillReviewChallengePackets` runner from a persisted `repo_sample_prs` row through PR refs/diff/source fetch, packet persistence, and matching with source refs intact. Repo challenge extraction now preserves raw CamelCase identifier parts as phrase-level open terms, so source identifiers like `CrystallineQuorumLedger` can survive as repo semantics without a hard-coded skill list. The standalone CODE_REVIEW browser fixture now also builds normalized PR evidence, production challenge packets, structural facts, and repo semantic projections, then persists through `persistReviewChallengeGraph` instead of hand-writing packet JSON. Neo4j repo ingestion now reads from discovered/configured local D1, treats Neo4j as a rebuildable projection instead of a source of truth, and skips repos without D1 `repo_searchable_profile` evidence instead of synthesizing metadata-only profiles. Repo challenge packet context records now persist their packet demand concept keys into open `concepts` and `context_record_concepts`, so repository hyperedge records carry searchable concepts directly rather than only embedding them in packet/entity metadata. | Strong partial proof | Run the same proof against live/backfilled GitHub data and rebuild Neo4j/search projections from the D1 repo graph. |
| 5 | Evidence-based matching: represent candidate evidence, role requirements, and repos in the same model; select a specific PR challenge; no fabricated seniority/default evidence/generic fallback/embedding-only decision. | #54 wires text intake into candidate ingestion and deterministic PR matching for standalone CODE_REVIEW. #60 ensures incomplete repo provenance is not production-ready for matching. Local branch proof now requires standalone CODE_REVIEW submission to fail closed until a source-backed PR is selected, then completes the review only after deterministic matching. Worker matcher proof selects a specific PR from a packet persisted through the repo graph ingestion path. Repo-discovery conversion and runner-level review-packet backfill proofs now select converted/backfilled PR packets through `matchCandidateToReviewChallenge` and verify no generic fallback is involved. The latest runner-level proof accumulates the same previously unseen concept from separate resume and meeting evidence before selecting a source-backed PR packet. The matcher now rejects stale or hand-shaped `review_challenge_packets` with `PACKET_PROVENANCE_INVALID` before recall/ranking by recomputing packet/demand identities and content hashes. Simple JD role contexts now persist selected literal JD terms as open concepts on the source-backed `simple_job_description` context record, and role guardrails can load selected requirements from those context records, so role requirements participate in the same semantic model as candidate, repo, and match evidence. | Strong partial proof | Replace mocked GitHub fetches with a full golden path from live repo crawler/backfill data and accumulated person evidence. |
| 6 | Explain every match: show candidate evidence aligned to code demand, link both sides to sources, report gaps/stretch areas. | #54 verifies recruiter CONTEXT has match evidence with candidate and challenge source refs. Local branch proof now asserts `GET /api/v1/candidates/:id` assembles standalone CODE_REVIEW explanation data from persisted match/interview/repo/PR rows, `LivingContextGraph` renders candidate source snippets, PR demand snippets, evidence gaps, recalled packets, excluded packets, invalid packet provenance failures, and stretch diagnostics, §MVP.7 preserves that source-backed match summary after review submission, §MVP.8 browser-proves the recruiter CONTEXT tab shows the submitted review summary, annotation, selected PR, candidate source snippet, PR demand source snippet, repository evidence overlay, recalled packet, and evaluated challenge diagnostics, local UI coverage renders meeting transcript source snippets/assertions from interaction-level graph branches, worker matcher proof verifies source refs from repo graph persistence survive into match explanations and match context records, repo-discovery conversion proof verifies the selected converted PR records exact candidate/repo refs plus an explicit unmatched-demand evidence gap, isolated-port Playwright now proves the rendered recruiter overlay using a packet persisted by `persistReviewChallengeGraph` rather than a hand-shaped packet row, the latest backfill proof verifies the selected explanation links the unseen candidate concept back to resume/meeting source text and repo source text, component coverage now renders a crawler/backfill-shaped explanation record with accumulated resume/meeting evidence aligned to repo source spans, and the candidate profile API now preserves `sourceRefType`, `sourceRefId`, and `sourceSpanId` so public explanations remain auditable back to candidate and repo source rows. Candidate profile API now also falls back to selected `review_challenge_packets.packet_json` for PR title/url when legacy `repo_sample_prs` metadata is absent. | Strong partial proof | Extend the same rendered explanation proof to live/backfilled repo-ingestion packets rather than local/test seeded packets. |
| 7 | Visualize the living graph: navigable person/context graph, accumulated evidence, repository structure, candidate-to-code overlays. | #57 documents the visualization plan. Existing `LivingContextGraph` renders recruiter CONTEXT graph, CODE_REVIEW evidence, context-record trees, contact/person context data, submitted review details, and candidate-to-code match diagnostics. Local branch §MVP.8 browser-proves the submitted standalone review overlay and repository evidence overlay in the recruiter graph, the read model now surfaces shared meeting transcript artifacts/source spans for candidate graphs after contact-to-candidate convergence, the graph UI now renders explicit meeting evidence cards from transcript-backed interactions, artifacts, context records, assertions, signals, and exact source spans, and the standalone review panel now exposes repo-demand navigation grouped by stored PR source locators. Worker matcher proof validates the persisted repo packet source refs that the overlay needs, the browser fixture now reaches those refs through the production repo graph persistence path, component coverage now exercises the same overlay with crawler/backfill-shaped repo packet evidence for an unseen concept, rendered repository source cards now carry source ref type/ID/span/hash data attributes, §MVP.8 now asserts those rendered attributes retain the seeded candidate `source_span` and repo `repo_source_span` IDs, and the candidate profile route proof now hydrates selected PR display metadata from real D1-shaped `review_challenge_packets.packet_json` rows without requiring a `repo_sample_prs` row. | Partial proof | Promote browser repository overlay proof from local/test persisted fixture packets to live/backfilled repo-ingestion packets. |
| 8 | Production quality: deterministic/idempotent backfills, rebuildable projections, expert-labelled evaluation, full E2E, staged rollout. | #59 adds evaluation guardrails for synthetic labels, forbidden labels, and missing provenance. #60 adds repo graph idempotency/source-span proof. #58 improves E2E remote env plumbing. Local branch now exposes standalone scheduled interviews through the candidate profile API, aligns the standalone CODE_REVIEW E2E with that public contract, proves fail-closed submission, matched review completion, and rendered recruiter CONTEXT explanation in focused Playwright runs, hardens local E2E readiness with `/api/health` compatibility after stale default-port server drift was observed, adds a callable backfill runner proof for review challenge packet creation and matching from crawled PR rows, prevents E2E fixture PR rows from masquerading as crawler/SWE-bench eligible backfill inputs, adds matcher regressions proving valid packets come from `buildChallengePacket` + `persistReviewChallengeGraph` while legacy hand-shaped packet rows fail closed, verifies the Neo4j repo projection script has a true read-only dry-run with no Neo4j connection or embedding writes, and verifies the projection skips repos without source-backed profiles rather than generating synthetic summaries. | Partial proof | Stabilize main CI, add expert-labelled corpus, run the full standalone CODE_REVIEW E2E in the target CI/deployed environment, and define staged rollout gates. |

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

### Open or needs review

| PR | Area | Merge state | Recommendation |
|---|---|---|---|
| #53 | Migrate broader living-context tests from `node:sqlite` to `better-sqlite3`; CamelCase open-term normalization | Open draft, conflict-free before #57/#58/#60 landed | Rebase/audit against latest `main`; merge only if still removes remaining `node:sqlite` failures not already covered by #59/#60. |

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

1. Rebase/audit #53 against latest `main`; decide whether it is still needed or should be superseded by #59/#60.
2. Stabilize mainline unit failures, especially `probeLibrarian`/planner expectations that currently fail on `main`.
3. Promote the standalone CODE_REVIEW proof into the target CI/deployed environment, then extend the full E2E to meeting/resume evidence growing the graph before deterministic PR matching.
4. Promote repository overlay proof from local/test seeded packets to real repo-ingestion packets.
5. Add the first expert-labelled evaluation corpus and make evaluation a non-blocking report before turning it into a hard CI gate.
