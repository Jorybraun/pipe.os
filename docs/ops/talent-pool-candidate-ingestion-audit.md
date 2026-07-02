# Talent Pool Candidate Ingestion Audit

**Status:** Active proof command
**Last updated:** 2026-07-02
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

Uploaded profile files use content-hash storage keys, so replaying the same
file reuses the same source artifact path. Each upload also creates an
idempotent roleless person `profile_upload` artifact version for the original
blob with storage key, content hash, media type, byte length, and filename.
This artifact is source inventory only: if no exact text can be extracted, it
must not create a source span, context record, candidate node, skill, readiness
claim, or repo-family suggestion. PDF/DOCX extraction still runs in background
resume ingestion when foreground extraction is unavailable. When foreground
text extraction succeeds, the profile text artifact version stores the uploaded
profile storage key so source spans can be checked against the current file.
Scheduled Talent Pool repair also treats missing `profile_upload` receipts as
repairable projection state. For content-hash upload keys shaped like
`talent-intake/<candidate>/<sha256>-<filename>`, it can fetch the existing R2
object, compute the immutable byte hash/length/media type, and call the same
roleless person projection path with `sourceArtifact`. It skips pasted text
intakes and skips any storage key that already has a profile-upload receipt, so
cron/backfill replay does not duplicate artifact versions or person edges.
Background projection receives the roleless Talent Pool person identity and
background decomposition runs with legacy candidate-node mirroring disabled, so
it must not create `applications` or `person_roles` before a role-backed process
exists. Parser-only resume nodes without exact source quotes are skipped instead
of becoming positive candidate claims.
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
Scheduled retry throughput defaults conservatively, while dev can raise it with
`CANDIDATE_INGESTION_RETRY_LIMIT` to burn down stale AI-output failures without
changing production behavior.

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
profile content or derive skills/readiness.

By default, the command fails on missing scoped candidates, submitted intakes
without storage or ingestion state, candidate rows whose `resume_s3_key` is
missing or stale relative to the current intake profile key,
`candidate_ingestion` rows that are failed or still carry `error_text`, missing
active Talent Pool person projection, missing exact source proof, missing
exact-source candidate-node projection, PDF/DOCX profile storage keys without
extracted source spans, raw external refs or phone intent without operational
context records, source-less positive claims, duplicate projected edges,
candidate nodes with no exact source quote, source spans whose exact text no
longer matches their immutable artifact text slice or exact-text hash,
duplicate active candidate-node evidence, candidate-node source anchor
conflicts, or roleless application/person-role rows.

Challenge assignment rows only count as ready when both `github_repo_url` and
`github_pr_number` are present. Assignment rows without that PR-backed metadata
are reported as assessment setup gaps and must not drive Talent Pool
`CHALLENGE_READY`.

Use `--require-context-records` when the proof must include claim-level person
context records, not only roleless identity plus immutable source spans.

## Proof Commands

```bash
cd workers/api
npm run candidate-ingestion:audit -- --local
npm run candidate-ingestion:audit -- --local --invite-token <token>
npm run candidate-ingestion:audit -- --local --candidate-id <candidate_id>
npm run candidate-ingestion:audit -- --local --email <email>
npm run candidate-ingestion:audit -- --local --invite-token <token> --require-context-records
npm run candidate-ingestion:audit -- --remote --invite-token <token>
npm test -- src/routes/__tests__/talentPool.test.ts src/lib/candidateDiscovery/__tests__/staleWorkersAiRetry.test.ts
npm test -- src/lib/livingContext/__tests__/compatibility.test.ts src/lib/livingContext/__tests__/candidateComparison.test.ts src/lib/livingContext/__tests__/evidenceReadiness.test.ts src/lib/livingContext/__tests__/matchConfidenceScoring.test.ts
npm test -- src/lib/candidateDiscovery/__tests__/candidateNodes.test.ts src/lib/candidateDiscovery/__tests__/resumeDecomposition.test.ts scripts/auditCandidateIngestion.test.ts
npm test -- src/routes/cockpit/__tests__/contacts.rest.test.ts src/routes/cockpit/__tests__/candidates.rest.test.ts src/lib/livingContext/__tests__/readModel.test.ts
```

For app-dev, prefix remote proof commands with the dev D1 id:

```bash
CLOUDFLARE_D1_DATABASE_ID=0abe92df-9296-46f5-9f9d-a1fb1bcd3be1 \
  npm run candidate-ingestion:audit -- --remote --invite-token <token>
CLOUDFLARE_D1_DATABASE_ID=0abe92df-9296-46f5-9f9d-a1fb1bcd3be1 \
  npm run candidate-ingestion:audit -- --remote --invite-token <token> --require-context-records
```

Latest app-dev proof on 2026-07-02 used invite token
`talent-audit-532e4287e-c1` after deploying Worker version
`d5cf3c95-c24e-4924-9efb-ebee8a9d240d`, which includes canonical person-id
source search, evidence timeline, and evidence-depth reads for unified People
rows. The scheduled Talent Pool repair had replayed the existing
profile-upload R2 object against dev D1.
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
`sourceLessPositiveClaimCount: 0`, `sourceLessDesignQueueSuggestionCount: 0`,
and `duplicateProjectedEdgeCount: 0`.

The same remote D1 proof counted exactly one `profile_upload` receipt for
`talent-intake/talent_audit_532e4287e_c1/9d990a07be4b85fe2907eca11f2a378669d5b03c0131dd506470922e894070f1-test-resume.pdf`,
showing the scheduled repair backfilled the historical upload without adding
source-less claims or duplicate person/context edges.

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
candidate node, also without duplicating on replay. The app-dev invite returned
`CHALLENGE_PREPARING` with zero ready challenges and no serialized internal id
values.

## Current Gaps

- PDF/DOCX claim-level context appears only after document extraction and
  background resume ingestion complete. The original uploaded blob is preserved
  as a roleless person source artifact immediately, while failed extraction
  remains an explicit challenge-design evidence gap with no repo-family
  inference, not a fabricated skill/readiness claim.
- External profile refs are source-backed intake facts only; fetching and
  validating profile content is a separate future evidence producer.
- A design queue is not challenge readiness. A candidate should remain in
  `CHALLENGE_PREPARING` until a real source-backed assignment exists.
