# Repair M-004: Atomic Repo Packet Persistence and Parser-Failure Gating

**Status:** Dispatch now  
**Source review:** review-M-004

## Objective

Fix repo ingestion/challenge packet hardening so failed validation cannot leave
partial source graph writes and parser/full-source failures cannot produce
production-ready packets.

## Ownership

- `workers/api/scripts/backfillReviewChallengePackets.ts`
- `workers/api/src/lib/repoSemanticGraph/challengePacket.ts`
- `workers/api/src/lib/repoSemanticGraph/persistence.ts`
- repo semantic graph tests

## Non-Goals

- Do not edit matcher, living-context, or evaluation files.
- Do not introduce generic fallback packets or fixed semantic taxonomies.

## Acceptance

- Persistence validates before writes or uses a transaction/rollback so failed
  packet validation leaves no partial artifacts/spans/symbols.
- Parser/full-source fetch failure makes production-language packets ineligible
  or skipped with an explicit reason.
- Tests assert validation failure leaves no partial source/artifact/symbol rows.
- Tests assert parser/source fetch failure cannot persist a production-ready
  packet.
- Focused repo semantic graph tests pass.
