import { type ClientSchema, a, defineData } from "@aws-amplify/backend";
import { questionAgent } from '../functions/questionAgent/resource';
import { jobDescriptionAgent } from '../functions/jobDescriptionAgent/resource';
import { scoringAgent } from '../functions/scoringAgent/resource';
import { turnCredentials } from '../functions/turnCredentials/resource';

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

      // Scheduling URL for LIVE_VIDEO stages (e.g. Calendly or Cal.com link)
      schedulingUrl: a.url(),

      // Link to discovery context (post-MVP: agentic discovery)
      roleContextId: a.id(),
    })
    .authorization((allow) => [
      allow.owner(), // Recruiters own their pipelines
    ]),

  /**
   * Stage Model
   *
   * Represents a container for challenges in the pipeline.
   * Stages define the high-level flow (e.g. "Technical Round 1").
   *
   * mode: ASYNC (default) = candidates complete challenges independently.
   *       LIVE_VIDEO = recruiter and candidate connect over WebRTC first,
   *       then challenges play out during the live session.
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
    })
    .authorization((allow) => [
      allow.owner(),
      allow.publicApiKey().to(['read']),
    ]),

  /**
   * VideoSession Model
   *
   * Tracks a live video interview session between a recruiter and candidate.
   * Created by the recruiter when they are ready to call; destroyed when the
   * session ends. One session per (stageId + candidateId) at a time.
   *
   * status lifecycle:
   *   WAITING  → recruiter is waiting for candidate to join the room
   *   CALLING  → recruiter has initiated the call (offer sent)
   *   ACTIVE   → candidate accepted (answer sent, ICE complete)
   *   ENDED    → either party ended the session
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
   *
   * Stores individual WebRTC signaling messages (SDP offer/answer + ICE candidates).
   * AppSync real-time subscriptions allow each peer to receive signals instantly.
   *
   * type:
   *   OFFER        → recruiter's RTCSessionDescription (type=offer)
   *   ANSWER       → candidate's RTCSessionDescription (type=answer)
   *   ICE_CANDIDATE → trickle ICE candidate from either peer
   *   HANGUP       → graceful session termination signal
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
   * 
   * Atomic unit of assessment. 
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
      // Note: serverConfig access should be restricted via field-level auth 
      // when Amplify supports it for JSON fields, or via a dedicated private model.
    ]),

  /**
   * CodeArtifact Model
   * 
   * Stores code snippets and ground truth for code-based challenges.
   * Separated from Challenge to allow multiple challenges to reference the same artifact.
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
   *
   * Represents a candidate invited to a pipeline.
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
    })
    .authorization((allow) => [
      allow.owner(),                        
      allow.publicApiKey().to(['read', 'update']), 
    ]),

  /**
   * Assessment Model
   *
   * Stores a candidate's submission for a specific challenge.
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
   *
   * Tracks a scheduled (or to-be-scheduled) live video interview between a
   * recruiter and candidate for a LIVE_VIDEO stage. Created by the recruiter
   * when they invite a candidate; status evolves as the candidate books and
   * the session completes.
   *
   * status lifecycle:
   *   INVITED   → recruiter created the record, candidate not yet booked
   *   SCHEDULED → candidate booked via scheduling provider
   *   COMPLETED → session took place
   *   CANCELLED → either party cancelled
   *   NO_SHOW   → candidate did not attend
   */
  ScheduledInterview: a
    .model({
      candidateId:        a.id().required(),
      pipelineId:         a.id().required(),
      stageId:            a.id().required(),
      status:             a.enum(['INVITED', 'SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW']),
      scheduledAt:        a.datetime(),
      meetingUrl:         a.url(),
      schedulingProvider: a.enum(['CALENDLY', 'CAL_COM', 'MANUAL']),
      schedulingUrl:      a.url().required(),
      externalEventId:    a.string(),
      recruiterNotes:     a.string(),
    })
    .authorization((allow) => [
      allow.owner(),
      allow.publicApiKey().to(['read']),
    ]),

  /**
   * RoleContext Model
   *
   * Stores role discovery session state and outputs.
   */
  RoleContext: a
    .model({
      // Owner (from Cognito auth)
      owner: a.string(),

      // Baseline (Part 1 - structured fields)
      title: a.string(),
      level: a.enum(['junior', 'mid', 'senior', 'staff', 'principal', 'lead', 'manager']),
      department: a.string(),
      workModel: a.enum(['remote', 'hybrid', 'onsite']),
      teamSize: a.string(),
      reportsTo: a.string(),
      stack: a.string().array(),

      // Dynamic context (Part 2 - JSON blob)
      context: a.json(),

      // Conversation history (JSON blob)
      exchanges: a.json(),

      // Status tracking
      status: a.enum(['baseline', 'exploring', 'almost_ready', 'ready']),
      gaps: a.string().array(),

      // User persona signals (JSON blob)
      userSignals: a.json(),

      // Generated outputs (when status = 'ready')
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
      responses: a.json(), // Array of { questionId, response }
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
