# Backend Technical Debt Index

> Last updated: 2026-05-02
> Scope: `workers/api/src/`
> Overall Health: C+ (Functional but significantly leveraged)

## How to Use This Index

Each entry links to a detailed plan file. Status follows the tracker convention:

- `🔴 PENDING` — Not started, blocking or high-risk
- `🟡 IN-PROGRESS` — Someone is actively working on it
- `🟢 DONE` — Resolved and verified
- `⚪ DEFERRED` — Acknowledged but intentionally postponed

---

## P0 — Critical (Do Not Ignore)

| # | Problem | Status | File |
|---|---------|--------|------|
| TD-001 | God route files (>1,000 lines) are unmaintainable | 🔴 PENDING | [TD-001-god-route-files.md](./TD-001-god-route-files.md) |
| TD-002 | Duplicated LLM utility logic across 6+ files | 🔴 PENDING | [TD-002-duplicated-llm-utilities.md](./TD-002-duplicated-llm-utilities.md) |
| TD-003 | Auth middleware is completely untested | 🔴 PENDING | [TD-003-untested-auth-middleware.md](./TD-003-untested-auth-middleware.md) |
| TD-004 | 146 JSON.parse calls without runtime validation | 🔴 PENDING | [TD-004-unvalidated-json-parse.md](./TD-004-unvalidated-json-parse.md) |

## P1 — High (Schedule Soon)

| # | Problem | Status | File |
|---|---------|--------|------|
| TD-005 | console.* logging instead of structured logger | 🔴 PENDING | [TD-005-structured-logging.md](./TD-005-structured-logging.md) |
| TD-006 | Inline BARS rubrics bloat cultureScorer.ts | 🔴 PENDING | [TD-006-inline-bars-rubrics.md](./TD-006-inline-bars-rubrics.md) |
| TD-007 | Test stubs duplicated 16+ times | 🔴 PENDING | [TD-007-duplicated-test-stubs.md](./TD-007-duplicated-test-stubs.md) |
| TD-008 | Critical business routes have zero tests | 🔴 PENDING | [TD-008-untested-business-routes.md](./TD-008-untested-business-routes.md) |
| TD-009 | Hardcoded thresholds and magic numbers | 🔴 PENDING | [TD-009-hardcoded-thresholds.md](./TD-009-hardcoded-thresholds.md) |
| TD-010 | ~20 local *Row types fragment central types.ts | 🔴 PENDING | [TD-010-fragmented-row-types.md](./TD-010-fragmented-row-types.md) |
| TD-011 | MOCK_AI global flag leaks into production | 🔴 PENDING | [TD-011-mock-ai-flag.md](./TD-011-mock-ai-flag.md) |
| TD-012 | calibrate.ts duplicates provider factory logic | 🔴 PENDING | [TD-012-calibrate-provider-duplication.md](./TD-012-calibrate-provider-duplication.md) |

## P2 — Medium (Refactor When Touching)

| # | Problem | Status | File |
|---|---------|--------|------|
| TD-013 | Raw D1 SQL with no typed query builder | 🔴 PENDING | [TD-013-typed-d1-wrapper.md](./TD-013-typed-d1-wrapper.md) |
| TD-014 | roleAgentPrompts.ts migration never completed | 🔴 PENDING | [TD-014-role-agent-prompts-migration.md](./TD-014-role-agent-prompts-migration.md) |
| TD-015 | Culture agent static/adaptive boundary is unclear | 🔴 PENDING | [TD-015-culture-agent-boundary.md](./TD-015-culture-agent-boundary.md) |
| TD-016 | Deprecated legacy endpoints in review.ts | 🔴 PENDING | [TD-016-legacy-review-endpoints.md](./TD-016-legacy-review-endpoints.md) |
| TD-017 | Provider factory sprawl in createProvider.ts | 🔴 PENDING | [TD-017-provider-factory-sprawl.md](./TD-017-provider-factory-sprawl.md) |
| TD-018 | 53 as-unknown casts in production code | 🔴 PENDING | [TD-018-as-unknown-casts.md](./TD-018-as-unknown-casts.md) |

## P3 — Low (Nice to Have)

| # | Problem | Status | File |
|---|---------|--------|------|
| TD-019 | Types.ts is a 1,489-line god file | 🔴 PENDING | [TD-019-types-ts-monolith.md](./TD-019-types-ts-monolith.md) |
| TD-020 | Durable Objects have no integration tests | 🔴 PENDING | [TD-020-untested-durable-objects.md](./TD-020-untested-durable-objects.md) |

---

## Quick Stats

| Metric | Count |
|--------|-------|
| Total problems tracked | 20 |
| P0 (Critical) | 4 |
| P1 (High) | 8 |
| P2 (Medium) | 6 |
| P3 (Low) | 2 |
| 🔴 PENDING | 20 |
| 🟡 IN-PROGRESS | 0 |
| 🟢 DONE | 0 |

## Recommended Sequencing

1. **Week 1**: TD-002 (extract utilities) → TD-004 (Zod validation) → TD-003 (auth tests)
2. **Week 2**: TD-001 (split routes) — one route per PR
3. **Week 3**: TD-008 (business route tests) + TD-007 (test utilities)
4. **Week 4**: TD-005 (structured logging) + TD-009 (hardcoded thresholds)
5. **Ongoing**: TD-010, TD-012, TD-013, TD-014 as background refactors during feature work
