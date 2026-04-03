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
  FEATURE_FLAG_LIVE_VIDEO: false,
  /** Dev container sandbox route and Sandbox nav item */
  FEATURE_FLAG_CODE_SANDBOX: false,
  /** Show QUIZ_MCQ and QUIZ_SHORT_ANSWER challenge types in ChallengePicker */
  FEATURE_FLAG_PREDEFINED_CHALLENGES: true,
  /** /sandbox/dev-container route */
  FEATURE_FLAG_DEV_CONTAINER_ROUTE: false,
  /** Challenge editor page — post-MVP, challenges are read-only for MVP */
  FEATURE_FLAG_CHALLENGE_EDITOR: true,
} as const;
