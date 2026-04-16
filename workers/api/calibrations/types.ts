/**
 * Model Calibration Registry
 *
 * Tracks calibration metrics per model. Each model has its own calibration
 * record that must pass κ ≥ 0.75 before being approved for production.
 */

export interface CalibrationRecord {
  /** Model identifier (e.g., 'devstral', 'gemma-4-26b', 'sonnet-4') */
  model: string;
  /** Provider for this model */
  provider: 'mistral' | 'workers-ai' | 'anthropic' | 'google-ai' | 'vertex-ai';
  /** Full model name as used in API calls */
  modelId: string;
  /** Cohen's kappa inter-rater agreement (null if not calibrated) */
  kappa: number | null;
  /** Intraclass correlation coefficient (null if not calibrated) */
  icc: number | null;
  /** Mean absolute error vs gold standard */
  mae: number | null;
  /** Number of fixtures used in calibration */
  fixtureCount: number;
  /** ISO timestamp of last calibration run */
  lastCalibrated: string | null;
  /** Whether this model is approved for production (κ ≥ 0.75) */
  approved: boolean;
  /** Path to calibration run directory with raw results */
  calibrationRunPath: string | null;
  /** Notes about this model's performance */
  notes: string;
}

export interface CalibrationRegistry {
  /** Schema version for forward compatibility */
  version: 1;
  /** Last updated timestamp */
  updatedAt: string;
  /** Currently active model for production scoring */
  activeModel: string | null;
  /** All model calibration records */
  models: Record<string, CalibrationRecord>;
}

/** Minimum kappa required for production approval */
export const MIN_KAPPA_THRESHOLD = 0.75;
