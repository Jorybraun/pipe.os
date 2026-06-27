# 95 Until Infinity Repo Task Assessment Contract

**Status:** Proposed contract  
**Date:** 2026-06-27  
**Contract file:** `workers/api/src/lib/assessmentEvidence.ts`

## Purpose

Define how PIPE selects and evaluates a real source-backed repo task or
open-source issue for a candidate using the Evidence Hypergraph.

This contract extends the current source-backed CODE_REVIEW matching work into
two later meeting/assessment modes:

- `DEV_CONTAINER_REPO_TASK`
- `OPEN_SOURCE_BUG_FIX`

The contract is intentionally strict. A match is valid only when the system can
connect candidate evidence, role/JD evidence when present, repo task evidence,
AI usage evidence, and final evaluation claims back to immutable source refs.

## Research And Repo Context Read

- `knowledge/plan/living-context-repo-matching-plan.md`
- `docs/plans/code-review-product-readiness.md`
- `workers/api/src/lib/challengeMatching/types.ts`
- `workers/api/src/lib/challengeMatching/d1Matcher.ts`
- `workers/api/src/lib/repoSemanticGraph/model.ts`
- `/Users/hans/Code/AGENT/BRAIN/knowledge-base/wiki/hypergraphs.md`
- `/Users/hans/Code/AGENT/BRAIN/knowledge-base/wiki/pipe-living-context-matching.md`
- `/Users/hans/Code/AGENT/BRAIN/knowledge-base/raw/conversation-transcripts/session-2026-06-19-pipe-living-context-decisions.md`

The controlling product rule remains:

> Nothing in the production matching path may be fabricated, inferred as a
> default, or silently substituted when source evidence is missing.

## Contract Invariants

- No fake matches: `MATCHED` requires a real `RepoTaskChallengePacket` with
  complete source provenance and `fixture: false`, `synthetic: false`.
- No simulated agents: AI developer, scoring, or evaluation activity must point
  to real `ai_usage_events`; missing providers return diagnostics.
- No fabricated skills or seniority: candidate claims are source-backed claims,
  not inferred labels. Seniority can be evaluated later only as a source-backed
  claim or diagnostic, not as a default.
- No embedding-only decisions: embeddings can recall or tie-break only after
  source-backed alignment exists. `CandidateRepoTaskAlignment.decisionBasis`
  excludes embeddings.
- Every positive claim links to evidence: `SourceBackedClaim` requires
  non-empty exact source refs and hyperedge ids.
- Insufficient evidence is first-class: non-matches return `AssessmentDiagnostic`
  records such as `MISSING_CANDIDATE_SOURCE_EVIDENCE`,
  `PROVENANCE_INCOMPLETE`, or `NO_ROLE_SAFE_CHALLENGE`.
- Candidate-facing packets never expose hidden ground truth. Server-only rubric
  and expected-solution refs stay in `serverOnlyEvaluationContext`.

## Flow

1. Compile `CandidateEvidencePacket`.
   - Read immutable resume/profile/transcript/public-source artifacts.
   - Build source-backed atoms from context records.
   - Keep mentions recall-only unless evidence reaches `demonstrated` or
     `validated`.

2. Build `RepoTaskChallengePacket`.
   - Use a real repo snapshot and issue/PR/source span.
   - Include demands, file refs, task source refs, quality gates, and
     hyperedges.
   - Reject fixture, synthetic, stale hash, missing issue/PR, or incomplete
     repo source-span provenance.

3. Produce `CandidateRepoTaskMatch`.
   - `MATCHED` requires source-backed alignments between candidate atoms and
     repo demands.
   - `NEEDS_MORE_EVIDENCE`, `NO_ROLE_SAFE_CHALLENGE`,
     `PROVENANCE_INCOMPLETE`, `AI_DEVELOPER_UNAVAILABLE`, and `NEEDS_REVIEW`
     are valid terminal planning states.
   - Persist the match run and source-backed context record exactly as current
     CODE_REVIEW matching does.

4. Create the later assessment/meeting.
   - `DEV_CONTAINER_REPO_TASK`: use the selected packet to provision a dev
     container task session later.
   - `OPEN_SOURCE_BUG_FIX`: use the selected issue/PR context to create an
     open-source bug-fix assessment later.
   - Meeting creation should accept only `MATCHED` packets or explicit
     diagnostics. It must not create a generic fallback repo task.

5. Evaluate final work.
   - `FinalRepoTaskAssessmentOutput` joins the match, submission refs, AI usage,
     dimensions, score narrative, and diagnostics.
   - Every positive evaluation dimension points to `SourceBackedClaim` records.
   - If the system lacks source-backed evidence for a dimension, the dimension
     records a diagnostic gap instead of awarding implied credit.

## Proposed TypeScript Surface

The proposed contract is implemented in
`workers/api/src/lib/assessmentEvidence.ts`:

- `AssessmentMode`
- `CandidateEvidencePacket`
- `RepoTaskChallengePacket`
- `CandidateRepoTaskMatch`
- `AiUsageEvidence`
- `AssessmentDiagnostic`
- `FinalRepoTaskAssessmentOutput`

The key type-level choice is a discriminated match union:

```ts
export type CandidateRepoTaskMatch =
  | MatchedCandidateRepoTaskMatch
  | DiagnosticCandidateRepoTaskMatch;
```

`MatchedCandidateRepoTaskMatch` requires non-empty alignments, selected source
claims, a source-backed candidate packet, and a production-ready repo task
packet. Diagnostic states require non-empty diagnostics instead.

## Diagnostics Policy

Diagnostics are not errors to hide from product surfaces. They are the product
state when evidence is not strong enough.

Required blocking diagnostics:

- `MISSING_CANDIDATE_SOURCE_EVIDENCE`
- `MISSING_ROLE_SOURCE_EVIDENCE`
- `MISSING_REPO_SOURCE_EVIDENCE`
- `MISSING_ISSUE_OR_PR_CONTEXT`
- `MISSING_REPO_TASK_PACKET`
- `PROVENANCE_INCOMPLETE`
- `EMBEDDING_ONLY_MATCH_REJECTED`
- `FABRICATED_OR_SYNTHETIC_SOURCE_REJECTED`
- `SIMULATED_AGENT_REJECTED`
- `NO_ROLE_SAFE_CHALLENGE`
- `AI_DEVELOPER_UNAVAILABLE`

## Implementation Plan

1. Wire the contract into the current CODE_REVIEW matcher as a compatibility
   adapter without changing candidate behavior.
2. Add BDD coverage proving a repo-task match cannot be returned when candidate
   source refs are missing.
3. Add BDD coverage proving a repo-task match cannot be returned when repo
   issue/PR source refs are missing.
4. Add BDD coverage proving embedding-only recall returns
   `EMBEDDING_ONLY_MATCH_REJECTED`.
5. Add the meeting creation seam for `DEV_CONTAINER_REPO_TASK` and
   `OPEN_SOURCE_BUG_FIX`, accepting only `CandidateRepoTaskMatch`.
6. Add final evaluation persistence using `FinalRepoTaskAssessmentOutput`.
7. Add recruiter and candidate-safe views that separate selected evidence,
   diagnostics, AI usage, and server-only ground truth.

## Open Questions

- Whether `OPEN_SOURCE_BUG_FIX` should require an upstream issue that is still
  open at assessment creation time, or whether a historical fixed issue can be
  used when labelled as an assessment replay.
- Whether dev-container task quality gates should require executable tests for
  v1, or allow documentation/config tasks when source-backed acceptance criteria
  are strong enough.
- Whether final recommendations should stay four-level evidence labels, or map
  to customer-specific rubric language later.
