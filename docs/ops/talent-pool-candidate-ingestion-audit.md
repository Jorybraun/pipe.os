# Talent Pool Candidate Ingestion Audit

**Status:** Active proof command
**Last updated:** 2026-07-03
**Command:** `cd workers/api && npm run candidate-ingestion:audit -- --local`

## Contract

Talent Pool ingestion has three layers:

- Raw capture lives in `talent_pool_intakes`, candidate profile R2 keys,
  candidate profile URLs, phone-screener intent, and `candidate_ingestion`.
- Source proof lives in immutable `artifact_versions`, `source_spans`,
  validated candidate-node source quotes, and `context_record_source_refs`.
- Person understanding lives in `people`, `workspace_people`, and
  person-scoped living-context records. These are rebuildable projections, not
  the source of truth.

Recruiter/person reads must use that canonical person projection. Opening a
roleless Talent Pool candidate detail, graph, source search, timeline, or
evidence-depth view must resolve the active `workspace_people` row from
`context_json.talentPool.candidateId` / `legacyCandidateIds` before falling
back to the legacy `applications` bridge. A read must not create application or
candidate-role edges for a roleless Talent Pool member.

The unified People list is also part of the ingestion contract. If a Talent
Pool intake creates a canonical `people` / `workspace_people` projection, the
list returns that person in the same collection as contacts, and the returned
person id must open the profile, living-context graph, source search, evidence
timeline, and evidence-depth reads. Source-backed evidence tools must not
depend on a separate candidate-only list or a legacy contact row.

Email is not required for the roleless Talent Pool person projection. When a
candidate row has email, the projection keeps the email-keyed person merge; when
email is absent, ingestion uses a deterministic candidate-keyed person identity
so the candidate still appears in the unified person graph without creating a
separate list or role-backed application.

Living-context evidence panels and matching diagnostics must use the same
read-only candidate-to-`workspace_people` resolver: legacy application bridge
first when it exists, then the roleless Talent Pool context keys. They must not
create an `application` just to read source-backed evidence.

This follows the BRAIN hypergraph model: an intake run is a source-backed
evidence bundle connecting candidate id, submitted profile artifact, extracted
spans, ingestion state, person projection, and unresolved gaps. The person graph
is useful only when it preserves exact provenance back to that bundle.

## What The Audit Checks

The verifier reports:

- submitted Talent Pool intakes and profile storage keys
- content-addressed profile storage keys, plus any non-hash source keys that
  would create duplicate raw pointers on replay
- candidate row `resume_s3_key` coverage and alignment with the current intake
  `profile_r2_key`
- GitHub, LinkedIn, portfolio, and phone-screener raw capture
- `candidate_ingestion` row/status coverage, including failed rows and
  lingering `error_text`
- candidate nodes with and without exact validated resume quotes
- artifact versions, source spans, and context source refs
- source span coordinate integrity: when an artifact has `content_text` and a
  span has character offsets, `exact_text` must match that immutable slice
- source span quote-hash integrity: `exact_text_hash` must be the SHA-256 of
  `exact_text`
- uploaded profile artifact versions whose storage key matches the current
  `talent_pool_intakes.profile_r2_key`, proving original blob capture even when
  claim extraction is still missing
- `talent_pool_profile_upload_receipt` context records whose source ref cites
  the exact current upload `artifact_version`, proving person-context provenance
  for binary/no-text upload gaps without requiring a fabricated source span
- roleless `people` / `workspace_people` projection
- accidental `applications` / `person_roles` for roleless Talent Pool members
- PR-backed ready challenge assignments vs. incomplete assignment rows and
  design-queue gaps
- source-less positive person claims
- source-less design-queue repo-family suggestions for unextracted document
  uploads
- duplicate person-projected context edges
- duplicate active candidate-node evidence groups
- source-anchor conflicts where multiple structured resume facts point at the
  same exact quote offsets

Pasted profile text and decoded text uploads create a roleless
`talent_pool_profile_intake` context record backed by the exact submitted text
source span when the context-record schema is present. This context record only
proves that profile evidence was submitted; it does not claim skills,
seniority, readiness, or match quality.

The same submitted profile text also creates one idempotent
`TalentPoolProfileIntake` candidate node with a validated exact source quote and
the source span id in `source_reference`. This compatibility node is a durable
profile-evidence marker for graph consumers; richer skill, project, experience,
and match signals still require source-backed resume decomposition.
The audit checks this projection per submitted candidate, not only as an
aggregate count, so a candidate with many exact-source nodes cannot mask another
submitted candidate with no exact-source candidate-node projection.

Pasted profile text and uploaded profile files use content-hash storage keys,
so replaying the same source reuses the same source artifact path. Each upload
also creates an
idempotent roleless person `profile_upload` artifact version for the original
blob with storage key, content hash, media type, byte length, and filename.
Pasted profile text is also written to the private Talent Pool R2 source path,
and pasted/uploaded profile objects carry private `talent_pool_intake`,
candidate, and source-kind metadata for raw evidence inventory. The source kind
keeps pasted profile text and uploaded files distinct even when both use
content-hash `talent-intake/<candidate>/<sha>-...` keys.
This artifact is source inventory only: if no exact text can be extracted, it
must not create a source span, context record, candidate node, skill, readiness
claim, or repo-family suggestion. The only positive context record allowed for
an unextractable file is the upload receipt itself:
`talent_pool_profile_upload_receipt` with a `source_ref_type: artifact_version`
ref to the raw upload version. PDF/DOCX extraction still runs in background
resume ingestion when foreground extraction is unavailable, but the upload route
does not queue a doomed background parser after foreground extraction already
proved the file has no usable source text; `candidate_ingestion.current_step`
stays as the pending `profile_text_extraction_needed` gap. When foreground text
extraction succeeds, the profile text artifact version stores the uploaded
profile storage key so source spans can be checked against the current file.
Scheduled Talent Pool repair also treats missing `profile_upload` receipts as
repairable projection state. For content-hash upload keys shaped like
`talent-intake/<candidate>/<sha256>-<filename>`, it can fetch the existing R2
object, compute the immutable byte hash/length/media type, and call the same
roleless person projection path with `sourceArtifact`. It skips pasted text
intakes, including synthetic `<sha>-profile.txt` text keys without storage-key
source spans, and skips any storage key that already has a profile-upload
receipt, so cron/backfill replay does not duplicate artifact versions or person
edges or invent file-upload evidence from a form paste.
The same scheduled repair also replays text-like current profile R2 objects
through `ensureRolelessTalentPoolIdentity` with `messageStorageKey` set to
`talent_pool_intakes.profile_r2_key`. That refreshes historical pasted/text
profile nodes and person context records onto the current immutable source span.
After identity replay, repair runs `repairCandidateResumeNodeSourceRefs` and
`repairCandidateProfileIntakeNodeSourceRefs` so validated exact resume nodes and
Talent Pool profile-receipt nodes can attach `source_span:<id>` refs to the
current profile source instead of staying source-less or stale. Document blobs
are not treated as text-profile claims by this repair; PDF/DOCX evidence still
requires successful extraction.
The scheduled repair batch orders candidates with missing resume source-span
refs or stale profile source spans ahead of already-clean recent submissions, so
unscoped audit debt burns down before cron spends work on healthy intakes.
Before R2-backed identity replay, cron also runs a bounded D1-only repair over
candidate nodes whose current profile artifact already has a covering source
span. This is projection repair, not source creation: the raw artifact version
and source span must already exist, and the repair only writes or refreshes the
`source_span:<id>` reference plus `source_span_id` property on validated exact
resume nodes and `talent_pool_profile_intake` receipt nodes.
Operators can run the same projection repair deliberately with
`npm run candidate-ingestion:repair-source-refs -- --local|--remote`. Use
`--dry-run` first to count repairable rows. The command reports bounded
before/after repairable counts with `--count-limit` and is safe to repeat
because repaired nodes leave the repairable set.
For broad health checks on large remote D1 databases, unscoped
`candidate-ingestion:audit` also supports `--limit <count>`. The limit selects
the most recent Talent Pool candidates into the audited cohort and then runs the
same source-proof, projection, duplicate-edge, and source-less-claim checks
inside that cohort. The report records the limit in `scope.candidateLimit`, so a
bounded audit must be read as a windowed proof, not whole-database completion.
Background projection receives the roleless Talent Pool person identity and
background decomposition runs with legacy candidate-node mirroring disabled, so
it must not create `applications` or `person_roles` before a role-backed process
exists. Async profile ingestion also re-runs the roleless bridge cleanup after
background text/document processing, so any legacy application bridge minted by
shared ingestion code is removed before recruiter/person reads can treat the
Talent Pool member as a role-backed applicant. Parser-only resume nodes without
exact source quotes are skipped instead of becoming positive candidate claims.
If a PDF/DOCX upload is stored but no extractable source text is available yet,
the design queue must stay in an explicit missing-evidence state: candidate
summary says no extractable source text was available, suggested repo families
are empty, and the next desired signal is source-backed profile/resume
extraction. Placeholder upload labels must not become profile claims or generic
challenge-selection hints. The audit fails any active design-queue row that
still has repo-family suggestions for a current PDF/DOCX profile key with no
extracted source spans.
Candidate discovery tries the small current Workers AI
`llama-3.2-3b-instruct` model with a tight JSON output budget before heavier
fallback models. Shared `CLOUDFLARE_AI_MODEL` overrides are late fallback
models, not candidate-specific primaries; only `CANDIDATE_AGENT_*` settings can
lead candidate discovery. Timeout, empty-output, and JSON-contract failures are
retryable from the original source. Talent Pool document retries use a bounded
two-attempt AI budget before falling back to source-only evidence. Document
retries reuse pre-extracted text and bounded parser-only decomposition so the AI
attempt can start inside the Worker background window. The fallback is allowed
to keep ingestion moving, but the event stream must state whether AI started,
succeeded, or failed instead of fabricating an AI-derived profile.
Live Talent Pool pasted-text and extracted-text upload ingestion use the same
bounded, source-backed decomposition knobs before candidate discovery, avoiding
full candidate-node embedding fan-out inside the Worker background window.
Replaying submitted profile evidence may refresh source URLs and clear stale
errors, but it must preserve successful `candidate_ingestion.current_step`
values for candidates already at `embedded`, `enriched`, or `matched` so audits
do not present completed evidence as newly received.
Scheduled retry throughput defaults conservatively, while dev can raise it with
`CANDIDATE_INGESTION_RETRY_LIMIT` to burn down stale AI-output failures without
changing production behavior.
Recruiter-owned pipeline repair can also be triggered deliberately with
`POST /api/v1/pipelines/:pipelineId/ingestion/retry-failed`. The route only
selects candidates in the authenticated recruiter's pipeline with an original
`resume_s3_key`, then replays missing, failed, or stale ingestion from that R2
source. It must not synthesize profiles for rows whose source evidence is
missing.

Resume decomposition disambiguates repeated titles or labels by anchoring the
selected source quote near the matching company, project, institution, or other
structured context; repeated labels must not all cite the first matching text
span in the profile.
Scheduled living-context backfill must also skip roleless Talent Pool intake
candidates; if an older job already fabricated a legacy application/person-role
bridge, roleless identity repair detaches interaction/context rows from that
application and removes the synthetic bridge.

GitHub, LinkedIn, portfolio, phone-screener consent, phone number, timezone, and
availability fields are stored as a normalized operational intake artifact with
one exact source span per submitted field. The projected
`talent_pool_external_profile_ref` and `talent_pool_phone_screener_intent`
records are operational evidence only; they do not validate the external
profile content or derive skills/readiness. The audit verifies those projections
by raw field predicate, source refs, and exact submitted field text, so a
duplicate GitHub context record or stale source span cannot mask a missing or
wrong LinkedIn, portfolio, or phone-screener intent projection.

By default, the command fails on an unscoped run with no Talent Pool candidates,
missing scoped candidates, submitted intakes without storage or ingestion state,
candidate rows whose `resume_s3_key` is missing or stale relative to the current
intake profile key, profile storage keys that are not content-addressed,
`candidate_ingestion` rows that are failed or still carry `error_text`, missing
active Talent Pool person projection, missing exact source proof, missing
exact-source candidate-node projection, PDF/DOCX profile storage keys without
extracted source spans, raw external refs or phone intent without operational
context records, operational context source refs that do not cite the exact
submitted field text, source-less positive claims, duplicate projected edges,
candidate nodes with no exact source quote, exact candidate nodes whose source
span is missing or does not belong to the current Talent Pool profile source,
source spans whose exact text no longer matches their immutable artifact text
slice or exact-text hash,
duplicate active candidate-node evidence, candidate-node source anchor
conflicts, or roleless application/person-role rows.

Challenge assignment rows only count as ready when they have `github_repo_url`,
`github_pr_number`, and a materializable production-ready
`review_challenge_packets` row whose repo context record carries
`repo_source_span` source refs and concept links. Assignment rows without repo/PR
metadata are reported as incomplete setup gaps; PR-backed rows without packet
provenance are reported as unproven assignment gaps. Neither state may drive
Talent Pool `CHALLENGE_READY`.

Use `--require-context-records` when the proof must include claim-level person
context records, not only roleless identity plus immutable source spans.

## Proof Commands

```bash
cd workers/api
npm run candidate-ingestion:audit -- --local
npm run candidate-ingestion:audit -- --local --limit 5
npm run candidate-ingestion:audit -- --local --invite-token <token>
npm run candidate-ingestion:audit -- --local --candidate-id <candidate_id>
npm run candidate-ingestion:audit -- --local --email <email>
npm run candidate-ingestion:audit -- --local --invite-token <token> --require-context-records
npm run candidate-ingestion:audit -- --remote --invite-token <token>
npm run candidate-ingestion:audit -- --remote --limit 5
npm run candidate-ingestion:repair-source-refs -- --local --dry-run
npm run candidate-ingestion:repair-source-refs -- --remote --dry-run --count-limit 500
npm test -- src/lib/__tests__/talentPoolIdentity.test.ts
npm test -- src/routes/__tests__/talentPool.test.ts src/lib/candidateDiscovery/__tests__/staleWorkersAiRetry.test.ts
npm test -- src/lib/livingContext/__tests__/compatibility.test.ts src/lib/livingContext/__tests__/candidateComparison.test.ts src/lib/livingContext/__tests__/evidenceReadiness.test.ts src/lib/livingContext/__tests__/matchConfidenceScoring.test.ts
npm test -- src/lib/candidateDiscovery/__tests__/candidateNodes.test.ts src/lib/candidateDiscovery/__tests__/resumeDecomposition.test.ts scripts/auditCandidateIngestion.test.ts
npm test -- scripts/repairTalentPoolSourceRefs.test.ts
npm test -- src/routes/cockpit/__tests__/contacts.rest.test.ts src/routes/cockpit/__tests__/candidates.rest.test.ts src/lib/livingContext/__tests__/readModel.test.ts
npx playwright test e2e/talent-pool-intake.unauth.spec.ts --project=unauthenticated --reporter=line
npm run smoke:talent-pool-browser-dev
npm run smoke:talent-pool-browser-upload-dev
npm run smoke:talent-pool-browser-docx-dev
npm run smoke:talent-pool-browser-pdf-dev
npm run smoke:talent-pool-browser-pdf-gap-dev
npm run smoke:talent-pool-ingestion-dev
npm run smoke:talent-pool-upload-dev
npm run smoke:talent-pool-docx-dev
npm run smoke:talent-pool-pdf-dev
npm run smoke:talent-pool-pdf-gap-dev
```

For app-dev, prefix remote proof commands with the dev D1 id:

```bash
CLOUDFLARE_D1_DATABASE_ID=0abe92df-9296-46f5-9f9d-a1fb1bcd3be1 \
  npm run candidate-ingestion:audit -- --remote --invite-token <token>
CLOUDFLARE_D1_DATABASE_ID=0abe92df-9296-46f5-9f9d-a1fb1bcd3be1 \
  npm run candidate-ingestion:audit -- --remote --invite-token <token> --require-context-records
CLOUDFLARE_D1_DATABASE_ID=0abe92df-9296-46f5-9f9d-a1fb1bcd3be1 \
  npm run candidate-ingestion:audit -- --remote --limit 5 --require-context-records
CLOUDFLARE_D1_DATABASE_ID=0abe92df-9296-46f5-9f9d-a1fb1bcd3be1 \
  npm run candidate-ingestion:repair-source-refs -- --remote --dry-run --count-limit 500
```

The packaged dev smoke commands default Talent Pool RPC submission to the
app-dev proxy when no API base override is set. `smoke:talent-pool-browser-dev`
and the `smoke:talent-pool-browser-*-dev` upload commands go one step further:
they create a real dev Talent Pool candidate, open the public `/talent/:token`
page in Chromium, submit pasted profile evidence, a text profile upload, a DOCX
upload, an extractable PDF upload, or an unextractable PDF through the form,
then reuse the same remote
audit and recruiter/person read proofs. After the audit identifies the current
`talent_pool_intakes.profile_r2_key`, the smokes also fetch that exact R2 object
with Wrangler and compare its bytes to the submitted source. The fetched
SHA-256 must match both the submitted source bytes and the content-addressed
storage-key prefix. Browser upload smokes require the upload receipt artifact
count to be present; the browser DOCX and extractable-PDF smokes also require a
document source span, while the browser PDF-gap smoke requires the explicit
`profile_text_extraction_needed` gap with no source-less claims. If a caller
explicitly targets `api-dev.hire-pipe.com`, direct RPC smokes omit dev HTTP
Basic Auth for that API host while still using Basic Auth for app-dev candidate
creation. This keeps the proof path close to candidate traffic but still allows
direct API probes. The smokes infer the remote D1 database name/id and R2 bucket
from the target app/API environment, so app-dev proofs audit the dev D1 database
and `pipe-assets-test` bucket unless explicit `--d1-database`,
`--d1-database-id`, `--r2-bucket`, `TALENT_POOL_SMOKE_D1_DATABASE`,
`TALENT_POOL_SMOKE_D1_DATABASE_ID`, or `TALENT_POOL_SMOKE_R2_BUCKET` overrides
are provided.
After the ingestion audit reports ready, the smokes also verify recruiter reads
unless `--skip-recruiter-reads` is passed: candidate living-context graph,
unified People list, candidate source search, candidate evidence-depth, person
source search, person evidence timeline, and person evidence-depth must all
resolve the same canonical `workspace_people` projection and return the submitted
exact source text. Ready smokes also require both the candidate graph and the
canonical person graph to expose a `talent_pool_profile_intake` context record
with a `source_span` ref whose exact text contains the submitted profile source.
Ready smokes also require
`submittedIntakeWithoutExactCandidateNodeCount` to be zero.
`smoke:talent-pool-pdf-gap-dev` is intentionally different:
it uploads an unextractable PDF and expects the audit to remain `not_ready`
while proving raw blob capture, the profile-upload receipt, roleless person
projection, zero source-less positive claims, zero source-less design suggestions,
zero duplicate projected edges, no failed `candidate_ingestion` state, and no
candidate-node projection from invite/upload placeholders. It also requires
`documentProfileExtractionGapCount: 1`,
`documentProfileMissingExtractionProofCount: 0`,
`profileUploadReceiptContextCount: 1`,
`submittedIntakeWithoutExactCandidateNodeCount: 0`, and the scoped
`candidate_ingestion.current_step` to be `profile_text_extraction_needed`.
Scheduled Talent Pool repair applies the same rule to historical unextractable
PDF/DOCX rows: a failed `parse_resume` row whose current profile key is a
Talent Pool document upload is normalized to `profile_text_extraction_needed`
after the raw upload receipt and operational intake facts are preserved. This is
state repair only; it must not create profile candidate nodes or source spans
without extracted text.
After deploying Worker version `6f5ca36b-0e87-4c6a-978f-153e65fba319`, the
2026-07-03T20:31:37Z bounded remote audit
`CLOUDFLARE_D1_DATABASE_ID=0abe92df-9296-46f5-9f9d-a1fb1bcd3be1 npm --prefix workers/api run candidate-ingestion:audit -- --remote --limit 5 --require-context-records`
reported `failedRowCount: 0`, `errorTextRowCount: 0`,
`sourceLessPositiveClaimCount: 0`, `duplicateProjectedEdgeCount: 0`,
`submittedIntakeWithoutExactCandidateNodeCount: 0`,
`documentProfileExtractionGapCount: 4`,
`documentProfileMissingExtractionProofCount: 0`, and
`profileUploadReceiptContextCount: 4`. The window remains `not_ready` only
because four PDF/DOCX uploads correctly stay at
`profile_text_extraction_needed` receipt-backed evidence gaps with no extracted
profile text.
The 2026-07-03T20:20Z `npm run smoke:talent-pool-pdf-gap-dev` scoped proof for
invite token `d8273834-9e7e-42b2-9013-17c73e0e0546` returned
`documentProfileExtractionGapCount: 1`,
`documentProfileMissingExtractionProofCount: 0`,
`profileUploadReceiptContextCount: 1`,
`submittedIntakeWithoutExactCandidateNodeCount: 0`,
`sourceLessPositiveClaimCount: 0`, and `duplicateProjectedEdgeCount: 0`.
The 2026-07-03T20:37Z `npm run smoke:talent-pool-docx-dev` scoped proof for
invite token `2f28314d-bce8-4174-9570-585c31f6dd40` returned `status: ready`,
`documentProfileSourceSpanCount: 1`, `documentProfileExtractionGapCount: 0`,
`documentProfileMissingExtractionProofCount: 0`,
`profileUploadReceiptContextCount: 1`,
`submittedIntakeWithoutExactCandidateNodeCount: 0`,
`sourceLessPositiveClaimCount: 0`, and `duplicateProjectedEdgeCount: 0`.
The source object proof showed `keyHashMatchesObject: true` and
`objectMatchesSubmittedSource: true`; recruiter reads resolved the unified
People candidate plus the canonical person living-context graph, source search,
timeline, and evidence-depth views.
The direct scoped audit command
`CLOUDFLARE_D1_DATABASE_ID=0abe92df-9296-46f5-9f9d-a1fb1bcd3be1 npm --prefix workers/api run candidate-ingestion:audit -- --remote --invite-token 2f28314d-bce8-4174-9570-585c31f6dd40 --require-context-records`
returned `status: ready`, `candidateNodeExactSourceQuoteCount: 13`,
`contextSourceRefCount: 9`, `sourceSpanTextMismatchCount: 0`,
`sourceSpanHashMismatchCount: 0`, and no failures.
After deploying Worker version `aa3ad3c5-2628-419c-99ee-c3fd853f23fd`, the
2026-07-03T20:57Z `npm run smoke:talent-pool-pdf-dev` scoped proof for invite
token `e8ef1ecf-cbc5-4045-8f8a-9ca860df3a32` returned `status: ready`,
`documentProfileStorageKeyCount: 1`, `documentProfileSourceSpanCount: 1`,
`documentProfileExtractionGapCount: 0`,
`documentProfileMissingExtractionProofCount: 0`,
`profileUploadArtifactVersionCount: 1`, `profileUploadReceiptContextCount: 1`,
`candidateNodeExactSourceQuoteCount: 13`, `contextSourceRefCount: 9`,
`sourceLessPositiveClaimCount: 0`, and `duplicateProjectedEdgeCount: 0`. The
source object proof showed `keyHashMatchesObject: true` and
`objectMatchesSubmittedSource: true`; recruiter reads resolved unified People
type `candidate`, the canonical person graph, source search, timeline, and
evidence-depth reads. The direct scoped audit command
`CLOUDFLARE_D1_DATABASE_ID=0abe92df-9296-46f5-9f9d-a1fb1bcd3be1 npm --prefix workers/api run candidate-ingestion:audit -- --remote --invite-token e8ef1ecf-cbc5-4045-8f8a-9ca860df3a32 --require-context-records`
returned `ingestionState.statuses: embedded`, `candidateNodeSourceSpanMissingCount: 0`,
`sourceSpanTextMismatchCount: 0`, `sourceSpanHashMismatchCount: 0`, and no
failures.

Current app-dev HEAD check on 2026-07-02 local time, checked at
2026-07-03T01:25Z through 2026-07-03T01:27Z, ran after deploying Worker version
`ad6c6c92-8aff-43ee-9231-2b1ac43860e9`:

- `npm run smoke:talent-pool-ingestion-dev` submitted pasted profile text for
  invite token `da35092e-b422-45fa-8ed9-1a9d88a7efeb` and returned
  `status: ready`, `contentAddressedProfileStorageKeyCount: 1`,
  `nonContentAddressedProfileStorageKeyCount: 0`,
  `candidateNodeExactSourceQuoteCount: 13`,
  `submittedIntakeWithoutExactCandidateNodeCount: 0`,
  `sourceLessPositiveClaimCount: 0`, `sourceLessDesignQueueSuggestionCount: 0`,
  and `duplicateProjectedEdgeCount: 0`. Recruiter reads resolved unified People
  type `candidate`, found candidate/person source text, returned 8 timeline
  entries, and reported 9 source spans plus 5 context records.
- `npm run smoke:talent-pool-upload-dev` submitted a multipart text profile for
  invite token `57ee8bf4-10d4-484d-b69f-21f24f70f6c8` and returned
  `status: ready`, `contentAddressedProfileStorageKeyCount: 1`,
  `nonContentAddressedProfileStorageKeyCount: 0`,
  `profileUploadArtifactVersionCount: 1`,
  `submittedIntakeWithoutExactCandidateNodeCount: 0`,
  `sourceLessPositiveClaimCount: 0`, `sourceLessDesignQueueSuggestionCount: 0`,
  and `duplicateProjectedEdgeCount: 0`. Recruiter reads resolved unified People
  type `candidate`, found candidate/person source text, returned 9 timeline
  entries, and reported 9 source spans plus 5 context records.
- `npm run smoke:talent-pool-docx-dev` submitted a multipart DOCX profile for
  invite token `2e5098f1-17bb-42bd-845f-4a6a441afbfd` and returned
  `status: ready`, `contentAddressedProfileStorageKeyCount: 1`,
  `nonContentAddressedProfileStorageKeyCount: 0`,
  `documentProfileSourceSpanCount: 1`,
  `profileUploadArtifactVersionCount: 1`,
  `submittedIntakeWithoutExactCandidateNodeCount: 0`,
  `sourceLessPositiveClaimCount: 0`, `sourceLessDesignQueueSuggestionCount: 0`,
  and `duplicateProjectedEdgeCount: 0`. Recruiter reads resolved unified People
  type `candidate`, found candidate/person source text, returned 9 timeline
  entries, and reported 9 source spans plus 5 context records.
- `npm run smoke:talent-pool-pdf-gap-dev` submitted an intentionally invalid
  PDF for invite token `55334e3f-616e-4451-8d78-1b8d291db338` and returned
  `status: not_ready`, `ingestionSteps:
  [{currentStep: "profile_text_extraction_needed", count: 1}]`,
  `contentAddressedProfileStorageKeyCount: 1`,
  `nonContentAddressedProfileStorageKeyCount: 0`,
  `profileUploadArtifactVersionCount: 1`,
  `submittedIntakeWithoutExactCandidateNodeCount: 1`,
  `sourceLessPositiveClaimCount: 0`, `sourceLessDesignQueueSuggestionCount: 0`,
  and `duplicateProjectedEdgeCount: 0`.

Current app-dev HEAD check on 2026-07-02 local time, checked at
2026-07-03T00:47Z, ran after deploying Worker version
`8ce0c586-76d2-4ab8-8a16-905b8aa94c16`:

- `npm run smoke:talent-pool-ingestion-dev` submitted pasted profile text for
  invite token `fadeb8ae-b0b1-4168-a12c-8977065028d6` and returned
  `status: ready`, `candidateNodeExactSourceQuoteCount: 13`,
  `submittedIntakeWithoutExactCandidateNodeCount: 0`,
  `sourceLessPositiveClaimCount: 0`, `sourceLessDesignQueueSuggestionCount: 0`,
  and `duplicateProjectedEdgeCount: 0`. Recruiter reads resolved unified People
  type `candidate`, found candidate/person source text, returned 8 timeline
  entries, and reported 9 source spans plus 5 context records.
- `npm run smoke:talent-pool-upload-dev` submitted a multipart text profile for
  invite token `44f1f9c8-91f2-4bf4-b71d-7de01620734f` and returned
  `status: ready`, `profileUploadArtifactVersionCount: 1`,
  `submittedIntakeWithoutExactCandidateNodeCount: 0`,
  `sourceLessPositiveClaimCount: 0`, `sourceLessDesignQueueSuggestionCount: 0`,
  and `duplicateProjectedEdgeCount: 0`. Recruiter reads resolved unified People
  type `candidate`, found candidate/person source text, returned 9 timeline
  entries, and reported 9 source spans plus 5 context records.
- `npm run smoke:talent-pool-docx-dev` submitted a multipart DOCX profile for
  invite token `b8958ae6-c377-4230-b685-f3b4386f78a3` and returned
  `status: ready`, `documentProfileSourceSpanCount: 1`,
  `profileUploadArtifactVersionCount: 1`,
  `submittedIntakeWithoutExactCandidateNodeCount: 0`,
  `sourceLessPositiveClaimCount: 0`, `sourceLessDesignQueueSuggestionCount: 0`,
  and `duplicateProjectedEdgeCount: 0`. Recruiter reads resolved unified People
  type `candidate`, found candidate/person source text, returned 9 timeline
  entries, and reported 9 source spans plus 5 context records.
- `npm run smoke:talent-pool-pdf-gap-dev` submitted an intentionally invalid
  PDF for invite token `b91d808c-fc9f-42f9-80f0-be2e61869fcc` and returned
  `status: not_ready`, `ingestionSteps:
  [{currentStep: "profile_text_extraction_needed", count: 1}]`,
  `profileUploadArtifactVersionCount: 1`,
  `submittedIntakeWithoutExactCandidateNodeCount: 1`,
  `sourceLessPositiveClaimCount: 0`, `sourceLessDesignQueueSuggestionCount: 0`,
  and `duplicateProjectedEdgeCount: 0`.

Latest app-dev all-mode proof on 2026-07-02 local time, checked at
2026-07-03T00:41Z through 2026-07-03T00:44Z, ran after a clean HEAD deploy of
Worker version `b35f6fff-cd35-4d6b-afae-96ea15c59c15`:

- `npm run smoke:talent-pool-ingestion-dev` submitted pasted profile text for
  invite token `c178f84e-3e51-4615-89e0-48ad8f4a1c92` and returned
  `status: ready`, `candidateNodeExactSourceQuoteCount: 13`,
  `submittedIntakeWithoutExactCandidateNodeCount: 0`,
  `sourceLessPositiveClaimCount: 0`, `sourceLessDesignQueueSuggestionCount: 0`,
  and `duplicateProjectedEdgeCount: 0`.
- `npm run smoke:talent-pool-upload-dev` submitted a multipart text profile for
  invite token `42b77800-1c86-47fb-a706-079fd6a9fda0` and returned
  `status: ready`, `profileUploadArtifactVersionCount: 1`,
  `submittedIntakeWithoutExactCandidateNodeCount: 0`,
  `sourceLessPositiveClaimCount: 0`, `sourceLessDesignQueueSuggestionCount: 0`,
  and `duplicateProjectedEdgeCount: 0`.
- `npm run smoke:talent-pool-docx-dev` submitted a multipart DOCX profile for
  invite token `68fa2bce-5292-458c-9099-6fcf299e5fb8` and returned
  `status: ready`, `documentProfileSourceSpanCount: 1`,
  `profileUploadArtifactVersionCount: 1`,
  `submittedIntakeWithoutExactCandidateNodeCount: 0`,
  `sourceLessPositiveClaimCount: 0`, `sourceLessDesignQueueSuggestionCount: 0`,
  and `duplicateProjectedEdgeCount: 0`.
- `npm run smoke:talent-pool-pdf-gap-dev` submitted an intentionally invalid
  PDF for invite token `ea58c041-cf56-4786-a60d-82fedca6591c` and returned
  `status: not_ready`, `ingestionSteps:
  [{currentStep: "profile_text_extraction_needed", count: 1}]`,
  `profileUploadArtifactVersionCount: 1`,
  `submittedIntakeWithoutExactCandidateNodeCount: 1`,
  `sourceLessPositiveClaimCount: 0`, `sourceLessDesignQueueSuggestionCount: 0`,
  and `duplicateProjectedEdgeCount: 0`.

Latest app-dev all-mode bounded proof on 2026-07-02 local time, checked at
2026-07-03T00:05Z and 2026-07-03T00:06Z, ran after deploying Worker version
`c0df3dcb-d5e9-4c54-bb79-271ec8f04c20`:

- `npm run smoke:talent-pool-ingestion-dev` submitted pasted profile text for
  invite token `a9d07221-846e-4410-8d12-92a94bff9a74` and returned
  `status: ready`, `ingestionSteps: [{currentStep: "embed_profile", count: 1}]`,
  `candidateNodeExactSourceQuoteCount: 13`, `contextSourceRefCount: 8`,
  `talentPoolWorkspacePersonCount: 1`, `sourceLessPositiveClaimCount: 0`,
  `sourceLessDesignQueueSuggestionCount: 0`, and
  `duplicateProjectedEdgeCount: 0`. Recruiter reads resolved unified People type
  `candidate`, found the candidate/person source text, returned 8 timeline
  entries, and reported 9 source spans plus 5 context records.
- `npm run smoke:talent-pool-upload-dev` submitted a multipart text profile for
  invite token `11cded20-d4c5-4121-a788-867da3e2e46d` and returned
  `status: ready`, `ingestionSteps: [{currentStep: "embed_profile", count: 1}]`,
  `candidateNodeExactSourceQuoteCount: 13`, `contextSourceRefCount: 8`,
  `profileUploadArtifactVersionCount: 1`, `talentPoolWorkspacePersonCount: 1`,
  `sourceLessPositiveClaimCount: 0`, `sourceLessDesignQueueSuggestionCount: 0`,
  and `duplicateProjectedEdgeCount: 0`. Recruiter reads resolved the same
  roleless person projection and reported 9 source spans plus 5 context records.
- `npm run smoke:talent-pool-docx-dev` submitted a multipart DOCX profile for
  invite token `d05f3121-add6-4d7f-a500-f41513ea67d9` and returned
  `status: ready`, `ingestionSteps: [{currentStep: "embed_profile", count: 1}]`,
  `candidateNodeExactSourceQuoteCount: 13`, `contextSourceRefCount: 8`,
  `documentProfileSourceSpanCount: 1`, `profileUploadArtifactVersionCount: 1`,
  `talentPoolWorkspacePersonCount: 1`, `sourceLessPositiveClaimCount: 0`,
  `sourceLessDesignQueueSuggestionCount: 0`, and
  `duplicateProjectedEdgeCount: 0`. Recruiter reads resolved unified People type
  `candidate`, found the uploaded DOCX source text, returned 9 timeline entries,
  and reported 9 source spans plus 5 context records.
- `npm run smoke:talent-pool-pdf-gap-dev` submitted an intentionally invalid
  PDF for invite token `12400ab2-1ca7-4be4-8257-b515da8db476` and returned
  `status: not_ready`, `ingestionSteps:
  [{currentStep: "profile_text_extraction_needed", count: 1}]`,
  `documentProfileStorageKeyCount: 1`, `profileUploadArtifactVersionCount: 1`,
  `candidateNodeCount: 0`, `contextSourceRefCount: 7`,
  `talentPoolWorkspacePersonCount: 1`, `designQueueCount: 1`,
  `sourceLessPositiveClaimCount: 0`, `sourceLessDesignQueueSuggestionCount: 0`,
  and `duplicateProjectedEdgeCount: 0`.

Prior bounded live text-ingestion proof on 2026-07-02 local time, checked at
2026-07-03T00:04Z, ran after deploying Worker version
`3fffc61b-d725-40ed-ba88-3fbf71a08a6b`:

- `npm run smoke:talent-pool-ingestion-dev` submitted pasted profile text for
  invite token `6a3a7bb7-4fe3-44eb-8471-39d762cf7815` and returned
  `status: ready`, `ingestionSteps: [{currentStep: "discover_profile", count:
  1}]`, `candidateNodeExactSourceQuoteCount: 13`, `contextSourceRefCount: 8`,
  `talentPoolWorkspacePersonCount: 1`, `sourceLessPositiveClaimCount: 0`,
  `sourceLessDesignQueueSuggestionCount: 0`, and `duplicateProjectedEdgeCount:
  0`. A follow-up D1 query showed the same candidate reached `status:
  embedded`, `current_step: embed_profile`, `profile_version: candidate-v3`,
  and `model_used: workers-ai/@cf/meta/llama-3.2-3b-instruct` with no
  `error_text`.

Prior app-dev smoke proof on 2026-07-02 local time, checked at
2026-07-03T00:00Z, ran after deploying Worker version
`150bdeda-e131-45b8-a2e0-10ddedf00535`:

- `npm run smoke:talent-pool-ingestion-dev` submitted pasted profile text for
  invite token `2ac49c8d-8575-44ec-acda-b816de12b905` and returned
  `status: ready`, `candidateNodeExactSourceQuoteCount: 56`,
  `contextSourceRefCount: 8`, `talentPoolWorkspacePersonCount: 1`,
  `sourceLessPositiveClaimCount: 0`, `sourceLessDesignQueueSuggestionCount: 0`,
  and `duplicateProjectedEdgeCount: 0`. Recruiter reads resolved unified People
  type `candidate`, found the candidate/person source text, returned 8 timeline
  entries, and reported 9 source spans plus 5 context records.
- `npm run smoke:talent-pool-upload-dev` submitted a multipart text profile for
  invite token `f9132def-fcbd-4626-b9d7-ca3b7e34c1ba` and returned
  `status: ready`, `candidateNodeExactSourceQuoteCount: 45`,
  `contextSourceRefCount: 8`, `profileUploadArtifactVersionCount: 1`,
  `talentPoolWorkspacePersonCount: 1`, `sourceLessPositiveClaimCount: 0`,
  `sourceLessDesignQueueSuggestionCount: 0`, and
  `duplicateProjectedEdgeCount: 0`. Recruiter reads resolved the same roleless
  person projection and reported 9 source spans plus 5 context records.
- `npm run smoke:talent-pool-docx-dev` submitted a multipart DOCX profile for
  invite token `dd5c6d3c-a043-46ae-b93c-ccc8b375d0f6` and returned
  `status: ready`, `candidateNodeExactSourceQuoteCount: 52`,
  `contextSourceRefCount: 8`, `documentProfileSourceSpanCount: 1`,
  `profileUploadArtifactVersionCount: 1`, `talentPoolWorkspacePersonCount: 1`,
  `sourceLessPositiveClaimCount: 0`, `sourceLessDesignQueueSuggestionCount: 0`,
  and `duplicateProjectedEdgeCount: 0`. Recruiter reads resolved unified People
  type `candidate`, found the uploaded DOCX source text, returned 9 timeline
  entries, and reported 9 source spans plus 5 context records.
- `npm run smoke:talent-pool-pdf-gap-dev` submitted an intentionally invalid
  PDF for invite token `0987f042-192b-4442-8b40-878b92198882` and returned
  `status: not_ready`, `ingestionSteps:
  [{currentStep: "profile_text_extraction_needed", count: 1}]`,
  `documentProfileStorageKeyCount: 1`, `profileUploadArtifactVersionCount: 1`,
  `candidateNodeCount: 0`, `contextSourceRefCount: 7`,
  `talentPoolWorkspacePersonCount: 1`, `designQueueCount: 1`,
  `sourceLessPositiveClaimCount: 0`, `sourceLessDesignQueueSuggestionCount: 0`,
  and `duplicateProjectedEdgeCount: 0`. The same guard was also verified
  directly against `api-dev.hire-pipe.com` with invite token
  `69edccb0-2677-4b6e-894f-56fa93d33842`.

Historical app-dev profile-upload repair proof on 2026-07-02 used invite token
`talent-audit-532e4287e-c1` after deploying Worker version
`11303318-b79f-451b-93c9-ab1ec4eb4616`, which includes canonical person-id
source search, evidence timeline, evidence-depth reads for unified People rows,
and packet-provenance gating for Talent Pool challenge readiness. The scheduled
Talent Pool repair had replayed the existing profile-upload R2 object against
dev D1.
The remote verifier returned `status: ready`,
`candidateNodeCount: 74`, `candidateNodeExactSourceQuoteCount: 74`,
`candidateNodeWithoutExactSourceCount: 0`,
`duplicateCandidateNodeEvidenceCount: 0`,
`candidateNodeSourceAnchorConflictCount: 0`,
`candidateResumeStorageKeyCount: 1`, `candidateResumeMatchesIntakeCount: 1`,
`failedRowCount: 0`, `errorTextRowCount: 0`,
`artifactVersionCount: 12`, `sourceSpanCount: 37`,
`sourceSpanTextMismatchCount: 0`, `sourceSpanHashMismatchCount: 0`,
`documentProfileSourceSpanCount: 4`, `contextRecordCount: 80`,
`profileUploadArtifactVersionCount: 1`,
`contextSourceRefCount: 83`,
`externalProfileRefContextCount: 3`,
`phoneScreenerIntentContextCount: 1`, `rolelessApplicationCount: 0`,
`rolelessPersonRoleCount: 0`, `signalEvidenceCount: 240`,
`readyChallengeAssignmentCount: 0`, `unprovenChallengeAssignmentCount: 0`,
`incompleteChallengeAssignmentCount: 0`, `designQueueCount: 1`,
`sourceLessPositiveClaimCount: 0`, `sourceLessDesignQueueSuggestionCount: 0`,
and `duplicateProjectedEdgeCount: 0`.

The same remote D1 proof counted exactly one `profile_upload` receipt for
`talent-intake/talent_audit_532e4287e_c1/9d990a07be4b85fe2907eca11f2a378669d5b03c0131dd506470922e894070f1-test-resume.pdf`,
showing the scheduled repair backfilled the historical upload without adding
source-less claims or duplicate person/context edges.

Live app-dev submit proof on 2026-07-02 used
`npm run smoke:talent-pool-ingestion-dev` with app-dev Basic auth and dev D1
credentials. The smoke created a standalone roleless Talent Pool candidate,
resolved invite token `bd7829ab-b071-49c0-9284-d6d0fd59775f` after deploying
Worker version `9da26c65-e388-42ae-aa44-184e6e15121e`, submitted pasted profile
evidence through `/rpc/talent/submit-profile`, verified the public dashboard
stayed `CHALLENGE_PREPARING` with no ready challenges, then polled
`candidate-ingestion:audit -- --remote --require-context-records`. The audit
returned `status: ready`, `candidateNodeExactSourceQuoteCount: 52`,
`contextSourceRefCount: 9`, `profileUploadArtifactVersionCount: 0`,
`talentPoolWorkspacePersonCount: 1`, `sourceLessPositiveClaimCount: 0`, and
`duplicateProjectedEdgeCount: 0`.

Live app-dev upload proof on 2026-07-02 used
`npm run smoke:talent-pool-upload-dev` against the same Worker version. The
smoke created a standalone roleless Talent Pool candidate, resolved invite token
`7e740609-6aac-41f5-a5c9-bdc60ba278bd`, submitted a multipart plain-text profile
through `/rpc/talent/upload-profile`, and polled the remote audit with
`--require-context-records`. The audit returned `status: ready`,
`candidateNodeExactSourceQuoteCount: 58`, `contextSourceRefCount: 8`,
`profileUploadArtifactVersionCount: 1`, `talentPoolWorkspacePersonCount: 1`,
`sourceLessPositiveClaimCount: 0`, and `duplicateProjectedEdgeCount: 0`.

Live app-dev DOCX upload proof on 2026-07-02 used
`npm run smoke:talent-pool-docx-dev` against the same Worker version. The smoke
created a standalone roleless Talent Pool candidate through app-dev, resolved
invite token `9bd66f0d-7839-48d5-93f8-a46365d35908`, submitted a multipart DOCX
profile through the app-dev `/rpc/talent/upload-profile` proxy, and required the
remote audit to see both the original upload receipt and extracted document
source span. The audit returned `status: ready`,
`candidateNodeExactSourceQuoteCount: 65`,
`contextSourceRefCount: 9`, `documentProfileSourceSpanCount: 1`,
`profileUploadArtifactVersionCount: 1`, `talentPoolWorkspacePersonCount: 1`,
`sourceLessPositiveClaimCount: 0`, and `duplicateProjectedEdgeCount: 0`.
The same smoke proved recruiter reads against
`person_a33d00a269b443de2ffd1025474393ac` /
`workspace_person_7245884061f14c1bcbb109e92699e849`: unified People type was
`candidate`, candidate and person source search each returned the exact DOCX
source text, the person timeline returned 10 entries, and person evidence-depth
reported 9 source spans and 6 context records.

Live app-dev unextractable PDF gap proof on 2026-07-02 used
`npm run smoke:talent-pool-pdf-gap-dev` after deploying Worker version
`96ea61a4-0387-42e2-b9a3-0d2259cc387a`. The smoke created a standalone roleless
Talent Pool candidate through app-dev, resolved invite token
`becb7e1e-50db-4667-b865-208faf1558ef`, submitted an intentionally invalid PDF
through `/rpc/talent/upload-profile`, and required the remote audit to remain an
explicit extraction gap instead of a failed ingestion row. The audit returned
`status: not_ready`, `documentProfileStorageKeyCount: 1`,
`profileUploadArtifactVersionCount: 1`, `documentProfileSourceSpanCount: 0`,
`candidateNodeCount: 0`, `candidateNodeExactSourceQuoteCount: 0`,
`contextSourceRefCount: 7`, `ingestionSteps:
[{currentStep: "profile_text_extraction_needed", count: 1}]`,
`talentPoolWorkspacePersonCount: 1`, `designQueueCount: 1`,
`sourceLessPositiveClaimCount: 0`,
`sourceLessDesignQueueSuggestionCount: 0`, and `duplicateProjectedEdgeCount: 0`.

Live app-dev browser source-object proof on 2026-07-03 used
`npm run smoke:talent-pool-browser-dev`,
`npm run smoke:talent-pool-browser-docx-dev`, and
`npm run smoke:talent-pool-browser-pdf-gap-dev`. The pasted-text smoke created
invite token `9bd22665-2659-4af4-a8b4-57a1e5912940`, submitted profile text
through the public `/talent/:token` form, and returned `status: ready`,
`candidateNodeExactSourceQuoteCount: 13`, `contextSourceRefCount: 8`,
`profileUploadArtifactVersionCount: 0`, `sourceLessPositiveClaimCount: 0`, and
`duplicateProjectedEdgeCount: 0`. It fetched the exact R2 key
`talent-intake/1a7c80f8-0416-4e92-a36e-7005f447d5fc/b71e362c0c73bf690bc6da42a8d171616fe0c760d970db3ba77845b0579b98b2-profile.txt`;
the object was 379 bytes and SHA-256
`b71e362c0c73bf690bc6da42a8d171616fe0c760d970db3ba77845b0579b98b2`, matching
both the content-addressed storage-key prefix and submitted source bytes. The
plain-text upload smoke created invite token
`2dfa07c1-d030-42e1-b77f-d68c9bf694d1`, submitted a `.txt` profile file through
the public `/talent/:token` form, and returned `status: ready`,
`candidateNodeExactSourceQuoteCount: 13`, `contextSourceRefCount: 8`,
`profileUploadArtifactVersionCount: 1`,
`externalProfileRefSourceTextMismatchCount: 0`,
`phoneScreenerIntentSourceTextMismatchCount: 0`,
`sourceLessPositiveClaimCount: 0`, and `duplicateProjectedEdgeCount: 0`. It
fetched the exact R2 key
`talent-intake/9b7a7aac-a8de-4f62-be0a-ac35a3498467/3e7a3617de681aacc93a2b5545c98c7df19989e10cc86b05c51bb51b8ef4fdcb-talent-smoke-20260703171423-ab4880e8.txt`;
the object was 379 bytes and SHA-256
`3e7a3617de681aacc93a2b5545c98c7df19989e10cc86b05c51bb51b8ef4fdcb`, matching
the storage-key prefix and submitted source bytes while preserving the upload
receipt. The DOCX smoke created invite token
`f3ca666d-a4c7-497a-b9a6-48eac885e37a`,
submitted the document through the public `/talent/:token` form, and returned
`status: ready`,
`candidateNodeExactSourceQuoteCount: 13`, `contextSourceRefCount: 8`,
`documentProfileSourceSpanCount: 1`, `profileUploadArtifactVersionCount: 1`,
`externalProfileRefSourceTextMismatchCount: 0`,
`phoneScreenerIntentSourceTextMismatchCount: 0`,
`sourceLessPositiveClaimCount: 0`, and `duplicateProjectedEdgeCount: 0`. It
fetched the exact R2 key
`talent-intake/f8edff97-d1d5-47b5-9a2d-48cf69658257/ea8594aff6a06e9392eb651d80a2b6547e406c2b243715640f1bf46523df993c-talent-smoke-20260703170044-7e47c7b4.docx`;
the object was 749 bytes and SHA-256
`ea8594aff6a06e9392eb651d80a2b6547e406c2b243715640f1bf46523df993c`, matching
both the content-addressed storage-key prefix and submitted source bytes. The
PDF-gap smoke created invite token `fe27a003-a27a-4211-8075-c7a9416a2bc8`,
submitted an unextractable PDF through the same public page, and remained
`status: not_ready` with `currentStep: profile_text_extraction_needed`,
`candidateNodeCount: 0`, `documentProfileSourceSpanCount: 0`,
`profileUploadArtifactVersionCount: 1`, `sourceLessPositiveClaimCount: 0`,
`sourceLessDesignQueueSuggestionCount: 0`, and `duplicateProjectedEdgeCount: 0`.
It fetched the exact R2 key
`talent-intake/29e0ce2c-246b-4966-9dec-7152a58497d7/32ed5017fce95db1619dfd80fe7ffe1e51ec4dfb98e43e3266d265836f6ae62b-talent-smoke-20260703170205-6df8d738.pdf`;
the object was 14 bytes and SHA-256
`32ed5017fce95db1619dfd80fe7ffe1e51ec4dfb98e43e3266d265836f6ae62b`, again
matching the storage-key prefix and submitted source bytes without deriving a
positive profile claim.

After deploying Worker version `216bfae8-96e9-44a4-902e-14eeffdfa087` on
2026-07-03, `npm run smoke:talent-pool-browser-upload-dev` created invite token
`e45ce397-501b-40de-bd41-2409f02ee70d` and submitted a plain-text profile file
through the public `/talent/:token` form. The smoke returned `status: ready`,
`candidateNodeCount: 13`, `candidateNodeExactSourceQuoteCount: 13`,
`contextSourceRefCount: 8`, `profileUploadArtifactVersionCount: 1`,
`sourceLessPositiveClaimCount: 0`, and `duplicateProjectedEdgeCount: 0`; the
recruiter/person read proof found one unified People candidate row, one
candidate source-search hit, one person source-search hit, 9 timeline entries,
9 person evidence source spans, and 5 person evidence context records. It
fetched the exact R2 key
`talent-intake/3b1352b6-f3d2-46d8-b44c-5c131903d786/a8fd506d7b6a73acd1dc1ab553f83d2eceb5afd167805292a43ba454a47098f9-talent-smoke-20260703173300-b89b5d82.txt`;
the object was 379 bytes and SHA-256
`a8fd506d7b6a73acd1dc1ab553f83d2eceb5afd167805292a43ba454a47098f9`, matching
both the content-addressed storage-key prefix and submitted source bytes. A
direct remote dev D1 audit using
`CLOUDFLARE_D1_DATABASE_ID=0abe92df-9296-46f5-9f9d-a1fb1bcd3be1 npm --prefix workers/api run candidate-ingestion:audit -- --remote --invite-token e45ce397-501b-40de-bd41-2409f02ee70d --require-context-records`
returned `status: ready`, `candidateNodeSourceSpanMissingCount: 0`,
`candidateNodeStaleProfileSourceCount: 0`,
`candidateNodeSourceAnchorConflictCount: 0`,
`sourceLessPositiveClaimCount: 0`, and `duplicateProjectedEdgeCount: 0`.

After deploying API Worker version `39da5266-ffa4-4d20-88ba-ef2f6add88c8`
and app-dev proxy version `640b2007-fcf8-4a20-a23e-89b254bd6620` on
2026-07-03, `npm run smoke:talent-pool-browser-dev` created invite token
`cac8e887-67af-461a-88c2-857ccf9d4cb8` and submitted pasted profile text
through the public `/talent/:token` form. The smoke returned `status: ready`,
`candidateNodeCount: 13`, `candidateNodeExactSourceQuoteCount: 13`,
`contextSourceRefCount: 8`, `profileUploadArtifactVersionCount: 0`,
`sourceLessPositiveClaimCount: 0`, and `duplicateProjectedEdgeCount: 0`; the
recruiter/person read proof found one unified People candidate row, one
candidate source-search hit, one person source-search hit, 8 timeline entries,
9 person evidence source spans, and 5 person evidence context records. It
fetched the exact R2 key
`talent-intake/db90ea89-e552-411f-9eaa-b19797d14132/b283df220c2a34363cf65f8b51fd3b8839b091c9101798f8eff6dda7282ae05d-profile.txt`;
the object was 379 bytes and SHA-256
`b283df220c2a34363cf65f8b51fd3b8839b091c9101798f8eff6dda7282ae05d`, matching
both the content-addressed storage-key prefix and submitted source bytes. A
direct remote dev D1 audit using
`CLOUDFLARE_D1_DATABASE_ID=0abe92df-9296-46f5-9f9d-a1fb1bcd3be1 npm --prefix workers/api run candidate-ingestion:audit -- --remote --invite-token cac8e887-67af-461a-88c2-857ccf9d4cb8 --require-context-records`
returned `status: ready`, `candidateNodeSourceSpanMissingCount: 0`,
`candidateNodeStaleProfileSourceCount: 0`,
`candidateNodeSourceAnchorConflictCount: 0`,
`sourceLessPositiveClaimCount: 0`, and `duplicateProjectedEdgeCount: 0`.

The same deployed app/API pair was rechecked for public document uploads on
2026-07-03. `npm run smoke:talent-pool-browser-docx-dev` created invite token
`4471b131-1701-4c4a-9cd8-47b8213f6067` and submitted a DOCX profile through
the public `/talent/:token` form. The smoke returned `status: ready`,
`candidateNodeCount: 13`, `candidateNodeExactSourceQuoteCount: 13`,
`documentProfileStorageKeyCount: 1`, `documentProfileSourceSpanCount: 1`,
`profileUploadArtifactVersionCount: 1`, `sourceLessPositiveClaimCount: 0`, and
`duplicateProjectedEdgeCount: 0`; recruiter/person read proof found one unified
People candidate row, one candidate source-search hit, one person source-search
hit, 9 timeline entries, 9 person evidence source spans, and 5 person evidence
context records. It fetched the exact R2 key
`talent-intake/0de3cea4-d5c1-401f-9c07-3d32f77d199f/fade37eb68b961e368abb9390c48d4179fb3a4bdf64040b73611ddb677c9a83e-talent-smoke-20260703175148-16feac97.docx`;
the object was 749 bytes and SHA-256
`fade37eb68b961e368abb9390c48d4179fb3a4bdf64040b73611ddb677c9a83e`, matching
both the content-addressed storage-key prefix and submitted source bytes. A
direct remote dev D1 audit for the same invite returned `status: ready`,
`candidateNodeSourceSpanMissingCount: 0`,
`candidateNodeStaleProfileSourceCount: 0`,
`documentProfileSourceSpanCount: 1`, `profileUploadArtifactVersionCount: 1`,
`sourceLessPositiveClaimCount: 0`, and `duplicateProjectedEdgeCount: 0`.

`npm run smoke:talent-pool-browser-pdf-gap-dev` created invite token
`d04d2a4a-77d7-4994-bbe8-fcb7560f4cd1` and submitted an intentionally
unextractable PDF through the public `/talent/:token` form. The smoke returned
the expected explicit evidence gap: `status: not_ready`, `ingestionSteps:
[{currentStep: "profile_text_extraction_needed", count: 1}]`,
`candidateNodeCount: 0`, `candidateNodeExactSourceQuoteCount: 0`,
`documentProfileStorageKeyCount: 1`, `documentProfileSourceSpanCount: 0`,
`profileUploadArtifactVersionCount: 1`, `sourceLessPositiveClaimCount: 0`,
`sourceLessDesignQueueSuggestionCount: 0`, and `duplicateProjectedEdgeCount:
0`. It fetched the exact R2 key
`talent-intake/c6e4cf05-5a12-445b-b9f3-051ab58ce752/32ed5017fce95db1619dfd80fe7ffe1e51ec4dfb98e43e3266d265836f6ae62b-talent-smoke-20260703175301-ef1ccf05.pdf`;
the object was 14 bytes and SHA-256
`32ed5017fce95db1619dfd80fe7ffe1e51ec4dfb98e43e3266d265836f6ae62b`, matching
the content-addressed storage-key prefix and submitted source bytes without
deriving any positive profile claim.

Remote source-span sampling proved operational context refs preserve exact
field text:

```text
githubUrl: https://github.com/talent-audit-operational-a90fddbbb
phoneScreenerConsent: true
phoneNumber: +15551234567
timezone: America/Vancouver
availability: Weekday afternoons after 2 PM.
```

Remote candidate-node sampling also returned:

```text
node_type: TalentPoolProfileIntake
source_type: talent_pool_profile_intake
source_reference: source_span:source_span_3cbee2c23e0d5612fe929ff8c671268f
source_quote_validated: 1
source_quote: Talent Audit exact candidate node proof for f47e6af23. Recently implemented source-backed candidate evidence ingestion for Talent Pool profile submissions and verified idempotent replay.
```

Remote resume-node sampling confirmed repeated titles cite distinct exact
company-role source blocks instead of the first matching title:

```text
Morgan Stanley: Morgan Stanley\nSenior UI Developer
Sycle: Sycle\nSenior UI Developer
Orium: Orium\nFullstack Developer
SSENSE: SSENSE\nFullstack Developer
```

The current PDF profile key is
`talent-intake/talent_audit_532e4287e_c1/9d990a07be4b85fe2907eca11f2a378669d5b03c0131dd506470922e894070f1-test-resume.pdf`.
Remote source-span sampling confirmed at least one exact-text span is attached
to an artifact version with that storage key.

Local recruiter/person read proof on 2026-07-02 uses
`src/routes/cockpit/__tests__/contacts.rest.test.ts` to create a same-email
contact and roleless Talent Pool candidate, then verifies candidate graph,
source search, and evidence-depth reads return the same canonical
`workspace_people` person with exact submitted source text while `applications`
remain at zero and no extra candidate role is inserted. The same test now
asserts a unified People-list Talent Pool row opens by canonical person id and
that person-id source search, evidence timeline, and evidence-depth reads
resolve the same `workspace_people` evidence projection.

Candidate-facing route proof in `src/routes/__tests__/talentPool.test.ts`
now covers `/rpc/talent/resolve-token`, `/rpc/talent/submit-profile`,
`/rpc/talent/upload-profile`, ready-assignment dashboards, and safe not-found
errors. The shared assertion fixes the public dashboard shape and recursively
rejects internal candidate, application, person/workspace-person, source-span,
artifact, assignment, challenge, stage, pipeline, resume-key, and profile-key id
fields plus known internal values. The plain-text upload proof also verifies the
`profile_upload` receipt, extracted profile text source span, profile context
record, and `TalentPoolProfileIntake` candidate node all join back to the
current uploaded profile storage key and stay idempotent on replay. The DOCX
upload proof exercises foreground OOXML text extraction and verifies the same
storage-key join across receipt, source span, profile context record, and
candidate node, also without duplicating on replay. Upload route tests also
assert raw R2 capture metadata for plain text, DOCX, and unextractable PDF
files, proving the immutable file artifact is retained even when no profile
claims may be derived. The app-dev invite returned `CHALLENGE_PREPARING` with
zero ready challenges and no serialized internal id values.

Direct roleless person projection proof in
`src/lib/__tests__/talentPoolIdentity.test.ts` replays the same submitted
message, profile-upload receipt, and operational intake facts through
`ensureRolelessTalentPoolIdentity`, then replays a cron/backfill-shaped
upload-receipt repair without message text. The test proves people,
workspace_people, interactions, artifacts, artifact_versions, source spans,
context records, source refs, and the compatibility candidate node stay
idempotent; duplicate projected edges remain zero; and stale roleless
application/person-role bridges are removed.

Scheduled repair proof in
`src/lib/candidateDiscovery/__tests__/staleWorkersAiRetry.test.ts` now proves
that replaying a pasted/text profile reads the current R2 object, passes the
exact `messageStorageKey` and text media type into roleless identity repair, does
not create a fake upload receipt for pasted text, and invokes exact candidate-node
source-ref repair after identity replay for both resume-derived nodes and
profile-intake receipt nodes. `src/lib/candidateDiscovery/__tests__/candidateNodes.test.ts`
also proves the D1-only bulk source-ref repair is idempotent, refreshes stale
profile-intake receipt nodes to the current profile source span, and skips nodes
whose current profile artifact has no matching source span.
`scripts/repairTalentPoolSourceRefs.test.ts` proves the operator command is
dry-run safe, writes only repairable existing-span resume/profile-intake
projections, and becomes a no-op on replay.

App-dev operator backfill proof on 2026-07-03 used
`CLOUDFLARE_D1_DATABASE_ID=0abe92df-9296-46f5-9f9d-a1fb1bcd3be1 npm --prefix workers/api run candidate-ingestion:repair-source-refs -- --remote --dry-run --count-limit 500`
and reported `beforeRepairableCount: 500` without writes. The bounded write
command
`CLOUDFLARE_D1_DATABASE_ID=0abe92df-9296-46f5-9f9d-a1fb1bcd3be1 npm --prefix workers/api run candidate-ingestion:repair-source-refs -- --remote --batch-size 250 --max-batches 4 --count-limit 500`
then reported `scanned: 443`, `repaired: 443`, and bounded
`afterRepairableCount: 0`. Compact remote counters moved
`missing_source_ref_count` from `1666` to `550` and
`stale_profile_source_count` from `41` to `34`. The scoped real pasted-profile
audit for invite `cac8e887-67af-461a-88c2-857ccf9d4cb8` remained `ready` with
`sourceLessPositiveClaimCount: 0` and `duplicateProjectedEdgeCount: 0`.
Additional app-dev repair passes after Worker version
`d7775cf6-1165-46ef-af75-ed1aedf881f9` used the same bounded command while
cron replay created current profile source spans. The audit counters moved
`missing_source_ref_count` to `0`. A follow-up patch extended the repair command
to stale `talent_pool_profile_intake` receipt nodes and repaired `22` more
historical rows; the latest direct counters are `missing_source_ref_count: 0`,
bounded `beforeRepairableCount: 0`, and `stale_profile_source_count: 5`. The
remaining stale rows are PDF upload keys with `current_span_count: 0`, so they
are document extraction/artifact-receipt gaps rather than safe source-span
projection repairs. An unscoped remote audit attempted after the repair hit D1
CPU/time limits, so unscoped all-dev gating still needs a bounded audit mode;
the scoped real candidate audit remained `ready`.
The bounded mode was then added as `candidate-ingestion:audit -- --limit
<count>` so app-dev can run broad recent-window checks without concurrent
whole-database proof queries exceeding D1 CPU limits.
The 2026-07-03 app-dev bounded proof
`CLOUDFLARE_D1_DATABASE_ID=0abe92df-9296-46f5-9f9d-a1fb1bcd3be1 npm --prefix workers/api run candidate-ingestion:audit -- --remote --limit 5 --require-context-records`
completed against the five most recent Talent Pool intakes. It reported
`sourceLessPositiveClaimCount: 0`, `duplicateProjectedEdgeCount: 0`,
`candidateNodeWithoutExactSourceCount: 0`,
`candidateNodeSourceSpanMissingCount: 0`,
`candidateNodeStaleProfileSourceCount: 0`, and exact operational person
projection for all GitHub/LinkedIn/portfolio refs and phone screener intents.
The same bounded window is still `not_ready` because one recent PDF/DOCX intake
has a failed `candidate_ingestion` row at `parse_resume` and lacks exact-source
candidate-node projection; that row needs document extraction/replay or an
artifact-receipt-only model before the recent-window audit can become ready.
The ready app-dev smoke was refreshed on 2026-07-03 with
`npm run smoke:talent-pool-ingestion-dev`, creating invite
`1fbde4d7-eb06-48cb-8a5a-62ce56787758`. The proof reported
`status: ready`, `sourceLessPositiveClaimCount: 0`,
`duplicateProjectedEdgeCount: 0`, `candidateNodeExactSourceQuoteCount: 6`,
`submittedIntakeWithoutExactCandidateNodeCount: 0`,
`contextSourceRefCount: 8`, `keyHashMatchesObject: true`,
`objectMatchesSubmittedSource: true`, and recruiter/person read
`sourceBackedProfileContext: true` for the canonical person graph.

Browser proof on 2026-07-02 uses
`e2e/talent-pool-intake.unauth.spec.ts` with the unauthenticated Playwright
project. It exercises the public `/talent/:token` page with mocked public RPC
responses for pasted profile submit, file upload, and ready/completed dashboard
states, proving the candidate-facing page can run without Clerk recruiter auth
and never renders matching internals such as `WAITING_FOR_MATCH`. The same
browser proof also injects accidental internal candidate, application,
workspace-person, person, source-span, artifact-version, assignment, challenge,
stage, resume-key, and profile-key fields into the mocked public dashboard
payload and asserts none of those values render in the candidate browser.
The proof was refreshed on 2026-07-03 with
`npx playwright test e2e/talent-pool-intake.unauth.spec.ts --project=unauthenticated --reporter=line`;
all 4 unauthenticated browser scenarios passed.

## Current Gaps

- PDF/DOCX claim-level context appears only after document extraction and
  background resume ingestion complete. The original uploaded blob is preserved
  as a roleless person source artifact immediately, while failed extraction
  remains an explicit challenge-design evidence gap with no repo-family
  inference, not a fabricated skill/readiness claim.
- External profile refs are source-backed intake facts only; fetching and
  validating profile content is a separate future evidence producer.
- A design queue is not challenge readiness. A candidate should remain in
  `CHALLENGE_PREPARING` until a real assignment is backed by a production-ready
  review challenge packet with repo source refs and concept links.
- Unscoped app-dev no longer has historical missing resume source refs, and the
  source-ref repair command reports no remaining repairable profile/resume
  source refs. Five historical PDF profile-intake receipt nodes still point at
  older roleless message spans because their current uploaded PDFs have no
  extracted source spans; newer upload paths and scheduled repair project an
  artifact-level receipt context for current uploads instead of fabricated
  source spans. New scoped browser smokes audit clean. The 2026-07-03
  post-deploy `--limit 5` app-dev audit proves zero
  source-less positives, zero duplicate projected edges, zero failed ingestion
  rows, zero error-text rows, zero generic submitted candidate-node gaps, four
  upload-receipt context records, and zero document rows missing extraction
  proof inside the recent window. Four
  recent PDF/DOCX intakes remain explicit `profile_text_extraction_needed`
  receipt-backed evidence gaps because no extracted text exists. Use `--limit`
  for recent-window app-dev health checks because full remote unscoped proof can
  still exceed D1 CPU limits.
