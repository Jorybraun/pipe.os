# Phase 6: Challenge Experience — Real Repo Pipelines

> **Status:** Planning
> **Depends on:** Phase 3 (candidate flow), Phase 3b (dev containers), Phase 3c (implementer agent)
> **Goal:** A candidate reviews a real PR, answers follow-up questions, then implements a feature — all in the same repo.

---

## 1. The Problem

The platform has all the challenge types (CODE_REVIEW, FOLLOW_UP, CODE_IMPLEMENTATION) but no cohesive experience threading them together. Challenges feel disconnected — a code review of one repo, an implementation in a blank sandbox. There's no content that demonstrates why this is better than CoderPad.

## 2. The Vision

**One repo. Three stages. Each builds on the last.**

A recruiter picks a real open-source repo (or their own). The platform generates a complete interview pipeline:

### Stage 1: Code Review
- Candidate reviews a real merged PR from the repo
- Uses the "Ask" tab to question the PR author (explainer agent) about architecture, trade-offs, design decisions
- Leaves inline review comments, converses with the implementer agent
- Submits verdict (approve / request changes)
- **Signal:** judgment, communication, how they approach unfamiliar code

### Stage 2: Follow-Up Questions
- Questions generated from the candidate's Stage 1 review transcript
- "You flagged the caching approach — what would you have done instead?"
- "Walk me through how this data flows from the API to the UI"
- Mix of written + voice responses
- **Signal:** depth of understanding, ability to articulate technical reasoning

### Stage 3: Implementation
- Candidate gets a dev container with the repo at the PR's base commit
- Given a feature spec that relates to the code they just reviewed
- They build it, run tests, submit
- **Signal:** can they actually ship in this codebase — not a sandbox, the real thing

### What the recruiter sees
A narrative report across all three stages:
> "Candidate demonstrated strong architectural instincts during review — caught the N+1 query and asked about the caching strategy before flagging it. Follow-up revealed deep understanding of the data flow but uncertainty about the deployment pipeline. Implementation was clean, well-tested, and showed they internalized the codebase patterns from the review."

---

## 3. Implementation Plan

### 3A: Challenge Library (no containers needed)

Build a curated library of "repo pipelines" — pre-configured 3-stage pipelines using real open-source PRs.

**Recruiter flow:**
1. Create pipeline → select role (Senior Frontend, Senior Backend, Fullstack)
2. Pick from curated repo pipelines OR paste a GitHub PR URL
3. Platform auto-generates:
   - Stage 1: CODE_REVIEW challenge with the PR diff, explainer context populated from repo
   - Stage 2: FOLLOW_UP questions (template set, personalized after Stage 1 via AI)
   - Stage 3: CODE_IMPLEMENTATION spec related to the PR's area of the codebase

**What needs building:**
- `POST /api/v1/challenges/from-pr` — takes a GitHub PR URL, fetches diff, generates challenge config with explainer context (repo knowledge, PR context, architecture)
- Auto-population of `server_config.repoKnowledge` from repo README, PR description, and surrounding code
- Follow-up question templates per repo pipeline
- Implementation spec templates per repo pipeline

**Key files:**
- `workers/api/src/routes/challenges.ts` — new endpoint
- `workers/api/src/lib/fetchGitHubDiff.ts` — already exists, extend to fetch repo context
- Challenge editor — "Import from PR" flow already exists via GitHubPRFetcherV2

### 3B: Dynamic Follow-Ups (AI-generated from Stage 1 transcript)

After Stage 1 completes, generate Stage 2 follow-up questions based on what the candidate actually said and did.

**What needs building:**
- `workers/api/src/lib/followUpGenerator.ts` — Takes Stage 1 transcript + repo context → generates 3-5 targeted follow-up questions
- Trigger: fires after Stage 1 scoring completes (async via waitUntil)
- Questions stored in the FOLLOW_UP challenge's config, replacing template defaults
- Recruiter can review/edit generated questions before candidate sees them (or auto-approve)

### 3C: Dev Container Integration (depends on Phase 3b)

Wire Stage 3 to launch a dev container with the repo at the right commit.

**What needs building:**
- Container image per repo pipeline (Dockerfile with deps pre-installed)
- `server_config.containerImage` on CODE_IMPLEMENTATION challenges
- Container launched at the PR's base commit (not HEAD)
- Implementation spec injected as a README or task file in the container
- Test runner configured for the repo's test framework

### 3D: Curated Repo Pipelines (content, not code)

Build 6-10 high-quality repo pipelines across roles:

**Frontend (React/TypeScript):**
- `vercel/next.js` — App Router feature PR
- `shadcn/ui` — Component architecture PR
- `calcom/cal.com` — Full-stack feature PR

**Backend (Node/TypeScript):**
- `honojs/hono` — Middleware or routing PR
- `drizzle-team/drizzle-orm` — Query builder PR
- `cloudflare/workers-sdk` — Worker runtime PR

**Fullstack:**
- `supabase/supabase` — Dashboard + API PR
- `calcom/cal.com` — End-to-end feature PR

Each pipeline needs:
- A good PR (real trade-offs, not trivial, not massive)
- Explainer context (repo architecture, design decisions, surrounding code)
- Follow-up question templates
- Implementation spec (related feature in the same codebase area)
- Ground truth annotations (for scoring calibration — optional, not shown to candidate)

---

## 4. Phasing

### Phase 6A: Ship immediately (no new infrastructure)
- Curate 3 repo pipelines (1 frontend, 1 backend, 1 fullstack)
- Auto-populate explainer context from GitHub PR
- Stage 1 (CODE_REVIEW) + Stage 2 (FOLLOW_UP with template questions) work today
- Recruiter can demo the full Stage 1 + 2 flow end-to-end

### Phase 6B: Dynamic follow-ups
- AI generates Stage 2 questions from Stage 1 transcript
- Recruiter review/approval flow

### Phase 6C: Container integration
- Stage 3 with real dev container
- Depends on Phase 3b (Cloudflare Containers)

### Phase 6D: Scale the library
- 10+ repo pipelines
- Community contributions (submit your repo's best PRs)
- Recruiter can bring their own private repo + PR

---

## 5. Acceptance Criteria

### Phase 6A (MVP)
- [ ] Recruiter can create a pipeline from a GitHub PR URL in under 2 minutes
- [ ] Candidate completes Stage 1 (code review with explainer) + Stage 2 (follow-up questions)
- [ ] Recruiter sees a combined narrative report across both stages
- [ ] At least 3 curated repo pipelines available as presets
- [ ] BDD tests: pipeline creation from PR, candidate Stage 1 + 2 flow, recruiter report view

### Phase 6B
- [ ] Follow-up questions are personalized based on Stage 1 transcript
- [ ] Recruiter can review/edit generated questions

### Phase 6C
- [ ] Candidate gets a running dev container at the PR's base commit
- [ ] Implementation tests run and pass/fail automatically
- [ ] Container auto-destroys after submission

---

## 6. Why This Matters

CoderPad tests: "Can you solve this algorithm puzzle?"
PIPE tests: "Can you do the job?"

A code review of a real PR, followed by questions about what you saw, followed by building a feature in that codebase — that's the first week on the job compressed into 90 minutes. No other platform does this.

The explainer agent makes the review feel real. The follow-up questions probe depth. The implementation proves they can ship. Together, they produce a signal that no resume, whiteboard, or take-home can match.
