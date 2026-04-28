/**
 * Culture Model Calibration Registry — read/write utilities
 *
 * Separate from the code-review registry because culture uses QWK (not Cohen's κ)
 * and tracks different model/provider pairs.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REGISTRY_PATH = join(__dirname, 'culture-registry.json');

/** Minimum QWK required for production approval (research brief §2.9). */
export const MIN_QWK_THRESHOLD = 0.55;

export type CultureProvider = 'mistral' | 'workers-ai' | 'anthropic' | 'google-ai' | 'vertex-ai';

export interface CultureCalibrationRecord {
  /** Model identifier (e.g., 'devstral', 'gemma-4-26b') */
  model: string;
  /** Provider for this model */
  provider: CultureProvider;
  /** Full model name as used in API calls */
  modelId: string;
  /** Quadratic Weighted Kappa (null if not calibrated) */
  qwk: number | null;
  /** Intraclass correlation coefficient (null if not calibrated) */
  icc: number | null;
  /** Mean absolute error vs gold standard */
  mae: number | null;
  /** Number of fixtures used in calibration */
  fixtureCount: number;
  /** ISO timestamp of last calibration run */
  lastCalibrated: string | null;
  /** Whether this model is approved for production (QWK ≥ 0.55) */
  approved: boolean;
  /** Path to calibration run directory with raw results */
  calibrationRunPath: string | null;
  /** Notes about this model's performance */
  notes: string;
}

export interface CultureCalibrationRegistry {
  /** Schema version for forward compatibility */
  version: 1;
  /** Last updated timestamp */
  updatedAt: string;
  /** Currently active model for production scoring */
  activeModel: string | null;
  /** All model calibration records */
  models: Record<string, CultureCalibrationRecord>;
}

export function loadCultureRegistry(): CultureCalibrationRegistry {
  const raw = readFileSync(REGISTRY_PATH, 'utf-8');
  return JSON.parse(raw) as CultureCalibrationRegistry;
}

export function saveCultureRegistry(registry: CultureCalibrationRegistry): void {
  registry.updatedAt = new Date().toISOString();
  writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2) + '\n');
}

export function getCultureModel(modelName: string): CultureCalibrationRecord | null {
  const registry = loadCultureRegistry();
  return registry.models[modelName] ?? null;
}

export function getActiveCultureModel(): CultureCalibrationRecord | null {
  const registry = loadCultureRegistry();
  if (!registry.activeModel) return null;
  return registry.models[registry.activeModel] ?? null;
}

export function getApprovedCultureModels(): CultureCalibrationRecord[] {
  const registry = loadCultureRegistry();
  return Object.values(registry.models).filter((m) => m.approved);
}

export interface CultureCalibrationResult {
  qwk: number;
  icc: number;
  mae: number;
  fixtureCount: number;
  runPath: string;
}

export function updateCultureCalibration(
  modelName: string,
  result: CultureCalibrationResult,
): CultureCalibrationRecord {
  const registry = loadCultureRegistry();
  const model = registry.models[modelName];

  if (!model) {
    throw new Error(`Unknown culture model: ${modelName}. Add it to culture-registry.json first.`);
  }

  model.qwk = result.qwk;
  model.icc = result.icc;
  model.mae = result.mae;
  model.fixtureCount = result.fixtureCount;
  model.lastCalibrated = new Date().toISOString();
  model.calibrationRunPath = result.runPath;
  model.approved = result.qwk >= MIN_QWK_THRESHOLD;

  saveCultureRegistry(registry);
  return model;
}

export function setActiveCultureModel(modelName: string): void {
  const registry = loadCultureRegistry();
  const model = registry.models[modelName];

  if (!model) {
    throw new Error(`Unknown culture model: ${modelName}`);
  }
  if (!model.approved) {
    throw new Error(
      `Culture model ${modelName} is not approved (QWK=${model.qwk}, needs ≥${MIN_QWK_THRESHOLD})`,
    );
  }

  registry.activeModel = modelName;
  saveCultureRegistry(registry);
}

export function listCultureModels(): void {
  const registry = loadCultureRegistry();
  console.log('\nCulture Model Calibration Registry\n');
  console.log(`Active: ${registry.activeModel ?? '(none)'}\n`);
  console.log('Model                 Provider      QWK      Approved   Last Calibrated');
  console.log('─'.repeat(75));

  for (const [name, m] of Object.entries(registry.models)) {
    const qwk = m.qwk !== null ? m.qwk.toFixed(3) : '   -  ';
    const approved = m.approved ? '  YES' : '   NO';
    const lastCal = m.lastCalibrated ? m.lastCalibrated.split('T')[0] : '     -';
    const active = name === registry.activeModel ? ' *' : '  ';
    console.log(`${active}${name.padEnd(20)} ${m.provider.padEnd(12)} ${qwk}    ${approved}      ${lastCal}`);
  }
  console.log('');
}

// CLI entry point is calibrations/index.ts — this module has no side-effects.
