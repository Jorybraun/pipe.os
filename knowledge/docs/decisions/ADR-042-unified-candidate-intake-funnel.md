# ADR-042: Unified Candidate Intake Funnel — Self-Serve Profile Building

**Date:** 2026-05-01
**Status:** Accepted
**Deciders:** Founder, Backend team
**Supersedes:** `github-enrichment-intake.md` (LinkedIn and self-serve aspects)

---

## Context

The current candidate intake is **recruiter-driven**: a recruiter uploads a resume via `CandidateIntakeModal`, optionally types a GitHub handle, and the candidate is created. The candidate then receives an invite link that takes them directly to code challenges (`/assess/:token`). There is no candidate-facing profile building step.

This creates several problems:

1. **Thin seed signal**: The graph is seeded only from a single resume PDF. Candidates cannot provide LinkedIn, GitHub, portfolio links, or self-reported skills.
2. **No pre-challenge screening**: Generic screening questions (motivation, availability, experience) happen either via recruiter phone call or not at all. There is no async video screener for candidates to complete on their own time.
3. **GitHub enrichment is hidden**: The GitHub handle field is on the recruiter intake modal. Most candidates are never asked for it.
4. **Duplicate data entry**: Recruiters manually transcribe resume data; candidates never touch their own profile.
5. **Missing state machine enforcement**: `candidate_profile_state` exists but is never read to gate progress. A candidate can jump straight to code challenges with an empty graph.

The vision: a **single self-serve landing page** where the candidate uploads their resume, provides LinkedIn + GitHub, records async video answers to 3-5 generic screening questions, and only then proceeds to role-specific challenges. All data decomposes into `candidate_nodes` and feeds matching.

---

## Decision

We will build a **unified candidate-facing intake funnel** with three sequential phases, gated by `candidate_profile_state`:

```
INVITED (recruiter creates candidate)
    │
    ▼
/intake/:token  ──►  candidate_profile_state = 'enriching'
    │                    ├─ Resume upload → parse → decompose
    │                    ├─ GitHub handle → enrich → nodes
    │                    └─ LinkedIn URL → scrape → nodes
    │
    ▼
/screen/:token  ──►  candidate_profile_state = 'screening'
    │                    └─ Async video answers to generic questions
    │                       → transcribe → decompose → nodes
    │
    ▼
/assess/:token  ──►  candidate_profile_state = 'active'
                         └─ Code challenges (existing flow)
```

The `/assess/:token` route will be **gated**: if `candidate_profile_state.overall_status` is not `'active'`, the candidate is redirected to the appropriate intake or screening page.

---

## Alternatives Considered

### Option A — Extend `/assess/:token` with synthetic challenges
- **Pros:** Reuses existing `useAssessment` hook, `Assessment` row tracking, stage progression, and submission scoring infrastructure.
- **Cons:** The challenge engine is designed for *evaluated responses* (scored submissions), not *data collection*. Resume parsing and GitHub enrichment are background async jobs that don't fit the synchronous challenge-submission model.
- **Verdict:** Rejected. The challenge engine is the wrong abstraction for profile building.

### Option B — Standalone intake + screening routes (Chosen)
- **Pros:** Clean separation of concerns. Intake can poll for async enrichment completion. Screening can use `MediaRecorder` directly without fitting into `ChallengeRegistry`. State machine is explicit and auditable.
- **Cons:** More new code than Option A. Need to ensure the JWT session works across all three routes.
- **Verdict:** Accepted. The right abstraction for the problem.

### Option C — Recruiter-driven only (Status Quo)
- **Pros:** Zero new code.
- **Cons:** Doesn't solve any of the problems listed in Context.
- **Verdict:** Rejected.

---

## Rationale

The challenge engine (`useAssessment`, `ChallengeRegistry`, `get-stage-config`) is production-proven for *evaluated challenges* — code review, implementation, quizzes. It is not designed for *data collection and async enrichment*.

A standalone intake funnel is the correct architectural boundary:
- **Intake** = data collection + async enrichment (no evaluation)
- **Screening** = elicitation + decomposition (no right/wrong answers)
- **Assessment** = evaluated challenges (existing system, unchanged)

The `candidate_profile_state` table was built exactly for this purpose — to track cross-role candidate lifecycle independent of any specific assessment. Using it as the gate between phases finally realizes its intended design.

---

## Consequences

### Positive
- Candidates build their own profiles, reducing recruiter manual work.
- GitHub and LinkedIn enrichment becomes standard.
- The graph is seeded with 3x-5x more nodes per candidate before matching runs.
- Screening answers decompose into `Motivation`, `WorkingStyle`, and `CulturalSignal` nodes.
- Matching quality improves because `candidateSituationFit` receives richer signal.
- `candidate_profile_state` finally gets a consumer.

### Negative / Trade-offs
- Candidates now have a longer path to code challenges (intake + screening adds 5-15 minutes).
- Async enrichment means candidates may see a "building your profile" spinner.
- LinkedIn scraping requires a third-party service (cost + dependency).
- Video recording requires browser `MediaRecorder` API support.

### Risks
- **Drop-off rate increase**: Mitigation: track funnel analytics. If drop-off > 30%, make screening optional or shorten to 2 questions.
- **LinkedIn scraping failures**: Mitigation: make LinkedIn optional. Log failures and retry via enrichment cron.
- **Video recording privacy concerns**: Mitigation: explicit consent copy. Audio-only fallback.
- **State machine race conditions**: Mitigation: state checks are server-side on every API call.

---

## Key Sub-Decisions

### Screener vs. Culture Interview: Separate or Unified?
- **Decision:** Keep them separate. The generic screener (`/screen/:token`) is for profile building (Mode-1). The culture interview (`/culture/:token`) is for role-specific culture fit (Mode-2).
- **Rationale:** The culture interview is deeply coupled to BARS scoring, compliance audit (ADR-031), and HITL review. The generic screener is lightweight: 5 fixed questions, no scoring, just decomposition.

### LinkedIn: Required or Optional?
- **Decision:** Optional. Resume is required. GitHub is optional but strongly encouraged. LinkedIn is optional.
- **Rationale:** LinkedIn scraping has reliability issues.

### Video: Required or Optional?
- **Decision:** Required for now, with audio-only fallback.
- **Rationale:** Video conveys more signal. Monitor drop-off and adjust.

### State Machine Storage
- **Decision:** Use `candidate_profile_state` for the intake funnel gate. Keep `candidates.status` for the per-role assessment lifecycle.
- **Rationale:** `candidates.status` is single-role by design. A candidate may re-apply to a different role later.

---

## Follow-up

- **Implementation plan:** `/Users/hans/.kimi/plans/white-tiger-she-hulk-animal-man.md` — 5-phase detailed plan with subtasks, file ownership, and migration sequencing.
- **Handoff document:** `docs/handoffs/2026-05-01-unified-intake-funnel-handoff.md` — single-file comprehensive agent briefing.
- **Strategy reference:** `knowledge/plan/pipe-strategy-v2-part4-candidate-ingestion.md` — the north star document.
