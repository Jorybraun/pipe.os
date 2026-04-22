---
status: current
owner: founder
updated: 2026-04-22
---

# PIPE — Unified Project Brief

## What we are building

PIPE is an AI-native developer interview platform. The core thesis: **assess candidates by simulating how they actually work**, not by testing memorized algorithms or trivia.

The flagship experience is a multi-turn code review on a real PR from a real open-source repo, matched to both the role and the candidate. An AI agent plays the PR author — pushing back, asking for clarification, making fixes. The candidate is scored on communication, technical depth, review practice, and decision-making under uncertainty.

Secondary pillar: a structured behavioral/culture interview conducted by an AI agent using STAR-format questions and BARS rubrics, producing evidence-linked, legally defensible reports.

## Who it's for

- **Recruiters** who want async, high-signal technical screening without setup complexity
- **Developer managers / tech leads** who want to see *how* a candidate thinks, not just *what* they know
- **Candidates** who want to demonstrate real engineering judgment in realistic scenarios

## The dream (what ships by September 2026)

A hiring manager can:

1. Describe a role in natural language (or paste a LinkedIn job post)
2. The system interviews them briefly to clarify context, team, and technical needs
3. The system auto-generates a complete interview pipeline with matched repos, challenges, and rubrics
4. The manager reviews, tweaks 3-4 toggles, and approves
5. Candidates get a shareable link — no sign-in required
6. Each candidate progresses through async AI-conducted stages:
   - **Screening**: pre-recorded video questions, candidate records responses
   - **Culture**: AI behavioral interview (STAR format, BARS scoring)
   - **Code Review**: 3 multi-turn PR review sessions with AI implementer + follow-up probes
   - **Open Source Implementation**: fix a live issue in a dev container, using AI copilot, all interactions logged
7. At each stage: AI scores, evidence is captured, recruiter gets notified, can review and override
8. Final stage can be a live video panel (scheduled via Calendly/Cal.com), recorded and transcribed
9. Recruiter sees a candidate profile with per-stage scores, transcript excerpts, video recordings, and comparison to other candidates

## What we are NOT building (guardrails)

- LeetCode-style algorithmic puzzles
- Trivia quizzes about syntax
- A generic HR platform
- Human-interviewer replacement (AI augments; humans approve and live-interview)
- Our own scheduling system (we integrate, not reinvent)
- Our own email infrastructure (Resend/Cloudflare, not AWS SES)

## Domain Language & Glossary

This glossary is mandatory. Use these terms exactly. Do not interchange them.

| Term | Definition | What it is NOT |
|------|-----------|--------------|
| **Pipeline** | A sequence of stages that defines a complete interview for one role. Owned by a recruiter. | Not a "job" or "requisition" |
| **Stage** | A phase of the interview process. Has a type, an order, and a mode (async or live). Contains challenges. | Not a "step" or "round" |
| **Challenge** | The smallest unit of assessment. A single task a candidate performs. Has a type and config. Lives inside a stage. | Not a "question" (questions are inside challenges) |
| **Stage Type** | The category of a stage: `SCREENING`, `CULTURAL`, `CODE_REVIEW`, `OPEN_SOURCE`, `LIVE_PANEL` | Not `AI_COLLAB`, `PLANNING`, `VOICE`, `INGESTION`, `TECHNICAL`, `QUESTIONS` — these are deprecated or merged |
| **Challenge Type** | The runtime type of a challenge: `CODE_REVIEW`, `CODE_IMPLEMENTATION`, `QUIZ_MCQ`, `QUIZ_SHORT_ANSWER`, `FOLLOW_UP` | Not a stage type |
| **Assessment** | The record of one candidate's progress through one stage. One per (candidate × stage). | Not the whole pipeline |
| **Submission** | The candidate's response to one challenge. One per (candidate × challenge). | Not the assessment |
| **Role Discovery** | The AI interview of the recruiter/hiring manager that produces a structured Role Context Document. The source of truth for pipeline generation. | Not "pipeline creation" and not "job description parsing" |
| **Role Context Document** | Structured output from Role Discovery. Sections: Team Context, Technical Context, Dispositional Context. Consumed by downstream agents. | Not a flat persona or a JSON blob of keywords |
| **Culture Interview** | The AI-conducted behavioral interview. FSM-driven. Uses STAR questions from a curated bank. Scored via multi-agent BARS rubrics. | Not a quiz or a challenge queue |
| **Code Review Session** | The multi-turn conversation where a candidate reviews a PR and an AI implementer pushes back. Stored in `review_sessions`. | Not a single `CODE_REVIEW` challenge rendered in the generic assessment flow |
| **Open Source Challenge** | The implementation stage where a candidate fixes a live open-source issue in a dev container. | Not "dev container sandbox" and not "coding challenge" |
| **Screening** | Async video response to pre-recorded questions. Candidate records, system stores. | Not a phone call (phone is a separate outreach feature, not a stage) |
| **Live Panel** | A video interview with real humans. Can be attached to any stage or as a final stage. Scheduled via external provider. | Not an AI stage |
| **Repo Triangulation** | Matching an open-source repo to both the role requirements and the candidate's background. Uses vector similarity + signal extraction. | Not a SQL keyword join |
| **Follow-up** | AI-generated questions asked after a code review session to probe understanding, trade-offs, and communication depth. | Not a separate stage |
| **Candidate Token** | The invite token (`invite_token` in DB). One-time use. Exchanged for a session JWT. | Not a user account or Clerk session |
| **Session JWT** | The bearer token issued after token resolution. Used for all candidate-facing RPC routes. | Not an API key |

## Deprecated Terms (do not use)

These terms exist in legacy code or old docs. Replace them when encountered:

- `AI_COLLAB` → delete
- `PLANNING` → delete
- `VOICE` as stage type → use `LIVE_PANEL` with `video: true`
- `INGESTION` as stage type → use `OPEN_SOURCE` or remove
- `TECHNICAL` / `QUESTIONS` → merged into `SCREENING` (async question-based filter)
- `VOICE_INTERVIEW` → `LIVE_PANEL`
- `AI_COLLABORATION_ASSESSMENT` → delete
- `SYSTEM_DESIGN_&_PLANNING` → delete

## Architecture Principles

1. **Cloudflare-native** — Pages, Workers, D1, R2, Durable Objects. No AWS except where impossible to avoid.
2. **Research-backed** — Every stage type, scoring method, and UX decision is traceable to a research finding in `knowledge/outputs/`. See ADR-033 for guardrails.
3. **TypeScript strict** — No `any`. Explicit returns. Named exports.
4. **BDD-first** — Playwright test for every candidate-facing route before implementation.
5. **Security** — Internal IDs never leave the server. Ground truth (rubrics, answers, planted bugs) stays server-side.
6. **One app** — Recruiter and candidate experiences in the same codebase. No external interview platforms.

## Phased Roadmap (what ships when)

### Phase 1: Pipeline Creation & Role Discovery (now — June)
**Goal:** A recruiter can describe a role, the system generates a pipeline, and the recruiter can review and approve it.

- Fix Role Discovery agent prompts (less probing, more insight extraction)
- Role Discovery produces a structured Role Context Document
- System auto-generates pipeline config from Role Context (stages, repos, challenges)
- Recruiter reviews in a simple UI (3-4 toggles: live? video? follow-up?)
- Recruiter can manually edit questions, swap repos, add/remove stages
- Clean, simple pipeline detail page — no noise

**Acceptance:** A non-developer can create a "Senior Frontend Engineer" pipeline in under 5 minutes without reading docs.

### Phase 2: End-to-End Interview Flow (June — July)
**Goal:** A real candidate can complete a full pipeline and the recruiter sees results.

- Screening stage: video recording, storage, playback on candidate profile
- Culture stage: AI behavioral interview works end-to-end (consent → questions → scoring → report)
- Code Review stage: 3 PR sessions with AI implementer + follow-up questions
- Token resolution, session JWT, candidate auth all solid
- Candidate assessment page stable (no crashes, clear progress)
- Recruiter dashboard shows candidate status, scores, and evidence

**Acceptance:** 5 real developers complete the pipeline. Recruiter can review each stage's output.

### Phase 3: Scoring & Insights (July — August)
**Goal:** The recruiter gets actionable intelligence, not raw data.

- Per-stage scoring: BARS for culture, annotation quality + communication for code review
- Overall candidate signal (strong/medium/weak) with explanation
- Comparison view: candidate A vs candidate B per dimension
- Calibration loops: run scorer against gold corpus, tune prompts, measure QWK
- Human-in-the-loop review UI: recruiter can override scores, add notes

**Acceptance:** Scores correlate with human expert judgment (target QWK ≥ 0.60 for culture, ≥ 0.70 for code review).

### Phase 4: Open Source Challenge (August — September)
**Goal:** The dev container implementation stage works.

- Repo triangulation: match live issue to role + candidate
- Dev container spins up with matched repo + issue
- Candidate codes solution, uses AI copilot (proxied, logged)
- System captures: code changes, AI interactions, commit messages, test results
- Scoring: decision quality, code correctness, AI collaboration patterns

**Acceptance:** A candidate can fix a real issue and the recruiter sees the full artifact.

### Phase 5: Polish & Scale (September+)
**Goal:** Production-ready, competitive with Karat/HackerRank.

- Live panel stage (video rooms, recording, transcription)
- Phone outreach (Twilio integration, call logging)
- LinkedIn integration (role import, candidate sourcing)
- ATS integrations (Greenhouse, Lever)
- Billing and feature gating (Clerk Billing)
- Marketing site with research citations

**Acceptance:** First paying customer.

## Current State — Honest Snapshot

### What exists and works
- **Backend**: 17 Hono route modules mounted. D1 schema through migration 0038.
- **Auth**: Clerk Pro for recruiters, custom JWT for candidates.
- **Role Discovery**: `roleAgent.ts` with ReAct + tool calling. Produces role context.
- **Culture Interview**: `cultureAgent.ts` + FSM. `CultureInterviewPage.tsx`. `/rpc/culture/session/*` routes.
- **Code Review**: `implementerAgent.ts`. `/rpc/review/*` routes. `review_sessions` table.
- **Video**: `VideoRoom` Durable Object. WebRTC signaling. TURN credentials.
- **Scheduling**: Calendly + Cal.com OAuth + webhooks.
- **Phone**: Twilio webhooks, Deepgram transcription.
- **Dev Containers**: `DevContainerDO` exists. `DevContainerSandboxPage` exists. Not wired to candidate flow.
- **Frontend**: Listing, Overview, RoleDiscovery, StageDetail, CandidateProfile, CandidateAssessment pages.

### What is broken or confusing
- **Role Discovery**: Probes too much, asks irrelevant questions, insights don't surface in output.
- **Stage types**: Three incompatible systems in the codebase. `PipelineBuilderPage` references dead types (`AI_COLLAB`, `PLANNING`, `VOICE`).
- **Cultural stage**: Dual personality. Can be challenge-based OR AI interview. Should be AI interview only.
- **Code Review stage**: Unclear whether it runs the multi-turn review session or the challenge renderer.
- **Pipeline detail UI**: Too complex, shows wrong information, not cohesive.
- **Scoring**: Exists in backend but not surfaced well in UI. No calibration loops running.
- **Repo triangulation**: Not built. Matching is SQL keyword join, not intelligent.
- **Open Source Challenge**: Not built. Dev container is infrastructure, not a candidate stage.

### What was deleted in the migration
- AWS Amplify backend (auth, data, 30+ Lambda functions)
- Terraform infrastructure
- `amplify_outputs.json`, `amplify.yml`

### What is actively being migrated
- CI/CD: GitHub Actions + Wrangler (Phase 5 of migration plan)
- Email: Moving to Cloudflare-native (Resend)
- AI providers: Moving from Mistral API to Cloudflare Workers AI (Gemma, Qwen)

## Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-04-22 | Lock stage types to 5: SCREENING, CULTURAL, CODE_REVIEW, OPEN_SOURCE, LIVE_PANEL | Eliminate confusion from 3 incompatible type systems. Remove dead types. |
| 2026-04-22 | CULTURAL stage = AI behavioral interview only | Challenge-based fallback was accidental complexity. Culture is a distinct agentic experience. |
| 2026-04-22 | CODE_REVIEW stage = multi-turn review session only | Challenge-type CODE_REVIEW still exists for single PR diff inside other stages. |
| 2026-04-22 | Dev containers = Phase 4, not Phase 2 | Infrastructure exists but candidate flow does not. Code review must be perfect first. |
| 2026-04-22 | Research drives roadmap, not retroactive justification | ADR-033 guardrail. Every claim on marketing site must be citeable. |
| 2026-04-22 | Simple UI first, advanced panel second | 3 toggles per stage (mode, video, follow-up). Advanced config hidden behind collapsible. |

## File Map

| Question | File |
|----------|------|
| What are we building and why? | `docs/vision.md` |
| What does the research say? | `knowledge/STRATEGY.md` |
| What is the migration status? | `migration/PLAN.md` |
| What is the unified project view? | `docs/project-brief.md` (this file) |
| What are the stage types and challenge types? | `workers/api/src/validation/stages.ts` |
| What is the DB schema? | `workers/api/migrations/` |
| What is the candidate API? | `workers/api/src/routes/rpc.ts` |
| What is the culture agent architecture? | `docs/decisions/current/ADR-029-culture-interview-agent-architecture.md` |
| What is the code review research? | `docs/decisions/current/ADR-032-code-review-research-integration.md` |
| What is the research guardrail? | `docs/decisions/current/ADR-033-research-integration-strategy-and-guardrails.md` |
