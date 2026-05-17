# Decomposition Contract

**Owner:** Culture Agent Team  
**Status:** PENDING  
**Source strategy:** `culture-agent-redesign-master.md` §3.3  
**Blocked by:** None  
**Blocks:** `implementation/decomposition-pipeline.md`  

---

## 1. Problem Statement

The culture interview extracts rich structured signal from every candidate answer, then throws it away. `cultureAgentDecomposition.ts:239` is a stub that logs and returns. The decomposition prompt (`buildDecompositionSystemPrompt`) defines `CulturalSignal`, `Experience`, and `Project` extraction, but no consumer reads the output. This contract defines exactly what the decomposition pipeline produces, how it is validated, and how it is persisted.

## 2. Current State

**Current decomposition output (`cultureAgentDecomposition.ts:22–45`):**
```typescript
interface DecomposedAnswer {
  culturalSignals: DecomposedCulturalSignal[];
  newExperiences: DecomposedExperience[];
  newProjects: DecomposedProject[];
  clarificationNeeded: boolean;
}
```

**Current persistence (`cultureAgentDecomposition.ts:239–242`):**
```typescript
export async function persistDecomposition(_input: PersistDecompositionInput): Promise<void> {
  // Stub: candidate_nodes table does not exist yet.
  console.log('[persistDecomposition] skipped — candidate_nodes table not yet created');
}
```

**Problems:**
- No `WorkingStyle`, `Motivation`, `ConflictHandling`, or `SelfAwareness` extraction.
- No `Skill` extraction (e.g., "we used Kafka" → `Skill: Kafka`).
- `scoreEstimate` in `DecomposedCulturalSignal` is never used.
- No confidence scoring on `Experience` or `Project`.
- Persistence is a stub.

## 3. Target State

### 3.1 Decomposition output shape

```typescript
interface DecompositionOutput {
  culturalSignals: CulturalSignalNode[];
  workingStyles: WorkingStyleNode[];
  motivations: MotivationNode[];
  conflictHandlers: ConflictHandlingNode[];
  selfAwarenessSignals: SelfAwarenessNode[];
  experiences: ExperienceNode[];
  projects: ProjectNode[];
  skills: SkillNode[];
  clarificationNeeded: boolean;
  extractionConfidence: number; // 0.0–1.0, overall
}

interface CulturalSignalNode {
  dimension: CompetencyDimension | CultureProfileDimension;
  evidenceQuote: string;      // verbatim from answer
  scoreEstimate: 1 | 2 | 3 | 4 | 5;
  confidence: number;         // 0.0–1.0
  turnIndex: number;
}

interface WorkingStyleNode {
  style: string;              // e.g., 'pair_programming', 'async_communication'
  evidenceQuote: string;
  confidence: number;
}

interface MotivationNode {
  theme: string;              // e.g., 'impact', 'growth', 'stability'
  evidenceQuote: string;
  strength: 1 | 2 | 3 | 4 | 5;
  confidence: number;
}

interface ConflictHandlingNode {
  pattern: string;            // e.g., 'direct_confrontation', 'escalation', 'mediation'
  evidenceQuote: string;
  confidence: number;
}

interface SelfAwarenessNode {
  signal: string;             // e.g., 'acknowledged_weakness', 'sought_feedback'
  evidenceQuote: string;
  confidence: number;
}

interface ExperienceNode {
  company?: string;
  role?: string;
  narrative: string;
  inferredSkills: string[];
  confidence: number;
}

interface ProjectNode {
  name?: string;
  narrative: string;
  techStack: string[];
  confidence: number;
}

interface SkillNode {
  name: string;
  proficiencySignal: 'mentioned' | 'demonstrated' | 'expert';
  evidenceQuote: string;
  confidence: number;
}
```

### 3.2 Prompt output schema

The decomposition prompt must produce exactly this JSON shape:

```json
{
  "culturalSignals": [
    {
      "dimension": "ownership",
      "evidenceQuote": "verbatim quote",
      "scoreEstimate": 4,
      "confidence": 0.85
    }
  ],
  "workingStyles": [
    {
      "style": "async_communication",
      "evidenceQuote": "verbatim quote",
      "confidence": 0.7
    }
  ],
  "motivations": [
    {
      "theme": "impact",
      "evidenceQuote": "verbatim quote",
      "strength": 5,
      "confidence": 0.9
    }
  ],
  "conflictHandlers": [
    {
      "pattern": "direct_confrontation",
      "evidenceQuote": "verbatim quote",
      "confidence": 0.75
    }
  ],
  "selfAwarenessSignals": [
    {
      "signal": "acknowledged_weakness",
      "evidenceQuote": "verbatim quote",
      "confidence": 0.8
    }
  ],
  "experiences": [
    {
      "company": "Acme Corp",
      "role": "Senior Engineer",
      "narrative": "one-sentence summary",
      "inferredSkills": ["Kafka", "Python"],
      "confidence": 0.8
    }
  ],
  "projects": [
    {
      "name": "event-stream-processor",
      "narrative": "one-sentence summary",
      "techStack": ["RabbitMQ", "Go"],
      "confidence": 0.75
    }
  ],
  "skills": [
    {
      "name": "Kafka",
      "proficiencySignal": "demonstrated",
      "evidenceQuote": "verbatim quote",
      "confidence": 0.85
    }
  ],
  "clarificationNeeded": false,
  "extractionConfidence": 0.82
}
```

### 3.3 Validation rules

Every decomposition output is validated before persistence:

1. `evidenceQuote` must be a substring of the candidate's answer (case-insensitive, whitespace-normalized).
2. `confidence` must be in [0, 1].
3. `scoreEstimate` must be in [1, 5].
4. `dimension` must be in `COMPETENCY_DIMENSIONS` or `CULTURE_PROFILE_DIMENSIONS`.
5. `proficiencySignal` must be in `['mentioned', 'demonstrated', 'expert']`.
6. `extractionConfidence` must be in [0, 1].

**Validation failure handling:**
- If >50% of nodes fail validation: discard entire decomposition, log warning, continue interview.
- If ≤50% fail: filter invalid nodes, keep valid ones, log filtered nodes.

### 3.4 Persistence contract

**Per-turn (optional, batched):**
```typescript
// Called after each answer in probing/drilling phases
await persistDecompositionTurn(db, candidateId, sessionId, decompositionOutput, {
  sourceType: 'automated_screener', // or 'culture_interview'
  capturedAt: Date.now(),
});
```

**At termination (required):**
```typescript
// Called once at termination
await persistDecompositionBatch(db, candidateId, sessionId, allPendingNodes, {
  sourceType: 'automated_screener',
  capturedAt: Date.now(),
});
```

**D1 insert:**
```sql
INSERT INTO candidate_nodes (
  id, candidate_id, node_type, narrative_text,
  extracted_properties_json, embedding_json,
  source_type, source_reference, captured_at, confidence, supersedes
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
```

**Async embedding (in `postScreenerEnrichment.ts`):**
```typescript
// After batch insert, queue unembedded nodes for embedding
const unembedded = await db.prepare(`
  SELECT id, narrative_text FROM candidate_nodes
  WHERE candidate_id = ? AND embedding_json IS NULL
`).bind(candidateId).all();
```

## 4. Implementation Details

### 4.1 File changes

| File | Change |
|---|---|
| `workers/api/src/lib/cultureAgentDecomposition.ts` | **Rewrite.** New output shape, new prompt, validation logic, real persistence. |
| `workers/api/src/lib/candidateDiscovery/candidateNodes.ts` | **Modify.** Ensure `insertCandidateNode` accepts all new node types. |
| `workers/api/src/lib/candidateDiscovery/postScreenerEnrichment.ts` | **New.** Async embedding + mean-pool + match trigger. |

### 4.2 Prompt version

```
culture-decomposition-v2
```

Changes from v1:
- Adds `workingStyles`, `motivations`, `conflictHandlers`, `selfAwarenessSignals`, `skills`
- Adds `extractionConfidence` aggregate
- Removes `scoreEstimate` from `experiences` and `projects`

**Cache invalidation:** If prompt version changes, do NOT re-process historical candidates. New candidates use new prompt. Historical nodes keep old version.

### 4.3 D1 batching

D1 supports up to 100 bound parameters per query. For 20 nodes × 11 parameters = 220 parameters. Use chunked inserts:

```typescript
const CHUNK_SIZE = 8; // 8 × 11 = 88 parameters, under limit
for (const chunk of chunks(nodes, CHUNK_SIZE)) {
  await insertCandidateNodeChunk(db, chunk);
}
```

## 5. Open Questions

1. **Should decomposition run per-turn or only at termination?** Per-turn gives partial graph if candidate abandons. At-termination is simpler and cheaper. — **Recommendation:** At-termination only. The interview is short (10–15 min); abandonment mid-interview is rare. Partial graph is not worth the cost.

2. **Should `scoreEstimate` be used for anything?** The decomposition prompt asks for it, but the scorer ignores it and recomputes from transcript. — **Recommendation:** Keep `scoreEstimate` in decomposition output for future calibration, but do not use it for matching or scoring today.

3. **How do we handle duplicate nodes?** If the candidate mentions Kafka in turn 3 and turn 7, do we create two `Skill: Kafka` nodes? — **Recommendation:** Yes, create both. Deduplication happens at embedding time (mean-pool collapses duplicates). Keep all evidence for audit.

## 6. Validation Criteria

- **Unit test:** Validation rules correctly filter invalid nodes.
- **Unit test:** Chunked insert stays under D1 parameter limit.
- **E2E test:** After interview completion, `candidate_nodes` contains ≥10 nodes per completed interview.
- **E2E test:** All `evidenceQuote` values are substrings of original answers.

## 7. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Decomposition LLM returns invalid JSON | Medium | Medium | Guard retry loop (2 retries); on failure, skip decomposition for this turn |
| D1 insert fails mid-batch | Low | High | Chunked inserts; each chunk is independent. Failed chunk logged, others succeed. |
| Evidence quotes are fabricated (not substrings) | Medium | High | Validation rule #1: substring check. Reject fabricated quotes. |
| Node count explodes (100+ nodes per interview) | Low | Medium | Cap at 30 nodes per interview. Log warning if exceeded. |
