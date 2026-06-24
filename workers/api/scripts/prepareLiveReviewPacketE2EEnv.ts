#!/usr/bin/env tsx

import { appendFileSync, readFileSync } from 'node:fs';
import type {
  BackfillCliReport,
  BackfillRowOutcome,
} from './backfillReviewChallengePackets';

const DEFAULT_REPO = 'mui/base-ui';
const DEFAULT_PR_NUMBER = 973;
const DEFAULT_ENV_NAME = 'E2E_EXISTING_REVIEW_PACKET_ID';

export interface LiveReviewPacketSelectionOptions {
  repoFullName?: string;
  prNumber?: number;
}

export interface PreparedLiveReviewPacketEnv {
  envName: string;
  packetId: string;
  repoFullName: string;
  prNumber: number;
}

interface CliOptions extends LiveReviewPacketSelectionOptions {
  file?: string;
  envName: string;
  githubEnv?: string;
}

function usage(): string {
  return [
    'Usage: npx tsx scripts/prepareLiveReviewPacketE2EEnv.ts --file PATH [options]',
    '',
    'Options:',
    '  --file PATH        Backfill JSON report from backfillReviewChallengePackets --json',
    `  --repo OWNER/NAME   Expected repo full name (default ${DEFAULT_REPO})`,
    `  --pr N             Expected pull request number (default ${DEFAULT_PR_NUMBER})`,
    `  --env-name NAME    Environment variable to export (default ${DEFAULT_ENV_NAME})`,
    '  --github-env PATH  GitHub env file to append to (default $GITHUB_ENV when present)',
    '  --help, -h         Show this help',
  ].join('\n');
}

function readValue(argv: string[], index: number, flag: string): [string, number] {
  const inline = argv[index]?.match(new RegExp(`^${flag}=(.+)$`))?.[1];
  if (inline !== undefined) return [inline, index];
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return [value, index + 1];
}

function positiveInteger(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    repoFullName: DEFAULT_REPO,
    prNumber: DEFAULT_PR_NUMBER,
    envName: DEFAULT_ENV_NAME,
    githubEnv: process.env['GITHUB_ENV'],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === '--file' || arg.startsWith('--file=')) {
      const [value, consumedIndex] = readValue(argv, index, '--file');
      options.file = value;
      index = consumedIndex;
    } else if (arg === '--repo' || arg.startsWith('--repo=')) {
      const [value, consumedIndex] = readValue(argv, index, '--repo');
      options.repoFullName = value.trim();
      index = consumedIndex;
    } else if (arg === '--pr' || arg.startsWith('--pr=')) {
      const [value, consumedIndex] = readValue(argv, index, '--pr');
      options.prNumber = positiveInteger(value, '--pr');
      index = consumedIndex;
    } else if (arg === '--env-name' || arg.startsWith('--env-name=')) {
      const [value, consumedIndex] = readValue(argv, index, '--env-name');
      options.envName = value.trim();
      index = consumedIndex;
    } else if (arg === '--github-env' || arg.startsWith('--github-env=')) {
      const [value, consumedIndex] = readValue(argv, index, '--github-env');
      options.githubEnv = value;
      index = consumedIndex;
    } else if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!options.file) throw new Error('--file is required');
  if (!options.repoFullName || !/^[^/\s]+\/[^/\s]+$/.test(options.repoFullName)) {
    throw new Error('--repo must use OWNER/NAME format');
  }
  if (!/^[A-Z_][A-Z0-9_]*$/.test(options.envName)) {
    throw new Error('--env-name must be an uppercase environment variable name');
  }

  return options;
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function isPersistedContextReadyOutcome(
  outcome: BackfillRowOutcome,
  options: Required<LiveReviewPacketSelectionOptions>,
): boolean {
  return outcome.status === 'persisted'
    && outcome.repoFullName === options.repoFullName
    && outcome.prNumber === options.prNumber
    && typeof outcome.packetId === 'string'
    && outcome.packetId.length > 0
    && outcome.productionReady === true
    && outcome.persistedContextReady === true
    && outcome.contextRecordId !== null
    && numberValue(outcome.repoSourceRefCount) > 0
    && numberValue(outcome.conceptLinkCount) > 0;
}

export function selectLiveReviewPacketId(
  report: BackfillCliReport,
  options: LiveReviewPacketSelectionOptions = {},
): string {
  const requiredOptions = {
    repoFullName: options.repoFullName ?? DEFAULT_REPO,
    prNumber: options.prNumber ?? DEFAULT_PR_NUMBER,
  };
  if (report.status !== 'completed') {
    throw new Error(`backfill report status must be completed, received ${report.status}`);
  }
  if (report.mode !== 'write') {
    throw new Error(`backfill report mode must be write, received ${report.mode}`);
  }
  if (report.stats.errors > 0) {
    throw new Error(`backfill report contains ${report.stats.errors} error(s)`);
  }

  const outcome = report.outcomes.find((entry) =>
    isPersistedContextReadyOutcome(entry, requiredOptions),
  );
  if (!outcome?.packetId) {
    throw new Error(
      `No persisted context-ready ${requiredOptions.repoFullName}#${requiredOptions.prNumber} packet found in backfill report`,
    );
  }
  return outcome.packetId;
}

export function prepareLiveReviewPacketE2EEnv(input: {
  report: BackfillCliReport;
  envName?: string;
  repoFullName?: string;
  prNumber?: number;
  githubEnv?: string;
}): PreparedLiveReviewPacketEnv {
  const envName = input.envName ?? DEFAULT_ENV_NAME;
  const repoFullName = input.repoFullName ?? DEFAULT_REPO;
  const prNumber = input.prNumber ?? DEFAULT_PR_NUMBER;
  const packetId = selectLiveReviewPacketId(input.report, { repoFullName, prNumber });
  if (input.githubEnv) {
    appendFileSync(input.githubEnv, `${envName}=${packetId}\n`);
  }
  return { envName, packetId, repoFullName, prNumber };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const report = JSON.parse(readFileSync(options.file!, 'utf8')) as BackfillCliReport;
  const prepared = prepareLiveReviewPacketE2EEnv({
    report,
    envName: options.envName,
    repoFullName: options.repoFullName,
    prNumber: options.prNumber,
    githubEnv: options.githubEnv,
  });
  console.log(`Prepared ${prepared.envName}=${prepared.packetId}`);
}

if (process.argv[1]?.endsWith('prepareLiveReviewPacketE2EEnv.ts')) {
  main().catch((error) => {
    console.error(`[prepareLiveReviewPacketE2EEnv] Fatal: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
