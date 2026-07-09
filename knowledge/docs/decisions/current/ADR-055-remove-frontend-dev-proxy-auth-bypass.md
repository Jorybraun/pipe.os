# ADR-055: Remove Frontend Dev Proxy Auth Bypass

**Date:** 2026-07-09
**Status:** Accepted
**Deciders:** Product owner
**Depends on:** ADR-031 (security posture)

## Context

The frontend previously supported a `?devProxyAuth=1` query-parameter bypass for local development and `app-dev.hire-pipe.com`. When active, it:

- Skipped `ClerkProvider` in `main.tsx`.
- Rendered `DevProxyAuthWrapper` instead of `ClerkAuthGate` in `App.tsx`.
- Returned a hardcoded `dev-user` from `useClerkAuth()` so components could call recruiter API routes without a real Clerk session.
- Speculatively prefetched API responses in `devProxyPrefetch.ts` to avoid the auth cold-start.

This created two operational problems:

1. **Request spam bug.** Many components imported `useClerkAuth()` directly. Because `useClerkAuth()` built new `getToken`/`getSessionToken` closures on every render, any hook that put `getToken` in a `useEffect` or `useCallback` dependency array would re-run continuously. `usePipelines` triggered an endless loop of `GET /api/v1/pipelines` calls.
2. **Security bypass surface.** A discoverable query parameter allowed unauthenticated access to recruiter routes in local and `app-dev` environments. The security audit (SR-001) classifies auth bypasses as high/critical risk and recommends gating them behind explicit environment checks or removing them entirely.

## Decision

Remove the frontend `?devProxyAuth=1` auth bypass entirely.

- `main.tsx` now renders `ClerkProvider` whenever `VITE_CLERK_PUBLISHABLE_KEY` is set, and `App` with `recruiterAuthUnavailable={true}` otherwise.
- `App.tsx` no longer has a `DevProxyAuthWrapper` branch; recruiter routes always render through `ClerkAuthGate` and `ClerkAuthWrapper`.
- `useClerkAuth()` is internal to `ClerkAuthGate` and is no longer re-exported from `providers/clerk` for consumer use.
- Consumers that previously imported `useClerkAuth` from `providers/clerk` now receive the context-backed `useAuth()` hook from `PipeProviderRoot`, which is stable once `ClerkAuthWrapper` sets it.
- Deleted `devProxyAuth.ts`, `devProxyPrefetch.ts`, and related test files. Removed prefetch logic from `createApiClient`.

## Consequences

### Positive

- The repeated `GET /api/v1/pipelines` requests stop because `useAuth()` returns a stable auth object from context; `ClerkAuthWrapper` uses `useCallback`/`useMemo` and deduplicates `setAuth` calls.
- No query-parameter auth bypass remains on the frontend recruiter surface.
- Local development must now configure `VITE_CLERK_PUBLISHABLE_KEY` and use Clerk test users, matching production auth behavior and catching auth-related bugs earlier.

### Negative

- Local dev setup requires a Clerk publishable key. The team can use Clerk testing tokens in Playwright/local scripts instead of the bypass.
- Any local tooling that relied on `?devProxyAuth=1` must be updated to authenticate with Clerk.

## Related

- SR-001: Authentication & Authorization security audit (high/critical auth bypass findings).
- Roadmap Phase 0: "Normalize bypass call sites."
