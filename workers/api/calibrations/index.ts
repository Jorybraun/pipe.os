/**
 * Model Calibration Registry — read/write utilities
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CalibrationRecord, CalibrationRegistry } from './types';
import { MIN_KAPPA_THRESHOLD } from './types';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REGISTRY_PATH = join(__dirname, 'registry.json');

export function loadRegistry(): CalibrationRegistry {
  const raw = readFileSync(REGISTRY_PATH, 'utf-8');
  return JSON.parse(raw) as CalibrationRegistry;
}

export function saveRegistry(registry: CalibrationRegistry): void {
  registry.updatedAt = new Date().toISOString();
  writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2) + '\n');
}

export function getModel(modelName: string): CalibrationRecord | null {
  const registry = loadRegistry();
  return registry.models[modelName] ?? null;
}

export function getActiveModel(): CalibrationRecord | null {
  const registry = loadRegistry();
  if (!registry.activeModel) return null;
  return registry.models[registry.activeModel] ?? null;
}

export function getApprovedModels(): CalibrationRecord[] {
  const registry = loadRegistry();
  return Object.values(registry.models).filter((m) => m.approved);
}

export interface CalibrationResult {
  kappa: number;
  icc: number;
  mae: number;
  fixtureCount: number;
  runPath: string;
}

export function updateCalibration(modelName: string, result: CalibrationResult): CalibrationRecord {
  const registry = loadRegistry();
  const model = registry.models[modelName];

  if (!model) {
    throw new Error(`Unknown model: ${modelName}. Add it to registry.json first.`);
  }

  model.kappa = result.kappa;
  model.icc = result.icc;
  model.mae = result.mae;
  model.fixtureCount = result.fixtureCount;
  model.lastCalibrated = new Date().toISOString();
  model.calibrationRunPath = result.runPath;
  model.approved = result.kappa >= MIN_KAPPA_THRESHOLD;

  saveRegistry(registry);
  return model;
}

export function setActiveModel(modelName: string): void {
  const registry = loadRegistry();
  const model = registry.models[modelName];

  if (!model) {
    throw new Error(`Unknown model: ${modelName}`);
  }
  if (!model.approved) {
    throw new Error(`Model ${modelName} is not approved (κ=${model.kappa}, needs ≥${MIN_KAPPA_THRESHOLD})`);
  }

  registry.activeModel = modelName;
  saveRegistry(registry);
}

export function listModels(): void {
  const registry = loadRegistry();
  console.log('\nModel Calibration Registry\n');
  console.log(`Active: ${registry.activeModel ?? '(none)'}\n`);
  console.log('Model                 Provider      κ        Approved   Last Calibrated');
  console.log('─'.repeat(75));

  for (const [name, m] of Object.entries(registry.models)) {
    const kappa = m.kappa !== null ? m.kappa.toFixed(3) : '   -  ';
    const approved = m.approved ? '  YES' : '   NO';
    const lastCal = m.lastCalibrated ? m.lastCalibrated.split('T')[0] : '     -';
    const active = name === registry.activeModel ? ' *' : '  ';
    console.log(`${active}${name.padEnd(20)} ${m.provider.padEnd(12)} ${kappa}    ${approved}      ${lastCal}`);
  }
  console.log('');
}

// ─── Culture registry re-exports ─────────────────────────────────────────────

export {
  loadCultureRegistry,
  saveCultureRegistry,
  getCultureModel,
  getActiveCultureModel,
  getApprovedCultureModels,
  updateCultureCalibration,
  setActiveCultureModel,
  listCultureModels,
  MIN_QWK_THRESHOLD,
} from './culture.js';
export type {
  CultureCalibrationRecord,
  CultureCalibrationRegistry,
  CultureCalibrationResult,
  CultureProvider,
} from './culture.js';

import { listCultureModels } from './culture.js';

// CLI: node calibrations/index.ts list
if (process.argv[2] === 'list') {
  listModels();
}

// CLI: node calibrations/index.ts list-culture
if (process.argv[2] === 'list-culture') {
  listCultureModels();
}
