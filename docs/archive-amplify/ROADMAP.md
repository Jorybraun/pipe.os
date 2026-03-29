# Pipe — Product Roadmap
**Last Updated:** 2026-02-26
**Status:** Active
**Vision:** The AI-Guided Command Center for Tailored Technical Hiring.

---

## The Core USP
Pipe OS eliminates the friction of generic technical hiring. We use **conversational discovery** to build role-specific interview pipelines (Algorithm, Quiz, Code Review) and provide **automated skill reports**—all under one roof.

---

## Now — Milestone 1: The Automated Async Loop
**Goal:** A Recruiter can create a tailored pipeline, send an assessment link, and get a scored skill report without developer interaction.

### 1. Technical Foundations (Infrastructure)
- [x] **Auth:** Wrap `<App>` with `<Authenticator>` and wire sign-out.
- [x] **Schema:** Add core models (`Pipeline`, `Stage`, `Candidate`, `Assessment`) to Amplify.
- [ ] **Wiring:** Connect `useRoleDiscovery` hook to `generateQuestions` Lambda (In Progress).
- [ ] **Identity:** Pass auth user context to Amplify Data client for owner-based rules.

### 2. Conversational Discovery (The Intake)
- [x] 6-Phase "Next-Gen" UI Shell built.
- [x] Sidebar "Control Center" for stage toggling (Algo, Quiz, Code Review).
- [ ] Implement user persona adaptation (detecting EM vs. Recruiter logic).
- [ ] Logic to map role context to specific assessment content.

### 3. Core Assessment Pillars (Candidate Experience)
- [ ] **Algorithm Stage:** Build UI for technical problem-solving.
- [ ] **Technical Quiz:** Build UI for automated multiple-choice/short-answer validation.
- [ ] **Code Review Editor:** Build the primary assessment UI where candidates mark bugs.
- [ ] Hardcode 3 starter code snippets (JS/TS, Python) with known bugs.

### 4. Scoring & Reporting (The Signal)
- [ ] **Scoring Engine:** Logic to grade Code Reviews (Bugs found % + Severity accuracy).
- [ ] **Report Synthesis:** AI-synthesized report showing "Role Fit" and "Culture Fit" based on assessment data.
- [ ] **Dashboard:** Wire `ListingPage` and `OverviewPage` to real DynamoDB data.

---

## Next — Milestone 2: The Interview Studio
**Goal:** Enhance the "Human" side of async interviews by allowing users to record themselves asking the tailored questions.

- [ ] **In-App Recorder:** MediaDevices API integration for Camera/Mic.
- [ ] **S3 Video Pipeline:** Multipart upload for interviewer/candidate videos.
- [ ] **Draft Controller:** Enhanced sidebar to preview and re-record specific questions.

---

## Later — Milestone 3: Live Collaboration
**Goal:** Replace external tools with integrated live workspace features.

- **Integrated Live Environment:** Full peer-coding sandbox inside Pipe OS.
- **Collaboration Analysis:** Analyzing how candidates ask clarifying questions and work with peers.

---

## What "Done" Looks Like for MVP
A recruiter can:
1. Talk to the Agent to define a role.
2. Get a tailored 3-stage test (Algo, Quiz, Code Review) generated instantly.
3. Send a link to a candidate.
4. Receive an automated "Signal Report" ranking the candidate's performance.
