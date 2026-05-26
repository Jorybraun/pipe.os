# Feature Report: API Routing Layer & Types System

> Generated: 2026-05-18
> Scope: All HTTP routes, middleware, types monolith, router composition
> Overall Manageability: **D+** (God files dominate, runtime type safety gap, 24% route test coverage)

---

## 1. Overview

The API routing layer is built on **Hono** and serves three audiences:
- **Recruiters** (`/api/v1/*`) — Clerk JWT auth
- **Candidates** (`/rpc/*`) — HMAC JWT auth
- **Public** (`/rpc/*` public subset) — No auth

The layer suffers from **god-file sprawl**, **runtime type safety gaps**, and **low test coverage** on the most critical business routes.

---

## 2. Complete Route Inventory

### Production Route Files (38 files, ~19,100 LOC)

| LOC | File | Audience |
|-----|------|----------|
| 1,802 | `routes/discovery/roleContexts.ts` | Recruiter + Participant |
| 1,560 | `routes/rpc.ts` | Candidate (public + auth) |
| 1,495 | `routes/assessment/review.ts` | Candidate |
| 1,313 | `routes/cockpit/scheduling.ts` | Recruiter |
| 1,267 | `routes/cockpit/candidates.ts` | Recruiter |
| 1,196 | `routes/cockpit/adminRepos.ts` | Recruiter |
| 1,123 | `routes/screening/culture.ts` | Candidate + Recruiter |
| 839 | `routes/cockpit/stages.ts` | Recruiter |
| 625 | `routes/assessment/agentInterview.ts` | Candidate |
| 540 | `routes/screening/phone.ts` | Recruiter |
| 513 | `routes/cockpit/repoDiscovery.ts` | Recruiter |
| 489 | `routes/assessment/devContainer.ts` | Candidate |
| 473 | `routes/cockpit/github.ts` | Recruiter |
| 458 | `routes/search.ts` | Recruiter |
| 437 | `routes/cockpit/pipelines.ts` | Recruiter |
| 420 | `routes/cron/issueScorer.ts` | System |
| 416 | `routes/cockpit/challenges.ts` | Recruiter |
| 387 | `routes/cockpit/pipelinesAutoBuild.ts` | Recruiter |
| 386 | `routes/cockpit/ingestion.ts` | Recruiter |
| 312 | `routes/assessment/reviewSessions.ts` | Candidate |
| 306 | `routes/outreach/emailOAuth.ts` | System |
| 305 | `routes/voice/voiceSessions.ts` | Candidate |
| 290 | `routes/internal/calibrate.ts` | Internal |
| 288 | `routes/outreach/email.ts` | System |
| 251 | `routes/cockpit/agent.ts` | Recruiter |
| 244 | `routes/discovery/roleContextsQuestion.test.ts` | Test |
| 227 | `routes/cockpit/pipelinesAutoBuild.rest.test.ts` | Test |
| 220 | `routes/search.ts` | Recruiter |
| 213 | `routes/cron/issueCrawler.ts` | System |
| 202 | `routes/cockpit/overview.ts` | Recruiter |
| 183 | `routes/cockpit/adminAiUsage.ts` | Recruiter |
| 176 | `routes/assessment/repo.ts` | Candidate |
| 171 | `routes/agents.ts` | Recruiter |
| 166 | `routes/assessment/video.ts` | Candidate |
| 156 | `routes/cockpit/ingestionStatus.ts` | Recruiter |
| 151 | `routes/cron/enrichmentWorker.ts` | System |
| 150 | `routes/cockpit/ingestionStatus.ts` | (duplicate entry?) |
| 148 | `routes/assessment/challengeSubmissions.ts` | Candidate |
| 123 | `routes/cockpit/devContainerSessions.ts` | Recruiter |
| 82 | `routes/cockpit/candidates.rest.test.ts` | Test |
| 76 | `routes/tts.ts` | Candidate |
| 62 | `routes/cron/index.ts` | System |
| 40 | `routes/internal/neo4jHealth.ts` | Internal |

### God Files

**Super-gods (>1000 lines):**
- `discovery/roleContexts.ts` — 1,802
- `rpc.ts` — 1,560
- `assessment/review.ts` — 1,495
- `cockpit/scheduling.ts` — 1,313
- `cockpit/candidates.ts` — 1,267
- `cockpit/adminRepos.ts` — 1,196
- `screening/culture.ts` — 1,123

**Large gods (500–1000 lines):**
- `cockpit/stages.ts` — 839
- `assessment/agentInterview.ts` — 625
- `screening/phone.ts` — 540
- `cockpit/repoDiscovery.ts` — 513

**Result: 11 god files** (29% of route files consume ~70% of total route LOC).

---

## 3. Router Composition

### Main App (`index.ts`)

```typescript
app.route('/api/v1/pipelines', pipelines);
app.route('/api/v1/pipelines', pipelinesAutoBuild);   // SAME PREFIX
app.route('/api/v1/pipelines', pipelineStages);       // SAME PREFIX
app.route('/api/v1/stages', stageOps);
app.route('/api/v1/stages', stageChallenges);         // SAME PREFIX
app.route('/api/v1/challenges', challenges);
// ... 35+ total mounts
```

**Prefix-merging is heavily used.** Multiple route modules share the same path prefix. Endpoint ownership is not discoverable from the filesystem.

### RPC Internal Composition

`rpc.ts` (1,560 lines) creates two Hono routers:
- `rpcPublic` — no auth
- `rpcAuth` — `candidateAuth` middleware

Mounts sub-routers:
```typescript
rpcAuth.route('/review', review);
rpcAuth.route('/repo', repo);
rpcAuth.route('/dev-container', devContainer);
rpcAuth.route('/agent-interview', agentInterviewRouter);
rpcPublic.route('/culture', cultureCandidate);
rpcPublic.route('/dev-container-proxy', devContainerProxyPublic);
```

---

## 4. The Types Monolith

**File:** `workers/api/src/types.ts`
- **1,497 lines**
- **102 exported types/interfaces**
- Contains: `Env`, `Variables`, domain models (`PipelineRow`, `StageRow`, `ChallengeRow`, `PhoneCallRow`, `RoleContextRow`), LLM types, scoring types, matrix types, conflict/dealbreaker records, repo alignment rows, etc.

**Problem:** This is a true monolith. Many route files import from it, but numerous routes also define *local* `*Row` types inline rather than adding to this file, indicating it's become too cumbersome to extend.

---

## 5. JSON.parse Without Validation

| Category | Count |
|---|---|
| Raw `JSON.parse` (no wrapper) | **66 calls** |
| `parseJsonColumn` wrapper usages | **63 calls** |
| **Total JSON deserialization** | **129 calls** |

**Critical finding:** `parseJsonColumn` exists in **4 different files with 4 different implementations**:
- `assessment/review.ts` (returns `T | null`, no fallback)
- `assessment/reviewSessions.ts` (same, copied)
- `assessment/agentInterview.ts` (returns `T`, has fallback)
- `screening/culture.ts` (same as agentInterview)
- `cockpit/repoDiscovery.ts` (same signature, slightly different)
- `discovery/roleContexts.ts` (same as agentInterview)

**Zero runtime validation** — every single parse is a blind `JSON.parse(x) as T`. No Zod, no `unknown` narrowing.

---

## 6. Local *Row Type Duplications

Despite `types.ts` having centralized row types, routes define **local duplicates**:

| File | Local Types |
|---|---|
| `assessment/review.ts` | `ReviewSessionRow`, `ChallengeConfigRow` |
| `assessment/repo.ts` | `ChallengeRow` (redefined!) |
| `assessment/agentInterview.ts` | `CultureSessionRow` |
| `screening/culture.ts` | `CultureSessionRow`, `UsageRow`, `MonthlyRow`, `TopExpensiveRow` |
| `voice/voiceSessions.ts` | `RoleContextRow` (redefined!) |
| `cockpit/adminRepos.ts` | `RepoRow`, `SamplePRRow`, `SignalsRow`, `ConstructRow`, `BulkIngestReportRow` |
| `cockpit/adminAiUsage.ts` | `FeatureSummaryRow`, `TotalsRow`, `SessionRow` |
| `cockpit/ingestion.ts` | `IngestionListRow` |

**Result:** At least **15 locally-defined row types** shadow or duplicate the central types file.

### Inline Anonymous Types

**161 inline anonymous type arguments** to `.first<>` / `.all<>` across routes:
- `cockpit/candidates.ts`: 23 inline types
- `rpc.ts`: 18 inline types
- `cockpit/scheduling.ts`: 14 inline types

---

## 7. Error Handling

### Primary Pattern

```typescript
apiError(c, code, message)
```
- Maps codes to HTTP statuses
- **326 total usages** across routes
- **~240 usages in production route files**

### Secondary Pattern (Inconsistent)

```typescript
c.json({ error: { code, message } }, status)
```
- **103 raw manual error responses**
- `assessment/review.ts`: 31 manual errors
- `rpc.ts`: 20 manual errors
- `assessment/repo.ts`: 11 manual errors

**Inconsistency:** Routes mix `apiError()` and manual `c.json()` freely. No enforcement.

### Global Handler

```typescript
app.onError(globalErrorHandler);  // in index.ts
```
Catches unhandled exceptions → 500 with generic message.

**No throw culture:** God files rarely throw. Most errors are returned explicitly.

---

## 8. Middleware

| File | Lines | Purpose |
|------|-------|---------|
| `middleware/auth.ts` | ~76 | Clerk/org auth |
| `middleware/candidateAuth.ts` | ~67 | JWT candidate token |
| `middleware/participantAuth.ts` | ~63 | Participant token |
| `middleware/errors.ts` | 53 | `apiError()` + global handler |

**No route-level middleware directory.** All middleware is app-level. Route-level auth is handled via imported Hono sub-routers.

---

## 9. Test Coverage

| Test File | Lines | Target |
|---|---|---|
| `search.test.ts` | 458 | `search.ts` |
| `challengeAuthoring.rest.test.ts` | 587 | `cockpit/challenges.ts` |
| `pipelinesAutoBuild.rest.test.ts` | 227 | `cockpit/pipelinesAutoBuild.ts` |
| `ingestionStatus.test.ts` | 150 | `cockpit/ingestionStatus.ts` |
| `candidates.rest.test.ts` | 82 | `cockpit/candidates.ts` |
| `enrichmentWorker.test.ts` | 274 | `cron/enrichmentWorker.ts` |
| `roleContextsEmbed.test.ts` | 426 | `discovery/roleContexts.ts` |
| `roleContextsQuestion.test.ts` | 244 | `discovery/roleContexts.ts` |
| `culture.rest.test.ts` | 481 | `screening/culture.ts` |

**Coverage rate: ~24% of route files have dedicated tests.**

**The 7 super-god files (>1000 lines):**
- `roleContexts.ts` — has 2 test files (embed + question), but **not for route handlers**
- `rpc.ts` — **untested**
- `review.ts` — **untested**
- `scheduling.ts` — **untested**
- `candidates.ts` — **untested** (rest test is partial)
- `adminRepos.ts` — **untested**
- `culture.ts` — tested (rest test covers mock path)

---

## 10. Manageability Verdict

| Dimension | Score | Notes |
|---|---|---|
| **Route file count** | 🟡 Medium | 38 files |
| **Total route LOC** | 🔴 Very High | ~19,100 |
| **God files** | 🔴 Critical | 11 files >500 LOC; 7 >1000 LOC |
| **Types monolith** | 🔴 High | 1,497 lines / 102 types |
| **JSON.parse safety** | 🔴 Critical | 129 blind parses with `as T` casts |
| **Inline SQL types** | 🔴 High | 161 anonymous inline types |
| **Local Row duplications** | 🟡 Medium | 15+ shadow types |
| **Error handling consistency** | 🟡 Medium | Mix of `apiError` + manual `c.json` |
| **Route test coverage** | 🔴 Critical | ~24%; 5 of 7 super-gods untested |
| **Zod validation** | 🟡 Medium | 17 files import Zod but schemas are sparse |

### Recommended Actions

1. **Split god files** — Target one god file per sprint. Extract:
   - `rpc.ts` → `routes/rpc/` directory (intake, upload, matching, scheduling, submission)
   - `review.ts` → `routes/assessment/review/` directory
   - `scheduling.ts` → `routes/cockpit/scheduling/` directory
   - `candidates.ts` → `routes/cockpit/candidates/` directory
   - `adminRepos.ts` → `routes/cockpit/repos/` directory
   - `roleContexts.ts` → `routes/discovery/role/` directory

2. **Introduce Zod schemas** for all JSON columns and request bodies. Start with the 129 `JSON.parse` call sites.

3. **Centralize `parseJsonColumn`** — One implementation in `lib/jsonUtils.ts`.

4. **Extract inline SQL types** — Move `.first<{...}>()` types into a `types/queries.ts` file or into the central `types.ts`.

5. **Standardize error handling** — Enforce `apiError()` everywhere; add an ESLint rule.

6. **Add route tests for super-gods** — Start with `rpc.ts` (candidate-facing, high impact). Use Hono's `app.request()` for unit-level route testing.

7. **Document prefix-merging** — Add a `ROUTES.md` that maps every URL prefix to its handler file(s).
