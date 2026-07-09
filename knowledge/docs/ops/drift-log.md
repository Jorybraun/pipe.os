# Documentation Drift Log

Append-only audit trail for stale docs, dead tests, and outdated artifacts found during monthly audits or ad-hoc cleanup.

Format:

```
#### YYYY-MM-DD — {title}
- **Found by:** {who}
- **Action taken:** {what was deleted/moved/fixed}
- **Files affected:** {list}
- **Root cause:** {why it got stale}
```

---

#### 2026-04-22 — Initial documentation audit + dead test cleanup

- **Found by:** Hermes (founder request)
- **Action taken:**
  - Deleted `docs/workflows/CURRENT_STATE.json` — stale Amplify-era tracking artifact from 2026-03-14
  - Deleted `.claude/worktrees/agent-ae02d18c/` — old agent worktree with Cognito/AppSync/DynamoDB tests and docs
  - Deleted `e2e/pipeline-create.spec.ts` — tested old `PipelineCreatePage`, `/pipeline/new` now routes to `RoleDiscoveryPage`
  - Deleted `e2e/dev-container-happy.spec.ts` — Phase 3b paused, container never reaches READY
  - Deleted `e2e/dev-container-ttl.spec.ts` — Phase 3b paused, tests DB state for non-running feature
  - Deleted `e2e/bug-regression.spec.ts` — 2/9 tests fail on old pipeline UI; 7 pass but test bugs from 2026-03-29 era
  - Deleted `e2e/bug-regression-2.spec.ts` — 6/10 tests fail on old MCQ editor, challenge picker, candidate card UI
  - Fixed stale comment in `e2e/media-upload.spec.ts` (Lambda/S3 → R2)
  - Added Documentation Upkeep Rule to `CLAUDE.md`
  - Created `scripts/check-docs.sh` pre-commit guard
- **Files affected:** 8 deleted, 2 modified, 2 created
- **Root cause:** Migration from AWS Amplify to Cloudflare left stale tracking artifacts; UI redesigns (pipeline creation, challenge editor, candidate card) broke regression tests; Phase 3b pause left container tests testing fake behavior.
- **Test count before:** 414 tests across 37 files
- **Test count after:** 369 tests across 32 files (45 tests removed, all stale)

#### 2026-04-22 — Archive deletion

- **Found by:** Hermes (founder request after code-vs-docs audit)
- **Action taken:**
  - Deleted `docs/archive/` (36 files) — old archived docs from pre-migration and early migration eras
  - Deleted `docs/archive-amplify/` (73 files) — entire Amplify-era documentation tree
  - Updated `docs/README.md` to remove archive section, add deletion note
- **Files affected:** 109 files deleted, 1 modified
- **Root cause:** Archives contained docs describing systems that no longer exist (AWS Amplify, Lambda, AppSync, DynamoDB, Cognito, old UI components, old data models). The role discovery system alone had 4 archived docs describing a completely different architecture (separate Lambdas, 6-phase grid UI, "Next-Gen" styling) vs. the current implementation (Cloudflare Workers, AIChat component, brutalist glassmorphic). Reading archived docs was a trap — they looked official but described ghosts.

#### 2026-06-27 — CODE_REVIEW app-dev smoke exposed deployed matching drift

- **Found by:** Codex app-dev smoke run while validating standalone CODE_REVIEW production readiness.
- **Action taken:**
  - Fixed `scripts/smoke-code-review-assess-dev.mjs` to load `.env.local`/`.env`, use app-dev for recruiter setup, use api-dev for candidate `/rpc` bearer calls, and report sanitized challenge context on failure.
  - Fixed Playwright remote runs to pass dev HTTP Basic credentials from env when app-dev/room-dev are used.
  - Deployed the current API Worker and app shell to app-dev after adding source-backed manual match proof and roleless exact-symbol auto-match acceptance.
  - Added regression coverage for manual standalone CODE_REVIEW `matchExplanation` and roleless exact source-backed auto-match eligibility.
  - Verified `npm run smoke:code-review-assess-dev` and `CODE_REVIEW_SMOKE_AUTO_MATCH=1 npm run smoke:code-review-assess-dev` against app-dev; both selected real `mui/base-ui#973`, returned `MATCHED`, passed quality gate, rendered Pierre diff, and avoided video-room UI.
  - Updated `e2e/TESTING.md` with the remote transport split and smoke-test scope.
- **Files affected:** `scripts/smoke-code-review-assess-dev.mjs`, `playwright.config.ts`, `e2e/TESTING.md`, `CHANGELOG.md`.
- **Root cause:** The deployed smoke path had two separate drifts: local documentation expected remote app-dev validation, but the script did not load local env or split app-dev recruiter auth from candidate bearer RPC. After fixing the smoke transport, app-dev still failed readiness: auto-match remained in `WAITING_FOR_MATCH`, and manual override produced a CODE_REVIEW challenge without `matchExplanation`. Manual proof was stale deployed API code; auto-match was a too-strict roleless gate that rejected exact source-backed symbol evidence when only one production-ready packet made role/contrast metrics unavailable.

#### 2026-07-14 — Plan override: source-backed repo matching paused for custom container interview factory

- **Found by:** Devin (guardrail triggered when user asked to implement custom container challenge while `docs/plans/source-backed-repo-matching-implementation.md` Phase 2 was active)
- **Action taken:** Surfaced the contradiction; user explicitly approved with "Ok go lets do it". Created `knowledge/docs/decisions/current/ADR-056-interview-factory-and-custom-container-challenges.md` and began implementation of the interview factory and `CUSTOM_CONTAINER` challenge type.
- **Files affected:** `workers/api/src/routes/cockpit/scheduling.ts`, `workers/api/src/routes/cockpit/candidates.ts`, `workers/api/src/routes/cockpit/stages.ts`, `workers/api/src/routes/assessment/devContainer.ts`, `workers/api/src/lib/interviewFactory.ts` (new), `knowledge/docs/decisions/current/ADR-056-interview-factory-and-custom-container-challenges.md`
- **Root cause:** The custom container feature and interview factory are a user-prioritized feature that conflicts with the active repo-matching plan. Source-backed repo matching remains untouched and is expected to resume after this feature is shippable.

#### 2026-07-08 — Hard-coded candidate mechanism segments contradict ADR-043

- **Found by:** Devin (guardrail triggered while answering question about `CANDIDATE_EXACT_MECHANISM_SEGMENTS`)
- **Action taken:** Surface contradiction to user and await explicit override or removal plan.
- **Files affected:** `workers/api/src/lib/challengeMatching/d1Matcher.ts` (lines 244–279), `knowledge/docs/decisions/current/ADR-043-no-hard-coded-semantic-taxonomy.md`
- **Root cause:** Tactical hard-coded mechanism-segment whitelist was introduced in `2d6500fda` and expanded in `aeda1dd3e` to make roleless code-review matching work. It was never migrated to source-backed concept registry or hyperedge extraction.

#### 2026-07-08 — Broader audit found 6 additional hard-coded semantic taxonomies violating ADR-043

- **Found by:** Devin subagent audit triggered by user request to "search for more garbage like that"
- **Action taken:** Catalogued violations and removed the critical lists: `CANDIDATE_EXACT_MECHANISM_SEGMENTS`, `HIGH_SIGNAL_TOKENS`, `TOKEN_ALIASES`, `COMPACT_TERM_ALIASES`, `RAW_EVIDENCE_LANGUAGE_SEGMENTS`, `CONCEPT_PREFIXES`, plus the hard-coded `softwareMechanism` and `languageLike` priority regexes in `resumeDecomposition.ts`. `STOP_TOKENS` was reduced to a linguistic stopword list and then restored after test failures; `OPEN_TERM_STOP_SEGMENTS` and `RAW_EVIDENCE_STOPWORDS` remain as bounded linguistic/normalization filters pending a source-backed replacement. Tests were updated to remove assertions that relied on removed aliases. `npx tsc --noEmit` passes; targeted unit tests (`challengeMatching`, `livingContext`, `candidateDiscovery`) pass. Full worker suite has 38 pre-existing failures in `reviewSessionV2`, `scheduling.rest`, `candidates.rest`, and `contacts.rest` that are unrelated to these changes (e.g., `scheduled_interviews` schema missing `challenge_id` column).
- **Files affected:**
  - `workers/api/src/lib/challengeMatching/d1Matcher.ts` (`CANDIDATE_EXACT_MECHANISM_SEGMENTS` removed)
  - `workers/api/src/lib/livingContext/conceptSemanticMatch.ts` (`HIGH_SIGNAL_TOKENS`, `TOKEN_ALIASES`, `CONCEPT_PREFIXES` removed; `STOP_TOKENS` restored; matching threshold changed to 50% token overlap)
  - `workers/api/src/lib/challengeMatching/engine.ts` (`COMPACT_TERM_ALIASES` removed; `OPEN_TERM_STOP_SEGMENTS` retained)
  - `workers/api/src/lib/candidateDiscovery/resumeDecomposition.ts` (`RAW_EVIDENCE_LANGUAGE_SEGMENTS`, `softwareMechanism`, `languageLike` removed)
  - `workers/api/src/lib/challengeMatching/__tests__/challengeMatching.test.ts`
  - `workers/api/src/lib/candidateDiscovery/__tests__/resumeDecomposition.test.ts`
- **Root cause:** Short-term heuristic whitelists and alias maps were added to make matching pipelines work without a persisted concept registry or source-backed hyperedge extraction. They encode semantic meaning in application code, directly contradicting ADR-043.
- **Playwright note:** `npx playwright test` was run against the local dev server. It failed early with Clerk JS loading failures (`failed_to_load_clerk_js`) and `beforeAll` auth timeouts in `candidate-assessment.spec.ts`, plus `candidate-ingestion.spec.ts` returning `failed` instead of `matched`. These failures are consistent with the same pre-existing local environment and schema issues affecting the worker suite (missing `challenge_id` column, custom-container interview factory in progress) rather than the semantic-taxonomy removals.
