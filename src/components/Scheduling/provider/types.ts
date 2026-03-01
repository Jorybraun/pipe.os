import type { FC } from 'react';
import type { SchedulingProvider } from '../../../lib/scheduling/types';

export interface SchedulingProviderConfig {
  schedulingUrl: string;
  candidateName: string;
  candidateEmail?: string;
}

export interface SchedulingProviderDef {
  type: SchedulingProvider;
  label: string;
  /** The embeddable widget component for the candidate assessment flow. */
  Widget: FC<SchedulingProviderConfig>;
  /** Returns true if this provider handles the given URL. */
  matches: (url: string) => boolean;
}

/**
 * Detect which scheduling provider owns a given URL and return its definition.
 * Falls back to ManualProvider for unknown URLs.
 *
 * TODO: Import and register providers here as the list grows instead of
 * dynamically importing inside hooks. For MVP the three static providers are fine.
 */
export function resolveSchedulingProvider(
  url: string,
  providers: SchedulingProviderDef[]
): SchedulingProviderDef {
  const match = providers.find((p) => p.matches(url));
  // Safe non-null: callers always pass ManualProvider as the last fallback
  return match ?? providers[providers.length - 1]!;
}
