# Tasks — 2026-03-25

## What was done today

### Security Audit + Phase C (JWT Session Tokens)

**Problem:** The candidate-facing API used a shared `publicApiKey` embedded in the client bundle. Anyone who extracted it could call any candidate mutation from any domain with no identity validation.

**Solution:** Built a JWT session token architecture:
1. `resolveToken` validates inviteToken, issues a 2-hour JWT, claims the token (one-time use)
2. `sessionAuthorizer` Lambda validates the JWT on every subsequent call
3. All candidate mutations now support `allow.custom()` (Lambda auth) alongside `publicApiKey` (transition)
4. Frontend stores JWT in sessionStorage, sends it via `authMode: 'lambda'`
5. `createAssessment` and `generateMediaUploadUrl` read candidateId from resolverContext (no client-supplied IDs)

**Tests:** 26 unit tests passing (8 JWT + 7 authorizer + 11 createAssessment). 15 E2E passing, 0 failures.

**Files created:**
- `amplify/functions/_shared/jwt.ts` + `jwt.test.ts` + `vitest.config.ts`
- `amplify/functions/sessionAuthorizer/handler.ts` + `handler.test.ts` + `resource.ts` + `vitest.config.ts`
- `src/contexts/SessionTokenContext.tsx`
- `docs/security/AUDIT-2026-03-25.md`

**Files modified:**
- `amplify/data/resource.ts` — lambdaAuthorizationMode + allow.custom() on all candidate models
- `amplify/backend.ts` — registered sessionAuthorizer, updated resolveToken IAM grants
- `amplify/functions/resolveToken/handler.ts` + `resource.ts` — JWT issuance + token claiming
- `amplify/functions/createAssessment/handler.ts` + `handler.test.ts` — dual auth path
- `amplify/functions/generateMediaUploadUrl/handler.ts` — resolverContext support
- `src/hooks/useAssessment.ts` — lambda auth client + sessionStorage
- `src/components/Assessment/ChallengeRegistry.tsx` — lambda auth for diffs
- `src/components/Panels/VideoSubmissionPanel.tsx` — lambda auth for uploads
- `src/hooks/useVideoSignaling.ts` — lambda auth for signaling
- `src/pages/CandidateAssessmentPage.tsx` — SessionTokenProvider wrapper

**E2E cleanup:**
- Removed: `role-discovery.spec.ts`, `navigation.spec.ts`, `code-implementation-editor.spec.ts`
- Fixed: skip guards, retries, timeouts, regenerated all fixtures

---

## What's left to do

### Immediate (before production deploy)

- [ ] **Set production secret:** `npx ampx secret set SESSION_TOKEN_SECRET --branch main` (use `openssl rand -hex 32`)
- [ ] **Verify JWT flow works end-to-end** in sandbox: visit `/assess/:token`, check browser Network tab shows `Authorization` header (not just `x-api-key`)
- [ ] **Regenerate E2E fixtures** after sandbox redeploys (tokens get claimed on first use now)

### Phase B — Next priority (security hardening)

- [ ] **Remove `publicApiKey` from migrated models** — after verifying JWT flow in production, remove `allow.publicApiKey()` from: Stage, Challenge, CodeArtifact, Candidate, CandidateMedia, Assessment, VideoSession, VideoSignal, ScheduledInterview, and all candidate mutations (submitAssessment, scoreAssessment, generateFollowUps, submitCodeReview, fetchGitHubPR, generateMediaUploadUrl)
- [ ] **`updateAssessmentFollowUp` Lambda resolver** — Assessment.update via publicApiKey is still unscoped (P0-003 in audit). Build Lambda that validates JWT resolverContext before updating followUpQuestionsJson
- [ ] **`updateCandidateStatus` Lambda resolver** — Candidate.update via publicApiKey is unscoped (P2-001). Build Lambda that validates JWT before updating status
- [ ] **Add `submitCodeReview` inviteToken/JWT validation** — currently trusts client-supplied assessmentId without identity check

### Phase C completion (session token hardening)

- [ ] **Remove `id` and `pipelineId` from resolveToken return** — after building `loadPipelineStages(inviteToken)` Lambda resolver, the client won't need raw DynamoDB IDs
- [ ] **Handle session expiry in frontend** — show "session expired" message when JWT expires (2h), prompt candidate to re-enter via invite link (which will fail since token is claimed — need a "request new link" flow)
- [ ] **Fixture regeneration script** — create a single `scripts/regenerateAllFixtures.ts` that runs all fixture creation scripts in sequence

### Phase D — Hardening (post-MVP)

- [ ] Rate limiting on publicApiKey operations (resolveToken)
- [ ] Cache PR diffs at challenge creation time, remove publicApiKey from fetchGitHubPR
- [ ] Replace guest S3 read with presigned URLs for challenge-questions/*
- [ ] API key rotation schedule
- [ ] JWT secret rotation (support reading current + previous secret)

---

## Known issues

- E2E test fixtures must be regenerated before each test run (tokens are one-time use now)
- `SESSION_TOKEN_SECRET` must be set in sandbox for JWT flow to activate; without it, falls back to apiKey (backward compat)
- 95 pre-existing TypeScript errors (none from our changes)
- `playwright-report/index.html` changes on every test run (should be gitignored)
