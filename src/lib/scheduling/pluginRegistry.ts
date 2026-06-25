/**
 * Scheduling Plugin Registry
 *
 * Core IoC contract for the scheduling system. The existing `SchedulingProviderDef`
 * (UI-only widget interface) is extended with server-side capabilities:
 * - OAuth URL generation
 * - Event type discovery (via Lambda)
 * - Booking completion callbacks
 *
 * The registry resolves plugins at runtime by URL or provider type.
 * ManualProvider is NOT a plugin — it's a fallback that lacks OAuth/webhook support.
 *
 * @see docs/specs/scheduling-ioc-technical-spec.md
 * @see docs/decisions/historical/ADR-014-scheduling-ioc-plugin-registry.md
 */

import type { FC } from 'react';

// ─── Widget props (superset of SchedulingProviderConfig) ─────────────────────

/** Configuration passed to provider scheduling widgets */
export interface SchedulingWidgetProps {
  schedulingUrl: string;
  candidateName: string;
  candidateEmail?: string;
  interviewId?: string;
  /** Called when the provider's embed detects a booking completion */
  onBookingComplete?: (externalEventId: string, scheduledAt: string) => void;
}

// ─── Event type (from provider account) ──────────────────────────────────────

/** Event type from the provider's account (for EventTypePicker) */
export interface ProviderEventType {
  id: string;
  name: string;
  durationMinutes: number;
  url: string;
}

// ─── Plugin interface ────────────────────────────────────────────────────────

/** The full client-side scheduling plugin contract */
export interface SchedulingPlugin {
  /** Unique provider identifier */
  type: 'CALENDLY' | 'CAL_COM';

  /** Human-readable label */
  label: string;

  /** URL pattern matcher — used to auto-detect provider from a pasted URL */
  matches: (url: string) => boolean;

  /** The candidate-facing scheduling widget */
  Widget: FC<SchedulingWidgetProps>;

  /**
   * Generate the OAuth authorization URL for this provider.
   *
   * @param redirectUri - The URI to redirect back to after consent
   * @param state - CSRF protection state parameter
   * @returns Full OAuth authorization URL
   */
  getAuthUrl: (redirectUri: string, state: string, codeChallenge?: string) => string;

   /** Fetch event types from the provider API (requires access token) */
  fetchEventTypes?: (accessToken: string) => Promise<ProviderEventType[]>;
}

// ─── Registry ────────────────────────────────────────────────────────────────

const plugins: SchedulingPlugin[] = [];

/**
 * Register a scheduling plugin. Called once per provider at app startup.
 * Order matters — first match wins in `resolvePlugin()`.
 */
export function registerPlugin(plugin: SchedulingPlugin): void {
  // Prevent duplicate registration
  if (plugins.some((p) => p.type === plugin.type)) {
    console.warn(`[pluginRegistry] Plugin already registered: ${plugin.type}`);
    return;
  }
  plugins.push(plugin);
}

/**
 * Resolve a plugin by scheduling URL.
 * Returns null if no plugin matches (caller should fall back to ManualProvider).
 */
export function resolvePlugin(url: string): SchedulingPlugin | null {
  return plugins.find((p) => p.matches(url)) ?? null;
}

/**
 * Get a plugin by its provider type identifier.
 * Returns null if the provider is not registered.
 */
export function getPluginByType(type: string): SchedulingPlugin | null {
  return plugins.find((p) => p.type === type) ?? null;
}

/**
 * Get all registered plugins (read-only).
 * Used by ConnectionSetup to show available providers.
 */
export function getAllPlugins(): readonly SchedulingPlugin[] {
  return plugins;
}
