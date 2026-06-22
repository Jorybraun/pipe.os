# G-003 First Executable MVP Browser Smoke

Status: prepared and reviewed; Playwright discovery/listing passed; auth fallback restored; full local execution still pending D1/API proof.

## Objective

Prepare the first executable Playwright smoke that proves the simplified MVP path:

- visit `/interviews`
- visit `/interviews?new=1`
- visit `/roles`
- visit `/roles/new`
- create a role from a simple source-backed job description through the UI
- visit `/people`
- create a person through the UI
- inspect the person living-context surface
- create a roleless candidate/person through the real API
- inspect candidate living-context read-model data

## Detected Test Pattern

Root scripts:

- `npm run test:e2e` -> `playwright test`
- `npm run test:e2e:ci` -> `playwright test --workers=1 --reporter=list`
- `npm run test:e2e:ui` -> `playwright test --ui`
- `npm run test:e2e:headed` -> `playwright test --headed`

Playwright config:

- test dir: `e2e`
- authenticated project uses `playwright/.auth/user.json`
- global setup runs Clerk testing setup
- local web servers start automatically when `APP_BASE` is localhost:
  - `cd workers/api && npx wrangler dev --port 8787`
  - `npm run dev -- --port 5173`

Auth setup:

- `e2e/auth.setup.ts` uses `E2E_PASSWORD` when provided and otherwise uses the documented Clerk fallback `PipeE2E_Test2026!`
- `E2E_EMAIL` is optional and defaults to `e2e-test@pipe.dev`

## Runnable Command

```bash
E2E_EMAIL=e2e-test@pipe.dev npm run test:e2e -- e2e/mvp-browser-smoke.spec.ts --project=authenticated --reporter=line
```

Equivalent direct command:

```bash
E2E_EMAIL=e2e-test@pipe.dev npx playwright test e2e/mvp-browser-smoke.spec.ts --project=authenticated --reporter=line
```

## Coverage Notes

The smoke intentionally uses real app/API paths. It does not mock backend data.

Fixture-only content:

- generated role title, email, and JD text submitted through `/roles/new`
- generated roleless candidate/person text submitted to `POST /api/v1/candidates`

Assertions:

- core route URLs resolve
- `/roles/new` form can submit a simple JD and navigate to `/pipeline/:id`
- `/people` can create a person and open the context tab
- `POST /api/v1/candidates` creates a roleless talent-pool candidate with `pipelineId: null`
- `GET /api/v1/candidates/:id/living-context` returns source-backed interaction/source-span data for the roleless message

Cleanup:

- created pipeline is deleted through `DELETE /api/v1/pipelines/:id`
- created contact is deleted through `DELETE /api/v1/contacts/:id`
- created standalone candidate is deleted through `DELETE /api/v1/candidates/:id`

Orchestrator review:

- Cleanup was moved into Playwright `afterEach` so failed test runs do not leave created records behind when IDs have been captured.
- `/interviews?new=1` was added to the route smoke to match the P-001 UI gate.
- The test title was normalized to ASCII.
- Review validation passed: `npx playwright test e2e/mvp-browser-smoke.spec.ts --project=authenticated --list`, `npx tsc --noEmit`, and `git diff --check`.

## Current Blockers To Full Proof

- Last authenticated browser run reached the `/roles/new` UI, but Create Role failed against the local API because D1 was missing living-context tables (`artifacts`). Targeted local migrations 0082 and 0095 were applied afterward; rerun is still needed before this counts as proof.
- Local API proof requires Wrangler/D1 dev state with current migrations applied.
- The candidate/living-context UI route for roleless candidates is not directly navigable from `/people`; the smoke verifies candidate living context via the real API and verifies the people context tab surface via UI.
- Match UI content depends on fixture data with review/match records. This smoke can inspect the living-context surface and standalone candidate context, but cannot prove a populated match panel unless the local DB already contains a candidate with standalone review match data or a separate seed job creates one.
