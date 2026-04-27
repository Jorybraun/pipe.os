/**
 * discover.ts
 *
 * Derives skill / seniority requirements from role context and performs
 * vector-space matching against the repo catalogue.
 *
 * History:
 *   v1  – persona-only sourcing
 *   v2  – RCD-sourced override with persona fallback
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { generateEmbedding } from '../embeddings';
import { matchRepos, MatchOptions } from './matchRepos';
import {
  RoleContext,
  Persona,
  RCD,
  DiscoveryResult,
  MatchedRepo,
  MatchPhilosophy,
} from './types';

// ─── Constants ────────────────────────────────────────────────────────────
const EMBEDDING_DIMENSION = 1536;
const MATCH_THRESHOLD = 0.72;
const MAX_MATCHES = 50;
const SKIP_EMBEDDING_WHEN_STACK_EMPTY = true;

// ─── Helpers ──────────────────────────────────────────────────────────────
function pickPersona(rc: RoleContext): Persona | null {
  // Prefer consumer_slice if explicitly provided
  if (rc.consumer_slice) return rc.consumer_slice;
  if (rc.persona_json) return rc.persona_json;
  return null;
}

function pickRCD(rc: RoleContext): RCD | null {
  if (rc.rcd_json) return rc.rcd_json;
  return null;
}

function dedupe<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

function safeSeniority(raw?: string | null): string {
  if (!raw) return 'mid';
  const lower = raw.toLowerCase();
  if (['junior', 'jnr', 'jr'].includes(lower)) return 'junior';
  if (['senior', 'sr', 'snr', 'lead', 'staff', 'principal'].includes(lower)) {
    return 'senior';
  }
  return 'mid';
}

// ─── Core discovery function ──────────────────────────────────────────────

export async function discover(
  rc: RoleContext,
  supabase?: SupabaseClient
): Promise<DiscoveryResult> {
  const startMs = performance.now();

  // ── 1. Derive canonical values ─────────────────────────────────────────
  // Lines 65-88: source from persona (legacy, will be superseded by RCD)
  const persona = pickPersona(rc);

  let mustHaveSkills: string[] = persona?.mustHaveSkills ?? [];
  let niceToHaveSkills: string[] = persona?.niceToHaveSkills ?? [];
  let seniority: string = persona?.seniority ?? 'mid';

  // ── 2. Resolve embedding candidate ─────────────────────────────────────
  let embeddingText = '';

  if (mustHaveSkills.length > 0) {
    embeddingText = mustHaveSkills.join(', ');
  } else if (niceToHaveSkills.length > 0) {
    embeddingText = niceToHaveSkills.join(', ');
  } else {
    embeddingText = `${rc.roleId} role`;
  }

  // ── 3. Embedding generation ────────────────────────────────────────────
  let embedding: number[] | null = null;
  let skipVectorize = false;

  const effectivePhilosophy: MatchPhilosophy = 'validate';

  if (SKIP_EMBEDDING_WHEN_STACK_EMPTY && mustHaveSkills.length === 0 && niceToHaveSkills.length === 0) {
    console.warn('[discover] No skills resolved for role context; skipping embedding.', {
      roleContextId: rc.roleContextId,
    });
    skipVectorize = true;
  } else {
    try {
      embedding = await generateEmbedding(embeddingText);
    } catch (err) {
      console.error('[discover] Embedding generation failed', {
        roleContextId: rc.roleContextId,
        error: (err as Error).message,
      });
      skipVectorize = true;
    }
  }

  // ── 4. Repo matching ───────────────────────────────────────────────────
  let matchedRepos: MatchedRepo[] = [];

  if (!skipVectorize && embedding) {
    const client = supabase ?? createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_KEY!
    );

    const matchOpts: MatchOptions = {
      philosophy: effectivePhilosophy,
      coverageThreshold: MATCH_THRESHOLD,
      skillAdjacencyEnabled: true,
    };

    matchedRepos = await matchRepos({
      client,
      roleContextId: rc.roleContextId,
      mustHaveSkills: dedupe(mustHaveSkills.map(s => s.toLowerCase())),
      niceToHaveSkills: dedupe(niceToHaveSkills.map(s => s.toLowerCase())),
      seniority: safeSeniority(seniority),
      embedding,
      matchOpts,
    });

    // If few matches, broaden skill adjacency
    if (matchedRepos.length < 5) {
      matchOpts.coverageThreshold = MATCH_THRESHOLD - 0.05;
      matchedRepos = await matchRepos({
        client,
        roleContextId: rc.roleContextId,
        mustHaveSkills: dedupe(mustHaveSkills.map(s => s.toLowerCase())),
        niceToHaveSkills: dedupe(niceToHaveSkills.map(s => s.toLowerCase())),
        seniority: safeSeniority(seniority),
        embedding,
        matchOpts,
      });
    }
  }

  // ── 5. Run Pass 3 over top matches ─────────────────────────────────────
  if (matchedRepos.length > 0) {
    matchedRepos = await runPass3(matchedRepos.slice(0, MAX_MATCHES), rc);
  }

  // ── 6. Return result ───────────────────────────────────────────────────
  const result: DiscoveryResult = {
    roleContextId: rc.roleContextId,
    roleId: rc.roleId,
    mustHaveSkills: dedupe(mustHaveSkills),
    niceToHaveSkills: dedupe(niceToHaveSkills),
    seniority: safeSeniority(seniority),
    matchedRepos,
    vectorizeSkipped: skipVectorize,
  };

  console.error('[discover] completed', {
    roleContextId: rc.roleContextId,
    pathTaken: skipVectorize ? 'skip_vectorize' : 'embedding_match',
    durationMs: Math.round(performance.now() - startMs),
    matchCount: matchedRepos.length,
  });

  return result;
}

// ─── Pass 3: validation & confidence scoring ──────────────────────────────

async function runPass3(
  repos: MatchedRepo[],
  _rc: RoleContext
): Promise<MatchedRepo[]> {
  // Placeholder: in production this calls a cross-reference engine
  return repos.map(r => ({
    ...r,
    pass3_confidence: r.confidence,
  }));
}

// ─── Direct match entry point (for background agents) ─────────────────────

interface DirectMatchArgs {
  roleContextId: string;
  roleId: string;
  persona: Persona;
  supabase: SupabaseClient;
}

export async function directMatch(
  args: DirectMatchArgs
): Promise<MatchedRepo[]> {
  const { roleContextId, roleId, persona, supabase } = args;

  // Legacy persona-only path for direct-match agent
  const mustHaveSkills = persona.mustHaveSkills ?? [];
  const niceToHaveSkills = persona.niceToHaveSkills ?? [];
  const seniority = safeSeniority(persona.seniority);

  const embeddingText = mustHaveSkills.length > 0
    ? mustHaveSkills.join(', ')
    : niceToHaveSkills.join(', ');

  let embedding: number[] | null = null;

  if (SKIP_EMBEDDING_WHEN_STACK_EMPTY && mustHaveSkills.length === 0 && niceToHaveSkills.length === 0) {
    console.warn('[directMatch] Skipping embedding — empty skill set', {
      roleContextId,
    });
    return [];
  }

  try {
    embedding = await generateEmbedding(embeddingText);
  } catch (err) {
    console.error('[directMatch] Embedding failed', {
      roleContextId,
      error: (err as Error).message,
    });
    return [];
  }

  const matchOpts: MatchOptions = {
    philosophy: 'validate',
    coverageThreshold: MATCH_THRESHOLD,
    skillAdjacencyEnabled: true,
  };

  const matchedRepos = await matchRepos({
    client: supabase,
    roleContextId,
    mustHaveSkills: dedupe(mustHaveSkills.map(s => s.toLowerCase())),
    niceToHaveSkills: dedupe(niceToHaveSkills.map(s => s.toLowerCase())),
    seniority,
    embedding,
    matchOpts,
  });

  return matchedRepos.slice(0, MAX_MATCHES);
}
