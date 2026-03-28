# Phase 3: Candidate Profile + Public Assessment Flow

> **Status:** Planning
> **Pages:** `/assess/:token`, `/candidates/:id`
> **Depends on:** Phase 2 (D1 schema, Workers RPC layer, Clerk auth)
> **Estimated complexity:** Highest of all phases -- 10 Workers handlers, 3 AI agents, custom JWT auth, R2 presigned uploads

---

## 1. Overview

Phase 3 migrates the two candidate-facing surfaces and the recruiter candidate-profile view:

1. **Public assessment flow** (`/assess/:token`) -- the entire candidate experience from invite link to completion screen. No sign-in required. Authenticated via custom JWT session tokens.
2. **Candidate profile page** (`/candidates/:id`) -- the recruiter's read/write view of a candidate's submissions, scores, follow-up answers, media playback, and AI intelligence reports.

### What moves

| Amplify component | Cloudflare replacement |
|---|---|
| `resolveToken` Lambda | `POST /rpc/resolve-token` Worker |
| `getStageConfig` (getNextChallenge) Lambda | `POST /rpc/get-stage-config` Worker |
| `getChallenge` Lambda | `POST /rpc/get-challenge` Worker |
| `submitChallengeResponse` Lambda | `POST /rpc/submit-challenge-response` Worker |
| `scoringAgent` Lambda | `POST /rpc/score-submission` Worker |
| `codeReviewFollowUpAgent` Lambda | `POST /rpc/generate-follow-ups` Worker |
| `generateMediaUploadUrl` Lambda | `POST /rpc/generate-upload-url` Worker |
| `parseCandidateCV` Lambda | `POST /rpc/parse-cv` Worker |
| `intelligenceReportAgent` Lambda | `POST /rpc/generate-intelligence-report` Worker |
| `resetCandidate` Lambda | `POST /rpc/reset-candidate` Worker |
| `sessionAuthorizer` Lambda | Middleware in Workers (JWT verification) |
| S3 presigned URLs (media) | R2 presigned URLs |
| S3 getUrl (resume/audio/video playback) | R2 presigned GET URLs via `POST /rpc/get-media-url` Worker |
| `useAssessment` hook (AppSync client) | `useAssessment` hook (fetch-based RPC client) |
| `CandidateProfilePage` (Amplify client) | `CandidateProfilePage` (provider abstraction) |

### What does NOT move in Phase 3

- Clerk recruiter auth (done in Phase 1)
- D1 schema creation (done in Phase 2)
- Pipeline/Stage/Challenge CRUD (done in Phase 2)
- Real-time signaling / LIVE_VIDEO scheduling (Phase 4)

---

## 2. BDD User Journeys

### 2.1 Candidate opens invite link and sees first challenge

```gherkin
Feature: Token resolution and assessment start

  Scenario: Valid invite token resolves to session
    Given a Candidate record exists with inviteToken "abc-123" and status "INVITED"
    And the pipeline has a Stage with 2 challenges (CODE_REVIEW, FOLLOW_UP)
    When the candidate navigates to /assess/abc-123
    Then the resolveToken Worker returns a JWT session token
    And the inviteToken in D1 is updated to "CLAIMED::abc-123"
    And the candidate sees a welcome screen with a "Begin Assessment" button

  Scenario: Candidate clicks Begin and sees first challenge
    Given the candidate has a valid session token
    When the candidate clicks "Begin Assessment"
    Then getStageConfig returns { isComplete: false, challenges: [{type:"CODE_REVIEW",order:0},{type:"FOLLOW_UP",order:1}], currentIndex: 0 }
    And getChallenge(order=0) returns the CODE_REVIEW challenge content
    And the candidate sees the DiffReviewCanvas with instructions

  Scenario: Already-claimed token is rejected
    Given a Candidate record exists with inviteToken "CLAIMED::abc-123"
    When the candidate navigates to /assess/abc-123
    Then resolveToken returns null
    And the candidate sees an "Invalid or expired link" error

  Scenario: Candidate with status COMPLETED is blocked
    Given a Candidate record exists with status "COMPLETED"
    When the candidate navigates to /assess/<token>
    Then the candidate sees "You have already completed this assessment"
```

### 2.2 Candidate submits a CODE_REVIEW challenge with annotations

```gherkin
Feature: CODE_REVIEW submission

  Scenario: Candidate submits annotations, verdict, and summary
    Given the candidate is viewing a CODE_REVIEW challenge at order 0
    And the candidate has added 3 annotations with severity levels
    And the candidate has written a verdict of "request_changes"
    And the candidate has written a summary
    When the candidate clicks "Submit"
    Then submitChallengeResponse creates a ChallengeSubmission in D1
    And scoreChallengeSubmission is called with the new challengeSubmissionId
    And the scoring agent calculates a deterministic preliminary score
    And the hook advances to order 1 (FOLLOW_UP)

  Scenario: Duplicate submission is rejected
    Given a ChallengeSubmission already exists for this assessment + challenge
    When the candidate submits again
    Then the Worker returns { success: false, error: "Challenge already submitted" }
```

### 2.3 Candidate submits a QUIZ_MCQ challenge

```gherkin
Feature: QUIZ_MCQ submission

  Scenario: Candidate selects an answer and submits
    Given the candidate is viewing a QUIZ_MCQ challenge
    When the candidate selects option "B" and clicks "Submit"
    Then submitChallengeResponse creates a ChallengeSubmission with { answers: { current: "B" } }
    And the scoring agent compares against serverConfig.correctOptionId
    And the score is 100 (correct) or 0 (incorrect)
    And the hook advances to the next challenge
```

### 2.4 Candidate submits a QUIZ_SHORT_ANSWER challenge

```gherkin
Feature: QUIZ_SHORT_ANSWER submission

  Scenario: Candidate submits a text answer
    Given the candidate is viewing a QUIZ_SHORT_ANSWER challenge
    When the candidate types a response and clicks "Submit"
    Then submitChallengeResponse creates a ChallengeSubmission with { inputMode: "text", text: "..." }
    And the hook advances to the next challenge

  Scenario: Candidate submits a voice answer
    Given the candidate has recorded an audio response
    And the audio has been uploaded to R2 via presigned URL
    When the candidate clicks "Submit"
    Then submitChallengeResponse creates a ChallengeSubmission with { inputMode: "voice", text: "<transcript>", audioR2Key: "..." }

  Scenario: Candidate submits a video answer
    Given the candidate has recorded a video response
    And the video has been uploaded to R2 via presigned URL
    When the candidate clicks "Submit"
    Then submitChallengeResponse creates a ChallengeSubmission with { inputMode: "video", videoR2Key: "...", filename: "..." }
```

### 2.5 Candidate completes all challenges and sees completion screen

```gherkin
Feature: Assessment completion

  Scenario: All stages complete
    Given the candidate has submitted the last challenge of the last stage
    And getStageConfig returns { isComplete: true }
    When the hook processes the response
    Then the Candidate.status is updated to "COMPLETED" in D1
    And the candidate sees the completion screen with a thank-you message
    And the session token is cleared from sessionStorage

  Scenario: Multi-stage progression
    Given the pipeline has 2 stages with 2 challenges each
    And the candidate has submitted both challenges in Stage 1
    When getStageConfig is called
    Then it returns Stage 2's config with currentIndex 0
    And the candidate sees Stage 2's first challenge
```

### 2.6 Candidate uploads a video/audio recording

```gherkin
Feature: Media upload via R2 presigned URL

  Scenario: Candidate requests upload URL for video
    Given the candidate has a valid session token
    When the client calls generateUploadUrl with { mimeType: "video/webm", mediaType: "video" }
    Then the Worker validates the candidate exists in D1
    And returns a presigned R2 PUT URL with 5-minute expiry
    And the R2 key uses an opaque random identifier (e.g. "media/{ulid}.webm"), not internal IDs
    # Security: presigned URLs expose the R2 key path to the candidate.
    # Using random keys avoids leaking candidateId/challengeId in the URL.
    # The Worker maps the opaque key back to the candidate/challenge in D1.

  Scenario: Candidate uploads the recording
    Given the candidate has a presigned PUT URL
    When the client PUTs the file to the URL
    Then the file is stored in R2
    And the R2 key is included in the challenge submission payload
```

### 2.7 Candidate uploads a resume

```gherkin
Feature: Resume upload and parsing

  Scenario: Candidate uploads a PDF resume
    Given the candidate has uploaded a PDF to R2 via presigned URL
    When parseCandidateCV is called with { candidateId, resumeR2Key }
    Then the Worker extracts text from the PDF
    And calls Mistral to parse structured data (skills, YOE, role, education)
    And updates the Candidate record in D1
    And returns { success: true, data: { skills: [...], ... } }
```

### 2.8 Recruiter views candidate profile with scores and submissions

```gherkin
Feature: Candidate profile page (recruiter view)

  Scenario: Recruiter opens candidate profile
    Given the recruiter is authenticated via Clerk
    And the candidate has completed 2 stages with 3 challenges
    When the recruiter navigates to /candidates/:id
    Then the page loads the Candidate record from D1
    And fetches all Assessments and ChallengeSubmissions via JOIN queries
    And fetches all Stages with Challenges for the pipeline
    And displays the sidebar with overall signal, skills, timeline
    And the OVERVIEW tab shows the candidate journey map

  Scenario: Recruiter views a CODE_REVIEW submission
    Given the recruiter clicks on the "Technical Review" stage tab
    Then each ChallengeCard shows the candidate's annotations, verdict, summary
    And the follow-up Q&A is displayed read-only
    And the MiniRadar shows the skill profile from agentic scoring

  Scenario: Recruiter manually scores a QUIZ_SHORT_ANSWER submission
    Given the recruiter is viewing a QUIZ_SHORT_ANSWER ChallengeCard
    When the recruiter drags the score slider to 75
    Then the ChallengeSubmission.score is updated in D1 via RPC
    And the UI reflects the new score immediately (optimistic update)

  Scenario: Recruiter downloads candidate resume
    Given the candidate has a resumeR2Key
    When the recruiter clicks "VIEW_RESUME"
    Then a presigned GET URL is generated for the R2 object
    And the resume opens in a new tab

  Scenario: Recruiter views media submissions
    Given a ChallengeSubmission has a videoR2Key or audioR2Key
    Then the page requests a presigned GET URL from the Worker
    And renders a <video> or <audio> element with the signed URL
```

### 2.9 Recruiter generates intelligence report for candidate

```gherkin
Feature: AI intelligence report

  Scenario: Recruiter triggers intelligence report generation
    Given the recruiter clicks the "INTELLIGENCE" tab
    When the page calls generateIntelligenceReport with { candidateId }
    Then the Worker fetches the candidate, all assessments, and all submissions from D1
    And calls Mistral with the full context + report block schema
    And returns a JSON array of visualization blocks
    And the page renders the blocks (EXECUTIVE_SUMMARY, SKILL_RADAR, HIRE_RECOMMENDATION, etc.)

  Scenario: Report generation fails gracefully
    Given the Mistral API is unavailable
    Then the Worker returns a fallback EXECUTIVE_SUMMARY block
    And the recruiter sees "Report Generation Failed"
```

### 2.10 Recruiter resets a candidate's progress

```gherkin
Feature: Candidate reset

  Scenario: Recruiter resets a candidate
    Given the recruiter confirms the reset action
    When the page calls resetCandidate with { candidateId }
    Then all ChallengeSubmissions for this candidate are deleted from D1
    And all Assessments for this candidate are deleted from D1
    And the Candidate.status is reset to "INVITED"
    And a fresh inviteToken is generated and stored
    And the recruiter sees the updated candidate with no submissions
```

### 2.11 Scoring agent scores a submission automatically

```gherkin
Feature: Automated scoring

  Scenario: CODE_REVIEW deterministic scoring (no follow-ups yet)
    Given a ChallengeSubmission for a CODE_REVIEW challenge exists
    And no followUpQuestionsJson is present
    When scoreChallengeSubmission is called
    Then the Worker fetches the submission and challenge from D1
    And runs deterministic scoring against serverConfig.groundTruth
    And writes score + feedback to ChallengeSubmission
    And re-aggregates Assessment.score as average of all child submissions

  Scenario: CODE_REVIEW agentic scoring (with follow-up answers)
    Given a ChallengeSubmission has followUpQuestionsJson with answers
    When scoreChallengeSubmission is called
    Then the Worker builds a prompt with annotations, verdict, summary, ground truth, and Q&A
    And calls Mistral for holistic scoring (0-100 with 4-dimension skill profile)
    And stores the structured AgenticFeedback JSON in ChallengeSubmission.feedback
    And re-aggregates Assessment.score

  Scenario: QUIZ_MCQ deterministic scoring
    Given a ChallengeSubmission for a QUIZ_MCQ challenge
    When scoreChallengeSubmission is called
    Then score is 100 if selectedOptionId matches correctOptionId, else 0

  Scenario: CODE_IMPLEMENTATION scoring
    Given a ChallengeSubmission for a CODE_IMPLEMENTATION challenge
    When scoreChallengeSubmission is called
    Then the Worker executes the candidate's code against the test suite
    And returns a score based on passing tests
```

### 2.12 Follow-up questions are generated after code review

```gherkin
Feature: Follow-up question generation

  Scenario: FOLLOW_UP challenge triggers question generation
    Given the candidate advances to a FOLLOW_UP challenge (order N)
    And the previous ChallengeSubmission ID is known
    When the hook detects currentType === "FOLLOW_UP"
    Then it calls generateFollowUps with { challengeSubmissionId }
    And the Worker fetches the submission + linked challenge from D1
    And builds a type-specific prompt context (CODE_REVIEW, CODE_IMPL, MCQ, SHORT_ANSWER)
    And calls Mistral to generate exactly 5 SHORT_ANSWER follow-up questions
    And saves the questions to ChallengeSubmission.followUpQuestionsJson
    And returns the questions to the client for rendering

  Scenario: Candidate answers follow-ups and submits
    Given the candidate has answered 5 follow-up questions
    When the candidate clicks "Submit"
    Then the answers are saved to the previous ChallengeSubmission's followUpQuestionsJson
    And scoreChallengeSubmission is called for the previous submission (agentic scoring)
    And a stub ChallengeSubmission is created for the FOLLOW_UP challenge itself
    And the hook advances to the next challenge or stage
```

---

## 3. Acceptance Criteria

1. A candidate can complete the full assessment flow (resolve token, view challenges, submit, see completion) using only Cloudflare Workers + D1.
2. All candidate API calls are authenticated via custom JWT -- no Cognito, no Clerk for candidates.
3. No internal IDs (candidateId, assessmentId, challengeId) are exposed in any candidate-facing request or response. R2 object keys use opaque random identifiers, not internal entity IDs.
4. Presigned R2 URLs work for media upload (PUT) and media playback (GET). Presigned URLs use the S3-compatible endpoint (`<ACCOUNT_ID>.r2.cloudflarestorage.com`), not custom domains — this is an R2 limitation.
5. The scoring agent produces identical scores to the Amplify version for deterministic challenge types (CODE_REVIEW without follow-ups, QUIZ_MCQ).
6. The follow-up agent generates 5 questions and saves them to D1.
7. The intelligence report agent returns renderable visualization blocks.
8. The recruiter can view all submissions, scores, follow-up Q&A, and media on the candidate profile page.
9. The recruiter can manually score QUIZ_SHORT_ANSWER and CODE_IMPLEMENTATION submissions.
10. Resume upload, parsing, and download work end-to-end via R2.
11. The `useAssessment` hook uses the provider abstraction layer -- no direct Amplify imports.
12. All BDD scenarios above have corresponding test specs that pass.
13. Session tokens expire after 2 hours. Expired tokens return 401 and the client clears sessionStorage.
14. Candidate status transitions are enforced: INVITED -> IN_PROGRESS -> COMPLETED.
15. `npx tsc --noEmit` passes with no errors.
16. AI agent calls (scoring, follow-ups, intelligence reports, CV parsing) respect Workers' 30-second CPU time limit (paid plan). Use `ctx.waitUntil()` for fire-and-forget operations (scoring after submission, report generation) that don't need to block the HTTP response. Chain at most one external AI call per request handler.

---

## 4. Workers RPC Routes

All routes are served from a single Hono Worker at `api.pipe.dev` (or the configured Worker domain).

### 4.1 Route Table

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `POST` | `/rpc/resolve-token` | Public (API key) | Validate invite token, issue JWT |
| `POST` | `/rpc/get-stage-config` | Candidate JWT | Return current stage metadata |
| `POST` | `/rpc/get-challenge` | Candidate JWT | Return single challenge content by order |
| `POST` | `/rpc/submit-challenge-response` | Candidate JWT | Create ChallengeSubmission |
| `POST` | `/rpc/score-submission` | Candidate JWT | Trigger scoring agent |
| `POST` | `/rpc/generate-follow-ups` | Candidate JWT | Generate follow-up questions |
| `POST` | `/rpc/generate-upload-url` | Candidate JWT | Presigned R2 PUT URL |
| `POST` | `/rpc/get-media-url` | Clerk (recruiter) | Presigned R2 GET URL for playback |
| `POST` | `/rpc/parse-cv` | Clerk (recruiter) | Extract and parse CV from R2 |
| `POST` | `/rpc/generate-intelligence-report` | Clerk (recruiter) | AI intelligence report |
| `POST` | `/rpc/reset-candidate` | Clerk (recruiter) | Delete submissions, reset status |
| `PATCH` | `/rpc/challenge-submission/:id` | Clerk (recruiter) | Update score/feedback on submission |
| `PATCH` | `/rpc/candidate/:id/status` | Candidate JWT | Update candidate status |

### 4.2 Handler: `resolve-token`

```typescript
// workers/src/routes/resolve-token.ts
import { Hono } from 'hono';
import { signJwt } from '../lib/jwt';
import type { Env } from '../types';

const app = new Hono<{ Bindings: Env }>();

interface ResolveTokenBody {
  inviteToken: string;
}

interface ResolveTokenResult {
  id: string;
  pipelineId: string;
  status: string;
  name: string | null;
  sessionToken: string | null;
}

app.post('/rpc/resolve-token', async (c) => {
  const { inviteToken } = await c.req.json<ResolveTokenBody>();

  if (!inviteToken || typeof inviteToken !== 'string' || inviteToken.trim() === '') {
    return c.json(null, 400);
  }

  const trimmed = inviteToken.trim();

  if (trimmed.startsWith('CLAIMED::')) {
    return c.json(null, 404);
  }

  // D1 query replaces DynamoDB scan -- indexed lookup
  const candidate = await c.env.DB.prepare(
    `SELECT id, pipeline_id, status, name
     FROM candidates
     WHERE invite_token = ?
     LIMIT 1`
  ).bind(trimmed).first<{
    id: string;
    pipeline_id: string;
    status: string;
    name: string | null;
  }>();

  if (!candidate) {
    return c.json(null, 404);
  }

  // Issue JWT session token
  const sessionToken = await signJwt(
    { sub: candidate.id, pid: candidate.pipeline_id },
    c.env.SESSION_TOKEN_SECRET,
  );

  // Claim the invite token (atomic conditional update)
  const result = await c.env.DB.prepare(
    `UPDATE candidates
     SET invite_token = ?
     WHERE id = ? AND invite_token = ?`
  ).bind(`CLAIMED::${trimmed}`, candidate.id, trimmed).run();

  // If no rows affected, token was claimed by concurrent request
  if (result.meta.changes === 0) {
    return c.json(null, 409);
  }

  return c.json<ResolveTokenResult>({
    id: candidate.id,
    pipelineId: candidate.pipeline_id,
    status: candidate.status,
    name: candidate.name,
    sessionToken,
  });
});

export default app;
```

### 4.3 Handler: `get-stage-config`

```typescript
// workers/src/routes/get-stage-config.ts
import { Hono } from 'hono';
import { candidateAuth } from '../middleware/candidate-auth';
import type { Env, CandidateContext } from '../types';
import { randomUUID } from '../lib/crypto';

const app = new Hono<{ Bindings: Env; Variables: CandidateContext }>();

app.use('/rpc/get-stage-config', candidateAuth);

interface StageConfigResult {
  isComplete: boolean;
  stageTitle?: string;
  mode?: string;
  timeLimit?: number | null;
  videoConfig?: unknown;
  challenges?: Array<{ type: string; order: number }>;
  currentIndex?: number;
  error?: string;
}

app.post('/rpc/get-stage-config', async (c) => {
  const candidateId = c.get('candidateId');
  const pipelineId = c.get('pipelineId');

  // Fetch candidate's owner for Assessment creation
  const candidate = await c.env.DB.prepare(
    `SELECT id, pipeline_id, owner_id FROM candidates WHERE id = ?`
  ).bind(candidateId).first<{ id: string; pipeline_id: string; owner_id: string | null }>();

  if (!candidate) {
    return c.json<StageConfigResult>({ isComplete: false, error: 'Candidate not found' });
  }

  // Fetch all stages with challenges in a single JOIN query
  // D1 advantage: real SQL JOINs replace N+1 DynamoDB scans
  const rows = await c.env.DB.prepare(`
    SELECT
      s.id AS stage_id,
      s.title AS stage_title,
      s."order" AS stage_order,
      s.mode AS stage_mode,
      s.time_limit,
      s.video_config,
      ch.id AS challenge_id,
      ch.type AS challenge_type,
      ch."order" AS challenge_order
    FROM stages s
    LEFT JOIN challenges ch ON ch.stage_id = s.id
    WHERE s.pipeline_id = ?
    ORDER BY s."order" ASC, ch."order" ASC
  `).bind(pipelineId).all();

  if (!rows.results || rows.results.length === 0) {
    return c.json<StageConfigResult>({ isComplete: true });
  }

  // Group by stage
  const stageMap = new Map<string, {
    id: string; title: string; order: number; mode: string;
    timeLimit: number | null; videoConfig: string | null;
    challenges: Array<{ id: string; type: string; order: number }>;
  }>();

  for (const row of rows.results) {
    const r = row as Record<string, unknown>;
    const sid = r.stage_id as string;
    if (!stageMap.has(sid)) {
      stageMap.set(sid, {
        id: sid,
        title: r.stage_title as string,
        order: r.stage_order as number,
        mode: r.stage_mode as string,
        timeLimit: r.time_limit as number | null,
        videoConfig: r.video_config as string | null,
        challenges: [],
      });
    }
    if (r.challenge_id) {
      stageMap.get(sid)!.challenges.push({
        id: r.challenge_id as string,
        type: r.challenge_type as string,
        order: r.challenge_order as number,
      });
    }
  }

  const stages = [...stageMap.values()].sort((a, b) => a.order - b.order);

  // Walk stages to find the first with un-submitted challenges
  for (const stage of stages) {
    if (stage.challenges.length === 0) continue;

    // Fetch existing assessment + submissions in one query
    const subs = await c.env.DB.prepare(`
      SELECT cs.challenge_id
      FROM challenge_submissions cs
      JOIN assessments a ON a.id = cs.assessment_id
      WHERE a.candidate_id = ? AND a.stage_id = ?
    `).bind(candidateId, stage.id).all();

    const submittedIds = new Set(
      (subs.results ?? []).map((r) => (r as Record<string, unknown>).challenge_id as string)
    );

    // Find first un-submitted challenge index
    let currentIndex = -1;
    for (let i = 0; i < stage.challenges.length; i++) {
      if (!submittedIds.has(stage.challenges[i].id)) {
        currentIndex = i;
        break;
      }
    }

    if (currentIndex === -1) continue; // All submitted, move to next stage

    // Ensure Assessment exists for this stage
    const existingAssessment = await c.env.DB.prepare(
      `SELECT id FROM assessments WHERE candidate_id = ? AND stage_id = ? LIMIT 1`
    ).bind(candidateId, stage.id).first<{ id: string }>();

    if (!existingAssessment) {
      const assessmentId = randomUUID();
      const now = new Date().toISOString();
      await c.env.DB.prepare(`
        INSERT INTO assessments (id, candidate_id, stage_id, status, owner_id, started_at, created_at, updated_at)
        VALUES (?, ?, ?, 'PENDING', ?, ?, ?, ?)
      `).bind(assessmentId, candidateId, stage.id, candidate.owner_id, now, now, now).run();
    }

    // Update currentStageId on candidate
    await c.env.DB.prepare(
      `UPDATE candidates SET current_stage_id = ? WHERE id = ?`
    ).bind(stage.id, candidateId).run();

    // Build response -- no IDs, no content
    let videoConfig: unknown = null;
    if (stage.videoConfig) {
      try { videoConfig = JSON.parse(stage.videoConfig); } catch { /* keep null */ }
    }

    return c.json<StageConfigResult>({
      isComplete: false,
      stageTitle: stage.title,
      mode: stage.mode,
      timeLimit: stage.timeLimit,
      videoConfig,
      challenges: stage.challenges.map((ch, i) => ({ type: ch.type, order: i })),
      currentIndex,
    });
  }

  // All stages complete
  return c.json<StageConfigResult>({ isComplete: true });
});

export default app;
```

### 4.4 Handler: `get-challenge`

```typescript
// workers/src/routes/get-challenge.ts
import { Hono } from 'hono';
import { candidateAuth } from '../middleware/candidate-auth';
import type { Env, CandidateContext } from '../types';

const app = new Hono<{ Bindings: Env; Variables: CandidateContext }>();

app.use('/rpc/get-challenge', candidateAuth);

interface ChallengeResult {
  type?: string;
  title?: string;
  instructions?: string;
  config?: unknown;
  cachedDiffJson?: unknown;
  githubPrTitle?: string;
  githubPrNumber?: number;
  githubRepoUrl?: string;
  githubPrDescription?: string;
  codeArtifact?: unknown;
  error?: string;
}

app.post('/rpc/get-challenge', async (c) => {
  const { order } = await c.req.json<{ order: number }>();
  const candidateId = c.get('candidateId');
  const pipelineId = c.get('pipelineId');

  if (typeof order !== 'number' || order < 0 || !Number.isInteger(order)) {
    return c.json<ChallengeResult>({ error: 'VALIDATION: order must be a non-negative integer' }, 400);
  }

  // Resolve current stage (first stage with un-submitted challenges)
  // Uses the same stage-walk logic as get-stage-config but returns challenge content
  const stages = await c.env.DB.prepare(`
    SELECT s.id AS stage_id, ch.id AS challenge_id, ch."order" AS challenge_order,
           ch.type, ch.title, ch.instructions, ch.config,
           ch.cached_diff_json, ch.github_pr_title, ch.github_pr_number,
           ch.github_repo_url, ch.github_pr_description
    FROM stages s
    JOIN challenges ch ON ch.stage_id = s.id
    WHERE s.pipeline_id = ?
    ORDER BY s."order" ASC, ch."order" ASC
  `).bind(pipelineId).all();

  // Group challenges by stage_id
  const stageGroups = new Map<string, Array<Record<string, unknown>>>();
  for (const row of stages.results ?? []) {
    const r = row as Record<string, unknown>;
    const sid = r.stage_id as string;
    if (!stageGroups.has(sid)) stageGroups.set(sid, []);
    stageGroups.get(sid)!.push(r);
  }

  // Walk stages to find current one
  for (const [stageId, challenges] of stageGroups) {
    const subs = await c.env.DB.prepare(`
      SELECT cs.challenge_id
      FROM challenge_submissions cs
      JOIN assessments a ON a.id = cs.assessment_id
      WHERE a.candidate_id = ? AND a.stage_id = ?
    `).bind(candidateId, stageId).all();

    const submittedIds = new Set(
      (subs.results ?? []).map((r) => (r as Record<string, unknown>).challenge_id as string)
    );

    const hasUnsubmitted = challenges.some((ch) => !submittedIds.has(ch.challenge_id as string));
    if (!hasUnsubmitted) continue;

    // This is the current stage -- get challenge at `order`
    if (order >= challenges.length) {
      return c.json<ChallengeResult>({
        error: `Challenge at order ${order} not found (stage has ${challenges.length} challenges)`,
      }, 404);
    }

    const ch = challenges[order];

    // Parse JSON fields
    let config: unknown = null;
    if (ch.config) {
      try { config = typeof ch.config === 'string' ? JSON.parse(ch.config as string) : ch.config; } catch { /* keep null */ }
    }

    let cachedDiffJson: unknown = null;
    if (ch.cached_diff_json) {
      try { cachedDiffJson = typeof ch.cached_diff_json === 'string' ? JSON.parse(ch.cached_diff_json as string) : ch.cached_diff_json; } catch { /* keep null */ }
    }

    // SECURITY: Never return serverConfig, groundTruth, or groundTruthAnnotations
    return c.json<ChallengeResult>({
      type: ch.type as string,
      title: ch.title as string,
      instructions: ch.instructions as string,
      config,
      cachedDiffJson,
      githubPrTitle: ch.github_pr_title as string | undefined,
      githubPrNumber: ch.github_pr_number as number | undefined,
      githubRepoUrl: ch.github_repo_url as string | undefined,
      githubPrDescription: ch.github_pr_description as string | undefined,
    });
  }

  return c.json<ChallengeResult>({ error: 'All challenges complete' }, 404);
});

export default app;
```

### 4.5 Handler: `submit-challenge-response`

```typescript
// workers/src/routes/submit-challenge-response.ts
import { Hono } from 'hono';
import { candidateAuth } from '../middleware/candidate-auth';
import type { Env, CandidateContext } from '../types';
import { randomUUID } from '../lib/crypto';

const app = new Hono<{ Bindings: Env; Variables: CandidateContext }>();

app.use('/rpc/submit-challenge-response', candidateAuth);

interface SubmitBody {
  order: number;
  submission: string; // JSON-stringified submission
}

interface SubmitResult {
  success: boolean;
  challengeSubmissionId?: string;
  error?: string;
}

app.post('/rpc/submit-challenge-response', async (c) => {
  const { order, submission } = await c.req.json<SubmitBody>();
  const candidateId = c.get('candidateId');
  const pipelineId = c.get('pipelineId');

  if (typeof order !== 'number' || order < 0 || !Number.isInteger(order)) {
    return c.json<SubmitResult>({ success: false, error: 'VALIDATION: order must be a non-negative integer' }, 400);
  }
  if (!submission) {
    return c.json<SubmitResult>({ success: false, error: 'VALIDATION: submission is required' }, 400);
  }

  // Resolve current stage + challenge at order (same walk as get-challenge)
  const stageRows = await c.env.DB.prepare(`
    SELECT s.id AS stage_id, ch.id AS challenge_id, ch."order" AS challenge_order
    FROM stages s
    JOIN challenges ch ON ch.stage_id = s.id
    WHERE s.pipeline_id = ?
    ORDER BY s."order" ASC, ch."order" ASC
  `).bind(pipelineId).all();

  const stageGroups = new Map<string, Array<{ stageId: string; challengeId: string; order: number }>>();
  for (const row of stageRows.results ?? []) {
    const r = row as Record<string, unknown>;
    const sid = r.stage_id as string;
    if (!stageGroups.has(sid)) stageGroups.set(sid, []);
    stageGroups.get(sid)!.push({
      stageId: sid,
      challengeId: r.challenge_id as string,
      order: r.challenge_order as number,
    });
  }

  let challengeId: string | null = null;
  let assessmentId: string | null = null;
  let ownerId: string | null = null;

  for (const [stageId, challenges] of stageGroups) {
    const subs = await c.env.DB.prepare(`
      SELECT cs.challenge_id
      FROM challenge_submissions cs
      JOIN assessments a ON a.id = cs.assessment_id
      WHERE a.candidate_id = ? AND a.stage_id = ?
    `).bind(candidateId, stageId).all();

    const submittedIds = new Set(
      (subs.results ?? []).map((r) => (r as Record<string, unknown>).challenge_id as string)
    );

    const hasUnsubmitted = challenges.some((ch) => !submittedIds.has(ch.challengeId));
    if (!hasUnsubmitted) continue;

    if (order >= challenges.length) {
      return c.json<SubmitResult>({ success: false, error: `Challenge at order ${order} not found` }, 404);
    }

    challengeId = challenges[order].challengeId;

    // Get or verify assessment
    const assessment = await c.env.DB.prepare(
      `SELECT id, owner_id FROM assessments WHERE candidate_id = ? AND stage_id = ? LIMIT 1`
    ).bind(candidateId, stageId).first<{ id: string; owner_id: string | null }>();

    if (assessment) {
      assessmentId = assessment.id;
      ownerId = assessment.owner_id;
    }
    break;
  }

  if (!challengeId) {
    return c.json<SubmitResult>({ success: false, error: 'Could not resolve challenge' }, 404);
  }
  if (!assessmentId) {
    return c.json<SubmitResult>({ success: false, error: 'No assessment found -- call get-stage-config first' }, 400);
  }

  // Duplicate check
  const existing = await c.env.DB.prepare(
    `SELECT id FROM challenge_submissions WHERE assessment_id = ? AND challenge_id = ? LIMIT 1`
  ).bind(assessmentId, challengeId).first();

  if (existing) {
    return c.json<SubmitResult>({ success: false, error: 'Challenge already submitted' }, 409);
  }

  // Create ChallengeSubmission
  const challengeSubmissionId = randomUUID();
  const now = new Date().toISOString();

  await c.env.DB.prepare(`
    INSERT INTO challenge_submissions
      (id, assessment_id, challenge_id, submission, owner_id, submitted_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    challengeSubmissionId, assessmentId, challengeId,
    submission, ownerId, now, now, now,
  ).run();

  return c.json<SubmitResult>({ success: true, challengeSubmissionId });
});

export default app;
```

### 4.6 Handler: `score-submission`

```typescript
// workers/src/routes/score-submission.ts
import { Hono } from 'hono';
import { candidateAuth } from '../middleware/candidate-auth';
import type { Env, CandidateContext } from '../types';
import { scorer, scoreCodeImplementation } from '../lib/scoring/scorer';
import { agenticScoreCodeReview } from '../lib/scoring/agentic';

const app = new Hono<{ Bindings: Env; Variables: CandidateContext }>();

app.use('/rpc/score-submission', candidateAuth);

app.post('/rpc/score-submission', async (c) => {
  const { challengeSubmissionId } = await c.req.json<{ challengeSubmissionId: string }>();

  if (!challengeSubmissionId) {
    return c.json({ success: false, error: 'VALIDATION: challengeSubmissionId is required' }, 400);
  }

  // Fetch submission + linked challenge in a single JOIN
  const row = await c.env.DB.prepare(`
    SELECT
      cs.id, cs.submission, cs.assessment_id, cs.follow_up_questions_json,
      cs.code_review_summary, cs.code_review_annotations,
      ch.type AS challenge_type, ch.server_config, ch.config AS challenge_config,
      ch.instructions AS challenge_instructions
    FROM challenge_submissions cs
    JOIN challenges ch ON ch.id = cs.challenge_id
    WHERE cs.id = ?
  `).bind(challengeSubmissionId).first<Record<string, unknown>>();

  if (!row) {
    return c.json({ success: false, error: 'Submission not found' }, 404);
  }

  const challengeType = row.challenge_type as string;
  let submission = row.submission;
  if (typeof submission === 'string') {
    try { submission = JSON.parse(submission as string); } catch { /* keep raw */ }
  }

  let serverConfig = row.server_config;
  if (typeof serverConfig === 'string') {
    try { serverConfig = JSON.parse(serverConfig as string); } catch { /* keep raw */ }
  }

  if (!serverConfig) {
    return c.json({ success: true }); // No serverConfig = nothing to score
  }

  let score: number;
  let feedback: string;

  // Route to appropriate scoring strategy
  if (challengeType === 'CODE_REVIEW') {
    const followUpRaw = row.follow_up_questions_json;
    let hasFollowUpAnswers = false;
    let followUpData = null;

    if (followUpRaw) {
      try {
        const parsed = typeof followUpRaw === 'string' ? JSON.parse(followUpRaw as string) : followUpRaw;
        if (parsed?.answers?.length > 0) {
          hasFollowUpAnswers = true;
          followUpData = parsed;
        }
      } catch { /* ignore */ }
    }

    if (hasFollowUpAnswers) {
      // Agentic scoring via Mistral
      const result = await agenticScoreCodeReview({
        submission, serverConfig, followUpData,
        challengeInstructions: row.challenge_instructions as string,
        codeReviewAnnotations: row.code_review_annotations,
        codeReviewSummary: row.code_review_summary as string,
        mistralApiKey: c.env.MISTRAL_API_KEY,
        mistralModel: c.env.MISTRAL_MODEL ?? 'mistral-large-latest',
      });
      score = result.score;
      feedback = result.feedback;
    } else {
      score = scorer(challengeType, submission, serverConfig);
      feedback = buildFeedback(challengeType, score);
    }
  } else if (challengeType === 'CODE_IMPLEMENTATION') {
    const publicConfig = row.challenge_config;
    const result = await scoreCodeImplementation(submission, serverConfig, publicConfig);
    score = result.score;
    feedback = result.feedback;
  } else {
    score = scorer(challengeType, submission, serverConfig);
    feedback = buildFeedback(challengeType, score);
  }

  // Write score + feedback
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `UPDATE challenge_submissions SET score = ?, feedback = ?, scored_at = ? WHERE id = ?`
  ).bind(score, feedback, now, challengeSubmissionId).run();

  // Re-aggregate assessment score
  const assessmentId = row.assessment_id as string;
  if (assessmentId) {
    const agg = await c.env.DB.prepare(`
      SELECT AVG(score) AS avg_score
      FROM challenge_submissions
      WHERE assessment_id = ? AND score IS NOT NULL
    `).bind(assessmentId).first<{ avg_score: number }>();

    if (agg?.avg_score != null) {
      await c.env.DB.prepare(
        `UPDATE assessments SET score = ? WHERE id = ?`
      ).bind(Math.round(agg.avg_score), assessmentId).run();
    }
  }

  return c.json({ success: true });
});

function buildFeedback(challengeType: string, score: number): string {
  if (challengeType === 'CODE_REVIEW') {
    if (score >= 80) return 'Excellent code review -- most issues identified with good severity accuracy.';
    if (score >= 60) return 'Good code review -- caught the main issues. Some were missed or misclassified.';
    if (score >= 40) return 'Code review needs improvement -- several issues were missed.';
    return 'Code review requires significant improvement -- most issues were not identified.';
  }
  if (challengeType === 'QUIZ_MCQ') {
    return score === 100 ? 'Correct answer.' : 'Incorrect answer.';
  }
  return `Score: ${score}/100`;
}

export default app;
```

### 4.7 Handler: `generate-upload-url`

```typescript
// workers/src/routes/generate-upload-url.ts
import { Hono } from 'hono';
import { candidateAuth } from '../middleware/candidate-auth';
import type { Env, CandidateContext } from '../types';
import { AwsClient } from 'aws4fetch';

const app = new Hono<{ Bindings: Env; Variables: CandidateContext }>();

app.use('/rpc/generate-upload-url', candidateAuth);

const URL_EXPIRY_SECONDS = 300;

app.post('/rpc/generate-upload-url', async (c) => {
  const { challengeId, mimeType, mediaType } = await c.req.json<{
    challengeId: string;
    mimeType: string;
    mediaType: 'video' | 'audio';
  }>();

  const candidateId = c.get('candidateId');

  if (!challengeId || typeof challengeId !== 'string') {
    return c.json(null, 400);
  }
  if (!/^(video|audio)\//.test(mimeType)) {
    return c.json(null, 400);
  }
  if (mediaType !== 'video' && mediaType !== 'audio') {
    return c.json(null, 400);
  }

  // Validate candidate exists
  const candidate = await c.env.DB.prepare(
    `SELECT id FROM candidates WHERE id = ?`
  ).bind(candidateId).first();

  if (!candidate) {
    return c.json(null, 404);
  }

  // Generate presigned R2 PUT URL using aws4fetch (R2 is S3-compatible)
  const r2Key = `candidate-submissions/${candidateId}/${challengeId}.webm`;

  const r2Client = new AwsClient({
    accessKeyId: c.env.R2_ACCESS_KEY_ID,
    secretAccessKey: c.env.R2_SECRET_ACCESS_KEY,
  });

  const url = new URL(
    `/${c.env.R2_BUCKET_NAME}/${r2Key}`,
    `https://${c.env.CF_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  );

  url.searchParams.set('X-Amz-Expires', String(URL_EXPIRY_SECONDS));

  const signed = await r2Client.sign(
    new Request(url, {
      method: 'PUT',
      headers: { 'Content-Type': mimeType },
    }),
    { aws: { signQuery: true } },
  );

  return c.json({ uploadUrl: signed.url, r2Key });
});

export default app;
```

### 4.8 Handler: `generate-intelligence-report`

```typescript
// workers/src/routes/generate-intelligence-report.ts
import { Hono } from 'hono';
import { clerkAuth } from '../middleware/clerk-auth';
import type { Env } from '../types';

const app = new Hono<{ Bindings: Env }>();

app.use('/rpc/generate-intelligence-report', clerkAuth);

app.post('/rpc/generate-intelligence-report', async (c) => {
  const { candidateId } = await c.req.json<{ candidateId: string }>();

  // Fetch candidate + all assessments + submissions + challenges in efficient JOINs
  const candidate = await c.env.DB.prepare(
    `SELECT id, name, email, skills, years_of_experience, current_role, education
     FROM candidates WHERE id = ?`
  ).bind(candidateId).first();

  if (!candidate) {
    return c.json([{
      id: 'error', type: 'EXECUTIVE_SUMMARY', title: 'Candidate Not Found',
      data: { summary: 'The requested candidate was not found.' }, priority: 0, width: 'full',
    }]);
  }

  // Single query: assessments -> submissions -> challenges
  const reportData = await c.env.DB.prepare(`
    SELECT
      a.id AS assessment_id, a.score AS assessment_score,
      cs.id AS sub_id, cs.score AS sub_score, cs.submission, cs.feedback,
      cs.follow_up_questions_json,
      ch.type AS challenge_type, ch.title AS challenge_title, ch.instructions
    FROM assessments a
    LEFT JOIN challenge_submissions cs ON cs.assessment_id = a.id
    LEFT JOIN challenges ch ON ch.id = cs.challenge_id
    WHERE a.candidate_id = ?
    ORDER BY a.created_at ASC, cs.submitted_at ASC
  `).bind(candidateId).all();

  // Build context for Mistral
  const systemPrompt = buildIntelligenceSystemPrompt();
  const userPrompt = `Generate a high-fidelity intelligence report for ${(candidate as Record<string, unknown>).name}.\n\nContext:\n${JSON.stringify(reportData.results, null, 2)}`;

  const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${c.env.MISTRAL_API_KEY}`,
    },
    body: JSON.stringify({
      model: c.env.MISTRAL_MODEL ?? 'mistral-large-latest',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  });

  const body = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = body.choices?.[0]?.message?.content ?? '';
  const cleaned = content.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();

  try {
    return c.json(JSON.parse(cleaned));
  } catch {
    return c.json([{
      id: 'error', type: 'EXECUTIVE_SUMMARY', title: 'Report Generation Failed',
      data: { summary: 'The AI was unable to generate a structured report at this time.' },
      priority: 0, width: 'full',
    }]);
  }
});

// System prompt is identical to the Amplify version
function buildIntelligenceSystemPrompt(): string {
  return `You are the Pipe Intelligence Agent...`; // Same as intelligenceReportAgent/handler.ts
}

export default app;
```

---

## 5. Security Model

### 5.1 Candidate JWT (replaces Cognito + sessionAuthorizer)

Candidates never authenticate via Clerk. They use a custom JWT flow identical in design to the current Amplify implementation but running on Workers:

```
Candidate clicks invite link (/assess/:token)
  -> POST /rpc/resolve-token { inviteToken }
  -> Worker validates inviteToken against D1
  -> Worker issues HMAC-SHA256 JWT: { sub: candidateId, pid: pipelineId, iat, exp }
  -> JWT stored in sessionStorage as 'pipe_session_token'
  -> All subsequent requests include Authorization: Bearer <jwt>
```

### 5.2 JWT implementation on Workers

The existing `_shared/jwt.ts` uses `node:crypto` which is NOT available in Workers. Port to Web Crypto API:

```typescript
// workers/src/lib/jwt.ts

interface JwtPayload {
  sub: string;  // candidateId
  pid: string;  // pipelineId
  iat: number;
  exp: number;
}

function base64urlEncode(data: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(data)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64urlEncodeStr(str: string): string {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(str: string): string {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  return atob(padded);
}

const HEADER = base64urlEncodeStr(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));

async function getKey(secret: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'],
  );
}

export async function signJwt(
  payload: Pick<JwtPayload, 'sub' | 'pid'>,
  secret: string,
  ttlSeconds = 7200,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const fullPayload: JwtPayload = { sub: payload.sub, pid: payload.pid, iat: now, exp: now + ttlSeconds };

  const encodedPayload = base64urlEncodeStr(JSON.stringify(fullPayload));
  const signingInput = `${HEADER}.${encodedPayload}`;

  const key = await getKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signingInput));

  return `${signingInput}.${base64urlEncode(signature)}`;
}

export async function verifyJwt(token: string, secret: string): Promise<JwtPayload | null> {
  if (!token || typeof token !== 'string') return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [header, payload, signature] = parts;
  if (!header || !payload || !signature) return null;

  const key = await getKey(secret);
  const signingInput = `${header}.${payload}`;

  // Reconstruct the expected signature bytes from the base64url token signature
  const sigBytes = Uint8Array.from(atob(signature.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

  const valid = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(signingInput));
  if (!valid) return null;

  let decoded: JwtPayload;
  try {
    decoded = JSON.parse(base64urlDecode(payload)) as JwtPayload;
  } catch {
    return null;
  }

  if (typeof decoded.sub !== 'string' || typeof decoded.pid !== 'string' ||
      typeof decoded.iat !== 'number' || typeof decoded.exp !== 'number') {
    return null;
  }

  if (decoded.exp <= Math.floor(Date.now() / 1000)) return null;

  return decoded;
}
```

### 5.3 Candidate auth middleware

```typescript
// workers/src/middleware/candidate-auth.ts
import { createMiddleware } from 'hono/factory';
import { verifyJwt } from '../lib/jwt';
import type { Env, CandidateContext } from '../types';

export const candidateAuth = createMiddleware<{
  Bindings: Env;
  Variables: CandidateContext;
}>(async (c, next) => {
  const authHeader = c.req.header('Authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;

  if (!token) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const payload = await verifyJwt(token, c.env.SESSION_TOKEN_SECRET);
  if (!payload) {
    return c.json({ error: 'SESSION_EXPIRED' }, 401);
  }

  c.set('candidateId', payload.sub);
  c.set('pipelineId', payload.pid);

  await next();
});
```

### 5.4 Security invariants

| Rule | How it is enforced |
|------|-------------------|
| No internal IDs in candidate requests | Candidate sends only `inviteToken` (once) and `order` (integer). All IDs resolved server-side. |
| No internal IDs in candidate responses | Responses contain `type`, `title`, `instructions`, `config` -- never `id`, `assessmentId`, `ownerId`. The sole exception is `challengeSubmissionId` returned from `submit-challenge-response`, which is needed for follow-up generation. |
| Token one-time use | `invite_token` column updated to `CLAIMED::` prefix atomically via conditional UPDATE. |
| Session expiry | JWT `exp` set to 2 hours. Middleware rejects expired tokens with 401. |
| Recruiter-only routes | `/rpc/generate-intelligence-report`, `/rpc/reset-candidate`, `/rpc/parse-cv`, `/rpc/get-media-url`, `PATCH /rpc/challenge-submission/:id` require Clerk auth. |
| Owner scoping | Recruiter routes verify `owner_id` matches the Clerk user before returning data. |

---

## 6. AI Agent Porting

### 6.1 Scoring Agent (`scoringAgent` -> `score-submission`)

**What changes:**
- DynamoDB SDK -> D1 SQL queries (JOIN replaces N+1 GetItem calls)
- `@mistralai/mistralai` SDK -> `fetch()` to Mistral HTTP API (Workers cannot use heavy npm packages with Node.js APIs)
- `node:crypto` `createHmac` not used in scorer itself, but deterministic scorer logic (`scorer.ts`, `scoreCodeImplementation`) ports unchanged
- Assessment score aggregation: DynamoDB Scan with filter -> `SELECT AVG(score) FROM challenge_submissions WHERE assessment_id = ?`

**What stays the same:**
- Agentic prompt structure (system + user prompt)
- 4-dimension scoring rubric (bugIdentification, severityJudgment, analyticalWriting, technicalDepth)
- Deterministic CODE_REVIEW scoring logic
- QUIZ_MCQ scoring logic
- Score clamping (0-100)
- AgenticFeedback JSON structure in `feedback` field

### 6.2 Follow-Up Agent (`codeReviewFollowUpAgent` -> `generate-follow-ups`)

**What changes:**
- DynamoDB GetItem/UpdateItem -> D1 SELECT/UPDATE
- `@mistralai/mistralai` SDK -> `fetch()` to Mistral HTTP API
- `uuid` package -> `crypto.randomUUID()` (native in Workers)
- Cost tracker helper ports as-is (pure logic, no SDK dependency)

**What stays the same:**
- Per-type context builders (CODE_REVIEW, CODE_IMPL, MCQ, SHORT_ANSWER)
- Prompt structure (system + user prompt per challenge type)
- Question generation (5 SHORT_ANSWER questions, padded if needed)
- `followUpQuestionsJson` schema (`{ questions, answers, generatedAt }`)
- `sanitizeForPrompt` helper

### 6.3 Intelligence Report Agent (`intelligenceReportAgent` -> `generate-intelligence-report`)

**What changes:**
- DynamoDB QueryCommand with GSI -> D1 JOIN across assessments, challenge_submissions, challenges
- `@mistralai/mistralai` SDK -> `fetch()` to Mistral HTTP API
- Auth: was authenticated-only (recruiter Cognito) -> Clerk auth middleware

**What stays the same:**
- Block schema (EXECUTIVE_SUMMARY, SKILL_RADAR, HIRE_RECOMMENDATION, etc.)
- System prompt with block definitions
- User prompt structure
- Fallback error block on failure

### 6.4 CV Parser (`parseCandidateCV` -> `parse-cv`)

**What changes:**
- `@aws-sdk/client-textract` -> Alternative PDF text extraction. Options:
  1. **pdf-parse via Wasm** -- Use a Wasm-compiled PDF parser compatible with Workers
  2. **External API** -- Call a hosted extraction service
  3. **Mistral vision** -- Send the PDF as an image to a vision model (if PDF is short)
- Recommendation: Use `unpdf` (Wasm-based, Workers-compatible) for text extraction, then Mistral for structured parsing. This eliminates the Textract dependency entirely.
- DynamoDB UpdateItem -> D1 UPDATE

**What stays the same:**
- Mistral prompt for structured extraction
- Output schema (`{ name, skills, yearsOfExperience, currentRole, education }`)
- Character truncation (3000 chars)

---

## 7. Storage: R2 Presigned URLs

### 7.1 Upload (replaces S3 presigned PUT)

Media uploads use `aws4fetch` to sign R2 requests. R2 is S3-compatible, so the presigned URL flow is nearly identical.

**R2 binding in `wrangler.toml`:**
```toml
[[r2_buckets]]
binding = "PIPE_ASSETS"
bucket_name = "pipe-assets"
```

**Environment variables needed:**
```
R2_ACCESS_KEY_ID       # From Cloudflare dashboard -> R2 -> API tokens
R2_SECRET_ACCESS_KEY   # Same
R2_BUCKET_NAME         # "pipe-assets"
CF_ACCOUNT_ID          # Cloudflare account ID
```

**Key format:** `candidate-submissions/{candidateId}/{challengeId}.webm` (unchanged)

### 7.2 Download / Playback (replaces `getUrl` from `aws-amplify/storage`)

The recruiter profile page currently uses Amplify's `getUrl()` to generate time-limited download URLs for media and resumes. Replace with a Worker route:

```typescript
// POST /rpc/get-media-url (Clerk auth)
app.post('/rpc/get-media-url', async (c) => {
  const { r2Key } = await c.req.json<{ r2Key: string }>();

  // Option 1: Use R2 binding directly (no presigned URL needed for same-Worker access)
  // Option 2: Generate presigned GET URL for client-side fetch
  const r2Client = new AwsClient({
    accessKeyId: c.env.R2_ACCESS_KEY_ID,
    secretAccessKey: c.env.R2_SECRET_ACCESS_KEY,
  });

  const url = new URL(
    `/${c.env.R2_BUCKET_NAME}/${r2Key}`,
    `https://${c.env.CF_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  );
  url.searchParams.set('X-Amz-Expires', '3600');

  const signed = await r2Client.sign(
    new Request(url, { method: 'GET' }),
    { aws: { signQuery: true } },
  );

  return c.json({ url: signed.url });
});
```

### 7.3 Resume upload + parse flow

1. Client calls `POST /rpc/generate-upload-url` with `{ mimeType: "application/pdf", mediaType: "resume" }`
2. Client PUTs file to R2 presigned URL
3. Client calls `POST /rpc/parse-cv` with `{ candidateId, resumeR2Key }`
4. Worker reads PDF from R2 binding, extracts text, calls Mistral, updates D1

---

## 8. Task List

### 8.0 Prerequisites (from Phase 2)
- [ ] D1 schema includes: `candidates`, `stages`, `challenges`, `assessments`, `challenge_submissions` tables
- [ ] D1 indexes: `candidates.invite_token`, `assessments(candidate_id, stage_id)`, `challenge_submissions(assessment_id)`
- [ ] R2 bucket `pipe-assets` created
- [ ] Provider abstraction layer in place

### 8.1 JWT + Auth Middleware
- [ ] Port `_shared/jwt.ts` to Workers Web Crypto API (`workers/src/lib/jwt.ts`)
- [ ] Write `candidateAuth` middleware (`workers/src/middleware/candidate-auth.ts`)
- [ ] Unit tests for `signJwt` and `verifyJwt` (expiry, tampering, malformed)
- [ ] Unit test for middleware (missing header, expired token, valid token)

### 8.2 Token Resolution
- [ ] Implement `POST /rpc/resolve-token` Worker handler
- [ ] Test: valid token returns JWT + candidate info
- [ ] Test: claimed token returns 404
- [ ] Test: missing token returns 400
- [ ] Test: concurrent claims (only one succeeds)

### 8.3 Stage Config + Challenge Content
- [ ] Implement `POST /rpc/get-stage-config` Worker handler
- [ ] Implement `POST /rpc/get-challenge` Worker handler
- [ ] Test: returns correct stage with currentIndex for partially-completed candidate
- [ ] Test: returns `{ isComplete: true }` when all stages done
- [ ] Test: challenge content never includes serverConfig or groundTruth
- [ ] Test: order out of range returns error

### 8.4 Challenge Submission
- [ ] Implement `POST /rpc/submit-challenge-response` Worker handler
- [ ] Test: creates ChallengeSubmission with correct assessment linkage
- [ ] Test: duplicate submission returns 409
- [ ] Test: no assessment returns error (must call get-stage-config first)

### 8.5 Scoring Agent
- [ ] Port `scorer.ts` deterministic scoring logic (no SDK dependencies, pure functions)
- [ ] Port `scoreCodeImplementation` logic
- [ ] Implement `POST /rpc/score-submission` Worker handler
- [ ] Port agentic scoring to use `fetch()` instead of Mistral SDK
- [ ] Test: CODE_REVIEW deterministic scoring matches Amplify output
- [ ] Test: QUIZ_MCQ scoring (100 for correct, 0 for incorrect)
- [ ] Test: Assessment score aggregation (AVG of child submissions)
- [ ] Test: Agentic scoring writes structured AgenticFeedback JSON

### 8.6 Follow-Up Agent
- [ ] Port prompt builders (`buildSystemPrompt`, `buildUserPrompt`) -- pure functions, no changes
- [ ] Port `sanitizeForPrompt` and `validateInput` helpers
- [ ] Implement `POST /rpc/generate-follow-ups` Worker handler
- [ ] Test: generates exactly 5 SHORT_ANSWER questions
- [ ] Test: saves questions to ChallengeSubmission.followUpQuestionsJson
- [ ] Test: pads to 5 if model returns fewer

### 8.7 Media Upload + Playback
- [ ] Implement `POST /rpc/generate-upload-url` Worker handler (R2 presigned PUT)
- [ ] Implement `POST /rpc/get-media-url` Worker handler (R2 presigned GET)
- [ ] Test: presigned PUT URL accepts file upload
- [ ] Test: presigned GET URL returns file
- [ ] Test: invalid mimeType/mediaType rejected

### 8.8 CV Parsing
- [ ] Add `unpdf` (or equivalent Wasm PDF parser) to Workers dependencies
- [ ] Implement `POST /rpc/parse-cv` Worker handler
- [ ] Test: extracts text from PDF and returns structured data
- [ ] Test: updates Candidate record in D1

### 8.9 Intelligence Report
- [ ] Implement `POST /rpc/generate-intelligence-report` Worker handler
- [ ] Test: returns array of visualization blocks
- [ ] Test: returns fallback block on Mistral failure

### 8.10 Candidate Reset
- [ ] Implement `POST /rpc/reset-candidate` Worker handler (Clerk auth)
- [ ] Test: deletes all ChallengeSubmissions and Assessments
- [ ] Test: resets Candidate status to INVITED with new inviteToken
- [ ] Test: non-owner recruiter cannot reset

### 8.11 Recruiter Submission Updates
- [ ] Implement `PATCH /rpc/challenge-submission/:id` Worker handler (Clerk auth)
- [ ] Test: updates score and feedback on ChallengeSubmission
- [ ] Test: non-owner recruiter cannot update

### 8.12 Frontend: useAssessment Hook Migration
- [ ] Replace `generateClient<Schema>()` with provider abstraction RPC calls
- [ ] Replace `publicClient.queries.resolveToken()` with `fetch('/rpc/resolve-token')`
- [ ] Replace `client.mutations.getStageConfig()` with `fetch('/rpc/get-stage-config')`
- [ ] Replace `client.mutations.getChallenge()` with `fetch('/rpc/get-challenge')`
- [ ] Replace `client.mutations.submitChallengeResponse()` with `fetch('/rpc/submit-challenge-response')`
- [ ] Replace `client.mutations.scoreChallengeSubmission()` with `fetch('/rpc/score-submission')`
- [ ] Replace `client.mutations.generateFollowUps()` with `fetch('/rpc/generate-follow-ups')`
- [ ] Replace `client.mutations.generateMediaUploadUrl()` with `fetch('/rpc/generate-upload-url')`
- [ ] Replace `client.models.Candidate.update()` with `fetch('/rpc/candidate/:id/status')`
- [ ] Add Authorization header injection from sessionStorage
- [ ] Handle 401 responses: clear sessionStorage, set SESSION_EXPIRED error
- [ ] Verify all types remain compatible (`StageConfigDTO`, `ChallengeContentDTO`, `FollowUpQuestion`)

### 8.13 Frontend: CandidateProfilePage Migration
- [ ] Replace `generateClient<Schema>()` with provider abstraction
- [ ] Replace `client.models.Candidate.get()` with provider `getCandidate(id)`
- [ ] Replace `client.models.Assessment.list()` with provider query (D1 JOIN)
- [ ] Replace `client.models.ChallengeSubmission.list()` with provider query
- [ ] Replace `client.models.Stage.list()` with provider query
- [ ] Replace `getUrl()` (Amplify Storage) with `fetch('/rpc/get-media-url')`
- [ ] Replace `client.mutations.generateIntelligenceReport()` with `fetch('/rpc/generate-intelligence-report')`
- [ ] Replace `client.models.ChallengeSubmission.update()` with `fetch('/rpc/challenge-submission/:id')`
- [ ] Replace `client.models.ScheduledInterview` calls (defer to Phase 4, leave as-is or stub)

### 8.14 D1 Schema Additions (if not in Phase 2)
- [ ] Ensure `challenge_submissions` table has: `follow_up_questions_json TEXT`, `code_review_summary TEXT`, `code_review_annotations TEXT`, `scored_at TEXT`
- [ ] Ensure `challenges` table has: `server_config TEXT`, `cached_diff_json TEXT`, `github_pr_title TEXT`, `github_pr_number INTEGER`, `github_repo_url TEXT`, `github_pr_description TEXT`
- [ ] Ensure `candidates` table has: `invite_token TEXT UNIQUE`, `current_stage_id TEXT`, `resume_r2_key TEXT`, `skills TEXT` (JSON array), `years_of_experience INTEGER`, `current_role TEXT`, `education TEXT` (JSON array)
- [ ] Create index on `candidates.invite_token`
- [ ] Create index on `challenge_submissions(assessment_id, challenge_id)` for duplicate check

---

## 9. BDD Test Specifications

### 9.1 Unit Tests (Vitest)

```typescript
// workers/src/lib/__tests__/jwt.test.ts
describe('JWT (Web Crypto)', () => {
  it('signs and verifies a valid token', async () => {
    const token = await signJwt({ sub: 'cand-1', pid: 'pipe-1' }, 'test-secret');
    const payload = await verifyJwt(token, 'test-secret');
    expect(payload).not.toBeNull();
    expect(payload!.sub).toBe('cand-1');
    expect(payload!.pid).toBe('pipe-1');
  });

  it('rejects a token signed with different secret', async () => {
    const token = await signJwt({ sub: 'cand-1', pid: 'pipe-1' }, 'secret-a');
    const payload = await verifyJwt(token, 'secret-b');
    expect(payload).toBeNull();
  });

  it('rejects an expired token', async () => {
    const token = await signJwt({ sub: 'cand-1', pid: 'pipe-1' }, 'test-secret', -1);
    const payload = await verifyJwt(token, 'test-secret');
    expect(payload).toBeNull();
  });

  it('rejects a tampered payload', async () => {
    const token = await signJwt({ sub: 'cand-1', pid: 'pipe-1' }, 'test-secret');
    const [header, , signature] = token.split('.');
    const tamperedPayload = base64urlEncodeStr(JSON.stringify({ sub: 'hacker', pid: 'pipe-1', iat: 0, exp: 9999999999 }));
    const tampered = `${header}.${tamperedPayload}.${signature}`;
    const payload = await verifyJwt(tampered, 'test-secret');
    expect(payload).toBeNull();
  });

  it('rejects malformed tokens', async () => {
    expect(await verifyJwt('', 'secret')).toBeNull();
    expect(await verifyJwt('a.b', 'secret')).toBeNull();
    expect(await verifyJwt('a.b.c.d', 'secret')).toBeNull();
    expect(await verifyJwt('not-a-jwt', 'secret')).toBeNull();
  });
});
```

### 9.2 Integration Tests (Workers + D1)

Use `wrangler dev --local` with Miniflare for local D1:

```typescript
// workers/src/__tests__/resolve-token.integration.test.ts
describe('POST /rpc/resolve-token', () => {
  beforeEach(async () => {
    // Seed D1 with test candidate
    await env.DB.exec(`
      INSERT INTO candidates (id, pipeline_id, invite_token, status, name, owner_id, created_at, updated_at)
      VALUES ('cand-1', 'pipe-1', 'test-token-123', 'INVITED', 'Test User', 'owner-1', datetime('now'), datetime('now'))
    `);
  });

  it('resolves valid token and returns JWT', async () => {
    const res = await app.request('/rpc/resolve-token', {
      method: 'POST',
      body: JSON.stringify({ inviteToken: 'test-token-123' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe('cand-1');
    expect(body.pipelineId).toBe('pipe-1');
    expect(body.sessionToken).toBeTruthy();
  });

  it('rejects already-claimed token', async () => {
    await env.DB.exec(`UPDATE candidates SET invite_token = 'CLAIMED::test-token-123' WHERE id = 'cand-1'`);
    const res = await app.request('/rpc/resolve-token', {
      method: 'POST',
      body: JSON.stringify({ inviteToken: 'CLAIMED::test-token-123' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(404);
  });

  it('returns 404 for unknown token', async () => {
    const res = await app.request('/rpc/resolve-token', {
      method: 'POST',
      body: JSON.stringify({ inviteToken: 'nonexistent' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(404);
  });
});
```

```typescript
// workers/src/__tests__/assessment-flow.integration.test.ts
describe('Full assessment flow', () => {
  let sessionToken: string;

  beforeEach(async () => {
    // Seed: pipeline -> stage -> 2 challenges (CODE_REVIEW + FOLLOW_UP) -> candidate
    await seedTestPipeline(env.DB);

    // Resolve token to get session
    const res = await app.request('/rpc/resolve-token', {
      method: 'POST',
      body: JSON.stringify({ inviteToken: 'flow-test-token' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const body = await res.json();
    sessionToken = body.sessionToken;
  });

  it('walks through full assessment: config -> challenge -> submit -> complete', async () => {
    // Step 1: Get stage config
    const configRes = await app.request('/rpc/get-stage-config', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${sessionToken}`, 'Content-Type': 'application/json' },
    });
    const config = await configRes.json();
    expect(config.isComplete).toBe(false);
    expect(config.challenges).toHaveLength(2);
    expect(config.currentIndex).toBe(0);

    // Step 2: Get first challenge
    const challengeRes = await app.request('/rpc/get-challenge', {
      method: 'POST',
      body: JSON.stringify({ order: 0 }),
      headers: { 'Authorization': `Bearer ${sessionToken}`, 'Content-Type': 'application/json' },
    });
    const challenge = await challengeRes.json();
    expect(challenge.type).toBe('CODE_REVIEW');
    expect(challenge.serverConfig).toBeUndefined(); // SECURITY: never exposed

    // Step 3: Submit
    const submitRes = await app.request('/rpc/submit-challenge-response', {
      method: 'POST',
      body: JSON.stringify({
        order: 0,
        submission: JSON.stringify({ annotations: [], verdict: 'approve', summary: 'LGTM' }),
      }),
      headers: { 'Authorization': `Bearer ${sessionToken}`, 'Content-Type': 'application/json' },
    });
    const submitBody = await submitRes.json();
    expect(submitBody.success).toBe(true);
    expect(submitBody.challengeSubmissionId).toBeTruthy();

    // Step 4: Submit FOLLOW_UP (order 1)
    const submitFollowUp = await app.request('/rpc/submit-challenge-response', {
      method: 'POST',
      body: JSON.stringify({
        order: 1,
        submission: JSON.stringify({ answers: {} }),
      }),
      headers: { 'Authorization': `Bearer ${sessionToken}`, 'Content-Type': 'application/json' },
    });
    expect((await submitFollowUp.json()).success).toBe(true);

    // Step 5: Get stage config again -> should be complete
    const finalConfig = await app.request('/rpc/get-stage-config', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${sessionToken}`, 'Content-Type': 'application/json' },
    });
    expect((await finalConfig.json()).isComplete).toBe(true);
  });

  it('rejects requests with expired session token', async () => {
    const expiredToken = await signJwt({ sub: 'cand-1', pid: 'pipe-1' }, env.SESSION_TOKEN_SECRET, -1);
    const res = await app.request('/rpc/get-stage-config', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${expiredToken}`, 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(401);
  });

  it('prevents duplicate submission', async () => {
    // First submission
    await app.request('/rpc/submit-challenge-response', {
      method: 'POST',
      body: JSON.stringify({ order: 0, submission: '{}' }),
      headers: { 'Authorization': `Bearer ${sessionToken}`, 'Content-Type': 'application/json' },
    });
    // Duplicate
    const dupRes = await app.request('/rpc/submit-challenge-response', {
      method: 'POST',
      body: JSON.stringify({ order: 0, submission: '{}' }),
      headers: { 'Authorization': `Bearer ${sessionToken}`, 'Content-Type': 'application/json' },
    });
    expect(dupRes.status).toBe(409);
  });
});
```

### 9.3 E2E Tests (Playwright)

```typescript
// e2e/candidate-assessment.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Candidate Assessment Flow', () => {
  test('candidate completes full assessment from invite link', async ({ page }) => {
    // Seed data via API or fixture
    const inviteToken = await seedCandidateFixture();

    await page.goto(`/assess/${inviteToken}`);

    // Welcome screen
    await expect(page.getByText('Begin Assessment')).toBeVisible();
    await page.getByText('Begin Assessment').click();

    // First challenge loads
    await expect(page.getByTestId('challenge-renderer')).toBeVisible();

    // Submit CODE_REVIEW
    await page.getByTestId('submit-challenge').click();
    await page.waitForTimeout(500);

    // Completion screen (if single-challenge pipeline)
    // Or next challenge loads
  });

  test('expired token shows error', async ({ page }) => {
    await page.goto('/assess/nonexistent-token');
    await expect(page.getByText('Invalid or expired link')).toBeVisible();
  });
});
```

```typescript
// e2e/candidate-profile.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Recruiter Candidate Profile', () => {
  test.use({ storageState: 'e2e/.auth/recruiter.json' }); // Clerk session

  test('recruiter views candidate with submissions', async ({ page }) => {
    const candidateId = await seedCompletedCandidate();
    await page.goto(`/candidates/${candidateId}`);

    // Sidebar loads
    await expect(page.getByText('OVERALL_SIGNAL')).toBeVisible();

    // Stage tabs visible
    await expect(page.getByText('OVERVIEW')).toBeVisible();

    // Click into a stage
    await page.getByText('Technical Review').click();
    await expect(page.getByText('CANDIDATE_ANNOTATIONS')).toBeVisible();
  });

  test('recruiter generates intelligence report', async ({ page }) => {
    await page.goto(`/candidates/${candidateId}`);
    await page.getByText('INTELLIGENCE').click();
    await expect(page.getByText('SYNTHESIZING_INTELLIGENCE...')).toBeVisible();
    // Wait for report
    await expect(page.getByTestId('intelligence-report')).toBeVisible({ timeout: 30000 });
  });
});
```

---

## 10. Definition of Done

- [ ] All 14 RPC routes are implemented and deployed to Cloudflare Workers
- [ ] JWT signing/verification uses Web Crypto API (no `node:crypto`)
- [ ] `useAssessment` hook has zero Amplify imports
- [ ] `CandidateProfilePage` has zero Amplify imports
- [ ] All BDD scenarios from Section 2 have passing test specs
- [ ] Unit tests for JWT, scorer, and prompt builders pass
- [ ] Integration tests for all RPC routes pass against local D1
- [ ] E2E tests for candidate flow and recruiter profile pass
- [ ] No internal IDs (candidateId, assessmentId, challengeId) appear in candidate-facing network traffic (verified by E2E test with network interception)
- [ ] Media upload (video/audio) and playback work via R2 presigned URLs
- [ ] Resume upload, parsing, and download work end-to-end
- [ ] Intelligence report renders correctly with Mistral integration
- [ ] `npx tsc --noEmit` passes
- [ ] CHANGELOG.md updated under `[Unreleased]`
- [ ] Session tokens expire after 2h and expired tokens return 401
- [ ] Candidate status transitions enforced (INVITED -> IN_PROGRESS -> COMPLETED)
- [ ] Deterministic scoring produces identical results to Amplify version (validated by snapshot tests)
- [ ] All `amplify/functions/` candidate-flow Lambdas can be deleted after migration is verified
