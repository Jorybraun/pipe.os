/**
 * repoDiscovery/index.ts
 *
 * Main entry point for the repository-discovery subsystem.
 * Exports agent factory and message handler for the background worker.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { discover, directMatch } from './discover';
import {
  RepoDiscoveryAgent,
  DiscoveryMessage,
  RoleContext,
  DiscoveryResult,
  MatchedRepo,
} from './types';

let _singletonAgent: RepoDiscoveryAgent | null = null;

export function initRepoDiscoveryAgent(): RepoDiscoveryAgent {
  if (_singletonAgent) return _singletonAgent;

  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
  );

  const agent: RepoDiscoveryAgent = {
    async discover(roleContext: RoleContext): Promise<DiscoveryResult> {
      return discover(roleContext, supabase);
    },

    async matchRepos(roleContext: RoleContext): Promise<MatchedRepo[]> {
      const result = await discover(roleContext, supabase);
      return result.matchedRepos;
    },

    async runPass3(repoId: string): Promise<{ confidence: number; approved: boolean }> {
      // Stub: to be wired by passThree.ts in a later phase
      console.warn('[RepoDiscoveryAgent.runPass3] Not yet implemented', { repoId });
      return { confidence: 0, approved: false };
    },
  };

  _singletonAgent = agent;
  return agent;
}

export async function handleRepoDiscoveryMessage(
  msg: DiscoveryMessage
): Promise<void> {
  const agent = initRepoDiscoveryAgent();
  const startMs = performance.now();

  console.error('[handleRepoDiscoveryMessage] received', {
    type: msg.type,
    correlationId: msg.correlationId,
    timestamp: msg.timestamp,
  });

  try {
    switch (msg.type) {
      case 'DISCOVER': {
        const rc = msg.payload as RoleContext;
        await agent.discover(rc);
        break;
      }

      case 'MATCH': {
        const rc = msg.payload as RoleContext;
        await agent.matchRepos(rc);
        break;
      }

      case 'PASS3': {
        const payload = msg.payload as { repoId: string; roleContext: RoleContext };
        await agent.runPass3(payload.repoId);
        break;
      }

      case 'VECTORIZE': {
        // VECTORIZE messages are processed as DISCOVER with explicit skipVectorize=false
        const rc = msg.payload as RoleContext;
        await discover(rc, undefined);
        break;
      }

      default: {
        console.error('[handleRepoDiscoveryMessage] Unknown message type', {
          type: (msg as any).type,
          correlationId: msg.correlationId,
        });
      }
    }
  } catch (err) {
    console.error('[handleRepoDiscoveryMessage] Unhandled error', {
      type: msg.type,
      correlationId: msg.correlationId,
      error: (err as Error).message,
      stack: (err as Error).stack,
    });
    throw err;
  }

  console.error('[handleRepoDiscoveryMessage] completed', {
    type: msg.type,
    correlationId: msg.correlationId,
    durationMs: Math.round(performance.now() - startMs),
  });
}

// Re-exports for consumers
export { discover, directMatch } from './discover';
export { matchRepos } from './matchRepos';
export * from './types';
