# Eval-Gated Question Pipeline — Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Build an evaluator that validates every question before it reaches the recruiter. The interviewer agent must attach a stated goal + expected coverage delta to each candidate question. The evaluator checks alignment and returns pass/fail.

**Architecture:**
- Interviewer generates 2 candidate questions, each with `goal`, `expectedCoverage`, `probeAlignment`
- Evaluator scores: goal clarity, goal↔question alignment, coverage realism, probe fidelity, tone
- Approved question → `readyQueue[0]` → presented to recruiter
- Rejected → regenerate (max 2 retries, then send best-effort with warning logged)
- While recruiter answers, async generate next 2 candidates + evaluate

**Tech Stack:** Cloudflare Workers, TypeScript strict, existing LLMProvider abstraction, Qwen3-30b-a3b-fp8 for evaluator (fast, cheap).

---

### Task 1: Define types for goal-attached questions and eval results

**Objective:** Add interfaces to `types.ts` and `roleAgent.ts`.

**Files:**
- Modify: `workers/api/src/types.ts`
- Modify: `workers/api/src/lib/roleAgent.ts`

**Step 1: Add `CandidateQuestion` to types.ts**

```typescript
export interface CandidateQuestion {
  id: string;
  text: string;
  goal: string;
  expectedCoverage: {
    domain: string;
    from: DomainCoverage;
    to: DomainCoverage;
  };
  probeAlignment?: string; // e.g., "probe_1: code_review_disagreement"
  questionType: 'introductory' | 'grand_tour' | 'example' | 'drilling' | 'direct' | 'hypothesis' | 'contrast';
}
```

**Step 2: Add `EvalResult` to types.ts**

```typescript
export interface EvalResult {
  approved: boolean;
  goalAssessment: 'aligned' | 'mismatched' | 'vague';
  coverageAssessment: 'realistic' | 'overstated' | 'understated';
  toneAssessment: 'conversational' | 'interrogative' | 'leading';
  redundancyCheck: 'novel' | 'duplicate' | 'near_duplicate';
  reason: string;
  suggestedRewrite?: string; // only when rejected
}
```

**Step 3: Update `RoleAgentQuestionResponse`**

```typescript
export interface RoleAgentQuestionResponse {
  type: 'question';
  reasoning: string;
  acknowledgment: string;
  question: CandidateQuestion;
  knowledgeStateUpdate: Record<string, Record<string, unknown>>;
  domainCoverage: Record<string, DomainCoverage>;
  toolsUsed: string[];
  /** Evaluator validation result for this question. */
  evalResult?: EvalResult;
}
```

---

### Task 2: Build evaluator prompt

**Objective:** Create the system prompt that scores candidate questions.

**Files:**
- Create: `workers/api/src/lib/roleDiscovery/evaluatorPrompt.ts`

**Step 1: Write `buildEvaluatorSystemPrompt()`**

```typescript
export function buildEvaluatorSystemPrompt(): string {
  return `You are a strict quality gate for a technical recruiting interview agent. Your job is to validate every question before it reaches a human recruiter. Be blunt. False positives (approving bad questions) are worse than false negatives (rejecting good questions).

## Scoring dimensions

### 1. Goal clarity and alignment (most important)
The agent must state a specific, measurable goal for each question. Valid goals name a domain and a coverage level change. Invalid goals are vague ("build rapport", "get to know them").

- **aligned**: The question, if answered well, would achieve the stated goal.
- **mismatched**: The question asks for X but the goal says Y. Example: goal is "surface conflict resolution norms" but question is "What tech stack do you use?"
- **vague**: The goal cannot be verified even in principle. Reject.

### 2. Coverage realism
The agent predicts a coverage delta (e.g., team: sparse → partial). Check if this is realistic.

- **realistic**: A good answer to this question would plausibly reach the target coverage.
- **overstated**: The question is too shallow to reach the claimed coverage. Example: "Do you do code review?" cannot take team from none → deep.
- **understated**: The agent is sandbagging. A rich answer to this question would exceed the claimed coverage.

### 3. Tone
- **conversational**: Under 15 words, open-ended, no jargon, no leading.
- **interrogative**: Feels like a form or checklist. "Describe your development process."
- **leading**: Contains the desired answer. "Your team probably values clean code, right?"

### 4. Redundancy
Compare against conversation history. If a substantially similar question was asked in the last 5 turns, flag as duplicate.

### 5. Probe fidelity (when probeAlignment is present)
Does the question match the calibrated probe it claims to deliver? Example: probe_1 is "code review disagreement" but question is "How do you handle bugs?" → mismatched.

## Response format

Respond with a single JSON object:

\`\`\`
{
  "approved": true | false,
  "goalAssessment": "aligned" | "mismatched" | "vague",
  "coverageAssessment": "realistic" | "overstated" | "understated",
  "toneAssessment": "conversational" | "interrogative" | "leading",
  "redundancyCheck": "novel" | "duplicate" | "near_duplicate",
  "reason": "<one sentence explaining the verdict>",
  "suggestedRewrite": "<only if rejected — a better version of the question, with goal>"
}
\`\`\`

Approve only if ALL of the following are true:
- goalAssessment is "aligned"
- coverageAssessment is "realistic" or "understated"
- toneAssessment is "conversational"
- redundancyCheck is "novel"

Any other combination → reject.`;
}
```

**Step 2: Write `buildEvaluatorUserMessage()`**

```typescript
export function buildEvaluatorUserMessage(
  candidate: CandidateQuestion,
  conversationHistory: RoleExchange[],
  currentCoverage: Record<string, DomainCoverage>,
): string {
  const historyBlock = conversationHistory
    .slice(-5)
    .map(ex => `[${ex.questionId}] Q: ${ex.question}\nA: ${ex.answer ?? '(no answer yet)'}`)
    .join('\n\n');

  return `CANDIDATE QUESTION TO EVALUATE:

ID: ${candidate.id}
Text: "${candidate.text}"
Goal: ${candidate.goal}
Expected coverage: ${candidate.expectedCoverage.domain} from ${candidate.expectedCoverage.from} → ${candidate.expectedCoverage.to}
Probe alignment: ${candidate.probeAlignment ?? 'none'}
Question type: ${candidate.questionType}

CURRENT DOMAIN COVERAGE:
${JSON.stringify(currentCoverage, null, 2)}

RECENT CONVERSATION HISTORY (last 5 exchanges):
${historyBlock}

Evaluate this question now.`;
}
```

---

### Task 3: Implement evaluator function

**Objective:** Call the LLM with evaluator prompt, parse JSON result.

**Files:**
- Modify: `workers/api/src/lib/roleDiscovery/evaluator.ts`

**Step 1: Add `evaluateQuestion` function**

```typescript
import { buildEvaluatorSystemPrompt, buildEvaluatorUserMessage } from './evaluatorPrompt';

export async function evaluateQuestion(
  provider: LLMProvider,
  candidate: CandidateQuestion,
  conversationHistory: RoleExchange[],
  currentCoverage: Record<string, DomainCoverage>,
): Promise<EvalResult> {
  const messages: LLMMessage[] = [
    { role: 'system', content: buildEvaluatorSystemPrompt() },
    { role: 'user', content: buildEvaluatorUserMessage(candidate, conversationHistory, currentCoverage) },
  ];

  try {
    const completion = await provider.complete(messages, { forceJson: true, maxTokens: 512 });
    const content = completion.content?.trim() ?? '';
    const jsonText = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    const parsed = JSON.parse(jsonText) as Record<string, unknown>;

    return {
      approved: parsed.approved === true,
      goalAssessment: parseGoalAssessment(parsed.goalAssessment),
      coverageAssessment: parseCoverageAssessment(parsed.coverageAssessment),
      toneAssessment: parseToneAssessment(parsed.toneAssessment),
      redundancyCheck: parseRedundancyCheck(parsed.redundancyCheck),
      reason: typeof parsed.reason === 'string' ? parsed.reason : 'No reason provided',
      suggestedRewrite: typeof parsed.suggestedRewrite === 'string' ? parsed.suggestedRewrite : undefined,
    };
  } catch (err) {
    console.error('[evaluateQuestion] Evaluator call failed:', err);
    // Fail closed — reject on error
    return {
      approved: false,
      goalAssessment: 'vague',
      coverageAssessment: 'overstated',
      toneAssessment: 'interrogative',
      redundancyCheck: 'duplicate',
      reason: 'Evaluator failed — rejecting for safety',
    };
  }
}
```

**Step 2: Add parser helpers**

```typescript
function parseGoalAssessment(raw: unknown): EvalResult['goalAssessment'] {
  if (raw === 'aligned' || raw === 'mismatched' || raw === 'vague') return raw;
  return 'vague';
}
function parseCoverageAssessment(raw: unknown): EvalResult['coverageAssessment'] {
  if (raw === 'realistic' || raw === 'overstated' || raw === 'understated') return raw;
  return 'overstated';
}
function parseToneAssessment(raw: unknown): EvalResult['toneAssessment'] {
  if (raw === 'conversational' || raw === 'interrogative' || raw === 'leading') return raw;
  return 'interrogative';
}
function parseRedundancyCheck(raw: unknown): EvalResult['redundancyCheck'] {
  if (raw === 'novel' || raw === 'duplicate' || raw === 'near_duplicate') return raw;
  return 'duplicate';
}
```

---

### Task 4: Modify `callRoleAgent` to generate 2 candidates + eval gate

**Objective:** Change the main agent flow to generate candidates in batches of 2, run evaluator, pick approved question.

**Files:**
- Modify: `workers/api/src/lib/roleAgent.ts`

**Step 1: Add `generateCandidates` function**

This calls the LLM twice in parallel (or once with "generate 2 questions" instruction) to produce 2 `CandidateQuestion` objects.

**Step 2: Add `selectApprovedQuestion` function**

```typescript
async function selectApprovedQuestion(
  candidates: CandidateQuestion[],
  provider: LLMProvider,
  exchanges: RoleExchange[],
  domainCoverage: Record<string, DomainCoverage>,
): Promise<{ question: CandidateQuestion; evalResult: EvalResult } | null> {
  for (const candidate of candidates) {
    const evalResult = await evaluateQuestion(provider, candidate, exchanges, domainCoverage);
    if (evalResult.approved) {
      return { question: candidate, evalResult };
    }
    console.log(`[roleAgent] Question ${candidate.id} rejected: ${evalResult.reason}`);
  }
  return null;
}
```

**Step 3: Modify `callRoleAgent` question-turn path**

Replace the single-question generation with:

```typescript
// Generate 2 candidates
const candidates = await generateCandidates(provider, ...);

// Eval gate: pick first approved
const approved = await selectApprovedQuestion(candidates, provider, exchanges, currentCoverage);

if (approved) {
  return {
    type: 'question',
    reasoning: approved.question.goal,
    acknowledgment: ...,
    question: approved.question,
    evalResult: approved.evalResult,
    ...
  };
}

// All rejected — send best-effort with warning
console.warn('[roleAgent] All candidates rejected. Sending best-effort.');
return {
  type: 'question',
  question: candidates[0]!, // or the one with least-bad eval scores
  evalResult: ...,
  ...
};
```

**Step 4: Add async pre-generation for next turn**

While the user is answering the current question, fire a background promise to generate the next 2 candidates. Store in a cache or return as part of the response for the frontend to hold.

Actually — since we're Workers (stateless), the "async pre-generation" happens on the **next** call. The frontend calls `/api/v1/role-contexts/:id/next-question` with the answer, and the backend:
1. Receives answer
2. **Immediately returns the pre-evaluated question** that was generated during the previous call
3. **In the background** (or in the same response payload) generates the next 2 candidates

This requires the backend to cache the "next question ready" in D1 or KV. Simpler: the response includes `nextQuestion` pre-generated, and the frontend sends it back as `preloadedQuestion` on the next call.

For now, skip the true async — just generate 2, eval, pick 1, return it. The async preload is an optimization for later.

---

### Task 5: Update prompt to generate goal-attached questions

**Objective:** The interviewer system prompt must now instruct the LLM to emit `goal`, `expectedCoverage`, `probeAlignment` on every question.

**Files:**
- Modify: `workers/api/src/lib/roleAgentPromptsV2.ts` (or V1 if still active)

**Step 1: Update response format in CORE_PROMPT**

```json
{
  "reasoning": "...",
  "acknowledgment": "...",
  "candidates": [
    {
      "id": "q-3a",
      "text": "...",
      "goal": "Surface team conflict resolution norms by asking for a concrete story",
      "expectedCoverage": { "domain": "team", "from": "sparse", "to": "partial" },
      "probeAlignment": "probe_1: code_review_disagreement",
      "questionType": "example"
    }
  ]
}
```

The agent generates 2 candidates in the `candidates` array. The evaluator picks one.

---

### Task 6: Type check and verify

**Step 1: Run type check**

```bash
cd /Users/hans/Code/PIPE/PIPE-OS/workers/api && npx tsc --noEmit
```

**Expected:** Only pre-existing errors (QUALIFY_CLOSE, Workers globals).

**Step 2: Verify exports**

- `CandidateQuestion` exported from types
- `EvalResult` exported from types
- `evaluateQuestion` exported from evaluator.ts
- `buildEvaluatorSystemPrompt` and `buildEvaluatorUserMessage` exported from evaluatorPrompt.ts

---

### Task 7: Update CHANGELOG

Add under `[Unreleased]`:
```markdown
- Eval-gated question pipeline: every question is validated by an evaluator agent before reaching the recruiter. Questions must attach a stated goal + expected coverage delta. Evaluator checks goal alignment, coverage realism, tone, redundancy, and probe fidelity.
```

---

## Verification Checklist

- [ ] `npx tsc --noEmit` passes (new code only, pre-existing errors acceptable)
- [ ] Interviewer generates 2 candidates per turn
- [ ] Each candidate has `goal`, `expectedCoverage`, `probeAlignment`
- [ ] Evaluator scores all 5 dimensions
- [ ] Approved question returned to user; rejected questions logged
- [ ] If all rejected, best-effort sent with warning
- [ ] `RoleAgentQuestionResponse.evalResult` present
- [ ] CHANGELOG updated
