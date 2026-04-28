/**
 * Cron Routes Index — scheduled handlers for the Workers runtime.
 *
 * Cron triggers are configured in wrangler.jsonc.
 * Each cron handler receives the ScheduledEvent and Env bindings.
 */

import type { Env } from '../../types';
import { handleIssueCrawlerCron } from './issueCrawler';
import { handleIssueScorerCron } from './issueScorer';
import { handleEnrichmentWorkerCron } from './enrichmentWorker';

export type ScheduledEvent = {
  cron: string;
  type: 'scheduled';
  scheduledTime: number;
};

/**
 * Main scheduled handler — routes to specific cron handlers based on cron expression.
 */
export async function handleScheduled(
  event: ScheduledEvent,
  env: Env,
): Promise<void> {
  console.log(`[cron] Triggered: ${event.cron} at ${new Date(event.scheduledTime).toISOString()}`);

  switch (event.cron) {
    case '0 3 * * 0': {
      // Sunday 03:00 UTC — Issue Crawler
      const result = await handleIssueCrawlerCron(env);
      console.log(`[cron:issueCrawler] Processed ${result.processed} repos, ${result.errors.length} errors`);
      if (result.errors.length > 0) {
        console.error('[cron:issueCrawler] Errors:', result.errors);
      }
      break;
    }

    case '0 4 * * 0': {
      // Sunday 04:00 UTC — Issue Scorer
      const result = await handleIssueScorerCron(env);
      console.log(`[cron:issueScorer] Processed ${result.processed} issues, ${result.errors.length} errors`);
      if (result.errors.length > 0) {
        console.error('[cron:issueScorer] Errors:', result.errors);
      }
      break;
    }

    case '0 */2 * * *': {
      // Every 2 hours — Enrichment Worker
      const result = await handleEnrichmentWorkerCron(env);
      console.log(`[cron:enrichmentWorker] Processed ${result.processed} jobs, ${result.failed} failed`);
      if (result.errors.length > 0) {
        console.error('[cron:enrichmentWorker] Errors:', result.errors);
      }
      break;
    }

    default:
      console.warn(`[cron] Unknown cron expression: ${event.cron}`);
  }
}
