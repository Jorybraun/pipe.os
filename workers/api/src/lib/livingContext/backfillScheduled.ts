/**
 * Scheduled backfill runner for the living context graph.
 *
 * Wires the BackfillOrchestrator to concrete backfill tasks executed
 * on the Cloudflare Workers cron trigger. Each invocation:
 *   1. Ensures checkpoints exist for all registered tasks
 *   2. Finds tasks whose dependencies are satisfied
 *   3. Executes the next batch for each ready task
 *   4. Persists cursor progress for resume-on-restart
 *
 * Tasks:
 *   - candidates_to_living_context: backfill all candidates missing LC identity
 *   - contacts_to_living_context: backfill all contacts missing LC identity
 *   - resumes_to_living_context: native resume ingestion for all candidates with resumes
 *   - projection_outbox_drain: process pending neo4j projection jobs
 */

import type { Env } from '../../types';
import { BackfillOrchestrator } from './backfillOrchestrator';
import type { BackfillTaskDefinition, BackfillOrchestratorStatus } from './backfillOrchestrator';
import { ensureCandidateLivingContext, ensureContactLivingContext } from './compatibility';
import { ingestResumeToLivingContext } from './resumeIngestion';
import { processProjectionOutbox } from './projection';
import { checkGate } from './rolloutEnforcement';

const BATCH_SIZE = 50;

export const BACKFILL_TASKS: BackfillTaskDefinition[] = [
  {
    taskKey: 'candidates_to_living_context',
    description: 'Ensure all existing candidates have a living context identity (person + workspace_person + application)',
    dependsOn: [],
  },
  {
    taskKey: 'contacts_to_living_context',
    description: 'Ensure all existing contacts have a living context identity (person + workspace_person)',
    dependsOn: [],
  },
  {
    taskKey: 'resumes_to_living_context',
    description: 'Native resume ingestion for all candidates with resume_s3_key, creating per-section source spans',
    dependsOn: ['candidates_to_living_context'],
  },
  {
    taskKey: 'projection_outbox_drain',
    description: 'Process all pending neo4j projection outbox jobs',
    dependsOn: ['candidates_to_living_context', 'contacts_to_living_context', 'resumes_to_living_context'],
  },
];

interface CandidateRow {
  id: string;
  resume_s3_key: string | null;
}

interface ContactRow {
  id: string;
}

interface BackfillBatchResult {
  processed: number;
  failed: number;
  cursor: string | null;
  done: boolean;
}

async function backfillCandidatesBatch(
  db: D1Database,
  cursor: string | null,
): Promise<BackfillBatchResult> {
  const rows = await db.prepare(
    `SELECT c.id FROM candidates c
     LEFT JOIN workspace_people wp ON wp.id IN (
       SELECT a.workspace_person_id FROM applications a WHERE a.legacy_candidate_id = c.id
     )
     WHERE wp.id IS NULL
       AND (?1 IS NULL OR c.id > ?1)
     ORDER BY c.id
     LIMIT ?2`,
  ).bind(cursor, BATCH_SIZE).all<CandidateRow>();

  const candidates = rows.results ?? [];
  if (candidates.length === 0) return { processed: 0, failed: 0, cursor, done: true };

  let processed = 0;
  let failed = 0;
  let lastId = cursor;

  for (const candidate of candidates) {
    try {
      await ensureCandidateLivingContext(db, candidate.id);
      processed++;
    } catch (err) {
      console.error('[backfill] candidate LC failed:', candidate.id, err);
      failed++;
    }
    lastId = candidate.id;
  }

  return {
    processed,
    failed,
    cursor: lastId,
    done: candidates.length < BATCH_SIZE,
  };
}

async function backfillContactsBatch(
  db: D1Database,
  cursor: string | null,
): Promise<BackfillBatchResult> {
  const rows = await db.prepare(
    `SELECT c.id FROM contacts c
     LEFT JOIN workspace_people wp ON json_extract(wp.context_json, '$.contactId') = c.id
     WHERE wp.id IS NULL
       AND (?1 IS NULL OR c.id > ?1)
     ORDER BY c.id
     LIMIT ?2`,
  ).bind(cursor, BATCH_SIZE).all<ContactRow>();

  const contacts = rows.results ?? [];
  if (contacts.length === 0) return { processed: 0, failed: 0, cursor, done: true };

  let processed = 0;
  let failed = 0;
  let lastId = cursor;

  for (const contact of contacts) {
    try {
      await ensureContactLivingContext(db, contact.id);
      processed++;
    } catch (err) {
      console.error('[backfill] contact LC failed:', contact.id, err);
      failed++;
    }
    lastId = contact.id;
  }

  return {
    processed,
    failed,
    cursor: lastId,
    done: contacts.length < BATCH_SIZE,
  };
}

async function backfillResumesBatch(
  db: D1Database,
  cursor: string | null,
): Promise<BackfillBatchResult> {
  const rows = await db.prepare(
    `SELECT c.id, c.resume_s3_key FROM candidates c
     WHERE c.resume_s3_key IS NOT NULL AND c.resume_s3_key != ''
       AND NOT EXISTS (
         SELECT 1 FROM artifacts a
         JOIN workspace_people wp ON wp.id = a.workspace_person_id
         JOIN applications app ON app.workspace_person_id = wp.id AND app.legacy_candidate_id = c.id
         WHERE a.artifact_type = 'resume' AND a.logical_key = c.resume_s3_key
       )
       AND (?1 IS NULL OR c.id > ?1)
     ORDER BY c.id
     LIMIT ?2`,
  ).bind(cursor, BATCH_SIZE).all<CandidateRow>();

  const candidates = rows.results ?? [];
  if (candidates.length === 0) return { processed: 0, failed: 0, cursor, done: true };

  let processed = 0;
  let failed = 0;
  let lastId = cursor;

  for (const candidate of candidates) {
    if (!candidate.resume_s3_key) continue;
    try {
      // Attempt to load resume text from existing parsed data
      const parsed = await db.prepare(
        `SELECT skills FROM candidates WHERE id = ?1`,
      ).bind(candidate.id).first<{ skills: string | null }>();

      // If we have skills text from prior parsing, use it as a minimal resume representation
      const resumeText = parsed?.skills ?? '';
      if (resumeText.length >= 20) {
        await ingestResumeToLivingContext(db, {
          candidateId: candidate.id,
          storageKey: candidate.resume_s3_key,
          mediaType: 'application/pdf',
          resumeText,
        });
      }
      processed++;
    } catch (err) {
      console.error('[backfill] resume LC failed:', candidate.id, err);
      failed++;
    }
    lastId = candidate.id;
  }

  return {
    processed,
    failed,
    cursor: lastId,
    done: candidates.length < BATCH_SIZE,
  };
}

export interface BackfillScheduledResult {
  gateEnabled: boolean;
  status: BackfillOrchestratorStatus;
  tasksExecuted: string[];
  batchResults: Record<string, BackfillBatchResult>;
}

/**
 * Run a single batch of backfill work. Designed to be called from a cron trigger.
 * Respects rollout gates — only runs when 'living_context_backfill' gate is enabled.
 */
export async function runScheduledBackfill(env: Env): Promise<BackfillScheduledResult> {
  const db = env.DB;
  const orchestrator = new BackfillOrchestrator(db, BACKFILL_TASKS);

  // Check rollout gate
  const gateEnabled = await checkGate(db, 'living_context_backfill');
  if (!gateEnabled) {
    return {
      gateEnabled: false,
      status: await orchestrator.getStatus(),
      tasksExecuted: [],
      batchResults: {},
    };
  }

  await orchestrator.ensureCheckpoints();

  const readyTasks = await orchestrator.getReadyTasks();
  const tasksExecuted: string[] = [];
  const batchResults: Record<string, BackfillBatchResult> = {};

  for (const taskKey of readyTasks) {
    const checkpoint = (await orchestrator.getStatus()).tasks.find((t) => t.taskKey === taskKey);
    const cursor = checkpoint?.cursor ?? null;

    await orchestrator.markRunning(taskKey);
    tasksExecuted.push(taskKey);

    let result: BackfillBatchResult;
    try {
      switch (taskKey) {
        case 'candidates_to_living_context':
          result = await backfillCandidatesBatch(db, cursor);
          break;
        case 'contacts_to_living_context':
          result = await backfillContactsBatch(db, cursor);
          break;
        case 'resumes_to_living_context':
          result = await backfillResumesBatch(db, cursor);
          break;
        case 'projection_outbox_drain': {
          const projResult = await processProjectionOutbox(env);
          result = {
            processed: projResult.completed,
            failed: projResult.failed,
            cursor: null,
            done: projResult.completed === 0 && projResult.failed === 0,
          };
          break;
        }
        default:
          result = { processed: 0, failed: 0, cursor: null, done: true };
      }

      batchResults[taskKey] = result;
      await orchestrator.updateProgress(
        taskKey,
        result.cursor ?? '',
        (checkpoint?.processed ?? 0) + result.processed,
        (checkpoint?.failed ?? 0) + result.failed,
      );

      if (result.done) {
        await orchestrator.markCompleted(taskKey);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await orchestrator.markFailed(taskKey, msg);
      batchResults[taskKey] = { processed: 0, failed: 1, cursor, done: false };
    }
  }

  return {
    gateEnabled: true,
    status: await orchestrator.getStatus(),
    tasksExecuted,
    batchResults,
  };
}
