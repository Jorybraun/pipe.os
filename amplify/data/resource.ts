import { type ClientSchema, a, defineData } from "@aws-amplify/backend";

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
   */
  Stage: a
    .model({
      pipelineId: a.id().required(),
      pipeline: a.belongsTo('Pipeline', 'pipelineId'),
      order: a.integer(),
      challenges: a.hasMany('Challenge', 'stageId'),
      // Legacy - deprecated in Phase 7
      type: a.enum(['QUIZ', 'CODE_REVIEW']),
      config: a.json(),
      assessments: a.hasMany('Assessment', 'stageId'),
    })
    .authorization((allow) => [
      allow.owner(),                
      allow.publicApiKey().to(['read']), 
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
      config: a.json(), // Challenge-specific settings (e.g. MCQ options)
      
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
      groundTruth: a.json(), // Server-side bug answer key / scoring rubric
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

      // Deprecated - kept for migration
      stageId: a.id(),
      stage: a.belongsTo('Stage', 'stageId'),

      submission: a.json(),    // Candidate's answers/annotations
      score: a.float(),
      completedAt: a.datetime(),
    })
    .authorization((allow) => [
      allow.owner(),                        
      allow.publicApiKey().to(['create', 'read']), 
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
   * ChallengeTemplate Model (formerly Challenge)
   *
   * A global repository of pre-validated assessment content.
   */
  ChallengeTemplate: a
    .model({
      type: a.enum(['QUIZ', 'CODE_REVIEW']),
      title: a.string().required(),
      description: a.string(),

      // Tags for matching (e.g., ['React', 'TypeScript', 'Senior'])
      tags: a.string().array(),
      difficulty: a.enum(['Entry', 'Mid', 'Senior', 'Staff']),

      // The actual assessment data (questions, code, bugs, etc.)
      config: a.json().required(),

      // Verification status
      isVerified: a.boolean().default(false),
    })
    .authorization((allow) => [
      allow.authenticated().to(['read']),                         
      allow.groups(['Admin']).to(['create', 'update', 'delete']), 
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
    .handler(a.handler.function('questionAgent'))
    .authorization((allow) => [allow.authenticated()]),

  generateJobDescription: a
    .mutation()
    .arguments({
      roleContext: a.json().required(),
    })
    .returns(a.json())
    .handler(a.handler.function('jobDescriptionAgent'))
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
