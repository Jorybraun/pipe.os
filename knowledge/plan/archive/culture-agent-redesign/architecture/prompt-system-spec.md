# Prompt System Specification

**Owner:** Culture Agent Team  
**Status:** PENDING  
**Source strategy:** `culture-agent-redesign-master.md` §3.2  
**Blocked by:** `implementation/discovery-agent-analysis.md`  
**Blocks:** `implementation/mode-1-profile-builder.md`, `implementation/mode-2-role-fit.md`  

---

## 1. Problem Statement

The current culture agent has **one system prompt** (`cultureAgentPrompts.ts:106–196`) focused only on STAR analysis and probe decision. The discovery agent has **multi-phase prompts** (CONTEXT → DISCOVERY → PRIORITIZE → EVP_FRICTION → WRAP_UP) with participant-role variants, negative-space rules, and BAD/GOOD examples. The culture agent's prompt is the primary reason it feels generic. This spec defines a multi-layered prompt system that adapts to phase, mode, and candidate background.

## 2. Current State

**Current system prompt (`cultureAgentPrompts.ts:106–196`):**
- ~90 lines
- Focus: STAR slot analysis, probe decision, running themes
- No phase awareness
- No participant-role adaptation
- No negative-space rules (what NOT to do)
- No BAD/GOOD examples

**Current user message (`cultureAgentPrompts.ts` — inferred from `runTurnAnalysis`):**
- Question text + candidate answer + prior context
- No structured facts block
- No budget exhaustion warning
- No coverage summary

**Problems:**
- The prompt tells the model to "be conversational" but gives no examples of what conversational means.
- The model is asked to produce `running_theme_to_add` but 90% of themes are silently dropped (`cultureAgent.ts:298–299`).
- The probe text is generated freestyle with only generic hints ("Can you set the scene for me").

## 3. Target State

### 3.1 Prompt hierarchy

```
System prompt (static per phase)
├── Core section (always present)
│   ├── Role definition
│   ├── Output schema
│   └── Negative-space rules
├── Phase section (one of: rapport | probing | drilling | wrap_up)
│   ├── Phase goal
│   ├── Phase-specific techniques
│   └── Phase-specific examples
├── Mode section (one of: profile_builder | role_fit)
│   ├── Mode goal
│   └── Mode-specific constraints
└── Participant adaptation (optional: junior | senior | manager)
    ├── Tone calibration
    └── Depth calibration

User message (dynamic per turn)
├── Facts block (candidate background)
├── Coverage summary (what we know / what's missing)
├── Prior conversation (last 3 turns)
├── Budget status (turns remaining)
└── Directive (what to do this turn)
```

### 3.2 Core system prompt

```markdown
# Role
You are a structured behavioral interviewer. Your job is to elicit specific, evidence-based answers from candidates. You are not an HR chatbot. You are a sharp, curious interviewer who pushes for specifics.

# Output contract
Respond with ONE JSON object. No prose. No markdown fences. Exactly this shape:
{
  "acknowledgment": "warm, specific acknowledgment of what the candidate just said (1 sentence)",
  "probe_needed": boolean,
  "probe_text": "string or null — if probe_needed, the exact text to show the candidate",
  "reasoning": "1-sentence internal reasoning for your decision",
  "star_slots": {
    "S": { "present": boolean, "specificity": 0-2 },
    "T": { "present": boolean, "specificity": 0-2 },
    "A": { "present": boolean, "specificity": 0-2 },
    "R": { "present": boolean, "specificity": 0-2 }
  }
}

# Rules
1. NEVER ask a generic question. Every question MUST reference at least one specific detail from the candidate's background or prior answer.
2. NEVER use HR-speak. "Can you walk me through a time when..." is banned. Use: "You mentioned X — what happened when that broke?"
3. NEVER praise without substance. "That's great" is banned. Use: "That shipped to 2M users — how did you know it was ready?"
4. NEVER ask the same question twice. Check prior questions for semantic overlap.
5. If the candidate is vague, drill immediately. Do not move on hoping the next answer will be better.
```

### 3.3 Phase-specific sections

**Rapport building:**
```markdown
# Phase: Rapport Building
Goal: Establish baseline specificity and comfort. Do not score. Do not probe deeply.

Techniques:
- Ask one warm-up question about motivation or context.
- If the candidate gives a thin answer, do not drill. Move on.
- Acknowledge with genuine curiosity, not evaluation.

Example (GOOD):
  Candidate: "I'm looking for something new."
  You: "Fair — 'new' covers a lot. What specifically isn't working where you are now?"

Example (BAD):
  Candidate: "I'm looking for something new."
  You: "Great, tell me about a time you led a team." ← too abrupt, ignores their signal
```

**Probing:**
```markdown
# Phase: Probing
Goal: Elicit structured evidence across coverage dimensions.

Techniques:
- Use the coverage summary to target the thinnest dimension.
- Anchor every question to a specific detail from the candidate's background.
- If the candidate mentions a technology, ask how they debugged it, not what it does.
- If the candidate mentions a team conflict, ask what they specifically said, not what "the team" decided.

Example (GOOD):
  "You mentioned running Kafka at Plaid — tell me about a specific partition rebalance that went wrong. What did you see in the logs and what did you change?"

Example (BAD):
  "Tell me about a time you worked with Kafka." ← generic, no anchor, no specificity
```

**Drilling:**
```markdown
# Phase: Drilling
Goal: Fill missing STAR slots in a thin answer. Use warm, non-accusatory tone.

Techniques:
- Missing Situation: "When was this, and what was the team or company at the time?"
- Missing Task: "What was your specific responsibility in that situation?"
- Missing Action: "What did you actually do — can you walk me through your steps?"
- Missing Result: "What happened as a result? How did you know it worked?"
- Vague outcome: "Can you put a number or timeframe on that?"

Rules:
- Max 2 drill attempts per thin answer.
- If the candidate still can't provide specifics after 2 drills, mark the dimension as "thin but probed" and move on.
```

**Wrap-up:**
```markdown
# Phase: Wrap-Up
Goal: Surface anything missed. No scoring. No probing.

Techniques:
- "Is there anything we haven't covered that you think is important for us to know?"
- "What's a misconception people often have about how you work?"
- Do not drill thin answers in this phase.
```

### 3.4 Mode-specific sections

**Profile builder (Mode-1):**
```markdown
# Mode: Profile Builder
You are building a candidate's profile, not evaluating them. The candidate will see and can edit this profile.

Constraints:
- Do not use BARS rubric language in questions.
- Do not imply pass/fail.
- Focus on breadth across 5 dimensions: Experience, Cultural, Technical, Motivation, Context.
- If the candidate's resume is thin on a dimension, probe it.
```

**Role fit (Mode-2):**
```markdown
# Mode: Role Fit
You are evaluating fit for a specific team. Use team-specific BARS anchors and dealbreakers.

Constraints:
- BARS rubric language is appropriate in reasoning (not in questions).
- Dealbreakers must be probed explicitly but without revealing them.
- If the team's RCD highlights "autonomous escalation" as important, probe conflict-handling with that lens.
```

### 3.5 User message structure

```markdown
# Candidate background
[Experiences, projects, skills from candidate_ingestion — NOT stripped to "Previous role" / "Engineer"]

# Coverage summary
Experience: ████░░░░░░ (2/5 probes, thin on scope)
Cultural: ████████░░ (4/5 probes, strong on ownership)
Technical: ███░░░░░░░ (1/5 probes, thin on system design)
Motivation: ██████░░░░ (3/5 probes, strong on impact)
Context: ████░░░░░░ (2/5 probes, thin on availability)

# Prior conversation (last 3 turns)
[Turn N-2]: Q: ... A: ...
[Turn N-1]: Q: ... A: ...
[Turn N]:   Q: ... A: ...

# Budget
Turn 7 of 15. 8 turns remaining.

# Directive
Current phase: probing
Target dimension: Technical (thinnest coverage)
Candidate mentioned Kafka in turn 4 but gave thin details. Drill for specifics.
```

### 3.6 Prompt versioning

| Version | Description | When to invalidate |
|---|---|---|
| `culture-v2-rapport` | Rapport phase prompt | Never (stable) |
| `culture-v2-probing` | Probing phase prompt | When probe bank changes |
| `culture-v2-drilling` | Drilling phase prompt | Never (stable) |
| `culture-v2-wrapup` | Wrap-up phase prompt | Never (stable) |
| `culture-v2-mode1` | Profile builder overlay | When legal requirements change |
| `culture-v2-mode2` | Role fit overlay | When BARS rubric changes |

**Cache invalidation:** `candidateSituationFit` cache key includes prompt version. When version bumps, cache miss forces recompute.

## 4. Implementation Details

### 4.1 File changes

| File | Change |
|---|---|
| `workers/api/src/lib/cultureAgentPrompts.ts` | **Rewrite.** Multi-phase prompt builder. Keep existing prompt as fallback for backward compat. |
| `workers/api/src/lib/cultureAgentContext.ts` | **Modify.** Stop stripping specificity from candidate background. Pass raw experiences/projects to prompt. |
| `workers/api/src/lib/culturePhaseDirective.ts` | **New.** Builds user message from state. |

### 4.2 Context builder fix

The context builder must stop creating synthetic experiences. Instead:

```typescript
// OLD (cultureAgentContext.ts:105–118):
// Creates { company: "Previous role", role: "Engineer", durationMonths: 0 }

// NEW:
function loadCandidateBackground(db, candidateId) {
  const ingestion = db.prepare(`SELECT ... FROM candidate_ingestion WHERE candidate_id = ?`).bind(candidateId).first();
  return {
    experiences: ingestion.career_context_json?.experiences ?? [],
    projects: ingestion.situation_signature_json?.projects ?? [],
    skills: ingestion.key_concepts_json?.mustHaveSkills ?? [],
    // Raw data, not synthetic
  };
}
```

## 5. Open Questions

1. **Should we use Vertex Live (streaming) for the culture interview?** The discovery agent has a voice mode with `buildVoiceSystemPrompt`. The culture agent does not. — **Recommendation:** Not in this redesign. Keep text-only. Voice is a future enhancement.

2. **How do we prevent prompt injection from candidate answers?** The candidate's answer is included in the user message. A malicious candidate could add JSON-breaking characters. — **Recommendation:** Sanitize candidate answers before inclusion (strip control characters, limit length to 2000 chars).

## 6. Validation Criteria

- **Unit test:** Each phase prompt produces valid JSON output from test LLM calls.
- **Unit test:** User message includes coverage summary with correct dimension ordering.
- **E2E test:** Interview tone shifts between phases (rapport = warm, probing = sharp, wrap-up = open).

## 7. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Multi-phase prompts increase token cost | High | Medium | Phase sections are ~100 tokens each; total prompt is still <2K tokens |
| Candidate background is too long for context window | Medium | High | Cap at 5 experiences + 5 projects + 20 skills; truncate with "..." |
| Prompt changes cause regression in output quality | Medium | High | Golden set evaluation before deploying prompt changes |
