# Mode-1: Profile Builder Specification

**Owner:** Culture Agent Team  
**Status:** PENDING  
**Source strategy:** `culture-agent-redesign-master.md` §4.1  
**Blocked by:** `architecture/agent-flow-spec.md`, `architecture/state-machine-spec.md`  
**Blocks:** `integration/post-screener-matching-trigger.md`  

---

## 1. Problem Statement

Mode-1 is the pre-match screener. It runs after resume upload, before matching. Its goal is graph construction, not evaluation. The candidate completes a 10–15 minute structured conversation that produces `CulturalSignal`, `WorkingStyle`, `Motivation`, `ConflictHandling`, `SelfAwareness`, `Experience`, `Project`, and `Skill` nodes. These nodes are written to `candidate_nodes`, embedded, mean-pooled into the aggregate vector, and then matching runs.

The current system has no Mode-1. The culture interview runs at stage 1 (`CULTURAL`) after matching, in `role_fit` mode, with the 15-question static bank.

## 2. Current State

There is no Mode-1. What exists:
- `cultureAgentAdaptive.ts` supports `mode: 'profile_builder'` but it's never invoked.
- `cultureQuestionBank.ts` has 15 competency-focused questions, no Experience/Motivation/Context probes.
- `candidate_ingestion.status` has no `'enriched'` state.
- `profile_probe_bank` table does not exist.
- `candidate_coverage` table does not exist.

## 3. Target State

### 3.1 Trigger

```
Candidate uploads resume
  → runCandidateDiscovery() completes
  → status = 'embedded'
  → get-stage-config checks status
  → if tailored/hybrid: returns Mode-1 screener challenge
```

### 3.2 Probe bank

**New table:** `profile_probe_bank`

```sql
CREATE TABLE profile_probe_bank (
  id TEXT PRIMARY KEY,
  dimension TEXT NOT NULL CHECK (dimension IN ('experience','cultural','technical','motivation','context')),
  text TEXT NOT NULL,
  expected_sub_element_types TEXT NOT NULL, -- JSON array: ['CulturalSignal','Experience',...]
  seniority_tags TEXT, -- JSON array: ['junior','mid','senior']
  source TEXT NOT NULL DEFAULT 'curated',
  approved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_profile_probe_bank_dimension ON profile_probe_bank(dimension);
```

**Initial curation (25 probes, 5 per dimension):**

| ID | Dimension | Text | Expected Nodes |
|---|---|---|---|
| `pb-history-001` | experience | "Walk me through your career chronologically. Start with your first professional role and tell me: what was the company, your title, how long were you there, what did you actually do day-to-day, and why did you move on?" | Experience |
| `pb-history-002` | experience | "Looking at your most recent role: what was your exact title, who did you report to, how big was your team, and what was the scope of the system or product you owned?" | Experience |
| `pb-history-003` | experience | "What are the 2–3 most significant technical projects you've shipped in the last 5 years? For each: what was it, what technologies did you use, what was your specific contribution, and what was the measurable outcome?" | Experience, Project |
| `pb-exp-001` | experience | "At [COMPANY], tell me about a time you owned something end-to-end. What did the system do, how big was the team, and what happened when it broke?" | Experience, Skill |
| `pb-exp-002` | experience | "At [COMPANY], tell me about a time you had to deliver with an unrealistic deadline. What did you actually ship?" | Experience, CulturalSignal |
| `pb-cul-001` | cultural | "Describe a situation where you disagreed with a teammate's technical approach. What did you do?" | CulturalSignal, ConflictHandling |
| `pb-cul-002` | cultural | "When was the last time you significantly changed your mind about something at work? What caused it?" | CulturalSignal, SelfAwareness |
| `pb-tech-001` | technical | "You mention [SKILL] on your resume. Tell me about a specific bug or incident you debugged using it." | Skill, Experience |
| `pb-tech-002` | technical | "What's a technology you learned recently because you needed it, not because you were told to?" | Skill, Motivation |
| `pb-mot-001` | motivation | "What are you optimizing for in your next role? Be specific — money, impact, autonomy, craft, growth?" | Motivation |
| `pb-mot-002` | motivation | "Describe your worst job fit. What made it wrong?" | Motivation, CulturalSignal |
| `pb-ctx-001` | context | "What does your ideal working arrangement look like? Remote, hybrid, in-office?" | Context |
| `pb-ctx-002` | context | "What company stage are you most comfortable in? Startup, growth, enterprise?" | Context |

**Probe sequencing:** Career history probes (`pb-history-*`) run first (rapport + first 2 probing turns) to build the chronological timeline. Behavioral depth probes (`pb-exp-*`, `pb-cul-*`, etc.) run after, anchored to specific companies/roles the candidate already mentioned.

*(Full 25-probe set to be curated by recruiter team. Engineering owns schema and ingestion.)*

### 3.3 Coverage computation

```typescript
interface CoverageState {
  careerHistory: { completeness: number; lastProbedAt: number | null };
  behavioralDepth: { completeness: number; lastProbedAt: number | null };
  cultural: { completeness: number; lastProbedAt: number | null };
  technical: { completeness: number; lastProbedAt: number | null };
  motivation: { completeness: number; lastProbedAt: number | null };
  context: { completeness: number; lastProbedAt: number | null };
}

function computeCoverage(
  transcript: CultureTranscriptV2,
  pendingNodes: CandidateNodeDraft[],
): CoverageState {
  // Count nodes per dimension from pendingNodes
  const counts = countNodesByDimension(pendingNodes);

  // Career history: target = 3+ Experience nodes with dates/scope
  const careerHistoryComplete = counts.experience >= 3 &&
    pendingNodes.some(n => n.nodeType === 'Experience' && n.extractedProperties.startDate);

  // Behavioral depth: target = 2+ STAR stories anchored to specific roles
  const behavioralDepthComplete = counts.behavioral >= 2;

  return {
    careerHistory: { completeness: careerHistoryComplete ? 1.0 : counts.experience / 3, lastProbedAt: ... },
    behavioralDepth: { completeness: behavioralDepthComplete ? 1.0 : counts.behavioral / 2, lastProbedAt: ... },
    cultural: { completeness: Math.min(1, counts.cultural / 2), lastProbedAt: ... },
    technical: { completeness: Math.min(1, counts.technical / 2), lastProbedAt: ... },
    motivation: { completeness: Math.min(1, counts.motivation / 2), lastProbedAt: ... },
    context: { completeness: Math.min(1, counts.context / 2), lastProbedAt: ... },
  };
}

function isCoverageAdequate(coverage: CoverageState): boolean {
  return Object.values(coverage).every(d => d.completeness >= 0.5);
}

// Career history probes are prioritized until careerHistory >= 0.5
function selectNextDimension(coverage: CoverageState): string {
  if (coverage.careerHistory.completeness < 0.5) return 'careerHistory';
  return Object.entries(coverage)
    .sort((a, b) => a[1].completeness - b[1].completeness)[0][0];
}
```

### 3.4 Probe selection

```typescript
function selectNextProbe(
  coverage: CoverageState,
  priorProbes: string[],
  candidateSeniority: string,
): ProfileProbe {
  // 1. Find lowest-coverage dimension
  const dim = Object.entries(coverage)
    .sort((a, b) => a[1].completeness - b[1].completeness)[0][0];

  // 2. Load probes for this dimension
  const probes = await db.prepare(`
    SELECT * FROM profile_probe_bank
    WHERE dimension = ? AND seniority_tags LIKE ?
    ORDER BY approved_at DESC
  `).bind(dim, `%${candidateSeniority}%`).all();

  // 3. Exclude already-asked probes
  const available = probes.results?.filter(p => !priorProbes.includes(p.id)) ?? [];

  // 4. Pick first available
  return available[0] ?? null;
}
```

### 3.5 Termination conditions

```typescript
function shouldTerminate(state: InterviewStateV2): boolean {
  const { turns, coverage, config } = state;
  const mainTurns = turns.filter(t => t.phase === 'probing');

  // Coverage complete + minimum met
  if (mainTurns.length >= config.minQuestions && isCoverageAdequate(coverage)) {
    return true;
  }

  // Budget exhausted
  if (mainTurns.length >= config.maxQuestions) {
    return true;
  }

  // Bank exhausted
  const bankExhausted = /* all probes asked */;
  if (bankExhausted && mainTurns.length >= config.minQuestions) {
    return true;
  }

  return false;
}
```

**Config:**
- `minQuestions`: 8
- `maxQuestions`: 15
- `maxDrills`: 2 per thin answer

### 3.6 Output (two parallel artifacts)

On termination:
1. **Transcript synthesis** — produces rich `candidate_profile_json` (career timeline, skills, projects, working style, motivation). Persists to `candidate_ingestion.profile_json`.
2. **Batch decomposition** — extracts `candidate_nodes` for matching signal. Persists to `candidate_nodes`.
3. Trigger `postScreenerEnrichment` (async, `waitUntil`) — embeds nodes, mean-pools, updates Vectorize.
4. Update `candidate_ingestion.status = 'enriched'`.
5. Candidate sees profile review page with editable timeline.
6. No score report. No HITL gate.

## 4. Implementation Details

### 4.1 File changes

| File | Change |
|---|---|
| `workers/api/src/lib/cultureProbeBank.ts` | **New.** `profile_probe_bank` loader and selector. |
| `workers/api/src/lib/cultureCoverage.ts` | **New.** Coverage computation. |
| `workers/api/src/lib/cultureAgent.ts` | **Modify.** Add Mode-1 path in start/advance. |
| `workers/api/src/routes/screening/culture.ts` | **Modify.** Derive mode from `candidate_ingestion.status`. |
| `workers/api/migrations/0070_profile_probe_bank.sql` | **New.** Migration for `profile_probe_bank`. |

### 4.2 D1 migration

```sql
-- Migration 0070: Profile probe bank for Mode-1 screener
CREATE TABLE profile_probe_bank (
  id TEXT PRIMARY KEY,
  dimension TEXT NOT NULL CHECK (dimension IN ('experience','cultural','technical','motivation','context')),
  text TEXT NOT NULL,
  expected_sub_element_types TEXT NOT NULL,
  seniority_tags TEXT,
  source TEXT NOT NULL DEFAULT 'curated',
  approved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_profile_probe_bank_dimension ON profile_probe_bank(dimension);

-- Seed initial 10 probes (engineering-curated, recruiter-approved later)
INSERT INTO profile_probe_bank (id, dimension, text, expected_sub_element_types, seniority_tags) VALUES
('pb-exp-001', 'experience', 'Walk me through the most complex system you owned end-to-end...', '["Experience","Skill"]', '["mid","senior","lead"]'),
('pb-cul-001', 'cultural', 'Describe a situation where you disagreed with a teammate...', '["CulturalSignal","ConflictHandling"]', '["junior","mid","senior","lead"]'),
('pb-tech-001', 'technical', 'You mention [SKILL] on your resume. Tell me about a specific bug...', '["Skill","Experience"]', '["mid","senior","lead"]'),
('pb-mot-001', 'motivation', 'What are you optimizing for in your next role?...', '["Motivation"]', '["junior","mid","senior","lead"]'),
('pb-ctx-001', 'context', 'What does your ideal working arrangement look like?...', '["Context"]', '["junior","mid","senior","lead"]');
```

## 5. Open Questions

1. **Who approves probes for compliance?** NYC Local Law 144 requires every probe to trace to a finite approved bank. — **Recommendation:** Recruiter team approves. Engineering seeds 10; recruiter team expands to 25–50.

2. **Should Mode-1 use the generative planner?** The planner personalizes questions but is flaky. Mode-1 is a blocking gate — flakiness is unacceptable. — **Recommendation:** No generative planner for Mode-1. Use `profile_probe_bank` exclusively. Generative planner is Mode-2 only.

3. **What if `profile_probe_bank` is empty?** E.g., a new dimension with no curated probes. — **Recommendation:** Fallback to generic dimension probe: "Tell me more about your [dimension] background." Log warning for recruiter to curate.

## 6. Validation Criteria

- **Unit test:** `selectNextProbe` returns lowest-coverage dimension probe.
- **Unit test:** `computeCoverage` returns correct completeness for known node sets.
- **E2E test:** Mode-1 interview completes in 8–15 turns.
- **E2E test:** After completion, `candidate_nodes` has ≥2 nodes per dimension.
- **E2E test:** `candidate_ingestion.status` transitions `embedded → enriched`.

## 7. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Candidate abandons Mode-1 mid-interview | Medium | High (no graph, no match) | Add `status = 'partial'`. Matching runs with discounted confidence. |
| `profile_probe_bank` curation is slow | High | High (blocks Phase 2) | Seed 10 probes engineering-curated. Recruiter expands async. |
| Probe bank feels repetitive after 10 questions | Medium | Medium | 25 probes × 5 dimensions = 125 combinations. Rotation prevents repetition. |
| Candidates find screener intrusive | Medium | Medium | Frame as "profile building" not "assessment." Candidate can view/edit profile. |
