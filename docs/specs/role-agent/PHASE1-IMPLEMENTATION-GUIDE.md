# Phase 1 Implementation Guide — Quick Start

**For:** Claude Code  
**Context:** AWS Amplify, Lambda, TypeScript, React

---

## TL;DR

Build a multi-agent system for role discovery:
1. **Question Agent Lambda** — generates contextual questions with internal quality loop
2. **Job Description Lambda** — produces JD + filters + stages from gathered context
3. **Client state** — holds all context, passes to lambdas, persists only at end

---

## File Structure

```
amplify/
├── backend.ts                  # Backend definition (update to include functions)
├── data/
│   └── resource.ts             # Data schema (add RoleContext model)
├── auth/
│   └── resource.ts             # Cognito auth (already configured)
└── functions/
    ├── questionAgent/
    │   ├── resource.ts         # Function definition (already exists)
    │   ├── handler.ts          # Main lambda (TO BE CREATED)
    │   ├── costTracker.ts      # Cost tracking middleware (TO BE CREATED)
    │   ├── validation.ts       # Input validation with Zod (TO BE CREATED)
    │   ├── extractor.ts        # Extract facts from responses (TO BE CREATED)
    │   ├── assessor.ts         # Evaluate readiness (TO BE CREATED)
    │   ├── generator.ts        # Generate questions (TO BE CREATED)
    │   ├── reviewer.ts         # Quality check loop (TO BE CREATED)
    │   ├── prompts.ts          # All prompt templates (TO BE CREATED)
    │   ├── types.ts            # Shared types (TO BE CREATED)
    │   └── package.json        # Dependencies (TO BE CREATED)
    │
    └── jobDescriptionAgent/
        ├── resource.ts         # Function definition (already exists)
        ├── handler.ts          # Main lambda (TO BE CREATED)
        ├── generator.ts        # Generate JD (TO BE CREATED)
        ├── prompts.ts          # Prompt templates (TO BE CREATED)
        ├── types.ts            # Shared types (TO BE CREATED)
        └── package.json        # Dependencies (TO BE CREATED)

src/
├── pages/
│   └── RoleDiscoveryPage.tsx   # Main page (already exists - will be updated)
├── hooks/
│   └── useRoleDiscovery.ts     # Client state management (TO BE CREATED)
├── types/
│   └── roleDiscovery.ts        # Type definitions (already exists - will be extended)
└── components/
    ├── RoleDiscovery/
    │   ├── BaselineForm.tsx    # Part 1 form (already exists)
    │   ├── DynamicSection.tsx  # Part 2 dynamic form (TO BE CREATED)
    │   └── AgentPanel.tsx      # Agent panel (already exists - will be updated)
    └── ui/
        ├── FormSection.tsx     # Collapsible section (already exists)
        └── form/
            ├── FieldGroup.tsx      # Form field container (already exists)
            ├── TextInput.tsx       # Text input (already exists)
            ├── TextareaInput.tsx   # Textarea (already exists)
            ├── TagsInput.tsx       # Tags input (already exists)
            ├── SelectInput.tsx     # Select dropdown (already exists)
            └── RadioGroup.tsx      # Radio buttons (already exists)
```

**Legend:**
- `(already exists)` - File exists in codebase, may need updates
- `(TO BE CREATED)` - New file to be implemented
- `(will be updated)` - Existing file needs modification for backend integration

**⚠️ IMPORTANT: AWS MCP Server Usage**

For ALL AWS Amplify operations (deployment, secrets management, configuration, troubleshooting), use the **AWS MCP server** rather than running commands manually. This includes:

- Setting secrets: Use MCP server instead of `npx ampx sandbox secret set`
- Deploying: Use MCP server instead of `npx ampx sandbox`
- Checking status: Use MCP server for resource information
- Debugging: Use MCP server to inspect Amplify resources and logs

The AWS MCP server provides better error handling, context awareness, and integration with the development workflow.

---

## Core Types (copy to src/types/discovery.ts)

```typescript
// Baseline - fixed schema
export interface Baseline {
  title: string;
  level: 'junior' | 'mid' | 'senior' | 'staff' | 'principal' | 'lead' | 'manager';
  department: string;
  workModel: 'remote' | 'hybrid' | 'onsite';
  teamSize: string;
  reportsTo: string;
  stack: string[];
}

// Dynamic context - keys emerge from conversation
export type DynamicContext = Record<string, string | string[]>;

// Conversation record
export interface Exchange {
  id: string;
  questionId: string;
  agentQuestion: string;
  userResponse: string;
  extractedFacts: string[];
  timestamp: number;
}

// Full state object
export interface RoleContext {
  id: string;
  baseline: Baseline | null;
  exchanges: Exchange[];
  context: DynamicContext;
  status: 'baseline' | 'exploring' | 'almost_ready' | 'ready';
  gaps: string[];
  createdAt: number;
  updatedAt: number;
}

// Question definition
export interface Question {
  id: string;
  text: string;
  type: 'text' | 'textarea' | 'tags' | 'select' | 'radio';
  options?: string[];
  placeholder?: string;
  helpText?: string;
  targetContext?: string;
}

// Form section (group of questions)
export interface FormSection {
  id: string;
  title: string;
  description?: string;
  questions: Question[];
}

// Lambda request/response
export interface QuestionAgentRequest {
  roleContext: RoleContext;
  responses?: Array<{ questionId: string; response: string | string[] }>;
}

export interface QuestionAgentResponse {
  updatedContext: DynamicContext;
  newExchanges: Exchange[];
  nextSection: FormSection | null;
  status: RoleContext['status'];
  gaps: string[];
  reasoning: string;
}
```

---

## Question Agent Lambda — Skeleton

```typescript
// amplify/functions/questionAgent/handler.ts

import { Anthropic } from '@anthropic-ai/sdk';
import { QuestionAgentRequest, QuestionAgentResponse } from './types';
import { extract } from './extractor';
import { assess } from './assessor';
import { generateWithQualityLoop } from './generator';

const anthropic = new Anthropic();

export async function handler(event: { body: QuestionAgentRequest }): Promise<QuestionAgentResponse> {
  const { roleContext, responses } = event.body;
  const startTime = Date.now();
  
  // 1. EXTRACT — process user responses
  let updatedContext = { ...roleContext.context };
  let newExchanges: Exchange[] = [];
  
  if (responses?.length) {
    const extraction = await extract(anthropic, roleContext, responses);
    updatedContext = { ...updatedContext, ...extraction.contextUpdates };
    newExchanges = extraction.exchanges;
  }
  
  // 2. ASSESS — check if we have enough context
  const assessment = await assess(anthropic, roleContext.baseline!, updatedContext, roleContext.exchanges);
  
  // 3. GENERATE — create next questions if not ready
  let nextSection: FormSection | null = null;
  let reasoning = assessment.reasoning;
  
  if (assessment.status !== 'ready') {
    const generation = await generateWithQualityLoop(
      anthropic,
      roleContext.baseline!,
      updatedContext,
      assessment.gaps,
      [...roleContext.exchanges, ...newExchanges]
    );
    nextSection = generation.section;
    reasoning = generation.reasoning;
  }
  
  return {
    updatedContext,
    newExchanges,
    nextSection,
    status: assessment.status,
    gaps: assessment.gaps,
    reasoning
  };
}
```

---

## Generator with Quality Loop

```typescript
// amplify/functions/questionAgent/generator.ts

const MAX_REVIEW_ITERATIONS = 3;

export async function generateWithQualityLoop(
  anthropic: Anthropic,
  baseline: Baseline,
  context: DynamicContext,
  gaps: string[],
  exchanges: Exchange[]
): Promise<{ section: FormSection; reasoning: string }> {
  
  let draft = await generateQuestions(anthropic, baseline, context, gaps, exchanges);
  let iterations = 0;
  
  while (iterations < MAX_REVIEW_ITERATIONS) {
    const review = await reviewQuestions(anthropic, draft, baseline, context, exchanges);
    
    if (review.approved) {
      return draft;
    }
    
    // Revise based on feedback
    draft = await generateQuestions(
      anthropic, 
      baseline, 
      context, 
      gaps, 
      exchanges,
      review.feedback  // Pass feedback for revision
    );
    
    iterations++;
  }
  
  // Return best effort after max iterations
  return draft;
}

async function generateQuestions(
  anthropic: Anthropic,
  baseline: Baseline,
  context: DynamicContext,
  gaps: string[],
  exchanges: Exchange[],
  revisionFeedback?: string
): Promise<{ section: FormSection; reasoning: string }> {
  
  const prompt = buildGeneratorPrompt(baseline, context, gaps, exchanges, revisionFeedback);
  
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }]
  });
  
  // Parse and return structured response
  return parseGeneratorResponse(response);
}

async function reviewQuestions(
  anthropic: Anthropic,
  draft: { section: FormSection; reasoning: string },
  baseline: Baseline,
  context: DynamicContext,
  exchanges: Exchange[]
): Promise<{ approved: boolean; feedback: string }> {
  
  const prompt = buildReviewerPrompt(draft.section, baseline, context, exchanges);
  
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 512,
    messages: [{ role: 'user', content: prompt }]
  });
  
  return parseReviewerResponse(response);
}
```

---

## Prompt Templates

```typescript
// amplify/functions/questionAgent/prompts.ts

export function buildExtractorPrompt(
  question: string,
  response: string,
  currentContext: DynamicContext
): string {
  return `You are extracting information from a role discovery conversation.

QUESTION ASKED:
${question}

USER RESPONSE:
${response}

CURRENT CONTEXT:
${JSON.stringify(currentContext, null, 2)}

Extract:
1. Concrete facts and entities
2. Implicit signals (what does this suggest?)
3. Context key categorization

Respond in JSON:
{
  "extractedFacts": ["fact1", "fact2"],
  "contextUpdates": { "key": "value" },
  "implicitSignals": [{ "signal": "...", "evidence": "..." }]
}`;
}

export function buildAssessorPrompt(
  baseline: Baseline,
  context: DynamicContext,
  exchanges: Exchange[]
): string {
  return `You assess if we have enough context to design interviews for this role.

BASELINE:
${JSON.stringify(baseline, null, 2)}

ACCUMULATED CONTEXT:
${JSON.stringify(context, null, 2)}

CONVERSATION HISTORY:
${exchanges.map(e => `Q: ${e.agentQuestion}\nA: ${e.userResponse}`).join('\n\n')}

Evaluate these dimensions (0-1 confidence):
1. Role clarity - what they'll actually do
2. Success definition - what "good" looks like
3. Challenges - hard parts of the role
4. Team dynamics - how they'll collaborate
5. Culture signals - what behaviors fit/don't fit
6. Technical depth - can we generate relevant technical questions

Respond in JSON:
{
  "status": "exploring" | "almost_ready" | "ready",
  "gaps": ["gap1", "gap2"],
  "confidence": { "role_clarity": 0.8, ... },
  "reasoning": "Summary of assessment"
}`;
}

export function buildGeneratorPrompt(
  baseline: Baseline,
  context: DynamicContext,
  gaps: string[],
  exchanges: Exchange[],
  revisionFeedback?: string
): string {
  let prompt = `Generate 1-3 targeted questions to fill gaps in role understanding.

BASELINE:
${JSON.stringify(baseline, null, 2)}

CONTEXT:
${JSON.stringify(context, null, 2)}

GAPS TO FILL:
${gaps.join(', ')}

PREVIOUS QUESTIONS (don't repeat):
${exchanges.map(e => e.agentQuestion).join('\n')}

RULES:
- Reference specific context (not generic questions)
- One clear question per item
- Choose appropriate input type
- Explain why you're asking in section description
- Use first person ("I want to understand...")`;

  if (revisionFeedback) {
    prompt += `\n\nREVISION FEEDBACK:\n${revisionFeedback}`;
  }

  prompt += `\n\nRespond in JSON:
{
  "section": {
    "title": "SECTION_NAME",
    "description": "Why I'm asking these questions...",
    "questions": [
      {
        "id": "uuid",
        "text": "Question text",
        "type": "text|textarea|tags|select|radio",
        "placeholder": "...",
        "helpText": "..."
      }
    ]
  },
  "reasoning": "Why these questions fill the gaps"
}`;

  return prompt;
}

export function buildReviewerPrompt(
  section: FormSection,
  baseline: Baseline,
  context: DynamicContext,
  exchanges: Exchange[]
): string {
  return `Review these questions for quality.

QUESTIONS TO REVIEW:
${JSON.stringify(section, null, 2)}

BASELINE:
${JSON.stringify(baseline, null, 2)}

CONTEXT:
${JSON.stringify(context, null, 2)}

PREVIOUS QUESTIONS:
${exchanges.map(e => e.agentQuestion).join('\n')}

CRITERIA:
1. SPECIFIC - References known context? (not generic)
2. NON-REDUNDANT - Already asked something similar?
3. CLEAR - Single focused question? (not compound)
4. APPROPRIATE - Right input type?
5. VALUABLE - Will meaningfully fill a gap?

Respond in JSON:
{
  "approved": true|false,
  "issues": [{ "questionId": "...", "issue": "...", "suggestion": "..." }],
  "feedback": "Overall feedback for revision"
}`;
}
```

---

## Client Hook

```typescript
// src/hooks/useRoleDiscovery.ts

import { useState, useCallback } from 'react';
import { RoleContext, Baseline, FormSection, QuestionAgentResponse } from '@/types/discovery';
import { v4 as uuid } from 'uuid';

const initialContext: RoleContext = {
  id: uuid(),
  baseline: null,
  exchanges: [],
  context: {},
  status: 'baseline',
  gaps: [],
  createdAt: Date.now(),
  updatedAt: Date.now()
};

export function useRoleDiscovery() {
  const [roleContext, setRoleContext] = useState<RoleContext>(initialContext);
  const [currentSection, setCurrentSection] = useState<FormSection | null>(null);
  const [reasoning, setReasoning] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);

  const submitBaseline = useCallback(async (baseline: Baseline) => {
    setIsLoading(true);
    
    const updatedContext: RoleContext = {
      ...roleContext,
      baseline,
      status: 'exploring',
      updatedAt: Date.now()
    };
    
    try {
      const response = await fetch('/api/discovery/questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roleContext: updatedContext })
      });
      
      const data: QuestionAgentResponse = await response.json();
      
      setRoleContext(prev => ({
        ...prev,
        baseline,
        context: data.updatedContext,
        status: data.status,
        gaps: data.gaps,
        updatedAt: Date.now()
      }));
      setCurrentSection(data.nextSection);
      setReasoning(data.reasoning);
      
    } finally {
      setIsLoading(false);
    }
  }, [roleContext]);

  const submitResponses = useCallback(async (
    responses: Array<{ questionId: string; response: string | string[] }>
  ) => {
    setIsLoading(true);
    
    try {
      const response = await fetch('/api/discovery/questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roleContext, responses })
      });
      
      const data: QuestionAgentResponse = await response.json();
      
      setRoleContext(prev => ({
        ...prev,
        exchanges: [...prev.exchanges, ...data.newExchanges],
        context: data.updatedContext,
        status: data.status,
        gaps: data.gaps,
        updatedAt: Date.now()
      }));
      setCurrentSection(data.nextSection);
      setReasoning(data.reasoning);
      
    } finally {
      setIsLoading(false);
    }
  }, [roleContext]);

  const generateJobDescription = useCallback(async () => {
    if (roleContext.status !== 'ready') {
      throw new Error('Not ready to generate job description');
    }
    
    setIsLoading(true);
    
    try {
      const response = await fetch('/api/discovery/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roleContext })
      });
      
      return await response.json();
      
    } finally {
      setIsLoading(false);
    }
  }, [roleContext]);

  return {
    roleContext,
    currentSection,
    reasoning,
    isLoading,
    isReady: roleContext.status === 'ready',
    submitBaseline,
    submitResponses,
    generateJobDescription
  };
}
```

---

## Key Implementation Notes

1. **Use Claude claude-sonnet-4-20250514** for all prompts (good balance of speed/quality)

2. **JSON mode** — add `response_format: { type: "json_object" }` to ensure parseable responses

3. **Error handling** — wrap all Anthropic calls in try/catch, return graceful fallbacks

4. **Quality loop max 3 iterations** — prevent infinite loops, return best effort

5. **Context accumulation** — always spread existing context, don't replace entirely

6. **UUID generation** — use `uuid` package for all IDs

7. **Timestamps** — use `Date.now()` for all timestamps

---

## Testing Checklist

- [ ] Baseline submission triggers first questions
- [ ] Questions reference baseline context specifically
- [ ] Responses are extracted and merged into context
- [ ] No duplicate questions across rounds
- [ ] Status progresses: exploring → almost_ready → ready
- [ ] Gaps array shrinks as context builds
- [ ] Quality loop rejects generic questions
- [ ] Job description reflects actual conversation
