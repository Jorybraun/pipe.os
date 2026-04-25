/**
 * Unified Agent Runtime — Plugin Registry
 *
 * Agents register themselves as plugins. The runtime looks up plugins by type.
 */

import type { AgentPlugin, AgentType } from './types';

const registry = new Map<AgentType, AgentPlugin>();

export function registerPlugin(plugin: AgentPlugin): void {
  registry.set(plugin.type, plugin);
}

export function getPlugin(type: AgentType): AgentPlugin {
  const plugin = registry.get(type);
  if (!plugin) {
    throw new Error(`No plugin registered for agent type: ${type}`);
  }
  return plugin;
}

export function hasPlugin(type: AgentType): boolean {
  return registry.has(type);
}

export function listPlugins(): AgentType[] {
  return Array.from(registry.keys());
}

/** Clear all registered plugins (test helper). */
export function clearPlugins(): void {
  registry.clear();
}
