# ADR-027: Role Discovery Agent — AI-Powered Role Context Extraction

**Date:** 2026-04-05
**Status:** Proposed
**Deciders:** Hans (founder)

---

## Context

When recruiters create interview pipelines today, they fill in title, seniority level, tech stack, and pick a preset. The result is a generic pipeline that knows nothing about the team's actual codebase, what success looks like in the first 90 days, why the role is open, or what kind of person would fail there. Every "Senior Frontend Engineer" pipeline looks the same regardless of whether the team is building a HIPAA-compliant messaging platform or a consumer social app.

The platform needs a mechanism to extract **deep role context** — the kind of information a senior technical recruiter captures in an intake meeting — and use it to generate tailored interview content downstream.

### Predecessor

A Role Discovery system was built during the AWS Amplify era:
- **UI**: `ConversationalForm` (6-phase wizard), `AgentPanel` (chat sidebar), `PhaseProgress` indicator
- **Types**: `src/types/discovery.ts` — `RoleContext`, `Baseline`, `Exchange`, `DynamicContext`, `FormSection`, `Question`
- **Hook**: `src/hooks/useRoleDiscovery.ts` — `submitBaseline`, `submitResponses`, `generateJobDescription`
- **Backend**: Lambda `questionAgent` + `jobDescriptionAgent` (never deployed, mock responses only)

The UI shell and type definitions serve as **reference only**. The backend never shipped. The system must be rebuilt for the Cloudflare Worker + D1 architecture.

### Design Philosophy

Two research documents define the interviewing principles this agent must embody:

- **`migration/role-agent.md`** — System design: Six Domains framework, ReAct reasoning loop, Knowledge State output schema, adaptive recruiter-vs-hiring-manager detection
- **`migration/dersign-thinking.md`** — Interviewing methodology: IDEO empathy interviews, Five Whys adapted as contextual drilling, Laddering (Means-End Chain Theory), Beginner's Mind, seven question types, negative space rules

These documents are the philosophical foundation. This ADR is the technical architecture.

---

## Decision

Build a **server-side Role Agent** as a Hono route module that manages a turn-based AI interview via Mistral API. The agent uses a fixed question budget, hybrid UI responses (natural language acknowledgment + typed form inputs), and produces a Knowledge State JSON stored in D1. Free tier gets the baseline form only; Pro tier unlocks the AI interview.

### 1. Server-Side Mistral, No Streaming

The Worker calls Mistral API (`mistral-small-latest`) synchronously and returns a complete JSON response. No Server-Sent Events.

Agent questions are short — under 15 words per the IDEO principle that short questions invite long answers. Streaming adds SSE plumbing complexity for 1-2 sentences of output. A typing indicator animation on the client handles the 2-5 second round-trip.

This follows the same HTTP fetch pattern used by `implementerAgent.ts`, `scorerAgent.ts`, and `explainerAgent.ts`. Can upgrade to SSE in a future ADR if response length increases.

### 2. Hybrid UI: Conversational + Structured Inputs

Each agent turn returns three things:
- **`acknowledgment`**: 1-2 sentences of natural language — acknowledges the previous answer, demonstrates understanding, provides transition context. This is where the agent shows it was listening (IDEO: "reference previous answers in follow-ups").
- **`question`**: The actual question in natural language (under 15 words ideal).
- **`input`**: A typed input specification — `{ type: 'text' | 'textarea' | 'tags' | 'select' | 'radio', options?: string[], placeholder?: string }`.

The frontend renders the acknowledgment as agent prose, then renders the appropriate form control (`TextInput`, `TextareaInput`, `TagsInput`, `SelectInput`, `RadioGroup` from `src/components/ui/form`). This is neither a free-text chatbox nor a static form — it's a guided conversation with structured capture.

### 3. Fixed Question Budget ("20 Questions")

The recruiter chooses a budget at session start: **5** (quick), **10** (standard), **15** (thorough), **20** (deep). The agent must maximize information extraction per question within this budget.

The budget is tracked server-side in the `role_contexts` row. Each `/respond` call decrements the counter. When the budget is exhausted, the agent produces a final **Playback synthesis** — a narrative summary that demonstrates understanding of the role, not a data dump.

This constraint is a feature, not a limitation. Like the game 20 Questions, a hard budget forces the agent to ask the *best possible* question at each turn rather than meandering through a checklist.

### 4. Free/Pro Tier Gating

- **Free tier**: Baseline form only — title, level, stack, department, work model, team size, reports to. Pipeline created with `creation_mode = 'BLANK'` or `'PRESET'`.
- **Pro tier**: "Enhance with AI" button triggers the agent interview. Pipeline created with `creation_mode = 'AI_DRIVEN'`.

Gate enforced server-side: the POST `/api/v1/role-contexts` route checks Clerk JWT billing claims. Frontend uses `useAuth()` to show/hide the button.

### 5. Loosely Typed Knowledge State

The Knowledge State is a JSON blob organized around the **Six Domains**:

| Domain | What It Captures |
|---|---|
| **Why** | Role origin (new/backfill), what problem this hire solves, urgency, timeline |
| **Work** | Product/system, features, technology with context about *how* it's used, autonomy level |
| **Team** | Size, composition, dynamics, communication style, what kind of person thrives/fails |
| **Bar** | Hard requirements vs. nice-to-haves, seniority definition, hidden requirements |
| **Codebase** | Age, structure, testing, typical PRs, tech debt, comparable repos |
| **Process** | Interview constraints, past pain points, stakeholders, timeline |

Exact fields within each domain emerge from conversation — there is no fixed contract. The agent fills what the conversation reveals. Future downstream agents (Pipeline Agent, Stage Agent) interpret the blob and extract what they need. This avoids over-engineering a schema for data whose shape is inherently variable.

---

## Design Philosophy — Encoded in the System Prompt

The system prompt is the core of this agent. It encodes research-backed interviewing principles that determine conversation quality.

### IDEO Empathy Interview Principles

1. **Treat the user as a partner**: Explain why detail matters — *"The more specific you can be here, the more realistic the code review challenges I'll generate."* This gives the recruiter a reason to invest effort.
2. **Build rapport before substance**: Open with easy, low-pressure questions about role context before going technical. The first question should be answerable without thinking hard.
3. **Follow energy**: If the user gives a long, detailed answer — they care about this topic. Dig deeper. If they give a short or uncertain answer — move on or try a different angle. Don't push harder on the same topic.
4. **Ask about specific instances, not generalities**: *"Walk me through what happened the last time someone shipped a feature"* beats *"Describe your development process."* Specific instances surface real, messy, useful detail.
5. **Keep questions short**: Under 15 words ideal. Short questions invite long answers. Long questions confuse and get short answers.

### Five Whys — Adapted as Contextual Drilling

Never literally ask "why." Instead:

- **Hypothesis offering**: *"When you say senior — does that mean 8+ years, or someone who can own a system end-to-end regardless of years?"* — People are better at correcting a wrong hypothesis than generating an answer from scratch.
- **Consequence questions**: *"What happens if the person you hire hasn't worked with real-time systems?"* — Asking about consequences is less confrontational than asking reasons.
- **Story requests**: *"Tell me about what happened with the last person in this role"* — Stories naturally contain the "why" without making the person feel interrogated.
- **"How" instead of "why"**: *"How does your team handle testing right now?"* — "How" is procedural and concrete. "Why" is abstract and personal.

### Laddering (Means-End Chain Theory)

For every key requirement the user mentions, the agent moves up the chain:

- **Attribute**: "We use Kafka" (where most bots stop)
- **Consequence**: "Kafka handles event streaming between our 6 microservices" (what it enables)
- **Value**: "Reliability matters because our users are healthcare providers and downtime affects patient care" (the root motivation)

The Value level is what changes assessment design. "Must know Kafka" produces a generic distributed systems quiz. "Must reason about reliability in healthcare" produces a code review challenge with HIPAA-relevant error handling scenarios.

The agent doesn't need to ladder every technology — but for the 3-4 things the user emphasizes most, reaching the Value level dramatically improves downstream content.

### Beginner's Mind

The agent should demonstrate domain knowledge without assuming the user's context matches that knowledge:

- **Good**: *"Event-driven architecture means different things in practice — some teams run Kafka with a schema registry, others use Redis pub/sub, some use an in-process event bus. Where does your system land?"* — Shows knowledge, asks about *their* context.
- **Bad**: *"Since you're using event-driven architecture, you're probably dealing with eventual consistency challenges."* — Assumes their context.
- **Bad**: *"What is event-driven architecture to your team?"* — Sounds clueless.

The framework: *"I know what [X] is. I don't know what [X] is to you."*

### ReAct Reasoning Loop

Before each response, the agent reasons internally (logged but not shown to user):

1. Which of the Six Domains have coverage? Which are sparse?
2. How deep have I gone? (Attribute / Consequence / Value per the Laddering chain)
3. What's the user's energy? (Long answer = dig deeper, short = pivot)
4. How many questions remain in the budget? Should I prioritize depth or breadth?
5. What question type should I use next?

### Seven Question Types

| Type | Purpose | When to Use |
|---|---|---|
| **Introductory** | Establish context, calibrate difficulty | Opening (turns 1-2) |
| **Grand Tour** | Get the big picture | Early (turns 2-4) |
| **Example** | Move from abstract to concrete | Mid-conversation |
| **Follow-Up / Drilling** | Go deeper on something interesting | When user shows energy |
| **Direct** | Get specific facts efficiently | After rapport is built |
| **Hypothesis** | Validate understanding, show listening | Later turns |
| **Contrast** | Surface hidden preferences via opposites | Closing turns |

The conversation naturally arcs from broad/easy (Introductory, Grand Tour) to specific/challenging (Direct, Hypothesis, Contrast). The agent doesn't rigidly follow this arc but trends toward it.

### Negative Space — What the Agent Must Never Do

These are hardcoded constraints in the system prompt:

- **No leading questions**: *"Your team probably values clean code, right?"* — confirms assumptions instead of discovering reality
- **No stacking multiple questions**: One question per turn, always. Multiple questions let the user cherry-pick the easiest one.
- **No filler praise**: *"That's really helpful!"* — filler praise from an AI is cringe. Acknowledge what you learned, then move forward.
- **No asking what you can infer**: If they already said "HIPAA-compliant healthcare platform," don't ask "Is security important?"
- **No repeating answered questions**: Reference what they said — *"You mentioned 4 engineers — what's the seniority breakdown?"*
- **No asking the user to do the agent's job**: Don't ask *"What assessment would work?"* — form an opinion and present it for validation.

### Playback Synthesis (Final Turn)

When the budget is exhausted or the user finishes early, the agent produces a **narrative summary** — not a data dump. This is the Design Thinking "Define" phase:

> *"You're looking for a senior backend engineer to join a 4-person team building a HIPAA-compliant messaging platform for healthcare providers. The main technical challenge is completing a migration from HTTP polling to WebSockets — specifically, solving message delivery guarantee problems in a distributed system. The ideal candidate can own this subsystem end-to-end, make architectural decisions about event flow and consistency, and work autonomously in an async-first team culture. The dealbreaker is someone who can't reason about distributed systems — the specific tools matter less than the design thinking."*

This serves three purposes: error correction (user catches misunderstandings), completeness check (summaries trigger forgotten details), and trust building (proves the agent was listening).

---

## D1 Schema

New migration: `workers/api/migrations/0011_role_contexts.sql`

```sql
CREATE TABLE IF NOT EXISTS role_contexts (
  id               TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  pipeline_id      TEXT REFERENCES pipelines(id) ON DELETE CASCADE,
  owner_id         TEXT NOT NULL,

  -- Baseline (structured form data, always collected)
  baseline         TEXT,

  -- AI interview output
  knowledge_state  TEXT,           -- JSON: Six Domains output blob
  exchanges        TEXT,           -- JSON: Array of conversation turns

  -- Budget tracking
  question_budget  INTEGER NOT NULL DEFAULT 10,
  questions_asked  INTEGER NOT NULL DEFAULT 0,

  -- Status
  status           TEXT NOT NULL DEFAULT 'BASELINE'
                   CHECK (status IN ('BASELINE', 'INTERVIEWING', 'COMPLETE', 'ABANDONED')),

  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_role_contexts_owner_id ON role_contexts(owner_id);
CREATE INDEX idx_role_contexts_pipeline_id ON role_contexts(pipeline_id);
```

Design notes:
- **`pipeline_id` is nullable** — the role context is created before the pipeline exists. The FK is set when the pipeline is created from the role context.
- **JSON in TEXT columns** — D1 has no native JSON type. This is consistent with `pipelines.stack`, `challenges.config`, and `challenges.server_config`.
- **ID generation** — `lower(hex(randomblob(16)))` matches all existing tables.
- **Status state machine**: `BASELINE` → `INTERVIEWING` → `COMPLETE` or `ABANDONED`.

---

## API Routes

New route module: `workers/api/src/routes/roleContexts.ts`, mounted at `/api/v1/role-contexts`.

All routes require Clerk JWT authentication (existing `authMiddleware`). Ownership checks follow the same pattern as `pipelines.ts`.

### `POST /api/v1/role-contexts`

Create a new role context with baseline data. Optionally starts the AI interview.

**Request:**
```json
{
  "baseline": {
    "title": "Senior Backend Engineer",
    "level": "Senior",
    "stack": ["TypeScript", "NestJS", "Kafka"],
    "department": "Platform",
    "workModel": "Remote",
    "teamSize": "4 engineers",
    "reportsTo": "Engineering Manager"
  },
  "questionBudget": 10
}
```

**Response (201):**
```json
{
  "id": "a1b2c3...",
  "status": "BASELINE",
  "baseline": { "..." },
  "questionBudget": 10,
  "questionsAsked": 0
}
```

### `POST /api/v1/role-contexts/:id/respond`

Submit an answer to the current question and receive the next agent turn. This is the core loop.

**Request:**
```json
{
  "answer": "We use Kafka for event streaming between our 6 microservices. The candidate would need to design new topic topology.",
  "questionId": "q-3"
}
```

**Response (200) — mid-interview:**
```json
{
  "acknowledgment": "Event streaming across 6 services with Kafka — so the candidate needs to think at the topology level, not just produce and consume. That's a design role, not just an implementation role.",
  "question": {
    "id": "q-4",
    "text": "What breaks when a consumer falls behind?",
    "input": { "type": "textarea", "placeholder": "Describe the impact on users or downstream services..." }
  },
  "progress": {
    "asked": 4,
    "budget": 10,
    "domains": { "why": "covered", "work": "deep", "team": "sparse", "bar": "partial", "codebase": "none", "process": "none" }
  },
  "status": "INTERVIEWING"
}
```

**Response (200) — budget exhausted:**
```json
{
  "synthesis": "You're looking for a senior backend engineer to join a 4-person team...",
  "knowledgeState": { "why": { "..." }, "work": { "..." }, "..." },
  "progress": { "asked": 10, "budget": 10 },
  "status": "COMPLETE"
}
```

### `POST /api/v1/role-contexts/:id/complete`

Force-complete the interview early. Returns the same synthesis + knowledge state as budget exhaustion.

### `GET /api/v1/role-contexts/:id`

Retrieve full state for page reload recovery. Returns all fields including parsed JSON.

---

## Worker Architecture

### File Structure

```
workers/api/src/
  routes/roleContexts.ts        — Hono route handlers
  lib/roleAgent.ts              — Agent logic: prompt building, Mistral call, response parsing
  lib/roleAgentPrompts.ts       — System prompt templates
  validation/roleContexts.ts    — Zod request schemas
```

### Agent Call Pattern

Reuses the HTTP fetch pattern from `workers/api/src/lib/implementerAgent.ts`:

1. Load role context row from D1
2. Append user's answer to `exchanges` array
3. Build Mistral prompt: system prompt (design philosophy) + conversation history + current knowledge state + remaining budget
4. Call `https://api.mistral.ai/v1/chat/completions` with `mistral-small-latest`, JSON response format
5. Parse structured response: `acknowledgment`, `question`, `knowledgeStateUpdate`, `reasoning`
6. Merge `knowledgeStateUpdate` into `knowledge_state`
7. Increment `questions_asked`, update D1 row
8. Return next turn to frontend

### Cost Control

- **Model**: `mistral-small-latest` — cheapest model with adequate instruction following (~$0.001 per turn)
- **Input truncation**: User answers capped at 2,000 characters
- **Session hard cap**: $0.10 max (enforced via token counting, same pattern as existing agents)
- **Typical session**: 10 questions at ~$0.002/turn = $0.02 total

---

## Alternatives Considered

### Option A — Server-side Mistral, hybrid UI, fixed budget (chosen)
- **Pros**: Simple architecture, cheap ($0.02-0.05/session), deterministic budget, typed inputs give clean structured data, fits existing Worker patterns, system prompt stays server-side
- **Cons**: 2-5 second latency per turn, Mistral quality ceiling for nuanced interviewing

### Option B — Server-side with SSE streaming
- **Pros**: Real-time feel as text appears progressively
- **Cons**: SSE plumbing (ReadableStream, partial JSON parsing on client), marginal gain for 1-2 sentence agent responses. **Deferred** — can upgrade later if responses get longer.

### Option C — Client-side AI (browser calls Mistral directly)
- **Pros**: Lower perceived latency
- **Cons**: Exposes API key (or requires a proxy, which is just Option A). System prompt visible in network tab. No server-side budget enforcement. Billing gate trivially bypassable. **Rejected.**

### Option D — Pure chat UI (free-text input)
- **Pros**: More natural conversation feel
- **Cons**: Messy data extraction (user writes partial sentences, tangents, multi-part answers). Hard to structure knowledge state. Accessibility issues with open-ended chat. **Rejected.**

### Option E — Unlimited questions (no budget)
- **Pros**: Maximum information extraction
- **Cons**: User fatigue (no one wants to answer 40 questions), unpredictable costs, no forcing function for question quality. **Rejected.**

---

## Rationale

The core insight driving this architecture: **people don't know what they know until you help them discover it.** A recruiter who fills out a form writes "Must know TypeScript, React, and Kafka. 5+ years experience." An agent using contextual drilling and laddering discovers that what they actually need is someone who can reason about message delivery guarantees in a distributed system, work autonomously, and handle the pressure of a half-finished migration in a HIPAA-regulated environment.

The difference between those two descriptions is the difference between a generic technical quiz and a code review challenge that tests exactly what this team needs. That's what the Knowledge State enables.

Server-side execution keeps the system prompt and reasoning private — the recruiter sees questions, not the agent's strategy. The fixed budget respects the recruiter's time and forces the agent to be surgical with its questions. The hybrid UI gives the warmth of conversation with the precision of structured data capture.

---

## Consequences

### Positive

- **Enables downstream agents.** The Knowledge State is the input for a future Pipeline Agent (auto-generates stages + challenge types) and Stage Agent (generates challenge content tailored to the role). This ADR builds the foundational data layer.
- **Differentiating UX.** The hybrid conversational + structured input approach is neither a chatbot nor a form. It respects the recruiter's time while extracting deeper context than any static form could.
- **Cost-efficient.** Mistral small at ~$0.02/session makes this viable at scale. No need for Claude or GPT-4 for short question generation.
- **Progressive enhancement.** Free users still get the baseline form and presets. The AI interview is additive, not required.
- **Reusable pattern.** The agent architecture (ReAct loop, budget tracking, hybrid UI, turn-based state) can be applied to other interview contexts.

### Negative / Trade-offs

- **Mistral quality ceiling.** Mistral small may struggle with nuanced contextual drilling and hypothesis generation compared to Claude or GPT-4. If quality is insufficient, upgrading to Mistral Large increases cost ~5x.
- **No real-time streaming.** The 2-5 second round-trip per question may feel sluggish. Mitigated by the fact that users are typing answers (not waiting for paragraphs), so the delay aligns with their input time.
- **Loosely typed Knowledge State.** Downstream agents must interpret a blob rather than a fixed schema. This is intentional (emergence over prescription) but makes downstream agent prompts harder to write and test.

### Risks

- **Mistral API availability.** If Mistral is down, the AI interview is unavailable. Mitigation: graceful degradation to baseline-only with "AI interview temporarily unavailable." No fallback to a weaker model — question quality is critical.
- **Prompt injection.** A malicious recruiter could attempt to manipulate the agent via answers. Mitigation: structured JSON output limits attack surface, user input truncated to 2,000 characters, system prompt is strong. The knowledge state is consumed by downstream agents, not executed as code.
- **Session cost overshoot.** Adversarial long answers could push token counts higher. Mitigation: input truncation + hard cutoff at $0.10/session.

---

## Follow-up

- **Future ADR**: Pipeline Agent — consumes Knowledge State, auto-generates pipeline stages and challenge types
- **Future ADR**: Stage Agent — consumes Knowledge State + stage context, generates challenge content (PRs, quiz questions)
- **Migration 0012**: Add `role_context_id TEXT REFERENCES role_contexts(id)` column to `pipelines` table
- **Clerk Dashboard**: Define `ai_discovery` feature flag for Pro billing gating
- **Playwright E2E test**: Full flow — baseline form → AI interview (mocked Mistral) → pipeline creation with `AI_DRIVEN` mode
- **Prompt tuning**: After initial implementation, run discovery sessions with real recruiters and tune the system prompt based on conversation quality
