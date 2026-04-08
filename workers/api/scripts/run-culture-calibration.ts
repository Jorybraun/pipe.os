/**
 * Culture Scorer Calibration — manual one-shot runner.
 *
 * Run this once after any prompt change to `cultureScorerPrompts.ts`.
 * If overall QWK drops below 0.55, iterate prompts and rerun before shipping.
 *
 * ### Prerequisites
 *
 * Install tsx if not already present:
 *   npm install -D tsx          (or: pnpm add -D tsx)
 *
 * ### Usage
 *
 *   cd workers/api
 *   CF_ACCOUNT_ID=... CF_API_TOKEN=... npx tsx scripts/run-culture-calibration.ts
 *
 * Or place credentials in workers/api/.dev.vars:
 *   CF_ACCOUNT_ID=your-account-id
 *   CF_API_TOKEN=your-api-token
 *
 * ### Output
 *
 * Human-readable report printed to stdout.
 * Full report JSON written to workers/api/calibration-results.json.
 * Exit code 0 on pass (QWK ≥ 0.55), exit code 1 on fail.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ─── Path helpers ─────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const apiRoot = resolve(__dirname, '..');

// ─── Load .dev.vars (optional) ────────────────────────────────────────────────

function loadDevVars(): void {
  const devVarsPath = resolve(apiRoot, '.dev.vars');
  let raw: string;
  try {
    raw = readFileSync(devVarsPath, 'utf-8');
  } catch {
    // No .dev.vars — rely entirely on process.env.
    return;
  }
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadDevVars();

// ─── Validate env vars ────────────────────────────────────────────────────────

const CF_ACCOUNT_ID = process.env['CF_ACCOUNT_ID'];
const CF_API_TOKEN = process.env['CF_API_TOKEN'];

if (!CF_ACCOUNT_ID || !CF_API_TOKEN) {
  console.error(
    '\nMissing required environment variables:\n' +
    '  CF_ACCOUNT_ID — your Cloudflare account ID\n' +
    '  CF_API_TOKEN  — a Cloudflare API token with Workers AI read access\n\n' +
    'Set them in workers/api/.dev.vars or export them before running:\n' +
    '  CF_ACCOUNT_ID=... CF_API_TOKEN=... npx tsx scripts/run-culture-calibration.ts\n',
  );
  process.exit(1);
}

// ─── Cloudflare REST AI adapter ───────────────────────────────────────────────
// Workers AI binding (env.AI.run) is not available in Node. This adapter
// calls the Cloudflare REST API directly, which is functionally equivalent
// for text-generation models.

const GEMMA_MODEL = '@cf/google/gemma-4-26b-a4b-it';
const CF_AI_BASE = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run`;

interface CfAiTextResponse {
  result?: { response?: string };
  success?: boolean;
  errors?: Array<{ message: string }>;
}

interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | null;
}

interface LLMCompletion {
  content: string | null;
}

interface LLMProvider {
  readonly name: string;
  readonly supportsTools: boolean;
  complete(
    messages: LLMMessage[],
    options?: { forceJson?: boolean; maxTokens?: number },
  ): Promise<LLMCompletion>;
}

/**
 * Minimal LLMProvider that forwards messages to the Cloudflare Workers AI
 * REST API. Suitable only for text-generation models that accept a messages
 * array (Gemma 4 supports this via the chat completions format).
 */
const cloudflareRestProvider: LLMProvider = {
  name: 'cloudflare-rest',
  supportsTools: false,

  async complete(messages, options = {}): Promise<LLMCompletion> {
    const body: Record<string, unknown> = {
      messages: messages.map((m) => ({ role: m.role, content: m.content ?? '' })),
    };
    if (options.maxTokens !== undefined) {
      body['max_tokens'] = options.maxTokens;
    }
    if (options.forceJson === true) {
      // Gemma 4 supports response_format for JSON mode.
      body['response_format'] = { type: 'json_object' };
    }

    const url = `${CF_AI_BASE}/${GEMMA_MODEL}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${CF_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '(no body)');
      throw new Error(`Cloudflare AI REST error ${resp.status}: ${text}`);
    }

    const json = (await resp.json()) as CfAiTextResponse;

    if (json.success === false) {
      const errMsg = json.errors?.map((e) => e.message).join('; ') ?? 'unknown error';
      throw new Error(`Cloudflare AI returned failure: ${errMsg}`);
    }

    return { content: json.result?.response ?? null };
  },
};

// ─── Imports from the library (resolved at runtime by tsx) ───────────────────
// tsx resolves TypeScript path aliases at runtime via the tsconfig in the
// nearest ancestor directory. Relative imports work normally.

const { runCalibration } = await import('../src/lib/cultureScorerCalibration.js');
const { CALIBRATION_FIXTURES } = await import('../src/lib/__tests__/cultureScorerCalibration.fixtures.js');

// ─── Default org benchmark ────────────────────────────────────────────────────
// For calibration, use neutral mid-point values (3) on every axis so the
// scorer's profile match logic doesn't bias the output.

const DEFAULT_ORG_BENCHMARK = {
  autonomy: 3,
  riskTolerance: 3,
  workPace: 3,
  collaborationStyle: 3,
  feedbackOrientation: 3,
} as const;

// ─── Run ──────────────────────────────────────────────────────────────────────

const today = new Date().toISOString().slice(0, 10);
console.log(`\nCulture Scorer Calibration — ${today}`);
console.log(`Running ${CALIBRATION_FIXTURES.length} fixtures against Gemma (live API)...\n`);

const report = await runCalibration({
  provider: cloudflareRestProvider as unknown as import('../src/lib/llm/types.js').LLMProvider,
  fixtures: CALIBRATION_FIXTURES,
  orgBenchmark: DEFAULT_ORG_BENCHMARK,
});

// ─── Human-readable output ────────────────────────────────────────────────────

function passLabel(qwk: number): string {
  return qwk >= 0.55 ? '✓' : '✗';
}

function fmt(n: number): string {
  return n.toFixed(2);
}

console.log(`Competency QWK: ${fmt(report.competencyQwk)}  ${passLabel(report.competencyQwk)}`);
console.log(`Profile QWK:    ${fmt(report.profileQwk)}  ${passLabel(report.profileQwk)}`);
console.log(`Overall QWK:    ${fmt(report.overallQwk)}  ${passLabel(report.overallQwk)} (target ≥ 0.55)\n`);

// Per-dimension confusion summary (competency).
const competencyDimensions = [
  'ownership',
  'collaboration',
  'learning-orientation',
  'conflict-handling',
  'self-awareness',
] as const;

console.log('Per-dimension confusion (competency):');
for (const dim of competencyDimensions) {
  const pairs = report.competencyResults
    .filter((r) => r.dimension === dim)
    .map((r) => `${r.expertScore}→${r.agentScore}`)
    .join(', ');
  console.log(`  ${dim.padEnd(22)} expert→agent: [${pairs}]`);
}

const profileDimensions = [
  'autonomy',
  'risk-tolerance',
  'work-pace',
  'collaboration-style',
  'feedback-orientation',
] as const;

console.log('\nPer-dimension confusion (profile):');
for (const dim of profileDimensions) {
  const pairs = report.profileResults
    .filter((r) => r.dimension === dim)
    .map((r) => `${r.expertScore}→${r.agentScore}`)
    .join(', ');
  console.log(`  ${dim.padEnd(22)} expert→agent: [${pairs}]`);
}

console.log('');
if (report.passed) {
  console.log(`PASS — Overall QWK ${fmt(report.overallQwk)} ≥ 0.55. Scorer meets the research-brief target.`);
} else {
  console.log(
    `FAIL — Overall QWK ${fmt(report.overallQwk)} < 0.55.\n` +
    `Iterate prompts in src/lib/cultureScorerPrompts.ts and rerun before shipping.`,
  );
}
console.log('');

// ─── Write JSON report ────────────────────────────────────────────────────────

const outputPath = resolve(apiRoot, 'calibration-results.json');
writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf-8');
console.log(`Full report written to: ${outputPath}\n`);

// ─── Exit code ────────────────────────────────────────────────────────────────

process.exit(report.passed ? 0 : 1);
