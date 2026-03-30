# ADR-025: Multi-Turn Code Review — End-to-End Specification

**Date:** 2026-03-29
**Status:** Accepted
**Depends on:** [ADR-024 — Multi-Turn Agentic Code Review](ADR-024-multi-turn-agentic-code-review.md)
**Migration:** [Phase 3 — Candidate Flow](../../migration/phase-3-candidate-flow.md)

> **Source of truth:** [`research/code-review-arena/spec/system-spec.md`](../../../research/code-review-arena/spec/system-spec.md)
> This ADR records the original E2E spec. The system spec has been updated with structured comment formats, implementer move types (comment/change/pushback), per-comment scoring, and the full agent contracts. When this ADR conflicts with the system spec, the system spec wins.

---

## Context

ADR-024 established the architectural decision to move from single-turn deterministic scoring to multi-turn agentic conversation. This ADR specifies the complete end-to-end implementation: candidate user journey, DTO contracts, agent specifications, component changes, and BDD scenarios.

The existing assessment architecture is composable and well-suited for this change:

- **Blueprint system** (`resolveStageConfig.ts`) maps challenge types to layouts, panels, shells
- **InterviewContext** owns submission state and validation
- **ConnectedDiffPanel** and **ConnectedVerdictPanel** already render the diff + verdict UI
- **StageShell** already supports timer display via TimerContext
- **useAssessment** hook handles the two-call pattern (getStageConfig → getChallenge)

The primary changes are:
1. A new **conversation panel** alongside the existing diff panel
2. A new **submission lifecycle** — multiple rounds instead of single submit
3. Two new **agent endpoints** — implementer (responds to comments) and scoring panel (evaluates transcript)
4. A new **review session** entity tracking conversation state

---

## 1. Candidate User Journey

### What the candidate experiences

```
┌──────────────────────────────────────────────────────────────┐
│  1. ARRIVE                                                   │
│     Candidate clicks invite link → /assess/:token            │
│     Token resolves → welcome screen                          │
│     Timer configured per stage (if set in stage config)      │
└──────────────────┬───────────────────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────────────────────┐
│  2. VIEW THE PR                                              │
│     Left panel: feature brief + PR metadata                  │
│     Center panel: diff with file tabs (existing DiffPanel)   │
│     Right panel: conversation thread + verdict               │
│                                                              │
│     Candidate reads the brief and code before commenting     │
└──────────────────┬───────────────────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────────────────────┐
│  3. INITIAL REVIEW (Round 1)                                 │
│     Candidate clicks lines → inline annotation editor        │
│     Severity selector (critical / major / minor)             │
│     Comment textarea                                         │
│     General review summary in right panel                    │
│     Clicks "SUBMIT REVIEW" → spinner while agent responds    │
└──────────────────┬───────────────────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────────────────────┐
│  4. AUTHOR RESPONDS                                          │
│     Right panel: conversation threads appear                 │
│     Each thread: candidate comment → author response         │
│     Author may: push back, agree + fix, ask clarification    │
│     New comments badge: "2 new responses"                    │
│                                                              │
│     This looks like GitHub PR conversation threads           │
│     NOT a live chat — async review rounds                    │
└──────────────────┬───────────────────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────────────────────┐
│  5. CONVERSATION (Rounds 2-4)                                │
│     Candidate can:                                           │
│     - Reply to existing threads                              │
│     - Add new inline comments on lines                       │
│     - View updated diff if author "fixed" something          │
│     Clicks "SUBMIT RESPONSE" → spinner → author responds     │
│                                                              │
│     Candidate CAN submit verdict at any time after round 1   │
│     But notification: "Author has responded — review before  │
│     submitting verdict"                                      │
└──────────────────┬───────────────────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────────────────────┐
│  6. FINAL VERDICT                                            │
│     Candidate selects: APPROVE or REQUEST_CHANGES            │
│     Writes final summary (required vs nice-to-have)          │
│     Clicks "SUBMIT VERDICT"                                  │
│     Spinner: "Evaluating review..." (~15-30s)                │
│     Challenge complete → advance to next challenge           │
└──────────────────────────────────────────────────────────────┘
```

### Key UX decisions

- **GitHub-style, not live chat.** Rounds, not messages. Submit → wait → see responses → respond.
- **Timer is per-stage**, configured in stage settings. Rendered by existing TimerShell if `timeLimit > 0`.
- **No minimum rounds.** Candidate can submit verdict after round 1 if they're confident. But unread responses are clearly surfaced.
- **Spinner, not typing indicator.** After submit, candidate sees "Author is reviewing your comments..." spinner until agent responds.
- **File tabs unchanged.** Existing DiffPanel file tab navigation stays. Annotations are per-file, per-line as today.

---

## 2. Component Architecture Changes

### Current CODE_REVIEW blueprint

```typescript
CODE_REVIEW: () => ({
  layout: 'workspace',
  panels: { left: ['problem'], center: ['diff'], right: ['verdict'] },
  shells: [],
  initialSubmission: { annotations: [], verdict: null, summary: '' },
  isComplete: (s) => !!s.verdict && s.summary.trim().length > 0,
})
```

### New CODE_REVIEW blueprint

```typescript
CODE_REVIEW: (config) => {
  const isMultiTurn = !!config.practiceRepo; // slopify exercises have practiceRepo set

  if (isMultiTurn) {
    return {
      layout: 'workspace',
      panels: { left: ['problem'], center: ['diff'], right: ['conversation'] },
      shells: [],
      initialSubmission: {
        annotations: [],
        threads: [],           // ConversationThread[]
        currentRound: 1,
        verdict: null,
        summary: '',
        sessionId: null,       // Set after first submit creates the review session
      },
      isComplete: (s) => !!s.verdict && s.summary.trim().length > 0,
    };
  }

  // Legacy single-turn (arbitrary PRs without exercise case)
  return {
    layout: 'workspace',
    panels: { left: ['problem'], center: ['diff'], right: ['verdict'] },
    shells: [],
    initialSubmission: { annotations: [], verdict: null, summary: '' },
    isComplete: (s) => !!s.verdict && s.summary.trim().length > 0,
  };
}
```

### New panel: `conversation`

Replaces the `verdict` panel in the right column for multi-turn exercises. Contains:

1. **Conversation threads** — one per annotation, showing the back-and-forth
2. **General comment thread** — for the overall review summary discussion
3. **Round indicator** — "Round 2 of 4"
4. **Unread badge** — "3 new responses" after author responds
5. **Reply input** — textarea per thread for candidate responses
6. **Verdict section** — at the bottom, always visible. APPROVE / REQUEST_CHANGES + summary
7. **Submit button** — changes label per state:
   - Round 1: "SUBMIT REVIEW"
   - Rounds 2+: "SUBMIT RESPONSE"
   - Final: "SUBMIT VERDICT"

### Component hierarchy

```
StageShell (timer, progress bar, header)
  └─ StageRenderer
     └─ ChallengeRenderer
        └─ WorkspaceLayout
           ├─ left: ConnectedProblemPanel        ← unchanged
           ├─ center: ConnectedDiffPanel          ← minor changes (thread indicators on lines)
           └─ right: ConnectedConversationPanel   ← NEW (replaces ConnectedVerdictPanel)
```

### DiffPanel changes

Minimal. The existing DiffPanel stays as-is with two additions:

1. **Thread indicator per line** — small icon showing "3 comments" on lines with active threads
2. **Click-to-focus** — clicking a thread indicator scrolls the conversation panel to that thread
3. **Annotation creation unchanged** — severity + comment editor works the same way

### ConnectedConversationPanel (new)

```typescript
const ConnectedConversationPanel = connectInterview(ConversationPanel, (ctx) => ({
  threads: ctx.submission.threads as ConversationThread[],
  annotations: ctx.submission.annotations as Annotation[],
  currentRound: ctx.submission.currentRound as number,
  verdict: ctx.submission.verdict as string | null,
  summary: ctx.submission.summary as string,
  sessionId: ctx.submission.sessionId as string | null,
  isAwaitingResponse: ctx.submission.isAwaitingResponse as boolean,
  onReply: (threadId: string, content: string) => { ... },
  onVerdictChange: (verdict: string) => ctx.updateSubmission({ verdict }),
  onSummaryChange: (summary: string) => ctx.updateSubmission({ summary }),
  onSubmitRound: () => { ... },  // triggers agent call
  onSubmitVerdict: () => { ... }, // triggers scoring
}));
```

---

## 3. DTO Contracts

### 3.1 Review Session (D1 entity)

```typescript
interface ReviewSession {
  id: string;                      // UUID
  challengeSubmissionId: string;   // FK → challenge_submissions
  challengeId: string;             // FK → challenges
  assessmentId: string;            // FK → assessments
  implementerPersona: 'junior' | 'senior';
  currentRound: number;            // 1-4
  maxRounds: number;               // default 4
  status: 'in_progress' | 'verdict_submitted' | 'scoring' | 'scored';
  transcript: ConversationTurn[];  // full history
  scoreReport: ScoringReport | null;
  createdAt: string;               // ISO 8601
  updatedAt: string;
}
```

### 3.2 Conversation types

```typescript
/** A single turn in the conversation */
interface ConversationTurn {
  id: string;
  role: 'reviewer' | 'implementer';
  round: number;
  type: 'inline_comment' | 'reply' | 'general_comment';
  threadId: string;                // groups turns into threads
  file?: string;                   // for inline comments
  line?: number;                   // for inline comments
  severity?: 'critical' | 'major' | 'minor';  // reviewer's severity label
  content: string;
  createdAt: string;
}

/** A thread groups related turns (one per annotation location) */
interface ConversationThread {
  id: string;
  file?: string;
  line?: number;
  turns: ConversationTurn[];
  status: 'open' | 'resolved';    // resolved = both parties agree
}
```

### 3.3 Candidate → Server: Submit initial review

```
POST /rpc/review/submit
Authorization: Bearer <session-jwt>
```

```typescript
/** Request */
interface SubmitReviewRequest {
  challengeId: string;
  assessmentId: string;
  annotations: Array<{
    file: string;
    line: number;
    severity: 'critical' | 'major' | 'minor';
    comment: string;
  }>;
  summary: string;                 // general review comment
}

/** Response */
interface SubmitReviewResponse {
  sessionId: string;               // new review session created
  round: number;                   // 1
  threads: ConversationThread[];   // each annotation → thread with implementer reply
  status: 'in_progress';
}
```

### 3.4 Candidate → Server: Submit response (rounds 2+)

```
POST /rpc/review/:sessionId/respond
Authorization: Bearer <session-jwt>
```

```typescript
/** Request */
interface SubmitResponseRequest {
  replies: Array<{
    threadId: string;
    content: string;
  }>;
  newAnnotations?: Array<{         // candidate can add new comments in later rounds
    file: string;
    line: number;
    severity: 'critical' | 'major' | 'minor';
    comment: string;
  }>;
}

/** Response */
interface SubmitResponseResponse {
  round: number;                   // incremented
  threads: ConversationThread[];   // updated threads with new implementer replies
  status: 'in_progress';
}
```

### 3.5 Candidate → Server: Submit verdict

```
POST /rpc/review/:sessionId/verdict
Authorization: Bearer <session-jwt>
```

```typescript
/** Request */
interface SubmitVerdictRequest {
  verdict: 'approve' | 'request_changes';
  summary: string;                 // what's required vs nice-to-have
}

/** Response — immediate */
interface SubmitVerdictResponse {
  status: 'scoring';               // scoring panel has been triggered
}
```

### 3.6 Poll for scoring completion

```
GET /rpc/review/:sessionId/status
Authorization: Bearer <session-jwt>
```

```typescript
/** Response */
interface ReviewStatusResponse {
  status: 'in_progress' | 'scoring' | 'scored';
  scoreReport?: {
    overall: { score: number; band: 'strong' | 'adequate' | 'weak' };
  };
  // Full score report only visible to recruiter, not candidate
}
```

---

## 4. Agent Specifications

### 4.1 Implementer Agent

**Purpose:** Role-plays the PR author, responding to candidate review comments.

**Invocation:** Called by the Worker after each candidate submission (rounds 1-4).

**Input:**

```typescript
interface ImplementerAgentInput {
  /** The PR the "author" wrote */
  pr: {
    brief: string;               // feature description
    diff: string;                // unified diff
    commitMessages: string[];
  };

  /** Persona prompt (from prompts/implementer/junior.txt or senior.txt) */
  persona: string;

  /** Full conversation so far (all rounds) */
  transcript: ConversationTurn[];

  /** Current round's new comments from the reviewer */
  newComments: Array<{
    threadId: string;
    file?: string;
    line?: number;
    content: string;
  }>;
}
```

**Output:**

```typescript
interface ImplementerAgentOutput {
  responses: Array<{
    threadId: string;            // which thread this reply belongs to
    content: string;             // the author's response
    action: 'agree_fix' | 'pushback' | 'clarify' | 'partial_agree';
  }>;
}
```

**System prompt structure:**

```
{persona prompt}

---

THE PR YOU WROTE:
Brief: {brief}
Diff: {diff}

---

CONVERSATION SO FAR:
{formatted transcript}

---

THE REVIEWER'S NEW COMMENTS:
{new comments}

---

Respond to each comment. Return JSON matching the output schema.
```

**Key behaviors:**
- Reads ALL comments before responding (batch, not one at a time)
- Has NO knowledge of planted bugs — believes this is real work
- Persona drives behavior: junior is receptive/nervous, senior pushes back with reasoning
- Tone adapts to reviewer's tone (harsh reviewer → junior gets quiet, senior gets firm)
- Responses are natural — casual but professional, like real PR conversations

**Model:** Claude Sonnet (fast, capable enough for conversation)

**Latency budget:** <10s per round

### 4.2 Communication Analyst (Scorer)

**Purpose:** Evaluates how the reviewer communicates.

**Sees:** Full transcript. Does NOT see ground truth.

**Evaluates:**

| Sub-dimension | Description |
|---------------|-------------|
| Tone & Empathy | Comments on code not person, constructive framing, acknowledges good work |
| Clarity & Precision | Clear what/why, specific lines and scenarios, no vague "could cause issues" |
| Pushback Handling | Explains with evidence, concedes gracefully, picks battles |
| Guidance Quality | Actionable suggestions, labels severity, helps implementer learn |

**Output:**

```typescript
interface CommunicationReport {
  score: number;                   // 0-100
  tone: { score: number; evidence: string[]; flags: string[] };
  clarity: { score: number; evidence: string[]; flags: string[] };
  pushbackHandling: { score: number; evidence: string[]; flags: string[] };
  guidanceQuality: { score: number; evidence: string[]; flags: string[] };
  summary: string;                 // 2-3 sentences
}
```

### 4.3 Technical Evaluator (Scorer)

**Purpose:** Evaluates what the reviewer found and whether their analysis is correct.

**Sees:** Full transcript + ground truth (planted bugs + design trade-offs). Only panelist with ground truth access.

**Evaluates:**

| Sub-dimension | Description |
|---------------|-------------|
| Bug Detection | Semantic matching against planted bugs, weighted by severity |
| Severity Calibration | Critical labeled critical? Nits labeled nits? |
| Trade-off Awareness | Noticed design trade-offs? Suggested alternatives with reasoning? |
| Technical Accuracy | Claims correct? Understands frameworks? No misidentification? |

**Output:**

```typescript
interface TechnicalReport {
  score: number;                   // 0-100
  bugDetection: {
    score: number;
    found: Array<{ bugId: number; annotationQuote: string; severityCorrect: boolean; explanationQuality: 'strong' | 'adequate' | 'weak' }>;
    missed: Array<{ bugId: number; description: string; severity: string }>;
    falsePositives: string[];
    bonusFindings: string[];
  };
  severityCalibration: { score: number; miscalibrations: string[] };
  tradeoffAwareness: { score: number; identified: string[]; missed: string[]; reasoning: string };
  technicalAccuracy: { score: number; errors: string[]; strengths: string[] };
  summary: string;
}
```

### 4.4 Review Practice Evaluator (Scorer)

**Purpose:** Evaluates whether the reviewer follows good code review practices.

**Sees:** Full transcript. Does NOT see ground truth.

**Evaluates:**

| Sub-dimension | Description |
|---------------|-------------|
| Understanding First | Read the brief? Early comments show intent understanding? |
| Prioritization | Most important issues first? Blockers vs suggestions vs nits labeled? |
| Completeness & Scope | Whole change or just one file? Correctness + design + security + UX? |
| Positive Recognition | Acknowledged good decisions? Not all negative? |
| Driving to Conclusion | Clear summary? Clear verdict with reasoning? Drives resolution? |

**Output:**

```typescript
interface ReviewPracticeReport {
  score: number;                   // 0-100
  understanding: { score: number; evidence: string[] };
  prioritization: { score: number; evidence: string[] };
  completeness: { score: number; coveredAreas: string[]; missedAreas: string[] };
  positiveRecognition: { score: number; examples: string[] };
  drivingToConclusion: { score: number; evidence: string[] };
  summary: string;
}
```

### 4.5 Synthesizer

**Purpose:** Combines three panel reports into final assessment.

**Input:** All three panel reports.

**Does NOT re-analyze the transcript.** Aggregation only.

**Output:**

```typescript
interface ScoringReport {
  overall: {
    score: number;                 // 0-100 (25% comms + 40% tech + 35% practice)
    band: 'strong' | 'adequate' | 'weak';
    narrative: string;             // 3-5 sentences for hiring manager
  };
  communication: CommunicationReport;
  technical: TechnicalReport;
  reviewPractice: ReviewPracticeReport;
  meta: {
    panelVersion: string;
    model: string;
    timestamp: string;
    transcriptTurns: number;
    rounds: number;
  };
}
```

**Band thresholds:**

| Band | Score | Meaning |
|------|-------|---------|
| Strong | 75-100 | Would trust to review production code independently |
| Adequate | 45-74 | Solid foundation, needs mentoring on some dimensions |
| Weak | 0-44 | Not ready for independent code review |

**Model:** Claude Haiku (aggregation only, no deep analysis)

### Agent execution flow

```
Candidate submits round
        │
        ▼
  ┌─────────────────┐
  │  Worker receives │
  │  POST /rpc/...   │
  └────────┬────────┘
           │
           ▼
  ┌─────────────────┐        ┌──────────────────┐
  │  Append to       │───────►│  Implementer     │
  │  transcript      │        │  Agent (Sonnet)   │
  │  in D1           │        │  ~5-10s           │
  └─────────────────┘        └────────┬─────────┘
                                      │
                              responses JSON
                                      │
                                      ▼
                             ┌──────────────────┐
                             │  Append responses │
                             │  to transcript    │
                             │  Return to client │
                             └──────────────────┘

Candidate submits verdict
        │
        ▼
  ┌─────────────────┐
  │  Finalize        │
  │  transcript      │
  └────────┬────────┘
           │
           ▼  (parallel)
  ┌────────┼────────┐
  │        │        │
  ▼        ▼        ▼
┌─────┐ ┌─────┐ ┌─────┐
│Comms│ │Tech │ │Prac │       (~10-15s each, parallel)
│     │ │     │ │     │
└──┬──┘ └──┬──┘ └──┬──┘
   │       │       │
   └───────┼───────┘
           ▼
    ┌────────────┐
    │ Synthesizer│              (~3-5s)
    └─────┬──────┘
          │
          ▼
    Store ScoringReport
    in review_sessions
    Update status → 'scored'
```

---

## 5. BDD Scenarios

### 5.1 Timer renders when configured

```gherkin
Feature: Stage timer for CODE_REVIEW

  Scenario: Timer renders when stage has timeLimit
    Given a stage exists with timeLimit 45 (minutes)
    And the stage has a CODE_REVIEW challenge
    When the candidate begins the assessment
    Then the TimerShell wraps the stage content
    And the StageShell header displays "45:00" countdown
    And the timer ticks down every second

  Scenario: Timer does not render when stage has no timeLimit
    Given a stage exists with timeLimit null
    And the stage has a CODE_REVIEW challenge
    When the candidate begins the assessment
    Then no timer is displayed in the StageShell header

  Scenario: Timer warning and critical states
    Given the timer has 89 seconds remaining
    Then the timer text turns yellow (warning)
    When the timer reaches 29 seconds
    Then the timer text turns red (critical)

  Scenario: Timer expires during code review
    Given the timer reaches 0
    Then the candidate's current submission is auto-submitted
    And the review session is finalized with current transcript
    And the scoring panel is triggered
    And the candidate advances to the next challenge
```

### 5.2 Multi-turn conversation flow

```gherkin
Feature: Multi-turn code review conversation

  Scenario: Candidate views a slopify CODE_REVIEW challenge
    Given the candidate has a valid session token
    And the current challenge is type CODE_REVIEW with practiceRepo "pipe-hq/slopify"
    When the challenge loads
    Then the WorkspaceLayout renders with 3 columns:
      | slot   | panel        |
      | left   | problem      |
      | center | diff         |
      | right  | conversation |
    And the problem panel shows the feature brief and PR metadata
    And the diff panel shows the PR diff with file tabs
    And the conversation panel shows "Leave your review" with empty state

  Scenario: Candidate leaves initial inline annotation
    Given the candidate is viewing the diff
    When the candidate clicks on line 42 of "src/pages/Search.tsx"
    Then the annotation editor appears at line 42
    And the candidate selects severity "major"
    And the candidate types "This useState will cause a re-render on every keystroke"
    When the candidate clicks SAVE
    Then the annotation appears as a badge on line 42
    And a new thread appears in the conversation panel:
      | role     | content                                                      |
      | reviewer | [major] This useState will cause a re-render on every keystroke |

  Scenario: Candidate submits initial review (round 1)
    Given the candidate has added 3 annotations across 2 files
    And the candidate has written a general review summary
    When the candidate clicks "SUBMIT REVIEW"
    Then a POST /rpc/review/submit is sent with annotations + summary
    And the conversation panel shows a spinner: "Author is reviewing your comments..."
    And the submit button is disabled
    When the implementer agent responds (~5-10s)
    Then each thread updates with the author's response:
      | thread | author action | example                                           |
      | 1      | pushback      | "I considered that, but debounce would delay..." |
      | 2      | agree_fix     | "Good catch, fixing now."                         |
      | 3      | clarify       | "Can you elaborate on the security concern?"      |
    And a badge appears: "3 new responses"
    And the round indicator shows "Round 2 of 4"

  Scenario: Candidate responds to author pushback (round 2)
    Given the candidate has received author responses from round 1
    And thread 1 shows author pushback
    When the candidate clicks "Reply" on thread 1
    And types "The debounce delay is acceptable — without it, you're firing a network request per keystroke which will hammer the API"
    And the candidate clicks "SUBMIT RESPONSE"
    Then a POST /rpc/review/:sessionId/respond is sent
    And the spinner appears while the agent processes
    When the implementer agent responds
    Then thread 1 updates with the author's reply
    And the round indicator shows "Round 3 of 4"

  Scenario: Candidate adds new annotation in later round
    Given the conversation is in round 2
    When the candidate clicks on a new line in the diff
    And adds an annotation: "This error handler swallows the exception"
    Then a new thread is created in the conversation panel
    And the new annotation is included in the next submit

  Scenario: Candidate submits verdict after round 1
    Given the candidate has completed round 1
    And author responses are visible
    When the candidate selects "REQUEST_CHANGES" verdict
    And writes "The debounce issue is a must-fix before merge. The error handling suggestions are nice-to-have."
    And clicks "SUBMIT VERDICT"
    Then a POST /rpc/review/:sessionId/verdict is sent
    And the conversation panel shows "Evaluating your review..."
    When the scoring panel completes (~15-30s)
    Then the challenge submission is created with the full transcript + score
    And the candidate advances to the next challenge

  Scenario: Unread responses notification before verdict
    Given the author has responded to round 2
    And the candidate has not read all responses
    When the candidate attempts to submit a verdict
    Then a notification appears: "The author has responded to your comments. Review their responses before submitting your verdict."
    And the verdict is NOT submitted
    When the candidate scrolls through all responses
    Then the notification clears
    And the candidate can submit the verdict
```

### 5.3 Conversation panel rendering

```gherkin
Feature: Conversation panel display

  Scenario: Thread displays reviewer and author with distinct styling
    Given a thread has turns from both reviewer and implementer
    Then reviewer turns display with a "You" label and reviewer avatar
    And implementer turns display with the author name (e.g., "Jamie Torres") and author avatar
    And each turn shows the role, content, and timestamp
    And severity badges (critical/major/minor) appear on reviewer turns with annotations

  Scenario: Thread shows file and line reference
    Given a thread originated from an inline annotation on "src/routes/search.ts" line 28
    Then the thread header shows "src/routes/search.ts:28"
    And clicking the header scrolls the diff panel to that line

  Scenario: General review summary thread
    Given the candidate wrote a general review summary
    Then a thread labeled "Review Summary" appears at the top of the conversation panel
    And the author may respond to the overall summary as well

  Scenario: Round separator between turns
    Given the conversation has turns from rounds 1 and 2
    Then a separator line "── Round 2 ──" appears between round 1 and round 2 turns

  Scenario: Empty state before first review
    Given the candidate has not submitted any comments yet
    Then the conversation panel shows:
      | element | content |
      | heading | "Leave your review" |
      | body    | "Add inline comments on the diff, then submit your review. The author will respond to your feedback." |
```

### 5.4 Legacy single-turn fallback

```gherkin
Feature: Legacy single-turn for non-slopify PRs

  Scenario: Arbitrary PR uses single-turn flow
    Given the challenge was created from an arbitrary GitHub PR
    And the challenge has no practiceRepo set
    When the challenge loads
    Then the right panel renders ConnectedVerdictPanel (not ConversationPanel)
    And the candidate adds annotations + verdict + summary
    And clicking "SUBMIT" sends a single submission
    And deterministic scoring runs (ADR-021 algorithm)
    And the candidate advances to the next challenge
```

### 5.5 Agent response handling

```gherkin
Feature: Agent response edge cases

  Scenario: Implementer agent timeout
    Given the candidate has submitted round 1
    And the implementer agent does not respond within 30 seconds
    Then the conversation panel shows "The author is taking longer than usual..."
    After 60 seconds total
    Then the panel shows "Unable to get author response. You may submit your verdict."
    And the candidate can submit a verdict without further rounds

  Scenario: Scoring panel timeout
    Given the candidate has submitted their verdict
    And the scoring panel does not complete within 60 seconds
    Then the candidate advances to the next challenge
    And scoring continues in the background
    And the score is written to the submission when it completes

  Scenario: Implementer agent persona matches difficulty
    Given a challenge with difficulty "easy"
    Then the implementer agent uses the "junior" persona prompt
    And the agent is receptive, asks questions, agrees quickly

    Given a challenge with difficulty "hard"
    Then the implementer agent uses the "senior" persona prompt
    And the agent defends decisions, pushes back with reasoning
```

### 5.6 Scoring panel produces report for recruiter

```gherkin
Feature: Scoring report visibility

  Scenario: Recruiter views score report on candidate profile
    Given a candidate has completed a multi-turn CODE_REVIEW challenge
    And the scoring panel produced a report
    When the recruiter navigates to /candidates/:id
    Then the candidate profile shows:
      | field | example |
      | overall score | 72/100 |
      | band | Adequate |
      | narrative | "The candidate demonstrates solid technical instincts..." |
      | communication score | 85 |
      | technical score | 58 |
      | review practice score | 68 |
    And the recruiter can expand each dimension to see evidence quotes

  Scenario: Candidate does NOT see detailed score
    Given the candidate has completed the assessment
    Then the candidate sees only the completion screen
    And the candidate does NOT see their score, band, or narrative
```

---

## 6. Data Flow Summary

### Challenge creation (recruiter, Phase 2)

```
Recruiter                    PIPE-OS                          GitHub
────────                    ───────                          ──────

ChallengePicker
  → "Code Review"
  → Slopify repo (pre-populated)
  → Browse PRs         ────►  GET /api/v1/github/prs
                              ?repo=pipe-hq/slopify  ───────► GitHub API
                       ◄────  PR list                 ◄───────

  → Select PR #42      ────►  POST /api/v1/stages/:id/challenges
                              { type: CODE_REVIEW,
                                practiceRepo: "pipe-hq/slopify",
                                prNumber: 42, ... }

                       ────►  POST /api/v1/github/pr
                              (cache diff JSON)       ───────► GitHub API
                       ◄────  diff cached              ◄───────

                       ────►  Load ground truth from
                              golden/cases.json
                              (plantedBugs + designTradeoffs)
                              Store in challenge.ground_truth
```

### Assessment (candidate, Phase 3)

```
Candidate                    PIPE-OS Workers                   LLM (Claude)
─────────                    ──────────────                   ────────────

GET /assess/:token
  → resolveToken      ────►  POST /rpc/resolve-token
                       ◄────  { sessionToken, candidate }

  → Begin             ────►  POST /rpc/get-stage-config
                       ◄────  { challenges: [{type: CODE_REVIEW, ...}], timeLimit: 45 }

  → Load challenge    ────►  POST /rpc/get-challenge?order=0
                       ◄────  { type, title, brief, diff, config }
                              (ground truth NOT sent)

  → Submit review     ────►  POST /rpc/review/submit
     (annotations +          Create review_session in D1
      summary)               Build implementer input  ──────► Implementer Agent
                                                               (Sonnet, ~5-10s)
                       ◄────  { sessionId, threads }   ◄──────

  → Submit response   ────►  POST /rpc/review/:id/respond
     (replies +              Append to transcript
      new annotations)       Send to implementer     ──────► Implementer Agent
                       ◄────  { round, threads }      ◄──────

  → Submit verdict    ────►  POST /rpc/review/:id/verdict
     (approve/request         Finalize transcript
      + summary)              Trigger scoring panel   ──────► 3 Panelists (parallel)
                                                              + Synthesizer
                              Create ChallengeSubmission      (~15-30s total)
                              with transcript

                       ◄────  { status: 'scoring' }

  → Poll status       ────►  GET /rpc/review/:id/status
                       ◄────  { status: 'scored' }

  → Advance to next challenge
```

---

## 7. Worker Implementation Map

| Route | Method | Handler | Agent | D1 Tables |
|-------|--------|---------|-------|-----------|
| `/rpc/review/submit` | POST | `handleSubmitReview` | Implementer | review_sessions, challenge_submissions |
| `/rpc/review/:id/respond` | POST | `handleSubmitResponse` | Implementer | review_sessions |
| `/rpc/review/:id/verdict` | POST | `handleSubmitVerdict` | Scoring Panel (async) | review_sessions, challenge_submissions |
| `/rpc/review/:id/status` | GET | `handleReviewStatus` | — | review_sessions |

### Ground truth loading

When creating a challenge from slopify, the Worker loads ground truth from the exercise case definition and stores it in `challenges.ground_truth` (JSON column). This includes:

```typescript
{
  plantedBugs: [...],
  designTradeoffs: [...],
  implementerPersona: 'junior' | 'senior'
}
```

Ground truth is NEVER sent to the candidate client. It is read server-side by:
1. The Technical Evaluator (for bug/trade-off matching)
2. The Worker (to select the implementer persona prompt)

---

## Consequences

### Positive
- Complete, testable specification for the multi-turn flow
- Reuses existing composable architecture (blueprints, panels, shells, contexts)
- DiffPanel changes are minimal — most new work is the ConversationPanel
- Clear DTO contracts allow frontend and backend development in parallel
- BDD scenarios are directly translatable to Playwright tests

### Negative / Trade-offs
- New ConversationPanel is the largest new component (~500-700 lines estimated)
- Agent latency adds wait time to the candidate experience (5-10s per round, 15-30s for scoring)
- Conversation state management adds complexity to the Worker layer

### Risks
- Agent latency could frustrate candidates if >10s. Mitigated by clear spinner UX.
- Transcript size could grow large (4 rounds × multiple threads). Mitigated by max 4 rounds.
