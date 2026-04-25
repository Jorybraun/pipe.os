/**
 * Pass 2: Construct detection
 *
 * Runs every extractor in constructs.config.ts against the cloned repo.
 * Returns only constructs with evidence_count > 0.
 */

import type { ExtractorContext } from '../shared/types.js';
import { CONSTRUCT_EXTRACTORS } from '../constructs.config.js';
import { logger } from '../shared/logger.js';

export interface DetectedConstruct {
  slug: string;
  evidence_count: number;
}

/**
 * Runs all construct extractors and returns those with evidence.
 */
export function detectConstructs(ctx: ExtractorContext): DetectedConstruct[] {
  const results: DetectedConstruct[] = [];

  for (const extractor of CONSTRUCT_EXTRACTORS) {
    try {
      const count = extractor.match(ctx);
      if (count > 0) {
        results.push({ slug: extractor.slug, evidence_count: count });
      }
    } catch (err) {
      logger.warn('[pass2/constructs] Extractor threw', {
        slug: extractor.slug,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.debug('[pass2/constructs] Detection complete', {
    total: CONSTRUCT_EXTRACTORS.length,
    found: results.length,
    slugs: results.map((r) => r.slug),
  });

  return results;
}

/**
 * Returns the subset of construct slugs that a PR's changed files touch.
 * Used for populating repo_sample_prs.construct_slugs_json.
 */
export function constructsForFiles(
  changedFilePaths: string[],
  ctx: ExtractorContext,
): string[] {
  // Create a restricted context with only the changed files
  const restrictedCtx: ExtractorContext = {
    ...ctx,
    filePaths: changedFilePaths,
  };

  const hits: string[] = [];
  for (const extractor of CONSTRUCT_EXTRACTORS) {
    try {
      const count = extractor.match(restrictedCtx);
      if (count > 0) hits.push(extractor.slug);
    } catch {
      // ignore
    }
  }
  return hits;
}
