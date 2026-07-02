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

This follows the BRAIN hypergraph model: an intake run is a source-backed
evidence bundle connecting candidate id, submitted profile artifact, extracted
spans, ingestion state, person projection, and unresolved gaps. The person graph
is useful only when it preserves exact provenance back to that bundle.

## What The Audit Checks

The verifier reports:

- submitted Talent Pool intakes and profile storage keys
- GitHub, LinkedIn, portfolio, and phone-screener raw capture
- `candidate_ingestion` row/status coverage
- candidate nodes with and without exact validated resume quotes
- artifact versions, source spans, and context source refs
- roleless `people` / `workspace_people` projection
- accidental `applications` / `person_roles` for roleless Talent Pool members
- ready challenge assignments vs. design-queue gaps
- source-less positive person claims
- duplicate person-projected context edges

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
file reuses the same source artifact path. PDF/DOCX extraction still runs in
background resume ingestion, but that projection now receives the roleless
Talent Pool person identity and must not create `applications` or
`person_roles` before a role-backed process exists.

GitHub, LinkedIn, portfolio, phone-screener consent, phone number, timezone, and
availability fields are stored as a normalized operational intake artifact with
one exact source span per submitted field. The projected
`talent_pool_external_profile_ref` and `talent_pool_phone_screener_intent`
records are operational evidence only; they do not validate the external
profile content or derive skills/readiness.

By default, the command fails on missing scoped candidates, submitted intakes
without storage or ingestion state, missing active Talent Pool person
projection, missing exact source proof, missing exact-source candidate-node
projection, raw external refs or phone intent without operational context
records, source-less positive claims, duplicate projected edges, candidate
nodes with no exact source quote, or roleless application/person-role rows.

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
`5edcc2d0-f033-4bcd-afff-26ee15c5c81d` and replaying pasted-text profile
submission twice with GitHub, LinkedIn, portfolio, and phone-screener fields.
The stricter remote verifier returned `status: ready`, `candidateNodeCount: 1`,
`candidateNodeExactSourceQuoteCount: 1`,
`candidateNodeWithoutExactSourceCount: 0`, `artifactVersionCount: 7`,
`sourceSpanCount: 19`, `contextRecordCount: 8`,
`contextSourceRefCount: 11`, `externalProfileRefContextCount: 3`,
`phoneScreenerIntentContextCount: 1`, `rolelessApplicationCount: 0`,
`rolelessPersonRoleCount: 0`, `sourceLessPositiveClaimCount: 0`, and
`duplicateProjectedEdgeCount: 0`.

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

The prior uploaded profile key was
`talent-intake/talent_audit_532e4287e_c1/a596d3c57d58a703d9ce2df45300a38ad50d47a4bdb6697bf281f6f1afa763f9-talent-audit-upload.txt`.

## Current Gaps

- PDF/DOCX claim-level context appears only after document extraction and
  background resume ingestion complete; failed extraction must remain a gap,
  not a fabricated skill/readiness claim.
- External profile refs are source-backed intake facts only; fetching and
  validating profile content is a separate future evidence producer.
- A design queue is not challenge readiness. A candidate should remain in
  `CHALLENGE_PREPARING` until a real source-backed assignment exists.
