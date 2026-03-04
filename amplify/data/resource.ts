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

      assessments: a.hasMany('Assessment', 'challengeId'),
    })
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
