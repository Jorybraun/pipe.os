import { type ClientSchema, a, defineData } from "@aws-amplify/backend";

const schema = a.schema({
  /**
   * Pipeline Model
   *
   * Core entity for the Pipe platform. Represents a hiring pipeline
   * with a role definition, stages, and candidate assessments.
   *
   * MVP fields only — rich role context (JD generation, agent discovery)
   * is deferred to post-MVP via RoleContext model.
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

      // Metadata
      createdAt: a.datetime(),
      updatedAt: a.datetime(),
    })
    .authorization((allow) => [
      allow.owner(), // Only the creator can access their pipelines
    ]),

  /**
   * Stage Model
   *
   * A single assessment stage within a pipeline.
   * MVP only supports CODE_REVIEW type.
   */
  Stage: a
    .model({
      pipelineId: a.id().required(),
      pipeline: a.belongsTo('Pipeline', 'pipelineId'),
      type: a.enum(['CODE_REVIEW']),
      order: a.integer(),
      config: a.json(), // stage-specific settings (e.g. which code snippet to use)
      assessments: a.hasMany('Assessment', 'stageId'),
    })
    .authorization((allow) => [allow.owner()]),

  /**
   * Candidate Model
   *
   * A person invited to complete a pipeline assessment.
   * inviteToken is a UUID used in candidate-facing URL (no auth required).
   */
  Candidate: a
    .model({
      pipelineId: a.id().required(),
      pipeline: a.belongsTo('Pipeline', 'pipelineId'),
      name: a.string(),
      email: a.email(),
      inviteToken: a.string(), // UUID used in candidate-facing URL, no auth required
      status: a.enum(['INVITED', 'IN_PROGRESS', 'COMPLETED']),

      // Relations
      assessments: a.hasMany('Assessment', 'candidateId'),
    })
    .authorization((allow) => [allow.owner()]),

  /**
   * Assessment Model
   *
   * A candidate's submission for a specific stage.
   * submission is the raw candidate annotations; score is computed on submission.
   */
  Assessment: a
    .model({
      candidateId: a.id().required(),
      candidate: a.belongsTo('Candidate', 'candidateId'),
      stageId: a.id().required(),
      stage: a.belongsTo('Stage', 'stageId'),
      submission: a.json(),  // candidate's annotations
      score: a.float(),
      completedAt: a.datetime(),
    })
    .authorization((allow) => [allow.owner()]),

  /**
   * RoleContext Model
   *
   * Stores role discovery session state and outputs.
   * Each session is owned by the creating user (Cognito auth).
   */
  RoleContext: a
    .model({
      // Session ID (auto-generated)
      id: a.id().required(),

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
      // DynamicContext: Record<string, string | string[]>
      context: a.json(),

      // Conversation history (JSON blob)
      // Exchange[]
      exchanges: a.json(),

      // Status tracking
      status: a.enum(['baseline', 'exploring', 'almost_ready', 'ready']),
      gaps: a.string().array(),

      // User persona signals (JSON blob)
      userSignals: a.json(),

      // Generated outputs (when ready)
      jobDescription: a.json(),      // JobDescription
      candidateFilters: a.json(),    // CandidateFilter[]
      suggestedStages: a.json(),     // SuggestedStage[]

      // Metadata
      createdAt: a.datetime(),
      updatedAt: a.datetime(),
    })
    .authorization((allow) => [
      allow.owner(),  // Only the creator can access their role context
    ]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'userPool',
  },
});

