import { type ClientSchema, a, defineData } from "@aws-amplify/backend";
import { questionAgent } from '../functions/questionAgent/resource';
import { jobDescriptionAgent } from '../functions/jobDescriptionAgent/resource';
import { scoringAgent } from '../functions/scoringAgent/resource';
import { turnCredentials } from '../functions/turnCredentials/resource';
import { schedulingWebhook } from '../functions/schedulingWebhook/resource';
import { schedulingOAuth } from '../functions/schedulingOAuth/resource';
import { devContainerLaunch } from '../functions/devContainerLaunch/resource';
import { devContainerDestroy } from '../functions/devContainerDestroy/resource';
import { devContainerStatus } from '../functions/devContainerStatus/resource';
import { notificationService } from '../functions/notificationService/resource';
import { getContainerLogs } from '../functions/getContainerLogs/resource';
import { submitCodeReview } from '../functions/submitCodeReview/resource';
import { fetchGitHubPR } from '../functions/fetchGitHubPR/resource';
import { listGitHubPRs } from '../functions/listGitHubPRs/resource';
import { scoreCodeReview } from '../functions/scoreCodeReview/resource';

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
      level: a.enum(['Junior', 'Mid', 'Senior', 'Staff', 'Principal', 'Lead', 'Manager']),
      stack: a.string().array(),
      description: a.string(),

      // Pipeline status
      status: a.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']),
      creationMode: a.enum(['BLANK', 'PRESET', 'AI_DRIVEN']),

      // Relations
      stages: a.hasMany('Stage', 'pipelineId'),
      candidates: a.hasMany('Candidate', 'pipelineId'),
      codeArtifacts: a.hasMany('CodeArtifact', 'pipelineId'),
      scheduledInterviews: a.hasMany('ScheduledInterview', 'pipelineId'),

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
      pipeline: a.belongsTo('Pipeline', 'pipelineId'),
      title: a.string().required(),
      description: a.string(),
      order: a.integer(),
      timeLimit: a.integer(), // Minutes
      mode: a.enum(['ASYNC', 'LIVE_VIDEO']), // Default: ASYNC
      videoConfig: a.json(), // { recordingEnabled: boolean }
      challenges: a.hasMany('Challenge', 'stageId'),
      videoSessions: a.hasMany('VideoSession', 'stageId'),
      scheduledInterviews: a.hasMany('ScheduledInterview', 'stageId'),

      // Provider-specific event type ID for this stage
      schedulingEventTypeId: a.string(),

      // Adaptive Notifications: Customizable templates per-stage
      notificationTemplates: a.json(), // Array of { trigger: string, subject: string, body: string }
    })
    .authorization((allow) => [
      allow.owner(),
      allow.publicApiKey().to(['read']),
    ]),

  /**
   * VideoSession Model
   */
  VideoSession: a
    .model({
      stageId: a.id().required(),
      stage: a.belongsTo('Stage', 'stageId'),
      candidateId: a.id().required(),
      recruiterId: a.string().required(), // Cognito sub of the recruiter
      status: a.enum(['WAITING', 'CALLING', 'ACTIVE', 'ENDED']),
      signals: a.hasMany('VideoSignal', 'sessionId'),
    })
    .authorization((allow) => [
      allow.owner(),                          // Recruiter (Cognito owner)
      allow.publicApiKey().to(['read', 'update']), // Candidate via API key
    ]),

  /**
   * VideoSignal Model
   */
  VideoSignal: a
    .model({
      sessionId: a.id().required(),
      session: a.belongsTo('VideoSession', 'sessionId'),
      senderRole: a.enum(['RECRUITER', 'CANDIDATE']),
      type: a.enum(['OFFER', 'ANSWER', 'ICE_CANDIDATE', 'HANGUP']),
      payload: a.json().required(), // SDP or ICE candidate JSON
    })
    .authorization((allow) => [
      allow.owner(),                               // Recruiter can write
      allow.authenticated().to(['read']),           // Recruiter can read candidate signals
      allow.publicApiKey().to(['create', 'read']), // Candidate can signal back
    ]),

  /**
   * Challenge Model
   */
  Challenge: a
    .model({
      stageId: a.id().required(),
      stage: a.belongsTo('Stage', 'stageId'),
      type: a.enum(['CODE_REVIEW', 'CODE_IMPLEMENTATION', 'QUIZ_MCQ', 'QUIZ_SHORT_ANSWER']),
      order: a.integer(),
      title: a.string().required(),
      instructions: a.string(),
      config: a.json(), // Public challenge-specific settings (e.g. MCQ options)
      serverConfig: a.json(), // Private answer keys, scoring rubrics, test cases
      
      // Linked code if applicable
      codeArtifactId: a.id(),
      codeArtifact: a.belongsTo('CodeArtifact', 'codeArtifactId'),

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
      cachedMetadata: a.json(),
      
      /** When diff was cached (for cache expiry calculation) */
      diffCachedAt: a.datetime(),
      
      /**
       * Ground truth annotations for scoring
       * { "senior": [...], "mid": [...], "junior": [...] }
       */
      groundTruthAnnotations: a.json(),

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
      groundTruth: a.json(),

      assessments: a.hasMany('Assessment', 'challengeId'),
    })
    .secondaryIndexes((index) => [
      /**
       * GSI for efficient querying by practice repository and PR number
       * Used by Phase 3-4 to lookup challenges by PR reference
       * Example: practiceRepo=Jorybraun/challenge, prNumber=42
       */
      index('practiceRepo').sortKeys(['prNumber']).name('challengesByPracticeRepoAndPR'),
    ])
    .authorization((allow) => [
      allow.owner(),
      allow.publicApiKey().to(['read']),
    ]),

  /**
   * CodeArtifact Model
   */
  CodeArtifact: a
    .model({
      pipelineId: a.id().required(),
      pipeline: a.belongsTo('Pipeline', 'pipelineId'),
      title: a.string(),
      language: a.string(),
      code: a.string(),
      groundTruth: a.json(), // Legacy: move to serverConfig post-migration
      serverConfig: a.json(), // Private answer keys / hidden test cases
      challenges: a.hasMany('Challenge', 'codeArtifactId'),
    })
    .authorization((allow) => [
      allow.owner(),
      allow.publicApiKey().to(['read']),
    ]),

  /**
   * Candidate Model
   */
  Candidate: a
    .model({
      pipelineId: a.id().required(),
      pipeline: a.belongsTo('Pipeline', 'pipelineId'),
      name: a.string(),
      email: a.email(),
      inviteToken: a.string().required(), // UUID used in candidate-facing URL, no auth required
      status: a.enum(['INVITED', 'IN_PROGRESS', 'COMPLETED']),

      // Relations
      assessments: a.hasMany('Assessment', 'candidateId'),
      scheduledInterviews: a.hasMany('ScheduledInterview', 'candidateId'),
    })
    .secondaryIndexes((index) => [
      index('email').name('candidatesByEmail'),
    ])
    .authorization((allow) => [
      allow.owner(),                        
      allow.publicApiKey().to(['read', 'update']), 
    ]),

  /**
   * Assessment Model
   */
  Assessment: a
    .model({
      candidateId: a.id().required(),
      candidate: a.belongsTo('Candidate', 'candidateId'),
      
      challengeId: a.id(), // New relationship in Phase 7
      challenge: a.belongsTo('Challenge', 'challengeId'),

      submission: a.json(),    // Candidate's answers/annotations
      score: a.float(),
      feedback: a.string(),    // Internal recruiter notes
      completedAt: a.datetime(),

      /**
       * Code Review Assessment Fields (STREAM2-004)
       * 
       * These fields capture code review-specific submission data.
       * Optional to support existing assessment types without code review data.
       */
      
      /** Array of { fileId, line, severity, comment, timestamp } annotations made by candidate */
      codeReviewAnnotations: a.json(),
      
      /** Candidate's overall summary/assessment of the code review */
      codeReviewSummary: a.string(),
      
      /** When the candidate submitted their review (distinct from completedAt which is scoring time) */
      submittedAt: a.datetime(),
    })
    .authorization((allow) => [
      allow.owner(),                        
      allow.publicApiKey().to(['create', 'read']), 
    ]),

  /**
   * ScheduledInterview Model
   */
  ScheduledInterview: a
    .model({
      candidateId:        a.id().required(),
      candidate:          a.belongsTo('Candidate', 'candidateId'),
      pipelineId:         a.id().required(),
      pipeline:           a.belongsTo('Pipeline', 'pipelineId'),
      stageId:            a.id().required(),
      stage:              a.belongsTo('Stage', 'stageId'),
      status:             a.enum(['INVITED', 'SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW']),
      scheduledAt:        a.datetime(),
      meetingUrl:         a.url(),
      schedulingProvider: a.enum(['CALENDLY', 'CAL_COM', 'MANUAL']),
      schedulingUrl:      a.url(),
      externalEventId:    a.string(),
      recruiterNotes:     a.string(),

      // IoC Phase A: Automated sync tracking
      syncSource:         a.enum(['MANUAL', 'WEBHOOK']),
      lastSyncedAt:       a.datetime(),

      // Audit & UX tracking: When was the link copied or email sent?
      inviteLinkSentAt:   a.datetime(),
      emailSentAt:        a.datetime(),
    })
    .secondaryIndexes((index) => [
      index('externalEventId').name('interviewsByExternalEventId'),
      index('candidateId').sortKeys(['status']).name('interviewsByCandidateIdAndStatus'),
    ])
    .authorization((allow) => [
      allow.owner(),
      allow.publicApiKey().to(['read']),
    ]),

  /**
   * SchedulingConnection Model
   */
  SchedulingConnection: a
    .model({
      recruiterId:    a.string().required(),
      providerId:     a.enum(['CALENDLY', 'CAL_COM']),
      accessToken:    a.string().required(),
      refreshToken:   a.string(),
      tokenExpiry:    a.datetime(),
      accountEmail:   a.string(),
      accountName:    a.string(),
      webhookSecret:  a.string(),
      webhookId:      a.string(),
      status:         a.enum(['ACTIVE', 'EXPIRED', 'REVOKED']),
      connectedAt:    a.datetime().required(),
      lastSyncAt:     a.datetime(),
    })
    .authorization((allow) => [
      allow.owner(),
    ]),

  /**
   * RoleContext Model
   */
  RoleContext: a
    .model({
      owner: a.string(),
      title: a.string(),
      level: a.enum(['junior', 'mid', 'senior', 'staff', 'principal', 'lead', 'manager']),
      department: a.string(),
      workModel: a.enum(['remote', 'hybrid', 'onsite']),
      teamSize: a.string(),
      reportsTo: a.string(),
      stack: a.string().array(),
      context: a.json(),
      exchanges: a.json(),
      status: a.enum(['baseline', 'exploring', 'almost_ready', 'ready']),
      gaps: a.string().array(),
      userSignals: a.json(),
      jobDescription: a.json(),
      candidateFilters: a.json(),
      suggestedStages: a.json(),
    })
    .authorization((allow) => [
      allow.owner(),
    ]),

  /**
   * RepoTemplate Model (STREAM2-005)
   * 
   * Catalog of available challenge repositories for code review and code implementation challenges.
   * Used by ChallengePicker for discovery and filtering. Supports public read access via API key
   * for unauthenticated challenge discovery.
   */
  RepoTemplate: a
    .model({
      /** Unique repository identifier (e.g., "slopify-coupon", "devhub-plugins") */
      repoId: a.string().required(),

      /** Application/product this repo belongs to (e.g., "slopify-admin", "devhub", "teamchat") */
      app: a.string().required(),

      /** Challenge type this repo is for */
      type: a.enum(['CODE_REVIEW', 'CODE_IMPLEMENTATION']),

      /** Human-readable title for the challenge (e.g., "Slopify: Add Coupon Support") */
      title: a.string().required(),

      /** Detailed description of what candidates will do */
      description: a.string(),

      /** Difficulty level for filtering and discovery */
      difficulty: a.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']),

      /** Estimated time to complete (in minutes) */
      estimatedMinutes: a.integer().required(),

      /** S3 path to the repository archive (e.g., "challenge-repos/app/repo-id/version/repo.tar.gz") */
      s3Key: a.string().required(),

      /** S3 path to the metadata JSON file for this repository version */
      metadataS3Key: a.string().required(),

      /** Semantic version of the repository (e.g., "1.0.0", "1.1.0") */
      version: a.string().required(),

      /** Markdown-formatted instructions for candidates */
      instructions: a.string().required(),

      /** JSON scoring rubric for evaluation (see tech spec Section 3.1 for schema) */
      scoring: a.json().required(),
    })
    .secondaryIndexes((index) => [
      /** Index for efficient repo lookup by repoId */
      index('repoId').name('repoTemplatesByRepoId'),
      
      /** Index for filtering by difficulty level */
      index('difficulty').name('repoTemplatesByDifficulty'),
    ])
    .authorization((allow) => [
      allow.owner(),
      allow.publicApiKey().to(['read']),
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

  scoreAssessment: a
    .mutation()
    .arguments({
      assessmentId: a.id().required(),
    })
    .returns(a.json())
    .handler(a.handler.function(scoringAgent))
    .authorization((allow) => [allow.publicApiKey()]),

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
   * DevContainerSession Model
   *
   * Tracks the lifecycle of an AWS Fargate dev container session.
   * Status updates are written by the ecsStatusBridge Lambda and
   * consumed in real-time by the frontend via subscriptions.
   */
  DevContainerSession: a
    .model({
      // The ECS Task ARN is the unique identifier
      taskArn: a.string().required(),
      sessionId: a.string().required(),
      status: a.enum(['PROVISIONING', 'BOOTING', 'READY', 'STOPPING', 'ERROR']),
      url: a.string(),
      // ALB resources created per-session by ecsStatusBridge on RUNNING;
      // stored here so they can be cleaned up on STOPPED.
      albTargetGroupArn: a.string(),
      albListenerRuleArn: a.string(),
    })
    .identifier(['taskArn'])
    .authorization((allow) => [
      allow.authenticated(),      // Users can read/watch their sessions
      allow.publicApiKey().to(['create', 'update']), // Bridge Lambda restricted to sync only
    ]),

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
   *
   * Manually trigger an invitation or notification email.
   */
  sendNotification: a
    .mutation()
    .arguments({
      candidateId: a.id().required(),
      stageId: a.id().required(),
      templateType: a.enum(['INVITATION', 'SUCCESS', 'FAILURE']),
    })
    .returns(a.json())
    .handler(a.handler.function(notificationService))
    .authorization((allow) => [allow.authenticated()]),

  /**
   * Submit Code Review Mutation (STREAM2-016 through STREAM2-020)
   *
   * Handles code review submission from candidates:
   * - Validates annotation structure
   * - Saves Assessment with annotations, summary, and timestamp
   * - Triggers async dev container destruction
   * - Returns confirmation with submission metadata
   *
   * Authorization: Public API key (for unauthenticated candidate submissions)
   */
  submitCodeReview: a
    .mutation()
    .arguments({
      assessmentId: a.id().required(),
      challengeId: a.id().required(),
      userId: a.string().required(),
      studioId: a.string().required(),
      codeReviewAnnotations: a.json().required(),
      codeReviewSummary: a.string(),
    })
    .returns(a.json())
    .handler(a.handler.function(submitCodeReview))
    .authorization((allow) => [allow.publicApiKey()]),

  /**
   * Fetch GitHub PR metadata and diff
   * 
   * STREAM 2: Phase 1 - GitHub PR Integration
   * Called by admin during challenge creation to fetch real PR from GitHub
   * Validates PR exists, extracts diff, returns parsed for caching
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
      allow.authenticated(), // Recruiter (admin) — candidates never need to call this directly
    ]),

  /**
   * List GitHub PR summaries for a repository
   *
   * Called by ChallengePicker when creating CODE_REVIEW challenges.
   * Returns lightweight PR metadata (no diffs) for display in the picker modal.
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
   * Score Code Review Assessment
   * 
   * STREAM 2: Phase 4 - Code Review Scoring Engine
   * Called by submitCodeReview Lambda after assessment saved
   * Compares candidate annotations to ground truth, calculates score (0-100)
   * Returns detailed feedback and severity breakdown
   */
  scoreCodeReview: a
    .mutation()
    .arguments({
      assessmentId: a.id().required(),
      candidateAnnotations: a.json().required(),
      groundTruthAnnotations: a.json().required(),
      reviewerLevel: a.string(),
    })
    .returns(a.json())
    .handler(a.handler.function(scoreCodeReview))
    .authorization((allow) => [
      allow.authenticated(), // Authenticated users only (recruiter or internal caller)
    ]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'userPool',
    apiKeyAuthorizationMode: {
      expiresInDays: 365,
    },
  },
});
