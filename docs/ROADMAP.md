# Pipe — Product Roadmap
**Last Updated:** 2026-02-26
**Status:** Active
**Format:** Now / Next / Later (MVP-first)

---

## The Problem With Where We Left Off

The original vision — five stage types, two Lambda agents, agentic role discovery, voice interviews, AI collaboration assessment — is the right long-term product. But it created a trap: everything was dependent on everything else, nothing was shippable, and the complexity caused the project to stall.

**The simplification principle:** One end-to-end workflow, fully functional, beats five half-built features.

---

## Simplified MVP Definition

**What Pipe does at MVP:**
A hiring manager creates a role, sets up a **Code Review stage** (the most developed and differentiated feature), invites candidates, and gets a ranked profile of who caught the most bugs.

That's it. One stage. Real data. Real output.

**Why Code Review first:**
- Most technically complete (spec exists, data models defined, UI prototyped)
- Most differentiated — no other tool does this
- Self-contained — doesn't require voice, video, or complex AI agents
- Demonstrates the core thesis: evaluating *how* engineers think, not just if they can code

**What we're explicitly cutting for MVP:**
- Voice interview stage
- AI Collaboration assessment
- Feature Planning stage
- Agentic role discovery (replaced with a simple form)
- Analytics dashboard
- Real-time subscriptions (polling is fine for MVP)
- Cost tracking for AI calls

---

## Now — MVP (Target: 6 weeks)

**Goal:** One recruiter can create a pipeline, one candidate can complete a code review, and the recruiter sees a scored result.

### 1. Auth (Week 1)
Wire the existing Cognito setup into App.tsx. Currently it's configured but not connected.
- [ ] Protect all routes with Authenticator
- [ ] Sign in / sign out flow
- [ ] User identity passed to Amplify Data client

### 2. Data Schema — Core Models (Week 1–2)
The Amplify schema only has `RoleContext`. Add the missing models.
- [ ] `Pipeline` model (name, description, status, ownerId)
- [ ] `Stage` model (pipelineId, type, order, config as JSON)
- [ ] `Candidate` model (email, name, pipelineId, status)
- [ ] `Assessment` model (candidateId, stageId, score, completedAt)
- [ ] Remove legacy `Todo` model

### 3. Pipeline Creation — Simple Form (Week 2)
Replace the full agentic role discovery with a direct, no-nonsense form. The agentic version comes back in **Next**.
- [ ] Form: role title, seniority, department, stack (text), description
- [ ] Saves to DynamoDB via Amplify Data
- [ ] Redirects to pipeline detail on save
- [ ] Listing page pulls real data (replace `mockRoles`)

### 4. Code Review Stage — Candidate Experience (Week 3–4)
This is the core differentiator. A candidate is shown AI-generated code with intentional bugs and asked to review it.
- [ ] Hardcode 3 starter code snippets (JS/TS, Python, or language-agnostic) with known bugs
- [ ] Candidate marks bugs inline (highlight + comment)
- [ ] Candidate submits review
- [ ] Submission saved to `Assessment` model
- [ ] Completion confirmation screen

**Bug categories to include:**
- Security (SQL injection, unvalidated input)
- Logic (off-by-one, wrong operator)
- Performance (n+1 query, unnecessary re-render)
- Edge cases (null, empty array, negative numbers)

### 5. Code Review Stage — Scoring (Week 4)
Replace mock scores with real calculation from submission.
- [ ] Compare candidate-marked bugs against ground truth
- [ ] Score = bugs found (40%) + severity accuracy (25%) + fix quality (25%) + false positives penalized (10%)
- [ ] Store score on `Assessment`
- [ ] No AI required — rule-based scoring for MVP

### 6. Recruiter Dashboard — Real Data (Week 5)
Connect existing UI pages to real Amplify queries. Most of the UI is already built.
- [ ] `ListingPage` — real pipelines from DynamoDB
- [ ] `OverviewPage` — real candidates and stage progress
- [ ] `CandidateProfilePage` — real assessment scores and derived signal (STRONG / YES / MAYBE / NO based on score thresholds)

### 7. Candidate Invite Flow (Week 5–6)
- [ ] Recruiter generates a shareable link for a pipeline stage
- [ ] Candidate lands on screening page via link (no auth required for candidate)
- [ ] Link tied to `Candidate` record

### 8. Polish & Deploy (Week 6)
- [ ] Remove all `mockRoles`, `mockCandidates`, `mockStages` from pages
- [ ] Error states and loading skeletons on all data-fetching pages
- [ ] Deploy to Amplify hosting
- [ ] Smoke test end-to-end

---

## Next — Post-MVP (Weeks 7–14)

**Goal:** Deepen the product. Bring back the agentic pipeline builder and add a second stage type.

### Agentic Role Discovery
The full two-phase role discovery flow is already architected. Wire up the Lambda functions.
- [ ] Implement `questionAgent` Lambda (Claude API call, extracts context from responses)
- [ ] Implement `jobDescriptionAgent` Lambda (generates JD + candidate filters)
- [ ] Connect `useRoleDiscovery` hook TODO blocks to real Lambda invocations
- [ ] Cost tracking connected to actual API calls

### AI Screening Call — Stage 2
A short async voice/text screening before the code review.
- [ ] Text-based version first: candidate answers 3–5 written questions
- [ ] AI-generated questions based on role context (basic Claude API call)
- [ ] Answers scored for communication, clarity, enthusiasm
- [ ] Voice version deferred to Later

### Pipeline Stage Builder
Let recruiters configure which stages a pipeline contains and in what order.
- [ ] Drag-and-drop stage ordering
- [ ] Stage enable/disable toggles
- [ ] Per-stage configuration (time limit, which code snippets, etc.)

### Multiple Code Review Challenges
- [ ] Challenge library — 10+ code snippets across difficulty levels
- [ ] Recruiter selects which challenges appear in their pipeline
- [ ] Admin UI for adding new challenges

### Candidate Experience Improvements
- [ ] Auto-save on the assessment as candidate works
- [ ] Timer with warnings
- [ ] Confirmation email on submission

---

## Later — Strategic Bets (Months 3–6)

**Goal:** Build the features that make Pipe defensible and sticky.

### AI Collaboration Assessment
Evaluate how a candidate uses AI tools to solve a problem — the most differentiated stage.
- Candidate is given a real engineering task and observed using an in-browser AI coding environment
- Scored on: prompt quality, iteration efficiency, critical review of AI output, strategic decomposition

### Live Voice Interview
AI interviewer conducts a real-time technical conversation.
- WebRTC audio capture + real-time transcription
- AI interviewer asks follow-ups based on answers
- Session recording for recruiter review

### Feature Planning Stage
Candidate designs a feature architecture and writes AI prompts for implementation.

### Analytics & Optimization
- Pipeline funnel analysis (drop-off by stage)
- A/B testing different question sets
- Score calibration across pipelines
- Predictive models ("candidates who scored X on code review had Y retention")

### Team Collaboration
- Multiple recruiters on one account
- Comment threads on candidate assessments
- Shared pipeline templates

### Public API
Let ATS tools (Greenhouse, Lever, Ashby) embed Pipe stages into their workflows.

---

## Prioritization Rationale

| Feature | Why now / why later |
|---|---|
| Auth | Blocking — nothing works without it |
| Core data models | Blocking — all pages use mock data |
| Code review stage | Highest ROI — most complete, most differentiated |
| Simple pipeline form | Unblocks end-to-end flow cheaply |
| Agentic role discovery | Great feature, not needed to prove the concept |
| Voice interview | High effort, low confidence in implementation path |
| AI collab assessment | Most innovative but most complex — needs dedicated focus |

---

## Dependencies

| Item | Depends On | Risk |
|---|---|---|
| Scoring engine | Code snippet library with ground truth bugs | Medium — need to curate content |
| Candidate invite link | Auth (for pipeline ownership) | Low |
| Agentic role discovery | Claude API access + Lambda impl | Medium |
| Voice interview | WebRTC + transcription service | High |
| AI collab assessment | In-browser code execution sandbox | High |

---

## What "Done" Looks Like for MVP

A real person (not a developer) can:
1. Sign up with an email address
2. Create a pipeline for "Senior Frontend Engineer"
3. Get a shareable link
4. Send that link to 3 friends
5. Each friend completes a 30-minute code review
6. The recruiter logs in and sees 3 candidates ranked by score

That is the MVP. Everything else is Later.
