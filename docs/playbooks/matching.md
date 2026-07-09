# Playbook: Candidate-to-Repo Matching

## Scope

This playbook dogfoods **System B: Candidate Runtime Matching** — the path where a candidate uploads a resume or profile, PIPE matches them to a real, reviewable open-source PR, and presents a source-backed code-review challenge.

For the architecture behind this, see [`knowledge/docs/ops/repo-matching-flow.md`](../../knowledge/docs/ops/repo-matching-flow.md).

## Known realities before you start

- Local `npx wrangler dev` **cannot complete the real pipeline** because the `ai` binding is configured as `remote: true` and Cloudflare Workers AI returns error `1031` in local mode.
- That means the `WAITING_FOR_MATCH` loading screen will not resolve to a real challenge locally.
- The reliable local validation is a **mocked Playwright path** or a **deployed dev smoke run**.
- This playbook covers both.

## Prerequisites

- Local servers running:
  ```bash
  cd workers/api && npx wrangler dev --port 8787
  npm run dev        # in another shell
  ```
- OR a deployed dev target:
  ```bash
  --app-base https://app-dev.hire-pipe.com
  --rpc-base https://api-dev.hire-pipe.com
  ```
- Recruiter test credentials are documented in [`AGENTS.md`](../../AGENTS.md#local-e2e--dogfood-credentials) and in [`e2e/auth.setup.ts`](../../e2e/auth.setup.ts) as fallbacks. Use `e2e-test@pipe.dev` / `PipeE2E_Test2026!` (or `E2E_EMAIL` / `E2E_PASSWORD` overrides). Do not use a real user account for dogfood.

## Fast automated check (local, mocked)

These specs exercise the matching UI and API contracts without requiring a live AI pipeline:

```bash
npx playwright test \
  e2e/talent-pool-intake.unauth.spec.ts \
  e2e/code-review-assess-smoke.unauth.spec.ts \
  e2e/assess-session-isolation.unauth.spec.ts \
  e2e/assess-token-lifecycle-dev.unauth.spec.ts \
  --project=unauthenticated --workers=1 --reporter=line
```

**Pass criteria**

- All selected tests pass.
- `assess-session-isolation` proves the URL invite resolves cleanly when a stale candidate session exists.
- `code-review-assess-smoke` proves the candidate sees a source-backed code-review surface, not a generic placeholder.

## Full automated check (with seeded data)

The `standalone-code-review-mvp.spec.ts` uses an internal e2e fixture endpoint to seed repo data and bypass the live AI pipeline. Run it when you want to verify the full recruiter-and-candidate loop:

```bash
npx playwright test e2e/standalone-code-review-mvp.spec.ts --project=authenticated --workers=1 --reporter=line
```

This will take several minutes. It requires a valid `playwright/.auth/user.json` state. Generate it first with:

```bash
npx playwright test e2e/auth.setup.ts --project=setup
```

If the setup hangs locally, use the manual steps below instead.

## Manual dogfood steps

### 1. Get a recruiter session token

Sign in at `http://localhost:5173/` with the test account from `e2e/auth.setup.ts`, then copy the `__session` cookie value. Or use Playwright to generate one and inspect `playwright/.auth/user.json`.

### 2. Create a standalone code-review candidate

```bash
API_BASE=http://localhost:8787
TOKEN="<recruiter __session cookie>"
NAME="Dogfood Matching"
EMAIL="dogfood-matching-$(date +%s)@example.test"

BODY=$(cat <<EOF
{
  "name": "$NAME",
  "email": "$EMAIL",
  "interviewType": "CODE_REVIEW",
  "skipEmail": true
}
EOF
)

curl -s -X POST "$API_BASE/api/v1/candidates" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "$BODY" | jq .
```

Record the returned `candidate.id` and `candidate.inviteToken`.

### 3. Resolve the invite as a candidate

```bash
TOKEN=$(curl -s -X POST "$API_BASE/rpc/resolve-token" \
  -H "Content-Type: application/json" \
  -d "{\"inviteToken\":\"<inviteToken>\"}" | jq -r '.sessionToken')
```

### 4. Submit resume evidence

```bash
curl -s -X POST "$API_BASE/rpc/submit-challenge-response" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "order": 0,
    "submission": {
      "resumeText": "Senior software engineer with 8 years of TypeScript, React, and Node.js. Built large-scale frontend applications. Expert in component architecture, state management, and performance optimization. Contributed to open-source UI libraries.",
      "githubHandle": "dogfood-tester"
    }
  }' | jq .
```

### 5. Observe the matching gate

```bash
for i in 1 2 3 4 5; do
  curl -s -X POST "$API_BASE/rpc/get-challenge" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d '{"order": 0}' | jq '.type, .title';
  sleep 6;
done
```

**Expected local behavior:** the first call returns `WAITING_FOR_MATCH` and a title like `Building your personalized challenge`. Later calls will continue returning `WAITING_FOR_MATCH` because the AI pipeline cannot complete locally.

**Expected deployed behavior:** after 30–120 seconds the call returns `CODE_REVIEW` with `githubPrTitle`, `githubRepoUrl`, and `cachedDiffJson` populated from a real matched repo.

### 6. Open the candidate UI

```bash
open "http://localhost:5173/assess/<inviteToken>"
```

In a deployed environment, the candidate sees a human-readable challenge card with the PR title and repo name. In local, the candidate sees `Building your personalized challenge...` and a progress bar.

### 7. Recruiter verifies source-backed context

```bash
curl -s "$API_BASE/api/v1/candidates/<candidateId>/living-context" \
  -H "Authorization: Bearer <recruiter TOKEN>" | jq '.livingContext.person.workspacePersonId'
```

In a passing run, the response includes `evidence` and `evidenceHyperedges` where the repo PR and the candidate's resume are linked by exact source text spans. It must **not** contain a fabricated PR number or repo that was not actually indexed.

## Pass/fail criteria

| Checkpoint                                                   | Pass                                  | Fail                                                     |
| ------------------------------------------------------------ | ------------------------------------- | -------------------------------------------------------- |
| Candidate intake accepts resume                              | 200/success                           | 4xx/5xx or validation error                              |
| Matching gate returns `WAITING_FOR_MATCH` initially          | status shows waiting                  | immediate generic `CODE_REVIEW` with no repo             |
| Deployed: gate resolves to `CODE_REVIEW` within 2 minutes    | real `githubPrTitle`/`githubRepoUrl`  | stays `WAITING_FOR_MATCH` or `BLOCKED`                   |
| Challenge UI shows human-readable source-backed PR           | PR title + repo name visible          | placeholder text, enum codes, or missing diff            |
| Recruiter context graph links candidate ↔ repo by exact text | `evidence` spans present              | fabricated PR, unrelated repo, or empty evidence         |
| Ground truth not leaked to candidate                         | candidate payload has no internal IDs | `pipelineId`, `workspacePersonId`, or raw scores visible |

## Known local blockers

- AI binding error `1031` prevents `discoverCandidateProfile`, `decomposeResumeToGraph`, `embedAndUpsertCandidate`, and `candidateSituationFit` from completing. See `repo-matching-flow.md` for the full list.
- `checkMatchingGate` only polls `candidate_ingestion.status`, so local runs spin indefinitely at the waiting screen.
- Workaround: use the Playwright specs above or run against deployed dev.

## Cleanup

Delete the dogfood candidate and any seeded repos via the recruiter dashboard or by clearing the local D1 database and reapplying migrations:

```bash
cd workers/api
npx wrangler d1 migrations apply pipe-db --local
```

## Output

If you run this as a dogfood session, save a report to `dogfood-output/matching-report-YYYY-MM-DD.md` with observed results and any new blockers.
