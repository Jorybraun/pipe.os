# Assessment — Role Discovery (Discovery Segment)

> **Snapshot date:** 2026-04-06
> **Verified by:** running `vitest`, reading the source, comparing against the state chart
> **Status:** Backend tested and likely working. Frontend untested. Multi-stakeholder, voice, JD parser, and resume paths have unverified gaps.

This is a point-in-time assessment. **Do not trust it without re-running the verification commands at the bottom.** Code changes invalidate it within days.

---

## What this segment owns

The **Discovery** segment of the funnel: turning a recruiter's intent into a structured role spec via the Role Discovery Agent. State machine, multi-stakeholder support, voice input, JD parsing, synthesis output. Hands off to the Pipeline Builder once the role context is `COMPLETE`.

Lives at `workers/api/src/routes/discovery/roleContexts.ts` + `workers/api/src/lib/roleAgent*.ts` + `src/hooks/useRoleDiscovery.ts` + `src/pages/RoleDiscoveryPage.tsx`.

---

## State machine (verified against code)

Frontend phases (`useRoleDiscovery.ts:24`):
```
IDLE → BASELINE → CALIBRATING → INTERVIEWING → COMPLETE
```

Backend statuses on `role_contexts` and `role_context_participants`:
```
BASELINE | CALIBRATING | INTERVIEWING | COMPLETE | ABANDONED
```

Parent `role_contexts.status` flips to `COMPLETE` only when **all** participants are `COMPLETE`. `ABANDONED` is a valid value but nothing automatically writes it.

Full state chart with route pointers: see chat history 2026-04-06 (not duplicated here to avoid drift).

---

## Confidence table

| Capability | Confidence | Why |
|---|---|---|
| Backend state machine (BASELINE → CALIBRATING → INTERVIEWING → COMPLETE) | **High** | 22/22 unit tests pass, real handler bodies, mock fallback works |
| Mistral question generation (real LLM path) | **Medium** | Mock path is tested; real API path worked last manual run, no automated coverage |
| Tool calling (`research_company`, `search_technology` via ReAct loop) | **Low/Medium** | Code complete, but no test exercises a full tool round-trip — silent breakage when Mistral changes function-calling format |
| Frontend phase transitions (`useRoleDiscovery` hook) | **Unverified** | `useRoleDiscovery.test.ts` exists but **9/9 failing** on Clerk provider not mocked. Zero coverage of the React state machine |
| Voice transcribe (`/transcribe` via Workers AI Whisper) | **Low** | Handler exists, requires `c.env.AI` binding, no automated test |
| JD parser (`/parse-jd` for paste + PDF upload) | **Low** | Handler exists, calls Mistral, no automated test |
| Multi-stakeholder invite flow (ADR-028) | **Low** | Code wired (POST `/:id/invite` writes participant + Resend email), but **no test proves a second participant can land, complete, and merge into shared `knowledge_state`** |
| Resume after browser close | **Known broken** | Data model supports it (participant row persists with `INTERVIEWING`); frontend has no re-entry path. Close tab → start over |
| `ABANDONED` status transition | **Not wired** | Status value exists, no code path writes it; would require manual SQL |

---

## What works in the happy path

A solo recruiter who: signs in, lands on `/pipeline/new`, fills the baseline form, answers the calibration question, walks through ~10 questions, sees the synthesis, and clicks "Create Pipeline" — **almost certainly works**, because it's the path that's been demoed manually and would have visibly broken otherwise.

## What's at risk if a real user does anything unusual

- Closes the tab mid-interview and comes back later
- Invites a teammate via the multi-stakeholder flow
- Uploads a JD PDF instead of typing the baseline manually
- Uses voice input (especially on mobile Safari)
- The agent decides to use the `research_company` tool
- Mistral returns malformed JSON

None of these paths are protected by automated tests.

---

## Test coverage detail

| Test file | Status | Covers |
|---|---|---|
| `workers/api/src/__tests__/roleDiscovery.test.ts` | ✅ 22/22 passing | Backend route handlers, state transitions, mock agent path |
| `src/hooks/useRoleDiscovery.test.ts` | ❌ 9/9 failing | Would cover frontend state machine — fails on `useClerkAuth()` provider missing |
| `e2e/role-discovery.spec.ts` | ❌ Does not exist | Would cover happy-path browser journey |
| Multi-stakeholder integration test | ❌ Does not exist | Would prove invite + merge actually works |

---

## Next moves to raise confidence

In order of leverage (smallest fix → biggest payoff first):

1. **Fix `useRoleDiscovery.test.ts` Clerk provider mock** — ~10 lines of test setup. Unblocks 9 existing tests. Moves frontend confidence from Unverified to High in one shot.
2. **Write one Playwright spec for the happy path** — ~50 lines. Mock Mistral. Drives baseline form → calibration → 5 questions → synthesis → pipeline creation in a real browser. Catches integration bugs unit tests can't see.
3. **Integration test for multi-stakeholder invite** — Two participants, one parent. Verify the second person can land on the invite link, run their interview, and have their answers merge into the shared `knowledge_state`. Highest-risk untested capability.
4. **Nightly Mistral smoke test** with a real API key (gated to CI on `main`) to catch tool-calling format regressions before users see them.
5. **Decide on resume-after-close** — either implement the re-entry path or document it as a known limitation in the UI ("If you close this tab, you'll need to start over"). Currently it's silently broken.

Items 1–3 are tracked in `TASK.md`.

---

## How to re-verify this assessment

```bash
# Backend role discovery tests
cd workers/api && ./node_modules/.bin/vitest run roleDiscovery

# Frontend hook test
./node_modules/.bin/vitest run useRoleDiscovery

# Search for new TODO/FIXME in the segment
rg -n "TODO|FIXME|XXX|HACK" workers/api/src/routes/discovery workers/api/src/lib/roleAgent*

# Confirm route handlers haven't been stubbed
wc -l workers/api/src/routes/discovery/roleContexts.ts workers/api/src/lib/roleAgent.ts
```

If any of these commands return materially different results from what's documented above, **this assessment is stale and should be regenerated, not patched.**
