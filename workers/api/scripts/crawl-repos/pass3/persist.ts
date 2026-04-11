/**
 * Pass 3: Persist
 *
 * Writes repo_engineering_signals rows — the offline AI-summarized signals
 * output (ADR-036 §2). Role-agnostic by design; one row per repo.
 *
 * Idempotent on repo_id via INSERT OR REPLACE so unchanged repos can be
 * re-submitted without duplication. Content hashing is done upstream in the
 * slash command; this function just receives the hash and writes it.
 */

import type { D1Client } from '../shared/d1Client.js';
import type { Pass3Data } from '../shared/types.js';
import { logger } from '../shared/logger.js';

export async function persistPass3(
  db: D1Client,
  data: Pass3Data,
  dryRun = false,
): Promise<void> {
  if (dryRun) {
    logger.info('[pass3/persist] DRY RUN — would upsert repo_engineering_signals', {
      repo_id: data.repo_id,
      content_hash: data.content_hash,
    });
    return;
  }

  await db.query(
    `INSERT OR REPLACE INTO repo_engineering_signals (
      repo_id,
      signals_version,
      content_hash,
      test_touch_rate,
      mean_changed_files,
      p90_changed_files,
      issue_link_rate,
      complexity_band,
      swe_bench_eligibility_rate,
      architecture_style,
      review_density,
      commit_cadence,
      satd_density,
      engineering_narrative,
      signal_json,
      model_used,
      model_version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.repo_id,
      data.signals_version,
      data.content_hash,
      data.test_touch_rate,
      data.mean_changed_files,
      data.p90_changed_files,
      data.issue_link_rate,
      data.complexity_band,
      data.swe_bench_eligibility_rate,
      data.architecture_style,
      data.review_density,
      data.commit_cadence,
      data.satd_density,
      data.engineering_narrative,
      data.signal_json,
      data.model_used,
      data.model_version,
    ],
  );

  logger.debug('[pass3/persist] Pass-3 persisted', {
    repo_id: data.repo_id,
    content_hash: data.content_hash,
  });
}
