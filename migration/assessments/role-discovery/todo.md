# Role Discovery — TODO

> **Created:** 2026-04-06 from the role-discovery assessment.
> **Scope:** Only items needed to raise confidence in the Discovery segment from "demo works" to "real users won't break it."
> **Not in scope:** New features, scope expansion, anything cosmetic.

Items are ordered by leverage — smallest fix with biggest payoff first. Mark `[x]` when done. Delete the item entirely once it ships and is verified, don't leave a graveyard.

---

## P0 — Coverage gaps that can ship a real bug today

- [ ] **Fix `useRoleDiscovery.test.ts` Clerk provider mock**
  - Failing tests: 9/9
  - Root cause: `useApiClient()` calls `useClerkAuth()` which throws because the test doesn't wrap the hook in `<ClerkProvider>`
  - Fix: add a Clerk test provider in `src/test/setup.ts` (or per-test wrapper) that stubs `getToken()`
  - Verification: `./node_modules/.bin/vitest run useRoleDiscovery` → 9/9 passing
  - Effect: moves frontend-state-machine confidence from Unverified → High in one shot
  - Estimated touch: ~10–20 lines, one file

- [ ] **Write one Playwright spec for the happy path**
  - File: `e2e/role-discovery-happy-path.spec.ts`
  - Scenario: sign in (Clerk test mode) → go to `/pipeline/new` → fill baseline → answer calibration → answer 5 questions → see synthesis → click "Create Pipeline" → land on overview
  - Mock Mistral via `MOCK_AI=true` in test env
  - Verification: `npx playwright test role-discovery-happy-path` green
  - Effect: catches integration bugs unit tests structurally cannot see
  - Estimated touch: ~50–80 lines, one new file

- [ ] **Integration test for multi-stakeholder invite**
  - Highest-risk untested capability — the merge logic in `roleAgentPrompts.ts` is non-trivial and has zero coverage
  - Scenario: participant A (creator) completes interview → invites participant B → participant B lands on invite link → completes their interview → assert shared `knowledge_state` contains contributions from both, with perspective fields keyed by participant_role
  - Can be a vitest integration test against the Worker (no browser needed)
  - Verification: new test in `workers/api/src/__tests__/`
  - Effect: makes ADR-028 (Multi-Stakeholder Discovery) actually defensible

---

## P1 — Known gaps that aren't bugs but will become bugs

- [ ] **Decide on resume-after-close**
  - Today: close tab mid-interview → next visit starts over. Data model supports resume; frontend doesn't.
  - Option A: implement re-entry — `useRoleDiscovery` checks for in-progress participant on mount, restores state from server
  - Option B: document the limitation in the UI — banner saying "Don't close this tab — your progress won't be saved"
  - Decision needed before MVP. Pick one. Don't leave it silently broken.

- [ ] **Wire `ABANDONED` status or remove it**
  - Currently a valid enum value with zero code paths writing it
  - Either: add a cron/cleanup that flips stale `INTERVIEWING` rows to `ABANDONED` after N days, OR remove the value from the type to stop pretending it exists

## P2 — Insurance, not blockers

- [ ] **Nightly Mistral smoke test in CI**
  - One test that calls the real Mistral API with a small fixed prompt and asserts the response shape is what `roleAgent.ts` expects
  - Gated to `main` branch on a nightly schedule (not on every PR — costs money)
  - Catches Mistral function-calling format changes before users see them
  - Requires: `MISTRAL_API_KEY` secret in GitHub Actions

- [ ] **Tool-calling end-to-end test**
  - Currently `research_company` and `search_technology` tools exist in `roleAgent.ts` but no test exercises a full ReAct round-trip
  - Either mock Mistral's tool-call response and assert the tools get invoked, OR cover this in the nightly smoke test above

---

## Done — recently shipped (delete after one week)

(empty)

---

## How to update this file

1. When you start a P0 item, do not mark `[ ]` as in-progress — just work on it. This file is for what's not done, not for tracking active work.
2. When you finish, delete the item or move to "Done" with a one-line note.
3. If a new gap surfaces during work, add it under the right priority bucket.
4. If this file grows past one screen, something has gone wrong — close items don't accumulate, they get deleted.

If the assessment in `README.md` becomes stale (verification commands at the bottom return different results), regenerate it instead of patching this todo.
