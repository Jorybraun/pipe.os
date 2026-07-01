# Code Review Product Readiness Playbook

Last updated: 2026-06-27

## Purpose

This playbook turns the local brain research on hypergraphs, semantic context
preservation, multi-agent systems, and feedback loops into a concrete product
contract for PIPE's CODE_REVIEW assessment.

The goal is not "a diff page loads." The goal is a defensible work simulation:
a candidate reviews a real PR that is appropriate to their evidence, explains
their decisions, defends those decisions against an AI developer, and leaves a
source-backed result a recruiter can trust.

## Current Proof

App-dev now has end-to-end smoke gates for the current Base UI packet:

```bash
CODE_REVIEW_SMOKE_SUBMIT=1 npm run smoke:code-review-assess-dev
CODE_REVIEW_SMOKE_SUBMIT=1 CODE_REVIEW_SMOKE_AUTO_MATCH=1 npm run smoke:code-review-assess-dev
npm run smoke:code-review-assess-dev:person-boundary
npm run smoke:code-review-assess-dev:role-backed
```

The validated manual and roleless auto-match runs created disposable
CODE_REVIEW invites, delivered `/assess/:token` links, selected
`mui/base-ui#973`, rendered the Pierre diff in the browser, drove the visible
candidate UI to add an inline diff comment, submitted the first review round,
waited for the AI developer response/thread, then submitted a `request_changes`
verdict and verified recruiter-visible completion on both interview detail and
candidate profile result surfaces. Manual mode validates a recruiter-selected
source-backed PR without inferring CV fit; roleless auto-match must show enough
candidate-to-repo contrast before it can become a candidate challenge. The
full-submit smoke now also verifies that the
`code_review_judge_examples` replay queue contains the completed review session
with candidate comments, AI developer pushback, and improvement-loop metadata
for human labelling and cross-model calibration.

The role-backed smoke creates a simple-JD role context and auto-builds a
CODE_REVIEW pipeline. When matchable source-backed resume evidence exists, the
smoke must produce a ready source-backed PR assignment, render `WELCOME` +
`CODE_REVIEW` for the candidate, and verify recruiter detail projects the repo/PR
from `candidate_challenge_assignment`. If the deterministic matcher cannot
produce a source-backed PR that passes the candidate-safe quality gate, `/assess`
must stop at the candidate-safe `PROFILE_RECEIVED` handoff instead of serving a
`NEEDS_REVIEW` challenge to the candidate.

The person-boundary smoke extends the manual full-submit path by creating a
second same-email CODE_REVIEW invite with no candidate submission. Recruiter
browser proof must still show the interview as scoped to its own evidence, and
the person profile must keep the current recommendation anchored to the completed
scored review instead of blending the related unsubmitted assessment into the
decision. The unsubmitted related invite is allowed to appear as related context;
it must not be counted as a completed/evidence-producing code-review result.

Local validation on 2026-06-27 also proved the full-submit smoke no longer
relies on the browser to create hidden assessment state. Ready-assignment
smokes may observe internal transient matching readiness while the source-backed
PR assignment is being prepared, but blocked standalone CODE_REVIEW handoffs
must return the candidate-safe `PROFILE_RECEIVED` / `candidate-intake-queued`
state instead of a candidate-visible matching screen. Once the challenge is
ready, the smoke replays `/rpc/get-stage-config` to materialize the assessment
row, initializes the review session, and verifies recruiter and judge-example
outputs. A passing local proof selected `mui/base-ui#973`, rendered the browser
smoke, completed a `request_changes` review, stored a judge example with
`human_label_queue` and `cross_model_calibration`, and reported
recruiter-visible validator approval plus four evidence hyperedges.

The same full-submit smoke family now passes against deployed app-dev after
deploying `pipe-api-dev` and `pipe-app-dev`. The latest manual app-dev proof
selected `https://github.com/mui/base-ui` PR `#973`, returned `MATCHED`,
`qualityGate: PASSED`, `assessmentQuality: USABLE`, recruiter-visible
`codeReviewMatchStatus: MATCHED`, and validator `PASSED`; it rendered the
candidate-safe proof in the browser, drove a visible Pierre inline comment,
received an AI developer response, completed the recruiter interview/profile
result, persisted score `62`, and created judge replay example
`code_review_judge_example_01655744bddfa410c15a6bafbc416415`.

After the recruiter detail defense-thread UI was added, a fresh manual
full-submit app-dev proof passed for interview
`f351c4f1-c324-4524-bac8-0efe00dc948b`, review session
`4090c1fa-91cf-42e4-8534-5e429f038e54`, and judge replay example
`code_review_judge_example_98833208c471ec6fc5fa777979d417b9`. In-app browser
validation of the deployed recruiter route confirmed the result page renders
the `AI developer defense` section with candidate annotations, AI developer
pushback, and the follow-up AI developer change response. This closes the
previous recruiter-result visibility gap for a completed standalone review.

After deploying dev API version `e1b98750-0f61-407a-9e5d-c2e299cef507`
and dev app shell version `3fec1ccc-3311-44c7-8cb2-313a2c06bcc2`, the
role-backed full-submit app-dev smoke passed again on 2026-06-27. The run
created interview `d8d65789-a653-4617-8ad4-1658a6653bb1`, role context
`48b16c4de9873a9ee30399dadce33566`, pipeline
`c68944f77b329ee25ffa5386846d7773`, stage
`b1a681a13cac5d3edbb33c6fc8888956`, and review session
`2149cfd1-3030-4f85-99fa-589c6dbb93d8`. It selected real
`mui/base-ui#973`, returned `MATCHED`, `qualityGate: PASSED`,
`assessmentQuality: USABLE`, rendered the deployed browser CODE_REVIEW
surface with readable match reason, `ASSESSMENT_FIT`, validator, hypergraph
evidence, and Pierre diff, submitted visible candidate review comments,
received AI developer pushback, completed recruiter results with 4 evidence
hyperedges and a person-role-repo hyperedge, and created judge replay example
`code_review_judge_example_bb02405ddcb09edd24f6618756dfe496` for
`human_label_queue` and `cross_model_calibration`.

The roleless auto-match full-submit app-dev lane also passed after the same
deployment. The run created interview `43210dfe-d589-4229-841f-f9b9c9b9fe5e`
and review session `ea8a07c9-9631-4ace-8f67-8f1cbdfb8f41`, selected
`mui/base-ui#973`, returned `MATCHED`, `qualityGate: PASSED`,
`assessmentQuality: USABLE`, and measured positive contrast separation against
the next comparable challenge (`1/2`, selected challenge ahead by 2%). It
rendered the browser CODE_REVIEW surface, submitted visible candidate comments,
received AI developer pushback, completed recruiter/profile results with 4
evidence hyperedges, and created judge replay example
`code_review_judge_example_ee8b8947c9838f1e25bd80e8714a1c25` for
`human_label_queue` and `cross_model_calibration`.

Readiness interpretation: automatic CODE_REVIEW matching is only considered
repo-matching proof when the candidate-safe quality gate is `PASSED` with
measured positive contrast separation. A role-backed run that renders the
challenge and person-role-repo hyperedge but reports no comparable challenge is
still a useful end-to-end flow smoke, but it must be treated as `NEEDS_REVIEW`
for the "best repo for this person" claim until a second real calibrated
packet is available in that environment.

On 2026-07-01, PR #171's backend-only matching primitives were harvested as an
internal quality slice instead of merging the branch wholesale. The accepted
surface is `runMatchQualityEvaluation({ corpusId })`, compact match reports,
decision-weighted packet exclusions, source-backed PR checks, and labelled
contrast cases. The rejected surface remains candidate/recruiter graph cockpit
expansion, concept merge/split APIs, batch-eval recruiter routes, and any
candidate-visible matching/decomposition dashboard inside `/assess`.

The operator entrypoint is `cd workers/api && npm run living-context:match-quality
-- --database-path <sqlite> --corpus-id <frozen-corpus-id> --require-pass`. It
also accepts `--corpus-file <json>` for compact match-quality fixtures. When a
stored row contains the older `evaluation_corpora` schema, the CLI adapts
candidate-role-challenge relevance labels into candidate-to-packet quality cases
instead of creating a second unrelated corpus format.

CI also runs the matching-evaluation readiness report after worker unit tests.
Missing Cloudflare credentials or `MATCHING_EVALUATION_CORPUS_ID` produce a
loud `not_configured` artifact and do not block pull-request, local, or `main`
push contexts. Once a corpus is configured, a failed readiness result is a
blocking CODE_REVIEW gate rather than advisory output. The gate defaults to the
production D1 secret and `production` rollout stage, but can be pointed at the
current app-dev data plane by setting `MATCHING_EVALUATION_D1_DATABASE_ID`
(for example the `pipe-db-test` database used by `api-dev.hire-pipe.com`) and
`MATCHING_EVALUATION_STAGE=shadow|canary|production`. This keeps app-dev
CODE_REVIEW proof from being confused with the mostly empty production D1 while
still using the same evaluator and frozen-corpus contract.

The manual override full-submit app-dev lane passed after updating the smoke to
assert the candidate-facing product language ("a recruiter selected this PR")
instead of the internal phrase "manual override." The passing run created
interview `c89541cb-3b52-4eb1-9652-6f4f5f9e4bef` and review session
`2e007d00-5f99-4dd4-8d0c-b959b5d421ea`, selected `mui/base-ui#973`,
returned `MATCHED`, `qualityGate: PASSED`, `assessmentQuality: USABLE`, and
correctly reported contrast separation as unmeasured because recruiter override
bypasses automatic candidate-to-PR ranking. The candidate browser still rendered
the source-backed PR, readable recruiter-selected match reason, `ASSESSMENT_FIT`,
validator proof, and Pierre diff, then submitted visible comments, received AI
developer pushback, completed recruiter/profile results, and created judge
replay example `code_review_judge_example_647b6624f16a85fb8314808f879fe26b`.
Recruiter evidence hyperedges are expected to be `0` for this lane because PIPE
must not pretend a manual recruiter choice is an inferred CV-to-repo match.

This proves the lifecycle for one production-ready packet. On 2026-06-27 the
app-dev corpus was broadened with real overlay-ready `mui/base-ui` comparator
packets, including `#5095` for Progress semantics and `#5110` for nearby
popup/trigger semantics. The matching-quality gate now requires the default
auto-match smoke to recall a second eligible concept-near packet and report
measured positive contrast separation, instead of accepting a single recalled
packet as sufficient repo-matching proof.

The matcher also expands source-backed compound CV terms into atomic recall
keys. For example, a candidate source span mentioning
`trigger-click-handling-use-popover-root` keeps that exact term while also
recalling source-backed `popover`, `trigger`, `click`, and `use-popover-root`
concepts. This lets the hypergraph compare the selected PR against nearby real
PRs without fabricating evidence or relaxing source provenance.

This does not prove the full product is complete across calibrated difficulty,
judge quality, or broader concept-near packet breadth.

After adding `ASSESSMENT_FIT`, the local proof bundle also distinguishes raw
contrast readiness from calibrated assessment readiness:

```bash
cd workers/api
npm run review-packets:repair-profiles -- --json
npm run review-packets:repair-profiles -- --write
npx tsx scripts/verifyCodeReviewMatchingLocal.ts --json
```

The 2026-06-27 local run found two real overlay-ready `mui/base-ui` packets
(`#973` and `#5110`) with source refs and concept links, so raw contrast is
available. Before repair, it correctly returned `status: "not_ready"` because
both persisted packet JSON blobs were legacy rows without `reviewProfile`
metadata. Running `npm run review-packets:repair-profiles -- --write` updated
81 local packet rows, including `mui/base-ui#973` as `advanced/staff/75m` and
`mui/base-ui#5110` as `focused/senior/45m`. The local verifier now returns
`status: "ready"` with `calibratedContrastReady: true` and
`realOverlayReadyWithReviewProfiles: 2`.

## Research Sources Read

| Source | Product implication |
|---|---|
| `/Users/hans/Code/AGENT/BRAIN/knowledge-base/wiki/hypergraphs.md` | Hyperedges are needed when one meaning-bearing record connects more than two things; pairwise edges create ambiguity for person-role-repo matching. |
| `/Users/hans/Code/AGENT/BRAIN/knowledge-base/wiki/pipe-living-context-matching.md` | Nothing in matching may be fabricated or silently defaulted; missing evidence must become a diagnostic state, not a generic repo. |
| `/Users/hans/Code/AGENT/BRAIN/knowledge-base/wiki/semantic-context-preservation.md` | Decomposed fragments need exact source text, rationale, dependencies, structural coherence checks, and summary links so meaning survives decomposition. |
| `/Users/hans/Code/AGENT/BRAIN/knowledge-base/wiki/the-research-loop.md` | Improvement comes from an iterative STUDY/DISCUSS/DREAM/PLAN/EVALUATE loop, not one-shot ingestion. |
| `/Users/hans/Code/AGENT/BRAIN/knowledge-base/wiki/diversity-collapse.md` | Independent critique before synthesis prevents agents from converging too early; useful for judge/scorer calibration and AI developer pushback design. |
| `docs/plans/scoped-living-context-graph-v1.md` | PIPE's authoritative hypergraph is the persisted `context_records` model; UI graph edges are rebuildable projections, not source truth. |
| `knowledge/research/outputs/repo-personalized-interview-config-research-psychometrics.md` | Code review task size, timing, and difficulty need empirical calibration; one PR can be a useful screen but not a complete high-stakes reliability claim. |

Two source quotes that should govern implementation:

> "Nothing in the production matching path may be fabricated, inferred as a default, or silently substituted when source evidence is missing."

> "One semantic record can connect multiple nodes, concepts, sources, and later match decisions without flattening the meaning into separate disconnected binary edges."

## Product Contract

### 1. Matching Contract

A CODE_REVIEW match is acceptable only when the selected PR can be explained as
a source-backed hyperedge:

```text
candidate evidence source span
  + optional role/JD source span
  + repo/PR demand source spans
  + selected review packet
  + match decision
  = inspectable match explanation
```

Required behavior:

- Manual override may select a recruiter-specified PR only if the PR has a
  production-ready source-backed review packet.
- Auto-match must select a specific PR challenge, not only a repository.
- Roleless matching may be valid, but the UI must label it as
  `CANDIDATE_REPO`, not imply role context.
- Missing evidence must produce `NEEDS_MORE_EVIDENCE`,
  `NO_ROLE_SAFE_CHALLENGE`, or a visible quality gap.
- The candidate and recruiter must both see a plain-language reason this repo
  was chosen; recruiters also need the deeper source/provenance drill-down.

### 2. Assessment Contract

The candidate experience should test engineering decision-making, not
annotation mechanics.

Required behavior:

- Left panel: instructions, PR metadata, match reason, task constraints.
- Center panel: real diff with commentable source-backed lines.
- Right panel: verdict, summary, annotation list, and submit affordance.
- The AI developer must challenge at least one candidate comment with a
  concrete objection, clarification request, or proposed alternative.
- If no real AI developer provider is available, the route must return
  `AI_DEVELOPER_UNAVAILABLE` and preserve the absence as a diagnostic event;
  it must not insert simulated author replies into the transcript.
- Candidate behavior after pushback must be preserved: stands ground with
  evidence, revises position, accepts a fix, or collapses without rationale.

The product signal is not "found the planted issue." It is:

- Can the candidate identify relevant risks?
- Can they distinguish blocking from non-blocking issues?
- Can they communicate a useful review?
- Can they defend or revise their position when challenged?
- Can they connect local code changes to broader product/architecture impact?

### 3. Recruiter Result Contract

The recruiter result should be evidence-first. Scores are summaries, not the
artifact.

Required result sections:

- selected repo and PR,
- candidate-facing match reason,
- assessment-fit calibration with difficulty band, seniority target, expected
  review time, and sizing facts,
- recruiter provenance bridge with candidate, role, and repo evidence,
- submitted verdict and summary,
- annotations with file and line,
- AI developer pushback thread,
- scoring dimensions and confidence,
- evidence gaps and stretch areas.

Do not hide weak evidence behind a green badge. A `USABLE` match with missing
role context is acceptable for a talent-pool screen, but the UI must say why it
is usable and what it does not prove.

### 4. Feedback Loop Contract

The code review judge should improve through replayable examples, not prompt
edits from vibes.

Current implementation already creates `code_review_judge_examples` from
completed sessions, exposes a recruiter-owned replay queue, and includes a
deterministic verifier for replay-ready and calibration-ready examples.
Recruiter score overrides can also attach reviewer feedback and structured
judge failure modes, so a labelled example explains why the human corrected the
automated judge instead of only storing a replacement score.

Next loop:

1. STUDY: collect completed review sessions with transcript, match proof,
   candidate annotations, AI pushback, and score output.
2. DISCUSS: label a small batch independently with at least two evaluator
   perspectives before synthesis.
3. DREAM: compare judge/scorer failures by failure mode, not only final score.
4. PLAN: patch one rubric, prompt, matcher gate, or packet generator at a time.
5. EVALUATE: replay labelled examples and require improvement without
   regression on prior labelled cases.
6. ITERATE: promote new failure modes into the next labelling batch.

Initial failure taxonomy:

- false positive comment rewarded,
- real blocking issue missed,
- severity calibration wrong,
- candidate caved to weak AI pushback,
- candidate ignored valid AI pushback,
- summary unsupported by annotations,
- match too easy or too hard,
- repo/PR evidence not actually tied to CV/JD evidence.

## UX Assessment

What is working:

- The deployed candidate path no longer falls into video-room UI for
  CODE_REVIEW.
- The current challenge UI uses the app's dark, glassy technical surface and
  real Pierre diff rendering.
- The candidate match proof now starts with a compact `MATCH_REASON` that says
  why the PR was selected before revealing the deeper source-backed proof.
- The recruiter detail page now shows completed result, match quality,
  validator status, evidence hyperedge, submitted annotations, and AI
  developer defense threads.
- The app-dev smoke proves one full async lifecycle.

Product gaps:

- The candidate match reason can still get more specific as packet metadata
  improves, but it now has the correct product shape: human reason first,
  source topics next, provenance drill-down after.
- Packet breadth is still too narrow for a product claim; one Base UI family
  proves plumbing and a real comparator gate, not assessment coverage across
  seniority, stacks, and domains.
- Time/difficulty controls need to use diff size, file count, source context,
  bug count, and expected seniority band.
- The score needs calibration labels before it can be treated as more than a
  directional screen.

## Next Build Slices

### Slice A: Candidate "Why This PR" panel

Add a compact candidate-safe panel on the CODE_REVIEW page:

- repo and PR,
- 2-4 matched evidence chips,
- match mode: manual override, candidate-repo, or person-role-repo,
- quality label with one sentence,
- explicit gap line when role context is absent.

Status 2026-06-27: implemented in `MatchProofPanel` as `MATCH_REASON` inside
the candidate `WHY_THIS_PR` block. The browser smoke now asserts the readable
reason exists, manual overrides say a recruiter selected the PR without claiming
CV fit, and auto-match paths say PIPE selected the PR from source-backed match
evidence.

Acceptance:

- Browser smoke asserts the candidate sees a readable match reason.
- No internal IDs or raw source-ref identifiers leak to the candidate.
- Recruiter still sees full provenance.

### Slice B: Recruiter pushback replay

Render the AI developer pushback thread under each submitted annotation on
`InterviewDetailPage`.

Status 2026-06-27: implemented for the completed standalone result surface and
validated in the deployed in-app browser against interview
`f351c4f1-c324-4524-bac8-0efe00dc948b`. Keep this as a regression gate because
the recruiter must see the reasoning defense, not just the final annotation
count.

Acceptance:

- Completed review result shows candidate comment, AI pushback, and final
  candidate stance.
- API result is source-owned by review session transcript.
- Component and browser tests cover the completed standalone review path.

### Slice C: Role-backed app-dev smoke

Extend the app-dev smoke or add a sibling smoke that creates a simple JD role
source, submits candidate intake, auto-matches, and requires a
person-role-repo evidence hyperedge.

Acceptance:

- `evidenceHyperedges` includes candidate, role, and repo nodes.
- Roleless `CANDIDATE_REPO` and role-backed `PERSON_ROLE_REPO` are not confused.
- The match explanation cites exact role/JD source text.

### Slice D: Judge replay gate

Add a compact CLI or route-level verifier for labelled
`code_review_judge_examples`.

Status 2026-06-27: deterministic verifier implemented as
`workers/api/scripts/verifyCodeReviewJudgeExamples.ts` and exposed through
`npm run review-judge:verify` in `workers/api`. It validates replay artifacts
without calling an LLM, reports READY/LABELLED counts, checks candidate
comments, AI developer pushback, improvement-loop uses, source provenance, and
label completeness, and surfaces recorded failure modes for calibration.
PATCH `/api/v1/review-sessions/:sessionId/score` now accepts optional
`reviewerFeedback` and `judgeFailureModes` fields alongside `scoreReport` so
human score overrides become structured calibration labels.

Acceptance:

- Lists READY/LABELLED counts.
- Reports replay-ready and calibration-ready counts.
- Reports missing prompt/provenance fields and failure taxonomy labels.
- Fails CI or local gates when no replay-ready examples exist.
- Next: add scorer replay over labelled examples, agreement by dimension, and
  regression failure when a prompt/rubric change worsens labelled cases.

### Slice E: Packet breadth and difficulty

Backfill at least three production-ready packets in one coherent family before
claiming robust auto-match. A second packet from the same repo but a different
concept family is useful corpus breadth, but it is not sufficient contrast for a
specific candidate unless the recall step evaluates it as a comparable
alternative.

Acceptance:

- Same candidate evidence selects the intended packet over nearby alternatives.
- Opposing candidate evidence selects a different packet.
- Match explanations show contrast and excluded-packet reasons.
- Packet difficulty and expected time are stored as source-backed metadata or
  explicitly marked as engineering priors.

Status 2026-06-27: locally calibrated. New source-backed packets include
`reviewProfile` assessment-fit metadata, the candidate and review-session UIs
render `ASSESSMENT_FIT`, the recruiter detail API carries the same
candidate-safe profile from ranked match results or legacy packet JSON, and
the browser smoke asserts the candidate panel. The local matching verifier now
fails closed unless at least two real overlay-ready packets have persisted
review profiles. The repair script upgraded the current selected local D1
corpus, so local matching proof now has two calibrated real overlay-ready
`mui/base-ui` packets. The remaining product gap is broader packet breadth
beyond one coherent Base UI family and remote/app-dev packet repair or rebuild
with the same persisted profile contract.

## Production Readiness Gate

Do not mark CODE_REVIEW product-complete until all of this is true:

- Manual and auto-match pass in app-dev.
- Roleless and role-backed match proofs pass in app-dev.
- Candidate UI shows readable match reason, real diff, annotations, AI
  pushback, verdict, and completion.
- Recruiter UI shows source-backed match proof, submission, annotations,
  AI pushback transcript, and score/gap explanation.
- At least three real source-backed packets exist for contrast.
- At least two real overlay-ready packets have persisted `reviewProfile`
  assessment-fit metadata; runtime fallback profiles are not enough for a
  product-readiness claim.
- Judge examples are collected and replayable.
- Labelled judge examples exist for at least one calibration batch.
- Full browser E2E covers invite -> assess -> review -> pushback -> submit ->
  recruiter result.
- The production/staging smoke runs against deployed infrastructure with no
  video-room fallback.
