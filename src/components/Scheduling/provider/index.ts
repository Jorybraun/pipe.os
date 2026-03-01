export type { SchedulingProviderConfig, SchedulingProviderDef } from './types';
export { resolveSchedulingProvider } from './types';
export { CalendlyProvider, CalendlyPlugin } from './CalendlyProvider';
export { CalComProvider, CalComPlugin } from './CalComProvider';
export { ManualProvider } from './ManualProvider';

import { CalendlyProvider } from './CalendlyProvider';
import { CalComProvider } from './CalComProvider';
import { ManualProvider } from './ManualProvider';
import type { SchedulingProviderDef } from './types';

import { CalendlyPlugin } from './CalendlyProvider';
import { CalComPlugin } from './CalComProvider';
import { registerPlugin } from '../../../lib/scheduling/pluginRegistry';

/**
 * Ordered list of all registered scheduling providers.
 * ManualProvider must be last — it matches every URL (fallback).
 */
export const ALL_PROVIDERS: SchedulingProviderDef[] = [
  CalendlyProvider,
  CalComProvider,
  ManualProvider,
];

// Auto-register IoC plugins when this module is imported.
// ManualProvider is not registered — it has no OAuth flow.
registerPlugin(CalendlyPlugin);
registerPlugin(CalComPlugin);
