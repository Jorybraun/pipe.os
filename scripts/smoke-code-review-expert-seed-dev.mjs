import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULTS = {
  seedLimit: 6,
  seedSelectionPoolLimit: 500,
  minCandidates: 2,
  minRoles: 1,
  minChallenges: 3,
  minLabels: 3,
  minEligibleLabels: 3,
  minExpectedPackets: 3,
  seedDescription: 'CODE_REVIEW expert seed smoke',
};

function positiveIntegerEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer; got ${JSON.stringify(raw)}`);
  }
  return parsed;
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function resolveDatabaseId() {
  return process.env.CODE_REVIEW_EXPERT_SEED_D1_DATABASE_ID
    || process.env.MATCHING_EVALUATION_D1_DATABASE_ID
    || process.env.CLOUDFLARE_D1_DATABASE_ID
    || '';
}

function arrayLength(value) {
  return Array.isArray(value) ? value.length : 0;
}

function isEmptyArray(value) {
  return Array.isArray(value) && value.length === 0;
}

function numberValue(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function failIfBelow(failures, label, actual, minimum) {
  if (actual === null) {
    failures.push(`${label} must be a number >= ${minimum}; got missing/non-numeric`);
    return;
  }
  if (actual < minimum) failures.push(`${label} must be >= ${minimum}; got ${actual}`);
}

function failIfNotEmpty(failures, label, value) {
  if (!isEmptyArray(value)) {
    failures.push(`${label} must be empty; got ${Array.isArray(value) ? value.join(',') : 'missing/non-array'}`);
  }
}

function isEligibleDraftGrade(grade) {
  return grade === 'highly_relevant' || grade === 'relevant' || grade === 'borderline';
}

export function validateExpertSeedSummary(summary, thresholds = {}) {
  const limits = {
    minCandidates: thresholds.minCandidates ?? DEFAULTS.minCandidates,
    minRoles: thresholds.minRoles ?? DEFAULTS.minRoles,
    minChallenges: thresholds.minChallenges ?? DEFAULTS.minChallenges,
    minLabels: thresholds.minLabels ?? DEFAULTS.minLabels,
    minExpectedPackets: thresholds.minExpectedPackets ?? DEFAULTS.minExpectedPackets,
  };
  const failures = [];
  const seeded = summary?.seeded;
  const readiness = summary?.readinessSummary;

  if (!summary || typeof summary !== 'object') {
    return { ok: false, failures: ['summary must be an object'] };
  }
  if (!seeded || typeof seeded !== 'object') failures.push('summary.seeded is required');
  if (!readiness || typeof readiness !== 'object') failures.push('summary.readinessSummary is required');

  if (summary.nextAction !== 'complete_expert_review') {
    failures.push(`nextAction must be complete_expert_review; got ${String(summary.nextAction)}`);
  }
  if (summary.draftPersisted !== true) {
    failures.push(`draftPersisted must be true so expert review has an immutable source corpus; got ${String(summary.draftPersisted)}`);
  }
  if (typeof summary.draftCorpusHash !== 'string' || summary.draftCorpusHash.length === 0) {
    failures.push('draftCorpusHash is required');
  }
  if (readiness?.nextAction !== 'complete_expert_review') {
    failures.push(`readinessSummary.nextAction must be complete_expert_review; got ${String(readiness?.nextAction)}`);
  }

  failIfBelow(failures, 'matchRunCount', numberValue(seeded?.matchRunCount), 1);
  failIfBelow(failures, 'candidateCount', numberValue(seeded?.candidateCount), limits.minCandidates);
  failIfBelow(failures, 'roleCount', numberValue(seeded?.roleCount), limits.minRoles);
  failIfBelow(failures, 'challengeCount', numberValue(seeded?.challengeCount), limits.minChallenges);
  failIfBelow(failures, 'labelCount', numberValue(seeded?.labelCount), limits.minLabels);
  failIfBelow(failures, 'draftLabelCount', numberValue(seeded?.draftLabelCount), limits.minLabels);
  failIfBelow(failures, 'expectedPacketCount', numberValue(seeded?.expectedPacketCount), limits.minExpectedPackets);
  failIfBelow(failures, 'labelsNeedingHumanReview', arrayLength(readiness?.labelsNeedingHumanReview), limits.minLabels);

  if (numberValue(seeded?.expertLabelCount) !== 0) {
    failures.push(`expertLabelCount must be 0 for an expert-seed smoke; got ${String(seeded?.expertLabelCount)}`);
  }
  if (numberValue(seeded?.syntheticFixtureCount) !== 0) {
    failures.push(`syntheticFixtureCount must be 0; got ${String(seeded?.syntheticFixtureCount)}`);
  }

  failIfNotEmpty(failures, 'warnings', seeded?.warnings);
  failIfNotEmpty(failures, 'labelsMissingCandidateEvidence', readiness?.labelsMissingCandidateEvidence);
  failIfNotEmpty(failures, 'labelsMissingRoleRequirements', readiness?.labelsMissingRoleRequirements);
  failIfNotEmpty(failures, 'labelsMissingExpectedPacket', readiness?.labelsMissingExpectedPacket);
  failIfNotEmpty(failures, 'labelsMissingRepoDemandEvidence', readiness?.labelsMissingRepoDemandEvidence);

  if (typeof summary.reviewPacketPath !== 'string' || summary.reviewPacketPath.length === 0) {
    failures.push('reviewPacketPath is required');
  }
  if (typeof summary.reviewTemplatePath !== 'string' || summary.reviewTemplatePath.length === 0) {
    failures.push('reviewTemplatePath is required');
  }
  if (typeof summary.reviewMarkdownPath !== 'string' || summary.reviewMarkdownPath.length === 0) {
    failures.push('reviewMarkdownPath is required');
  }

  return {
    ok: failures.length === 0,
    failures,
  };
}

export function validateExpertReviewMarkdown(markdown, thresholds = {}) {
  const limits = {
    minLabels: thresholds.minLabels ?? DEFAULTS.minLabels,
  };
  const failures = [];
  if (typeof markdown !== 'string' || markdown.trim().length === 0) {
    return {
      ok: false,
      failures: ['review markdown must be non-empty text'],
      metrics: { editableLabelCount: 0 },
    };
  }

  const requiredFragments = [
    '# CODE_REVIEW Expert Corpus Review',
    '## Reviewer Instructions',
    '### Candidate Evidence',
    '### Role Requirements',
    '### Repo / PR Challenge',
    '### Suggested Contrast Candidates',
    'Edit `labels[',
  ];
  for (const fragment of requiredFragments) {
    if (!markdown.includes(fragment)) failures.push(`review markdown must include ${JSON.stringify(fragment)}`);
  }

  const editableLabelCount = Array.from(markdown.matchAll(/Edit `labels\[\d+\]\.explanation`/g)).length;
  failIfBelow(failures, 'editableLabelCount', editableLabelCount, limits.minLabels);

  return {
    ok: failures.length === 0,
    failures,
    metrics: { editableLabelCount },
  };
}

export function validateExpertSeedPacket(packet, thresholds = {}) {
  const limits = {
    minEligibleLabels: thresholds.minEligibleLabels ?? DEFAULTS.minEligibleLabels,
  };
  const failures = [];
  const items = Array.isArray(packet?.items) ? packet.items : [];
  if (!packet || typeof packet !== 'object') {
    return {
      ok: false,
      failures: ['review packet must be an object'],
      metrics: { itemCount: 0, eligibleDraftLabelCount: 0, eligibleLabelsWithContrastSuggestions: 0 },
    };
  }
  if (items.length === 0) failures.push('review packet must contain at least one item');

  let eligibleDraftLabelCount = 0;
  let eligibleLabelsWithContrastSuggestions = 0;
  const labelsMissingExpectedPacket = [];
  const eligibleLabelsMissingContrastSuggestions = [];

  for (const item of items) {
    const labelId = typeof item?.labelId === 'string' ? item.labelId : '<missing-label-id>';
    const eligibleDraft = isEligibleDraftGrade(item?.draft?.relevanceGrade)
      && Array.isArray(item?.draft?.eligibleChallengeIds)
      && item.draft.eligibleChallengeIds.length > 0;
    if (!item?.expectedPacket) labelsMissingExpectedPacket.push(labelId);
    if (!eligibleDraft) continue;

    eligibleDraftLabelCount += 1;
    if (Array.isArray(item?.suggestedContrastCandidates) && item.suggestedContrastCandidates.length > 0) {
      eligibleLabelsWithContrastSuggestions += 1;
    } else {
      eligibleLabelsMissingContrastSuggestions.push(labelId);
    }
  }

  failIfBelow(failures, 'eligibleDraftLabelCount', eligibleDraftLabelCount, limits.minEligibleLabels);
  if (labelsMissingExpectedPacket.length > 0) {
    failures.push(`packet items must include expectedPacket; missing ${labelsMissingExpectedPacket.join(',')}`);
  }
  if (eligibleLabelsMissingContrastSuggestions.length > 0) {
    failures.push(
      `eligible draft labels must include suggested contrast candidates; missing ${eligibleLabelsMissingContrastSuggestions.join(',')}`,
    );
  }

  return {
    ok: failures.length === 0,
    failures,
    metrics: {
      itemCount: items.length,
      eligibleDraftLabelCount,
      eligibleLabelsWithContrastSuggestions,
    },
  };
}

export function buildReviewCliArgs(options) {
  return [
    'run',
    'matching-eval:review',
    '--',
    '--remote',
    '--database-id',
    options.databaseId,
    '--seed-from-match-runs',
    '--require-role-context',
    '--seed-limit',
    String(options.seedLimit),
    '--seed-selection-pool-limit',
    String(options.seedSelectionPoolLimit),
    '--seed-description',
    options.seedDescription,
    '--persist-draft',
    '--review-packet',
    options.reviewPacketPath,
    '--review-template',
    options.reviewTemplatePath,
    '--review-markdown',
    options.reviewMarkdownPath,
    '--json',
    options.summaryPath,
  ];
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function assertReadableArtifact(path, label) {
  if (!existsSync(path)) throw new Error(`${label} was not written: ${path}`);
  const stat = statSync(path);
  if (!stat.isFile() || stat.size <= 2) throw new Error(`${label} is empty or not a file: ${path}`);
}

function main() {
  requiredEnv('CLOUDFLARE_ACCOUNT_ID');
  requiredEnv('CLOUDFLARE_API_TOKEN');
  const databaseId = resolveDatabaseId();
  if (!databaseId) {
    throw new Error(
      'Missing D1 database id; set CODE_REVIEW_EXPERT_SEED_D1_DATABASE_ID, '
      + 'MATCHING_EVALUATION_D1_DATABASE_ID, or CLOUDFLARE_D1_DATABASE_ID.',
    );
  }

  const outputDir = resolve(
    process.env.CODE_REVIEW_EXPERT_SEED_OUTPUT_DIR
      || join(tmpdir(), `code-review-expert-seed-${Date.now()}`),
  );
  mkdirSync(outputDir, { recursive: true });

  const options = {
    databaseId,
    seedLimit: positiveIntegerEnv('CODE_REVIEW_EXPERT_SEED_LIMIT', DEFAULTS.seedLimit),
    seedSelectionPoolLimit: positiveIntegerEnv(
      'CODE_REVIEW_EXPERT_SEED_SELECTION_POOL_LIMIT',
      DEFAULTS.seedSelectionPoolLimit,
    ),
    seedDescription: process.env.CODE_REVIEW_EXPERT_SEED_DESCRIPTION || DEFAULTS.seedDescription,
    reviewPacketPath: join(outputDir, 'review-packet.json'),
    reviewTemplatePath: join(outputDir, 'review-template.json'),
    reviewMarkdownPath: join(outputDir, 'review.md'),
    summaryPath: join(outputDir, 'summary.json'),
  };

  const thresholds = {
    minCandidates: positiveIntegerEnv('CODE_REVIEW_EXPERT_SEED_MIN_CANDIDATES', DEFAULTS.minCandidates),
    minRoles: positiveIntegerEnv('CODE_REVIEW_EXPERT_SEED_MIN_ROLES', DEFAULTS.minRoles),
    minChallenges: positiveIntegerEnv('CODE_REVIEW_EXPERT_SEED_MIN_CHALLENGES', DEFAULTS.minChallenges),
    minLabels: positiveIntegerEnv('CODE_REVIEW_EXPERT_SEED_MIN_LABELS', DEFAULTS.minLabels),
    minEligibleLabels: positiveIntegerEnv(
      'CODE_REVIEW_EXPERT_SEED_MIN_ELIGIBLE_LABELS',
      DEFAULTS.minEligibleLabels,
    ),
    minExpectedPackets: positiveIntegerEnv('CODE_REVIEW_EXPERT_SEED_MIN_PACKETS', DEFAULTS.minExpectedPackets),
  };

  const result = spawnSync('npm', ['--prefix', 'workers/api', ...buildReviewCliArgs(options)], {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 20,
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`matching-eval:review exited ${result.status}`);
  }

  assertReadableArtifact(options.summaryPath, 'review summary');
  assertReadableArtifact(options.reviewPacketPath, 'review packet');
  assertReadableArtifact(options.reviewTemplatePath, 'review template');
  assertReadableArtifact(options.reviewMarkdownPath, 'review markdown');

  const summary = readJson(options.summaryPath);
  const packet = readJson(options.reviewPacketPath);
  const markdown = readFileSync(options.reviewMarkdownPath, 'utf8');
  const summaryValidation = validateExpertSeedSummary(summary, thresholds);
  const packetValidation = validateExpertSeedPacket(packet, thresholds);
  const markdownValidation = validateExpertReviewMarkdown(markdown, thresholds);
  const failures = [
    ...summaryValidation.failures,
    ...packetValidation.failures,
    ...markdownValidation.failures,
  ];
  const proof = {
    ok: failures.length === 0,
    sourceCorpusId: summary.sourceCorpusId ?? null,
    outputDir,
    summaryPath: options.summaryPath,
    reviewPacketPath: summary.reviewPacketPath ?? options.reviewPacketPath,
    reviewTemplatePath: summary.reviewTemplatePath ?? options.reviewTemplatePath,
    reviewMarkdownPath: summary.reviewMarkdownPath ?? options.reviewMarkdownPath,
    draftPersisted: summary.draftPersisted === true,
    draftCorpusHash: summary.draftCorpusHash ?? null,
    thresholds,
    seeded: summary.seeded ?? null,
    nextAction: summary.nextAction ?? null,
    readinessSummary: summary.readinessSummary ?? null,
    packetMetrics: packetValidation.metrics,
    markdownMetrics: markdownValidation.metrics,
    failures,
  };

  process.stdout.write(`\n===== CODE_REVIEW expert seed smoke summary =====\n${JSON.stringify(proof, null, 2)}\n`);
  if (failures.length > 0) process.exitCode = 1;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
