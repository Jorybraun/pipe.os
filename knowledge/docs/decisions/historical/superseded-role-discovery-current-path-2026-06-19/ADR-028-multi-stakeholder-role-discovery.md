# ADR-028: Multi-Stakeholder Role Discovery

**Date:** 2026-04-05
**Status:** Proposed
**Deciders:** Hans (founder)
**Predecessor:** ADR-027 (Role Discovery Agent)

---

## Context

ADR-027 built a single-person role discovery agent. Testing revealed three problems:

1. **Tech bias** — The baseline form and questions assume a tech role. Marketing, design, sales roles get a poor experience.
2. **Single perspective** — One person (often a recruiter with limited context) produces shallow role profiles. Real intake meetings involve hiring managers, team members, and sometimes external recruiters — each with different knowledge.
3. **Generic questions** — Without knowing who it's talking to, the agent asks the same questions regardless of whether the interviewee is a hands-on engineering manager or an external recruiter who's never visited the office.

The fix: convert role discovery from a single-person form into a multi-stakeholder intake system where the agent calibrates to each participant, doesn't repeat established facts, and preserves all raw data.

---

## Decision

### 1. Generic Baseline

The initial form works for ANY role:
- **Title** (required)
- **Department** (optional)
- **Company name** (optional)
- **Company URL** (optional — triggers `research_company` tool)
- **Location** (optional)

Removed from baseline: level, stack, team size, reports to, work model. These emerge from the interview — the agent asks about them when relevant to the role type it discovers.

### 2. Interviewer Calibration

The first question in every interview is always: **"What's your relationship to this role?"**

Options:
- Hiring Manager
- Internal Recruiter
- External Recruiter
- Team Member

This is hardcoded (not agent-generated) and sets `participant_role` on the participant row. All subsequent agent behavior adapts to this role.

### 3. Multi-Participant Architecture

New D1 table: `role_context_participants`

```
role_contexts (shared)          role_context_participants (per-person)
├─ id                           ├─ id
├─ baseline                     ├─ role_context_id (FK)
├─ knowledge_state (merged)     ├─ name, email
├─ status                       ├─ participant_role (HM/recruiter/team member)
└─ pipeline_id                  ├─ invite_token (for non-creators)
                                ├─ exchanges (their conversation)
                                ├─ questions_asked, question_budget
                                ├─ status (PENDING/INVITED/INTERVIEWING/COMPLETE)
                                └─ is_creator (boolean)
```

The `role_contexts` table holds the **shared** knowledge state (merged from all participants). Each participant's raw exchanges are stored separately and never summarized away.

### 4. Adaptive System Prompt

The system prompt injects a participant-specific section:

- **Hiring Manager**: Deep technical + team ownership. Push for Value-level laddering. Ask about codebase, architecture decisions, what success looks like at 30/60/90 days.
- **Internal Recruiter**: What the HM emphasized. Process, timeline, constraints, past hires. Plain language, don't assume technical depth.
- **External Recruiter**: What the client told them. Market context, comp range, why hard to fill. Do NOT ask questions they can't answer.
- **Team Member**: Culture, day-to-day reality, what surprised them, collaboration style. Their perspective is ground truth for culture.

### 5. Knowledge State Merge Rules

When the agent receives the shared knowledge state, it distinguishes:
- **Factual data** (team size, tech stack, company info): already established — do not re-ask.
- **Perspective data** (culture, who thrives, what's hard): re-ask each participant — store with attribution.

Example:
```json
{
  "team": {
    "size": 6,
    "culture_hm": "async-first, RFC-driven",
    "culture_sarah": "more collaborative than expected, lots of pairing",
    "thrives_hm": "self-directed, owns systems end-to-end",
    "thrives_marcus": "comfortable with ambiguity in early features"
  }
}
```

### 6. Invite Flow

After the creator's interview:
1. UI shows "invite team members" form
2. `POST /api/v1/role-contexts/:id/invite` creates participant rows + sends emails via Resend
3. Each invitee gets a unique URL: `/role-interview/:token`
4. Team member page: no Clerk auth, token-based JWT session (same pattern as candidate assessments)
5. Their interview is shorter (3-5 questions) — the agent already has facts, just needs their perspective
6. Exchanges merge into the shared knowledge state

### 7. Raw Data Preservation

All raw exchanges are stored per-participant and never lost to summarization. The overview page shows:
- **ROLE_PROFILE** tab: aggregated dynamic view
- **RAW_INSIGHTS** tab: full JSON knowledge state
- **PARTICIPANTS** tab: per-person exchanges, who said what

---

## API Routes

### Modified (Clerk auth)
```
POST /api/v1/role-contexts                    — Create + creator participant
POST /api/v1/role-contexts/:id/start          — Calibration question (accepts participantId)
POST /api/v1/role-contexts/:id/respond        — Answer + next question (per-participant)
POST /api/v1/role-contexts/:id/complete       — Complete participant's interview
GET  /api/v1/role-contexts/:id                — Full state + participants list
```

### New (Clerk auth)
```
POST /api/v1/role-contexts/:id/invite         — Send interview invitations
```

### New (public, token-based)
```
POST /rpc/role-interview/resolve-token        — Claim invite token, get JWT
POST /rpc/role-interview/start                — First question (skip calibration)
POST /rpc/role-interview/respond              — Answer + next question
POST /rpc/role-interview/complete             — Finish interview
```

---

## Downstream Agent Integration

The knowledge state is the **context window for every agent in the system**:

- **Pipeline Agent** (future): reads knowledge state → auto-generates stages + challenge types
- **Stage Agent** (future): reads knowledge state → generates challenge content
- **Implementer Agent**: reads team culture + codebase context → responds like someone on THIS team
- **Scorer Agent**: reads requirements + what multiple people flagged as important → weights scoring
- **Explainer Agent**: reads codebase context → grounds explanations in their reality

Multi-perspective data makes every downstream agent smarter. When three people independently flag "autonomy" as critical, the scorer can weight it heavily with confidence.

---

## Implementation Phases

| Phase | What | Effort |
|---|---|---|
| A | D1 migration (participants table) | 10 min |
| B | Types + participantAuth middleware | 30 min |
| C | Simplify baseline (remove tech fields) | 20 min |
| D | Modify existing routes for participant awareness | 1-2 hrs |
| E | System prompt refactor (participant-role variants) | 1 hr |
| H | Frontend: simplified baseline + calibration | 1 hr |
| F | Invite route + email template | 30 min |
| I | Frontend: invite UI + status dashboard | 1 hr |
| G | Public team member routes | 1 hr |
| J | Frontend: team member interview page | 1 hr |
| K | Overview page: participants tab | 30 min |

Core (A-E, H): ~4 hours. Multi-person (F-G, I-J): ~3.5 hours. Display (K): 30 min.

---

## Consequences

### Positive
- **Richer role profiles**: multiple perspectives reveal culture, dynamics, and hidden requirements that one person can't provide
- **Role-agnostic**: works for marketing, design, sales — not just engineering
- **Better downstream assessments**: multi-angle knowledge state produces more targeted challenges
- **Raw data preserved**: nothing lost to summarization, always recoverable

### Negative
- **Complexity**: participant tracking, token auth, email flow, knowledge state merging
- **Latency**: team member interviews happen asynchronously — the pipeline may be created before all perspectives are gathered
- **Merge conflicts**: concurrent interviews could race on knowledge state updates (mitigated by additive merge — no data loss, just ordering variation)

---

## Handoff Notes

### What's Built (ADR-027)
- D1 table `role_contexts` with baseline, knowledge_state, exchanges, budget tracking
- 8 Hono routes: create, get, start, respond, complete, parse-jd, transcribe, patch
- Mistral agent with tool calling (research_company, search_technology), ReAct loop
- System prompt with IDEO/Five Whys/Laddering/Beginner's Mind principles
- Frontend: RoleDiscoveryPage (baseline form → interview → synthesis)
- useRoleDiscovery hook (IDLE → BASELINE → INTERVIEWING → COMPLETE)
- JD parser (paste text or upload PDF → auto-fill baseline)
- Voice input via Workers AI Whisper
- Role profile section on OverviewPage (ROLE_PROFILE + RAW_INSIGHTS tabs)

### What to Build (ADR-028)
Start with Phases A-E + H (the core changes that make the existing single-person flow generic and participant-aware). Then add the multi-person invite flow (F-G, I-J, K).

### Key Patterns to Follow
- **Invite tokens**: same `lower(hex(randomblob(16)))` pattern as all other IDs, atomic claim with `CLAIMED::` prefix (see `rpc.ts` resolve-token)
- **JWT for team members**: reuse `signJwt`/`verifyJwt` from `workers/api/src/lib/jwt.ts`, payload: `{ sub: participantId, rcid: roleContextId }`
- **Middleware**: copy `candidateAuth.ts` pattern for `participantAuth.ts`
- **Email**: add new trigger type to `workers/api/src/lib/email.ts`, reuse `sendNotificationEmail`
- **Routes**: Hono router with typed Env/Variables, Zod validation, `apiError()` for errors

### Critical Design Decision
The calibration question ("What's your relationship to this role?") is **hardcoded, not agent-generated**. It's always `q-calibration` with 4 radio options. The respond handler detects this questionId and routes the answer to set `participant_role` before calling the agent for the real first question. This ensures the agent always knows who it's talking to before generating any question.

### Files to Read First
1. `workers/api/src/routes/roleContexts.ts` — all existing routes that need modification
2. `workers/api/src/lib/roleAgentPrompts.ts` — system prompt to refactor
3. `workers/api/src/routes/rpc.ts` — candidate resolve-token pattern to copy
4. `workers/api/src/lib/email.ts` — email template system
5. `workers/api/src/middleware/candidateAuth.ts` — auth middleware to copy
