/**
 * Feedback Analyzer — Automated adaptive patch generation from recruiter feedback.
 *
 * When a recruiter flags a question, this module:
 * 1. Categorizes the feedback (role_confusion, too_vague, etc.)
 * 2. Checks if a similar patch already exists
 * 3. If not, uses an LLM to generate a patch (negative + corrected example)
 * 4. Generates an embedding for the bad question
 * 5. Persists patch + corpus entry to D1
 *
 * This is the "adaptive" part of the feedback loop — no human required.
 */

import type { LLMProvider, LLMMessage } from '../../llm/types';
import { cosineSimilarity } from '../../embedding/cosine';
import { categorizeExchange } from './feedbackReport';
import type { PromptPatch } from './types';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FeedbackAnalysisInput {
  db: D1Database;
  ai: Ai;
  provider: LLMProvider | null;
  questionText: string;
  acknowledgment: string;
  feedback: string;
  participantRole: string | null;
  questionId: string;
  roleContextId: string;
}

export interface FeedbackAnalysisResult {
  action: 'new_patch' | 'existing_patch' | 'insufficient_signal';
  patchId?: string;
  ruleId?: string;
}

// ─── Embedding ───────────────────────────────────────────────────────────────

const BGE_MODEL = '@cf/baai/bge-large-en-v1.5';
const EXPECTED_DIM = 1024;

async function embedText(ai: Ai, text: string): Promise<number[]> {
  const result = (await ai.run(BGE_MODEL, { text: [text] })) as { data?: number[][] };
  const vector = result.data?.[0];
  if (!vector || vector.length !== EXPECTED_DIM) {
    throw new Error(`[feedbackAnalyzer] embedding failed: expected ${EXPECTED_DIM}, got ${vector?.length}`);
  }
  return vector;
}

function serializeEmbedding(v: number[]): string {
  return JSON.stringify(v);
}

function parseEmbedding(raw: string | null): number[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed as number[];
  } catch {
    return null;
  }
}

// ─── Patch similarity check ──────────────────────────────────────────────────

const SIMILARITY_THRESHOLD = 0.82;

async function findSimilarPatch(
  db: D1Database,
  embedding: number[],
  ruleId: string,
): Promise<{ id: string; similarity: number } | null> {
  // Query all patches for this rule_id that have embeddings
  const rows = await db
    .prepare(
      `SELECT id, embedding FROM bad_question_corpus
       WHERE rule_id = ?1 AND embedding IS NOT NULL`,
    )
    .bind(ruleId)
    .all<{ id: string; embedding: string }>();

  let best: { id: string; similarity: number } | null = null;
  for (const row of rows.results ?? []) {
    const otherEmb = parseEmbedding(row.embedding);
    if (!otherEmb) continue;
    const sim = cosineSimilarity(embedding, otherEmb);
    if (sim > SIMILARITY_THRESHOLD && (!best || sim > best.similarity)) {
      best = { id: row.id, similarity: sim };
    }
  }
  return best;
}

// ─── LLM patch generation ────────────────────────────────────────────────────

const PATCH_GENERATION_PROMPT = `You are a prompt-engineering assistant. A recruiter flagged an interview question as bad. Generate a "patch" that teaches an LLM the underlying principle to avoid.

The "reason" must state the PRINCIPLE — the general rule — not just describe this one example. Use "Never..." or "Always..." language.

Respond with valid JSON only:
{
  "correctedExample": "<a better version of the question or acknowledgment>",
  "reason": "<the underlying principle: Never do X because Y.>"
}`;

async function generatePatchViaLLM(
  provider: LLMProvider | null,
  questionText: string,
  acknowledgment: string,
  feedback: string,
  ruleId: string,
): Promise<{ correctedExample: string; reason: string } | null> {
  if (!provider) return null;

  const messages: LLMMessage[] = [
    { role: 'system', content: PATCH_GENERATION_PROMPT },
    {
      role: 'user',
      content: `Rule: ${ruleId}
Question: ${questionText}
Acknowledgment: ${acknowledgment}
Feedback: ${feedback}

Generate the patch JSON.`,
    },
  ];

  try {
    const completion = await provider.complete(messages, { forceJson: true, maxTokens: 512 });
    const raw = completion.content?.trim() ?? '{}';
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;

    const correctedExample = typeof parsed.correctedExample === 'string' ? parsed.correctedExample : '';
    const reason = typeof parsed.reason === 'string' ? parsed.reason : '';

    if (!correctedExample || !reason) return null;
    return { correctedExample, reason };
  } catch (err) {
    console.error('[feedbackAnalyzer] LLM patch generation failed:', err);
    return null;
  }
}

// ─── D1 persistence ──────────────────────────────────────────────────────────

async function insertPatch(
  db: D1Database,
  patch: Omit<PromptPatch, 'id' | 'createdAt'> & { autoGenerated: boolean },
): Promise<string> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO prompt_patches
       (id, rule_id, participant_roles, negative_example, corrected_example, reason, flag_count, auto_generated, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)`,
    )
    .bind(
      id,
      patch.ruleId,
      patch.participantRoles ? JSON.stringify(patch.participantRoles) : null,
      patch.negativeExample,
      patch.correctedExample,
      patch.reason,
      patch.flagCount,
      patch.autoGenerated ? 1 : 0,
      new Date().toISOString(),
    )
    .run();
  return id;
}

async function incrementPatchFlagCount(db: D1Database, patchId: string): Promise<void> {
  await db
    .prepare(
      `UPDATE prompt_patches
       SET flag_count = flag_count + 1, updated_at = ?1
       WHERE id = ?2`,
    )
    .bind(new Date().toISOString(), patchId)
    .run();
}

async function insertCorpusEntry(
  db: D1Database,
  entry: {
    questionText: string;
    feedback: string;
    participantRole: string | null;
    ruleId: string;
    patchId: string;
    embedding: number[];
  },
): Promise<void> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO bad_question_corpus
       (id, question_text, feedback, participant_role, rule_id, patch_id, embedding, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
    )
    .bind(
      id,
      entry.questionText,
      entry.feedback,
      entry.participantRole,
      entry.ruleId,
      entry.patchId,
      serializeEmbedding(entry.embedding),
      new Date().toISOString(),
    )
    .run();
}

// ─── Main entry point ────────────────────────────────────────────────────────

export async function analyzeFeedback(
  input: FeedbackAnalysisInput,
): Promise<FeedbackAnalysisResult> {
  const { db, ai, provider, questionText, acknowledgment, feedback, participantRole } = input;

  // 1. Categorize
  const patterns = categorizeExchange(questionText, feedback);
  const ruleId = patterns.find((p) => p !== 'uncategorized') ?? 'uncategorized';

  // Skip insufficient signal
  if (ruleId === 'uncategorized' && !feedback.includes('[BAD_ROBOT]')) {
    return { action: 'insufficient_signal' };
  }

  // 2. Generate embedding
  const embedding = await embedText(ai, questionText);

  // 3. Check for similar existing patch
  const similar = await findSimilarPatch(db, embedding, ruleId);
  if (similar) {
    // Existing patch — just increment and add to corpus
    await incrementPatchFlagCount(db, similar.id);
    await insertCorpusEntry(db, {
      questionText,
      feedback,
      participantRole,
      ruleId,
      patchId: similar.id,
      embedding,
    });
    return { action: 'existing_patch', patchId: similar.id, ruleId };
  }

  // 4. Generate new patch via LLM
  const generated = await generatePatchViaLLM(provider, questionText, acknowledgment, feedback, ruleId);
  if (!generated) {
    // Fallback: create a simple patch without LLM
    const fallbackPatch = await insertPatch(db, {
      ruleId,
      participantRoles: participantRole ? [participantRole] : undefined,
      negativeExample: questionText,
      correctedExample: 'Ask a more specific, grounded question instead.',
      reason: `Flagged by recruiter: ${feedback.slice(0, 100)}`,
      flagCount: 1,
      autoGenerated: true,
    });
    await insertCorpusEntry(db, {
      questionText,
      feedback,
      participantRole,
      ruleId,
      patchId: fallbackPatch,
      embedding,
    });
    return { action: 'new_patch', patchId: fallbackPatch, ruleId };
  }

  // 5. Insert new patch + corpus
  const patchId = await insertPatch(db, {
    ruleId,
    participantRoles: participantRole ? [participantRole] : undefined,
    negativeExample: questionText,
    correctedExample: generated.correctedExample,
    reason: generated.reason,
    flagCount: 1,
    autoGenerated: true,
  });

  await insertCorpusEntry(db, {
    questionText,
    feedback,
    participantRole,
    ruleId,
    patchId,
    embedding,
  });

  return { action: 'new_patch', patchId, ruleId };
}
