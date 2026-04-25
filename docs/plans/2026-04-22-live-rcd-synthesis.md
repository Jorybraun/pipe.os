# Live RCD Synthesis Wiring — Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Wire the live Role Discovery synthesis path to emit full Role Context Document (RCD) instead of flat persona + JD, with backward-compatible fallback.

**Architecture:** On budget exhaustion, callRoleAgent will first attempt RCD synthesis using the existing `buildRcdSynthesisSystemPrompt()` and `buildRcdSynthesisUserMessage()` from `roleAgentPrompts.ts`. If RCD parsing fails, fall back to the existing flat `CandidatePersona` + `jobDescription` path. The RCD is added as an optional field on `RoleAgentSynthesisResponse`.

**Tech Stack:** Cloudflare Workers, TypeScript strict, Hono router, existing LLMProvider abstraction.

---

### Task 1: Add RCD imports and type extension

**Objective:** Import RCD synthesis builders and RoleContextDocument type; add optional `rcd` field to `RoleAgentSynthesisResponse`.

**Files:**
- Modify: `workers/api/src/lib/roleAgent.ts:16-84`

**Step 1: Add imports**

```typescript
import {
  buildRoleAgentSystemPrompt,
  buildRoleAgentUserMessage,
  buildSynthesisPrompt,
  selectPhasePrompt,
  buildRcdSynthesisSystemPrompt,
  buildRcdSynthesisUserMessage,
} from './roleAgentPrompts';
```

**Step 2: Add RoleContextDocument to type imports**

```typescript
import type {
  RoleExchange,
  DomainCoverage,
  CandidatePersona,
  GeneratedJobDescription,
  PhaseDirective,
  ConversationContext,
  RecruitmentBrief,
  RoleContextDocument,
} from '../types';
```

**Step 3: Add optional `rcd` field to `RoleAgentSynthesisResponse`**

```typescript
export interface RoleAgentSynthesisResponse {
  type: 'synthesis';
  reasoning: string;
  persona: CandidatePersona;
  jobDescription: string;
  synthesis: string;
  recruitmentBrief?: RecruitmentBrief;
  /** Full Role Context Document — present when RCD synthesis succeeds. */
  rcd?: RoleContextDocument;
  knowledgeStateUpdate: Record<string, Record<string, unknown>>;
  domainCoverage: Record<string, DomainCoverage>;
  toolsUsed: string[];
}
```

---

### Task 2: Add `parseRcdResponse` function

**Objective:** Parse the RCD JSON from the LLM response with defensive validation.

**Files:**
- Modify: `workers/api/src/lib/roleAgent.ts` (after `parseSynthesisResponse`, around line 486)

**Step 1: Write `parseRcdResponse`**

```typescript
function parseRcdResponse(raw: unknown): RoleContextDocument | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  // Minimal validation: must have the core RCD fields
  const hasVersion = typeof r.rcd_version === 'string';
  const hasRoleContextId = typeof r.role_context_id === 'string';
  const hasDomainMatrix = r.domain_matrix && typeof r.domain_matrix === 'object';
  const hasTechnicalContext = r.technical_context && typeof r.technical_context === 'object';
  const hasTeamCultureProfile = r.team_culture_profile && typeof r.team_culture_profile === 'object';

  if (!hasVersion || !hasRoleContextId || !hasDomainMatrix || !hasTechnicalContext || !hasTeamCultureProfile) {
    console.warn('[roleAgent] RCD parsing failed — missing required fields');
    return null;
  }

  // Trust the LLM to emit well-formed JSON per the prompt schema.
  // The verifier pass (verifyRcd.ts) runs separately for full validation.
  return r as RoleContextDocument;
}
```

---

### Task 3: Build RCD synthesis messages on budget exhaustion

**Objective:** When budget is exhausted, construct RCD synthesis prompt + user message instead of flat synthesis prompt.

**Files:**
- Modify: `workers/api/src/lib/roleAgent.ts:520-522`

**Step 1: Read current synthesis message building**

Current code (line 520-522):
```typescript
const userMessage = budgetExhausted
  ? buildSynthesisPrompt({ baseline, exchanges, knowledgeState })
  : buildRoleAgentUserMessage({ baseline, exchanges, knowledgeState, questionsAsked, questionBudget, ...(domainCoverage ? { domainCoverage } : {}) });
```

**Step 2: Replace with conditional RCD vs flat synthesis**

```typescript
// RCD synthesis requires roleContextId and pipelineId from baseline
const roleContextId = typeof baseline.roleContextId === 'string' ? baseline.roleContextId : 'rcd-live';
const pipelineId = typeof baseline.pipelineId === 'string' ? baseline.pipelineId : 'pipeline-live';

const useRcdSynthesis = budgetExhausted && !!baseline.roleContextId;

let systemPrompt: string;
let userMessage: string;

if (!budgetExhausted && phaseDirective) {
  systemPrompt = selectPhasePrompt(phaseDirective.phase, participantRole);
} else if (useRcdSynthesis) {
  systemPrompt = buildRcdSynthesisSystemPrompt();
  userMessage = buildRcdSynthesisUserMessage({
    roleContextId,
    pipelineId,
    baseline,
    stakeholderTranscripts: [{
      stakeholder_type: (participantRole as StakeholderType) ?? 'HIRING_MANAGER',
      interviewee_label: typeof baseline.intervieweeName === 'string' ? baseline.intervieweeName : 'Primary stakeholder',
      exchanges,
      knowledge_state: knowledgeState,
    }],
    synthesisModel: provider?.name ?? 'unknown',
    verificationPassModel: 'qwen3-30b-a3b-fp8',
  });
} else {
  systemPrompt = buildRoleAgentSystemPrompt(participantRole);
  userMessage = budgetExhausted
    ? buildSynthesisPrompt({ baseline, exchanges, knowledgeState })
    : buildRoleAgentUserMessage({ baseline, exchanges, knowledgeState, questionsAsked, questionBudget, ...(domainCoverage ? { domainCoverage } : {}) });
}
```

**Step 3: Add StakeholderType to imports**

```typescript
import type {
  RoleExchange,
  DomainCoverage,
  CandidatePersona,
  GeneratedJobDescription,
  PhaseDirective,
  ConversationContext,
  RecruitmentBrief,
  RoleContextDocument,
  StakeholderType,
} from '../types';
```

---

### Task 4: Parse RCD response with fallback to flat synthesis

**Objective:** After the LLM returns content on budget exhaustion, try to parse as RCD first. If RCD parsing fails, fall back to existing flat `parseSynthesisResponse`.

**Files:**
- Modify: `workers/api/src/lib/roleAgent.ts:565-567`

**Step 1: Replace the existing synthesis detection logic**

Current code:
```typescript
if (budgetExhausted || typeof parsed.synthesis === 'string') {
  return parseSynthesisResponse(parsed, toolsUsed);
}
```

**Step 2: New logic — try RCD first, then fallback**

```typescript
if (budgetExhausted || typeof parsed.synthesis === 'string') {
  // Try RCD synthesis first
  const rcd = parseRcdResponse(parsed);
  if (rcd) {
    console.log('[roleAgent] RCD synthesis succeeded');
    // Derive flat persona from RCD consumer_slice for backward compatibility
    const consumerSlice = rcd.consumer_slice;
    const flatPersona: CandidatePersona = {
      seniority: consumerSlice.seniority ?? 'Not specified',
      archetype: consumerSlice.archetype ?? 'Not specified',
      mustHaveSkills: consumerSlice.mustHaveSkills ?? [],
      niceToHaveSkills: consumerSlice.niceToHaveSkills ?? [],
      disposition: consumerSlice.disposition ?? [],
      careerSignal: consumerSlice.careerSignal ?? 'Not specified',
      redFlags: consumerSlice.redFlags ?? [],
      dealbreakers: consumerSlice.dealbreakers ?? [],
    };
    // Derive JD from RCD technical_context + team_culture_profile
    const jdParts: string[] = [];
    jdParts.push(`# ${baseline.title ?? 'Role'}`);
    jdParts.push('');
    jdParts.push(`## The Role`);
    jdParts.push(rcd.technical_context.stack?.length
      ? `Building with ${rcd.technical_context.stack.join(', ')}.`
      : 'Technical details to be determined.');
    jdParts.push('');
    if (rcd.technical_context.codebase_expectations?.length) {
      jdParts.push(`## What You'll Own`);
      for (const exp of rcd.technical_context.codebase_expectations) {
        jdParts.push(`- ${exp}`);
      }
      jdParts.push('');
    }
    const jobDescription = jdParts.join('\n');

    return {
      type: 'synthesis',
      reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : 'RCD synthesis produced.',
      persona: flatPersona,
      jobDescription,
      synthesis: flatPersona.archetype,
      rcd,
      knowledgeStateUpdate: parseKnowledgeStateUpdate(parsed.knowledgeStateUpdate),
      domainCoverage: parseDomainCoverage(parsed.domainCoverage),
      toolsUsed,
    };
  }

  // Fallback: flat persona + JD synthesis
  console.log('[roleAgent] RCD parsing failed, falling back to flat synthesis');
  return parseSynthesisResponse(parsed, toolsUsed);
}
```

---

### Task 5: Update streaming variant with same RCD logic

**Objective:** The `callRoleAgentStream` function must use the same RCD synthesis path on budget exhaustion.

**Files:**
- Modify: `workers/api/src/lib/roleAgent.ts:598-604`

**Step 1: Read current streaming synthesis message building**

Current code:
```typescript
const userMessage = budgetExhausted
  ? buildSynthesisPrompt({ baseline, exchanges, knowledgeState })
  : buildRoleAgentUserMessage({ baseline, exchanges, knowledgeState, questionsAsked, questionBudget, ...(domainCoverage ? { domainCoverage } : {}) });
```

**Step 2: Replace with same conditional as non-streaming**

```typescript
const roleContextId = typeof baseline.roleContextId === 'string' ? baseline.roleContextId : 'rcd-live';
const pipelineId = typeof baseline.pipelineId === 'string' ? baseline.pipelineId : 'pipeline-live';
const useRcdSynthesisStream = budgetExhausted && !!baseline.roleContextId;

let systemPrompt: string;
let userMessage: string;

if (!budgetExhausted && phaseDirective) {
  systemPrompt = selectPhasePrompt(phaseDirective.phase, participantRole);
} else if (useRcdSynthesisStream) {
  systemPrompt = buildRcdSynthesisSystemPrompt();
  userMessage = buildRcdSynthesisUserMessage({
    roleContextId,
    pipelineId,
    baseline,
    stakeholderTranscripts: [{
      stakeholder_type: (participantRole as StakeholderType) ?? 'HIRING_MANAGER',
      interviewee_label: typeof baseline.intervieweeName === 'string' ? baseline.intervieweeName : 'Primary stakeholder',
      exchanges,
      knowledge_state: knowledgeState,
    }],
    synthesisModel: provider?.name ?? 'unknown',
    verificationPassModel: 'qwen3-30b-a3b-fp8',
  });
} else {
  systemPrompt = buildRoleAgentSystemPrompt(participantRole);
  userMessage = budgetExhausted
    ? buildSynthesisPrompt({ baseline, exchanges, knowledgeState })
    : buildRoleAgentUserMessage({ baseline, exchanges, knowledgeState, questionsAsked, questionBudget, ...(domainCoverage ? { domainCoverage } : {}) });
}
```

**Step 3: Update streaming parse logic**

Current code (line 638-640):
```typescript
const result = budgetExhausted || typeof parsed.synthesis === 'string'
  ? parseSynthesisResponse(parsed, [])
  : parseQuestionResponse(parsed, questionsAsked, []);
```

Replace with same RCD-first logic as non-streaming (extract to shared function if possible, or duplicate for now):
```typescript
let result: RoleAgentResponse;
if (budgetExhausted || typeof parsed.synthesis === 'string') {
  const rcd = parseRcdResponse(parsed);
  if (rcd) {
    const consumerSlice = rcd.consumer_slice;
    const flatPersona: CandidatePersona = {
      seniority: consumerSlice.seniority ?? 'Not specified',
      archetype: consumerSlice.archetype ?? 'Not specified',
      mustHaveSkills: consumerSlice.mustHaveSkills ?? [],
      niceToHaveSkills: consumerSlice.niceToHaveSkills ?? [],
      disposition: consumerSlice.disposition ?? [],
      careerSignal: consumerSlice.careerSignal ?? 'Not specified',
      redFlags: consumerSlice.redFlags ?? [],
      dealbreakers: consumerSlice.dealbreakers ?? [],
    };
    const jdParts: string[] = [];
    jdParts.push(`# ${baseline.title ?? 'Role'}`);
    jdParts.push('');
    jdParts.push(`## The Role`);
    jdParts.push(rcd.technical_context.stack?.length
      ? `Building with ${rcd.technical_context.stack.join(', ')}.`
      : 'Technical details to be determined.');
    jdParts.push('');
    if (rcd.technical_context.codebase_expectations?.length) {
      jdParts.push(`## What You'll Own`);
      for (const exp of rcd.technical_context.codebase_expectations) {
        jdParts.push(`- ${exp}`);
      }
      jdParts.push('');
    }
    result = {
      type: 'synthesis',
      reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : 'RCD synthesis produced.',
      persona: flatPersona,
      jobDescription: jdParts.join('\n'),
      synthesis: flatPersona.archetype,
      rcd,
      knowledgeStateUpdate: parseKnowledgeStateUpdate(parsed.knowledgeStateUpdate),
      domainCoverage: parseDomainCoverage(parsed.domainCoverage),
      toolsUsed: [],
    };
  } else {
    result = parseSynthesisResponse(parsed, []);
  }
} else {
  result = parseQuestionResponse(parsed, questionsAsked, []);
}
```

---

### Task 6: Type check and verify

**Objective:** Ensure TypeScript compiles cleanly.

**Files:**
- Verify: `workers/api/src/lib/roleAgent.ts`

**Step 1: Run type check**

```bash
cd /Users/hans/Code/PIPE/PIPE-OS/workers/api && npx tsc --noEmit
```

**Expected:** No errors. If errors, fix them.

**Step 2: Verify exports**

Ensure `RoleAgentSynthesisResponse` still exports correctly and `rcd` field is accessible to callers.

---

### Task 7: Update CHANGELOG

**Objective:** Document the change.

**Files:**
- Modify: `/Users/hans/Code/PIPE/PIPE-OS/CHANGELOG.md`

Add under `[Unreleased]`:
```markdown
- Role Discovery live synthesis now emits full Role Context Document (RCD) when `roleContextId` is present in baseline, with backward-compatible fallback to flat persona + JD
```

---

## Verification Checklist

- [ ] `npx tsc --noEmit` passes
- [ ] `RoleAgentSynthesisResponse.rcd` is optional `RoleContextDocument`
- [ ] Budget exhausted + `baseline.roleContextId` present → RCD synthesis attempted
- [ ] RCD parse succeeds → response includes `rcd` field
- [ ] RCD parse fails → falls back to flat `persona` + `jobDescription`
- [ ] Streaming path mirrors non-streaming path
- [ ] CHANGELOG updated
