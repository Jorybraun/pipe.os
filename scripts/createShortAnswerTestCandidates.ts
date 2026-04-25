/**
 * scripts/createShortAnswerTestCandidates.ts
 *
 * Creates all test fixtures needed for e2e/short-answer-media-config.spec.ts:
 *
 *   playwright/short-answer-challenge.json   — recruiter editor INPUT_MODE tests
 *   playwright/voice-candidate-token.json    — voice-mode candidate assessment token
 *   playwright/video-candidate-token.json    — video-mode candidate assessment token
 *   playwright/voice-candidate-profile.json  — candidateId with seeded voice submission
 *   playwright/video-candidate-profile.json  — candidateId with seeded video submission
 *
 * Usage:
 *   E2E_EMAIL=you@example.com E2E_PASSWORD=secret npx tsx scripts/createShortAnswerTestCandidates.ts
 */

import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import { signIn, signOut } from 'aws-amplify/auth';
import type { Schema } from '../amplify/data/resource';
import { v4 as uuidv4 } from 'uuid';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const outputs = JSON.parse(readFileSync(join(process.cwd(), 'amplify_outputs.json'), 'utf8')) as unknown;
Amplify.configure(outputs as Parameters<typeof Amplify.configure>[0]);

const client = generateClient<Schema>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function writeFixture(filename: string, data: unknown): void {
  const path = join(process.cwd(), `playwright/${filename}`);
  writeFileSync(path, JSON.stringify(data, null, 2));
  console.log(`[createShortAnswerTestCandidates] ✓ Wrote ${filename}`);
}

async function createPipelineStageChallenge(opts: {
  pipelineTitle: string;
  challengeTitle: string;
  inputMode: 'text' | 'voice' | 'video';
  question: string;
}): Promise<{ pipelineId: string; stageId: string; challengeId: string }> {
  const { data: pipeline, errors: pe } = await client.models.Pipeline.create({
    title: opts.pipelineTitle,
    status: 'ACTIVE',
    creationMode: 'BLANK',
  });
  if (pe) throw new Error(pe[0].message);
  if (!pipeline) throw new Error('Pipeline creation returned null');

  const { data: stage, errors: se } = await client.models.Stage.create({
    pipelineId: pipeline.id,
    title: 'Short Answer Stage',
    order: 0,
  });
  if (se) throw new Error(se[0].message);
  if (!stage) throw new Error('Stage creation returned null');

  const { data: challenge, errors: ce } = await client.models.Challenge.create({
    stageId: stage.id,
    type: 'QUIZ_SHORT_ANSWER',
    title: opts.challengeTitle,
    instructions: opts.question,
    order: 0,
    config: JSON.stringify({ inputMode: opts.inputMode, question: opts.question }),
    serverConfig: JSON.stringify({ rubric: 'Evaluate clarity and depth of response.' }),
  });
  if (ce) throw new Error(ce[0].message);
  if (!challenge) throw new Error('Challenge creation returned null');

  console.log(`[createShortAnswerTestCandidates] Pipeline ${pipeline.id} / Stage ${stage.id} / Challenge ${challenge.id} (${opts.inputMode})`);
  return { pipelineId: pipeline.id, stageId: stage.id, challengeId: challenge.id };
}

async function createCandidate(pipelineId: string, label: string): Promise<{ token: string; candidateId: string }> {
  const token = `e2e-sa-${label}-${uuidv4().slice(0, 8)}`;
  const { data: candidate, errors } = await client.models.Candidate.create({
    pipelineId,
    name: `E2E Short Answer ${label} Candidate`,
    email: `e2e-sa-${label}-${Date.now()}@example.com`,
    inviteToken: token,
    status: 'INVITED',
  });
  if (errors) throw new Error(errors[0].message);
  if (!candidate) throw new Error('Candidate creation returned null');
  console.log(`[createShortAnswerTestCandidates] Candidate (${label}): ${candidate.id}`);
  return { token: candidate.inviteToken ?? token, candidateId: candidate.id };
}

async function createAssessmentWithSubmission(opts: {
  candidateId: string;
  challengeId: string;
  submission: Record<string, unknown>;
  score: number;
}): Promise<void> {
  // Create the Assessment record directly with a pre-seeded submission
  // so the recruiter profile page has data to render without the candidate
  // having to go through the actual recording flow.
  const { errors } = await client.models.Assessment.create({
    candidateId: opts.candidateId,
    challengeId: opts.challengeId,
    submission: JSON.stringify(opts.submission),
    score: opts.score,
    completedAt: new Date().toISOString(),
  });
  if (errors) throw new Error(errors[0].message);
  console.log(`[createShortAnswerTestCandidates] Assessment created for candidate ${opts.candidateId}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const username = process.env['E2E_EMAIL'];
  const password = process.env['E2E_PASSWORD'];

  if (!username || !password) {
    console.error('E2E_EMAIL and E2E_PASSWORD env vars are required');
    process.exit(1);
  }

  try {
    await signIn({ username, password });
    console.log('[createShortAnswerTestCandidates] Signed in as', username);

    // ── 1. Text pipeline (recruiter editor tests) ────────────────────────────
    const text = await createPipelineStageChallenge({
      pipelineTitle: 'E2E Short Answer — Text Mode',
      challengeTitle: 'Describe your debugging process',
      inputMode: 'text',
      question: 'How do you approach debugging a production issue? Walk us through your process.',
    });

    // Three candidates per pipeline so parallel Playwright tests don't collide
    const textCandidates = await Promise.all([
      createCandidate(text.pipelineId, 'text-1'),
      createCandidate(text.pipelineId, 'text-2'),
      createCandidate(text.pipelineId, 'text-3'),
    ]);

    writeFixture('short-answer-challenge.json', {
      pipelineId: text.pipelineId,
      stageId: text.stageId,
      shortAnswerChallengeId: text.challengeId,
      token: textCandidates[0]?.token,
      candidateId: textCandidates[0]?.candidateId,
    });

    // ── 2. Voice pipeline ─────────────────────────────────────────────────────
    const voice = await createPipelineStageChallenge({
      pipelineTitle: 'E2E Short Answer — Voice Mode',
      challengeTitle: 'Tell us about a recent technical challenge',
      inputMode: 'voice',
      question: 'Describe a recent technical challenge you faced and how you resolved it.',
    });

    const voiceCandidates = await Promise.all([
      createCandidate(voice.pipelineId, 'voice-1'),
      createCandidate(voice.pipelineId, 'voice-2'),
      createCandidate(voice.pipelineId, 'voice-3'),
    ]);

    // Voice candidate token (for assessment flow tests)
    writeFixture('voice-candidate-token.json', {
      token: voiceCandidates[0]?.token,
      candidateId: voiceCandidates[0]?.candidateId,
      pipelineId: voice.pipelineId,
      challengeId: voice.challengeId,
      tokens: voiceCandidates,
    });

    // Seeded voice submission for profile rendering test
    const voiceProfileCandidate = await createCandidate(voice.pipelineId, 'voice-profile');
    await createAssessmentWithSubmission({
      candidateId: voiceProfileCandidate.candidateId,
      challengeId: voice.challengeId,
      submission: {
        inputMode: 'voice',
        text: 'I recently tackled a complex caching invalidation bug in our distributed system. I started by reproducing the issue locally, then added structured logging to trace the cache miss patterns. After identifying the root cause — a race condition in our TTL refresh logic — I implemented a read-through cache strategy that resolved the issue without a full cache flush.',
      },
      score: 85,
    });

    writeFixture('voice-candidate-profile.json', {
      candidateId: voiceProfileCandidate.candidateId,
    });

    // ── 3. Video pipeline ─────────────────────────────────────────────────────
    const video = await createPipelineStageChallenge({
      pipelineTitle: 'E2E Short Answer — Video Mode',
      challengeTitle: 'Introduce yourself and your background',
      inputMode: 'video',
      question: 'Please record a 2-minute introduction covering your background and what excites you about this role.',
    });

    const videoCandidates = await Promise.all([
      createCandidate(video.pipelineId, 'video-1'),
      createCandidate(video.pipelineId, 'video-2'),
      createCandidate(video.pipelineId, 'video-3'),
    ]);

    // Video candidate token (for assessment flow tests)
    writeFixture('video-candidate-token.json', {
      token: videoCandidates[0]?.token,
      candidateId: videoCandidates[0]?.candidateId,
      pipelineId: video.pipelineId,
      challengeId: video.challengeId,
      tokens: videoCandidates,
    });

    // Seeded video submission for profile rendering test
    const videoProfileCandidate = await createCandidate(video.pipelineId, 'video-profile');
    await createAssessmentWithSubmission({
      candidateId: videoProfileCandidate.candidateId,
      challengeId: video.challengeId,
      submission: {
        inputMode: 'video',
        videoS3Key: 'candidate-submissions/seeded-profile-test/e2e-intro.webm',
        filename: 'response-e2e-intro.webm',
      },
      score: 90,
    });

    writeFixture('video-candidate-profile.json', {
      candidateId: videoProfileCandidate.candidateId,
    });

    // ── Summary ───────────────────────────────────────────────────────────────
    console.log('\n[createShortAnswerTestCandidates] ✓ All fixtures created');
    console.log('  short-answer-challenge.json — recruiter editor tests');
    console.log('  voice-candidate-token.json  — candidate voice assessment tests');
    console.log('  video-candidate-token.json  — candidate video assessment tests');
    console.log('  voice-candidate-profile.json — recruiter profile voice renderer test');
    console.log('  video-candidate-profile.json — recruiter profile video renderer test');
    console.log('\nRun tests with:');
    console.log('  npx playwright test e2e/short-answer-media-config.spec.ts --project=short-answer-media');

  } finally {
    await signOut();
  }
}

main().catch((err: unknown) => {
  console.error('[createShortAnswerTestCandidates] Fatal error:', err);
  process.exit(1);
});
