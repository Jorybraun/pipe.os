export type { SchedulingProviderConfig, SchedulingProviderDef } from './types';
export { resolveSchedulingProvider } from './types';
export { CalendlyProvider } from './CalendlyProvider';
export { CalComProvider } from './CalComProvider';
export { ManualProvider } from './ManualProvider';

import { CalendlyProvider } from './CalendlyProvider';
import { CalComProvider } from './CalComProvider';
import { ManualProvider } from './ManualProvider';
import type { SchedulingProviderDef } from './types';

/**
 * Ordered list of all registered scheduling providers.
 * ManualProvider must be last — it matches every URL (fallback).
 */
export const ALL_PROVIDERS: SchedulingProviderDef[] = [
  CalendlyProvider,
  CalComProvider,
  ManualProvider,
];
