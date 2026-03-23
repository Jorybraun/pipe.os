/**
 * Feature flags for the Pipe platform.
 *
 * Set these in .env.local to enable features locally.
 * In production, each boolean can be swapped for a runtime lookup against
 * a user plan attribute (Cognito / DB) without changing any call sites.
 *
 * Naming convention: VITE_FEATURE_<NAME>=true
 */
export const FEATURES = {
  /**
   * Candidate Intelligence Report — rich per-challenge analytics with SVG charts,
   * skill profiling, annotation breakdown, and full Q&A transcripts.
   *
   * Intended as a paid feature; gated here until billing is wired.
   * Enable locally: VITE_FEATURE_INTELLIGENCE_REPORT=true in .env.local
   */
  INTELLIGENCE_REPORT: import.meta.env.VITE_FEATURE_INTELLIGENCE_REPORT === 'true',
} as const;
