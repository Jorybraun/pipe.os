<project_specification>
  <project_name>Pipe OS — AI-Native Developer Interview Platform</project_name>

  <overview>
    Build a fully functional AI-native developer interview platform where recruiters create composable
    technical hiring pipelines, send a shareable link to a candidate, and receive a scored assessment
    report — without scheduling a call. The platform features a brutalist glassmorphic design language
    (liquid metal chrome aesthetic, deep dark base, Space Mono typography) and is built on AWS Amplify
    Gen 2 (AppSync + DynamoDB + Cognito + Lambda). The UI must match the existing Pipe OS design system
    described in docs/design/design-system.md exactly.
  </overview>


  <prerequisites>
    <environment_setup>
      - AWS Amplify Gen 2 sandbox: `npx ampx sandbox`
      - Local dev server: `npm run dev`
      - Type check (use this, not build): `npx tsc --noEmit`
      - Production deploy (CI only): `npx ampx pipeline-deploy`
      - CHANGELOG.md must be updated on every source commit (pre-commit hook enforced)
      - ADR required for every significant architectural decision (docs/decisions/)
      - All models defined exclusively in amplify/data/resource.ts
    </environment_setup>
  </prerequisites>

  <current_implementation_status>
    Last verified against code: 2026-03-23

    BUILT AND ACTIVE (ungated):
    - Full recruiter auth (Cognito + Authenticator)
    - Pipeline CRUD (ListingPage, OverviewPage, PipelineCreatePage)
    - Stage management with drag-and-drop (StageDetailPage, dnd-kit)
    - Challenge architecture: all 4 types + FOLLOW_UP first-class type
    - ChallengeRegistry routing type → renderer
    - Candidate assessment flow: welcome → challenges → scheduling step
    - CODE_REVIEW full renderer (DiffReviewCanvas / DiffPanel + annotations)
    - QUIZ_MCQ, QUIZ_SHORT_ANSWER, CODE_IMPLEMENTATION via composable panel system
    - FOLLOW_UP: agentic follow-up questions panel in assessment flow
    - StageShell: timer, progress dots, navigation
    - useAssessment hook: resolveToken security fix, lazy stage loading, follow-up routing
    - CandidateProfilePage: per-challenge scoring, follow-up Q&A display
    - IntelligenceReport component (gated by VITE_FEATURE_INTELLIGENCE_REPORT env var)
    - scoringAgent Lambda: full Mistral agentic scoring + deterministic fallback (NOT a stub)
    - codeReviewFollowUpAgent Lambda: generates 5 follow-up Qs, saves to Assessment.followUpQuestionsJson
    - resolveToken Lambda: secure inviteToken → candidate lookup (returns only safe fields)
    - GitHub PR integration: fetchGitHubPR, listGitHubPRs, scoreCodeReview, submitCodeReview Lambdas
    - ChallengePicker: static library (65 templates) + GitHub PR browser (listGitHubPRs)
    - Scheduling epic fully built (see below) but gated off
    - Video interview fully built (see below) but gated off
    - Dev container sandbox fully built (see below) but gated off

    BUILT BUT FEATURE-FLAGGED OFF (in src/App.tsx):
    - /pipeline/:id/challenges/:challengeId  ChallengeEditorPage  [FEATURE_FLAG_CHALLENGE_EDITOR = false]
    - /schedule                              SchedulingPage       [FEATURE_FLAG_SCHEDULE_ROUTE = false]
    - /sandbox/dev-container                 DevContainerSandboxPage [FEATURE_FLAG_DEV_CONTAINER_ROUTE = false]
    - Live video (VideoShell, VideoSession)  [FEATURE_FLAG_LIVE_VIDEO = false]

    NOT YET BUILT:
    - Challenge.serverConfig IAM field-level auth (allow.resource(scoringAgent) only) — field exists, lock-down pending
    - DynamoDB-backed challenge library (ChallengePicker still reads static challengeLibrary.ts)
    - /library management page
    - Voice input / transcription epic
    - AI pipeline creation (AI_DRIVEN creationMode)
    - SYSTEM_DESIGN challenge type
    - repoManagement Lambda (scaffold + docs exist, implementation incomplete)
  </current_implementation_status>

  <core_features>

    <recruiter_auth>
      - Email sign-up and sign-in via AWS Cognito
      - `&lt;Authenticator&gt;` wrapping all recruiter routes
      - Sign-out button in ProfileHeader
      - Recruiter owns all pipelines, stages, challenges, candidates, assessments
    </recruiter_auth>

    <pipeline_management>
      - Create pipeline: title, seniority level (Junior/Mid/Senior/Staff/Principal/Lead/Manager),
        tech stack (string array), description
      - Pipeline status: DRAFT | ACTIVE | ARCHIVED
      - Preset-based creation: DEFAULT (pre-seeded with example stages) or BLANK
      - Pipeline list page: ListingPage — pipelines ranked by candidate activity
      - Pipeline detail page: OverviewPage — stage Kanban + candidate list
    </pipeline_management>

    <challenge_architecture>
      - A Pipeline has one or more Stages (ordered containers)
      - A Stage has one or more Challenges (ordered atomic problem units)
      - Challenge types: CODE_REVIEW | CODE_IMPLEMENTATION | QUIZ_MCQ | QUIZ_SHORT_ANSWER | FOLLOW_UP
      - FOLLOW_UP is a first-class type: agentic follow-up questions generated by codeReviewFollowUpAgent,
        stored in Assessment.followUpQuestionsJson, rendered in FollowUpQuestionsPanel
      - Each challenge has a type, title, instructions (markdown), and a type-specific `config` JSON
      - Multiple challenges can share a CodeArtifact (reusable code snippet) for linked context

      <challenge_types>
        <code_review>
          - Candidate sees code in a diff-style viewer (DiffPanel / DiffReviewCanvas)
          - Clicks line numbers to annotate bugs with severity (critical/major/minor) + comment
          - Verdict and summary text fields for overall assessment
          - Scoring: scoreCodeReview() — ±1 line tolerance, false positive penalty
          - Submission handled by submitCodeReview Lambda; scoring by scoreCodeReview Lambda
          - Auto-scored on submission
        </code_review>

        <code_implementation>
          - Split-pane layout: left = problem statement (markdown), right = Monaco editor
          - Recruiter provides starter code, problem statement, examples, constraints
          - Optional: link to a CodeArtifact for "View Original" context drawer
          - Scoring: manual. Recruiter scores 0–100 with rubric dimensions.
          - Submission captures candidate's code as a string.
        </code_implementation>

        <quiz_mcq>
          - Single multiple-choice question, 2–5 options, one correct answer
          - Candidate selects one option; submit locks the answer
          - Scoring: automatic (100 if correct, 0 if wrong)
          - correctOptionId stored in config (post-MVP: move to serverConfig)
        </quiz_mcq>

        <quiz_short_answer>
          - Open-ended question with a large textarea response
          - Optional: placeholder text, character cap, recruiter-only rubric
          - Scoring: manual only
        </quiz_short_answer>

        <follow_up>
          - Generated by codeReviewFollowUpAgent Lambda after CODE_REVIEW submission
          - 5 follow-up questions stored in Assessment.followUpQuestionsJson
          - Rendered in FollowUpQuestionsPanel in the candidate assessment flow
          - Candidate answers inline; responses captured in assessment
          - Routing: CandidateAssessmentPage handles FOLLOW_UP above ChallengeRegistry
        </follow_up>
      </challenge_types>
    </challenge_architecture>

    <pipeline_builder_ui>
      - OverviewPage: stage cards as containers, each showing challenge tiles inside
      - Stage card header: name, time limit badge, challenge count
      - StageDetailPage: dedicated page for challenge management within a stage
      - Challenge tile anatomy: numbered square (drag handle) | type badge (color-coded) | title | metadata row | edit + delete icons
      - Type badge colors:
          CODE_REVIEW = rgba(96,165,250,0.2) / #60a5fa (blue)
          CODE_IMPLEMENTATION = rgba(167,139,250,0.2) / #a78bfa (purple)
          QUIZ_MCQ = rgba(74,222,128,0.2) / #4ade80 (green)
          QUIZ_SHORT_ANSWER = rgba(251,191,36,0.2) / #fbbf24 (amber)
          FOLLOW_UP = (AI/violet tones — in FollowUpQuestionsPanel)
      - "ADD CHALLENGE" opens ChallengePicker modal
      - ChallengePicker: search input, type cards (5 types incl. FOLLOW_UP), pre-built template list
        (65 static templates from challengeLibrary.ts) + GitHub PR browser tab (listGitHubPRs Lambda)
      - ChallengeEditorPage: tabbed (DETAILS, CONTENT, SCORING, PREVIEW) — built, gated off
      - Drag-and-drop reordering for challenges within a stage (dnd-kit)
      - Drag-and-drop reordering for stages within a pipeline (dnd-kit)
    </pipeline_builder_ui>

    <candidate_flow>
      - No account required. Candidate accesses `/assess/:inviteToken`
      - useAssessment hook resolves inviteToken via resolveToken Lambda (security hardened: returns
        only {id, pipelineId, status, name}, no publicApiKey exposure)
      - Candidate.publicApiKey auth is ['update'] only; Assessment.publicApiKey is ['create', 'update'] only
      - StageShell renders: PIPE logo, stage name, countdown timer, progress dots, challenge counter
      - ChallengeRegistry routes challenge.type → renderer component
      - FOLLOW_UP challenge type handled above ChallengeRegistry in CandidateAssessmentPage
      - Candidate progresses through challenges in order within a stage
      - Each challenge submission creates an Assessment record (challengeId FK)
      - Submit per challenge (not per stage)
    </candidate_flow>

    <recruiter_dashboard>
      - ListingPage: all pipelines, candidate count per pipeline, avg score, search + filter
      - OverviewPage: pipeline detail — stages Kanban + candidates list, ranked by score
      - CandidateProfilePage: per-challenge results for a candidate
        - CODE_REVIEW: score, bugs found/total, false positives, [View annotations], follow-up Q&amp;A
        - QUIZ_MCQ: score, correct/wrong
        - QUIZ_SHORT_ANSWER: response text, [Score now] manual scoring UI
        - CODE_IMPLEMENTATION: [View code], [Score now] manual scoring UI
        - IntelligenceReport: rich analytics (gated by VITE_FEATURE_INTELLIGENCE_REPORT)
      - Signal labels: STRONG (≥85) | YES (≥70) | MAYBE (≥50) | NO (&lt;50)
      - Stage score = avg of challenge scores; Overall score = avg of stage scores
      - MetalScoreRing component for score visualization
    </recruiter_dashboard>

    <interview_scheduling>
      STATUS: Fully built, gated off (FEATURE_FLAG_SCHEDULE_ROUTE = false)

      - SchedulingConnection model: OAuth token storage for Calendly/Cal.com
      - ScheduledInterview model: status INVITED → SCHEDULED → COMPLETED / CANCELLED / NO_SHOW
        Secondary indexes on externalEventId and candidateId+status
      - schedulingOAuth Lambda: OAuth exchange, token refresh, fetchEventTypes
      - schedulingWebhook Lambda: Calendly + Cal.com webhook normalizers
      - SchedulingDashboard, InterviewCard, StatusOverrideModal, SchedulingFilters
      - ConnectionSetup wizard (OAuth), ConnectionStatusBadge, EventTypePicker
      - Scheduling IoC: pluginRegistry.ts + CalendlyProvider, CalComProvider, ManualProvider
      - useSchedulingConnection, useScheduledInterviews, useScheduledInterview hooks
      - Candidate-facing: SchedulingStep in assessment flow (CalendlyProvider or ManualProvider)
      - Recruiter-facing: /schedule dashboard wrapping SchedulingDashboard
    </interview_scheduling>

    <live_video>
      STATUS: Fully built, gated off (FEATURE_FLAG_LIVE_VIDEO = false)

      - VideoSession model: status WAITING/CALLING/ACTIVE/ENDED
      - VideoSignal model: type OFFER/ANSWER/ICE_CANDIDATE/HANGUP
      - Stage.mode: ASYNC | LIVE_VIDEO
      - turnCredentials Lambda: Metered.ca TURN server credentials
      - VideoShell wrapper in CandidateAssessmentPage
      - VideoControls, VideoDeviceCheck, VideoFloatingPiP, VideoIncomingCall, VideoWaitingRoom
      - useVideoSession, useVideoSignaling hooks
      - TURN relay integration for NAT traversal
    </live_video>

    <dev_container_sandbox>
      STATUS: Fully built, gated off (FEATURE_FLAG_DEV_CONTAINER_ROUTE = false)

      - DevContainerSession model: Fargate task lifecycle (PROVISIONING/BOOTING/READY/STOPPING/ERROR)
        Custom identifier on taskArn; secondary index on candidateId+status
      - devContainerLaunch Lambda: ECS.RunTask invocation
      - devContainerDestroy Lambda: ECS task termination
      - devContainerStatus Lambda: status query
      - getContainerLogs Lambda: CloudWatch log fetching
      - ecsStatusBridge Lambda: ECS status → DynamoDB sync
      - DevContainerSandboxPage + useDevContainerSession hook
    </dev_container_sandbox>

    <github_pr_integration>
      STATUS: Fully built and active (not gated)

      - fetchGitHubPR Lambda: GitHub API client, diff parsing, caching (cachedDiffJson on Challenge)
      - listGitHubPRs Lambda: PR summary listing for a repo
      - scoreCodeReview Lambda: ground truth comparison scoring
      - submitCodeReview Lambda: handles code review submission, triggers scoring
      - Challenge fields: githubRepoUrl, githubPrNumber, cachedDiffJson, groundTruth, groundTruthAnnotations
      - GitHubPRFetcher component (in ChallengeEditorPage, gated)
      - GroundTruthAnnotationEditor component (in ChallengeEditorPage, gated)
      - ChallengePicker has GitHub PR browser tab using listGitHubPRs
    </github_pr_integration>

    <ai_agents>
      - questionAgent Lambda: generates discovery questions from RoleContext (engineering standard)
      - codeReviewFollowUpAgent Lambda: generates 5 follow-up Qs after CODE_REVIEW, saves to Assessment
      - scoringAgent Lambda: full Mistral agentic scoring for CODE_REVIEW + deterministic for QUIZ_MCQ
        (reads challenge + assessment from DynamoDB, calls scorer.ts, writes score back)
      - submitCodeReview Lambda: handles assessment creation + scoring orchestration
      - scoringAgent is NOT a stub — it is fully implemented with Mistral + DynamoDB integration
      - jobDescriptionAgent Lambda: post-MVP stub
      - All Lambdas follow questionAgent pattern (handler, types, prompts, validation, costTracker)
    </ai_agents>

    <code_artifact_manager>
      - Reusable code snippets stored as CodeArtifact records (per pipeline)
      - Title, language, code, groundTruth (answer key — owner-only via field-level auth on serverConfig)
      - Challenges reference an artifact via codeArtifactId
    </code_artifact_manager>

    <security>
      IMPLEMENTED:
      - resolveToken Lambda: replaces direct client DynamoDB scan; returns only safe fields
      - Candidate.publicApiKey: ['update'] only (was ['read', 'update'])
      - Assessment.publicApiKey: ['create', 'update'] only (was ['create', 'read', 'update'])
      - All 5 candidate/assessment mutations use explicit selectionSet (no response field leakage)
      - Dev-only buttons gated behind `import.meta.env.DEV`

      PENDING (post-MVP):
      - Challenge.serverConfig IAM lock: allow.resource(scoringAgent) + allow.owner() only
        (field exists, candidates excluded client-side, but IAM enforcement not yet wired)
      - correctOptionId in Challenge.config still readable by authenticated clients
    </security>

  </core_features>

  <data_model>
    <canonical_source>amplify/data/resource.ts — all models defined here only</canonical_source>

    <models>
      <pipeline>
        - title (required)
        - level (enum: Junior | Mid | Senior | Staff | Principal | Lead | Manager)
        - stack (string[])
        - description
        - status (enum: DRAFT | ACTIVE | ARCHIVED)
        - schedulingUrl (url | null)
        - schedulingEventTypeId (string | null)
        - creationMode (enum: DEFAULT | BLANK)
        - stages → [Stage]
        - candidates → [Candidate]
        - codeArtifacts → [CodeArtifact]
        - scheduledInterviews → [ScheduledInterview]
      </pipeline>

      <stage>
        - pipelineId (FK → Pipeline)
        - name (string)
        - description (string)
        - order (integer, 1-indexed)
        - timeLimit (integer | null — minutes)
        - mode (enum: ASYNC | LIVE_VIDEO)
        - schedulingEventTypeId (string | null)
        - challenges → [Challenge]
        - videoSessions → [VideoSession]
        - notificationTemplates → [NotificationTemplate] (post-MVP)
        NOTE: Stage has NO type. It is a pure container.
      </stage>

      <challenge>
        - stageId (FK → Stage, optional for library templates)
        - type (enum: CODE_REVIEW | CODE_IMPLEMENTATION | QUIZ_MCQ | QUIZ_SHORT_ANSWER | FOLLOW_UP)
        - order (integer, 1-indexed within stage)
        - title (string)
        - instructions (string | null — markdown)
        - config (JSON — type-specific payload)
        - serverConfig (JSON | null — answer keys; field-level owner-only auth on CodeArtifact)
        - codeArtifactId (FK → CodeArtifact | null)
        - isTemplate (boolean)
        - isSystem (boolean)
        - tags (string[])
        - difficulty (enum: beginner | intermediate | advanced)
        - githubRepoUrl (string | null)
        - githubPrNumber (integer | null)
        - cachedDiffJson (string | null)
        - groundTruth (JSON | null)
        - groundTruthAnnotations (JSON | null)
        - practiceRepoUrl (string | null)
        - repoS3Key (string | null)
        - starterRepoS3Key (string | null)
      </challenge>

      <code_artifact>
        - pipelineId (FK → Pipeline)
        - title (string)
        - language (string)
        - code (string)
        - groundTruth (JSON | null — Bug[] answer key)
        - serverConfig (JSON | null — owner-only field-level auth)
      </code_artifact>

      <candidate>
        - pipelineId (FK → Pipeline)
        - name
        - email
        - inviteToken (UUID)
        - status (enum: INVITED | IN_PROGRESS | COMPLETED)
        - publicApiKey auth: ['update'] only (no read via publicApiKey)
        - assessments → [Assessment]
        - scheduledInterviews → [ScheduledInterview]
      </candidate>

      <assessment>
        - candidateId (FK → Candidate)
        - challengeId (FK → Challenge)
        - submission (JSON — type-specific)
        - score (float | null)
        - maxScore (float)
        - scoredAt (datetime | null)
        - reviewedByRecruiter (boolean)
        - submittedAt (datetime | null)
        - codeReviewAnnotations (JSON | null)
        - codeReviewSummary (string | null)
        - followUpQuestionsJson (string | null — FOLLOW_UP challenge Q&amp;A)
        - publicApiKey auth: ['create', 'update'] only
      </assessment>

      <video_session>
        - stageId (FK → Stage)
        - candidateId (FK → Candidate)
        - recruiterId (string)
        - status (enum: WAITING | CALLING | ACTIVE | ENDED)
        - signals → [VideoSignal]
      </video_session>

      <video_signal>
        - sessionId (FK → VideoSession)
        - senderId (string)
        - recipientId (string)
        - type (enum: OFFER | ANSWER | ICE_CANDIDATE | HANGUP)
        - payload (string)
        - auth: allow.authenticated() on VideoSignal
      </video_signal>

      <scheduled_interview>
        - candidateId (FK → Candidate)
        - pipelineId (FK → Pipeline)
        - stageId (FK → Stage | null)
        - status (enum: INVITED | SCHEDULED | COMPLETED | CANCELLED | NO_SHOW)
        - schedulingUrl (string)
        - schedulingProvider (enum: CALENDLY | CAL_COM | MANUAL)
        - scheduledAt (datetime | null)
        - meetingUrl (string | null)
        - notes (string | null)
        - externalEventId (string | null)
        - syncSource (string | null)
        - lastSyncedAt (datetime | null)
        - inviteLinkSentAt (datetime | null)
        - emailSentAt (datetime | null)
        - Secondary index: byExternalEventId (externalEventId)
        - Secondary index: byCandidateStatus (candidateId + status)
      </scheduled_interview>

      <scheduling_connection>
        - recruiterId (string)
        - provider (enum: CALENDLY | CAL_COM)
        - accessToken (string — encrypted)
        - refreshToken (string | null)
        - expiresAt (datetime | null)
        - providerUserId (string | null)
        - providerOrgUri (string | null)
      </scheduling_connection>

      <dev_container_session>
        - candidateId (FK → Candidate)
        - challengeId (FK → Challenge)
        - status (enum: PROVISIONING | BOOTING | READY | STOPPING | ERROR)
        - taskArn (string | null — custom identifier)
        - containerUrl (string | null)
        - logs (string | null)
        - Secondary index: byCandidateStatus (candidateId + status)
      </dev_container_session>

      <repo_template>
        - repoId (string — secondary index key)
        - title (string)
        - description (string | null)
        - language (string)
        - framework (string | null)
        - s3Key (string)
        - starterS3Key (string | null)
        - scoringRubric (JSON | null)
        - difficulty (enum: beginner | intermediate | advanced — secondary index key)
        - tags (string[])
        - isPublic (boolean)
        - Secondary index: byRepoId (repoId)
        - Secondary index: byDifficulty (difficulty)
      </repo_template>

      <role_context>
        - Preserved post-MVP model for agentic discovery
        - Do not delete
      </role_context>
    </models>

    <lambda_mutations_in_schema>
      generateQuestions        → questionAgent
      generateJobDescription   → jobDescriptionAgent
      scoreAssessment          → scoringAgent (fully implemented)
      generateFollowUps        → codeReviewFollowUpAgent (fully implemented)
      getTurnCredentials       → turnCredentials
      processSchedulingWebhook → schedulingWebhook
      exchangeSchedulingOAuth  → schedulingOAuth
      launchDevContainer       → devContainerLaunch
      destroyDevContainer      → devContainerDestroy
      getContainerStatus       → devContainerStatus
      getContainerLogs         → getContainerLogs
      sendNotification         → notificationService
      submitCodeReview         → submitCodeReview
      fetchGitHubPR            → fetchGitHubPR
      listGitHubPRs            → listGitHubPRs
      scoreCodeReview          → scoreCodeReview
      resolveToken             → resolveToken
    </lambda_mutations_in_schema>

    <challenge_config_types>
      <code_review_config>
        codeArtifactId?: string
        code?: string  (inline if not shared artifact)
        language: string
        title: string
      </code_review_config>

      <code_implementation_config>
        codeArtifactId?: string
        starterCode?: string
        language: string
        problemStatement: string  (markdown)
        examples?: Array&lt;{ input: string; output: string; explanation?: string }&gt;
        constraints?: string[]
      </code_implementation_config>

      <quiz_mcq_config>
        question: string
        options: Array&lt;{ id: string; text: string }&gt;
        correctOptionId: string  (answer key — move to serverConfig post-MVP)
        explanation?: string  (recruiter-only)
      </quiz_mcq_config>

      <quiz_short_answer_config>
        question: string
        placeholder?: string
        maxLength?: number
        rubric?: string  (recruiter-only)
      </quiz_short_answer_config>

      <follow_up_config>
        sourceAssessmentId?: string  (assessment that triggered follow-up generation)
      </follow_up_config>
    </challenge_config_types>

    <assessment_submission_types>
      <code_review_submission>
        annotations: Array&lt;{ line: number; comment: string; severity: 'critical'|'major'|'minor' }&gt;
        verdict?: string
        summary?: string
      </code_review_submission>
      <code_implementation_submission>
        code: string
      </code_implementation_submission>
      <quiz_mcq_submission>
        selectedOptionId: string
      </quiz_mcq_submission>
      <quiz_short_answer_submission>
        text: string
      </quiz_short_answer_submission>
      <follow_up_submission>
        answers: Array&lt;{ questionIndex: number; answer: string }&gt;
      </follow_up_submission>
    </assessment_submission_types>
  </data_model>

  <authorization_model>
    <auth_modes>userPool (recruiter, default) and apiKey (candidate, guest)</auth_modes>

    <access_table>
      Pipeline           | Recruiter: CRUD         | Candidate: No access
      Stage              | Recruiter: CRUD         | Candidate: Read only
      Challenge          | Recruiter: CRUD         | Candidate: Read only (serverConfig excluded client-side)
      CodeArtifact       | Recruiter: CRUD         | Candidate: Read only
      Candidate          | Recruiter: CRUD         | Candidate: Update only (via publicApiKey)
      Assessment         | Recruiter: CRUD         | Candidate: Create + Update (via publicApiKey)
      VideoSession       | Recruiter: CRUD         | Candidate: authenticated read
      VideoSignal        | Recruiter: CRUD         | Candidate: authenticated (allow.authenticated())
      ScheduledInterview | Recruiter: CRUD         | Candidate: Read only
      SchedulingConnection | Recruiter: CRUD       | Candidate: No access
      DevContainerSession | Recruiter: CRUD        | Candidate: Read only
      RepoTemplate       | Recruiter: CRUD         | Candidate: Read only
    </access_table>

    <notes>
      - resolveToken Lambda resolves inviteToken server-side; client never scans Candidate table directly
      - Candidate accesses their own record only via update (status update after token resolution)
      - Challenge.serverConfig excluded from client selectionSet in useAssessment (client-side only)
      - Post-MVP: Challenge.serverConfig needs allow.resource(scoringAgent) + allow.owner() IAM lock
      - correctOptionId in Challenge.config is readable by authenticated clients at MVP
    </notes>
  </authorization_model>

  <routes>
    <recruiter_routes>
      /                         → ListingPage (pipeline list)
      /pipeline/new             → PipelineCreatePage (archived/ variant)
      /pipeline/:id             → OverviewPage (pipeline detail + stages + candidates)
      /pipeline/:id/stages/:stageId → StageDetailPage (challenge management for a stage)
      /pipeline/:pipelineId/challenges/:challengeId → ChallengeEditorPage [GATED: FEATURE_FLAG_CHALLENGE_EDITOR=false]
      /candidates/:id           → CandidateProfilePage
      /screenings/:id/preview   → CandidateScreeningPage
      /schedule                 → SchedulingPage [GATED: FEATURE_FLAG_SCHEDULE_ROUTE=false]
      /sandbox/dev-container    → DevContainerSandboxPage [GATED: FEATURE_FLAG_DEV_CONTAINER_ROUTE=false]
      /prototype/report         → CandidateReportPrototype (ungated prototype)
      All recruiter routes wrapped in &lt;Authenticator&gt;
    </recruiter_routes>

    <candidate_routes>
      /assess/:token            → CandidateAssessmentPage (no auth, resolveToken Lambda)
    </candidate_routes>

    <unrouted_pages_exist>
      PipelineBuilderPage.tsx, ScreeningStageBuilderPage.tsx, DevContainerTestPage.tsx,
      PipeLineCreatePage.tsx (capital-L variant) — files exist but not in App.tsx
    </unrouted_pages_exist>
  </routes>

  <frontend_structure>
    src/
    ├── App.tsx                          Routes + feature flags
    ├── main.tsx                         Amplify.configure() entry point
    ├── pages/
    │   ├── ListingPage.tsx              Recruiter: pipeline list (search, filter, stats)
    │   ├── OverviewPage.tsx             Recruiter: pipeline detail + Kanban + candidates (dnd-kit)
    │   ├── StageDetailPage.tsx          Recruiter: challenge management within a stage (dnd-kit)
    │   ├── CandidateProfilePage.tsx     Recruiter: per-challenge scoring + IntelligenceReport (gated)
    │   ├── ChallengeEditorPage.tsx      Recruiter: tabbed challenge editor [GATED]
    │   ├── CandidateAssessmentPage.tsx  Candidate: full flow (welcome → challenges → scheduling)
    │   ├── SchedulingPage.tsx           Recruiter: scheduling dashboard [GATED]
    │   ├── DevContainerSandboxPage.tsx  Recruiter: dev container sandbox [GATED]
    │   ├── CandidateScreeningPage.tsx   Recruiter: screening preview
    │   ├── CandidateReportPrototype.tsx Prototype (ungated)
    │   ├── RoleDiscoveryPage.tsx        Post-MVP: agentic discovery (preserved, locked)
    │   └── archived/
    │       └── PipelineCreatePage.tsx   Active at /pipeline/new
    ├── hooks/
    │   ├── useAssessment.ts             Candidate flow: resolveToken, challenges, follow-up routing
    │   ├── usePipelineCreate.ts
    │   ├── useCandidateCreate.ts
    │   ├── useScheduledInterview.ts     Candidate: reads own ScheduledInterview
    │   ├── useScheduledInterviews.ts    Recruiter: list for SchedulingDashboard
    │   ├── useSchedulingConnection.ts   OAuth connection CRUD
    │   ├── useVideoSession.ts           WebRTC session
    │   ├── useVideoSignaling.ts         WebRTC signaling
    │   ├── useDevContainerSession.ts    Fargate session lifecycle
    │   ├── usePageMeta.tsx
    │   └── useRoleDiscovery.ts          Post-MVP (locked)
    ├── components/
    │   ├── ui/                          Design system primitives
    │   │   ├── LiquidMetalCard.tsx
    │   │   ├── MetalScoreRing.tsx
    │   │   ├── StatusBadge.tsx
    │   │   ├── ProgressBar.tsx
    │   │   ├── Toggle.tsx
    │   │   ├── TabNav.tsx
    │   │   ├── Skeleton.tsx
    │   │   ├── ButtonGroup.tsx
    │   │   ├── FormSection.tsx
    │   │   ├── NumberInput.tsx
    │   │   ├── SubTitle.tsx
    │   │   ├── Logo.tsx
    │   │   └── form/ (FieldGroup, TextInput, TextareaInput, SelectInput, RadioGroup, TagsInput, FieldLabel)
    │   ├── Assessment/
    │   │   ├── ChallengeRegistry.tsx    IoC router: challenge.type → renderer
    │   │   ├── CodeReviewChallenge.tsx  Full CODE_REVIEW renderer (DiffPanel + annotations + verdict)
    │   │   ├── DiffPanel.tsx            Diff viewer with annotation support
    │   │   ├── FollowUpQuestionsPanel.tsx FOLLOW_UP challenge renderer
    │   │   ├── GitHubPRFetcher.tsx      GitHub PR fetch/validate UI (in ChallengeEditorPage)
    │   │   ├── GroundTruthAnnotationEditor.tsx Admin ground truth tool (in ChallengeEditorPage)
    │   │   ├── SchedulingStep.tsx       Candidate-facing scheduling widget
    │   │   ├── StageShell.tsx           Timer, progress dots, navigation wrapper
    │   │   ├── StageRegistry.tsx        (may be legacy)
    │   │   ├── SubmissionPanel.tsx      Submission UI
    │   │   ├── TimerContext.tsx         Timer state provider
    │   │   ├── WelcomeScreen.tsx        Pre-assessment welcome
    │   │   ├── WorkspaceLayout.tsx      3-column CSS grid
    │   │   ├── panels/
    │   │   │   ├── DiffAnnotationPanel.tsx
    │   │   │   ├── MonacoPanel.tsx
    │   │   │   ├── OptionsPanel.tsx
    │   │   │   ├── PreviewPanel.tsx
    │   │   │   ├── ProblemPanel.tsx
    │   │   │   └── TextareaPanel.tsx
    │   │   └── shells/
    │   │       ├── TimerShell.tsx
    │   │       └── VideoShell.tsx
    │   ├── Analytics/
    │   │   └── IntelligenceReport.tsx   Rich candidate analytics (VITE_FEATURE_INTELLIGENCE_REPORT)
    │   ├── Scheduling/
    │   │   ├── ConnectionSetup.tsx
    │   │   ├── ConnectionStatusBadge.tsx
    │   │   ├── EventTypePicker.tsx
    │   │   ├── InterviewCard.tsx
    │   │   ├── InterviewStatusBadge.tsx
    │   │   ├── SchedulingDashboard.tsx
    │   │   ├── SchedulingFilters.tsx
    │   │   ├── StatusOverrideModal.tsx
    │   │   └── provider/
    │   │       ├── CalendlyProvider.tsx
    │   │       ├── CalComProvider.tsx
    │   │       ├── ManualProvider.tsx
    │   │       ├── types.ts
    │   │       └── index.ts
    │   ├── Video/
    │   │   ├── VideoControls.tsx
    │   │   ├── VideoDeviceCheck.tsx
    │   │   ├── VideoFloatingPiP.tsx
    │   │   ├── VideoIncomingCall.tsx
    │   │   └── VideoWaitingRoom.tsx
    │   ├── Pipeline/
    │   │   ├── ChallengeCard.tsx        Drag-and-drop challenge tile
    │   │   ├── ChallengePicker.tsx      Modal: static templates + GitHub PR browser
    │   │   └── CodeArtifactManager.tsx  Manage reusable code snippets
    │   └── RoleDiscovery/               Post-MVP agent chat UI (preserved, locked)
    ├── content/
    │   ├── challengeLibrary.ts          65 pre-built challenge templates (static)
    │   ├── codeReviewSnippets.ts        3 buggy code snippets + ground truth
    │   ├── quizQuestions.ts             MCQ bank
    │   ├── designTokens.ts
    │   ├── features.ts                  Re-export of lib/features
    │   ├── generateInviteToken.ts
    │   └── pipelinePresets.ts           DEFAULT + BLANK presets
    └── lib/
        ├── challenge/
        │   ├── resolveLayout.ts         challenge.type → panel layout
        │   └── resolveShells.ts         challenge.config → shells (timer, etc.)
        ├── scoring/
        │   ├── codeReview.ts            Pure client-side scorer (pending server-side move)
        │   ├── codeReview.test.ts
        │   └── quiz.ts
        ├── scheduling/
        │   ├── pluginRegistry.ts        Provider plugin registry
        │   ├── statusTransitions.ts     Valid state machine transitions
        │   └── types.ts
        ├── video/
        │   ├── mediaPermissions.ts
        │   ├── types.ts
        │   └── webrtcConfig.ts
        ├── utils.ts                     calculateSignal, sanitizeChallengeConfig, etc.
        ├── pipelinePresets.ts
        └── features.ts                  INTELLIGENCE_REPORT feature flag
  </frontend_structure>

  <lambda_functions>
    amplify/functions/
    ├── questionAgent/           COMPLETE — engineering standard reference implementation
    ├── codeReviewFollowUpAgent/ COMPLETE — Mistral LLM, 5 follow-up Qs, saves to Assessment
    ├── scoringAgent/            COMPLETE — full Mistral agentic scoring + deterministic fallback
    │                            (NOT a stub — reads DynamoDB, calls scorer.ts, writes score back)
    ├── resolveToken/            COMPLETE — secure inviteToken → candidate lookup
    ├── fetchGitHubPR/           COMPLETE — GitHub API, diff parsing, caching
    ├── listGitHubPRs/           COMPLETE — PR summary listing
    ├── scoreCodeReview/         COMPLETE — ground truth comparison scoring
    ├── submitCodeReview/        COMPLETE — assessment creation + scoring orchestration
    ├── turnCredentials/         COMPLETE — Metered.ca TURN server credentials
    ├── schedulingWebhook/       COMPLETE — Calendly + Cal.com webhook normalizers (with tests)
    ├── schedulingOAuth/         COMPLETE — OAuth exchange, refresh, fetchEventTypes (with tests)
    ├── notificationService/     COMPLETE — email notification (with tests)
    ├── notificationStreamService/ EXISTS — stream-based notification variant
    ├── devContainerLaunch/      EXISTS — ECS.RunTask invocation
    ├── devContainerDestroy/     EXISTS — ECS task termination
    ├── devContainerStatus/      EXISTS — status query
    ├── getContainerLogs/        EXISTS — CloudWatch log fetching
    ├── ecsStatusBridge/         EXISTS — ECS status → DynamoDB sync
    ├── repoManagement/          PARTIAL — scaffold + docs exist; implementation incomplete
    └── jobDescriptionAgent/     STUB — post-MVP
  </lambda_functions>

  <design_system>
    <philosophy>
      Brutalist Glassmorphic Chrome Aesthetic — industrial chrome surfaces, glassmorphic depth,
      bold geometric forms, monospace typography, deep dark foundation.
    </philosophy>

    <color_palette>
      --background: #0c0c0e
      --text-primary: #ffffff
      --text-secondary: rgba(255,255,255,0.6)
      --text-tertiary: rgba(255,255,255,0.4)
      --chrome-light: rgba(255,255,255,0.2)
      --success: #10b981
      --warning: #f59e0b
      --error: #ef4444
      --info: #3b82f6
      --ai-primary: rgba(139,92,246,0.8)
    </color_palette>

    <typography>
      Primary: "Space Mono", "Courier New", monospace
      Display: "Monument Extended", "Space Grotesk", sans-serif
      Body: 13px; Secondary: 11px; Labels: 9px; Micro: 7px
      Letter spacing: 0.4em (section labels), 0.2em (buttons/tags)
    </typography>

    <core_components>
      <liquid_metal_card>
        Core container — variants: default | chrome | mercury | dark
        backdrop-filter: blur(40px) saturate(150%)
        border-radius: 12px
        hover: translateY(-2px) + box-shadow + chrome sweep pseudo-element animation
      </liquid_metal_card>

      <layout>
        Max width: 1400px
        Sidebar: 80px fixed left
        Agent panel: 400px fixed (sidebar + 80px)
        Two page types: Shell (no SubHeader) and Context (with SubHeader showing pipeline breadcrumb)
      </layout>

      <status_badge>
        ACTIVE: rgba(150,255,150,0.8) / rgba(150,255,150,0.1)
        DRAFT: rgba(255,200,100,0.8) / rgba(255,200,100,0.1)
        ARCHIVED: rgba(255,255,255,0.4) / rgba(255,255,255,0.05)
        Font: 8px, weight 800, letter-spacing 0.20em, uppercase
      </status_badge>

      <animations>
        ease-standard: cubic-bezier(0.4,0,0.2,1)
        ease-smooth: cubic-bezier(0.16,1,0.3,1)
        Skeleton shimmer: 1.5s shimmer animation on loading states (no spinners)
        Score ring: stroke-dashoffset transition 1.2s ease-smooth
      </animations>
    </core_components>
  </design_system>

  <key_interactions>
    <recruiter_pipeline_creation>
      1. Click "+ CREATE" in ProfileHeader
      2. Fill form: title, level, stack, description
      3. Choose preset: DEFAULT (seeded stages) or BLANK
      4. Lands on OverviewPage with stages Kanban
      5. Add/reorder stages → click stage to open StageDetailPage
      6. Add challenges to each stage via ChallengePicker (static library or GitHub PR)
      7. Configure each challenge in ChallengeEditorPage [currently gated]
      8. Add candidate → copy invite link
      9. Set pipeline to ACTIVE
    </recruiter_pipeline_creation>

    <candidate_assessment_flow>
      1. Opens /assess/:token
      2. useAssessment calls resolveToken Lambda → gets {id, pipelineId, status, name}
      3. Loads stages + challenges (sorted by order)
      4. WelcomeScreen renders candidate name + pipeline context
      5. StageShell renders: header (stage name, timer), progress dots, challenge content
      6. ChallengeRegistry routes challenge.type → renderer
      7. FOLLOW_UP type handled above ChallengeRegistry in CandidateAssessmentPage
      8. Candidate works through challenges in order, submitting each
      9. CODE_REVIEW submit → submitCodeReview Lambda → scoreCodeReview Lambda → triggers codeReviewFollowUpAgent
      10. FOLLOW_UP challenge rendered after CODE_REVIEW with generated questions
      11. Stage complete → SchedulingStep (if schedulingUrl configured) → next stage
    </candidate_assessment_flow>

    <recruiter_review_flow>
      1. OverviewPage: candidate list sorted by score, signal label badge
      2. Click candidate → CandidateProfilePage
      3. Per-stage sections, per-challenge rows
      4. CODE_REVIEW shows score, bugs, annotations, follow-up Q&amp;A
      5. Auto-scored challenges show score immediately
      6. Manual challenges show "Awaiting score" + [Score now] button
      7. Score now → inline scoring UI (0–100 slider + rubric reference)
      8. Score saved → Assessment.update({ score, reviewedByRecruiter: true })
      9. Stage score + overall score recalculate
      10. IntelligenceReport (if VITE_FEATURE_INTELLIGENCE_REPORT=true) shows rich analytics
    </recruiter_review_flow>
  </key_interactions>

  <implementation_phases>
    <phase number="1" status="DONE">
      <title>Data Cleanup + Schema Purge</title>
      <notes>
        Stage.type, Stage.config, and ChallengeTemplate model are already removed from the schema.
        This task is complete. No action needed.
      </notes>
    </phase>

    <phase number="2" status="DONE">
      <title>Composable Challenge Renderers</title>
      <notes>
        MonacoChallenge (MonacoPanel), MCQChallenge (OptionsPanel), ShortAnswerChallenge (TextareaPanel),
        ProblemPanel, DiffAnnotationPanel, PreviewPanel all built. ChallengeRegistry wires all 4+1 types.
        ChallengePicker wired to challengeLibrary.ts + GitHub PR browser.
      </notes>
    </phase>

    <phase number="3" status="DONE">
      <title>Recruiter Review — Per-Challenge Scoring</title>
      <notes>
        CandidateProfilePage shows per-challenge results, manual scoring UI, follow-up Q&amp;A display,
        IntelligenceReport (feature-flagged). Score rollup to signal label implemented.
      </notes>
    </phase>

    <phase number="4" status="DONE — GATED">
      <title>Interview Scheduling</title>
      <notes>
        Fully built. SchedulingConnection + ScheduledInterview models, scheduling Lambdas, all
        provider components (Calendly/Cal.com/Manual), SchedulingDashboard, candidate SchedulingStep.
        Gated off: FEATURE_FLAG_SCHEDULE_ROUTE = false. Needs QA + ungate.
      </notes>
    </phase>

    <phase number="5" status="DONE — GATED">
      <title>ChallengeEditorPage + GitHub PR Integration</title>
      <notes>
        ChallengeEditorPage fully built with tabbed editor, GitHubPRFetcher, GroundTruthAnnotationEditor.
        fetchGitHubPR + listGitHubPRs Lambdas complete. ChallengePicker has GitHub PR browser.
        Gated off: FEATURE_FLAG_CHALLENGE_EDITOR = false. Needs QA + ungate.
      </notes>
    </phase>

    <phase number="6" status="NEXT PRIORITY">
      <title>Ungate + QA Gated Features</title>
      <tasks>
        - QA ChallengeEditorPage end-to-end → flip FEATURE_FLAG_CHALLENGE_EDITOR = true
        - QA Scheduling flow end-to-end → flip FEATURE_FLAG_SCHEDULE_ROUTE = true
        - Lock down Challenge.serverConfig IAM: allow.resource(scoringAgent) + allow.owner() only
        - Move correctOptionId to Challenge.serverConfig (post-security audit)
      </tasks>
    </phase>

    <phase number="7" status="PENDING">
      <title>Content Infrastructure — DynamoDB Challenge Library</title>
      <tasks>
        - seedChallengeLibrary.ts script: seed 65 static templates to DynamoDB RepoTemplate / Challenge models
        - /library page: browse, filter, preview templates
        - Update ChallengePicker to fetch from DynamoDB instead of static import
      </tasks>
    </phase>

    <phase number="8" status="PENDING">
      <title>Dev Container Sandbox</title>
      <notes>
        DevContainerSandboxPage, all ECS Lambdas, DevContainerSession model fully built.
        repoManagement Lambda scaffold exists but implementation incomplete.
        Gated off: FEATURE_FLAG_DEV_CONTAINER_ROUTE = false.
        Depends on repoManagement Lambda completion + ECS cluster provisioning.
      </notes>
    </phase>

    <phase number="9" status="POST-MVP">
      <title>Post-MVP — AI Features</title>
      <tasks>
        - AI-powered pipeline creation (AI_DRIVEN creationMode)
        - AI Discovery Agent (follow-up questions via useRoleDiscovery)
        - AI Review (scoreAgent for SHORT_ANSWER + CODE_IMPLEMENTATION)
        - Voice Input + Transcription epic (RecordingShell, S3 audio, transcription Lambda)
        - SYSTEM_DESIGN challenge type (diagramming canvas)
      </tasks>
    </phase>
  </implementation_phases>

  <engineering_conventions>
    - TypeScript strict mode — no `any`. Use `unknown` + type guards.
    - Named exports — no default exports except pages (required by lazy loading).
    - Explicit return types on all exported functions.
    - Amplify Data errors: always check `if (errors) throw new Error(errors[0].message)`.
    - Logging prefix: `console.error('[hookName] what failed:', context)`.
    - Hooks in src/hooks/, pages in src/pages/, reusable components in src/components/.
    - `npx tsc --noEmit` must pass before any commit.
    - CHANGELOG.md must be updated on every commit that touches source files.
    - ADRs required for every significant architectural decision (docs/decisions/).
    - Dev-only buttons/features gated behind `import.meta.env.DEV`.
    - All models defined exclusively in amplify/data/resource.ts.
    - Lambda pattern: follow questionAgent engineering standard exactly.
    - Feature flags for incomplete/unvalidated features: FEATURE_FLAG_* constants in App.tsx.
  </engineering_conventions>

  <what_not_to_build>
    - SYSTEM_DESIGN challenge type (needs diagramming library evaluation)
    - S3 media storage (not needed until voice/video stages)
    - Real-time subscriptions (polling on load is sufficient at MVP)
    - Per-challenge time limits (stage-level is sufficient at MVP)
    - Server-side scoring for QUIZ_MCQ (client-side acceptable, tracked in ADR)
    - Agentic challenge generation (manual curation faster to ship)
    - Additional WebRTC providers beyond Metered.ca TURN
  </what_not_to_build>

  <success_criteria>
    <functionality>
      - Recruiter creates a pipeline in under 5 minutes using DEFAULT preset
      - Recruiter configures challenges of all 5 types (incl. FOLLOW_UP) without bugs
      - Candidate completes assessment via invite link with zero sign-in friction
      - All 5 challenge types render and submit correctly
      - CODE_REVIEW triggers follow-up question generation automatically
      - Recruiter sees scored results per challenge on CandidateProfilePage
      - Manual scoring saves and rolls up to signal label
      - Gated features (scheduling, editor) pass QA and can be ungated
    </functionality>

    <technical_quality>
      - npx tsc --noEmit passes with zero errors
      - No `any` types in codebase
      - All Amplify Data errors properly caught and surfaced
      - Dev buttons unreachable in production build
      - CHANGELOG.md up to date on every commit
      - ADR written for every architectural decision
      - Challenge.serverConfig IAM lock implemented before ungating editor
    </technical_quality>

    <design_polish>
      - All new components use LiquidMetalCard + design system tokens
      - Space Mono font throughout
      - Skeleton shimmer on all loading states (no spinners)
      - Chrome sweep hover animation on all interactive cards
      - Type badge colors exactly match design spec
      - Signal labels (STRONG/YES/MAYBE/NO) rendered with correct styling
    </design_polish>
  </success_criteria>

  <key_files_reference>
    amplify/data/resource.ts            → Canonical data schema (all models live here only)
    amplify/auth/resource.ts            → Cognito config
    src/App.tsx                         → All routes + feature flags
    src/pages/CandidateAssessmentPage   → Candidate flow (welcome + ChallengeRegistry + scheduling)
    src/hooks/useAssessment.ts          → Candidate flow hook (resolveToken, challenges, follow-up)
    src/components/Assessment/ChallengeRegistry.tsx → Routes type → renderer
    src/components/Assessment/StageShell.tsx        → Timer, progress, nav wrapper
    src/components/Assessment/CodeReviewChallenge.tsx → Full CODE_REVIEW renderer
    src/components/Assessment/FollowUpQuestionsPanel.tsx → FOLLOW_UP renderer
    src/lib/scoring/codeReview.ts       → Keep as-is (pending server-side move)
    src/lib/scoring/quiz.ts             → Keep as-is
    src/lib/pipelinePresets.ts          → DEFAULT + BLANK presets
    src/content/challengeLibrary.ts     → 65 static challenge templates
    amplify/functions/questionAgent/    → Engineering standard for all Lambdas
    amplify/functions/scoringAgent/     → COMPLETE — Mistral agentic scoring (not a stub)
    amplify/functions/codeReviewFollowUpAgent/ → COMPLETE — follow-up question generation
    amplify/functions/resolveToken/     → COMPLETE — secure token resolution
    amplify/functions/submitCodeReview/ → COMPLETE — submission + scoring orchestration
    docs/design/challenge-architecture.md          → Challenge architecture design
    docs/design/monaco-challenge-architecture.md   → Composable Shell + Panel system
    docs/design/design-system.md        → Design tokens + component API
    docs/specs/engineering-standards.md → Lambda pattern standard
    docs/decisions/README.md            → ADR index
    TASKS.md                            → NOTE: significantly out of date as of 2026-03-23
    CHANGELOG.md                        → Update on every source commit
  </key_files_reference>

</project_specification>
