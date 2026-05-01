# Testing Plan: FEATURE_NAME

**Feature:** <!-- one-line description -->
**Shipped:** <!-- date -->
**Author:** <!-- name -->
**Status:** <!-- In Progress / Ready for QA / Complete -->

---

## 1. Unit Tests

<!-- What is covered by automated unit tests -->

| File | Tests | Status |
|------|-------|--------|
| `path/to/test.ts` | 0 | 🚧 Not started |

### Run

```bash
# Backend
npx vitest run path/to/test.ts

# Frontend
npx vitest run src/path/to/test.tsx
```

---

## 2. Integration Tests

<!-- API routes, DB persistence, external service mocking -->

| Endpoint / Flow | Coverage | Status |
|-----------------|----------|--------|
| `GET /api/v1/...` | None | 🚧 Not started |

### Run

```bash
# If integration tests exist
npx vitest run src/lib/integration/...
```

---

## 3. Smoke Tests (Manual — Under 2 Minutes)

<!-- Step-by-step instructions a human can follow on staging or local -->

### Prerequisites

- [ ] Environment: <!-- local / staging / prod -->
- [ ] Data setup: <!-- seed data needed -->
- [ ] Tools: <!-- browser, curl, etc. -->

### Steps

| Step | Action | Expected Result | Status |
|------|--------|-----------------|--------|
| 1 | <!-- do this --> | <!-- see this --> | 🚧 Not tested |
| 2 | <!-- do this --> | <!-- see this --> | 🚧 Not tested |

---

## 4. E2E Tests

<!-- Playwright specs or manual browser flows -->

| Flow | Spec File | Status |
|------|-----------|--------|
| <!-- description --> | `e2e/...spec.ts` | 🚧 Not started |

### Run

```bash
npx playwright test e2e/...spec.ts
```

---

## 5. Regression Risks

<!-- What existing features could this break? -->

| Feature | Risk Level | Mitigation |
|---------|-----------|------------|
| <!-- feature --> | Low / Med / High | <!-- how we prevent breakage --> |

---

## 6. Sign-off

| Role | Name | Date | Status |
|------|------|------|--------|
| Implementer | | | 🚧 |
| QA / Smoke | | | 🚧 |
