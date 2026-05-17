# Decomposition Pipeline

**Owner:** Culture Agent Team  
**Status:** PENDING  
**Source strategy:** `culture-agent-redesign-master.md` §3.3, `architecture/decomposition-contract.md`  
**Blocked by:** `architecture/decomposition-contract.md`  
**Blocks:** `integration/post-screener-matching-trigger.md`  

---

## 1. Problem Statement

The culture interview extracts structured signal from every candidate answer, then throws it away. `cultureAgentDecomposition.ts:239` is a stub. The route handler (`culture.ts:983–1025`) calls decomposition synchronously, blocking the candidate's next question, for data that is discarded. This pipeline defines how to extract, validate, batch, and persist decomposition output to `candidate_nodes`.

## 2. Current State

**Current flow:**
```
Candidate answers
  → decomposeCandidateAnswer() [LLM call]
    → returns DecomposedAnswer { culturalSignals, newExperiences, newProjects, clarificationNeeded }
    → persistDecomposition() [stub — logs and returns]
      → signal lost
```

**Current prompt (`buildDecompositionSystemPrompt`):**
- Asks for `culturalSignals`, `newExperiences`, `newProjects`
- No `WorkingStyle`, `Motivation`, `ConflictHandling`, `SelfAwareness`, `Skill`
- `scoreEstimate` is requested but never used

**Current persistence (`persistDecomposition`):**
```typescript
export async function persistDecomposition(_input: PersistDecompositionInput): Promise<void> {
  console.log('[persistDecomposition] skipped — candidate_nodes table not yet created');
}
```

## 3. Target State

### 3.1 Pipeline flow

```
Candidate answers (turn N)
  → Heuristic evaluator runs (<1ms)
    → If adequate: queue for decomposition
      → [async, in waitUntil] runDecompositionBatch()
        → LLM extracts all node types
          → validateDecompositionOutput()
            → filter invalid nodes
              → batch insert to candidate_nodes
                → [async, in postScreenerEnrichment] embed unembedded nodes
```

### 3.2 Parallel outputs at termination

At termination, two LLM calls run in parallel:

**Call 1: Transcript synthesis (rich profile)**

```typescript
export async function synthesizeCandidateProfile(
  provider: LLMProvider,
  transcript: CultureTranscriptV2,
): Promise<CandidateProfile> {
  const messages: LLMMessage[] = [
    { role: 'system', content: buildProfileSynthesisSystemPrompt() },
    { role: 'user', content: buildProfileSynthesisUserMessage(transcript) },
  ];

  const completion = await provider.complete(messages, { forceJson: true, maxTokens: 2048 });
  const parsed = parseProfileSynthesisJson(completion.content);
  return validateProfileSynthesis(parsed, transcript);
}
```

This produces the rich `CandidateProfile` (career timeline, skills inventory, project portfolio). It is persisted to `candidate_ingestion.profile_json` and is the **primary artifact** for candidate review and recruiter presentation.

**Call 2: Batch decomposition (matching signal)**

```typescript
export async function decomposeTranscript(
  provider: LLMProvider,
  transcript: CultureTranscriptV2,
): Promise<DecompositionOutput> {
  // Build a condensed transcript (question + answer per turn)
  const condensed = transcript.turns.map(t => ({
    question: t.questionText,
    answer: t.candidateResponse,
    phase: t.phase,
  }));

  const messages: LLMMessage[] = [
    { role: 'system', content: buildDecompositionSystemPromptV2() },
    { role: 'user', content: buildDecompositionUserMessage(condensed) },
  ];

  const completion = await provider.complete(messages, { forceJson: true, maxTokens: 2048 });
  const parsed = parseDecompositionJson(completion.content);
  return validateDecompositionOutput(parsed, transcript);
}
```

This produces `candidate_nodes` for matching. The nodes are **supplemented** by the synthesis output — if the synthesis found a role that decomposition missed, the synthesis fields backfill the node.

### 3.3 Decomposition prompt v2

```markdown
# Role
You are a structured information extraction system. Your job is to read a behavioral interview transcript and extract structured sub-elements.

# Input
You will receive a transcript of N turns. Each turn has a question and the candidate's answer.

# Output contract
Respond with ONE JSON object. No prose. No markdown fences.

{
  "culturalSignals": [
    {
      "dimension": "ownership | collaboration | learning-orientation | conflict-handling | self-awareness",
      "evidenceQuote": "verbatim quote from the transcript",
      "scoreEstimate": 1-5,
      "confidence": 0.0-1.0,
      "turnIndex": 0
    }
  ],
  "workingStyles": [
    {
      "style": "pair_programming | async_communication | deep_work | frequent_sync | autonomous",
      "evidenceQuote": "verbatim quote",
      "confidence": 0.0-1.0,
      "turnIndex": 0
    }
  ],
  "motivations": [
    {
      "theme": "impact | growth | stability | compensation | autonomy | craft | mission",
      "evidenceQuote": "verbatim quote",
      "strength": 1-5,
      "confidence": 0.0-1.0,
      "turnIndex": 0
    }
  ],
  "conflictHandlers": [
    {
      "pattern": "direct_confrontation | escalation | mediation | avoidance | compromise",
      "evidenceQuote": "verbatim quote",
      "confidence": 0.0-1.0,
      "turnIndex": 0
    }
  ],
  "selfAwarenessSignals": [
    {
      "signal": "acknowledged_weakness | sought_feedback | adapted_approach | owned_mistake",
      "evidenceQuote": "verbatim quote",
      "confidence": 0.0-1.0,
      "turnIndex": 0
    }
  ],
  "experiences": [
    {
      "company": "string or omit",
      "role": "string or omit",
      "narrative": "one-sentence summary",
      "inferredSkills": ["skill1", "skill2"],
      "confidence": 0.0-1.0,
      "turnIndex": 0
    }
  ],
  "projects": [
    {
      "name": "string or omit",
      "narrative": "one-sentence summary",
      "techStack": ["tech1", "tech2"],
      "confidence": 0.0-1.0,
      "turnIndex": 0
    }
  ],
  "skills": [
    {
      "name": "string",
      "proficiencySignal": "mentioned | demonstrated | expert",
      "evidenceQuote": "verbatim quote",
      "confidence": 0.0-1.0,
      "turnIndex": 0
    }
  ],
  "clarificationNeeded": false,
  "extractionConfidence": 0.0-1.0
}

# Rules
1. evidenceQuote MUST be a verbatim substring of the candidate's answer.
2. Do not fabricate quotes. If you cannot find a verbatim substring, omit the node.
3. scoreEstimate is your judgment of the candidate's demonstrated level on that dimension.
4. confidence reflects how directly the evidence supports the claim.
5. inferredSkills and techStack should only include technologies explicitly mentioned.
```

### 3.4 Validation

```typescript
function validateDecompositionOutput(
  output: unknown,
  transcript: CultureTranscriptV2,
): DecompositionOutput {
  const result = output as DecompositionOutput;
  const allNodes = [
    ...result.culturalSignals,
    ...result.workingStyles,
    ...result.motivations,
    ...result.conflictHandlers,
    ...result.selfAwarenessSignals,
    ...result.experiences,
    ...result.projects,
    ...result.skills,
  ];

  const validNodes = allNodes.filter(node => {
    // Rule 1: evidenceQuote must be substring of some answer
    const isSubstring = transcript.turns.some(t =>
      t.candidateResponse.toLowerCase().includes(node.evidenceQuote.toLowerCase().trim())
    );
    if (!isSubstring) {
      console.warn('[validateDecomposition] fabricated quote:', node.evidenceQuote.slice(0, 100));
      return false;
    }

    // Rule 2: confidence in [0, 1]
    if (node.confidence < 0 || node.confidence > 1) return false;

    // Rule 3: turnIndex in range
    if (node.turnIndex < 0 || node.turnIndex >= transcript.turns.length) return false;

    return true;
  });

  // If >50% invalid, discard entire output
  if (validNodes.length < allNodes.length / 2) {
    throw new Error(`Decomposition validation failed: ${validNodes.length}/${allNodes.length} valid`);
  }

  return result;
}
```

### 3.5 Persistence

```typescript
export async function persistDecompositionBatch(
  db: D1Database,
  candidateId: string,
  sessionId: string,
  output: DecompositionOutput,
  mode: 'profile_builder' | 'role_fit',
): Promise<void> {
  const sourceType = mode === 'profile_builder' ? 'automated_screener' : 'culture_interview';
  const nodes = flattenDecompositionOutput(output);

  // Chunked insert (D1 limit: 100 params)
  const CHUNK_SIZE = 8;
  for (const chunk of chunks(nodes, CHUNK_SIZE)) {
    const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
    const values = chunk.flatMap(node => [
      cryptoRandomId(), candidateId, node.nodeType, node.narrativeText,
      JSON.stringify(node.extractedProperties), null,
      sourceType, sessionId, Date.now(), node.confidence,
    ]);

    await db.prepare(`
      INSERT INTO candidate_nodes (id, candidate_id, node_type, narrative_text, extracted_properties_json, embedding_json, source_type, source_reference, captured_at, confidence)
      VALUES ${placeholders}
    `).bind(...values).run();
  }
}
```

## 4. Implementation Details

### 4.1 File changes

| File | Change |
|---|---|
| `workers/api/src/lib/cultureAgentDecomposition.ts` | **Rewrite.** New prompt, new output shape, validation, real persistence. |
| `workers/api/src/lib/cultureAgent.ts` | **Modify.** Remove per-turn decomposition. Add termination-level batch decomposition. |
| `workers/api/src/routes/screening/culture.ts` | **Modify.** Move decomposition to `waitUntil()` after termination. |

### 4.2 Async pattern

```typescript
// In route handler, after termination
c.executionCtx.waitUntil(
  (async () => {
    const decomposition = await decomposeTranscript(provider, transcript);
    await persistDecompositionBatch(db, candidateId, sessionId, decomposition, mode);
    if (mode === 'profile_builder') {
      await runPostScreenerEnrichment(candidateId, env);
    }
  })()
);
```

## 5. Open Questions

1. **Should decomposition run on ALL turns or only probing turns?** Rapport and wrap-up turns may contain signal too. — **Recommendation:** All turns. The prompt sees the full transcript and decides what to extract.

2. **What if the transcript is very long (20 turns)?** The decomposition prompt may exceed context window. — **Recommendation:** If transcript > 15 turns, truncate to last 10 turns + summary of first 5.

3. **Should `scoreEstimate` be used for matching?** The decomposition produces `scoreEstimate` 1–5, but matching uses embeddings, not scores. — **Recommendation:** Store `scoreEstimate` in `extracted_properties_json` for future use. Do not use for matching today.

## 6. Validation Criteria

- **Unit test:** `validateDecompositionOutput` correctly filters fabricated quotes.
- **Unit test:** Chunked insert stays under D1 parameter limit.
- **E2E test:** After interview, `candidate_nodes` has ≥10 nodes.
- **E2E test:** All `evidenceQuote` values are substrings of original answers.

## 7. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Decomposition LLM returns invalid JSON | Medium | Medium | Guard retry (2 retries); on failure, skip decomposition |
| Long transcript exceeds context window | Medium | High | Truncate to last 10 turns + summary |
| Evidence quotes are fabricated | Medium | High | Substring validation; reject fabricated quotes |
| Batch insert fails mid-chunk | Low | High | Chunked inserts; each chunk is independent |
