# QA Bug Tracker — PIPE-OS E2E Smoke Test

**Session Date:** 2026-05-01  
**Tester:** Kimi Code CLI (QA Bot)  
**Test Pipeline:** Staff AI Engineer — Cosine Test (`664c0cee64914fa54bf91a16d8c45237`)  
**Test Candidate:** Hans Elke (`a875029a-9520-47f9-abcc-26e2b84b9efd`)  
**Environment:** Local dev (`localhost:5173` / `localhost:8787`)

---

## 🚨 CRITICAL

| # | Bug | Repro | Expected | Actual | Notes |
|---|-----|-------|----------|--------|-------|

*None yet.*

---

## 🔴 HIGH

| # | Bug | Repro | Expected | Actual | Notes |
|---|-----|-------|----------|--------|-------|
| H1 | Cosine similarity score missing in UI after resume upload | Upload PDF resume to candidate; wait for ingestion | Score shown in stage card and pipeline overview | Shows `—` / `MATCH: — · —` | `candidate_ingestion` row stuck at `pending` with `roleCandidateCosine=null`. Root cause: `runCandidateIngestion` requires live Cloudflare AI + Vectorize bindings; local dev `wrangler dev` remote proxy fails, blocking ingestion completion. |
| H2 | **ALL pipelines show `—` for AVG SCORE** — systemic issue | View dashboard listing any pipeline with candidates | AVG SCORE shows computed value | Every pipeline shows `—` | Not limited to our test pipeline. Suggests score calculation is broken globally or the display field is not wired to the data source. |
| H3 | Candidate detail API returns `ingestion: null` despite DB row existing | `GET /api/v1/candidates/:id` for candidate with ingestion data | Returns ingestion object with status, scores, dimensions | `ingestion: null`, `score: null` | The ingestion data exists in `candidate_ingestion` table (confirmed via `/ingestion` endpoint), but candidate detail endpoint returns null. Likely `.first()` returning null when LEFT JOIN produces all-NULL columns, or query logic bug at line 556 of `candidates.ts`. |
| H4 | **XSS payload accepted and stored raw in candidate name** | `POST /api/v1/pipelines/:id/candidates` with name `"<script>alert(1)</script>"` | Name sanitized or rejected | Stored exactly as `<script>alert(1)</script>` | API accepts raw HTML/JS in candidate name with no sanitization. If frontend renders without escaping, this is an XSS vulnerability. |
| H5 | **Duplicate candidate emails allowed in same pipeline** | Create two candidates with same email in one pipeline | Second creation rejected with "email already exists" | Both created successfully with separate IDs and invite tokens | No unique constraint on `(pipeline_id, email)`. Causes confusion and duplicate invites. |

---

## 🟡 MEDIUM

| # | Bug | Repro | Expected | Actual | Notes |
|---|-----|-------|----------|--------|-------|
| M1 | INTELLIGENCE tab on candidate profile is unresponsive | Click INTELLIGENCE tab on candidate profile page | Tab content switches to intelligence panel | Nothing happens; click is ignored | Possibly missing route handler, conditional render gate, or tab state not wired. May be related to H3 (no ingestion data to display). |
| M2 | Ingestion pipeline silently fails when AI provider unavailable | Upload resume in local dev with `wrangler dev` remote proxy down | Clear error surfaced to user or graceful degraded mode | Status stays `pending` forever with no feedback | `createCandidateAgentProvider(env)` returns null → early return; no user-visible error. Candidate profile shows no indication of processing failure. |
| M3 | DOCX resume uploads to R2 but is not parsed | Upload `.docx` resume via upload endpoint | Either parsed or clear error shown | File stored in R2, `parsed: null`, enrichment job queued but ingestion skipped | `parseResume` returns null for non-PDF; `processResumeFromR2` skips ingestion for non-PDF. User may think upload succeeded fully. |
| M4 | Browser tab crashes to blank/black after navigation | Navigate to `/cockpit/pipelines/:id` then attempt further navigation | Page renders normally | Tab goes completely black; React app unmounts/crashes | First tab became unrecoverably blank after multiple navigation attempts. New tab works. Possible memory leak or React Router issue. |
| M5 | Direct URL navigation to `/cockpit/pipelines/:id` redirects to dashboard | Enter pipeline detail URL directly in address bar | Pipeline detail view opens | Redirected to `/` (dashboard) | Pipeline detail appears to be a modal/overlay on the dashboard, not a standalone route. Breaks deep-linking and refresh behavior. |
| M6 | Filter panel items not keyboard/screen-reader accessible | View dashboard filter panel on right side | Filter items are interactive buttons or links | Filter items rendered as `StaticText` with no `ref` or clickable role | ALL_STATUS, ACTIVE, DRAFT, ARCHIVED are StaticText nodes. No keyboard navigation or screen reader support. |
| M7 | Pipeline actions menu only shows DELETE option | Click "Pipeline actions" button on any pipeline card | Menu shows multiple options: View, Edit, Delete, etc. | Only shows "DELETE" | No way to view pipeline details from the actions menu. User must click elsewhere on the card (which is not accessibility-tree exposed). |
| M8 | Candidate name length validation rejects >200 chars but error is generic | `POST` candidate with 500-char name | Clear error: "Name must be at most 200 characters" | Generic "VALIDATION_ERROR" with "String must contain at most 200 character(s)" | Error message doesn't specify which field failed validation. |
| M9 | No 404 page — unknown routes redirect to dashboard | Navigate to `/nonexistent-route-12345` | 404 Not Found page shown | Redirected to dashboard `/` | Catch-all route handler redirects all unknown URLs to dashboard. Poor UX for broken links. |

---

## 🟢 LOW

| # | Bug | Repro | Expected | Actual | Notes |
|---|-----|-------|----------|--------|-------|
| L1 | Timeline shows "SUBMITTED → PENDING" for recruiter-invited candidate | Invite candidate via API; view candidate profile timeline | Timeline reflects invite origin (e.g. "INVITED → PENDING") | Shows "SUBMITTED → PENDING" | Candidate never self-submitted; was recruiter-invited. |
| L2 | Overall Signal badge shows "MAYBE" with no visible numeric score | View candidate profile overall signal section | Numeric score visible alongside label | Only label "MAYBE" shown; no underlying score | May be related to H1/H3 (missing cosine score), but even without it there should be a fallback or tooltip. |
| L3 | Shared dev environment has data pollution | View test pipeline candidates | Only test candidate (Hans Elke) visible | Second candidate "Bob" (jorybraun25@gmail.com) also present | Another tester or previous run created a candidate in the same pipeline. Not a product bug per se, but indicates lack of test isolation. |
| L4 | Settings DISPLAY tab has "KEEP_PLAYING" toggle with unclear purpose | Open Settings → DISPLAY | Toggle label explains what it does | Label says "KEEP_PLAYING" with no tooltip or description | Ambiguous UI copy. User doesn't know what this toggle controls. |

---

## 🛠️ INFRA / ENV

| # | Issue | Impact | Notes |
|---|-------|--------|-------|
| I1 | `wrangler dev` remote proxy session fails | Cannot test AI/Vectorize-dependent features locally | `/accounts/.../workers/subdomain/edge-preview` returns error; blocks `env.AI` and `env.CANDIDATE_INDEX` access. |

---

## 🧪 Test Coverage Matrix

| Flow | Status | Notes |
|------|--------|-------|
| Pipeline creation via API | ✅ PASS | Created successfully, stage assigned |
| Candidate creation via API | ✅ PASS | Hans Elke created with INVITED status |
| Resume upload (PDF) | ✅ PASS | Uploaded to R2, parsed correctly |
| Resume upload (DOCX) | ⚠️ PARTIAL | Uploads to R2, parse returns null (M3) |
| Resume parse data display | ✅ PASS | Name, role, YOE, skills, education render correctly |
| Cosine score calculation | ❌ BLOCKED | H1 — needs remote AI/Vectorize |
| Stage card score display | ❌ FAIL | Shows `—` due to H1/H3 |
| Pipeline overview match display | ❌ FAIL | Shows `MATCH: — · —` due to H1/H3 |
| INTELLIGENCE tab | ❌ FAIL | M1 — unresponsive |
| OVERVIEW tab | ✅ PASS | Renders correctly |
| TIMELINE display | ⚠️ PARTIAL | Renders but incorrect origin label (L1) |
| Overall Signal badge | ⚠️ PARTIAL | Renders but missing numeric (L2) |
| Dashboard pipeline list | ✅ PASS | Renders all pipelines correctly |
| Dashboard search by title | ✅ PASS | Filters correctly, updates counts |
| Dashboard filter panel | ⚠️ PARTIAL | UI visible but not accessible (M6) |
| Pipeline insights panel | ✅ PASS | Shows total active, draft, conversion rate |
| Browser tab stability | ❌ FAIL | M4 — tab crashes after navigation |
| Deep-linking to pipeline | ❌ FAIL | M5 — redirects to dashboard |
| Settings DISPLAY tab | ✅ PASS | Mode, theme, opacity, animation all work |
| Settings INTEGRATIONS tab | ✅ PASS | Calendly, Cal.com, email, Twilio shown |
| Settings close button | ✅ PASS | Closes panel correctly |
| New Role wizard (Role Discovery) | ✅ PASS | Conversational AI wizard, 15 questions, resume session |
| New Role quick start options | ✅ PASS | Sr. Frontend, Sr. Backend, Head of Product, Staff Eng |
| New Role session recovery | ✅ PASS | Detects unfinished session, offers resume/start new |
| API error handling (401/404/validation) | ✅ PASS | Clear error codes and messages |
| File type rejection (.txt) | ✅ PASS | "Only PDF and DOCX files are accepted" |
| File size rejection (>10MB) | ✅ PASS | "File exceeds the 10 MB limit" |
| Missing file upload | ✅ PASS | "Request must be multipart/form-data" |
| Invalid candidate ID (reingest) | ✅ PASS | "Candidate not found" |
| Invalid email format | ✅ PASS | "valid email required" |
| Missing required fields | ✅ PASS | "Required" |
| Candidate invite email | ⬜ NOT TESTED | — |
| Challenge assignment | ⬜ NOT TESTED | — |
| Gate/match configuration | ⬜ NOT TESTED | — |
| Stage editor | ⬜ NOT TESTED | — |
| Pipeline builder (after wizard) | ⬜ NOT TESTED | — |
| Mobile responsive | ⬜ NOT TESTED | — |
| Dark mode toggle | ⚠️ PARTIAL | Clicked LIGHT but no visible change; needs retest |
| Error states (404, 500 UI) | ⬜ NOT TESTED | — |
| Form validation edge cases (UI) | ⬜ NOT TESTED | — |
| Data refresh / polling | ⬜ NOT TESTED | — |
| Duplicate candidate handling | ❌ FAIL | API allows duplicate emails in same pipeline (H5) |
| Bulk candidate upload | ⬜ NOT TESTED | — |
| Empty name rejection | ✅ PASS | "name is required" |
| XSS in search query | ✅ PASS | Returns 0 results safely |
| SQL injection in search | ✅ PASS | Returns 0 results safely |
| Fake PDF upload | ✅ PASS | Stored in R2, parse returns null (expected) |
| Delete candidate API | ❌ FAIL | Returns INTERNAL_ERROR |
| Phone/Calls sidebar | ✅ PASS | Empty state "No upcoming calls" renders correctly |
| Schedule sidebar | ✅ PASS | Empty state with Calendly/Cal.com buttons renders correctly |
| Outreach sidebar | ✅ PASS | Email provider panel with Gmail/Outlook buttons renders correctly |
| Repo Catalog sidebar | ✅ PASS | 2,250 repos loaded with curation UI (approve/deny/requeue) |
| AI Usage sidebar | ✅ PASS | Shows 10 FAILED sessions, 0 tokens — confirms AI provider down |
| Light mode toggle | ⚠️ PARTIAL | Clicked LIGHT but no visible change; needs retest |

---

## 📝 Raw Test Log

### 2026-05-01 — Hans Elke E2E Journey

1. **Pipeline Created** via API: `POST /api/v1/pipelines` → `664c0cee64914fa54bf91a16d8c45237`
2. **Candidate Created** via API: `POST /api/v1/candidates` → `a875029a-9520-47f9-abcc-26e2b84b9efd`
3. **Resume Upload (DOCX attempt)**: Failed — parser rejected. File stored in R2 but `parsed: null`.
4. **Resume Upload (PDF)**: Success — uploaded to `candidate-documents/.../hanselke_resume.pdf`, parsed correctly.
5. **Parse Verification**: Name "Hans Elke", role "Staff AI Engineer", 11 YOE, 8 skills, education blocks extracted.
6. **UI Navigation (First Tab)**: Logged in via WebBridge (`e2e-test@pipe.dev`), navigated to pipeline overview, clicked candidate card.
7. **Profile Page**: OVERVIEW tab renders parsed data correctly. TIMELINE shows "SUBMITTED → PENDING" (incorrect origin). Overall Signal shows "MAYBE" without numeric.
8. **INTELLIGENCE Tab**: Clicked — no response.
9. **Stage Card**: Shows `—` for cosine score.
10. **Pipeline Overview**: Shows `MATCH: — · —`.
11. **Dashboard Verification**: All 20 pipelines visible. Every pipeline shows `—` for AVG SCORE (H2).
12. **Filter Panel**: Shows ALL_STATUS / ACTIVE / DRAFT / ARCHIVED. Pipeline insights: 14 active, 6 draft, 24.2% conversion.
13. **Tab Crash**: First WebBridge tab crashed to black after navigation attempts (M4).
14. **Routing Test**: Direct URL `/cockpit/pipelines/:id` redirects to dashboard `/` (M5).
15. **Calls Sidebar**: Opens slide-out panel showing "No upcoming calls" — empty state renders correctly.
16. **Schedule Page**: Full page showing "No interviews yet. Invite candidates to LIVE_VIDEO stages to get started." with Calendly/Cal.com connect buttons.
17. **Outreach Page**: Full page showing EMAIL_PROVIDER panel with "CONNECT GMAIL" and "CONNECT MICROSOFT OUTLOOK" buttons.
18. **Light Mode Toggle**: Clicked LIGHT in Settings DISPLAY tab — no visible change in screenshot. Needs confirmation if bug or timing issue.
19. **AI Usage Page**: Shows $0.0000 MTD, 5 sessions, 10 calls, **10 FAILED**. All ROLE_DISCOVERY sessions marked FAIL with 0 tokens. Confirms AI provider is completely non-functional in local dev.
20. **Repo Catalog Page**: "Repo Admin" with 50 PENDING, 0 FAILED, 0 APPROVED, 0 DENIED, **2250 TOTAL** repos. Rich curation grid with language badges, SLOC, PR counts, approve/deny/requeue buttons, and semantic search.
21. **404 Test**: Navigating to `/nonexistent-route-12345` redirects to dashboard `/` — no 404 page exists (M9).
22. **Delete Candidate API**: `DELETE /api/v1/candidates/:id` returns `INTERNAL_ERROR` — endpoint exists but is broken.
23. **Duplicate Candidate Emails**: Created 3 additional test candidates. Pipeline now shows **05 candidates**. Same email `hans@example.com` appears twice; same email `xss@test.com` appears twice.
24. **XSS Security Test**: `POST` candidate with name `<script>alert(1)</script>` — API accepts and stores raw HTML with no sanitization (H4).
25. **Email Validation**: SQL-injection-like email `test@example.com OR 1=1` correctly rejected as invalid.
26. **Name Length Validation**: 500-character name correctly rejected with "String must contain at most 200 character(s)".

### 2026-05-01 — Extended UI & API Testing

15. **Settings Panel**: DISPLAY tab works — mode, theme, opacity, animation, glow sliders all functional. INTEGRATIONS tab shows Calendly, Cal.com, email, Twilio connections.
16. **Search**: Typing "Cosine" filters to 1 result correctly. Clearing search restores full list.
17. **New Role Wizard**: Clicked NEW_ROLE → offered resume of previous "Staff Engineer" session. Started new → entered "QA Test Automation Engineer" → company "TestCo Inc" → skipped website → skipped comp range → reached "What technologies do they need on day one?" question. Wizard is conversational AI-style, 3 steps (ROLE → INTERVIEW → REVIEW).
18. **API Error Handling**: Invalid pipeline → 404. Missing auth → 401. Invalid token → 401. Missing fields → VALIDATION_ERROR. Invalid email → VALIDATION_ERROR.
19. **File Upload Edge Cases**: .txt → rejected. 20MB PDF → rejected. No file → rejected. All with clear error messages.
20. **Candidate API Detail**: `GET /api/v1/candidates/:id` returns parsed CV data correctly but `ingestion: null` and `score: null` even though ingestion row exists in DB (H3).
21. **Overview API**: `GET /api/v1/pipelines/:id/overview` returns 2 candidates for our pipeline (Hans Elke + "Bob" from data pollution).
22. **Ingestion API**: `GET /api/v1/pipelines/:id/ingestion` correctly returns ingestion rows for both candidates, both with `status=pending`, `roleCandidateCosine=null`.
23. **Accessibility**: Pipeline actions menu only exposes DELETE option. Filter panel items are StaticText, not buttons. Pipeline cards have no clickable ref in a11y tree except the actions menu.

---

## 🔍 Next Test Targets

1. ~~Mobile responsive~~ — resize to tablet/mobile, check layout
2. ~~Dark mode toggle~~ — test LIGHT mode via settings
3. ~~Phone/Calls sidebar~~ — ✅ tested
4. ~~Schedule sidebar~~ — ✅ tested
5. ~~Outreach sidebar~~ — ✅ tested
6. ~~Repo Catalog sidebar~~ — ✅ tested
7. ~~AI Usage sidebar~~ — ✅ tested
8. **Pipeline builder after wizard** — complete wizard to stage editor
9. **Challenge assignment** — assign challenge to candidate
10. **Stage editor** — add/edit stages, configure gates
11. **Candidate invite flow** — generate and test invite link
12. **Form validation UI** — test empty inputs, invalid data in forms
13. **Data refresh** — test polling behavior
14. ~~404/500 error pages~~ — ❌ no 404 page exists (M9)
15. ~~Duplicate candidate~~ — ❌ API allows duplicates (H5)
16. **Bulk upload** — test CSV/Excel bulk import if available

---

### 2026-05-01 — Summary of Findings

**Total Bugs Found: 15** (0 Critical, 5 High, 9 Medium, 4 Low, 1 Infra)

**Most Severe:**
- **H1 + H2 + H3**: Score system completely non-functional — ingestion stuck at `pending`, AVG SCORE shows `—` everywhere, candidate detail API returns `ingestion: null`
- **H4**: XSS vulnerability — raw `<script>` tags accepted in candidate names
- **H5**: Duplicate emails allowed — no unique constraint on candidate emails within pipeline
- **M4**: Tab crashes to black — React app becomes unrecoverable after navigation

**Root Cause of Score Issue:**
`wrangler dev` remote proxy fails → `env.AI` and `env.CANDIDATE_INDEX` unavailable → `runCandidateIngestion()` silently fails → all candidate_ingestion rows stuck at `pending` with `roleCandidateCosine=null` → UI shows `—` for all scores.

**What Works Well:**
- Resume upload and PDF parsing
- API error handling with clear codes
- File upload validation (type, size)
- Dashboard search and filtering
- Settings panel (DISPLAY + INTEGRATIONS)
- New Role wizard (AI conversational flow)
- All sidebar navigation pages render correctly
- Repo Catalog (2,250 repos with curation UI)
- AI Usage tracking (correctly logs all 10 failed sessions)

**Untested (need fixed AI/Vectorize or deeper access):**
- Challenge assignment
- Stage editor / gate configuration
- Candidate invite email delivery
- Mobile responsive
- Pipeline builder after wizard
- Bulk candidate upload

---

*Session complete. Bug list saved to `knowledge/plan/bugs.md`.*
