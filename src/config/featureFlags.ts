/**
 * Feature flags for MVP scope control.
 * Set to `true` to enable a feature, `false` to gate/hide it.
 *
 * All post-MVP features are disabled by default.
 */
export const FEATURE_FLAGS = {
  /** /schedule route and Schedule nav item */
  FEATURE_FLAG_SCHEDULE_ROUTE: true,
  /** Live video stage mode toggle in stage settings */
  FEATURE_FLAG_LIVE_VIDEO: true,
  /** Dev container sandbox route and Sandbox nav item */
  FEATURE_FLAG_CODE_SANDBOX: false,
  /** /sandbox/dev-container route */
  FEATURE_FLAG_DEV_CONTAINER_ROUTE: false,
  /** Challenge editor page — post-MVP, challenges are read-only for MVP */
  FEATURE_FLAG_CHALLENGE_EDITOR: true,
  /** Global copilot agent drawer (ADR-035) — parked until agentic UX is ready */
  FEATURE_FLAG_COPILOT_AGENT: false,
  /** Real-time voice interview (Vertex AI Live WebSocket) — off by default due to cost. */
  FEATURE_FLAG_LIVE_VOICE: false,
  /** Role discovery feature — multi-stakeholder role intake (ADR-028) */
  FEATURE_FLAG_ROLE_DISCOVERY: false,
  /** Pipeline builder — auto-stage construction from role context (post-MVP) */
  FEATURE_FLAG_PIPELINE_BUILDER: false,
} as const;
