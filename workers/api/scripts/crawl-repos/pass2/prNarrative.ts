/**
 * Pass 2 extension: PR narrative enrichment.
 *
 * Generates a Gemma-derived 2–3 sentence narrative per sampled PR and embeds it
 * via BGE-large-en-v1.5 (document side). Non-fatal: individual PR failures are
 * logged and the original PR is returned unchanged.
 */

import type { SamplePR } from '../shared/types.js';
import { callGemma } from '../pass3/run.js';
import { logger } from '../shared/logger.js';
import { preprocessForEmbedding } from '../../../src/lib/embedding/preprocess';

const EMBEDDING_MODEL = '@cf/baai/bge-large-en-v1.5';
const API_BASE = 'https://api.cloudflare.com/client/v4';
const NARRATIVE_VERSION = 'pr-narrative-v1';

const SYSTEM_PROMPT = `You are a technical writer summarizing GitHub pull requests for a developer assessment platform.

Write a concise 2–3 sentence narrative describing what this PR does and what a code reviewer would encounter.
Be specific to the technologies and files mentioned. Do not use generic filler like "this PR makes improvements".
Output plain text only — no markdown, no bullets.`;

function buildPrPrompt(pr: SamplePR): string {
  const constructs = safeJsonParse<string[]>(pr.construct_slugs_json, []);
  const filePaths = safeJsonParse<string[]>(pr.changed_file_paths_json, []);
  const diffSummary = filePaths.slice(0, 8).join(', ');

  return `PR Title: ${pr.title}
Changed files: ${pr.changed_file_count}
Modifies tests: ${pr.modifies_tests ? 'Yes' : 'No'}
Additions: ${pr.additions} | Deletions: ${pr.deletions}
Constructs: ${constructs.join(', ') || 'N/A'}
File paths (sample): ${diffSummary || 'N/A'}

Write a 2–3 sentence narrative describing what this PR does and what a reviewer would encounter.`;
}

function safeJsonParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function embedNarrative(narrative: string): Promise<number[] | null> {
  const accountId = process.env['CLOUDFLARE_ACCOUNT_ID'];
  const apiToken = process.env['CLOUDFLARE_API_TOKEN'];
  if (!accountId || !apiToken) {
    logger.warn('[prNarrative] Embedding skipped — missing CLOUDFLARE_ACCOUNT_ID/API_TOKEN');
    return null;
  }

  const normalized = preprocessForEmbedding(narrative, 'document');

  try {
    const embedRes = await globalThis.fetch(
      `${API_BASE}/accounts/${accountId}/ai/run/${EMBEDDING_MODEL}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: [normalized] }),
      },
    );

    if (!embedRes.ok) {
      const text = await embedRes.text();
      logger.warn('[prNarrative] Embedding call failed', { status: embedRes.status, body: text.slice(0, 300) });
      return null;
    }

    const embedBody = (await embedRes.json()) as {
      result?: { data?: number[][]; shape?: number[] };
      success?: boolean;
    };
    const vector = embedBody.result?.data?.[0];
    if (!vector || !Array.isArray(vector)) {
      logger.warn('[prNarrative] Embedding response missing vector');
      return null;
    }

    return vector;
  } catch (err) {
    logger.warn('[prNarrative] Embedding exception', { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

export async function enrichSamplePRs(
  samplePrs: SamplePR[],
  accessToken: string,
  projectId: string,
): Promise<SamplePR[]> {
  const enriched: SamplePR[] = [];

  for (const pr of samplePrs) {
    try {
      const userPrompt = buildPrPrompt(pr);
      const rawNarrative = await callGemma(
        accessToken,
        projectId,
        SYSTEM_PROMPT,
        userPrompt,
        2,
        'text/plain',
      );

      const narrative = rawNarrative.trim();
      if (!narrative || narrative.length < 10) {
        logger.warn('[prNarrative] Gemma returned empty/short narrative', { pr_number: pr.pr_number });
        enriched.push(pr);
        continue;
      }

      const vector = await embedNarrative(narrative);

      enriched.push({
        ...pr,
        pr_narrative: narrative,
        pr_narrative_embedding_json: vector ? JSON.stringify(vector) : null,
        pr_narrative_version: NARRATIVE_VERSION,
      });
    } catch (err) {
      logger.warn('[prNarrative] Failed to enrich PR (non-fatal)', {
        pr_number: pr.pr_number,
        error: err instanceof Error ? err.message : String(err),
      });
      enriched.push(pr);
    }
  }

  return enriched;
}
