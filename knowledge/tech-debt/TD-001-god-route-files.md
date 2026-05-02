# TD-001: God Route Files Are Unmaintainable

**Status:** 🔴 PENDING  
**Priority:** P0 — Critical  
**Severity:** Blocks new contributors, increases regression risk  
**Estimated Effort:** 3–4 days  
**Owner:** Unassigned

---

## Problem

Five route files have grown past 1,000 lines. They violate single-responsibility so aggressively that a developer cannot reason about side effects without reading the entire file.

| File | Lines | Responsibilities |
|------|-------|----------------|
| `routes/discovery/roleContexts.ts` | 2,036 | RCD synthesis, calibration, question generation, embedding, file upload, audio transcription, persona derivation |
| `routes/assessment/review.ts` | 1,453 | Code review routing, scoring, session lifecycle, diff fetching, explainer agent, rescore, finalize |
| `routes/rpc.ts` | 1,391 | Challenge loading, candidate intake, media upload, submissions, candidate auth, Twilio callbacks |
| `routes/cockpit/scheduling.ts` | 1,313 | Interview scheduling, Calendly OAuth, email, SMS, pipeline stage transitions |
| `routes/cockpit/adminRepos.ts` | 1,202 | Repo crawling, PR sampling, Gemma calls, signal extraction, bulk ingestion, pass-3 decomposition |

### Why This Is Bad

- **Code review fatigue**: PRs touching these files are impossible to review thoroughly.
- **Merge conflicts**: Multiple features cannot safely touch the same file.
- **Testability**: These files cannot be unit-tested in isolation; the few tests that exist mock the entire Hono app.
- **Onboarding**: New developers need 30+ minutes of reading before they can make a one-line change.

---

## Evidence

```bash
$ wc -l workers/api/src/routes/discovery/roleContexts.ts
2036

$ grep -c "app\.\(get\|post\|put\|delete\|patch\)" workers/api/src/routes/discovery/roleContexts.ts
18
```

`roleContexts.ts` alone defines **18 route handlers** and **~40 internal helper functions**.

---

## Solution

### Option A: Sub-routers (Recommended)

Split each god file into a directory with sub-routers mounted under a common prefix.

```
routes/discovery/roleContexts/
├── index.ts           # Hono router mounting all sub-routers
├── synthesize.ts      # POST /:id/synthesize
├── questions.ts       # POST /:id/questions, GET /:id/questions/:qid
├── embed.ts           # POST /:id/embed
├── upload.ts          # POST /:id/upload (file + audio)
├── calibrate.ts       # POST /:id/calibrate
└── types.ts           # Local types (later merge to central types.ts)
```

**Migration steps:**
1. Create the directory.
2. Move one handler + its helpers per PR.
3. Export a `roleContextsRouter` from `index.ts`.
4. Update `src/index.ts` to mount the router at `/api/v1/discovery/role-contexts`.
5. Delete the old monolithic file only after all handlers are migrated.

### Option B: Service Layer

Keep route files thin (only HTTP concerns) and move all business logic into `lib/services/`.

```
lib/services/roleDiscovery/
├── synthesizeRcd.ts
├── generateQuestions.ts
├── embedRoleContext.ts
└── calibrateRcd.ts
```

Route files reduce to:
```ts
app.post('/:id/synthesize', async (c) => {
  const result = await synthesizeRcd(c.env, c.req.param('id'));
  return c.json(result);
});
```

**Recommended approach**: Combine both — sub-routers for HTTP routing, service layer for business logic.

---

## Acceptance Criteria

- [ ] No route file exceeds 400 lines.
- [ ] Each sub-router has its own test file.
- [ ] Old monolithic files are deleted.
- [ ] All existing E2E tests still pass.

## Related

- TD-008 (untested business routes) — splitting makes testing feasible.
- TD-010 (fragmented row types) — move local types into sub-router `types.ts`, then unify.
