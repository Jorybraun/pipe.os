import { type ClientSchema, a, defineData } from "@aws-amplify/backend";
import { questionAgent } from "../functions/questionAgent/resource";
import { jobDescriptionAgent } from "../functions/jobDescriptionAgent/resource";
import { scoringAgent } from "../functions/scoringAgent/resource";
import { turnCredentials } from "../functions/turnCredentials/resource";
import { schedulingWebhook } from "../functions/schedulingWebhook/resource";
import { schedulingOAuth } from "../functions/schedulingOAuth/resource";
import { devContainerLaunch } from "../functions/devContainerLaunch/resource";
import { devContainerDestroy } from "../functions/devContainerDestroy/resource";
import { devContainerStatus } from "../functions/devContainerStatus/resource";
import { notificationService } from "../functions/notificationService/resource";
import { getContainerLogs } from "../functions/getContainerLogs/resource";
import { submitCodeReview } from "../functions/submitCodeReview/resource";
import { fetchGitHubPR } from "../functions/fetchGitHubPR/resource";
import { listGitHubPRs } from "../functions/listGitHubPRs/resource";
import { scoreCodeReview } from "../functions/scoreCodeReview/resource";
import { codeReviewFollowUpAgent } from "../functions/codeReviewFollowUpAgent/resource";
import { resolveToken } from "../functions/resolveToken/resource";
import { parseCandidateCV } from "../functions/parseCandidateCV/resource";
import { generateMediaUploadUrl } from "../functions/generateMediaUploadUrl/resource";
import { submitChallengeResponse } from "../functions/submitChallengeResponse/resource";
import { getNextChallenge } from "../functions/getNextChallenge/resource";
import { getChallenge } from "../functions/getChallenge/resource";
import { resetCandidate } from "../functions/resetCandidate/resource";
import { sessionAuthorizer } from "../functions/sessionAuthorizer/resource";
import { intelligenceReportAgent } from "../functions/intelligenceReportAgent/resource";

const schema = a.schema({
  /**
   * Pipeline Model
   *
   * Core entity for the Pipe platform. Represents a hiring pipeline
   * with a role definition, stages, and candidate assessments.
   */
  Pipeline: a
    .model({
      // Role identity
      title: a.string().required(),
      level: a.enum([
        "Junior",
        "Mid",
        "Senior",
        "Staff",
        "Principal",
        "Lead",
        "Manager",
      ]),
      stack: a.string().array(),
      description: a.string(),

      // Pipeline status
      status: a.enum(["DRAFT", "ACTIVE", "ARCHIVED"]),
      creationMode: a.enum(["BLANK", "PRESET", "AI_DRIVEN"]),

      // Relations
      stages: a.hasMany("Stage", "pipelineId"),
      candidates: a.hasMany("Candidate", "pipelineId"),
      codeArtifacts: a.hasMany("CodeArtifact", "pipelineId"),
      scheduledInterviews: a.hasMany("ScheduledInterview", "pipelineId"),

      // Scheduling URL for LIVE_VIDEO stages (e.g. Calendly or Cal.com link)
      schedulingUrl: a.url(),

      // Provider-specific event type ID for this pipeline
      schedulingEventTypeId: a.string(),

      // Link to discovery context (post-MVP: agentic discovery)
      roleContextId: a.id(),
    })
    .authorization((allow) => [
      allow.owner(), // Recruiters own their pipelines
    ]),

  /**
   * Stage Model
   */
  Stage: a
    .model({
      pipelineId: a.id().required(),
      pipeline: a.belongsTo("Pipeline", "pipelineId"),
      title: a.string().required(),
      description: a.string(),
      order: a.integer(),
      timeLimit: a.integer(), // Minutes
      mode: a.enum(["ASYNC", "LIVE_VIDEO"]), // Default: ASYNC
      videoConfig: a.json(), // { recordingEnabled: boolean }
      challenges: a.hasMany("Challenge", "stageId"),
      assessments: a.hasMany("Assessment", "stageId"),
      videoSessions: a.hasMany("VideoSession", "stageId"),
      scheduledInterviews: a.hasMany("ScheduledInterview", "stageId"),

      // Provider-specific event type ID for this stage
      schedulingEventTypeId: a.string(),

      // Adaptive Notifications: Customizable templates per-stage
      notificationTemplates: a.json(), // Array of { trigger: string, subject: string, body: string }
    })
    .authorization((allow) => [
      allow.owner(),
      allow.publicApiKey().to(["read"]), // Transition: remove after frontend migrates to lambda auth
      allow.custom().to(["read"]),
    ]),

  /**
   * VideoSession Model
   */
  VideoSession: a
    .model({
      stageId: a.id().required(),
      stage: a.belongsTo("Stage", "stageId"),
      candidateId: a.id().required(),
      recruiterId: a.string().required(), // Cognito sub of the recruiter
      status: a.enum(["WAITING", "CALLING", "ACTIVE", "ENDED"]),
      signals: a.hasMany("VideoSignal", "sessionId"),
    })
    .authorization((allow) => [
      allow.owner(), // Recruiter (Cognito owner)
      allow.publicApiKey().to(["read", "update"]), // Transition: remove after frontend migrates
      allow.custom().to(["read", "update"]),
    ]),

  /**
   * VideoSignal Model
   */
  VideoSignal: a
    .model({
      sessionId: a.id().required(),
      session: a.belongsTo("VideoSession", "sessionId"),
      senderRole: a.enum(["RECRUITER", "CANDIDATE"]),
      type: a.enum(["OFFER", "ANSWER", "ICE_CANDIDATE", "HANGUP"]),
      payload: a.json().required(), // SDP or ICE candidate JSON
    })
    .authorization((allow) => [
      allow.owner(), // Recruiter can write
      allow.authenticated().to(["read"]), // Recruiter can read candidate signals
      allow.publicApiKey().to(["create", "read"]), // Transition: remove after frontend migrates
      allow.custom().to(["create", "read"]),
    ]),

  /**
   * Challenge Model
   */
  Challenge: a
    .model({
      stageId: a.id().required(),
      stage: a.belongsTo("Stage", "stageId"),
      type: a.enum([
        "CODE_REVIEW",
        "CODE_IMPLEMENTATION",
        "QUIZ_MCQ",
        "QUIZ_SHORT_ANSWER",
        "FOLLOW_UP",
      ]),
      order: a.integer(),
      title: a.string().required(),
      instructions: a.string(),
      config: a.json(), // Public challenge-specific settings (e.g. MCQ options)
      serverConfig: a.json(), // Private answer keys, scoring rubrics, test cases

      // Linked code if applicable
      codeArtifactId: a.id(),
      codeArtifact: a.belongsTo("CodeArtifact", "codeArtifactId"),

      /**
       * Code Review Challenge Fields (STREAM2-001 through STREAM2-003)
       *
       * These fields enable repository-backed code review challenges.
       * Optional to avoid breaking existing CODE_IMPLEMENTATION, QUIZ_MCQ, QUIZ_SHORT_ANSWER challenges.
       */

      /** S3 path to the repository archive (e.g., "challenge-repos/slopify-admin/coupon-support/v1.0.0/repo.tar.gz") */
      repoS3Key: a.string(),

      /** Semantic version of the repository (e.g., 1, for v1.0.0) */
      repoVersion: a.integer(),

      /** Git branch for the candidate to review (e.g., "feature/coupon-support") */
      repoBranch: a.string(),

      /** Base branch for diff calculation (e.g., "main") */
      repoBaseBranch: a.string(),

      /** S3 path to the metadata JSON (e.g., "challenge-repos/slopify-admin/coupon-support/v1.0.0/metadata.json") */
      repoMetadataS3Key: a.string(),

      /**
       * GitHub PR Integration Fields (STREAM2-004: Phase 1)
       *
       * For CODE_REVIEW challenges backed by real GitHub PRs.
       * Enables fetching live PR data for candidate review.
       */

      /** GitHub repository URL (e.g., "https://github.com/owner/repo") */
      githubRepoUrl: a.string(),

      /** GitHub PR number (e.g., 42) */
      githubPrNumber: a.integer(),

      /** Cached PR title from GitHub (populated when challenge created) */
      githubPrTitle: a.string(),

      /** Cached PR description from GitHub */
      githubPrDescription: a.string(),

      /**
       * Cached diff in structured JSON format
       * { files: [{ path, status, additions, deletions, hunks: [...] }] }
       */
      cachedDiffJson: a.json(),

      /**
       * Cached PR metadata snapshot
       * { author, avatar, createdAt, state, labels, reviewers, etc. }
       */
      cachedMetadata: a.json().authorization((allow) => [allow.owner()]),

      /** When diff was cached (for cache expiry calculation) */
      diffCachedAt: a.datetime(),

      /**
       * Ground truth annotations for scoring
       * { "senior": [...], "mid": [...], "junior": [...] }
       */
      groundTruthAnnotations: a
        .json()
        .authorization((allow) => [allow.owner()]),

      /**
       * Practice Repository PR Challenge Fields (Phase 1)
       *
       * NEW: Fields for challenges backed by practice repository PRs.
       * These fields work alongside existing GitHub fields for the
       * internal practice repository architecture.
       *
       * IMMUTABLE: practiceRepo and prNumber cannot change after creation
       * to ensure challenge-to-PR references remain valid.
       */

      /**
       * GitHub repository path for practice repo (e.g., "Jorybraun/challenge")
       * Immutable — prevents orphaned challenge references
       * Format: "{owner}/{repo}"
       * Validation: Must match GitHub URL pattern
       */
      practiceRepo: a.string(),

      /**
       * GitHub PR number on the practice repository
       * Immutable — stores reference only, not cached copy
       * Example: 42 (for PR #42 on Jorybraun/challenge)
       * Validation: Must be > 0
       *
       * Rationale (ADR-002): PR is source of truth. If PR is deleted,
       * challenge becomes "archived" (not broken). Challenge stores
       * reference only, not diff copy (prevents staleness).
       */
      prNumber: a.integer(),

      /**
       * Feature branch name (e.g., "feature/user-auth")
       * Optional — metadata for creating new challenges
       *
       * Used by create-challenge-pr.sh to know which branch to create PR from.
       * Stored for reference, not enforced in real-time (PR structure is
       * single source of truth).
       */
      featureBranch: a.string(),

      /**
       * Base branch name (e.g., "main" or "release/v1.0")
       * Optional — metadata for PR scope
       *
       * Stored for reference. If base changes between challenge creation and
       * candidate review, candidate sees PR against new base (this is OK —
       * reflects real-world feature development).
       */
      baseBranch: a.string(),

      /**
       * Ground truth annotations for scoring (Phase 1 simplified version)
       *
       * Structure:
       * {
       *   "seniors": [...GroundTruthAnnotation],
       *   "mids": [...GroundTruthAnnotation],
       *   "juniors": [...GroundTruthAnnotation],
       *   "metadata": {
       *     "expectedFeedbackCount": number,
       *     "diffStats": { "additions": number, "deletions": number, "filesChanged": number },
       *     "estimatedMinutes": number,
       *     "createdBy": string (admin email),
       *     "createdAt": string (ISO timestamp)
       *   }
       * }
       *
       * Immutable after candidate review starts (frozen by system).
       * Admin can update before reviews start (via Challenge Creator UI).
       *
       * Note: groundTruthAnnotations continues to exist for backward
       * compatibility. New challenges should use groundTruth.
       */
      groundTruth: a.json().authorization((allow) => [allow.owner()]),

      challengeSubmissions: a.hasMany("ChallengeSubmission", "challengeId"),
    })
    .secondaryIndexes((index) => [
      /**
       * GSI for efficient querying by practice repository and PR number
       * Used by Phase 3-4 to lookup challenges by PR reference
       * Example: practiceRepo=Jorybraun/challenge, prNumber=42
       */
      index("practiceRepo")
        .sortKeys(["prNumber"])
        .name("challengesByPracticeRepoAndPR"),
    ])
    .authorization((allow) => [
      allow.owner(),
      allow.publicApiKey().to(["read"]), // Transition: remove after frontend migrates
      allow.custom().to(["read"]),
    ]),

  /**
   * CodeArtifact Model
   */
  CodeArtifact: a
    .model({
      pipelineId: a.id().required(),
      pipeline: a.belongsTo("Pipeline", "pipelineId"),
      title: a.string(),
      language: a.string(),
      code: a.string(),
      groundTruth: a.json().authorization((allow) => [allow.owner()]), // Legacy: move to serverConfig post-migration
      serverConfig: a.json().authorization((allow) => [allow.owner()]), // Private answer keys / hidden test cases
      challenges: a.hasMany("Challenge", "codeArtifactId"),
    })
    .authorization((allow) => [
      allow.owner(),
      allow.publicApiKey().to(["read"]), // Transition: remove after frontend migrates
      allow.custom().to(["read"]),
    ]),

  /**
   * Candidate Model
   */
  Candidate: a
    .model({
      pipelineId: a.id().required(),
      pipeline: a.belongsTo("Pipeline", "pipelineId"),
      name: a.string(),
      email: a.email(),
      inviteToken: a.string().required(), // UUID used in candidate-facing URL, no auth required
      status: a.enum(["INVITED", "IN_PROGRESS", "COMPLETED"]),
      currentStageId: a.id(), // Track current stage manually for drag-and-drop movement

      // CV Parsing & Profile Data
      skills: a.string().array(),
      yearsOfExperience: a.integer(),
      currentRole: a.string(),
      education: a.string().array(),
      /** @deprecated Use CandidateMedia with type=RESUME instead. Kept for backward compat. */
      resumeS3Key: a.string(),

      // Relations
      assessments: a.hasMany("Assessment", "candidateId"),
      media: a.hasMany("CandidateMedia", "candidateId"),
      scheduledInterviews: a.hasMany("ScheduledInterview", "candidateId"),
    })
    .secondaryIndexes((index) => [index("email").name("candidatesByEmail")])
    .authorization((allow) => [
      allow.owner(),
      allow.publicApiKey().to(["update"]), // Transition: remove after frontend migrates
      allow.custom().to(["update"]),
    ]),

  /**
   * CandidateMedia Model
   */
  CandidateMedia: a
    .model({
      candidateId: a.id().required(),
      candidate: a.belongsTo("Candidate", "candidateId"),

      type: a.enum([
        "RESUME",
        "VIDEO_RECORDING",
        "AUDIO_RECORDING",
        "ATTACHMENT",
      ]),

      /** S3 object key — e.g. "candidates/abc/documents/resume.pdf" */
      s3Key: a.string().required(),

      /** Original filename for display in recruiter UI */
      filename: a.string().required(),

      /** MIME type — e.g. "application/pdf", "video/webm" */
      mimeType: a.string(),

      /**
       * Stage this asset belongs to — set for recordings, null for resumes.
       * Enables "show me all recordings for stage X" queries.
       */
      stageId: a.id(),
    })
    .authorization((allow) => [
      allow.owner(), // Recruiter owns all candidate media records
      allow.publicApiKey().to(["create"]), // Transition: remove after frontend migrates
      allow.custom().to(["create"]),
    ]),

  /**
   * Assessment Model (ADR-023)
   */
  Assessment: a
    .model({
      candidateId: a.id().required(),
      candidate: a.belongsTo("Candidate", "candidateId"),

      stageId: a.id().required(),
      stage: a.belongsTo("Stage", "stageId"),

      /** Cognito sub of the recruiter who owns the pipeline. Set server-side
       *  so the recruiter can read assessments via ownerDefinedIn authorization. */
      ownerId: a.string(),

      /** Recruiter-controlled status. NEVER set by candidate submission flow. */
      status: a.enum(["PENDING", "IN_PROGRESS", "COMPLETED", "REVIEWED"]),

      /** Aggregate score computed from ChallengeSubmissions. Overridable by recruiter. */
      score: a.float(),

      /** Recruiter summary notes */
      feedback: a.string(),

      /** When the candidate entered this stage */
      startedAt: a.datetime(),

      /** When all challenges in this stage were completed */
      completedAt: a.datetime(),

      /** Child submissions — one per challenge attempted */
      challengeSubmissions: a.hasMany("ChallengeSubmission", "assessmentId"),
    })
    .secondaryIndexes((index) => [
      index("candidateId")
        .sortKeys(["stageId"])
        .name("assessmentsByCandidateAndStage"),
    ])
    .authorization((allow) => [
      allow.owner(),
      allow.ownerDefinedIn("ownerId").to(["read", "update"]),
      allow.publicApiKey().to(["create", "update"]), // Transition: remove after frontend migrates
      allow.custom().to(["create", "update"]),
    ]),

  /**
   * ChallengeSubmission Model (ADR-023)
   */
  ChallengeSubmission: a
    .model({
      assessmentId: a.id().required(),
      assessment: a.belongsTo("Assessment", "assessmentId"),

      challengeId: a.id().required(),
      challenge: a.belongsTo("Challenge", "challengeId"),

      /** Cognito sub of the recruiter. Set server-side for ownerDefinedIn auth. */
      ownerId: a.string(),

      /** Candidate's answers/annotations — challenge-type-specific JSON */
      submission: a.json(),

      /** Score (0-100) set by scoring pipeline */
      score: a.float(),

      /** Feedback from scoring agent or recruiter */
      feedback: a.string(),

      /** When the candidate submitted this challenge */
      submittedAt: a.datetime(),

      /** When the scoring agent completed scoring */
      scoredAt: a.datetime(),

      /** Array of { fileId, line, severity, comment, timestamp } annotations (CODE_REVIEW) */
      codeReviewAnnotations: a.json(),

      /** Candidate's overall summary of the code review (CODE_REVIEW) */
      codeReviewSummary: a.string(),

      /**
       * Follow-up questions + answers generated after challenge submission.
       * Shape: { questions: FollowUpQuestion[], answers: FollowUpAnswer[], generatedAt: string }
       */
      followUpQuestionsJson: a.json(),
    })
    .secondaryIndexes((index) => [
      index("assessmentId")
        .sortKeys(["challengeId"])
        .name("submissionsByAssessmentAndChallenge"),
    ])
    .authorization((allow) => [
      allow.owner(),
      allow.ownerDefinedIn("ownerId").to(["read", "update"]),
      allow.publicApiKey().to(["create", "update"]), // Transition: remove after frontend migrates
      allow.custom().to(["create", "update"]),
    ]),

  /**
   * ScheduledInterview Model
   */
  ScheduledInterview: a
    .model({
      candidateId: a.id().required(),
      candidate: a.belongsTo("Candidate", "candidateId"),
      pipelineId: a.id().required(),
      pipeline: a.belongsTo("Pipeline", "pipelineId"),
      stageId: a.id().required(),
      stage: a.belongsTo("Stage", "stageId"),
      status: a.enum([
        "INVITED",
        "SCHEDULED",
        "COMPLETED",
        "CANCELLED",
        "NO_SHOW",
      ]),
      scheduledAt: a.datetime(),
      meetingUrl: a.url(),
      schedulingProvider: a.enum(["CALENDLY", "CAL_COM", "MANUAL"]),
      schedulingUrl: a.url(),
      externalEventId: a.string(),
      recruiterNotes: a.string(),

      // IoC Phase A: Automated sync tracking
      syncSource: a.enum(["MANUAL", "WEBHOOK"]),
      lastSyncedAt: a.datetime(),

      // Audit & UX tracking: When was the link copied or email sent?
      inviteLinkSentAt: a.datetime(),
      emailSentAt: a.datetime(),
    })
    .secondaryIndexes((index) => [
      index("externalEventId").name("interviewsByExternalEventId"),
      index("candidateId")
        .sortKeys(["status"])
        .name("interviewsByCandidateIdAndStatus"),
    ])
    .authorization((allow) => [
      allow.owner(),
      allow.publicApiKey().to(["read"]), // Transition: remove after frontend migrates
      allow.custom().to(["read"]),
    ]),

  /**
   * SchedulingConnection Model
   */
  SchedulingConnection: a
    .model({
      recruiterId: a.string().required(),
      providerId: a.enum(["CALENDLY", "CAL_COM"]),
      accessToken: a.string().required(),
      refreshToken: a.string(),
      tokenExpiry: a.datetime(),
      accountEmail: a.string(),
      accountName: a.string(),
      webhookSecret: a.string(),
      webhookId: a.string(),
      status: a.enum(["ACTIVE", "EXPIRED", "REVOKED"]),
      connectedAt: a.datetime().required(),
      lastSyncAt: a.datetime(),
    })
    .authorization((allow) => [allow.owner()]),

  /**
   * RoleContext Model
   */
  RoleContext: a
    .model({
      owner: a.string(),
      title: a.string(),
      level: a.enum([
        "junior",
        "mid",
        "senior",
        "staff",
        "principal",
        "lead",
        "manager",
      ]),
      department: a.string(),
      workModel: a.enum(["remote", "hybrid", "onsite"]),
      teamSize: a.string(),
      reportsTo: a.string(),
      stack: a.string().array(),
      context: a.json(),
      exchanges: a.json(),
      status: a.enum(["baseline", "exploring", "almost_ready", "ready"]),
      gaps: a.string().array(),
      userSignals: a.json(),
      jobDescription: a.json(),
      candidateFilters: a.json(),
      suggestedStages: a.json(),
    })
    .authorization((allow) => [allow.owner()]),

  /**
   * RepoTemplate Model
   */
  RepoTemplate: a
    .model({
      repoId: a.string().required(),
      app: a.string().required(),
      type: a.enum(["CODE_REVIEW", "CODE_IMPLEMENTATION"]),
      title: a.string().required(),
      description: a.string(),
      difficulty: a.enum(["BEGINNER", "INTERMEDIATE", "ADVANCED"]),
      estimatedMinutes: a.integer().required(),
      s3Key: a.string().required(),
      metadataS3Key: a.string().required(),
      version: a.string().required(),
      instructions: a.string().required(),
      scoring: a.json().required(),
    })
    .secondaryIndexes((index) => [
      index("repoId").name("repoTemplatesByRepoId"),
      index("difficulty").name("repoTemplatesByDifficulty"),
    ])
    .authorization((allow) => [
      allow.owner(),
      allow.publicApiKey().to(["read"]),
    ]),

  /**
   * DevContainerSession Model
   */
  DevContainerSession: a
    .model({
      taskArn: a.string().required(),
      sessionId: a.string().required(),
      status: a.enum([
        "PROVISIONING",
        "BOOTING",
        "READY",
        "STOPPING",
        "ERROR",
      ]),
      url: a.string(),
      albTargetGroupArn: a.string(),
      albListenerRuleArn: a.string(),
    })
    .identifier(["taskArn"])
    .authorization((allow) => [
      allow.authenticated(),
      allow.publicApiKey().to(["create", "update"]),
    ]),

  /**
   * AI Agent Mutations
   */
  generateQuestions: a
    .mutation()
    .arguments({
      roleContext: a.json().required(),
      responses: a.json(),
    })
    .returns(a.json())
    .handler(a.handler.function(questionAgent))
    .authorization((allow) => [allow.authenticated()]),

  generateJobDescription: a
    .mutation()
    .arguments({
      roleContext: a.json().required(),
    })
    .returns(a.json())
    .handler(a.handler.function(jobDescriptionAgent))
    .authorization((allow) => [allow.authenticated()]),

  scoreChallengeSubmission: a
    .mutation()
    .arguments({
      challengeSubmissionId: a.id().required(),
    })
    .returns(a.json())
    .handler(a.handler.function(scoringAgent))
    .authorization((allow) => [allow.publicApiKey(), allow.custom()]),

  generateFollowUps: a
    .mutation()
    .arguments({
      challengeSubmissionId: a.id().required(),
    })
    .returns(a.json())
    .handler(a.handler.function(codeReviewFollowUpAgent))
    .authorization((allow) => [allow.publicApiKey(), allow.custom()]),

  /**
   * generateIntelligenceReport
   *
   * Aggregates all candidate assessment data and generates a structured,
   * block-based report using an LLM. Decisions on which blocks to include
   * and their priority are made by the AI.
   */
  generateIntelligenceReport: a
    .mutation()
    .arguments({
      candidateId: a.id().required(),
    })
    .returns(a.json())
    .handler(a.handler.function(intelligenceReportAgent))
    .authorization((allow) => [allow.authenticated()]),

  getTurnCredentials: a
    .query()
    .returns(a.json())
    .handler(a.handler.function(turnCredentials))
    .authorization((allow) => [allow.authenticated()]),

  processSchedulingWebhook: a
    .mutation()
    .arguments({
      provider: a.string().required(),
      payload: a.json().required(),
    })
    .returns(a.json())
    .handler(a.handler.function(schedulingWebhook))
    .authorization((allow) => [allow.publicApiKey()]),

  exchangeSchedulingOAuth: a
    .mutation()
    .arguments({
      action: a.string().required(),
      params: a.json().required(),
    })
    .returns(a.json())
    .handler(a.handler.function(schedulingOAuth))
    .authorization((allow) => [allow.authenticated()]),

  /**
   * Dev Container Mutations / Queries
   */
  launchDevContainer: a
    .mutation()
    .arguments({
      sessionId: a.string().required(),
    })
    .returns(a.json())
    .handler(a.handler.function(devContainerLaunch))
    .authorization((allow) => [allow.authenticated()]),

  destroyDevContainer: a
    .mutation()
    .arguments({
      taskArn: a.string().required(),
    })
    .returns(a.json())
    .handler(a.handler.function(devContainerDestroy))
    .authorization((allow) => [allow.authenticated()]),

  getContainerStatus: a
    .query()
    .arguments({
      taskArn: a.string().required(),
    })
    .returns(a.json())
    .handler(a.handler.function(devContainerStatus))
    .authorization((allow) => [allow.authenticated()]),

  getContainerLogs: a
    .query()
    .arguments({
      taskArn: a.string().required(),
      limit: a.integer(),
    })
    .returns(a.json())
    .handler(a.handler.function(getContainerLogs))
    .authorization((allow) => [allow.authenticated()]),

  /**
   * Adaptive Notification Mutation
   */
  sendNotification: a
    .mutation()
    .arguments({
      candidateId: a.id().required(),
      stageId: a.id().required(),
      templateType: a.enum(["INVITATION", "SUCCESS", "FAILURE"]),
    })
    .returns(a.json())
    .handler(a.handler.function(notificationService))
    .authorization((allow) => [allow.authenticated()]),

  /**
   * submitCodeReview
   */
  submitCodeReview: a
    .mutation()
    .arguments({
      challengeSubmissionId: a.id().required(),
      challengeId: a.id().required(),
      userId: a.string().required(),
      studioId: a.string().required(),
      codeReviewAnnotations: a.json().required(),
      codeReviewSummary: a.string(),
    })
    .returns(a.json())
    .handler(a.handler.function(submitCodeReview))
    .authorization((allow) => [allow.publicApiKey(), allow.custom()]),

  /**
   * fetchGitHubPR
   */
  fetchGitHubPR: a
    .mutation()
    .arguments({
      repoUrl: a.string().required(),
      prNumber: a.integer().required(),
      skipCache: a.boolean(),
    })
    .returns(a.json())
    .handler(a.handler.function(fetchGitHubPR))
    .authorization((allow) => [
      allow.authenticated(),
      allow.publicApiKey(),
      allow.custom(),
    ]),

  /**
   * listGitHubPRs
   */
  listGitHubPRs: a
    .mutation()
    .arguments({
      repoUrl: a.string().required(),
      state: a.string(),
    })
    .returns(a.json())
    .handler(a.handler.function(listGitHubPRs))
    .authorization((allow) => [allow.authenticated()]),

  /**
   * scoreCodeReview
   */
  scoreCodeReview: a
    .mutation()
    .arguments({
      challengeSubmissionId: a.id().required(),
      candidateAnnotations: a.json().required(),
      groundTruthAnnotations: a.json().required(),
      reviewerLevel: a.string(),
    })
    .returns(a.json())
    .handler(a.handler.function(scoreCodeReview))
    .authorization((allow) => [
      allow.authenticated(),
    ]),

  /**
   * resolveToken
   */
  resolveToken: a
    .query()
    .arguments({ inviteToken: a.string().required() })
    .returns(
      a.customType({
        id: a.string(),
        pipelineId: a.string(),
        status: a.string(),
        name: a.string(),
        sessionToken: a.string(),
      }),
    )
    .handler(a.handler.function(resolveToken))
    .authorization((allow) => [allow.publicApiKey()]),

  /**
   * getStageConfig
   */
  getStageConfig: a
    .mutation()
    .arguments({
      inviteToken: a.string().required(),
    })
    .returns(a.json())
    .handler(a.handler.function(getNextChallenge))
    .authorization((allow) => [allow.publicApiKey(), allow.custom()]),

  /**
   * getChallenge
   */
  getChallenge: a
    .mutation()
    .arguments({
      inviteToken: a.string().required(),
      order: a.integer().required(),
    })
    .returns(a.json())
    .handler(a.handler.function(getChallenge))
    .authorization((allow) => [allow.publicApiKey(), allow.custom()]),

  /**
   * submitChallengeResponse
   */
  submitChallengeResponse: a
    .mutation()
    .arguments({
      inviteToken: a.string().required(),
      order: a.integer().required(),
      submission: a.string().required(),
    })
    .returns(
      a.customType({
        success: a.boolean().required(),
        challengeSubmissionId: a.string(),
        error: a.string(),
      }),
    )
    .handler(a.handler.function(submitChallengeResponse))
    .authorization((allow) => [allow.publicApiKey(), allow.custom()]),

  /**
   * resetCandidate
   */
  resetCandidate: a
    .mutation()
    .arguments({ candidateId: a.id().required() })
    .returns(
      a.customType({
        success: a.boolean().required(),
        error: a.string(),
      }),
    )
    .handler(a.handler.function(resetCandidate))
    .authorization((allow) => [allow.authenticated()]),

  /**
   * generateMediaUploadUrl
   */
  generateMediaUploadUrl: a
    .mutation()
    .arguments({
      candidateId: a.id().required(),
      challengeId: a.id().required(),
      mimeType: a.string().required(),
      mediaType: a.string().required(),
    })
    .returns(
      a.customType({
        uploadUrl: a.string().required(),
        s3Key: a.string().required(),
      }),
    )
    .handler(a.handler.function(generateMediaUploadUrl))
    .authorization((allow) => [allow.publicApiKey(), allow.custom()]),

  /**
   * parseCandidateCV
   */
  parseCandidateCV: a
    .mutation()
    .arguments({
      candidateId: a.id().required(),
      resumeS3Key: a.string().required(),
    })
    .returns(a.json())
    .handler(a.handler.function(parseCandidateCV))
    .authorization((allow) => [allow.authenticated()]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: "userPool",
    apiKeyAuthorizationMode: {
      expiresInDays: 365,
    },
    lambdaAuthorizationMode: {
      function: sessionAuthorizer,
      timeToLiveInSeconds: 300,
    },
  },
});
