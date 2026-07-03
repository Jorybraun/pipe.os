import { spawnSync } from 'node:child_process';

const PROFILE_MATRIX = [
  // Standalone /assess must not run candidate-to-repo matching. These CV-only
  // profiles should complete intake and hand off until a source-backed PR is
  // assigned by the upstream ingestion/challenge-design path.
  {
    id: 'react-interaction-platform',
    label: 'React interaction platform engineer',
    expectedOutcome: 'blocked',
    env: {
      CODE_REVIEW_SMOKE_GITHUB_HANDLE: 'code-review-smoke-react-platform',
      CODE_REVIEW_SMOKE_RESUME_TEXT: [
        'Senior frontend platform engineer with deep React and TypeScript component-library experience.',
        'Recently implemented popover trigger click handling in usePopoverRoot for a large design-system codebase.',
        'Designed patient click thresholds so impatient trigger clicks do not immediately close hover-open popovers.',
        'Reviewed popup trigger id ownership bugs where rendered DOM ids diverged from internal registries and active-trigger state.',
        'Comfortable assessing accessibility state, user interaction timing, JavaScript test runner regression tests, and maintainability trade-offs.',
        'I routinely explain request-changes decisions to implementation authors and defend risk-based review feedback.',
      ].join(' '),
    },
  },
  {
    id: 'accessibility-state-systems',
    label: 'Accessible component state engineer',
    expectedOutcome: 'blocked',
    env: {
      CODE_REVIEW_SMOKE_GITHUB_HANDLE: 'code-review-smoke-a11y-state',
      CODE_REVIEW_SMOKE_RESUME_TEXT: [
        'Staff design-systems engineer focused on accessible React primitives and TypeScript APIs.',
        'Owned usePopoverRoot hover and click interactions where closeDelayWithDefault timers kept hover-open popovers stable after impatient trigger clicks.',
        'Reviewed code paths that combine useClick(context, { enabled: clickEnabled, stickIfOpen: false }) with rendered trigger id ownership, DOM id consistency, active trigger registries, and ARIA state.',
        'Added regression coverage with user-event style JavaScript tests for race-prone hover, click, and close-delay timing behavior.',
        'Strongest reviews catch subtle accessibility and interaction regressions before they ship to product teams, especially when a threshold needs explicit defense.',
      ].join(' '),
    },
  },
  {
    id: 'frontend-quality-infra',
    label: 'Frontend quality infrastructure engineer',
    expectedOutcome: 'blocked',
    env: {
      CODE_REVIEW_SMOKE_GITHUB_HANDLE: 'code-review-smoke-quality-infra',
      CODE_REVIEW_SMOKE_RESUME_TEXT: [
        'Senior frontend quality infrastructure engineer for React and TypeScript monorepos.',
        'Maintained component-library test harnesses around usePopoverRoot trigger behavior, closeDelayWithDefault timers, cleanup, and user interaction sequencing.',
        'Debugged flaky impatient trigger clicks where a hover-open popover should not immediately close after a quick trigger click.',
        'Wrote regression tests with await user.hover(trigger), trigger click events, and timer cleanup assertions for popover interaction thresholds.',
        'Reviews focus on whether pull requests include precise regression tests, safe lifecycle cleanup, and clear explanations for the 500ms interaction timing trade-off.',
        'Comfortable pushing back on implementation authors when a diff is plausible but under-tested.',
      ].join(' '),
    },
  },
  {
    id: 'workers-sdk-runtime',
    label: 'Workers SDK runtime engineer',
    expectedOutcome: 'matched',
    defaultIncluded: false,
    submitReview: false,
    expectedRepoUrl: 'https://github.com/cloudflare/workers-sdk',
    expectedPrNumbers: [14118, 14150],
    env: {
      CODE_REVIEW_SMOKE_GITHUB_HANDLE: 'code-review-smoke-workers-specific',
      CODE_REVIEW_SMOKE_ROLE_TITLE: 'Senior Workers SDK Runtime Engineer',
      CODE_REVIEW_SMOKE_ROLE_TERMS: [
        'Cloudflare Workers SDK',
        'wrangler',
        'workflows',
        'Durable Object SQL storage',
        'typed array',
        'ArrayBuffer',
        'Uint8Array',
        'step output',
        'local dev',
        'regression tests',
      ].join(','),
      CODE_REVIEW_SMOKE_ROLE_JD: [
        '## Role Title',
        'Senior Workers SDK Runtime Engineer',
        '',
        '## Role Scope',
        'The role reviews Cloudflare Workers SDK and wrangler workflows pull requests that touch local dev behavior, Durable Object SQL storage, typed array serialization, ArrayBuffer views, Uint8Array step output persistence, and regression tests for local dev parity with production.',
      ].join('\n'),
      CODE_REVIEW_SMOKE_RESUME_TEXT: [
        'Staff platform engineer focused on Cloudflare Workers SDK runtimes, wrangler local dev, workflows step execution, Durable Object SQL storage, and TypeScript SDK tooling.',
        'Debugged Uint8Array and ArrayBuffer typed array view serialization bugs where sliced typed arrays dragged oversized backing buffers into persistence layers.',
        'Added regression tests for local dev parity, step output byte limits, storage.put behavior, and production-compatible workflow execution.',
        'Reviews focus on source-backed runtime correctness, typed array normalization, persistence failure modes, and whether regression tests cover tight-buffer and sliced-buffer paths.',
      ].join(' '),
      CODE_REVIEW_SMOKE_REVIEW_SUMMARY: [
        'Request changes: the Workflows persistence behavior is relevant to this candidate profile,',
        'and the PR needs exact regression coverage around typed-array backing buffers before merge.',
      ].join(' '),
    },
  },
];

const PROFILE_FILTER = new Set(
  (process.env.CODE_REVIEW_SMOKE_MATRIX_PROFILES || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean),
);

const REPEAT_COUNT = Math.max(
  1,
  Number.parseInt(process.env.CODE_REVIEW_SMOKE_MATRIX_REPEAT || '1', 10) || 1,
);

const STOP_ON_FAILURE = process.env.CODE_REVIEW_SMOKE_MATRIX_STOP_ON_FAILURE === '1';

function stripAnsi(value) {
  return value.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '');
}

function extractSmokeJson(stdout) {
  const clean = stripAnsi(stdout);
  const marker = '{\n  "ok": true,';
  let cursor = clean.lastIndexOf(marker);
  while (cursor >= 0) {
    const candidate = clean.slice(cursor).trim();
    try {
      return JSON.parse(candidate);
    } catch {
      cursor = clean.lastIndexOf(marker, cursor - 1);
    }
  }
  return null;
}

function profileRuns() {
  const defaultProfiles = PROFILE_MATRIX.filter((profile) => profile.defaultIncluded !== false);
  const selected = PROFILE_FILTER.size > 0
    ? PROFILE_MATRIX.filter((profile) => PROFILE_FILTER.has(profile.id))
    : defaultProfiles;
  if (selected.length === 0) {
    throw new Error(
      `No CODE_REVIEW smoke profiles matched CODE_REVIEW_SMOKE_MATRIX_PROFILES=${JSON.stringify([...PROFILE_FILTER])}`,
    );
  }

  const runs = [];
  for (let index = 0; index < REPEAT_COUNT; index += 1) {
    for (const profile of selected) {
      runs.push({
        ...profile,
        runId: REPEAT_COUNT === 1 ? profile.id : `${profile.id}#${index + 1}`,
      });
    }
  }
  return runs;
}

function smokeEnvFor(profile) {
  const expectedOutcome = profile.expectedOutcome ?? 'matched';
  const submitReview = profile.submitReview ?? expectedOutcome !== 'blocked';
  const env = {
    ...process.env,
    CODE_REVIEW_SMOKE_AUTO_MATCH: '1',
    CODE_REVIEW_SMOKE_SUBMIT: submitReview ? '1' : '0',
    CODE_REVIEW_SMOKE_REPO_URL: '',
    CODE_REVIEW_SMOKE_PR_NUMBER: '',
    CODE_REVIEW_SMOKE_ROLE_BACKED: '',
    CODE_REVIEW_EXPECT_BLOCKED_MATCH: expectedOutcome === 'blocked' ? '1' : '',
    CODE_REVIEW_SMOKE_PROFILE_ID: profile.id,
    ...profile.env,
  };

  if (!env.CODE_REVIEW_SMOKE_REVIEW_SUMMARY) {
    env.CODE_REVIEW_SMOKE_REVIEW_SUMMARY = [
      'Request changes: the interaction behavior is relevant to this candidate profile,',
      'but the PR needs focused regression coverage and clearer defense of timing cleanup risk before merge.',
    ].join(' ');
  }

  return env;
}

function summarizeSmoke(profile, parsed, durationMs) {
  return {
    profileId: profile.id,
    label: profile.label,
    expectedOutcome: profile.expectedOutcome ?? 'matched',
    durationMs,
    ok: parsed?.ok === true,
    interviewId: parsed?.interviewId ?? null,
    matchMode: parsed?.matchMode ?? null,
    repoUrl: parsed?.repoUrl ?? null,
    prNumber: parsed?.prNumber ?? null,
    expectedRepoUrl: profile.expectedRepoUrl ?? null,
    expectedPrNumber: profile.expectedPrNumber ?? null,
    expectedPrNumbers: profile.expectedPrNumbers ?? null,
    matchStatus: parsed?.matchStatus ?? null,
    qualityGate: parsed?.qualityGate ?? null,
    assessmentQuality: parsed?.assessmentQuality ?? null,
    contrastScore: parsed?.contrastSeparation?.score ?? null,
    reviewSessionId: parsed?.submissionSmoke?.reviewSessionId ?? null,
    reviewScore: parsed?.submissionSmoke?.scorePersistence?.reviewScore ?? null,
    reviewBand: parsed?.submissionSmoke?.scorePersistence?.reviewBand ?? null,
    reviewStatus: parsed?.submissionSmoke?.reviewStatusPipeline?.status ?? null,
    reviewStatusPhase: parsed?.submissionSmoke?.reviewStatusPipeline?.phase ?? null,
    reviewPipelineScoringStatus: Array.isArray(parsed?.submissionSmoke?.reviewStatusPipeline?.pipeline)
      ? (parsed.submissionSmoke.reviewStatusPipeline.pipeline.find((step) => step?.id === 'scoring')?.status ?? null)
      : null,
    recruiterBrowserSmokeSkipped: parsed?.recruiterBrowserSmoke?.skipped ?? null,
    recruiterMatchStatus: parsed?.submissionSmoke?.recruiterResults?.codeReviewMatchStatus ?? null,
    evidenceHyperedgeCount: parsed?.submissionSmoke?.recruiterResults?.evidenceHyperedgeCount ?? null,
    candidateHandoffType: parsed?.candidateHandoff?.type ?? null,
    candidateHandoffStageId: parsed?.candidateHandoff?.stageId ?? null,
    candidateHandoffComplete: parsed?.candidateHandoff?.isComplete ?? null,
    candidateHandoffTitle: parsed?.candidateHandoff?.title ?? null,
  };
}

function runProfile(profile) {
  const startedAt = Date.now();
  const result = spawnSync(
    process.execPath,
    ['scripts/smoke-code-review-assess-dev.mjs'],
    {
      cwd: process.cwd(),
      env: smokeEnvFor(profile),
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 20,
    },
  );
  const durationMs = Date.now() - startedAt;
  const stdout = result.stdout || '';
  const stderr = result.stderr || '';
  const parsed = extractSmokeJson(stdout);

  process.stdout.write(`\n===== CODE_REVIEW smoke profile: ${profile.runId} (${profile.label}) =====\n`);
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);

  const summary = summarizeSmoke(profile, parsed, durationMs);
  if (result.error) {
    return {
      ...summary,
      ok: false,
      error: result.error.message,
    };
  }
  if (result.status !== 0) {
    return {
      ...summary,
      ok: false,
      exitCode: result.status,
      error: stripAnsi(stderr || stdout).split('\n').filter(Boolean).slice(-12).join('\n')
        || `smoke exited ${result.status}`,
    };
  }
  if (!parsed) {
    return {
      ...summary,
      ok: false,
      error: 'smoke passed but final JSON proof could not be parsed',
    };
  }
  const expectationFailures = [];
  if (profile.expectedRepoUrl && parsed.repoUrl !== profile.expectedRepoUrl) {
    expectationFailures.push(`expected repo ${profile.expectedRepoUrl}, got ${parsed.repoUrl ?? 'null'}`);
  }
  const expectedPrNumbers = Array.isArray(profile.expectedPrNumbers)
    ? profile.expectedPrNumbers
    : profile.expectedPrNumber
      ? [profile.expectedPrNumber]
      : [];
  if (expectedPrNumbers.length > 0 && !expectedPrNumbers.includes(parsed.prNumber)) {
    expectationFailures.push(`expected PR ${expectedPrNumbers.join(' or ')}, got ${parsed.prNumber ?? 'null'}`);
  }
  if (expectationFailures.length > 0) {
    return {
      ...summary,
      ok: false,
      error: expectationFailures.join('; '),
    };
  }
  return summary;
}

function main() {
  const summaries = [];
  for (const profile of profileRuns()) {
    const summary = runProfile(profile);
    summaries.push(summary);
    if (!summary.ok && STOP_ON_FAILURE) break;
  }

  const failed = summaries.filter((summary) => !summary.ok);
  const proof = {
    ok: failed.length === 0,
    profileCount: summaries.length,
    passed: summaries.length - failed.length,
    failed: failed.length,
    summaries,
  };

  process.stdout.write(`\n===== CODE_REVIEW app-dev profile matrix summary =====\n${JSON.stringify(proof, null, 2)}\n`);
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main();
