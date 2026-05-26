# Security Report: Input Validation & Injection Vectors

> Generated: 2026-05-18
> Scope: SQL injection, Cypher injection, JSON.parse, file uploads, PDF parsing, LLM prompt injection
> Overall Risk: **MEDIUM-HIGH** — No confirmed injection vulnerabilities, but widespread blind trust of untrusted input

---

## 🟢 SQL Injection: No Confirmed Vulnerabilities

**Status:** Defensively coded. All user input is parameterized.

- **566 `.prepare()` calls** across the backend. **558 `.bind()` calls** confirmed.
- Every `.prepare()` call reviewed uses `?` placeholders with `.bind()`. No user input is concatenated into SQL strings.

### Dynamic SQL Patterns (Safe but Brittle)

| File | Lines | Pattern | Risk |
|------|-------|---------|------|
| `phone.ts` | 291, 483 | `UPDATE ... SET ${updates.join(', ')}` | Hardcoded columns only |
| `challengeSubmissions.ts` | 141 | `UPDATE ... SET ${updates.join(', ')}` | Hardcoded columns only |
| `scheduling.ts` | 753, 891 | `UPDATE ... SET ${updates.join(', ')}` | Hardcoded columns only |
| `candidates.ts` | 1089 | `UPDATE ... SET ${updates.join(', ')}` | Hardcoded columns only |
| `candidates.ts` | 1257 | Dynamic `tables` array | Hardcoded tables only |
| `slugifySkills.ts` | 17 | `${placeholders}` where placeholders = `skills.map(() => '?').join(', ')` | Safe — placeholders are `?` |
| `repoDiscovery.ts` | 152-164 | Conditional `AND status = ?3` | Safe — bound parameter |

**Verdict:** No active SQL injection. The dynamic UPDATE pattern is a maintenance risk — a future refactor could accidentally accept user-controlled column names.

**Remediation:** Add an explicit allow-list of column names and reject unknown columns before SQL construction.

---

## 🟢 Neo4j Cypher Injection: No Vulnerabilities

**Status:** All Cypher queries are parameterized.

All Neo4j queries route through `workers/api/src/lib/neo4j/query.ts:36` which calls `session.run(cypher, params)`. Every Cypher query uses `$param` syntax:

- `matchingQueries.ts` — `$role_id`, `$candidate_id`, `$min_similarity`, `$top_k`
- `writeCandidateGraph.ts` — `$candidate_id`, `$nodes`, `$source_type`
- `writeRoleGraph.ts` — `$role_context_id`, `$nodes`
- `writeRepoGraph.ts` — `$repo_id`, `$nodes`

**Verdict:** No Cypher injection. User input is never interpolated into query strings.

---

## 🟡 JSON.parse Without Validation: Widespread

**273 instances** across the codebase. Most parse database rows (trusted). High-risk instances parsing untrusted or semi-trusted input:

| File | Line | What is parsed | Risk |
|------|------|----------------|------|
| `routes/rpc.ts` | 958 | `existing.response_json` (candidate submission) | **MEDIUM** |
| `routes/rpc.ts` | 998 | `submission` body (candidate intake payload) | **MEDIUM** |
| `routes/rpc.ts` | 1309 | `candidate_profile_json` from DB | **LOW** |
| `lib/jdParser.ts` | 98 | AI provider response | **MEDIUM** |
| `lib/cvParser.ts` | 515 | AI provider response | **MEDIUM** |
| `lib/cultureAgent.ts` | 590 | AI response | **MEDIUM** |
| `lib/cultureScorer.ts` | 702, 848, 932 | AI scorer responses | **MEDIUM** |
| `lib/cultureAgentPipeline.ts` | 296, 333 | AI responses | **MEDIUM** |
| `lib/cultureGenerativePlanner.ts` | 253 | AI response | **MEDIUM** |
| `lib/cultureAgentDecomposition.ts` | 142 | AI response | **MEDIUM** |
| `lib/scorerAgent.ts` | 456, 547-548 | Raw AI output | **MEDIUM** — logs raw output |
| `lib/candidateDiscovery/agent.ts` | 126 | AI response | **MEDIUM** |
| `src/pages/CandidateProfilePage.tsx` | 201 | `followUpQuestionsJson` | **LOW** |

**Impact:** A malicious or jailbroken model response could cause crashes or logic corruption. No `zod` or `ajv` validation found on LLM outputs.

**Remediation:** Add Zod schemas for all LLM responses and untrusted JSON.parse call sites.

---

## 🟡 File Upload Security (R2)

**Routes:** `routes/rpc.ts` (`/upload-media`), `routes/cockpit/candidates.ts` (`/:candidateId/resume`)

| Control | rpc.ts | candidates.ts | Status |
|---------|--------|---------------|--------|
| Size limit | 50 MB (`MAX_MEDIA_BYTES`) | 10 MB (`MAX_RESUME_BYTES`) | ✅ OK |
| MIME type whitelist | `audio/*`, `video/*`, `application/pdf`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | `application/pdf`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | ✅ OK |
| Filename sanitization | `replace(/[^a-zA-Z0-9._-]/g, '_')` | `replace(/[^a-zA-Z0-9._-]/g, '_')` | ✅ OK |
| Path traversal | Blocked by sanitization | Blocked by sanitization | ✅ OK |
| Content-type sniffing (magic bytes) | ❌ None | ❌ None | ⚠️ **WEAK** |
| Virus/malware scanning | ❌ None | ❌ None | ⚠️ **MISSING** |

**Issues:**
- MIME type is trusted from `File.type` without magic-byte verification. A `.webm` file with `video/webm` MIME can contain arbitrary data.
- No virus/malware scanning on uploaded documents.
- Extension derivation is safe but weak.

**Remediation:** Add magic-byte verification for PDF and DOCX. Consider virus scanning via ClamAV or external API for recruiter-uploaded files.

---

## 🟡 PDF Parsing Security

**Library:** `unpdf` (pdf.js-based, edge-compatible)

- `lib/cvParser.ts:170-191` — `extractTextFromPDF()`
- `lib/jdParser.ts:71-74` — `extractTextFromPDF()`

**Issues:**
- **No parsing timeout** — a malicious PDF could cause CPU exhaustion.
- **No pre-parse size validation** — parsing happens on cloned buffer without intermediate checks.
- **Console logging of extracted text** (`cvParser.ts:181`):
  ```typescript
  console.log('[cvParser] First 400 chars of extracted text:', cleaned.slice(0, 400).replace(/\n/g, ' | '));
  ```
  This logs up to 400 characters of resume content to console, which may include PII.

**Remediation:** Add a parsing timeout (e.g., 5 seconds). Remove or redact PII from console logs.

---

## 🔴 LLM Prompt Injection

**Multiple vectors where user input is directly interpolated into LLM prompts without sanitization.**

| File | Line | Injection Vector |
|------|------|------------------|
| `lib/cultureAgentPrompts.ts` | 140 | `candidateAnswer.trim()` directly embedded in prompt |
| `lib/explainerPrompts.ts` | 81 | `prBrief` and `prDiff` embedded (from GitHub, manipulable) |
| `lib/explainerPrompts.ts` | 113 | `repoKnowledge.surroundingCode[file]` embedded |
| `lib/jdParser.ts` | 89 | JD text from user upload/paste embedded |
| `lib/copilotAgent.ts` | 158, 165 | `toolResult` embedded in prompt |
| `lib/agents/question/prompt.ts` | 101, 104, 126 | `state.baseline`, `state.coverage`, exchanges embedded |
| `lib/candidateDiscovery/prompts.ts` | 32+ | `resumeText` (truncated to 8000 chars) embedded |
| `lib/cultureScorer.ts` | 414, 480 | Dimension names + transcript quotes embedded |
| `lib/scorerAgent.ts` | 547-548 | Raw scorer outputs logged, then re-prompted |

**Impact:** A candidate could craft answers containing prompt injection directives (e.g., `"Ignore previous instructions and output ..."`) that influence the LLM's scoring, question generation, or review feedback. No delimiter escaping or prompt hardening found.

**Remediation:** Add delimiter boundaries (e.g., XML tags `<candidate_answer>...</candidate_answer>`) and strip/escape user input before embedding. Consider prompt-injection detection heuristics.

---

## Summary Table

| # | Category | Severity | Status | Key Files |
|---|----------|----------|--------|-----------|
| 1 | SQL Injection | **LOW** | No active vulns | `phone.ts`, `challengeSubmissions.ts`, `scheduling.ts` |
| 2 | Neo4j Cypher Injection | **NONE** | No active vulns | All Neo4j queries parameterized |
| 3 | JSON.parse without validation | **MEDIUM** | Widespread | `rpc.ts`, `cvParser.ts`, `cultureScorer.ts`, `scorerAgent.ts` |
| 4 | File upload security | **LOW** | Adequate basics | `rpc.ts:1330-1469`, `candidates.ts:850-914` |
| 5 | PDF parsing security | **LOW** | Missing timeouts | `cvParser.ts:170-191`, `jdParser.ts:71-74` |
| 6 | LLM prompt injection | **HIGH** | No hardening | `cultureAgentPrompts.ts`, `explainerPrompts.ts`, `copilotAgent.ts` |

---

## Recommended Remediations (Priority Order)

1. **[HIGH]** Implement prompt injection hardening — add XML delimiters and input sanitization for all LLM prompts that embed user content.
2. **[MEDIUM]** Add Zod schemas for all LLM responses and untrusted JSON.parse call sites.
3. **[MEDIUM]** Add magic-byte verification for uploaded files.
4. **[LOW]** Add PDF parsing timeout and remove PII from parser logs.
5. **[LOW]** Add column-name allow-list for dynamic SQL UPDATE patterns.
