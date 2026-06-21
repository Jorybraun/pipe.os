# Repair M-005: Honest Match Explanation Gaps and UI Contract

**Status:** Dispatch now  
**Source review:** review-M-005

## Objective

Fix match explanations so excluded evidence and rejected packets remain
explainable, and the frontend contract can display production-readiness
rejections correctly.

## Ownership

- `workers/api/src/lib/challengeMatching/d1Matcher.ts`
- `workers/api/src/lib/challengeMatching/types.ts`
- challenge matching tests
- `src/lib/api/types.ts`
- `src/components/Candidate/LivingContextGraph.tsx`
- focused frontend tests if existing/needed

## Non-Goals

- Do not edit repo semantic graph persistence.
- Do not edit living-context persistence.
- Do not fabricate default evidence to make explanations fuller.

## Acceptance

- DB-loaded candidate rows with null evidence fields are retained as excluded
  evidence for explanations, not dropped before diagnostics.
- Role-guardrail rejected packets include available repo/PR context.
- `PACKET_NOT_PRODUCTION_READY`, `gateFailures`, and `qualityScore` are present
  in shared API/frontend contract and display correctly.
- Tests cover incomplete DB evidence and packet-not-production-ready UI/type
  behavior.
- Focused worker/frontend type checks pass if feasible.
