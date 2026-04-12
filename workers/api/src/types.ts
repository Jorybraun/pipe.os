/**
 * Environment bindings injected by the Cloudflare Workers runtime.
 * Add new bindings here as they are declared in wrangler.jsonc.
 */
export interface Env {
  /** D1 database binding — all SQL queries go through this. */
  DB: D1Database;
  /** R2 bucket binding for candidate documents (CVs, resumes). */
  STORAGE: R2Bucket;
  /** Workers AI binding — Qwen, Nemotron, etc. No API key needed. */
  AI: Ai;
  /** Clerk secret key for JWT verification. Set via .dev.vars in dev. */
  CLERK_SECRET_KEY: string;
  /** Session token secret for candidate JWT signing/verification. */
  SESSION_TOKEN_SECRET: string;
  /**
   * GitHub personal access token for the PR fetch proxy.
   * Set via .dev.vars in dev, Worker secret in production.
   * Optional — unauthenticated requests are rate-limited at 60/hour.
   */
  GITHUB_TOKEN?: string;
  /**
   * Mistral API key for the implementer agent (Devstral model).
   * Set via .dev.vars in dev, Worker secret in production.
   * Optional — falls back to Workers AI when not set.
   */
  MISTRAL_API_KEY?: string;
  GOOGLE_AI_API_KEY?: string;
  /** 'mistral' | 'google-ai' — selects the role agent provider. Default: 'mistral'. */
  ROLE_AGENT_PROVIDER?: string;
  /**
   * Anthropic API key — alternative provider for the implementer agent.
   * Only used if MISTRAL_API_KEY and Workers AI are not available.
   */
  ANTHROPIC_API_KEY?: string;
  /**
   * When set to "true", AI agents return deterministic canned responses.
   * Used in E2E/integration tests to avoid real LLM calls.
   */
  MOCK_AI?: string;
  /** Durable Object binding for video call signaling rooms. */
  VIDEO_ROOM: DurableObjectNamespace;
  /** Durable Object binding for dev container sessions (ADR-037, Phase 3b). */
  DEV_CONTAINER: DurableObjectNamespace;
  /** Durable Object binding for voice interview sessions. */
  VOICE_SESSION: DurableObjectNamespace;
  /** Selects the LiveProvider implementation. 'vertex-live' | 'openai-realtime' | 'mock'. Default: 'vertex-live'. */
  LIVE_PROVIDER?: string;
  /** Used to authenticate DO→Worker transcript callbacks. */
  VOICE_SESSION_INTERNAL_SECRET?: string;
  /** Metered.ca API key for TURN credential fetching. */
  METERED_API_KEY?: string;
  /** Calendly OAuth client ID. */
  CALENDLY_CLIENT_ID?: string;
  /** Calendly OAuth client secret. */
  CALENDLY_CLIENT_SECRET?: string;
  /** Cal.com OAuth client ID. */
  CALCOM_CLIENT_ID?: string;
  /** Cal.com OAuth client secret. */
  CALCOM_CLIENT_SECRET?: string;
  /** Google OAuth client ID for Gmail send-as integration. */
  GOOGLE_OAUTH_CLIENT_ID?: string;
  /** Google OAuth client secret for Gmail send-as integration. */
  GOOGLE_OAUTH_CLIENT_SECRET?: string;
  /** Microsoft OAuth client ID for Outlook send-as integration. */
  MICROSOFT_OAUTH_CLIENT_ID?: string;
  /** Microsoft OAuth client secret for Outlook send-as integration. */
  MICROSOFT_OAUTH_CLIENT_SECRET?: string;
  /**
   * Resend API key for transactional emails (invitations, notifications).
   * Set via .dev.vars in dev, Worker secret in production.
   * Optional — emails are silently skipped when not set.
   */
  RESEND_API_KEY?: string;
  /**
   * Base URL for candidate-facing assessment links.
   * Defaults to 'https://pipe.build' in production.
   */
  APP_BASE_URL?: string;
  /** Twilio Account SID for phone screening. */
  TWILIO_ACCOUNT_SID?: string;
  /** Twilio Auth Token for webhook signature validation. */
  TWILIO_AUTH_TOKEN?: string;
  /** Twilio phone number (E.164) for outbound calls. */
  TWILIO_PHONE_NUMBER?: string;
  /** Twilio TwiML App SID for browser-based calling. */
  TWILIO_TWIML_APP_SID?: string;
  /** Twilio API Key SID for Access Token (JWT) generation. */
  TWILIO_API_KEY_SID?: string;
  /** Twilio API Key Secret for Access Token (JWT) generation. */
  TWILIO_API_KEY_SECRET?: string;
  /** Deepgram API key for call transcription. */
  DEEPGRAM_API_KEY?: string;
  /** Libraries.io API key for dependency-based repo discovery. Free tier: 60 req/min. */
  LIBRARIES_IO_API_KEY?: string;
  /** Override copilot agent LLM provider. Default: 'cloudflare-ai'. */
  COPILOT_AGENT_PROVIDER?: string;
  // ─── Dev Containers (Phase 3b, ADR-037) ────────────────────────────────────
  /** Global default TTL in seconds for dev container sessions. */
  DEV_CONTAINER_DEFAULT_TTL_SECONDS?: string;
  /** Hard cap TTL in seconds — neither per-challenge nor admin override may exceed this. */
  DEV_CONTAINER_MAX_TTL_SECONDS?: string;
  /** Seconds before expiry that the DO fires the warning alarm. */
  DEV_CONTAINER_WARN_BEFORE_SECONDS?: string;
  /** Shared secret required on the X-Pipe-Admin-Override header to honor a per-launch TTL override. */
  ADMIN_TTL_OVERRIDE_SECRET?: string;
  /**
   * Shared secret required on the X-Calibrate-Token header for the
   * `/internal/calibrate/*` scoring endpoints. Used by the CAL-2 harness
   * running against `wrangler dev` (and, later, staging deployments) so the
   * harness can exercise the real `env.AI` binding instead of the flaky
   * Cloudflare AI REST shim. Deployment without this secret set disables the
   * endpoints entirely — absence is the kill switch.
   */
  CALIBRATE_TOKEN?: string;
  /**
   * Vertex AI API key for scorer calibration (API-key auth, not OAuth).
   * Uses the simpler `aiplatform.googleapis.com/v1/publishers/google/models/{model}:generateContent?key=` endpoint.
   */
  VERTEX_API_KEY?: string;
}

/**
 * Hono context variables set by middleware.
 * Available via `c.var.userId` in route handlers after auth middleware runs.
 */
export interface Variables {
  /** Clerk user ID extracted from the verified JWT. */
  userId: string;
}

// ─── DB Row shapes (snake_case) ───────────────────────────────────────────────

export interface PipelineRow {
  id: string;
  owner_id: string;
  title: string;
  level: string | null;
  stack: string | null;
  description: string | null;
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  creation_mode: string | null;
  created_at: string;
  updated_at: string;
}

export interface PipelineWithCountsRow extends PipelineRow {
  stage_count: number;
  candidate_count: number;
}

export interface StageRow {
  id: string;
  pipeline_id: string;
  title: string;
  description: string | null;
  sort_order: number;
  time_limit: number | null;
  mode: string | null;
  stage_type: string | null;
  is_scheduled: number;
  created_at: string;
  updated_at: string;
}

export interface ChallengeRow {
  id: string;
  stage_id: string;
  type: 'CODE_REVIEW' | 'CODE_IMPLEMENTATION' | 'QUIZ_MCQ' | 'QUIZ_SHORT_ANSWER' | 'FOLLOW_UP' | 'AGENT_INTERVIEW';
  sort_order: number;
  title: string;
  instructions: string | null;
  config: string | null;
  server_config: string | null;
  owner_id: string | null;
  github_repo_url: string | null;
  github_pr_number: number | null;
  github_pr_title: string | null;
  github_pr_description: string | null;
  cached_diff_json: string | null;
  cached_metadata: string | null;
  diff_cached_at: string | null;
  ground_truth_annotations: string | null;
  ground_truth: string | null;
  practice_repo: string | null;
  pr_number: number | null;
  feature_branch: string | null;
  base_branch: string | null;
  repo_s3_key: string | null;
  repo_version: number | null;
  repo_branch: string | null;
  repo_base_branch: string | null;
  repo_metadata_s3_key: string | null;
  created_at: string;
  updated_at: string;
}

export interface StageWithOwnerRow extends StageRow {
  owner_id: string | null;
  notification_templates: string | null;
  scheduling_event_type_id: string | null;
  video_config: string | null;
}

export interface PhoneCallRow {
  id: string;
  candidate_id: string;
  pipeline_id: string;
  owner_id: string;
  direction: 'OUTBOUND' | 'INBOUND';
  status: string;
  from_number: string;
  to_number: string;
  twilio_call_sid: string | null;
  duration_seconds: number | null;
  recording_url: string | null;
  recording_s3_key: string | null;
  transcription: string | null;
  transcription_status: string | null;
  recruiter_notes: string | null;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Role Context ────────────────────────────────────────────────────────────

export type RoleContextStatus = 'BASELINE' | 'INTERVIEWING' | 'COMPLETE' | 'ABANDONED';

export interface RoleContextRow {
  id: string;
  pipeline_id: string | null;
  owner_id: string;
  baseline: string | null;
  knowledge_state: string | null;
  exchanges: string | null;
  question_budget: number;
  questions_asked: number;
  status: RoleContextStatus;
  /**
   * Persisted CandidatePersona JSON (stringified). Null until synthesis runs.
   * Post-ADR-036: derived from rcd_json.consumer_slice as a legacy cache for
   * consumers that have not yet cut over to reading the full RCD.
   */
  persona_json: string | null;
  /** Generated job description in Markdown. Null until synthesis runs. */
  job_description_md: string | null;
  // ── ADR-036: Role Context Document columns (migration 0022) ──
  /** Semver of the RCD schema this row was written under. Invalidation key. */
  rcd_version: string | null;
  /** Full RoleContextDocument JSON (stringified). Null until synthesis runs. */
  rcd_json: string | null;
  /** ValidationMetadata JSON (stringified). Tracks model + prompt versions. */
  validation_metadata: string | null;
  /** BarsOverride[] JSON (stringified). Populated at role-setup time per ADR-036 §1.5. */
  bars_overrides: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Structured candidate persona — the internal hiring truth derived from the
 * Discovery interview. Shared across stakeholders (merged per ADR-028).
 * Drives downstream matching and scoring; also seeds the generated JD.
 */
export interface CandidatePersona {
  /** e.g. "Mid-to-senior, 5–8 years" */
  seniority: string;
  /** e.g. "Backend-leaning fullstack from Series A-C startup" */
  archetype: string;
  /** 70% of skills the candidate should have day one. */
  mustHaveSkills: string[];
  /** 30% of skills that can be grown into. */
  niceToHaveSkills: string[];
  /** Cultural / working-style traits. e.g. "Comfortable pushing back on PMs". */
  disposition: string[];
  /** One-line career arc signal. e.g. "Has shipped at least one greenfield system end-to-end". */
  careerSignal: string;
  /** Watchouts — not absolute NOs. */
  redFlags: string[];
  /** Hard NOs — reject on contact if any of these are true. */
  dealbreakers: string[];
}

// ─── Role Context Document (ADR-036) ────────────────────────────────────────
// Replaces CandidatePersona as the canonical synthesis output. Hybrid
// qualitative schema drawn from four research traditions: framework analysis
// matrix (Ritchie & Spencer 1994), IPA evidence anchors (Smith et al. 2009),
// grounded theory axial coding (Charmaz 2014), Means-End Chain laddering
// (Reynolds & Gutman 1988). Every claim is traceable to a verbatim transcript
// quote via LadderingChain.attribute_quote + source_exchange_id.
//
// consumer_slice is derived from domain_matrix at write time. Legacy readers
// continue reading the flat CandidatePersona shape through the consumer_slice
// until Phase 2/3 rewires them.

export type StakeholderType = 'HIRING_MANAGER' | 'TEAM_MEMBER' | 'INTERNAL_RECRUITER' | 'EXTERNAL_RECRUITER';

export type Domain = 'why' | 'work' | 'team' | 'bar' | 'codebase' | 'process';

export type EnergySignal = 'high' | 'medium' | 'low' | 'unknown';

export type DomainCoverageLevel = 'not_probed' | 'sparse' | 'partial' | 'covered' | 'deep';

export type AxialRelation = 'causes' | 'enables' | 'blocks' | 'contradicts' | 'instantiates';

export type ConfidenceLevel = 'high' | 'medium' | 'low';

/**
 * A single Means-End Chain: attribute (verbatim quote) → consequence → value.
 * Bottom-up ordering is load-bearing — the synthesis prompt enforces that
 * attribute_quote is extracted first, then consequence, then value, in that
 * strict order. Reversing causes value projection (the top research failure
 * mode).
 */
export interface LadderingChain {
  /** Verbatim transcript quote — must appear character-for-character in the source exchange. */
  attribute_quote: string;
  /** Pointer into RoleExchange.questionId of the exchange the quote came from. */
  source_exchange_id: string;
  /** What the attribute enables or implies, derivable from the quote alone. */
  consequence: string;
  /** Root motivation the consequence ladders up to. */
  value: string;
  /** Per-chain energy signal; HIGH requires a verbatim lexical marker in the quote. */
  energy_signal: EnergySignal;
  /** Downgraded to 'low' when verifier flags the chain as unsupported. */
  confidence: ConfidenceLevel;
}

/**
 * Structured situation/action/outcome/moral record from the transcript.
 * Stories are first-class because the research design pattern is
 * "ask for specific instances, not generalities" (ADR-027 IDEO principle).
 */
export interface StoryRecord {
  situation: string;
  action: string;
  outcome: string;
  /** What the story tells us about the team — the interpretive layer. */
  moral: string;
  source_exchange_id: string;
}

/**
 * Single cell in the domain matrix keyed by (stakeholder_type, domain).
 * Cells that were not probed are still present with coverage='not_probed' and
 * empty arrays — never omitted — so the schema can enforce full coverage.
 */
export interface DomainCell {
  /** True if this stakeholder is the domain-authoritative source per §1.3. */
  primary_authority: boolean;
  /** Coverage marker — 'not_probed' is explicit, never implicit. */
  coverage: DomainCoverageLevel;
  laddering_chains: LadderingChain[];
  /** Grounded theory Tier 1 — open codes extracted from the transcript. */
  open_codes: string[];
  /** Grounded theory axial links between open codes, with directionality. */
  axial_links: Array<{
    from_code: string;
    to_code: string;
    relation: AxialRelation;
  }>;
  stories: StoryRecord[];
  /** Diplomatic, constructive summary (feedback memory: synthesis tone rule). */
  summary: string;
}

export type DomainMatrix = {
  [stakeholder in StakeholderType]?: {
    [domain in Domain]?: DomainCell;
  };
};

export type ConflictFlag = 'minor' | 'material' | 'blocking';

export type ConflictResolution = 'prefer_authoritative' | 'preserve_both' | 'escalate_to_recruiter';

export interface ConflictRecord {
  domain: Domain;
  /** Dotted field path — e.g. 'team.collaboration_style'. */
  field: string;
  stakeholder_a: StakeholderType;
  position_a: string;
  stakeholder_b: StakeholderType;
  position_b: string;
  conflict_flag: ConflictFlag;
  resolution_strategy: ConflictResolution;
}

/**
 * Dealbreaker with pre-populated Griggs business-necessity defense text.
 * Every dealbreaker is HITL-gated at scoring time (ADR-036 §1.7) — the scorer
 * raises a flag that blocks advancement until a recruiter confirms or overrides.
 * Never auto-fail.
 */
export interface DealbreakerRecord {
  id: string;
  /** Human-readable summary for the recruiter UI. */
  label: string;
  /** What to look for in culture/code-review outputs. */
  pattern: string;
  source_stakeholder: StakeholderType;
  /** Pointer into an RCD laddering chain that grounds this dealbreaker. */
  source_chain_id: string;
  /** Pre-populated Griggs defense text. */
  job_relatedness_note: string;
  job_relatedness_strength: 'strong' | 'moderate' | 'weak';
  /** Verbatim quote from the transcript grounding this dealbreaker. */
  evidence_quote: string;
}

/**
 * Red flags are advisory-only — they surface in the recruiter UI but never
 * block candidate advancement automatically (ADR-031 compliance gate pattern).
 */
export interface RedFlagRecord {
  id: string;
  label: string;
  source_stakeholder: StakeholderType;
  source_chain_id: string;
  evidence_quote: string;
}

/**
 * Five-signal team culture profile. Four OCAI Competing Values Framework
 * archetypes (Cameron & Quinn 2006; Heritage et al. 2014) under Current-culture
 * framing — NEVER Ideal-culture framing — plus Edmondson psychological safety.
 * Scored 1–5 per stakeholder; cross-stakeholder averaging is forbidden per §1.3.
 */
export interface TeamCultureProfile {
  per_stakeholder: {
    [stakeholder in StakeholderType]?: {
      clan_affinity: number;          // 1–5
      adhocracy_affinity: number;     // 1–5
      market_affinity: number;        // 1–5
      hierarchy_affinity: number;     // 1–5
      psychological_safety: number;   // 1–5
    };
  };
  /** Tier-3 aggregates only for fields with genuine consensus, with explicit formula. */
  aggregated?: {
    formula: string;                  // e.g. 'weighted_mean([HM:.5, TM:.3, IR:.1, ER:.1])'
    clan_affinity: number;
    adhocracy_affinity: number;
    market_affinity: number;
    hierarchy_affinity: number;
    psychological_safety: number;
  };
}

/**
 * BARS anchor override derived from laddering chains at role-setup time.
 * Never per-candidate dynamic generation (NYC LL 144 + EU AI Act Art 14).
 */
export interface BarsOverride {
  dimension: string;                   // e.g. 'ownership', 'communication'
  /** Anchor level (typically 1–5) being overridden. */
  anchor_level: number;
  /** Universal base rubric text for this dimension × level. */
  base_anchor_text: string;
  /** Team-specific replacement text grounded in the RCD. */
  override_anchor_text: string;
  /** Pointer into the RCD laddering chain that motivated this override. */
  source_chain_id: string;
  approved_by: string;                 // recruiter user id
  approved_at: string;                 // ISO 8601
}

/**
 * Role-setup-time probe bank enrichment. The static base ships in code; the
 * enrichment layer adds team-specific probes derived from RCD laddering chains
 * at role setup, gated by recruiter approval (§1.6).
 */
export interface ProbeEnrichment {
  static_base_version: string;
  enriched_probes: Array<{
    dimension: string;
    probe_text: string;
    source_chain_id: string;
    approved_by: string;
    approved_at: string;
  }>;
}

/**
 * Technical context aggregate derived from the codebase + work + bar domains.
 * Read by challengeGeneration/prompts.ts (Phase 3) and repoDiscovery (Phase 4).
 */
export interface TechnicalContext {
  stack: string[];
  constructs: string[];                // engineering construct tags per ADR-036 §2.1
  seniority_band: string;
  codebase_expectations: string[];     // derived from 'codebase' domain cells
  dispositional_weights: Record<string, number>; // per-dimension weight deltas for ADR-032 scorer
}

/**
 * Legacy CandidatePersona shape derived from the RCD at write time. Lives on
 * the RCD as consumer_slice so legacy readers can keep reading a flat persona
 * while Phase 2/3 cuts consumers over to the full domain_matrix.
 */
export type CachedPersona = CandidatePersona;

/** Versioning precondition for the staged validation ladder (§3.3). */
export interface ValidationMetadata {
  schema_version: string;
  synthesis_model: string;
  synthesis_prompt_version: string;
  verification_pass_model: string;
  face_validity_reviewed_at: string | null;
  face_validity_reviewer: string | null;
}

/**
 * Role Context Document — canonical synthesis output per ADR-036. Supersedes
 * CandidatePersona as the primary artifact; CandidatePersona survives as a
 * derived consumer_slice cache for legacy readers.
 */
export interface RoleContextDocument {
  rcd_version: string;
  role_context_id: string;
  pipeline_id: string;
  created_at: string;

  domain_matrix: DomainMatrix;

  conflicts: ConflictRecord[];
  technical_context: TechnicalContext;
  team_culture_profile: TeamCultureProfile;
  bars_overrides: BarsOverride[];
  probe_bank_enrichment: ProbeEnrichment;
  dealbreakers: DealbreakerRecord[];
  red_flags: RedFlagRecord[];

  /** Derived at write time — legacy CandidatePersona shape. */
  consumer_slice: CachedPersona;

  validation_metadata: ValidationMetadata;
}

// ─── Repo Understanding Contract (ADR-036 §2) ───────────────────────────────
// Two new D1 row types backing the two-stage retrieval architecture. Pass 3
// offline summarization (Haiku 4.5, role-agnostic) writes RepoEngineeringSignals;
// runtime Gemma 4 rerank (per role × repo, cached) writes RepoRoleAlignment.
// Phase 4 work — types land in Phase 1 to keep the type surface coherent.

export interface RepoEngineeringSignalsRow {
  repo_id: number;
  signals_version: string;
  content_hash: string;

  // Tier 1 — computable from existing substrate
  test_touch_rate: number | null;
  mean_changed_files: number | null;
  p90_changed_files: number | null;
  issue_link_rate: number | null;
  complexity_band: 'low' | 'medium' | 'high' | 'mixed' | null;
  swe_bench_eligibility_rate: number | null;

  // Tier 2 — needs Pass 2 extension
  architecture_style: 'monolith' | 'microservice' | 'modular_monolith' | 'serverless' | 'unknown' | null;
  review_density: number | null;
  commit_cadence: number | null;
  satd_density: number | null;

  engineering_narrative: string;
  signal_json: string;                 // JSON-stringified full blob

  generated_at: string;
  model_used: string;
  model_version: string;
}

export type AlignmentBand = 'strong' | 'moderate' | 'weak' | 'mismatch';

export interface RepoRoleAlignmentRow {
  role_context_id: string;
  repo_id: number;
  alignment_score: number;             // 0.0–1.0
  alignment_band: AlignmentBand;
  reasoning_json: string;              // JSON-stringified structured justification
  per_signal_scores: string;           // JSON-stringified { signal_name: score }
  rcd_version: string;
  signals_version: string;
  generated_at: string;
  model_used: string;
}

/**
 * Generated job description — the public-facing artifact ready to post on
 * a job board or send directly to a candidate. Derived from the persona + the
 * interview's knowledge state. Rendered as Markdown in the UI.
 */
export interface GeneratedJobDescription {
  jobTitle: string;
  companySummary: string;
  roleOverview: string;
  responsibilities: string[];
  mustHaves: string[];
  niceToHaves: string[];
  compAndBenefits: string;
  callToAction: string;
}

/** A single exchange (turn) in the role discovery interview. */
export interface RoleExchange {
  questionId: string;
  acknowledgment: string;
  question: string;
  input: {
    type: 'text' | 'textarea' | 'tags' | 'select' | 'radio';
    options?: string[];
    placeholder?: string;
  };
  answer?: string;
  /** Recruiter feedback on this question — free text, stored for prompt tuning. */
  feedback?: string;
}

/** Six Domains coverage levels. */
export type DomainCoverage = 'none' | 'sparse' | 'partial' | 'covered' | 'deep';

/** Progress snapshot returned with each turn. */
export interface RoleAgentProgress {
  asked: number;
  budget: number;
  domains: Record<string, DomainCoverage>;
}

// ─── Role Context Participants (ADR-028) ───────────────────────────────────

export type ParticipantRole = 'HIRING_MANAGER' | 'INTERNAL_RECRUITER' | 'EXTERNAL_RECRUITER' | 'TEAM_MEMBER';

export type ParticipantStatus = 'PENDING' | 'INVITED' | 'CALIBRATING' | 'INTERVIEWING' | 'COMPLETE';

export interface RoleContextParticipantRow {
  id: string;
  role_context_id: string;
  name: string | null;
  email: string | null;
  participant_role: ParticipantRole | null;
  invite_token: string | null;
  is_creator: number; // SQLite boolean
  exchanges: string | null;
  questions_asked: number;
  question_budget: number;
  status: ParticipantStatus;
  created_at: string;
  updated_at: string;
}

// ─── API Response shapes (camelCase) ─────────────────────────────────────────

export interface PipelineResponse {
  id: string;
  title: string;
  level: string | null;
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  creationMode: string | null;
  stageCount: number;
  candidateCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PipelineCreatedResponse {
  id: string;
  title: string;
  level: string | null;
  status: string;
  stageCount: number;
  createdAt: string;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
  };
}

// ─── Stage API response shapes ────────────────────────────────────────────────

export interface ChallengeResponse {
  id: string;
  stageId: string;
  type: 'CODE_REVIEW' | 'CODE_IMPLEMENTATION' | 'QUIZ_MCQ' | 'QUIZ_SHORT_ANSWER' | 'FOLLOW_UP' | 'AGENT_INTERVIEW';
  order: number;
  title: string;
  instructions: string | null;
  /** Parsed JSON object — never a raw string in API responses. */
  config: Record<string, unknown> | null;
  githubRepoUrl: string | null;
  githubPrNumber: number | null;
  githubPrTitle: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StageDetailResponse {
  id: string;
  pipelineId: string;
  title: string;
  description: string | null;
  order: number;
  timeLimit: number | null;
  mode: string;
  notificationTemplates: Array<{
    trigger: 'INVITATION' | 'SUCCESS' | 'FAILURE';
    subject: string;
    body: string;
  }>;
  schedulingEventTypeId: string | null;
  createdAt: string;
  updatedAt: string;
  challenges: ChallengeResponse[];
}

// ─── Challenge Authoring (ADR-034) ──────────────────────────────────────────

export type ChallengeTemplateType = 'CODE_IMPLEMENTATION' | 'QUIZ_MCQ' | 'QUIZ_SHORT_ANSWER';
export type TemplateDifficulty = 'JUNIOR' | 'MID' | 'SENIOR';
export type TemplateSource = 'SYSTEM' | 'AI_GENERATED' | 'USER_CREATED';
export type BloomLevel = 'remember' | 'understand' | 'apply' | 'analyze' | 'evaluate' | 'create';
export type PackRoleType = 'FRONTEND' | 'BACKEND' | 'FULLSTACK' | 'DATA_ENGINEERING' | 'DEVOPS' | 'MOBILE' | 'CUSTOM';
export type PackSeniority = 'JUNIOR' | 'MID' | 'SENIOR' | 'ANY';
export type PackSource = 'SYSTEM' | 'USER_CREATED';

export interface ChallengeTemplateRow {
  id: string;
  type: ChallengeTemplateType;
  title: string;
  instructions: string;
  difficulty: TemplateDifficulty;
  primary_skill: string;
  secondary_skills: string | null;
  bloom_level: BloomLevel | null;
  estimated_minutes: number | null;
  config: string;
  server_config: string | null;
  source: TemplateSource;
  is_published: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChallengeLanguageVariantRow {
  id: string;
  challenge_template_id: string;
  language: string;
  starter_code: string;
  test_suite: string;
  test_framework: string;
  test_command: string;
  solution_code: string | null;
}

export interface TemplatePackRow {
  id: string;
  name: string;
  description: string | null;
  role_type: PackRoleType;
  seniority: PackSeniority;
  version: number;
  skills: string;
  supported_languages: string | null;
  source: PackSource;
  is_published: number;
  created_by: string | null;
  created_at: string;
}

export interface TemplatePackItemRow {
  template_pack_id: string;
  template_pack_version: number;
  challenge_template_id: string;
  sort_order: number;
  weight: number;
  is_required: number;
}

// ─── Challenge Authoring API responses ──────────────────────────────────────

export interface ChallengeTemplateResponse {
  id: string;
  type: ChallengeTemplateType;
  title: string;
  instructions: string;
  difficulty: TemplateDifficulty;
  primarySkill: string;
  secondarySkills: string[];
  bloomLevel: BloomLevel | null;
  estimatedMinutes: number | null;
  config: Record<string, unknown>;
  /** Only included for owner / admin requests. */
  serverConfig?: Record<string, unknown>;
  source: TemplateSource;
  isPublished: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  /** Language variants — only included on single-template GET. */
  variants?: LanguageVariantResponse[];
}

export interface LanguageVariantResponse {
  id: string;
  language: string;
  starterCode: string;
  testSuite: string;
  testFramework: string;
  testCommand: string;
  /** Only included for owner / admin. */
  solutionCode?: string | null;
}

export interface TemplatePackResponse {
  id: string;
  name: string;
  description: string | null;
  roleType: PackRoleType;
  seniority: PackSeniority;
  version: number;
  skills: string[];
  supportedLanguages: string[];
  source: PackSource;
  isPublished: boolean;
  createdBy: string | null;
  createdAt: string;
  /** Included on single-pack GET. */
  items?: TemplatePackItemResponse[];
}

export interface TemplatePackItemResponse {
  challengeTemplateId: string;
  sortOrder: number;
  weight: number;
  isRequired: boolean;
  /** Included when pack is fetched with ?expand=challenges. */
  challenge?: ChallengeTemplateResponse;
}

// ─── Discovered Repos (CR-13, repo-discovery-pipeline.md) ─────────────────

export type DiscoverySource = 'LIBRARIES_IO' | 'GITHUB_TOPICS' | 'SOURCEGRAPH' | 'MANUAL';
export type RepoStatus =
  | 'DISCOVERING' | 'DISCOVERED' | 'ASSESSED'
  | 'ACCEPTED' | 'REJECTED'
  | 'CONVERTING' | 'CHALLENGE_READY' | 'FAILED';
export type SeniorityBand = 'JUNIOR' | 'MID' | 'SENIOR' | 'STAFF';

export interface DiscoveredRepoRow {
  id: string;
  pipeline_id: string;
  role_context_id: string | null;
  owner_id: string;
  github_owner: string;
  github_repo: string;
  github_url: string;
  default_branch: string | null;
  discovery_source: DiscoverySource;
  discovery_query: string | null;
  stars: number | null;
  last_pushed_at: string | null;
  license: string | null;
  is_archived: number;
  is_fork: number;
  has_ci: number | null;
  primary_language: string | null;
  topics: string | null;
  detected_stack: string | null;
  stack_match_score: number | null;
  sloc: number | null;
  mean_cyclomatic_complexity: number | null;
  source_file_count: number | null;
  seniority_band: SeniorityBand | null;
  quality_score: number | null;
  quality_details: string | null;
  status: RepoStatus;
  rejection_reason: string | null;
  error_message: string | null;
  challenge_template_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface DiscoveredRepoResponse {
  id: string;
  pipelineId: string;
  githubOwner: string;
  githubRepo: string;
  githubUrl: string;
  discoverySource: DiscoverySource;
  stars: number | null;
  lastPushedAt: string | null;
  license: string | null;
  primaryLanguage: string | null;
  topics: string[];
  stackMatchScore: number | null;
  sloc: number | null;
  meanCyclomaticComplexity: number | null;
  sourceFileCount: number | null;
  seniorityBand: SeniorityBand | null;
  qualityScore: number | null;
  status: RepoStatus;
  rejectionReason: string | null;
  challengeTemplateId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DiscoveryJobRow {
  id: string;
  pipeline_id: string;
  role_context_id: string | null;
  owner_id: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  skills_queried: string | null;
  total_candidates: number;
  total_passed: number;
  total_rejected: number;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface DiscoveryJobResponse {
  id: string;
  pipelineId: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  skillsQueried: string[];
  totalCandidates: number;
  totalPassed: number;
  totalRejected: number;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

/** Maps a D1 row to the camelCase API response shape. */
export function toRepoResponse(row: DiscoveredRepoRow): DiscoveredRepoResponse {
  return {
    id: row.id,
    pipelineId: row.pipeline_id,
    githubOwner: row.github_owner,
    githubRepo: row.github_repo,
    githubUrl: row.github_url,
    discoverySource: row.discovery_source,
    stars: row.stars,
    lastPushedAt: row.last_pushed_at,
    license: row.license,
    primaryLanguage: row.primary_language,
    topics: row.topics ? JSON.parse(row.topics) as string[] : [],
    stackMatchScore: row.stack_match_score,
    sloc: row.sloc,
    meanCyclomaticComplexity: row.mean_cyclomatic_complexity,
    sourceFileCount: row.source_file_count,
    seniorityBand: row.seniority_band,
    qualityScore: row.quality_score,
    status: row.status,
    rejectionReason: row.rejection_reason,
    challengeTemplateId: row.challenge_template_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Maps a D1 job row to the camelCase API response shape. */
export function toJobResponse(row: DiscoveryJobRow): DiscoveryJobResponse {
  return {
    id: row.id,
    pipelineId: row.pipeline_id,
    status: row.status,
    skillsQueried: row.skills_queried ? JSON.parse(row.skills_queried) as string[] : [],
    totalCandidates: row.total_candidates,
    totalPassed: row.total_passed,
    totalRejected: row.total_rejected,
    errorMessage: row.error_message,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
  };
}
