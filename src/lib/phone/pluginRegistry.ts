/**
 * Phone provider plugin registry — IoC pattern for phone screening providers.
 *
 * Follows the same pattern as src/lib/scheduling/pluginRegistry.ts.
 * For MVP, only Twilio is supported with platform-level credentials.
 * Extensible to per-recruiter providers later.
 */

export interface PhonePlugin {
  type: 'TWILIO';
  label: string;
  /** Whether this provider requires per-user OAuth (false for Twilio MVP). */
  requiresOAuth: boolean;
}

const registry: PhonePlugin[] = [];

export function registerPhonePlugin(plugin: PhonePlugin): void {
  if (registry.some((p) => p.type === plugin.type)) return;
  registry.push(plugin);
}

export function getPhonePluginByType(type: string): PhonePlugin | undefined {
  return registry.find((p) => p.type === type);
}

export function getAllPhonePlugins(): PhonePlugin[] {
  return [...registry];
}
