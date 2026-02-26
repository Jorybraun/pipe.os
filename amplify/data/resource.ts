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

      // Relations
      stages: a.hasMany('Stage', 'pipelineId'),
      candidates: a.hasMany('Candidate', 'pipelineId'),

      // Link to discovery context (post-MVP: agentic discovery)
      roleContextId: a.id(),
    })
    .authorization((allow) => [
      allow.owner(), // Recruiters own their pipelines
    ]),

  /**
   * Stage Model
   *
   * Represents a specific assessment step in the pipeline.
   * Candidates (unauthenticated) need read access to load stage config
   * when completing their assessment via invite token.
   *
   * Supported stage types for MVP:
   * - QUIZ: Multiple-choice questions
   * - CODE_REVIEW: Annotate buggy code snippets
   */
  Stage: a
    .model({
      pipelineId: a.id().required(),
      pipeline: a.belongsTo('Pipeline', 'pipelineId'),
      type: a.enum(['QUIZ', 'CODE_REVIEW']),
      order: a.integer(),
      /**
       * Stage config JSON structure by type:
       * QUIZ:        { questions: Array<{ q: string, options: string[], correct: number }> }
       * CODE_REVIEW: { snippets: Array<{ code: string, bugs: Array<{ line: number, type: string }> }> }
       */
      config: a.json(),
      assessments: a.hasMany('Assessment', 'stageId'),
    })
    .authorization((allow) => [
      allow.owner(),                // Recruiters manage stages
      allow.guest().to(['read']),   // Candidates (unauthenticated) read stage config via invite token
    ]),

  /**
   * Candidate Model
   *
   * Represents a candidate invited to a pipeline.
   * The inviteToken is a UUID embedded in the candidate-facing URL.
   * Candidates are unauthenticated — they access their assessment via token only.
   *
   * Invite URL pattern: /assess/:inviteToken
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
      allow.owner(),                // Recruiters manage candidates
      allow.guest().to(['read']),   // Candidates look themselves up by inviteToken
    ]),

  /**
   * Assessment Model
   *
   * Stores a candidate's submission for a specific stage.
   * Candidates (unauthenticated) create assessments when submitting their work.
   * Recruiters read and score them.
   */
  Assessment: a
    .model({
      candidateId: a.id().required(),
      candidate: a.belongsTo('Candidate', 'candidateId'),
      stageId: a.id().required(),
      stage: a.belongsTo('Stage', 'stageId'),
      submission: a.json(),    // Candidate's answers/annotations
      score: a.float(),
      completedAt: a.datetime(),
    })
    .authorization((allow) => [
      allow.owner(),                        // Recruiters read/score assessments
      allow.guest().to(['create', 'read']), // Candidates submit and check their own assessment
    ]),

  /**
   * RoleContext Model
   *
   * Stores role discovery session state and outputs.
   * Post-MVP: used by the agentic discovery flow.
   * Not used in MVP — pipeline creation uses a simple form.
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
   * Challenge Model (Post-MVP)
   *
   * A global repository of pre-validated assessment content.
   * Challenges are tagged by technology and difficulty for easy selection.
   * Not used in MVP — stages are authored directly in the stage editor.
   */
  Challenge: a
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
      allow.authenticated().to(['read']),                         // Any recruiter can browse the library
      allow.groups(['Admin']).to(['create', 'update', 'delete']), // Only admins can curate
    ]),

  /**
   * AI Agent Mutations
   *
   * Custom mutations that invoke Lambda functions.
   * Each agent follows the questionAgent engineering standard — see docs/specs/engineering-standards.md.
   *
   * Post-MVP: these power the agentic role discovery flow.
   * MVP: pipeline creation uses a simple form — agents not yet called.
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
    // Guest (unauthenticated) access is enabled to support the candidate assessment flow.
    // Candidates access their assessment via /assess/:inviteToken without a Cognito account.
    apiKeyAuthorizationMode: {
      expiresInDays: 365,
    },
  },
});
