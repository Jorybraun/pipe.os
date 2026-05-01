# Smoke Test Checklist — May 1, 2026 Commits

**Date:** 2026-05-01
**Environment:** staging or local
**Estimated time:** 8–10 minutes total

---

## Test Credentials

| Account | Email | Password | Notes |
|---------|-------|----------|-------|
| **Recruiter (Clerk)** | `e2e-test@pipe.dev` | `PipeE2E_Test2026!` | Used by Playwright E2E suite. Set `E2E_EMAIL` / `E2E_PASSWORD` env vars to override. |
| **Candidate (assess link)** | Varies per seed | N/A | Candidate login is token-based via `/assess/:inviteToken`. Generate a candidate first, then use their `inviteToken`. |

### Quick API Auth (for curl checks)

If you need a bearer token for backend smoke tests:

1. Log in as recruiter in the browser
2. Open DevTools → Application → Cookies → `__session`
3. Copy the JWT value
4. Use it in curl: `-H "Authorization: Bearer <jwt>"`

Or use the Playwright saved auth state:
```bash
cat playwright/.auth/user.json | jq '.cookies[] | select(.name=="__session") | .value'
```

### E2E Seeds

The E2E suite seeds a fresh pipeline + candidate for most tests. Reference these fixtures if you need pre-made data:
- `playwright/candidate-token.json` — candidate JWT tokens
- `playwright/fresh-candidate-token.json` — newly created candidate tokens
- `playwright/code-review-token.json` — candidate assigned to a code-review challenge

---

## 1. Role Discovery RCD Synthesize + questionStack Fix
**Commit:** `958a3a379`

| Step | Action | Expected | ✓ |
|------|--------|----------|---|
| 1 | Start a new role discovery session (pipeline → Role Discovery) | Session loads, first question appears | [ ] |
| 2 | Answer 2–3 questions | Answers save without error | [ ] |
| 3 | Click "Synthesize" (or wait for auto-synthesize) | Returns persona + job description + RCD JSON (check Network tab for `rcd` field in response) | [ ] |
| 4 | Open browser DevTools → Network → find latest `/question` call | Response status 200 (not 422). `questionStack` array present with ≥1 item | [ ] |

**If broken:** Synthesize fails, 422 on /question, or missing `rcd` in response.

---

## 2. Enriched Decomposition in Matching
**Commit:** `d22bd9b45`

| Step | Action | Expected | ✓ |
|------|--------|----------|---|
| 1 | Upload a resume with ≥2 experiences and ≥2 skills | Ingestion completes (status → `matched`) | [ ] |
| 2 | Open candidate profile → ENRICHMENT tab | Match Score section visible with triangulated score | [ ] |
| 3 | In server logs, grep for `promptVersion` on this candidate | Value is `v3-graph-enriched` (not `v2-graph` or `v1`) | [ ] |
| 4 | Check `candidate_nodes` for this candidate | `CareerArc` node exists with `domain_specialization`, `ownership_progression`, `impact_themes` in `extracted_properties_json` | [ ] |

**If broken:** Match score missing, prompt version stuck at `v2-graph`, or CareerArc node absent.

---

## 3. Candidate Intake Modal (Light Mode)
**Commit:** `109444721`

| Step | Action | Expected | ✓ |
|------|--------|----------|---|
| 1 | Switch browser/OS to light mode | PIPE UI renders in light theme | [ ] |
| 2 | Click "Invite Candidate" (or any action that opens `CandidateIntakeModal`) | Modal opens with white/light background, readable text | [ ] |
| 3 | Look at the modal overlay | Overlay is semi-transparent gray (not near-black) | [ ] |
| 4 | Look at form labels and inputs | Labels are bold/readable, dropzone border visible | [ ] |

**If broken:** Modal is dark-on-dark, overlay is too dark, or text is unreadable.

---

## 4. Candidate Data Integration (Enrichment Tab)
**Commit:** `d9867c7ab`

| Step | Action | Expected | ✓ |
|------|--------|----------|---|
| 1 | Open any candidate that has completed ingestion (status = `matched` or `profile_generated`) | Candidate profile loads | [ ] |
| 2 | Click ENRICHMENT tab | Tab is visible and clickable | [ ] |
| 3 | In ENRICHMENT tab | AI PROFILE card shows searchable profile text | [ ] |
| 4 | Scroll down | CAREER CONTEXT card shows situation signature tags | [ ] |
| 5 | Scroll down | ENRICHMENT STATUS card shows status badge + timestamps | [ ] |
| 6 | Scroll down (only if matched) | REPO MATCH card shows score + dimension bars + repo name | [ ] |
| 7 | Go back to pipeline overview / kanban view | Candidate cards show match score pills and status badges | [ ] |

**If broken:** ENRICHMENT tab missing, cards empty, or sidebar badges absent.

---

## 5. Cloudflare AI Model Env Var
**Commit:** `effad57a6`

| Step | Action | Expected | ✓ |
|------|--------|----------|---|
| 1 | In worker env, set `CLOUDFLARE_AI_MODEL=@cf/zai-org/glm-4.7-flash` | Variable configured | [ ] |
| 2 | Trigger any AI call (resume parse, role discovery question, candidate ingestion) | Call succeeds, uses the specified model (check worker logs for model name) | [ ] |
| 3 | Remove `CLOUDFLARE_AI_MODEL` (default) | Call still succeeds, falls back to default Llama 3.1 8B | [ ] |

**If broken:** AI calls fail with model-not-found, or ignore the env var.

---

## 6. CV Parser v2 + GitHub Enrichment v2
**Commit:** `ba4d7fcc5`

| Step | Action | Expected | ✓ |
|------|--------|----------|---|
| 1 | Upload a multi-page PDF resume with experience blocks that include dates in parentheses (e.g., "Engineer (2020–2022)") | Upload succeeds | [ ] |
| 2 | Wait for ingestion to complete | Status progresses: pending → profile_generated → embedded → matched | [ ] |
| 3 | Check parsed candidate data | Experience entries do NOT include "(2020–2022)" in company/role fields (duration parentheticals stripped) | [ ] |
| 4 | If resume has a GitHub handle, or manually set `github_url` on candidate | After enrichment job runs, `candidate_nodes` contains: CulturalSignal, ≥1 Project, ≥1 Skill, Experience nodes for external PRs | [ ] |
| 5 | Check CulturalSignal node | `extracted_properties_json` includes `top_languages`, `owned_repos`, `external_contributions` | [ ] |

**If broken:** Parser crashes on PDF, duration text leaks into fields, or GitHub nodes missing.

---

## 7. GitHub Contribution Calendar + Dynamic Profile
**Commit:** `01a6a7fa2`

| Step | Action | Expected | ✓ |
|------|--------|----------|---|
| 1 | Set a candidate's GitHub URL to a real handle (e.g., `https://github.com/torvalds`) | Saved | [ ] |
| 2 | Trigger GitHub enrichment (re-upload resume, or run enrichment job) | Enrichment completes | [ ] |
| 3 | Open candidate profile → ENRICHMENT tab | "GITHUB ACTIVITY" card visible with green contribution grid | [ ] |
| 4 | Hover over a green square | Tooltip shows date + count | [ ] |
| 5 | Open DevTools → Network → candidate API call | Response contains `profileSections` array with `type` and `props` for each section | [ ] |
| 6 | Check `candidate_ingestion` row directly | `github_calendar_json` and `profile_sections_json` both contain valid JSON | [ ] |

**If broken:** No GITHUB ACTIVITY card, contribution grid missing, API lacks `profileSections`, or DB columns null.

---

## Quick Regression Sweep (2 min)

Run these to make sure nothing else broke:

| Check | How | Expected | ✓ |
|-------|-----|----------|---|
| Backend compiles | `cd workers/api && npx tsc --noEmit` | No errors in changed files | [ ] |
| Frontend compiles | `npx tsc --noEmit -p tsconfig.json` | No errors in changed files | [ ] |
| Unit tests | `cd workers/api && npx vitest run` | All pass | [ ] |
| Pipeline overview loads | Open any pipeline | Stages + candidates render | [ ] |
| Invite candidate | Click invite, fill form | Modal closes, candidate appears in list | [ ] |

---

## Sign-off

| Role | Name | Date | ✓ |
|------|------|------|---|
| Smoke tester | | | [ ] |
