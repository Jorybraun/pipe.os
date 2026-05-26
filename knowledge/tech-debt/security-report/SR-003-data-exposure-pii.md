# Security Report: Data Exposure & PII

> Generated: 2026-05-18
> Scope: API response sanitization, PII in logs, correct answer leakage, candidate vs recruiter data boundaries
> Overall Risk: **CRITICAL** — Challenge correct answers are leaked to candidates; PII logged to console

---

## 🔴 CRITICAL

### 1. Challenge Correct Answers Leaked to Candidates

- **File:** `workers/api/src/routes/rpc.ts`
- **Lines:** 762–778 (`/rpc/get-challenge`)
- **Severity:** CRITICAL
- **Detail:** The `/rpc/get-challenge` endpoint returns challenge `config` directly to candidates **without calling `sanitizeChallengeConfig`**. The utility `sanitizeChallengeConfig()` exists in `src/lib/utils.ts` (lines 1–15) and removes `correctOptionId` (for `QUIZ_MCQ` challenges) and `bugLocations.groundTruth` (for `CODE_REVIEW` challenges). However, this function is **never imported or used** in the backend `rpc.ts`.

**Result:** Candidates can see correct answers for quiz challenges and ground-truth bug locations for code review challenges.

**Remediation:** Import and call `sanitizeChallengeConfig()` in `rpc.ts` before returning challenge config to candidates. Add a test that asserts `correctOptionId` is never present in candidate-facing responses.

---

### 2. PII in Console Logs

| File | Line | Exposure |
|------|------|----------|
| `routes/rpc.ts` | 1463 | `console.log('[rpc/upload-media] Whisper transcript:', transcript?.slice(0, 100));` — Logs up to 100 chars of audio transcription |
| `lib/cvParser.ts` | 181 | `console.log('[cvParser] First 400 chars of extracted text:', ...)` — Logs resume content |
| `lib/cultureScorer.ts` | 434, 497 | Logs ungrounded scores with candidate context |
| `lib/scorerAgent.ts` | 547-548 | Logs last 200 chars of raw scorer outputs (may contain candidate quotes) |
| `routes/outreach/email.ts` | 77-139 | Logs Calendly URLs, email metadata |

**Remediation:** Remove or redact PII from all console logs. Use structured logging with PII masking.

---

## 🔴 HIGH

### 3. Candidate Hard-Delete Is Incomplete

- **File:** `workers/api/src/routes/cockpit/candidates.ts`
- **Lines:** 1221–1264
- **Severity:** HIGH
- **Detail:** The `DELETE /:candidateId` endpoint purges D1 rows but does **not** delete:
  - R2 objects (resumes, media, call recordings)
  - `session_events` telemetry rows
  - Vectorize index entries (`CANDIDATE_INDEX`)
  - Durable Object state (video rooms, voice sessions, dev containers)
  - Culture compliance audit rows (intentionally retained per ADR-031, but no automatic anonymization)

**Remediation:** Implement a deletion cascade that covers all data stores. For intentionally-retained audit data, anonymize candidate identifiers.

---

### 4. No Data Retention / TTL Policies

- **Scope:** `workers/api/migrations/0072_session_events.sql`, `0014_culture_interview.sql`
- **Severity:** HIGH
- **Detail:**
  - `session_events` is append-only with no retention policy.
  - `culture_compliance_audit` is retained 7 years per EEOC, but no automated enforcement.
  - `phone_calls` stores recordings in R2 with no lifecycle policy.
  - No GDPR Article 5(1)(e) retention schedule is implemented.

**Remediation:** Add automated pruning jobs for expired data. Document retention periods per table/R2 bucket.

---

### 5. Invite Tokens Leaked in Bulk API

- **File:** `workers/api/src/routes/cockpit/overview.ts`
- **Line:** 150
- **Severity:** HIGH
- **Detail:** `GET /:pipelineId/overview` returns `inviteToken: cd.invite_token` for every candidate. These tokens grant candidate JWT access. If a recruiter account is compromised, all candidate tokens are exposed.

**Remediation:** Remove `invite_token` from bulk list responses.

---

## 🟡 MEDIUM

### 6. Candidate Profile JSON Returned Without Validation

- **File:** `workers/api/src/routes/rpc.ts`
- **Lines:** 1294–1314 (`/rpc/candidate-profile`)
- **Severity:** MEDIUM
- **Detail:** Returns parsed `candidate_profile_json` from ingestion with no field filtering. While candidates should see their own profile, the ingestion JSON may contain internal scoring data or recruiter notes if the schema drifts.

**Remediation:** Define an explicit allow-list of fields returned to candidates and reject unknown fields.

---

### 7. Recruiter API Returns Full PII

- **File:** `workers/api/src/routes/cockpit/candidates.ts`
- **Lines:** 283–847
- **Severity:** MEDIUM (by design, but worth auditing)
- **Detail:** The recruiter API returns: name, email, phoneNumber, inviteToken, skills, education, transcripts, scoreReports, cultureInterviewSessions. This is expected for recruiters, but the breadth of data increases blast radius if a recruiter account is compromised.

**Remediation:** Consider role-based access control within recruiter accounts (e.g., read-only vs admin).

---

### 8. Admin Override Secret Exposure

- **File:** `workers/api/src/types.ts`
- **Line:** 127
- **Severity:** MEDIUM
- **Detail:** `ADMIN_TTL_OVERRIDE_SECRET` is a plain environment variable. If leaked, attackers can extend dev container TTL beyond the hard cap by sending the `X-Pipe-Admin-Override` header.

**Remediation:** Treat as a high-sensitivity secret. Rotate regularly. Add audit logging for all override uses.

---

## 🟢 LOW / INFORMATIONAL

### 9. Compliance Audit Table Is Comprehensive

- **Files:** `workers/api/migrations/0047_culture_adaptive_audit.sql`, `0014_culture_interview.sql`
- **Severity:** LOW (positive finding)
- **Detail:** `culture_compliance_audit` captures: consent shown/given/declined, alternative requested, interview start/complete, scoring, review actions, deletion request/fulfilled, plus generative events (question_generated, question_source_mode, answer_decomposed). Properly append-only with FK to `culture_interview_sessions`.

---

### 10. Session Events Telemetry Table

- **File:** `workers/api/migrations/0072_session_events.sql`
- **Severity:** LOW (positive finding)
- **Detail:** `session_events` captures cross-session observability for all interview types. Good for audit trails, but see #4 regarding retention.

---

## Summary Table

| # | Finding | Severity | File(s) |
|---|---------|----------|---------|
| 1 | Correct answers leaked to candidates | **CRITICAL** | `routes/rpc.ts:762-778` |
| 2 | PII in console logs | **CRITICAL** | `rpc.ts:1463`, `cvParser.ts:181`, `cultureScorer.ts:434` |
| 3 | Hard-delete incomplete | **HIGH** | `routes/cockpit/candidates.ts:1221-1264` |
| 4 | No data retention policies | **HIGH** | Multiple migrations |
| 5 | Invite tokens in bulk API | **HIGH** | `routes/cockpit/overview.ts:150` |
| 6 | Candidate profile JSON unvalidated | **MEDIUM** | `routes/rpc.ts:1294-1314` |
| 7 | Recruiter API returns full PII | **MEDIUM** | `routes/cockpit/candidates.ts:283-847` |
| 8 | Admin override secret | **MEDIUM** | `types.ts:127` |
| 9 | Compliance audit comprehensive | **LOW** | Migrations |
| 10 | Session events telemetry | **LOW** | Migrations |

---

## Recommended Remediations (Priority Order)

1. **[CRITICAL]** Add `sanitizeChallengeConfig()` call in `rpc.ts` before returning challenge config to candidates. Write a regression test.
2. **[CRITICAL]** Audit and redact all console logs that may contain candidate PII, transcripts, or resumes.
3. **[HIGH]** Complete the candidate deletion cascade: R2 objects, Vectorize entries, Durable Object state, session events.
4. **[HIGH]** Implement automated data retention policies with pruning jobs.
5. **[HIGH]** Remove `invite_token` from bulk list responses.
6. **[MEDIUM]** Define explicit field allow-list for `/rpc/candidate-profile`.
