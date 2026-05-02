# TD-016: Deprecated Legacy Endpoints in review.ts

**Status:** 🔴 PENDING  
**Priority:** P2 — Medium  
**Severity:** Dead code increases file size and confusion  
**Estimated Effort:** 1 day  
**Owner:** Unassigned

---

## Problem

`routes/assessment/review.ts` contains deprecated endpoints that were superseded by the review session v2 API. They are still wired but undocumented and untested.

### Why This Is Bad

- New developers see old endpoints and assume they are current.
- The file is 1,453 lines — removing legacy endpoints would reduce it by ~200 lines.
- Legacy endpoints may have security issues that are not maintained.

---

## Evidence

Review `review.ts` for comments like:
```ts
// TODO: deprecated — remove after v2 migration
// Legacy endpoint for old review flow
```

Also check `src/index.ts` for route mounts that are not documented in the API spec.

---

## Solution

### Step 1: Identify Legacy Endpoints

Audit `review.ts` and list all routes. Cross-reference with:
- Frontend code (which endpoints does the UI actually call?)
- API documentation
- E2E tests

### Step 2: Add Deprecation Headers

For endpoints that must remain temporarily:
```ts
app.post('/rpc/review/legacy-submit', async (c) => {
  c.header('Deprecation', 'true');
  c.header('Sunset', 'Sat, 31 Jul 2026 00:00:00 GMT');
  // ... legacy logic
});
```

### Step 3: Delete or Move

- Delete endpoints with zero callers.
- Move endpoints with niche callers to `routes/assessment/reviewLegacy.ts` with a clear deprecation notice.

### Step 4: Update Frontend

Ensure the frontend does not call legacy endpoints. If it does, migrate those calls first.

---

## Acceptance Criteria

- [ ] Legacy endpoints are identified and documented.
- [ ] Zero-usage endpoints are deleted.
- [ ] Remaining legacy endpoints have `Deprecation` and `Sunset` headers.
- [ ] `review.ts` is under 1,200 lines.

## Related

- TD-001 (god route files) — deleting legacy code is the fastest way to shrink a god file.
