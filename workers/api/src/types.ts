/**
 * Transcript artifact status — tracks transcription lifecycle
 */
export type TranscriptStatus = 'PENDING' | 'COMPLETED' | 'FAILED';

/**
 * Transcript entry — single utterance with speaker and optional timestamp
 */
export interface TranscriptEntry {
  role: 'user' | 'model';
  text: string;
  timestamp?: string;
}

/**
 * Transcript artifact — persisted video call transcript
 */
export interface TranscriptArtifact {
  id: string;
  scheduledInterviewId: string;
  status: TranscriptStatus;
  transcriptJson: string | null;  // JSON string of TranscriptEntry[]
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

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
  /** Optional Workers AI text-generation model override. */
  CLOUDFLARE_AI_MODEL?: string;
  /** Optional scheduled candidate-ingestion repair batch size. Defaults conservatively in code. */
  CANDIDATE_INGESTION_RETRY_LIMIT?: string;
  /**
   * Vectorize index binding for repo_searchable_profile embeddings.
   * Used in discover.ts hybrid recall (STRATEGY Decision Log 2026-04-14).
   */
  REPO_INDEX: VectorizeIndex;
  /**
   * Vectorize index binding for candidate_searchable_profile embeddings.
   * Symmetric with REPO_INDEX (same 1024-dim bge-large-en-v1.5 space).
   * Populated on resume upload by the Candidate Discovery agent
   * (STRATEGY Decision Log 2026-04-21, ADR-039).
   */
  CANDIDATE_INDEX: VectorizeIndex;
  /**
   * Vectorize index binding for role_searchable_profile embeddings.
   * Symmetric with REPO_INDEX and CANDIDATE_INDEX (same 1024-dim space).
   * Enables role→candidate, role→repo, and candidate→role ANN queries.
   */
  ROLE_INDEX: VectorizeIndex;
  /** Clerk secret key for JWT verification. Set via .dev.vars in dev. */
  CLERK_SECRET_KEY: string;
  /** Session token secret for candidate JWT signing/verification. */
  SESSION_TOKEN_SECRET: string;
  /** When 'true', bypasses Clerk JWT verification in local dev. Never set in production. */
  DEV_AUTH_BYPASS?: string;
  /** Deployment environment label from wrangler env blocks. Used for gated test-only routes. */
  ENV?: string;
  /** User ID to use when DEV_AUTH_BYPASS is enabled. */
  DEV_BYPASS_USER_ID?: string;
  /**
   * GitHub personal access token for the PR fetch proxy.
   * Set via .dev.vars in dev, Worker secret in production.
   * Optional — unauthenticated requests are rate-limited at 60/hour.
   */
  GITHUB_TOKEN?: string;
  GOOGLE_AI_API_KEY?: string;
  /** 'cloudflare-ai' | 'google-ai' | 'vertex-ai' | 'kimi' — selects the role agent provider. Default: 'cloudflare-ai'. */
  ROLE_AGENT_PROVIDER?: string;
  /**
   * Override provider for role agent synthesis turns (budget exhausted).
   * When unset, falls back to ROLE_AGENT_PROVIDER.
   * Allows using a stronger model for synthesis while keeping questions fast.
   */
  ROLE_AGENT_SYNTHESIS_PROVIDER?: string;
  /**
   * When set to "true", AI agents return deterministic canned responses.
   * Used in E2E/integration tests to avoid real LLM calls.
   */
  MOCK_AI?: string;
  /**
   * When set to "true", the culture interview uses the static 15-question bank
   * instead of the generative adaptive planner. Compliance escape hatch for
   * strict regulatory regimes (NYC LL 144, EU AI Act Art 14).
   */
  USE_STATIC_QUESTION_BANK?: string;
  /** Durable Object binding for video call signaling rooms. */
  VIDEO_ROOM: DurableObjectNamespace;
  /** Durable Object binding for dev container sessions (ADR-037, Phase 3b). */
  DEV_CONTAINER: DurableObjectNamespace;
  /** Durable Object binding for live panel sessions. */
  VOICE_SESSION: DurableObjectNamespace;
  /** Selects the LiveProvider implementation. 'vertex-live' | 'openai-realtime' | 'mock'. Default: 'vertex-live'. */
  LIVE_PROVIDER?: string;
  /** Used to authenticate DO→Worker transcript callbacks for live panel sessions. */
  VOICE_SESSION_INTERNAL_SECRET?: string;
  /** GCP project ID for Vertex AI services. */
  GOOGLE_CLOUD_PROJECT?: string;
  /** Metered.ca API key for TURN credential fetching. */
  METERED_API_KEY?: string;
  /** Cloudflare Realtime TURN key id for short-lived ICE credential generation. */
  CLOUDFLARE_TURN_KEY_ID?: string;
  /** Cloudflare Realtime TURN key API token. */
  CLOUDFLARE_TURN_KEY_API_TOKEN?: string;
  /** Optional TTL for generated Cloudflare TURN credentials, in seconds. */
  CLOUDFLARE_TURN_TTL_SECONDS?: string;
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
  /** Cloudflare Email Sending binding for transactional outbound email. */
  EMAIL?: {
    send(message: {
      to: string | string[] | { email: string; name?: string } | Array<string | { email: string; name?: string }>;
      from: string | { email: string; name?: string };
      subject: string;
      html?: string;
      text?: string;
      replyTo?: string | { email: string; name?: string };
    }): Promise<{ messageId: string }>;
  };
  /** Default top-domain sender for app transactional email. */
  OUTBOUND_EMAIL_FROM?: string;
  /** Optional public URL for email logo rendering. Defaults to the API asset route. */
  PUBLIC_EMAIL_LOGO_URL?: string;
  /** Public API base URL used for provider webhook callbacks. */
  API_BASE_URL?: string;
  /**
   * Base URL for candidate-facing assessment links.
   * Defaults to 'https://pipe.build' in production.
   */
  APP_BASE_URL?: string;
  /** Base URL for the standalone host/guest video room app. */
  VIDEO_ROOM_APP_URL?: string;
  /** Shared secret accepted only from the authenticated dev room proxy. */
  DEV_PROXY_SECRET?: string;
  /** Devin API key injected server-side into dev containers for the real agent bridge provider. */
  DEVIN_API_KEY?: string;
  /** Devin organization id paired with DEVIN_API_KEY for real agent bridge provider auth. */
  DEVIN_ORG_ID?: string;
  /** Dev-only Basic Auth username embedded into generated room links. */
  DEV_BASIC_AUTH_USER?: string;
  /** Dev-only Basic Auth password embedded into generated room links. */
  DEV_BASIC_AUTH_PASSWORD?: string;
  /** Dev-only Basic Auth username for the video room (overrides DEV_BASIC_AUTH_USER). */
  VIDEO_ROOM_DEV_AUTH_USER?: string;
  /** Dev-only Basic Auth password for the video room (overrides DEV_BASIC_AUTH_PASSWORD). */
  VIDEO_ROOM_DEV_AUTH_PASSWORD?: string;
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
  /** Cloudflare AI Gateway base URL for Vertex AI (e.g. https://gateway.ai.cloudflare.com/v1/ACCOUNT_ID/GATEWAY_NAME/google-vertex-ai). */
  CF_AI_GATEWAY_URL?: string;
  /** Cloudflare API token with AI Gateway:Read permission. */
  CF_API_TOKEN?: string;
  /** GCP service account JSON string — still required for VertexLiveProvider and TTS direct Google API calls. */
  VERTEX_SA_KEY_JSON?: string;
  /** GCP project ID — required for Vertex AI URL path when using AI Gateway. */
  VERTEX_AI_PROJECT_ID?: string;
  /** GCP region for Vertex AI endpoints. Default: us-central1. */
  VERTEX_AI_REGION?: string;
  /** Vertex AI model override. Default: google/gemma-4-26b-a4b-it-maas. */
  VERTEX_AI_MODEL?: string;
  /** Vertex AI Live (BidiGenerateContent) model override. Default: gemini-live-2.5-flash-native-audio. */
  VERTEX_AI_LIVE_MODEL?: string;
  /** Kimi API key for scorer calibration and other Kimi-backed agents. */
  KIMI_API_KEY?: string;
  /** Kimi base URL override. Default: https://api.kimi.com/coding/v1 */
  KIMI_BASE_URL?: string;
  /** Default Kimi model override for agents. */
  KIMI_MODEL?: string;
  /** Kimi model override for scorer. Default: kimi-for-coding */
  KIMI_SCORER_MODEL?: string;
  // ─── Neo4j Graph+Vector Store (ADR-043 through ADR-047) ─────────────────────
  /** Bolt URI for Neo4j. e.g. bolt://localhost:7687 or neo4j+s://host:7687 */
  NEO4J_URI?: string;
  /** Neo4j username. Default: neo4j */
  NEO4J_USER?: string;
  /** Neo4j password */
  NEO4J_PASSWORD?: string;
  /** 'd1' | 'neo4j' — selects the primary match store during cutover. */
  PRIMARY_MATCH_STORE?: string;
  /** People Data Labs API key for candidate sourcing and enrichment. */
  PDL_API_KEY?: string;
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
  owner_id: string | null;
  title: string;
  description: string | null;
  sort_order: number;
  time_limit: number | null;
  mode: string | null;
  stage_type: string | null;
  is_scheduled: number;
  notification_templates: string | null;
  video_config: string | null;
  scheduling_event_type_id: string | null;
  screening_format: string | null;
  screening_input_mode: string | null;
  template_pack_id: string | null;
  template_pack_version: number | null;
  created_at: string;
  updated_at: string;
}

export interface ChallengeRow {
  id: string;
  stage_id: string;
  type: 'CODE_REVIEW' | 'CODE_IMPLEMENTATION' | 'QUIZ_MCQ' | 'QUIZ_SHORT_ANSWER' | 'FOLLOW_UP' | 'INTAKE' | 'AGENT_INTERVIEW';
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
  dev_container_ttl_seconds: number | null;
  dev_container_repo_url: string | null;
  dev_container_challenge_branch: string | null;
  created_at: string;
  updated_at: string;
}

/** @deprecated StageRow now includes all owner/config columns. Use StageRow directly. */
export type StageWithOwnerRow = StageRow;

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
  /** RecruitmentBrief JSON (stringified). Null until synthesis runs. (RD-P5) */
  recruitment_brief_json: string | null;
  /** 400–600 word narrative describing the role, suitable for embedding. */
  role_searchable_profile?: string | null;
  /** BGE-large-en-v1.5 vector JSON (dual-layer ground truth). */
  embedding_json?: string | null;
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

export type RepoArchitectureStyle =
  | 'monolith'
  | 'layered_service'
  | 'microservice'
  | 'library'
  | 'unknown';

export type RepoTestStyle =
  | 'unit_only'
  | 'integration_heavy'
  | 'e2e_present'
  | 'minimal'
  | 'unknown';

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
  architecture_style: RepoArchitectureStyle | null;
  review_density: number | null;
  commit_cadence: number | null;
  satd_density: number | null;

  // RUC §2.0 canonical alignment + STRATEGY Decision Log 2026-04-14 extensions
  test_style: RepoTestStyle | null;
  /** JSON-stringified ChallengeSurfaces (10 *_potential keys). */
  challenge_surfaces: string | null;
  /** 400–600 word Gemma-narrated profile (embedded into Vectorize REPO_INDEX). */
  repo_searchable_profile: string;
  /** BGE-large-en-v1.5 vector JSON (dual-layer ground truth). */
  embedding_json?: string | null;

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

// ─── RD-P6: Issue Ingestion types ────────────────────────────────────────────

/**
 * Raw issue snapshot from GitHub, stored in repo_issues table.
 * Issues are volatile (can close after crawl), so runtime state verification
 * is required before challenge assignment.
 */
export interface RepoIssueRow {
  id: number;
  repo_id: number;

  // GitHub identifiers
  github_issue_id: number;
  issue_number: number;

  // Content snapshot
  title: string;
  body: string | null;
  author_login: string;

  // Metadata
  labels_json: string | null;          // JSON array of label strings
  comment_count: number;
  reactions_total: number | null;

  // Timestamps
  github_created_at: string;
  github_updated_at: string;
  crawled_at: string;
  state_at_crawl: 'open' | 'closed';

  // PR linkage (for CODE_IMPLEMENTATION filtering)
  has_merged_pr: 0 | 1;

  // Body cache (issue-body-prefetch subtask-1)
  body_cache_json: string | null;
  body_cached_at: number | null;
  body_cache_ttl_days: number;
}

/** Difficulty band for challenge assignment (junior gets easier issues). */
export type IssueDifficultyBand = 'junior' | 'mid' | 'senior';

/** Reasons an issue may be disqualified from challenge use. */
export type IssueDisqualifiedReason =
  | 'too_vague'
  | 'too_large'
  | 'requires_maintainer'
  | 'staff_level'
  | 'duplicate'
  | 'stale'
  | 'already_assigned'
  | null;

/**
 * AI-scored challenge suitability signals for an issue.
 * Scored by Gemma 4 26B.
 */
export interface IssueChallengeSignalsRow {
  id: number;
  issue_id: number;

  // AI-generated scores (0.0 - 1.0)
  implementability_score: number | null;
  clarity_score: number | null;
  scope_score: number | null;
  isolation_score: number | null;

  // Derived difficulty band
  difficulty_band: IssueDifficultyBand | null;

  // AI rationale
  assessment_narrative: string | null;

  // Disqualification
  disqualified: 0 | 1;
  disqualified_reason: IssueDisqualifiedReason;

  // Provenance
  signals_version: number;
  model_used: string;
  generated_at: string;
}

/**
 * Runtime issue state check result.
 * Used before assigning an issue as a challenge (issues can close after crawl).
 */
export interface IssueStateCheck {
  stillOpen: boolean;
  hasNewActivity: boolean;
  assignedToSomeone: boolean;
  /** If state changed, the current state from GitHub. */
  currentState?: 'open' | 'closed';
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

// ─── RD-P5: Phase-switching agent types ──────────────────────────────────────

/** The five posture-specific conversation phases for role discovery (RD-P5). */
export type ConversationPhase =
  | 'CONTEXT'
  | 'DISCOVERY'
  | 'SOUL'
  | 'PRIORITIZE'
  | 'EVP_FRICTION'
  | 'WRAP_UP';

/** Gartner five-category Employer Value Proposition dimensions. */
export type EvpCategory =
  | 'Rewards'
  | 'Opportunity'
  | 'Work'
  | 'People'
  | 'Organisation';

/** A concrete story record extracted during discovery. */
export interface ExtractedStory {
  protagonist: string;
  situation: string;
  stakes: string;
  resolution: string;
  moral: string;
  sourceTurn: number;
  retellabilityScore: 'HIGH' | 'MEDIUM' | 'LOW';
}

/** MEDDIC qualification state tracked by the controller. */
export interface QualificationStatus {
  economicBuyerIdentified: boolean;
  championIdentified: boolean;
  decisionProcessMapped: boolean;
  budgetApproved: boolean;
  timelineUrgency: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
}

/**
 * Full conversation context assembled from knowledgeState each turn.
 * Passed to the deterministic controller.
 */
export interface ConversationContext {
  phase: ConversationPhase;
  domainCoverage: Record<string, DomainCoverage>;
  evpCoverage: Record<EvpCategory, DomainCoverage>;
  storiesExtracted: ExtractedStory[];
  qualificationStatus: QualificationStatus;
  mustHavesPrioritized: boolean;
  frictionProbed: boolean;
  dayInLifeProbed: boolean;
  /** Probe progression: how many of the 6 calibrated probes have been delivered. */
  probesDelivered: number;
}

/**
 * Output of the deterministic phase controller.
 * Passed to callRoleAgent() to select the phase-specific system prompt.
 */
export interface PhaseDirective {
  phase: ConversationPhase;
  /** One-line directive for the phase agent. */
  focusGoal: string;
  /** Specific gaps the agent should address this turn. */
  urgentGaps: string[];
  /**
   * True when all forcing-function gates are met.
   * Informational only — budget exhaustion still triggers synthesis regardless.
   */
  synthesisAllowed: boolean;
  /** Why this phase/directive was chosen. Persisted to knowledge_state._phase for debugging. */
  reasoning: string;
}

/**
 * Structured artifact for recruiter outreach.
 * Sits alongside the RoleContextDocument (which serves the scorecard).
 * Different consumers: RCD = internal assessment; RecruitmentBrief = candidate pitch.
 */
export interface RecruitmentBrief {
  evpCoverage: Record<EvpCategory, DomainCoverage>;
  compensationNarrative: {
    rangeText: string;
    marketAlignment: 'AT_MARKET' | 'BELOW' | 'ABOVE' | 'UNKNOWN';
    rangeShared: boolean;
  };
  stories: ExtractedStory[];
  transparentFriction: Array<{
    rawFriction: string;
    framing: string;
    sourceTurn: number;
  }>;
  demandSidePitch: {
    pushFromCurrent: string;
    pullToUs: string;
    anxietyMitigators: string;
    habitBreakers: string;
  };
  qualification: QualificationStatus;
}

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
  domain_state: string | null;
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
  type: 'CODE_REVIEW' | 'CODE_IMPLEMENTATION' | 'QUIZ_MCQ' | 'QUIZ_SHORT_ANSWER' | 'FOLLOW_UP' | 'INTAKE' | 'AGENT_INTERVIEW';
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

// ─── Discovered Repos (ADR-032, repo-discovery-pipeline.md) ─────────────────

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

// ─── Eval-gated question pipeline types ─────────────────────────────────────

/** A candidate question produced by the role-discovery agent, before eval-gate approval. */
export interface CandidateQuestion {
  id: string;
  text: string;
  goal: string;
  expectedCoverage: {
    domain: string;
    from: DomainCoverage;
    to: DomainCoverage;
  };
  probeAlignment?: string;
  questionType: 'introductory' | 'grand_tour' | 'example' | 'drilling' | 'direct' | 'hypothesis' | 'contrast';
}

/** Result of evaluating a single candidate question through the quality gate. */
export interface EvalResult {
  approved: boolean;
  goalAssessment: 'aligned' | 'mismatched' | 'vague';
  coverageAssessment: 'realistic' | 'overstated' | 'understated';
  toneAssessment: 'conversational' | 'interrogative' | 'leading';
  redundancyCheck: 'novel' | 'duplicate' | 'near_duplicate';
  reason: string;
  suggestedRewrite?: string;
}

// ─── Candidate Ingestion Rows ────────────────────────────────────────────────

export interface CandidateIngestionRow {
  candidate_id: string;
  status: 'pending' | 'profile_generated' | 'embedded' | 'matched' | 'failed';
  candidate_searchable_profile: string | null;
  key_concepts_json: string | null;
  profile_version: string | null;
  model_used: string | null;
  matched_repo_id: number | null;
  profile_generated_at: string | null;
  profile_embedded_at: string | null;
  matched_at: string | null;
  error_text: string | null;
  created_at: string;
  updated_at: string;
}

export interface CandidateChallengeAssignmentRow {
  id: string;
  candidate_id: string;
  stage_id: string;
  challenge_id: string;
  repo_id: number | null;
  github_repo_url: string | null;
  github_pr_number: number | null;
  issue_number: number | null;
  assigned_at: string;
}

export interface CandidateProfileStateRow {
  candidate_id: string;
  overall_status: 'seed' | 'enriching' | 'screening' | 'active' | 'dormant' | 'archived';
  last_intake_at: number | null;
  last_enriched_at: number | null;
  last_screened_at: number | null;
  last_matched_at: number | null;
  re_engagement_eligible_at: number | null;
  profile_version: string | null;
  created_at: number;
  updated_at: number;
}

export interface ChallengeSubmissionRow {
  id: string;
  candidate_id: string;
  challenge_id: string;
  response_json: string | null;
  score_report_json: string | null;
  hitl_status: 'PENDING_REVIEW' | 'CONFIRMED' | 'OVERRIDDEN' | null;
  created_at: string;
  updated_at: string;
}

export interface EnrichmentJobRow {
  id: string;
  candidate_id: string;
  source_type: 'github' | 'url_content';
  source_url: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'DONE' | 'FAILED' | 'SKIPPED';
  attempt_count: number;
  last_attempted_at: number | null;
  completed_at: number | null;
  error_text: string | null;
  created_at: number;
  updated_at: number;
}

export interface SituationFitCacheRow {
  cache_key: string;
  candidate_id: string;
  repo_id: number;
  profile_version: string | null;
  signals_version: string | null;
  result_json: string;
  created_at: string;
}

export interface MatchFeedbackRow {
  id: string;
  candidate_id: string;
  repo_id: number | null;
  pipeline_id: string;
  stage_id: string;
  thumb: 'up' | 'down';
  reason: string | null;
  triangulated_score: number | null;
  role_repo_alignment: number | null;
  candidate_repo_fit: number | null;
  role_candidate_cosine: number | null;
  created_at: string;
}

// ─── Candidate Living Graph (Phase 3) ────────────────────────────────────────

/**
 * Source-backed semantic classification.
 *
 * This is intentionally open-ended. Known values are data, not a code-owned
 * taxonomy; new extractors may emit new node types without a deployment.
 */
export type CandidateNodeType = string;

/** Open concept key used as a candidate coverage dimension. */
export type CoverageAspect = string;

export interface CandidateNode {
  id: string;
  ingestion_key?: string | null;
  candidate_id: string;
  node_type: CandidateNodeType;
  narrative_text: string;
  extracted_properties_json: string | null;
  embedding_json: string | null;
  source_type: string;
  source_reference: string | null;
  captured_at: number;
  confidence: number | null;
  supersedes: string | null;
  superseded_at: number | null;
  decomposition_version: string | null;
  created_at: number;
  updated_at: number;
}

export interface CandidateCoverage {
  candidate_id: string;
  overall_coverage: number;
  dimension_count: number;
  evidence_count: number;
  source_diversity: number;
  interaction_count: number;
  first_observed_at: string | null;
  last_observed_at: string | null;
  last_probed_at: number | null;
  next_probe_concept_id: string | null;
  policy_version: string;
  updated_at: number;
  dimensions: CoverageDimension[];
}

export interface CoverageDimension {
  conceptId: string;
  canonicalKey: string;
  label: string;
  score: number;
  confidence: number;
  evidenceCount: number;
  assertionCount: number;
  sourceDiversity: number;
  interactionCount: number;
  firstObservedAt: string | null;
  lastObservedAt: string | null;
}

export interface CoverageResult {
  candidateId: string;
  overallScore: number;
  evidenceCount: number;
  sourceDiversity: number;
  interactionCount: number;
  firstObservedAt: string | null;
  lastObservedAt: string | null;
  policyVersion: string;
  dimensions: CoverageDimension[];
}

/** Extracted properties for TechnicalDemonstration nodes sourced from code reviews */
export interface CodeReviewDemonstrationProperties {
  dimension:
    | 'issue_identification'
    | 'reasoning_quality'
    | 'prioritization'
    | 'question_formation'
    | 'revision_evaluation'
    | 'ai_direction';
  bars_score: number;
  effectiveness_metrics: {
    bugs_found_pct?: number;
    false_positive_count?: number;
    cave_ratio?: number;
    fix_verifications?: number;
  };
  implementer_persona: string;
  challenge_repo_id: string;
}

/** Extracted properties for CulturalSignal nodes sourced from culture interviews */
export interface CulturalSignalProperties {
  dimension_type: 'competency' | 'profile';
  dimension: string;
  bars_score: number;
  evidence_quotes: string[];
  reasoning: string;
  confidence: number;
  rcd_version?: string;
  role_context_id?: string;
  is_role_specific: boolean;
}

export interface RecencyReport {
  dimensions: Record<string, {
    conceptId: string;
    canonicalKey: string;
    label: string;
    lastObservedAt: string | null;
    evidenceCount: number;
    staleFlag: boolean;
  }>;
  overallStaleness: 'fresh' | 'partial' | 'stale';
  policyVersion: string;
}

export interface ReEngagementPlan {
  needsReEnrichment: boolean;
  needsScreener: boolean;
  thinDimensions: CoverageAspect[];
  shouldRecomputeMatch: boolean;
}
