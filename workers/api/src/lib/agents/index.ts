/**
 * Agent Plugin Registration
 *
 * Import and register all agent plugins here.
 * This is the single point where the UnifiedAgentRuntime is assembled.
 */

import { registerPlugin } from '../unifiedAgentRuntime/pluginRegistry';
import { roleDiscoveryPlugin } from './roleDiscovery/plugin';
import { codeReviewPlugin } from './codeReview/plugin';
import { cultureInterviewPlugin } from './culture/plugin';

export function registerAllPlugins(): void {
  registerPlugin(roleDiscoveryPlugin);
  registerPlugin(codeReviewPlugin);
  registerPlugin(cultureInterviewPlugin);
}

export { roleDiscoveryPlugin, codeReviewPlugin, cultureInterviewPlugin };
