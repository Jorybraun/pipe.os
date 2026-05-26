# Plan: Domain-Driven Interview Generation + Synthesis Reflection

*Replace hardcoded probes with per-domain LLM generation. Add synthesis self-evaluation and user-driven continuation loop.*

---

## Current Problem

The interview system uses 14 hand-written probe texts (`probeLibrarian.ts`) that are baked into source code. Adding a new question requires a code change and redeploy. The probes are domain-agnostic — probe 1 touches `team` + `codebase`, probe 2 touches `team` + `process` — so the interview jumps between domains rather than going deep in one column.

Additionally, the interview ends when the budget is exhausted or all probes are delivered. There is no self-evaluation of whether the synthesis is actually good enough. If a domain is thin, the user has no recourse.

---

## Target Architecture

### Interview Flow

```
START
  │
  ▼
CONTEXT (1-2 turns, build rapport, understand participant)
  │
  ▼
┌─────────────────────────────────────────┐
│  DOMAIN LOOP — one column at a time     │
│                                         │
│  For each domain in priority order:     │
│    1. GENERATE: LLM produces 6 questions│
│       for this domain                   │
│    2. DELIVER: Ask them one by one      │
│    3. DEPTH CHECK: After 6, evaluate    │
│       if domain coverage is DEEP        │
│    4. If shallow → 2-3 follow-ups       │
│       If deep → move to next domain     │
└─────────────────────────────────────────┘
  │
  ▼
SOUL (optional, if enabled)
  Generate human-truth questions dynamically
  Behavior over values, conflict, trauma, tradeoffs
  │
  ▼
PRIORITIZE
  Force ranking of must-haves vs nice-to-haves
  │
  ▼
WRAP_UP
  Brief summary + confirmation
  │
  ▼
SYNTHESIZE
  Generate role brief from all exchanges
  │
  ▼
REFLECT
  Evaluate synthesis quality against goals
  Identify gaps per domain
  │
  ▼
CONTINUATION GATE
  If gaps exist:
    → Ask user: "I'm thin on [domains]. Continue interviewing?"
    → If YES: loop back to relevant domain(s)
    → If NO: finalize with caveat note
  If no gaps:
    → Finalize
```

### Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **No hardcoded probes** | LLM generates questions per domain from a brief + domain description. Faster iteration, no deploys to add questions. |
| **Column-by-column** | Going deep in one domain before moving on produces richer signal than interleaving. Participant builds context. |
| **6 questions then depth check** | Enough to surface patterns, not so many we bore the participant. Depth check is deterministic (coverage >= `covered`). |
| **Synthesis goals** | The synthesis has explicit acceptance criteria per section. Reflection compares output against criteria. |
| **User-controlled continuation** | Agent identifies gaps, user decides if worth the time. No infinite loops. |

---

## Files to Change

### New Files

| File | Responsibility |
|------|---------------|
| `lib/agents/question/domainGenerator.ts` | `generateDomainQuestions(domain, state, count)` — LLM call that produces N questions for a specific domain |
| `lib/agents/question/domainPrompts.ts` | Prompt builder for domain question generation. One prompt template per domain. |
| `lib/agents/interview/depthEvaluator.ts` | `evaluateDomainDepth(domain, exchanges, knowledgeState)` — deterministic check if a domain is deep enough |
| `lib/agents/synthesis/reflector.ts` | `reflectOnSynthesis(synthesis, goals)` — evaluates synthesis quality, returns gap list |
| `lib/agents/synthesis/synthesisGoals.ts` | Defines what "good enough" means per RCD section |

### Modified Files

| File | Change |
|------|--------|
| `probeLibrarian.ts` | **Delete hardcoded probes.** Keep role variant logic if useful, or delete entirely. Replace with domain-aware question generation. |
| `planner.ts` | **Column-by-column flow.** Track `currentDomain`, `domainQuestionsDelivered`, `domainPhase` (`generating` \| `asking` \| `depth_check` \| `follow_up` \| `complete`). |
| `reducer.ts` | **Per-domain completion tracking.** Add `domainCompletion: Record<Domain, DomainCompletionStatus>`. Update phase selection for column flow. |
| `prompt.ts` | **Domain-aware prompts.** Replace probe injection with domain context + generation instructions. Add soul phase as a "style" not a probe list. |
| `roleContexts.ts` | **Continuation loop.** After synthesis, run reflector. If gaps, return a special `continuation_prompt` to the user instead of finalizing. |
| `types.ts` | Add `DomainCompletionStatus`, `SynthesisReflection`, `ContinuationPrompt`. Update `ConversationPhase` if needed. |

### Deleted Concepts

| Concept | Replacement |
|---------|-------------|
| `SIGNAL_PROBES` array | Domain generation prompts |
| `SOUL_PROBES` array | Soul "style" instructions injected into domain generation |
| `getProbe(n)` | `generateDomainQuestions(domain, state, 6)` |
| `buildProbePlan()` | `buildDomainPlan(domain, state)` |

---

## Domain Prompt Templates

Each domain gets a prompt that tells the LLM what to ask about. Example for `team`:

```
You are generating interview questions about TEAM CULTURE for a role discovery interview.

Role: {role_title} at {company}
Participant: {participant_role} (hiring manager / team member / recruiter)
What we already know about team: {existing_knowledge}

Generate 6 questions that surface:
- How the team actually works day-to-day
- Communication norms and conflict resolution
- Psychological safety signals
- Who thrives vs who struggles
- Hidden values not in the job description

Rules:
- Each question should be answerable with a story or example
- Avoid abstract "what do you think about..." questions
- Questions should build on each other (start broad, get specific)
- Include 1-2 questions that probe for negative signal (what doesn't work)

Return JSON: { "questions": [{"id": "q-1", "text": "...", "intent": "...", "drillingHints": ["..."]}] }
```

The soul "style" is applied by adding a `style` parameter to the generation prompt:
- `style: "technical"` → standard domain questions
- `style: "soul"` → behavior-over-values, trauma/tradeoff probing

---

## Synthesis Goals + Reflection

### Synthesis Goals (per RCD section)

```typescript
const SYNTHESIS_GOALS = {
  team_culture_profile: {
    required: ['conflict_style', 'psychological_safety_signal', 'values_mismatch_risk'],
    min_evidence_quotes: 3,
    min_stakeholder_sources: 2,
  },
  technical_context: {
    required: ['stack', 'constructs', 'seniority_band', 'codebase_expectations'],
    min_evidence_quotes: 2,
  },
  work_profile: {
    required: ['day_to_day', 'autonomy_level', 'collaboration_patterns'],
    min_evidence_quotes: 3,
  },
  // ... etc
};
```

### Reflection Output

```typescript
interface SynthesisReflection {
  overall_quality: 'strong' | 'adequate' | 'thin';
  gaps: Array<{
    section: string;
    missing: string[];
    evidence_count: number;
    recommended_action: 'continue_interview' | 'acceptable_gap';
    target_domain: Domain; // which domain to re-interview
  }>;
  user_prompt?: string; // "I'm thin on team culture and technical context. Continue?"
}
```

---

## State Shape Changes

```typescript
interface InterviewState {
  // Existing
  baseline: RoleContextBaseline;
  participantRole: ParticipantRole;
  questionBudget: number;
  exchanges: Exchange[];
  knowledgeState: KnowledgeState;
  coverage: DomainCoverageMap;
  phase: ConversationPhase;
  questionsAsked: number;

  // NEW: Column tracking
  currentDomain: Domain | null;
  domainCompletion: Record<Domain, DomainCompletionStatus>; // 'pending' | 'generating' | 'asking' | 'depth_check' | 'follow_up' | 'complete'
  domainQuestions: Record<Domain, GeneratedQuestion[]>; // cached generated questions per domain
  domainQuestionsDelivered: Record<Domain, number>; // how many asked so far

  // NEW: Synthesis reflection
  synthesisReflection?: SynthesisReflection;
  continuationApproved?: boolean; // user said yes to continue
}

type DomainCompletionStatus = 
  | 'pending'      // not started
  | 'generating'   // waiting for LLM to produce questions
  | 'asking'       // asking the generated questions
  | 'depth_check'  // evaluating if 6 questions were enough
  | 'follow_up'    // asking 2-3 follow-ups
  | 'complete';    // done with this domain
```

---

## Migration Path

### Phase 1: Foundation (keep tests green)
1. Add new types (`DomainCompletionStatus`, `SynthesisReflection`, etc.)
2. Update `reducer.ts` with per-domain tracking
3. Update `planner.ts` with column-by-column flow
4. All existing tests must still pass (backward compat)

### Phase 2: Domain Generator
1. Create `domainGenerator.ts` + `domainPrompts.ts`
2. Replace probe librarian calls with domain generation
3. Add caching for generated questions (don't regen mid-domain)
4. Tests: verify generated questions are domain-appropriate

### Phase 3: Depth Evaluation
1. Create `depthEvaluator.ts`
2. Wire into reducer: after 6 questions, check depth
3. If shallow, stay in domain for 2-3 follow-ups
4. Tests: verify depth detection works

### Phase 4: Synthesis Reflection
1. Create `synthesisGoals.ts` + `reflector.ts`
2. After synthesis, run reflection
3. If gaps, return `continuation_prompt` to frontend
4. Tests: verify gap detection, verify continuation flow

### Phase 5: Soul Integration
1. Soul becomes a `style` parameter, not a probe list
2. When `enableSoulTrack`, generate soul-style questions for `team` domain
3. Or add `soul` as a pseudo-domain after main domains
4. Tests: verify soul-style questions probe behavior not values

### Phase 6: Cleanup
1. Delete `probeLibrarian.ts` (or keep as deprecated)
2. Delete old probe-based tests
3. Update frontend to show column progress
4. Full test suite green

---

## Acceptance Criteria

- [ ] No hardcoded probe texts in source code
- [ ] Interview proceeds domain-by-domain (column flow)
- [ ] Each domain generates 6 questions dynamically via LLM
- [ ] Depth evaluation runs after 6 questions; follow-ups if shallow
- [ ] Synthesis produces reflection with gap list
- [ ] If gaps exist, user is prompted to continue
- [ ] User can continue → loops back to specific gap domains
- [ ] User can stop → finalizes with caveat note
- [ ] Soul track works via "style" parameter, not hardcoded probes
- [ ] All existing tests pass or are updated
- [ ] Interview quality is ≥ previous probe-based system (eval)
