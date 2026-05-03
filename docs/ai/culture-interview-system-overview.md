# The PIPE Culture Interview System: A Technical & Philosophical Deep Dive

> **Document type:** Canonical system overview  
> **Last updated:** 2026-05-02  
> **Scope:** Covers the entire candidate-facing behavioral/culture interview pipeline — from the research that shaped it, through the code that runs it, to the legal architecture that governs it.  
> **Sources:** `workers/api/src/lib/culture*.ts` (8 files, ~3,200 LOC), `knowledge/culture/` (30+ markdown files), `knowledge/outputs/behavioral-culture-interview-agent.md` (627 lines, 48 cited sources), ADRs 029/030/031/036.

---

## Table of Contents

1. [What This System Is](#1-what-this-system-is)
2. [The Philosophical Foundation](#2-the-philosophical-foundation)
3. [The Scientific Foundation](#3-the-scientific-foundation)
4. [Technical Architecture](#4-technical-architecture)
5. [The Question Bank: Craft, Not Code](#5-the-question-bank-craft-not-code)
6. [The Scoring Pipeline](#6-the-scoring-pipeline)
7. [Compliance & Legal Architecture](#7-compliance--legal-architecture)
8. [Current State & Tuning Knobs](#8-current-state--tuning-knobs)
9. [Open Questions & Future Work](#9-open-questions--future-work)

---

## 1. What This System Is

The PIPE Culture Interview is an AI-conducted, structured behavioral interview given to engineering candidates. It asks past-behavior questions in STAR format (Situation, Task, Action, Result), probes thin answers, and produces a multi-dimensional BARS-scored report for recruiter review.

It is **not**:
- A "culture fit" score that auto-rejects candidates
- A personality test (no Big Five, no OCEAN)
- A video analysis tool (text-only, no facial/audio features)
- A chatbot that makes small talk

It **is**:
- A structured interview instrument implemented as software
- A defensible, evidence-grounded assessment with human-in-the-loop final decisions
- A "culture add" profiler that shows where a candidate differs from the team
- The product of ~100 years of industrial-organizational psychology research

### Two Modes of Operation

| Mode | Purpose | Question Source |
|------|---------|-----------------|
| **Profile Builder** (Mode-1) | Screen candidates early, build a behavioral profile | Static 15-question bank |
| **Role Fit** (Mode-2) | Deep-dive candidates matched to a specific role | Generative planner personalized to RCD + candidate background |

Mode-1 is the default. Mode-2 requires a completed Role Context Document (RCD) from the recruiter interview and enriches questions with team-specific probes.

---

## 2. The Philosophical Foundation

### 2.1 Why Behavioral Interviewing?

The research consensus is unambiguous: **structured behavioral interviews are the most valid, least biased, and most defensible interview method available.**

Meta-analyses across 100+ years show:
- Structured behavioral interviews: corrected validity ρ = .44–.64
- Unstructured interviews: ρ = .33–.38
- Combined GMA + structured interview: ρ = .76 (the highest validity combination achievable with widely-available methods)

The mechanism is fourfold:
1. **Standardization** removes idiosyncratic variance (no "I just didn't click with them")
2. **Job analysis anchoring** ensures content validity
3. **BARS scoring** reduces rater subjectivity
4. **Statistical aggregation** across multiple scored items increases signal-to-noise

### 2.2 Why STAR Format?

Two question types dominate structured interviewing: **past-behavior questions (PBQ)** — "Tell me about a time you..." — and **situational questions (SQ)** — "What would you do if...?"

The evidence (Taylor & Small 2002, 19-study meta-analysis):
- PBQ validity r = .31 consistently across all seniority levels
- SQ validity degrades from r = .29 at entry level to r = .18 at senior level

**Senior candidates articulate what they *would* do in ways that do not track what they *have* done.** STAR format forces specificity about actual past behavior, which is the only signal that generalizes to future performance.

### 2.3 Why "Culture Add," Not "Culture Fit"

Person-Organization fit predicts **retention** strongly (ρ ≈ .44) but **job performance** weakly (ρ ≈ .15). The problem is that "culture fit" assessed as gut feel is empirically indistinguishable from demographic similarity bias.

Rivera's 2012 *American Sociological Review* study of elite professional service firms found that "culture fit" assessments consistently favored candidates with similar class backgrounds, leisure activities, and social networks — not shared values.

Tholen 2024 confirmed this: formal culture fit assessments function as gatekeeping mechanisms that disadvantage applicants from less privileged backgrounds.

**PIPE's framing:** We operationalize culture as an explicit 5-dimension profile. We compare the candidate's inferred position against the team's self-declared benchmark. We highlight *where the candidate differs* and frame those differences as potential contributions — not deficits. We never ship a single aggregate "culture fit score."

### 2.4 Why AI-Conducted?

Three reasons:

1. **Consistency.** Every candidate gets the same probing discipline. Human interviewers vary wildly in follow-up quality — some probe brilliantly, others accept vague answers and move on.

2. **Scalability.** A 30-minute behavioral interview with a senior engineer costs ~$0.015 in LLM compute. The alternative is either no behavioral interview (most startups) or a human interviewer (expensive, scheduling-laggy).

3. **Auditability.** Every turn, every probe, every score is logged with verbatim evidence quotes. A human interviewer cannot produce this paper trail.

The counterargument — that AI lacks human judgment — is addressed by architecture, not apology: the AI conducts the interview, but **a human recruiter reviews every score before any decision affects the candidate.**

### 2.5 Why Text-Only?

HireVue (the largest AI interview platform, 70M+ interviews) ran facial expression analysis from 2015–2021 and discontinued it in 2021. The reason: facial expression encoding encodes racial and disability-related stereotypes. They retained speech features (pace, pauses, vocal energy) which correlate with socioeconomic background, native language, neurodivergence, and communication culture.

PIPE is text-only by design. This eliminates the audio bias vector entirely and the visual bias vector entirely. The only signal is what the candidate writes — which is exactly what a human behavioral interviewer would evaluate.

---

## 3. The Scientific Foundation

### 3.1 BARS: The Single Highest-Impact Design Choice

Behaviorally Anchored Rating Scales anchor each rating point with specific behavioral descriptions derived from job analysis. The empirical evidence:

- Taylor & Small 2002: With BARS, interrater reliability = .77 and criterion validity = .35. Without BARS: reliability = .73 and validity = .26. **~35% improvement in criterion-related validity from a single design choice.**
- When BARS are used, the difference between expert and novice raters disappears — BARS equalize rater quality.

**Every question in the PIPE bank has a 5-point BARS rubric with concrete behavioral anchors.** This is not best practice — it is the architectural difference between valid and invalid AI scoring.

### 3.2 Multi-Agent Scoring: Why One Specialist Per Dimension

Huynh et al. 2025 (Multi-Mini Interview scoring benchmark, 1,001 responses) found that asking a single LLM to simultaneously evaluate multiple soft-skill criteria causes **cross-criterion interference** — the model anchors on the most salient signal and distorts adjacent scores.

Splitting into one specialized agent per criterion, each with 3-shot calibration examples from Low/Medium/High score percentiles, achieves **QWK = 0.621** — within the range of human expert inter-rater agreement (0.55–0.65).

| Model | Avg QWK |
|-------|---------|
| Llama 4 Maverick (multi-agent) | **0.621** |
| Gemini 2.5 Pro (multi-agent) | 0.618 |
| GPT-5 | 0.432 |
| Embedding-based (SBERT) | ~0.10 |

**Critical calibration detail:** Score distributions in behavioral interviews are highly skewed (85% of responses score in the top 3 points). LLMs overestimate scores in zero-shot settings. The solution: balanced L/M/H 3-shot examples in every scoring prompt.

### 3.3 Why Not Embedding Similarity?

SBERT sentence embeddings cluster by semantic theme, not evaluative quality. "Walking toward a grieving friend" and "walking away from a grieving friend" produce nearly identical embeddings — they share semantic content (movement, grief, proximity) — but have opposite evaluative meaning under an empathy rubric.

**Do not use embedding similarity for behavioral response scoring.** PIPE uses structured JSON rubric scoring with specialist agents.

### 3.4 Optimal Interview Design Parameters

| Parameter | Recommendation | Evidence |
|-----------|---------------|----------|
| Question count | 6–12 structured STAR questions | Campion et al. 1997 |
| Duration | 30–60 minutes | Thorsteinson 2018 |
| Rating scale | 5-point fully-anchored BARS | Taylor & Small 2002 |
| Follow-up probes | Max 2 per question | Huynh et al. 2025 |
| Raters | 2–3 for maximum reliability | Conway et al. 1995 |

PIPE's current parameters: 5–15 questions, 2 max probes per question, adaptive termination (5 min, 20 max), 5-point BARS.

### 3.5 Bias: What the Evidence Shows

When properly structured, behavioral interviews produce remarkably small demographic group differences:

- **Race/ethnicity** (Levashina et al. 2014, N=121,044): d = −.01 in fully structured designs with per-question rating — essentially zero.
- **Gender** (Alonso, Moscoso & Salgado 2017, N=34,130): d = −0.16 (slightly favoring women). No adverse impact against women.

The mechanism: **per-question rating with BARS anchors** forces evaluators to assess each response against job-relevant behavioral standards rather than forming holistic impressions contaminated by appearance, demographic similarity, or first impressions.

---

## 4. Technical Architecture

### 4.1 File Map

```
workers/api/src/lib/
├── cultureAgent.ts              # FSM + ReAct loop (610 lines) — MAIN DRIVER
├── cultureAgentAdaptive.ts      # Generative planner mode (650 lines)
├── cultureAgentPrompts.ts       # System prompt + turn message builders (248 lines)
├── cultureAgentContext.ts       # Context assembler for generative mode (354 lines)
├── cultureAgentDecomposition.ts # Answer decomposition → graph nodes (248 lines)
├── cultureQuestionBank.ts       # 15-question curated bank + selector (505 lines)
├── cultureGenerativePlanner.ts  # LLM-driven question generation (314 lines)
├── cultureScorer.ts             # Multi-agent scoring pipeline (1,086 lines)
├── cultureScorerPrompts.ts      # Scoring prompt templates
├── cultureProbePatterns.ts      # Closed vocabulary of 30 probe patterns (66 lines)
├── cultureProbeBank.ts          # RCD-enriched probe loader (162 lines)
├── cultureRoleOverlay.ts        # Role-specific dimension weights (91 lines)
└── cultureRoleResolution.ts     # RCD → team context resolver

knowledge/culture/
├── README.md                    # Wiki source of truth
├── dimensions/                  # 5 competency dimension definitions
├── culture-profile/             # 5 culture-profile dimension definitions
├── questions/                   # 15 question files with full BARS rubrics
├── probes/                      # Shared STAR-slot probe library
├── probe-patterns.md            # Closed vocabulary definition
└── role-overlays/               # Role-type dimension weights
```

### 4.2 The FSM: Four States

```
[consent] → [in_progress] → [scoring] → [complete]
                 ↓
              [error]
```

- **`consent`** — Candidate must acknowledge AI disclosure before any question is shown. `consent_at` timestamp is the audit anchor.
- **`in_progress`** — The ReAct loop. Each turn: pick question → candidate answers → LLM analyzes STAR slots → decide probe/advance/terminate.
- **`scoring`** — Terminal agent state. Spawns the 11-call scoring pipeline.
- **`complete`** — Score report available, HITL review pending.

### 4.3 The ReAct Decision Loop (Per Turn)

```typescript
// cultureAgent.ts: advanceCultureInterview()

// 1. Attach candidate answer to pending turn
pendingTurn.candidateResponse = input.candidateAnswer;

// 2. Run LLM turn analysis
const llmResult = await runTurnAnalysis(provider, turnContext);
//    → Returns: star_slots, acknowledgment, probe_needed, probe_text, reasoning

// 3. Update coverage (if this was the seed turn, not a probe)
if (pendingTurn.probeOf === null) {
  const coverageDelta = scoreTurnCoverage(llmResult.star_slots);
  if (coverageDelta > 0) {
    transcript.scratchpad.dimensionCoverage[primaryDimension] += 1;
  }
}

// 4. Decide: probe, next, or terminate?
const wantsProbe = llmResult.probe_needed && probesRemaining > 0;
if (wantsProbe) {
  return { action: 'probe', probeQuestion: {...} };
}

// 5. Termination check
const termination = evaluateTermination({questionsAsked, minQuestions, maxQuestions});
if (termination) {
  return { action: 'terminate', terminationReason };
}

// 6. Pick next question from bank
const next = pickNextQuestion({coverage, askedIds, seniority, roleOverlayId, runningThemes});
return { action: 'next', nextQuestion: next };
```

### 4.4 STAR Slot Detection

The LLM returns a structured JSON object after every answer:

```json
{
  "star_slots": {
    "S": {"present": true, "specificity": 2},
    "T": {"present": true, "specificity": 1},
    "A": {"present": false, "specificity": 0},
    "R": {"present": false, "specificity": 0}
  },
  "acknowledgment": "Got it.",
  "probe_needed": true,
  "probe_text": "You said the team decided to fix it — what did you specifically do in that?",
  "reasoning": "Action slot is missing (candidate used 'we' throughout); probing for personal action before moving on."
}
```

**Probe decision rule:** Probe if ANY expected slot is missing, OR the Action slot has specificity 0, OR the Result slot has specificity 0 — AND probes-used-for-this-question < max-probes.

**Coverage scoring:** A turn counts as "adequate" when ≥3 of 4 STAR slots are present with specificity ≥1.

### 4.5 Termination Rules

```typescript
function evaluateTermination({transcript, questionsAsked, minQuestions, maxQuestions}) {
  // Hard cap: always wins
  if (questionsAsked >= maxQuestions) return 'hard_cap';

  // Coverage rule: terminate early only if ALL five dimensions
  // have at least one adequate STAR response AND we've hit the minimum
  if (questionsAsked < minQuestions) return null;
  const allCovered = COMPETENCY_DIMENSIONS.every(
    dim => (coverage[dim] ?? 0) >= 1
  );
  if (allCovered) return 'coverage_complete';

  return null;
}
```

Current parameters: `minQuestions = 5`, `maxQuestions = 15` (bank size) or `20` (hard cap in plugin config).

### 4.6 The Question Selector

`pickNextQuestion()` uses a scored selector with six signals:

1. **Coverage gap** — inverse coverage across the question's dimensions (prioritizes uncovered dimensions)
2. **Overlay weight** — role-specific dimension multipliers (e.g., manager roles weight conflict-handling at 1.4×)
3. **Theme bonus** — +0.3 if the question's `probe_patterns` intersect the agent's `runningThemes`
4. **BARS fitness bonus** — (bars_fitness − 3) × 0.1
5. **Tag preference** — ±0.2 if tags overlap overlay's preferred/deprioritized lists
6. **Enrichment bonus** — +0.05 per RCD-enriched probe on the question's dimensions (capped at +0.25)

The selector NEVER disqualifies a question based on overlay — overlays only boost/deprioritize. Seniority and discipline filters are hard gates.

### 4.7 Transcript Storage

One row per interview in `culture_interview_sessions`, transcript stored as JSON:

```typescript
interface CultureTranscript {
  turns: CultureTurn[];
  scratchpad: {
    dimensionCoverage: Record<CompetencyDimension, number>;
    probesUsedForCurrentQ: number;
    runningThemes: string[];        // closed vocabulary, max 5
    mode: 'profile_builder' | 'role_fit';
    questionMetadata: QuestionMetadata[];  // for generative questions
  };
}

interface CultureTurn {
  idx: number;
  questionId: string;
  questionText: string;
  probeOf: string | null;           // null = seed question, string = probe
  candidateResponse: string | null; // null = pending
  starSlots: Record<StarSlot, {present: boolean; specificity: number}> | null;
  timestamp: string;
}
```

One row per interview, not one row per turn. The JSON-transcript pattern is proven in `review_sessions`.

### 4.8 The Generative Planner (Mode-2)

When `mode = 'role_fit'` and `useStaticFallback = false`, the adaptive path:

1. Builds a `GenerativePlannerContext` from:
   - Candidate background (experiences, projects, skills from `candidate_ingestion`)
   - Prior screening summary (if a Mode-1 screening exists)
   - Role context from RCD (team stories, conflicts, dealbreakers, culture profile, BARS overrides)
   - Current coverage and running themes

2. Calls `runGenerativeTurnPlanner()` which sends a single LLM prompt producing:
   - `question` — the exact text the candidate sees
   - `targetDimension` — which competency dimension this targets
   - `targetSlots` — expected STAR slots
   - `probeStrategy` — probe templates for missing slots
   - `personalizationAnchors` — audit trail of which candidate/RCD details were used
   - `reasoning` — why this question was chosen

3. Falls back to static bank if the generative planner returns null (parse failure, no provider, etc.)

**Critical constraint:** The generative planner does NOT generate BARS rubrics. It generates questions that are then scored against the static BARS rubrics. This preserves auditability — the rubric is constant across candidates.

### 4.9 Answer Decomposition

After each candidate answer, an optional decomposition pass extracts:
- **CulturalSignal nodes** — dimension, evidence quote, score estimate (1-5), confidence (0-1)
- **New Experiences** — company, role, narrative
- **New Projects** — name, narrative

These are designed for insertion into a future `candidate_nodes` graph table. Currently the decomposition runs but writes only to logs — the graph table does not exist yet.

---

## 5. The Question Bank: Craft, Not Code

### 5.1 The 15-Question Curated Bank

Every scorable question is hand-authored. There is no generative question factory. The bank is:

| Dimension | Count | Question IDs |
|-----------|-------|-------------|
| Ownership | 3 | ownership-001, 002, 003 |
| Collaboration | 3 | collaboration-001, 002, 003 |
| Learning Orientation | 3 | learning-orientation-001, 002, 003 |
| Conflict Handling | 3 | conflict-handling-001, 002, 003 |
| Self-Awareness | 3 | self-awareness-001, 002, 003 |

**History:** Commit `5cec8ff` added a 1,015-node Exponent-sourced layer generated from an aborted scrape + Haiku tagging pass. It was removed because the Exponent questions had no BARS rubrics and could surface to candidates through the selector — producing transcript turns the scorer cannot grade. The selector now runs over the curated bank only.

### 5.2 What Each Question File Contains

Every question file in `knowledge/culture/questions/{dimension}/` follows a strict template:

```markdown
---
id: ownership-001
dimensions: [ownership, learning-orientation]
seniority: [mid, senior, lead]
allow_followups: true
expected_star_slots: [S, T, A, R]
estimated_response_time_seconds: 180
tags: [unowned-work, initiative]
---

## Question
Tell me about a time you saw a problem at work that wasn't yours to fix...

## Why we ask this
Ownership is the hardest dimension to fake...

## BARS rubric
- **5** — Names a specific unowned problem outside their formal scope...
- **4** — Names a specific problem and clear actions...
- **3** — Names a problem and describes actions...
- **2** — Describes a problem in general terms...
- **1** — Cannot produce an example...

## Calibration examples
### Low (1-2)
> "There was this bug nobody was looking at..."
### Medium (3)
> "We had a deployment issue that kept coming up..."
### High (4-5)
> "Our on-call docs were out of date and the oncall engineer kept paging..."

## Probe library
- missing Action: "What did you specifically do..."
- vague outcome: "How did you know it worked?"
```

**Rule:** No question ships without calibration. A question without L/M/H examples cannot be scored.

### 5.3 Probe Design Philosophy

Each question has a bespoke probe library (5-8 probes) keyed by deficiency type:

| Deficiency Key | When to Use |
|----------------|-------------|
| `missing_S` | Candidate skips situation context |
| `missing_T` | Candidate skips their specific responsibility |
| `missing_A` | Candidate uses "we" throughout, no personal action |
| `missing_R` | Candidate skips outcome or it's vague |
| `vague_outcome` | Outcome lacks specificity or measurability |
| `passive_voice` | "Things got better" — no agency |
| `unclear_scope` | Unclear whether this was their responsibility |
| `cliche_or_generic` | "I always try to help the team" — no specificity |

The agent passes these as hints to the LLM, which adapts them to the candidate's actual words. The LLM must NEVER paste them verbatim.

### 5.4 The 30 Probe Patterns (Closed Vocabulary)

The agent emits one probe pattern per turn into `runningThemes`. The selector intersects them against question `probe_patterns` for a theme-resonance bonus. The list is intentionally small (~30 tags) and stable.

Examples:
- `unowned-work` — engages with problems outside formal scope
- `technical-disagreement` — argued a technical position productively
- `changed-my-mind` — updated a strongly-held view based on new evidence
- `pattern-in-failures` — recognized a recurring failure mode in themselves
- `cultural-add` — brings a perspective the team doesn't already have

**Rule:** Free-text strings are silently discarded. The intersection with `probe_patterns` becomes empty, and the theme bonus is lost.

---

## 6. The Scoring Pipeline

### 6.1 Pipeline Overview

Called once when the interview terminates. Fires **11 LLM calls**:

```
Stage 1 — Competency Specialists (5 calls in parallel)
  ├─ Ownership scorer
  ├─ Collaboration scorer
  ├─ Learning Orientation scorer
  ├─ Conflict Handling scorer
  └─ Self-Awareness scorer

Stage 2 — Culture Profile Specialists (5 calls in parallel)
  ├─ Autonomy scorer
  ├─ Risk Tolerance scorer
  ├─ Work Pace scorer
  ├─ Collaboration Style scorer
  └─ Feedback Orientation scorer

Stage 3 — Synthesis (1 call, sequential)
  └─ Narrative + recommendation
```

Total cost: ~$0.005 per interview. Wall clock: ~30 seconds (parallel stages).

### 6.2 Why One Specialist Per Dimension

Research §2.2: Asking a single LLM to score all dimensions simultaneously causes cross-criterion interference. One focused prompt per criterion, each with balanced 3-shot calibration examples, achieves QWK ≈ 0.62 — matching human expert agreement.

### 6.3 BARS Rubric Table (Inline Constants)

The scorer carries inline BARS rubrics for all 5 competency dimensions. Example for Ownership:

| Level | Anchor |
|-------|--------|
| 1 | No specific example, or describes team effort with no personal role. Uses "we" throughout. |
| 2 | Real example but personal contribution is peripheral or reactive — noticed a problem but waited to be assigned. |
| 3 | Stepped in voluntarily, clear personal actions in first person. Outcome mentioned but generic. Reflection absent. |
| 4 | Beyond assigned scope, specific actions with named tools/people/decisions. Concrete measurable outcome. Some learning evidence. |
| 5 | Multiple-turn evidence of unassigned responsibility at meaningful scope. Granular personal actions causally linked to quantified outcome. Explicit reflection AND downstream change to prevent recurrence. |

Each rubric level is accompanied by 3 calibration quotes (Low/Medium/High) drawn from plausible candidate answer patterns.

### 6.4 Culture Profile Position Descriptors

Five 1-5 sliders, neither extreme inherently better:

| Dimension | 1 (Low) | 5 (High) |
|-----------|---------|----------|
| Autonomy | Needs structure, frequent check-ins | Self-directed, defines own scope |
| Risk Tolerance | Cautious, thorough testing, staged rollouts | Ship-first, learn-in-public, reversible mistakes OK |
| Work Pace | Steady, deep focus blocks, sustainable | Fast, reactive, multi-context switching |
| Collaboration Style | Solo deep work, async communication | Pairing, real-time sync, high interrupt tolerance |
| Feedback Orientation | Diplomatic, private, structured reviews | Direct, public, continuous |

### 6.5 Dealbreaker Flags

The scorer checks candidate answers against RCD-defined dealbreaker patterns. **Never auto-fails.** A matched dealbreaker raises a flag that blocks candidate advancement until a human recruiter reviews it.

Each dealbreaker carries:
- `pattern` — what to look for
- `jobRelatednessNote` — pre-populated Griggs business-necessity defense
- `jobRelatednessStrength` — strong / moderate / weak
- `matchedQuote` — verbatim transcript evidence

**Legal basis:** Griggs v. Duke Power, EEOC v. iTutorGroup ($365K settlement), EU AI Act Art 14. Auto-fail is legally indefensible.

### 6.6 Score Report Shape

```typescript
interface CultureScoreReport {
  competencyScores: CompetencyScoreResult[];     // 5 scores, 1-5, with evidence quotes
  profileScores: CultureProfileScoreResult[];    // 5 positions, 1-5, with evidence quotes
  dealbreakerFlags: DealbreakerFlag[];           // HITL-gated
  hitlReviewRequired: boolean;
  synthesis: {
    headline: string;
    narrative: string;
    recommendation: 'HIRE' | 'FLAG_FOR_REVIEW' | 'PASS';
  };
  orgBenchmark: OrgCultureBenchmark;
  scoredAt: string;
}
```

Every dimension score MUST include evidence quotes. Ungrounded scores fail validation and trigger re-prompt.

---

## 7. Compliance & Legal Architecture

### 7.1 Three Binding Regimes

| Regime | Effective | Key Obligation |
|--------|-----------|---------------|
| Illinois HB 3773 | Jan 1, 2026 | Disclosure + consent + records retention |
| EU AI Act Art 14 | Aug 2, 2026 | Human oversight + override + explanation |
| EEOC Guidance | Active | Employer liability for vendor-caused disparate impact |

### 7.2 Three Architectural Gates

**1. Consent Gate**
- Interview cannot start until candidate acknowledges AI disclosure
- Disclosure includes: what AI measures, what it does NOT measure, human review promise, deletion rights
- `consent_at` timestamp is the audit anchor
- D1 trigger (conceptual) rejects any turn write when `consent_at` is NULL

**2. HITL Gate**
- Score stays `pending_review` until recruiter acts
- Recruiter must: read report, scroll past evidence quotes, click Confirm / Override / Flag
- Override requires text reason (saved for audit)
- No time-based auto-confirm — scores remain pending indefinitely if recruiter doesn't review

**3. Deletion Path**
- Candidate can request transcript deletion at any time
- Hard deletion: transcript overwritten, score_report nulled, candidate_id anonymized
- Audit log and consent_at retained for compliance (no PII)
- 30-day SLA for recruiter fulfillment

### 7.3 Audit Log

Append-only table `culture_compliance_audit` with event types:
- `consent_shown`, `consent_given`, `consent_declined`
- `interview_started`, `interview_completed`, `scoring_complete`
- `review_confirmed`, `review_overridden`, `review_flagged`
- `deletion_requested`, `deletion_fulfilled`

Retained for 7 years per EEOC recordkeeping requirements.

### 7.4 Auto-Fail is Legally Indefensible

Four legal authorities make this unambiguous:

1. **Griggs v. Duke Power (1971)** — disparate impact doctrine; neutral practices with discriminatory effect violate Title VII
2. **EEOC v. iTutorGroup (2023)** — $365K settlement; software automatically rejecting protected classes is discriminatory intent regardless of "automation"
3. **Mobley v. Workday (2025)** — conditionally certified nationwide ADEA class action; AI vendors may be directly liable as employer "agents"
4. **EU AI Act Art 14** — "no AI tool should make final placement, rejection, or evaluation decisions without a qualified human in the loop"

**PIPE's rule:** Every rejection path goes through HITL. The AI flags; the human decides.

---

## 8. Current State & Tuning Knobs

### 8.1 Hardcoded Values

| Parameter | Value | File | Tunable? |
|-----------|-------|------|----------|
| Questions per domain (domain-driven) | 4 | `domainOrchestrator.ts` | No |
| Max follow-ups per domain | 2 | `domainOrchestrator.ts` | No |
| Culture max questions | 15 (bank size) | `cultureAgentAdaptive.ts` | No |
| Culture min questions | 5 | `cultureAgentAdaptive.ts` | No |
| Max probes per question | 2 | `cultureQuestionBank.ts` | No |
| Hard cap (plugin) | 20 | `culture/plugin.ts` | No |
| Rich answer threshold | >120 chars + spec ≥ 2 | `answerEvaluator.ts` | No |
| Moderate answer threshold | >60 chars or spec ≥ 1 | `answerEvaluator.ts` | No |

**There are zero runtime tuning knobs.** Every parameter is a compiled constant.

### 8.2 What Would Need to Change for Tuning

To run A/B tests (e.g., "brutal vs warm" interview styles), you would need:

1. **Extract constants into a config object** (e.g., `INTERVIEW_CONFIG`)
2. **Add environment variable overrides** (e.g., `CULTURE_MAX_QUESTIONS=20`)
3. **Add `interviewStyle` to assessment creation** — 'warm' | 'standard' | 'brutal'
4. **Alternative prompt templates** for aggressive vs conversational tone
5. **Per-assessment config persistence** in DB

### 8.3 Current Calibration Status

- **Backend tests:** 167/167 pass
- **Frontend build:** Successful
- **QWK calibration:** Not yet run. Target ≥ 0.55 (ADR-029) or ≥ 0.60 (research brief). Requires hand-scoring 10 transcripts.
- **Scorer model:** Gemma 4 26B on Workers AI (provisional default pending calibration)

### 8.4 Known Issues

1. **Resume path broken** — `hydrateInterviewing` and `reconstructInterviewStateFromDb` still use old phase/budget logic
2. **No tuning system** — All parameters hardcoded
3. **QWK calibration not run** — Cannot validate scorer accuracy against human ratings
4. **Candidate_nodes table missing** — Answer decomposition writes to logs only

---

## 9. Open Questions & Future Work

### 9.1 From ADR-033 (Research Integration Gaps)

| ID | Gap | Status |
|----|-----|--------|
| BC-6 | Belief-state tracking with PBA judge | Not started |
| BC-7 | Per-turn belief updates (not just end-of-session scoring) | Not started |
| BC-11 | Probe generator with 5 explicit trigger types | Partial (static probes only) |
| BC-15 | Belief-state delta as evasion detector | Not started |
| BC-16 | Reality Monitoring fabrication detection | Not started |
| BC-17 | Cognitive-load unexpected follow-ups | Not started |
| BC-18 | Rolling compaction + pinned exchanges | Not started |
| OQ-2 | QWK target: tighten from ≥0.55 to ≥0.60 | Pending calibration run |

### 9.2 From the Research Brief

1. **No published STAR-format benchmark exists** — The QWK = 0.62 result is on MMI/healthcare format. STAR-format validation requires PIPE-specific calibration.

2. **Belief-state architecture** — The "Beyond the Resumé" system (arXiv 2603.01775) maintains a posterior distribution over each dimension and updates it per turn. PIPE currently scores only at session end.

3. **Evasion detection** — Information-theoretic: a response that fails to update any dimension's belief state (low delta across all dimensions) is evasion regardless of fluency.

4. **Voice support** — Whisper large-v3-turbo is wired but the voice path is not production-tested.

### 9.3 From ADR-036 (RCD Integration)

- **Phase 2** — Culture consumer rewrite: wire RCD `team_culture_profile`, `bars_overrides`, and `probe_bank_enrichment` into the FSM
- **BARS override generation** — Role-setup-time override generation (Sonnet offline, recruiter-approved)
- **Probe bank enrichment** — Role-setup-time team-specific probe generation

---

## Appendix A: The Five Competency Dimensions

### Ownership
**What we measure:** The degree to which the candidate takes personal responsibility for outcomes — including outcomes they did not cause, outcomes that are ambiguous, and outcomes outside their formal scope.

**Strong signal:** Treats unowned problems as their problem, stays with a problem past the point they could plausibly hand it off, accepts blame when things go wrong even when blame would be easy to deflect.

**Weak signal:** Waiting for assignment, stopping at the edge of job description, blaming process or others when things fail, describing past work only in passive voice.

### Collaboration
**What we measure:** The candidate's ability to work productively with other people — across roles, disagreement, and organizational distance.

**Strong signal:** Making others more effective, creating shared understanding where it didn't exist, handling disagreement without damaging the relationship, knowing when to pair vs. work solo.

**Weak signal:** Working around people instead of with them, escalating conflicts instead of addressing them, treating communication as overhead, describing colleagues as obstacles.

### Learning Orientation
**What we measure:** How the candidate responds to not knowing something.

**Strong signal:** Admitting ignorance quickly, naming specific gaps, describing concrete learning actions with outcomes, showing that recent work has changed their mental model of something.

**Weak signal:** Performing expertise, describing learning as a passive byproduct of doing the job, inability to name anything they were wrong about recently, framing "I don't know" as a threat.

### Conflict Handling
**What we measure:** How the candidate navigates disagreement, friction, and hard conversations.

**Strong signal:** Engaging with disagreement directly and early, separating the person from the problem, changing position when persuaded, repairing relationships after conflict.

**Weak signal:** Avoidance, passive aggression, immediate escalation, holding grudges, framing every disagreement as a personal attack.

### Self-Awareness
**What we measure:** The candidate's ability to see themselves accurately — strengths, weaknesses, and blind spots.

**Strong signal:** Naming real weaknesses without softening, describing how their style affects others, recognizing patterns across multiple past situations, distinguishing "what I did" from "what I wish I had done."

**Weak signal:** Weaknesses that are secretly strengths ("I work too hard"), inability to describe their impact on others, no evidence of pattern recognition, treating all past decisions as obviously correct.

---

## Appendix B: Key Citations

| Citation | Finding | Where Used |
|----------|---------|------------|
| McDaniel et al. 1994 | Structured interviews ρ = .44 vs unstructured ρ = .33 | Architecture justification |
| Schmidt & Hunter 1998 | GMA + structured interview = ρ = .63 | Validity target |
| Taylor & Small 2002 | BARS improves validity ~35%; PBQ > SQ at senior levels | Question format, scoring rubric |
| Huynh et al. 2025 | Multi-agent scoring QWK = 0.621 | Scoring pipeline architecture |
| Kristof-Brown et al. 2005 | P-O fit ρ = .44 retention, ρ = .15 performance | Culture profile framing |
| Rivera 2012 | "Culture fit" = demographic similarity bias | "Culture add" framing |
| Levashina et al. 2014 | Structured interviews show d = −.01 race difference | Bias mitigation |
| Campion et al. 1997 | 15 validated structure components | Interview design |
| Conway & Huffcutt 1997 | Supervisor-peer correlation ρ = .34 (89% source-unique) | Multi-stakeholder architecture |
| Griggs v. Duke Power 1971 | Disparate impact doctrine | Dealbreaker HITL gate |
| EEOC v. iTutorGroup 2023 | $365K settlement for auto-fail AI | Auto-fail prohibition |
| EU AI Act 2024/1689 | High-risk AI, human oversight required | Compliance architecture |

---

*This document is a living artifact. When the culture interview system changes, this document must be updated to match.*
