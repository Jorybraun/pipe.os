# Handoff: Candidate Ingestion — Resume Decomposition & Graph Hardening

**Date:** 2026-05-01
**Plan:** [`/Users/hans/.kimi/plans/sif-tempest-starman.md`](/Users/hans/.kimi/plans/sif-tempest-starman.md)
**ADR:** [`docs/decisions/ADR-041-candidate-graph-sequencing-revision.md`](/Users/hans/Code/PIPE/PIPE-OS/docs/decisions/ADR-041-candidate-graph-sequencing-revision.md)
**Status:** Approved. Ready for implementation.
**Estimated effort:** 14–18 weeks (5 phases)
**Author:** Kimi (status review + planning session)

---

## 1. TL;DR — What You Are Building

The candidate ingestion pipeline has a **living graph** (`candidate_nodes`) that stores typed sub-elements about each candidate. Right now, the graph is fed only by:
- **Assessments** (code review → `TechnicalDemonstration`, culture interview → `CulturalSignal`, implementation challenge → `TechnicalDemonstration` + `WorkingStyle`)
- **GitHub enrichment** (Project nodes only)

The **resume** — the primary seed signal — still produces a flat narrative. You are building the missing **seed**: a hybrid parser + LLM pipeline that decomposes resumes into `Experience`, `Project`, `Skill`, `Education`, `Credential`, and `CareerArc` nodes.

After that, you will wire those nodes into matching, harden the screener, deepen enrichment, and add observability.

---

## 2. Read These Three Files First

1. **[`knowledge/plan/archive/superseded-strategy-v2-2026-06-19/pipe-strategy-v2-part4-candidate-ingestion.md`](/Users/hans/Code/PIPE/PIPE-OS/knowledge/plan/archive/superseded-strategy-v2-2026-06-19/pipe-strategy-v2-part4-candidate-ingestion.md)** — The original strategy. Understand the "living graph" reframe and the 13 node types.
2. **[`workers/api/src/lib/candidateDiscovery/candidateNodes.ts`](/Users/hans/Code/PIPE/PIPE-OS/workers/api/src/lib/candidateDiscovery/candidateNodes.ts)** — How nodes are inserted, queried, and embedded. This is your core API.
3. **[`workers/api/src/lib/candidateDiscovery/orchestrate.ts`](/Users/hans/Code/PIPE/PIPE-OS/workers/api/src/lib/candidateDiscovery/orchestrate.ts)** — The intake pipeline. You will add a new decomposition step after `persistCandidateProfile()`.

---

## 3. ADR-041: Candidate Graph Sequencing Revision

### 3.1 Context

The original Part 4 strategy prescribed a strict sequence:

1. Phase 0: Hygiene (cache, prompt v3, version stamps) — **Done**
2. Phase 1: Resume decomposition into `candidate_nodes` — **Not done**
3. Phase 2: Public data enrichment — **Partially done**
4. Phase 3: Screener (mode-aware, probe bank, coverage) — **Partially done**
5. Phase 4: Assessment decomposition — **Done**

What actually happened: Phase 0 → Phase 4 → Phase 2 (light) → Phase 3 (infrastructure only). The graph substrate (`candidate_nodes`, `candidate_coverage`) exists and is populated by assessments and GitHub enrichment, but the resume — the primary seed signal — still produces a flat narrative. This is a material architectural reversal: the leaves were built before the trunk.

### 3.2 Decision

We will implement **resume decomposition as a hybrid parser + LLM pipeline** that feeds `candidate_nodes` retroactively. The graph will carry nodes from three source families:

- `resume` — seed nodes (Experience, Project, Skill, Education, Credential, CareerArc)
- `github_enrichment` — public data nodes (Project, Skill, WorkingStyle)
- `assessment` — validated nodes (TechnicalDemonstration, CulturalSignal, WorkingStyle)

Matching will consume all three families with source-aware confidence weighting. Assessment nodes retain priority for their dimensions because they represent validated signal.

### 3.3 Alternatives Considered

#### Option A — Full LLM Decomposition (Original Plan)
- **Pros:** Highest fidelity; single prompt produces all sub-element types with rich narratives.
- **Cons:** 3–4× per-candidate LLM cost; backfill of historical resumes is prohibitively expensive; risk of hallucinated Experience nodes.
- **Verdict:** Rejected. Too expensive for a retroactive seed, and the parser already extracts structured facts.

#### Option B — Parser-Only Decomposition
- **Pros:** Near-zero cost; deterministic; fast.
- **Cons:** Narratives are thin; no CareerArc synthesis; Skill proficiency is binary (mentioned vs not mentioned); misses projects embedded in experience descriptions.
- **Verdict:** Rejected. Insufficient signal for matching. The whole point of decomposition is richer per-element matching.

#### Option C — Hybrid Parser + LLM (Chosen)
- **Pros:** Parser provides skeleton (companies, dates, titles, skills, schools, certifications), reducing LLM input size and hallucination surface. LLM enriches narratives, derives CareerArc, scores Skill proficiency, and identifies Projects nested in Experience descriptions. Cost is ~1.5× current extraction instead of 3–4×.
- **Cons:** Two passes (parser + LLM) adds latency to intake. Parser quality caps extraction quality for badly formatted resumes.
- **Verdict:** Accepted. Best cost/fidelity trade-off. Parser already exists; we only add the enrichment/decomposition pass.

### 3.4 Key Sub-Decisions

#### Duplicate Handling: Resume vs Assessment Nodes
When a resume-derived `Skill` node for "TypeScript" coexists with a code-review-derived `TechnicalDemonstration` that demonstrates TypeScript debugging:

- **Decision:** Keep separate. Do not merge.
- **Rationale:** Provenance is load-bearing for compliance (NYC LL144, EU AI Act Art 14) and for matching explainability. The matching layer already filters by `source_type` and `confidence`. We add a `source_family` weight to the matching algorithm instead of collapsing nodes.
- **Matching weight hierarchy:** `technical_interview` > `code_review_session` > `implementation_challenge` > `automated_screener` > `github_enrichment` > `resume`.

#### Screener Hosting: Standalone vs Assessment-Linked
The screener `profile_builder` mode needs to run pre-match, but `culture_interview_sessions` is assessment-linked.

- **Decision:** Extend `culture_interview_sessions` with nullable `challenge_id` and `assessment_id` for Mode 1. A new `screening_sessions` table is deferred until the schema becomes unwieldy.
- **Rationale:** Minimizes migration scope. The adaptive agent infrastructure (`cultureAgentAdaptive.ts`) already supports `profile_builder` mode. The route handler can accept a null assessment context. If Mode 1 volume grows or compliance requires stricter separation, we split tables in a later phase.

#### Backfill Strategy
- **Decision:** Nightly rate-limited cron, 10 candidates/hour, starting with most-recently-active candidates.
- **Rationale:** Avoids a big-bang backfill that blocks the release. Historical candidates who never engaged beyond intake are lower priority. The cron uses the same decomposition pipeline as live intake to guarantee parity.

### 3.5 Consequences

**Positive:**
- The graph finally has a seed. Matching quality improves for all new intakes immediately, and for historical candidates steadily.
- The hybrid approach keeps LLM costs predictable (~$0.10 per candidate vs $0.30+ for full LLM).
- Assessment nodes retain priority, so existing matching behavior is preserved; resume nodes only add signal where assessment nodes are absent.
- No schema breakage. `candidate_nodes` already supports all required types and provenance fields.

**Negative / Trade-offs:**
- Resume decomposition adds ~2–4s to intake latency (parser is synchronous, LLM enrichment is a second call).
- Historical candidates without assessments will see the biggest matching quality jump; candidates with rich assessments will see marginal improvement. This creates a "two-tier" candidate pool during backfill.
- `candidateSituationFit` prompt will grow larger as it consumes Experience/Project/Skill nodes, potentially requiring token budget increases or stricter capping.

**Risks:**
- **Parser + LLM drift:** If the parser extracts a company name wrong, the LLM may hallucinate a narrative around it. Mitigation: parser output is labeled as "extracted facts" in the LLM prompt, with anti-hallucination rules. The raw resume text is also provided for verification.
- **Coverage computation bias:** `candidate_coverage` currently weights all nodes equally. Resume-derived nodes may inflate coverage scores without validated depth. Mitigation: source-aware coverage weighting (assessment nodes count more than resume nodes).
- **Backfill cost surprise:** If the parser fails on a large fraction of historical resumes, the backfill may produce low-quality nodes. Mitigation: dry-run the backfill on 50 candidates and audit output before scaling to the full 1500.

---

## 4. Current State vs Desired State

| Component | Current | Desired |
|-----------|---------|---------|
| Resume extraction | Flat prose (`candidate_searchable_profile`) + sidecar JSON | Typed nodes in `candidate_nodes` |
| `cvParser.ts` | Name, role, years, skills, education strings | Structured skeletons: `experiences[]`, `education[]`, `credentials[]`, `projects[]` |
| Matching (`candidateSituationFit`) | Consumes flat profile + `culturalSignalNodes` | Also consumes `experienceNodes`, `projectNodes`, `skillNodes` |
| Screener decomposition | `decomposeCandidateAnswer()` works but `persistDecomposition()` is a **stub** | Real writes to `candidate_nodes` |
| `candidate_profile_state` | **Does not exist** | Tracks cross-role candidate lifecycle |
| GitHub enrichment | `Project` nodes only | Also `Skill`, `WorkingStyle`, `CommunicationStyle` nodes |
| Evidence density | Not computed | Discounts match scores for thin graphs |

---

## 5. Start Here: Phase 1, Subtask 3.1.2 (Parser Enhancement)

**Why start with the parser?** Everything downstream depends on it. The parser provides the skeleton that reduces LLM hallucination and cost.

**File:** `workers/api/src/lib/cvParser.ts`

**What to do:**
1. Read the current `ParsedCV` interface.
2. Add `ParsedExperience`, `ParsedEducation`, `ParsedCredential`, and expand `ParsedCV`.
3. Implement rule-based extraction (regex + heuristics) for:
   - Work history blocks (company, role, dates, description)
   - Education blocks (institution, degree, field, year)
   - Certifications / credentials
   - Projects (standalone sections or GitHub URLs in bullets)
4. Write unit tests in `lib/cvParser/__tests__/cvParser.test.ts` (create if missing).

**Do NOT:**
- Use an LLM in the parser. It must be deterministic and fast.
- Worry about perfect accuracy on day one. Fallback to the flat narrative path is acceptable.

---

## 6. Phase Overview

| Phase | Title | Est. Weeks | Parallelizable? | Depends On |
|-------|-------|-----------|-----------------|------------|
| 1 | Resume Decomposition | 4–6 | Partial (schema + parser can parallel) | — |
| 2 | Graph-Enabled Matching | 3–4 | Yes (after Phase 1 schema lands) | Phase 1 |
| 3 | Screener Hardening | 3–4 | Partial | Phase 1 (uses same nodes) |
| 4 | Enrichment Depth | 2–3 | Yes | Phase 1 |
| 5 | Observability & Calibration | 1–2 | Yes | Phase 2 |

**Critical path:** Phase 1 → Phase 2 → Phase 5. Phases 3 and 4 can run in parallel with Phase 2 once Phase 1 is complete.

---

## 7. Phase 1: Resume Decomposition (4–6 weeks)

**Goal:** Turn the flat resume narrative into typed, embeddable, auditable `candidate_nodes`.

### 7.1 Subtask 3.1.1 — Schema: `candidate_profile_state` (0.5 weeks)
**Owner:** migrations + types
**Files:** `workers/api/src/types.ts`, new migration `0058_candidate_profile_state.sql`

```sql
CREATE TABLE candidate_profile_state (
  candidate_id TEXT PRIMARY KEY,
  overall_status TEXT NOT NULL CHECK(overall_status IN ('seed', 'enriching', 'screening', 'active', 'dormant', 'archived')),
  last_intake_at INTEGER,
  last_enriched_at INTEGER,
  last_screened_at INTEGER,
  last_matched_at INTEGER,
  re_engagement_eligible_at INTEGER,
  profile_version TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
```

- `overall_status` replaces the single-role `candidates.status` for cross-role lifecycle tracking.
- `re_engagement_eligible_at` is computed from recency rules (see Phase 5).

### 7.2 Subtask 3.1.2 — Parser Enhancement: `cvParser.ts` (1 week)
**Owner:** `lib/cvParser.ts`
**Goal:** Expand the existing parser to emit structured skeletons.

Current `ParsedCV` output:
```ts
interface ParsedCV {
  name?: string;
  currentRole?: string;
  yearsOfExperience?: number;
  skills?: string[];
  education?: string[];
}
```

New `ParsedCV` additions:
```ts
interface ParsedExperience {
  company: string;
  role: string;
  startDate?: string;
  endDate?: string;
  description: string;
  isCurrent?: boolean;
}

interface ParsedEducation {
  institution: string;
  degree: string;
  field?: string;
  year?: string;
}

interface ParsedCredential {
  name: string;
  issuer?: string;
  year?: string;
}

interface ParsedCV {
  // ... existing fields ...
  experiences: ParsedExperience[];
  education: ParsedEducation[];
  credentials: ParsedCredential[];
  projects: { name: string; description: string }[];
}
```

**Rules:**
- Parser is rule-based (regex + heuristics), not LLM-based.
- Dates are parsed heuristically; partial dates are accepted.
- Projects are extracted from standalone "Projects" sections or from bullet points that mention GitHub URLs / product names.

### 7.3 Subtask 3.1.3 — Decomposition Prompt: `candidateDecompositionPrompt.ts` (1 week)
**Owner:** new file `lib/candidateDiscovery/candidateDecompositionPrompt.ts`
**Goal:** LLM prompt that takes `ParsedCV` + raw resume text + parser skeleton, produces sub-element JSON.

**Input shape:**
```
PARSER SKELETON:
- Experience: [{company, role, dates, description}, ...]
- Education: [{institution, degree, ...}, ...]
- Skills: [...]
- Credentials: [...]
- Projects: [...]

RAW RESUME TEXT:
{truncated to 6000 chars}
```

**Output shape:**
```json
{
  "experiences": [
    {
      "company": "Acme Corp",
      "role": "Senior Engineer",
      "duration_months": 24,
      "team_size": "5-10",
      "scope": "service",
      "narrative": "Led backend migration...",
      "skills_demonstrated": ["typescript", "kafka"],
      "confidence": 0.85
    }
  ],
  "projects": [...],
  "skills": [
    {
      "name": "typescript",
      "proficiency": "expert",
      "years_exposure": 5,
      "evidence_source": "experience_id_or_project_id",
      "confidence": 0.9
    }
  ],
  "education": [...],
  "credentials": [...],
  "career_arc": {
    "narrative": "Steady progression from junior to staff...",
    "growth_velocity": "fast",
    "transitions": [{"from": "IC", "to": "lead", "at_company": "Acme"}],
    "confidence": 0.8
  }
}
```

**Anti-hallucination rules (same as prompts.ts v3):**
- Do not invent metrics not present in the raw text.
- Do not claim years of experience with a technology unless explicitly stated.
- If parser skeleton and raw text conflict, trust the raw text and note the discrepancy.
- Confidence must reflect certainty, not candidate quality.

### 7.4 Subtask 3.1.4 — Node Inserter: `resumeDecomposition.ts` (1 week)
**Owner:** new file `lib/candidateDiscovery/resumeDecomposition.ts`
**Goal:** Orchestrate parser → LLM → node insertion → embedding → coverage update.

**Flow:**
1. Call enhanced `cvParser.ts` on resume text.
2. Build decomposition prompt from parser output + raw text.
3. Call LLM (Gemma 3 27B via `createCandidateAgentProvider`).
4. Parse and validate JSON output.
5. For each sub-element:
   - Call `insertCandidateNode()` with `source_type='resume'`.
   - Call `embedCandidateNode()`.
   - Update `embedding_json` on the node.
6. Call `computeCandidateCoverage(candidateId)`.
7. Update `candidate_profile_state` to `overall_status='seed'`.

**Error handling:**
- Parser failure: fall back to current flat-narrative path (backward compatible).
- LLM failure: write parser-only nodes with lower confidence (`confidence=0.5`), mark `candidate_profile_state.status='seed'`.
- Partial failure (some node types fail): write what succeeded, log failures.

### 7.5 Subtask 3.1.5 — Orchestration Wiring: `orchestrate.ts` (0.5 weeks)
**Owner:** `lib/candidateDiscovery/orchestrate.ts`
**Change:** After `persistCandidateProfile()` writes the flat narrative, add a new step:

```ts
// After profile generation, before embedding
await decomposeResumeToGraph({
  db,
  candidateId,
  resumeText,
  parsedCV,
  env,
});
```

The aggregate `candidate_searchable_profile` is still generated and embedded for backward compatibility. The new nodes are additional signal.

### 7.6 Subtask 3.1.6 — Backfill Script: `backfillResumeDecomposition.ts` (1 week)
**Owner:** new script `scripts/backfillResumeDecomposition.ts`
**Goal:** Cron-compatible batch job that re-processes historical candidates.

**Behavior:**
- Reads `candidate_ingestion` rows where `status='embedded' OR status='matched'`.
- Skips candidates who already have `candidate_nodes` from `source_type='resume'`.
- Rate-limited: 10 candidates per invocation.
- Idempotent: same `decomposition_version` stamp; re-running is safe.
- Logs to stdout for cron observability.

**Invocation:**
```bash
# Manual
npx tsx scripts/backfillResumeDecomposition.ts --batch-size=10 --dry-run

# Cron (wrangler.jsonc)
# Every night at 2 AM, 10 candidates/hour
```

### 7.7 Subtask 3.1.7 — Tests (0.5 weeks)
**Owner:** `lib/candidateDiscovery/__tests__/resumeDecomposition.test.ts`
**Coverage:**
- Parser output → prompt shape validation.
- LLM mock response → correct node insertion.
- Partial failure handling.
- Duplicate run idempotency.

### 7.8 Phase 1 Migrations

```sql
-- 0058_candidate_profile_state.sql
-- (see 7.1 above)

-- 0059_candidate_ingestion_decomposition_version.sql
ALTER TABLE candidate_ingestion ADD COLUMN decomposition_version TEXT;
```

### 7.9 Phase 1 Files

| File | Action |
|------|--------|
| `lib/cvParser.ts` | Modify — expand `ParsedCV` interface and extraction logic |
| `lib/candidateDiscovery/candidateDecompositionPrompt.ts` | **Create** — LLM prompt for sub-element extraction |
| `lib/candidateDiscovery/resumeDecomposition.ts` | **Create** — orchestration: parser → LLM → nodes |
| `lib/candidateDiscovery/orchestrate.ts` | Modify — wire decomposition step into intake pipeline |
| `lib/candidateDiscovery/backfill.ts` | Modify — or create `backfillResumeDecomposition.ts` |
| `scripts/backfillResumeDecomposition.ts` | **Create** — cron batch backfill |
| `types.ts` | Modify — add `ParsedExperience`, `ParsedEducation`, `ParsedCredential` |

---

## 8. Phase 2: Graph-Enabled Matching (3–4 weeks)

**Goal:** Make `candidateSituationFit` and downstream matching consume the new resume-derived nodes.

### 8.1 Subtask 4.1.1 — Node-Aware Prompt Augmentation (1 week)
**Owner:** `lib/candidateDiscovery/candidateSituationFit.ts`
**Change:** `buildUserMessage()` currently injects `culturalSignalNodes`. Add injection for:
- `experienceNodes` → formatted as "Career History" block
- `projectNodes` → formatted as "Notable Projects" block
- `skillNodes` → formatted as "Skill Profile" block

**New prompt block:**
```
### candidate_experiences
- Senior Engineer at Acme Corp (2022–2024): Led backend migration...
- Engineer at Beta Inc (2020–2022): Built payment integration...

### candidate_projects
- Open-source CLI tool: A TypeScript utility for...

### candidate_skills
- typescript (expert, 5 years)
- kafka (proficient, 2 years)
```

**Rules:**
- Only include nodes with `confidence >= 0.5`.
- Cap at 5 experiences, 3 projects, 10 skills to manage token budget.
- Prefer non-superseded nodes.

### 8.2 Subtask 4.1.2 — Evidence Density Multiplier (1 week)
**Owner:** `lib/match/triangulateMatch.ts` + `lib/candidateDiscovery/candidateCoverage.ts`
**Goal:** Discount match scores when the candidate graph is thin.

**Formula:**
```ts
const evidenceDensity = (
  experienceCoverage * 0.3 +
  technicalCoverage * 0.3 +
  culturalCoverage * 0.2 +
  motivationCoverage * 0.1 +
  contextCoverage * 0.1
);

// evidenceDensity is already computed by computeCandidateCoverage
const densityMultiplier = 0.5 + (evidenceDensity * 0.5); // range [0.5, 1.0]
const adjustedMatchScore = rawMatchScore * densityMultiplier;
```

**Behavior:**
- A candidate with only a resume (thin graph) gets their match score discounted by up to 50%.
- A candidate with rich assessments (dense graph) gets full weight.
- This makes the score more honest: a 0.80 match with thin evidence is not the same as a 0.80 match with dense evidence.

### 8.3 Subtask 4.1.3 — Source-Aware Coverage Weighting (0.5 weeks)
**Owner:** `lib/candidateDiscovery/candidateCoverage.ts`
**Change:** `computeCandidateCoverage` currently counts nodes naively. Add source quality weights:

```ts
const SOURCE_WEIGHTS: Record<string, number> = {
  'code_review_session': 1.0,
  'implementation_challenge': 1.0,
  'culture_interview': 1.0,
  'automated_screener': 0.9,
  'github_enrichment': 0.7,
  'resume': 0.6,
  'recruiter_note': 0.5,
};
```

Coverage scores become weighted sums instead of counts.

### 8.4 Subtask 4.1.4 — Recency Decay in Matching (0.5 weeks)
**Owner:** `lib/candidateDiscovery/candidateSituationFit.ts`
**Goal:** Older nodes contribute less to matching unless they are superseded.

**Simple rule:** Nodes older than 2 years get a 0.8x multiplier; nodes older than 4 years get 0.6x. This can be refined later.

### 8.5 Subtask 4.1.5 — Tests (0.5 weeks)
**Owner:** `lib/match/__tests__/triangulateMatch.test.ts`, `lib/candidateDiscovery/__tests__/candidateCoverage.test.ts`

### 8.6 Phase 2 Files

| File | Action |
|------|--------|
| `lib/candidateDiscovery/candidateSituationFit.ts` | Modify — inject Experience/Project/Skill nodes into prompt |
| `lib/match/triangulateMatch.ts` | Modify — apply evidence density multiplier |
| `lib/candidateDiscovery/candidateCoverage.ts` | Modify — source-aware weighted coverage |
| `lib/candidateDiscovery/candidateRecency.ts` | Modify — recency decay rules (or create) |

---

## 9. Phase 3: Screener Hardening (3–4 weeks)

**Goal:** Make the Mode 1 screener a true pre-match profile builder, not just an assessment config.

### 9.1 Subtask 5.1.1 — Unstub `persistDecomposition` (0.5 weeks)
**Owner:** `lib/cultureAgentDecomposition.ts`
**Current state:** `persistDecomposition()` logs and returns. `candidate_nodes` exists (migration 0052).
**Fix:** Replace stub with actual `insertCandidateNode()` calls.

```ts
export async function persistDecomposition(input: PersistDecompositionInput): Promise<void> {
  const { db, candidateId, sessionId, turnTimestamp, mode, decomposition } = input;

  for (const signal of decomposition.culturalSignals) {
    await insertCandidateNode(db, {
      candidate_id: candidateId,
      node_type: 'CulturalSignal',
      narrative_text: signal.evidence,
      extracted_properties_json: JSON.stringify({
        dimension: signal.dimension,
        bars_score: signal.scoreEstimate,
        session_mode: mode,
      }),
      source_type: mode === 'profile_builder' ? 'automated_screener' : 'culture_interview',
      source_reference: sessionId,
      captured_at: new Date(turnTimestamp).getTime(),
      confidence: signal.confidence,
      // ...
    });
  }

  // Also insert newExperiences as Experience nodes, newProjects as Project nodes
  // ...

  await computeCandidateCoverage(db, candidateId);
}
```

### 9.2 Subtask 5.1.2 — Standalone Screening Session (1.5 weeks)
**Owner:** `routes/screening/culture.ts`, `lib/cultureAgentAdaptive.ts`
**Goal:** Allow `profile_builder` sessions without a `challenge_id` or `assessment_id`.

**Schema change (migration 0060):**
```sql
ALTER TABLE culture_interview_sessions ALTER COLUMN challenge_id DROP NOT NULL;
ALTER TABLE culture_interview_sessions ALTER COLUMN assessment_id DROP NOT NULL;
```

**Route changes:**
- New recruiter endpoint: `POST /api/v1/screening/invite` — creates a `profile_builder` session for a candidate with null `challenge_id`.
- New candidate endpoint: `POST /rpc/screening/:token/consent` — starts a standalone screening.
- Existing `/rpc/culture/*` endpoints remain for assessment-linked culture interviews.

**Agent changes:**
- `cultureAgentAdaptive.ts` already accepts `mode`. Ensure it handles `teamContext=null` and `probeBank=EMPTY_PROBE_BANK` gracefully for `profile_builder`.
- Generative planner should skip RCD personalization when `teamContext` is null.

### 9.3 Subtask 5.1.3 — Candidate Profile View (1 week)
**Owner:** new routes + UI components
**Goal:** Candidate-facing read-only view of their graph.

**Backend:**
- New endpoint: `GET /rpc/candidate/profile` — returns aggregated profile:
  ```json
  {
    "experiences": [...],
    "skills": [...],
    "projects": [...],
    "coverage": { "experience": 0.7, "technical": 0.8, ... },
    "sources": ["resume", "github_enrichment", "code_review_session"]
  }
  ```
- Filters out superseded nodes. Sanitizes `source_reference` (no internal IDs exposed).

**Frontend:**
- New page: `/candidate/profile` — simple accordion view by node type.
- "Request correction" button (creates a support ticket; out of scope for auto-correction in this phase).

### 9.4 Subtask 5.1.4 — HITL Policy for Mode 1 (0.5 weeks)
**Owner:** `routes/screening/culture.ts` (recruiter router)
**Decision:** Mode 1 output is **not** HITL-gated. The score report is not a hiring decision. Recruiters can view the enriched profile and the screening transcript, but there is no "confirm/override" flow for Mode 1.
- Mode 1 session ends in `complete` state directly (no `scoring` → `review` flow).
- `scoreCultureInterview` is **not** called for Mode 1. The session ends after coverage is adequate or budget is exhausted.
- The decomposition output is the only product of Mode 1.

### 9.5 Phase 3 Files

| File | Action |
|------|--------|
| `lib/cultureAgentDecomposition.ts` | Modify — replace `persistDecomposition` stub with real writes |
| `routes/screening/culture.ts` | Modify — standalone invite + consent routes |
| `lib/cultureAgentAdaptive.ts` | Modify — handle null teamContext for profile_builder |
| `lib/cultureGenerativePlanner.ts` | Modify — skip RCD personalization when teamContext is null |
| `routes/candidate/profile.ts` | **Create** — candidate-facing profile endpoint |
| `src/pages/candidate/ProfilePage.tsx` | **Create** — frontend profile view (if React app exists) |

---

## 10. Phase 4: Enrichment Depth (2–3 weeks)

**Goal:** Upgrade GitHub enrichment from metadata-driven Project nodes to LLM-decomposed multi-type nodes.

### 10.1 Subtask 6.1.1 — Contribution Analysis (1 week)
**Owner:** `lib/enrichment/githubEnrich.ts`
**Current state:** Only owned repos → Project nodes.
**Additions:**
- Fetch merged PRs to other repos (GitHub search API: `is:pr author:{handle} is:merged`).
- For repos with 5+ merged PRs, create an `Experience`-like node: "Contributor to `{repo}` — 12 merged PRs over 18 months. Focused on bug fixes and feature work in `{language}`."
- Fetch commit activity per repo to derive `WorkingStyle` nodes: "Sustained contributor to `{repo}` — consistent weekly commits over 2 years." or "Spike contributor — 40 commits in 1 month, then inactive."

### 10.2 Subtask 6.1.2 — README / Issue Sampling (1 week)
**Owner:** `lib/enrichment/githubEnrich.ts`
**Goal:** Derive `CommunicationStyle` and `TechnicalDemonstration` nodes.

- Sample 3 README files from owned repos → `CommunicationStyle` node (clarity, structure, depth).
- Sample 5 issue comments → `CommunicationStyle` node (technical explanation quality).
- These use a lightweight LLM prompt (Gemma 3 27B, single call per candidate) to score writing quality and produce a narrative.

### 10.3 Subtask 6.1.3 — Skill Derivation from Languages (0.5 weeks)
**Owner:** `lib/enrichment/githubEnrich.ts`
**Goal:** Create `Skill` nodes from language usage patterns.

- Aggregate `languages` across all repos weighted by bytes.
- Create `Skill` nodes with proficiency inferred from recency and volume: "typescript (expert, active in 8 repos, 45% of total code)."
- Confidence scales with repo count and recency.

### 10.4 Phase 4 Files

| File | Action |
|------|--------|
| `lib/enrichment/githubEnrich.ts` | Modify — add contribution analysis, commit patterns, README/issue sampling |
| `lib/enrichment/githubClient.ts` | Modify — add `getMergedPRs`, `getRepoReadme`, `getIssueComments` |
| `lib/candidateDiscovery/candidateNodes.ts` | No change — already supports all node types |

---

## 11. Phase 5: Observability & Calibration (1–2 weeks)

**Goal:** Measure whether the graph is working.

### 11.1 Subtask 7.1.1 — Coverage Dashboard (0.5 weeks)
**Owner:** new route `GET /api/v1/admin/candidate-coverage`
**Returns:**
```json
{
  "totalCandidates": 1500,
  "withResumeNodes": 450,
  "withAssessmentNodes": 320,
  "withEnrichmentNodes": 180,
  "averageCoverage": {
    "experience": 0.42,
    "technical": 0.38,
    "cultural": 0.25,
    "motivation": 0.15,
    "context": 0.20
  },
  "backfillProgress": { "completed": 450, "remaining": 1050 }
}
```

### 11.2 Subtask 7.1.2 — Matching Quality Metrics (0.5 weeks)
**Owner:** `lib/match/triangulateMatch.ts` + `match_feedback` table
**Additions:**
- Log `node_type_distribution` in `match_feedback` (which node types contributed to the match).
- Track recruiter thumbs-up/down correlation with `evidence_density`. Hypothesis: high-density candidates get more accurate thumbs.

### 11.3 Subtask 7.1.3 — Re-engagement Cron (0.5 weeks)
**Owner:** `routes/cron/reengagement.ts`
**Behavior:**
- Daily scan of `candidate_profile_state`.
- Candidates with `overall_status='dormant'` and `re_engagement_eligible_at <= now()` get a "new roles match you" email.
- Candidates with `last_screened_at` > 12 months ago get flagged for abbreviated re-screening.

### 11.4 Phase 5 Files

| File | Action |
|------|--------|
| `routes/admin/candidateCoverage.ts` | **Create** — coverage dashboard endpoint |
| `routes/cron/reengagement.ts` | **Create** — re-engagement trigger cron |
| `lib/match/triangulateMatch.ts` | Modify — log node_type_distribution to match_feedback |

---

## 12. Migration Sequence

| Number | Name | Phase | Notes |
|--------|------|-------|-------|
| 0058 | `candidate_profile_state` | 1 | New table |
| 0059 | `candidate_ingestion_decomposition_version` | 1 | Add column to track backfill progress |
| 0060 | `culture_interview_sessions_nullable_challenge` | 3 | Drop NOT NULL on `challenge_id`, `assessment_id` |
| 0061 | `match_feedback_node_distribution` | 5 | Add `node_types_json` column to `match_feedback` |

**Race warning:** 0058–0061 must be confirmed against `workers/api/migrations/` at PR time. As of 2026-05-01, the highest migration is `0057_candidate_coverage_fix_fk.sql`.

---

## 13. Critical Gotchas

### 1. `persistDecomposition` is a stale stub
`lib/cultureAgentDecomposition.ts` has a `persistDecomposition()` function that logs and returns without writing. The comment says "TODO: Enable when candidate_nodes table is created." **The table exists** (migration 0052). This TODO is stale. When you reach Phase 3, replace the stub with real `insertCandidateNode()` calls.

### 2. Resume extraction is still flat
`agent.ts` produces `candidateSearchableProfile` (flat prose) + sidecar JSON. The new `resumeDecomposition.ts` must be called **after** `persistCandidateProfile()` in `orchestrate.ts`.

### 3. `candidateSituationFit` already consumes cultural signals
The matching prompt already injects `CulturalSignal` nodes when a `roleContextId` is provided. Do not break this. Add Experience/Project/Skill blocks alongside the existing cultural signal block.

### 4. Backward compatibility is mandatory
The flat `candidate_searchable_profile` and its embedding in `CANDIDATE_INDEX` must continue to work. The new nodes are **additional signal**, not a replacement. Existing consumers (vector-native ANN, exact cosine calculation) must not break.

### 5. Rate-limit the backfill
There are ~1500 historical candidates. Do not attempt to backfill them all in one deployment. The backfill script must process 10 candidates per invocation and be run as a nightly cron.

### 6. D1 SQLite `ALTER TABLE` limitations
Migration 0060 requires making `challenge_id` and `assessment_id` nullable in `culture_interview_sessions`. D1 SQLite may not support `ALTER TABLE ... DROP NOT NULL`. If it fails, you must recreate the table and migrate data. Test in staging first.

---

## 14. Architecture Decisions You Must Respect

These are locked by ADR-041. Do not change them without discussion.

1. **Hybrid parser + LLM for resume decomposition.** Not full LLM (too expensive), not parser-only (too thin).
2. **Keep nodes separate by `source_type`.** A resume `Skill` node and a code-review `TechnicalDemonstration` node for the same technology are **not merged**. Matching weights them by source quality.
3. **Assessment nodes have matching priority.** Hierarchy: `technical_interview` > `code_review_session` > `implementation_challenge` > `automated_screener` > `github_enrichment` > `resume`.
4. **Mode 1 screener stays in `culture_interview_sessions` for now.** Nullable `challenge_id`/`assessment_id`. A separate `screening_sessions` table is deferred.
5. **Mode 1 has no HITL gate.** It is pure profile enrichment. No `scoreCultureInterview` call. Session ends in `complete` state.
6. **Evidence density discounts match scores** for thin profiles.

---

## 15. File Map

### New files to create
| File | Purpose |
|------|---------|
| `lib/candidateDiscovery/candidateDecompositionPrompt.ts` | LLM prompt: parser skeleton → sub-element JSON |
| `lib/candidateDiscovery/resumeDecomposition.ts` | Orchestration: parser → LLM → nodes → embedding |
| `scripts/backfillResumeDecomposition.ts` | Nightly cron backfill job |
| `routes/candidate/profile.ts` | Candidate-facing profile endpoint |
| `routes/admin/candidateCoverage.ts` | Admin coverage dashboard |
| `routes/cron/reengagement.ts` | Re-engagement trigger cron |

### Files to modify
| File | Change |
|------|--------|
| `lib/cvParser.ts` | Expand `ParsedCV` with structured skeletons |
| `lib/candidateDiscovery/orchestrate.ts` | Wire decomposition step after profile generation |
| `lib/candidateDiscovery/candidateSituationFit.ts` | Inject Experience/Project/Skill nodes into prompt |
| `lib/match/triangulateMatch.ts` | Apply evidence density multiplier |
| `lib/candidateDiscovery/candidateCoverage.ts` | Source-aware weighted coverage |
| `lib/cultureAgentDecomposition.ts` | Unstub `persistDecomposition` |
| `routes/screening/culture.ts` | Standalone Mode 1 invite + consent routes |
| `lib/cultureAgentAdaptive.ts` | Handle null teamContext for profile_builder |
| `lib/enrichment/githubEnrich.ts` | Contribution analysis, README/issue sampling, Skill derivation |
| `lib/enrichment/githubClient.ts` | New API methods for PRs, READMEs, issue comments |
| `types.ts` | Add new interfaces (`ParsedExperience`, etc.) |

---

## 16. Testing Strategy

### Unit tests (every subtask)
- Parser output shape validation
- Decomposition prompt structure
- Node insertion idempotency (re-running on same candidate does not duplicate nodes)
- Coverage computation after node writes

### Integration tests (Phase 1 completion)
- Full intake pipeline with mock LLM:
  1. Upload resume
  2. Parser extracts skeleton
  3. LLM enriches into sub-elements
  4. Nodes inserted into `candidate_nodes`
  5. Coverage updated
  6. Matching prompt includes new nodes

### E2E tests (Phase 3 completion)
- Resume upload → candidate profile view shows correct nodes
- Recruiter invites candidate to Mode 1 screening → session completes → nodes appear in graph

### Regression tests (Phase 2 completion)
- Existing `match_feedback` thumbs-up rate must not drop after evidence density multiplier is applied
- `candidateSituationFit` with `culturalSignalNodes` must still work as before

---

## 17. Cost Expectations

| Phase | LLM Cost (per candidate) | Notes |
|-------|-------------------------|-------|
| 1 (resume decomp) | ~$0.08–0.12 | One Gemma 3 27B call (~3K in / 2K out) |
| 2 (matching) | ~$0.02 | Prompt grows by ~500 tokens for node injection |
| 3 (screener) | No change | Decomposition already runs; just unstubbing persistence |
| 4 (enrichment) | ~$0.05 | One Gemma call for README/issue sampling |
| 5 (observability) | $0 | Deterministic |

**Total backfill cost:** 1500 candidates × $0.10 = ~$150.

**No new infrastructure costs.** Uses existing D1, Vectorize, and Workers AI bindings.

---

## 18. Compliance Notes

- `source_type='resume'` nodes are candidate-provided data, not inferred assessment data. GDPR deletion must cascade to them.
- Mode 1 screener must never emit scores, pass/fail, or hiring recommendations to the candidate. It is profile enrichment only.
- Every node needs `captured_at` and `source_reference`. The schema already enforces this.

---

## 19. Open Questions / Risks

| # | Question | Risk Level | Mitigation |
|---|----------|-----------|------------|
| 1 | **Parser accuracy for non-standard resumes.** PDFs with tables, graphics, or unconventional formatting may break the parser. | Medium | Fallback to flat narrative + manual recruiter note. Parser improvements are iterative. |
| 2 | **Token budget in `candidateSituationFit`.** Adding Experience + Project + Skill blocks may exceed the 4096-token limit when combined with repo descriptions. | Medium | Cap nodes (5 experiences, 3 projects, 10 skills). Truncate narratives. Monitor token counts. |
| 3 | **Mode 1 screener completion rates.** If candidates see Mode 1 as "another interview," they may abandon. | High | Product/UX design of the candidate profile view is critical. Candidates must see immediate value. |
| 4 | **Migration 0060 nullable columns.** D1 SQLite `ALTER TABLE ... DROP NOT NULL` behavior needs verification. | Low | Test in staging. If unsupported, recreate table with nullable columns and migrate data. |
| 5 | **Coverage computation performance.** `computeCandidateCoverage` runs after every node write. With 50+ nodes per candidate, this must be fast. | Low | Already indexed on `candidate_id`. Query is simple aggregation. |

---

## 20. Definition of Done (Per Phase)

**Phase 1 Done when:**
- [ ] New resume intake creates `Experience`, `Project`, `Skill`, `Education`, `Credential`, `CareerArc` nodes.
- [ ] Backfill cron runs nightly and processes 10 candidates without errors.
- [ ] `candidate_profile_state` table exists and is updated on intake.
- [ ] All new code has >80% test coverage.

**Phase 2 Done when:**
- [ ] `candidateSituationFit` prompt includes resume-derived nodes.
- [ ] `triangulateMatch` applies evidence density multiplier.
- [ ] Recruiter match_feedback shows no regression in thumbs-up rate.

**Phase 3 Done when:**
- [ ] `persistDecomposition` writes real nodes to `candidate_nodes`.
- [ ] Recruiter can invite a candidate to standalone Mode 1 screening.
- [ ] Candidate can view their profile graph.
- [ ] Mode 1 session completes without calling `scoreCultureInterview`.

**Phase 4 Done when:**
- [ ] GitHub enrichment creates `Skill`, `WorkingStyle`, and `CommunicationStyle` nodes.
- [ ] Contribution analysis creates Experience-like nodes for external repos.

**Phase 5 Done when:**
- [ ] Coverage dashboard is accessible to admins.
- [ ] Re-engagement cron sends emails to dormant candidates.
- [ ] Match feedback includes node type distribution.

---

## 21. Questions?

1. Read the full plan: [`/Users/hans/.kimi/plans/sif-tempest-starman.md`](/Users/hans/.kimi/plans/sif-tempest-starman.md)
2. Read the original strategy: [`knowledge/plan/archive/superseded-strategy-v2-2026-06-19/pipe-strategy-v2-part4-candidate-ingestion.md`](/Users/hans/Code/PIPE/PIPE-OS/knowledge/plan/archive/superseded-strategy-v2-2026-06-19/pipe-strategy-v2-part4-candidate-ingestion.md)
3. Check existing graph code: [`lib/candidateDiscovery/candidateNodes.ts`](/Users/hans/Code/PIPE/PIPE-OS/workers/api/src/lib/candidateDiscovery/candidateNodes.ts), [`lib/candidateDiscovery/decomposeCodeReview.ts`](/Users/hans/Code/PIPE/PIPE-OS/workers/api/src/lib/candidateDiscovery/decomposeCodeReview.ts)
4. Ask the PM or architect before changing any locked decision in Section 14.

---

*Good luck. The graph is waiting for its seed.*
