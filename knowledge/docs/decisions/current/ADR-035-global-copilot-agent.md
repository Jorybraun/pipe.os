# ADR-035: Global Copilot Agent — Recruiter Assistant Drawer with Skill Modes

**Date:** 2026-04-09
**Status:** Implemented (prototype)
**Deciders:** Founder
**Relates to:** [ADR-034](ADR-034-challenge-authoring-system.md) (challenge authoring), [ADR-027](ADR-027-role-discovery-agent.md) (role discovery agent)
**Research brief:** `knowledge/outputs/repo-discovery-pipeline.md` (76 sources)
**STRATEGY.md:** CR-13 (repo discovery), CR-14 (rolling freshness), CR-15 (bug templates)

---

## Context

PIPE has multiple AI agents — role discovery, culture interview, code review implementer, scoring panel — each built as an isolated backend function with a dedicated frontend page. This works for structured flows (interview FSMs, scoring pipelines) but fails for **exploratory, multi-step tasks** like challenge design.

Challenge design is conversational, not transactional:

1. Recruiter describes what skills to test
2. Agent searches for repos matching the role's stack
3. Agent presents options with reasoning ("This repo is good because...")
4. Recruiter asks questions, redirects ("Find something with more auth patterns")
5. Agent selects PRs, evaluates them for review quality
6. Recruiter approves, agent creates the challenge template

The initial REPOS tab implementation (button → grid of repos) proved the plumbing works but the UX was wrong. A single-prompt button cannot support the back-and-forth required for quality challenge design.

Additionally, recruiters need help with tasks beyond challenge design — explaining candidate scores, advising on pipeline structure, answering "what should I do next?" The same agent drawer pattern serves all of these.

---

## Decision

Build a **global copilot agent** that lives in a side drawer, is available from any page, and enters specialized **skill modes** for different tasks.

### Architecture

```
┌────────────────────────────────────────────────────────┐
│ Frontend: AgentDrawer (Layout agentPanel, 400px)       │
│  ├ AgentMessage bubbles (user/assistant)               │
│  ├ AgentInputBar (text + skill mode chips)             │
│  └ AgentDrawerContext (global open/close/pipeline)     │
├────────────────────────────────────────────────────────┤
│ API: POST /api/v1/agent/chat                           │
│  ├ Session resolution (D1 agent_sessions table)        │
│  ├ Context snapshot (pipeline + persona + stages)      │
│  └ copilotAgent.ts orchestrator                        │
├────────────────────────────────────────────────────────┤
│ LLM: Gemma 4 26B on Workers AI (CloudflareAIProvider)  │
│  ├ System prompt swapped by skill mode                 │
│  ├ Tool protocol: <tool_call>JSON</tool_call> tags     │
│  └ ReAct loop: parse → execute → re-prompt (max 3)    │
├────────────────────────────────────────────────────────┤
│ Tools (executed server-side by Worker)                  │
│  ├ search_repos (Libraries.io + GitHub)                │
│  ├ fetch_repo_info (GitHub API + README)               │
│  ├ list_repo_prs (recent merged PRs)                   │
│  ├ fetch_pr_diff (structured diff)                     │
│  ├ save_challenge_draft (D1 challenge_templates)       │
│  └ lookup_pipeline (D1 query)                          │
└────────────────────────────────────────────────────────┘
```

### Skill modes

| Mode | System prompt | Tools | Trigger |
|------|--------------|-------|---------|
| `general` | Helpful recruiter assistant with pipeline context | `lookup_pipeline` | Default |
| `challenge_design` | Expert challenge designer, walks recruiter through repo → PR → challenge | All 6 tools | "design a challenge", "create a code review" |
| `score_explain` | (future) Reads score reports, translates for hiring managers | TBD | "explain this score" |
| `pipeline_advisor` | (future) Suggests stage structure, challenge mix | TBD | "what should my pipeline look like" |

Skill detection is automatic (regex on user message) but can be overridden by clicking the skill mode chips in the input bar.

### Session persistence

Sessions are stored in D1 (`agent_sessions` table), scoped to `(owner_id, pipeline_id)`. This means:

- Reopening the drawer on the same pipeline resumes the conversation
- Navigating between pages doesn't lose context
- Different pipelines have independent conversations
- The "no pipeline" case (opened from /challenges) has its own global session

### Context injection

On first message for a new session, the backend queries D1 for:
- Pipeline metadata (title, level, stack, description)
- Role context if available (persona, JD)
- Stages + challenge counts

This is stored as `context_snapshot` on the session row and injected into the system prompt. The agent doesn't require role discovery to have been completed — it works with whatever context is available.

### Tool protocol

Gemma 4 on Workers AI doesn't expose native function calling via the `ai.run()` binding (CloudflareAIProvider.supportsTools = false). Instead, tool definitions are injected into the system prompt, and the agent outputs tool calls as:

```
<tool_call>
{"name": "search_repos", "arguments": {"skills": "React, TypeScript"}}
</tool_call>
```

The orchestrator (`copilotAgent.ts`) parses these tags, executes the tool server-side, and feeds the result back as the next user message. This is the same ReAct pattern used by production agents; it sidesteps Workers AI API reliability concerns while Gemma 4's native tool calling matures.

### Why not sub-agents (yet)

The prototype uses a single agent with system prompt + tool set swapping per skill mode. This is simpler and sufficient for the first iteration. Sub-agent delegation (e.g., spawning a separate scoring analysis agent) can be added later by having a tool that calls another LLM provider internally — the architecture supports it without changing the frontend.

---

## Consequences

### Positive

- **Unified interaction point.** Recruiters learn one interface (the drawer) for all AI assistance.
- **Context-aware by default.** The agent knows the pipeline, persona, stages without the recruiter re-explaining.
- **Tool use enables real actions.** The agent doesn't just advise — it can search repos, fetch PRs, and create challenge templates.
- **Session persistence.** Conversations survive page navigations.
- **Extensible.** New skill modes + tools can be added without changing the drawer infrastructure.

### Negative

- **Prompt-injected tools are less reliable than native function calling.** The agent may occasionally malform a tool call or hallucinate a tool name. Mitigated by parsing with fallback.
- **Gemma 4 26B context window limits.** Long conversations with tool results may exceed the model's effective context. Mitigated by the 3-round tool loop limit and future scratchpad/compaction.
- **No streaming.** Responses return complete, which means 2-5 second waits. Acceptable for prototype; SSE streaming can be added later.

### Risks

- **Agent quality depends on Gemma 4's instruction following.** If the model drifts off-task or produces poor tool calls, the experience degrades. Fallback to Mistral provider is available via `COPILOT_AGENT_PROVIDER` env var.
- **Workers AI rate limits.** Gemma 4 has a daily call ceiling (~10k). Heavy copilot usage could compete with culture interview sessions. Monitor via usage tracking.

---

## Implementation

### Files created

**Backend:**
- `workers/api/migrations/0019_agent_sessions.sql`
- `workers/api/src/routes/cockpit/agent.ts`
- `workers/api/src/lib/copilotAgent.ts`
- `workers/api/src/lib/copilotAgentPrompts.ts`
- `workers/api/src/lib/copilotTools.ts`

**Frontend:**
- `src/components/Agent/AgentDrawer.tsx`
- `src/components/Agent/AgentMessage.tsx`
- `src/components/Agent/AgentInputBar.tsx`
- `src/hooks/useAgentChat.ts`
- `src/contexts/AgentDrawerContext.tsx`

**Modified:**
- `workers/api/src/index.ts` — mount agent routes
- `workers/api/src/lib/llm/createProvider.ts` — `createCopilotProvider` factory
- `src/App.tsx` — AgentDrawerProvider + panelContent
- `src/components/SidebarNav.tsx` — Bot icon nav item

### Reused infrastructure
- `workers/api/src/lib/repoDiscovery/librariesIo.ts` — search_repos tool
- `workers/api/src/lib/repoDiscovery/qualityFilter.ts` — fetch_repo_info tool
- `workers/api/src/lib/fetchGitHubDiff.ts` — fetch_pr_diff tool
- `workers/api/src/lib/llm/cloudflareAIProvider.ts` — Gemma 4 provider
- Layout `agentPanel` slot — drawer mounting point

---

## Future work

1. **Streaming (SSE)** — Workers AI supports `stream: true`; pipe tokens to the drawer as they arrive
2. **Sub-agent delegation** — tools that internally call different LLM providers for specialized tasks
3. **Native tool calling** — enable when Workers AI Gemma 4 tool calling stabilizes
4. **Score explanation skill** — reads ScoreReport JSON, translates to hiring manager language
5. **Pipeline advisor skill** — suggests stage structure based on role persona
6. **Conversation compaction** — summarize older turns when context window fills
7. **Pipeline page integration** — "Design challenge" button on stage detail opens drawer with pipeline context pre-set
