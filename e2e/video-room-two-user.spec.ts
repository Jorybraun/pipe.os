import { expect, test, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import { API_BASE, APP_BASE, VIDEO_ROOM_BASE } from './env';

const E2E_DEEPGRAM_RESPONSE_HEADER = 'X-Pipe-E2E-Deepgram-Response';
const E2E_MEETING_ANALYSIS_HEADER = 'X-Pipe-E2E-Meeting-Analysis';
const ORDER_RECOVERY_CONCEPT_KEY = 'term:ecommerce-order-recovery';
const TYPESCRIPT_CONCEPT_KEY = 'term:typescript';
const VITEST_CONCEPT_KEY = 'term:vitest';
const EXISTING_REVIEW_PACKET_ID = process.env.E2E_EXISTING_REVIEW_PACKET_ID?.trim() || null;

test.use({
  launchOptions: {
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
    ],
  },
});

async function getAuthToken(page: Page): Promise<string> {
  const cookies = await page.context().cookies();
  const sessionCookie = cookies.find((cookie) => cookie.name === '__session');
  if (!sessionCookie) {
    throw new Error('[video-room-two-user] No __session cookie. Run auth setup first.');
  }
  return sessionCookie.value;
}

function jsonAuthHeaders(token: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

interface CreateMeetingRoomOptions {
  title?: string;
  scheduledInterviewId?: string;
}

function observeRoomFrames(page: Page): string[] {
  const frames: string[] = [];
  page.on('websocket', (ws) => {
    if (!ws.url().includes('/api/v1/meeting-rooms/')) return;
    frames.push(`open:${ws.url()}`);
    ws.on('framesent', (event) => {
      frames.push(`sent:${event.payload.toString()}`);
    });
    ws.on('framereceived', (event) => {
      frames.push(`received:${event.payload.toString()}`);
    });
  });
  return frames;
}

function sawFrame(frames: string[], type: string): boolean {
  return frames.some((frame) => frame.includes(`"type":"${type}"`));
}

function countFrames(frames: string[], type: string): number {
  return frames.filter((frame) => frame.includes(`"type":"${type}"`)).length;
}

async function createMeetingRoom(
  request: APIRequestContext,
  token: string,
  options: CreateMeetingRoomOptions = {},
): Promise<{ meetingId: string; hostUrl: string; guestUrl: string; recipientEmail: string }> {
  const unique = Date.now();
  const recipientEmail = `video-room-${unique}@pipe-test.dev`;
  const createRes = await request.post(`${API_BASE}/api/v1/meetings`, {
    headers: jsonAuthHeaders(token),
    data: {
      recipientName: 'E2E Video Guest',
      recipientEmail,
      title: options.title ?? `E2E Video Room ${unique}`,
      meetingType: 'INTERVIEW',
      ...(options.scheduledInterviewId ? { scheduledInterviewId: options.scheduledInterviewId } : {}),
    },
  });
  if (!createRes.ok()) {
    throw new Error(`meeting create failed: ${await createRes.text()}`);
  }
  const created = await createRes.json() as { meeting: { id: string } };

  const roomRes = await request.post(`${API_BASE}/api/v1/meetings/${created.meeting.id}/room`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!roomRes.ok()) {
    throw new Error(`room prepare failed: ${await roomRes.text()}`);
  }
  const prepared = await roomRes.json() as {
    room: { hostUrl: string; guestUrl: string };
  };

  expect(prepared.room.hostUrl).toMatch(new RegExp(`^${VIDEO_ROOM_BASE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/room/.+`));
  expect(prepared.room.guestUrl).toMatch(new RegExp(`^${VIDEO_ROOM_BASE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/room/.+`));
  expect(prepared.room.hostUrl).not.toBe(prepared.room.guestUrl);

  return {
    meetingId: created.meeting.id,
    hostUrl: prepared.room.hostUrl,
    guestUrl: prepared.room.guestUrl,
    recipientEmail,
  };
}

async function newRoomContext(context: BrowserContext): Promise<Page> {
  await context.grantPermissions(['camera', 'microphone'], { origin: VIDEO_ROOM_BASE });
  return context.newPage();
}

type MeetingRecordingDetail = {
  status: string;
  transcriptStatus: string;
  transcriptSummary?: string | null;
  recordingR2Key: string | null;
};

async function fetchMeetingRecordingDetail(
  request: APIRequestContext,
  token: string,
  meetingId: string,
): Promise<MeetingRecordingDetail> {
  const res = await request.get(`${API_BASE}/api/v1/meetings/${meetingId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok()) throw new Error(`meeting detail failed: ${await res.text()}`);
  const body = await res.json() as { meeting: MeetingRecordingDetail };
  return body.meeting;
}

async function waitForMeetingDetail(
  request: APIRequestContext,
  token: string,
  meetingId: string,
  predicate: (detail: MeetingRecordingDetail) => boolean,
  timeoutMs = 20_000,
): Promise<MeetingRecordingDetail> {
  const deadline = Date.now() + timeoutMs;
  let last: MeetingRecordingDetail | null = null;
  while (Date.now() < deadline) {
    last = await fetchMeetingRecordingDetail(request, token, meetingId);
    if (predicate(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`meeting detail did not reach expected state: ${JSON.stringify(last)}`);
}

type RolelessCandidate = {
  id: string;
  email: string;
};

async function createRolelessCandidateForRecording(
  request: APIRequestContext,
  token: string,
  email: string,
): Promise<RolelessCandidate> {
  const res = await request.post(`${API_BASE}/api/v1/candidates`, {
    headers: jsonAuthHeaders(token),
    data: {
      name: 'Recorded Room Context Candidate',
      email,
      message: 'Created after the recorded room so the same person graph can converge.',
      skipEmail: true,
    },
  });
  expect([200, 201]).toContain(res.status());
  const body = await res.json() as { candidate: RolelessCandidate };
  return body.candidate;
}

type CandidateLivingContext = {
  artifacts?: Array<{
    artifactType?: string;
    metadata?: Record<string, unknown>;
    sourceSpans?: Array<{ exactText?: string }>;
  }>;
};

type RecordedMatchFixture = {
  fixtureId: string;
  packetId: string;
  repoUrl: string;
  prNumber: number;
  roleSources: Array<{ locator?: string; conceptKeys?: string[] }>;
};

type RecordedMatchScenario = {
  conceptLabel: string;
  conceptKey: string;
  transcriptText: string;
  concepts?: Array<{ canonicalKey: string; namespace: string; label: string }>;
  roleJobDescriptionMd?: string;
  roleSelectedConceptKeys?: string[];
  existingChallengePacketId?: string;
  analysisConcepts?: Array<{
    surface: string;
    relationship: string;
    evidenceLevel: 'implemented' | 'validated';
    predicate: string;
    narrative: string;
    objectType: string;
  }>;
  summary?: string;
  topics?: string[];
  expectedRepoEvidenceText?: string;
  expectedMatchTitle?: string;
  expectedBridgeRepoText?: string;
};

function makeRecordedMatchScenario(): RecordedMatchScenario {
  if (EXISTING_REVIEW_PACKET_ID) {
    const transcriptText = [
      'I implemented React TypeScript popover click handling in usePopoverRoot,',
      'introduced a patient click threshold for impatient trigger clicks,',
      'and validated the popover trigger behavior with a JavaScript test runner.',
    ].join(' ');
    return {
      conceptLabel: 'patient click threshold',
      conceptKey: 'term:patient-click-threshold',
      transcriptText,
      existingChallengePacketId: EXISTING_REVIEW_PACKET_ID,
      concepts: [
        { canonicalKey: 'term:click', namespace: 'term', label: 'click' },
        { canonicalKey: 'term:javascript-test-runner', namespace: 'term', label: 'JavaScript test runner' },
        { canonicalKey: 'term:patient-click-threshold', namespace: 'term', label: 'patient click threshold' },
        { canonicalKey: 'term:popover', namespace: 'term', label: 'popover' },
        { canonicalKey: 'term:popover-trigger', namespace: 'term', label: 'popover trigger' },
        { canonicalKey: 'term:react', namespace: 'term', label: 'React' },
        { canonicalKey: 'term:typescript', namespace: 'term', label: 'TypeScript' },
        { canonicalKey: 'term:use-popover-root', namespace: 'term', label: 'usePopoverRoot' },
      ],
      roleJobDescriptionMd: [
        'Review React TypeScript popover pull requests that add patient click threshold',
        'handling for impatient trigger clicks and verify the behavior with tests.',
      ].join(' '),
      roleSelectedConceptKeys: ['term:popover', 'term:patient-click-threshold'],
      analysisConcepts: [
        {
          surface: 'React',
          relationship: 'implementation framework',
          evidenceLevel: 'implemented',
          predicate: 'implemented work in source-described framework',
          narrative: 'Candidate implemented React popover click handling.',
          objectType: 'source-described framework',
        },
        {
          surface: 'TypeScript',
          relationship: 'implementation language',
          evidenceLevel: 'implemented',
          predicate: 'implemented work in source-described language',
          narrative: 'Candidate implemented TypeScript popover click handling.',
          objectType: 'source-described language',
        },
        {
          surface: 'popover',
          relationship: 'component domain',
          evidenceLevel: 'implemented',
          predicate: 'implemented source-described component behavior',
          narrative: 'Candidate implemented popover click handling.',
          objectType: 'source-described component behavior',
        },
        {
          surface: 'click',
          relationship: 'interaction behavior',
          evidenceLevel: 'implemented',
          predicate: 'implemented source-described interaction behavior',
          narrative: 'Candidate implemented click handling.',
          objectType: 'source-described interaction behavior',
        },
        {
          surface: 'usePopoverRoot',
          relationship: 'source-described function',
          evidenceLevel: 'implemented',
          predicate: 'implemented source-described function behavior',
          narrative: 'Candidate implemented usePopoverRoot behavior.',
          objectType: 'source-described function',
        },
        {
          surface: 'patient click threshold',
          relationship: 'source-described mechanism',
          evidenceLevel: 'implemented',
          predicate: 'introduced source-described mechanism',
          narrative: 'Candidate introduced a patient click threshold for impatient trigger clicks.',
          objectType: 'source-described mechanism',
        },
        {
          surface: 'JavaScript test runner',
          relationship: 'verification mechanism',
          evidenceLevel: 'validated',
          predicate: 'validated behavior with source-described tests',
          narrative: 'Candidate validated popover behavior with a JavaScript test runner.',
          objectType: 'source-described validation',
        },
        {
          surface: 'popover trigger',
          relationship: 'component interaction',
          evidenceLevel: 'validated',
          predicate: 'validated source-described trigger behavior',
          narrative: 'Candidate validated popover trigger behavior.',
          objectType: 'source-described trigger behavior',
        },
      ],
      summary: 'Guest described React TypeScript popover click handling with a patient click threshold and JavaScript test coverage.',
      topics: ['popover', 'patient click threshold', 'JavaScript test runner'],
      expectedRepoEvidenceText: 'PATIENT_CLICK_THRESHOLD',
      expectedMatchTitle: '[popover] Better handle impatient clicks',
      expectedBridgeRepoText: 'PATIENT_CLICK_THRESHOLD',
    };
  }
  const suffix = Date.now().toString(36).toLowerCase();
  const conceptLabel = `lattice replay buffers ${suffix}`;
  return {
    conceptLabel,
    conceptKey: `term:lattice-replay-buffers-${suffix}`,
    transcriptText:
      `I implemented TypeScript ${conceptLabel} for ecommerce order recovery and validated Vitest coverage.`,
    expectedRepoEvidenceText: conceptLabel,
    expectedMatchTitle: `Add ${conceptLabel} for ecommerce order recovery`,
    expectedBridgeRepoText: `Implement ${conceptLabel} for ecommerce order recovery.`,
  };
}

async function fetchCandidateLivingContext(
  request: APIRequestContext,
  token: string,
  candidateId: string,
): Promise<CandidateLivingContext> {
  const res = await request.get(`${API_BASE}/api/v1/candidates/${candidateId}/living-context`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.status()).toBe(200);
  const body = await res.json() as { livingContext: CandidateLivingContext };
  return body.livingContext;
}

function recordingSourceFromContext(
  livingContext: CandidateLivingContext,
  recordingKey: string,
  expectedTranscriptText?: string,
): { transcriptText: string; transcriptionAudioKey: string } {
  const artifact = livingContext.artifacts?.find((entry) =>
    entry.artifactType === 'meeting_transcript'
    && entry.metadata?.recordingKey === recordingKey,
  );
  expect(artifact, `meeting transcript artifact for ${recordingKey}`).toBeTruthy();
  const sourceTexts = artifact?.sourceSpans
    ?.map((span) => span.exactText?.trim())
    .filter((text): text is string => Boolean(text)) ?? [];
  const transcriptText = expectedTranscriptText
    ? sourceTexts.find((text) => text === expectedTranscriptText)
    : sourceTexts[0];
  expect(transcriptText, 'recording transcript source text').toBeTruthy();
  const transcriptionAudioKey = artifact?.metadata?.transcriptionAudioKey;
  expect(typeof transcriptionAudioKey).toBe('string');
  expect(transcriptionAudioKey).toContain('/transcription-audio.webm');
  return { transcriptText: transcriptText!, transcriptionAudioKey: transcriptionAudioKey as string };
}

function e2eDeepgramResponse(scenario: RecordedMatchScenario): unknown {
  return {
    metadata: { channels: 2 },
    results: {
      utterances: [
        {
          id: 'e2e-host-1',
          transcript: 'What system did you improve?',
          start: 1,
          end: 2,
          channel: 0,
          speaker: 0,
          confidence: 0.99,
        },
        {
          id: 'e2e-guest-1',
          transcript: scenario.transcriptText,
          start: 2.1,
          end: 6.5,
          channel: 1,
          speaker: 1,
          confidence: 0.99,
        },
      ],
    },
  };
}

function e2eMeetingAnalysis(scenario: RecordedMatchScenario): unknown {
  if (scenario.analysisConcepts) {
    return {
      summary: scenario.summary ?? `Guest described ${scenario.conceptLabel}.`,
      decisions: [],
      actionItems: [],
      topics: scenario.topics ?? [scenario.conceptLabel],
      followUps: [],
      semanticAssertions: scenario.analysisConcepts.map((concept) => ({
        sourceSegmentIds: ['utterance-0002'],
        subjectSegmentId: 'utterance-0002',
        predicate: concept.predicate,
        narrative: concept.narrative,
        objectType: concept.objectType,
        objectValue: { surface: concept.surface },
        qualifiers: {},
        confidence: 1,
        polarity: 1,
        concepts: [
          {
            surface: concept.surface,
            relationship: concept.relationship,
            weight: 1,
            evidenceLevel: concept.evidenceLevel,
            strength: 1,
          },
        ],
      })),
    };
  }
  return {
    summary: `Guest described TypeScript ${scenario.conceptLabel} for ecommerce order recovery with Vitest coverage.`,
    decisions: [],
    actionItems: [],
    topics: [scenario.conceptLabel, 'ecommerce order recovery', 'Vitest coverage'],
    followUps: [],
    semanticAssertions: [
      {
        sourceSegmentIds: ['utterance-0002'],
        subjectSegmentId: 'utterance-0002',
        predicate: 'implemented a source-described replay mechanism',
        narrative: `Implemented ${scenario.conceptLabel}.`,
        objectType: 'source-described mechanism',
        objectValue: { surface: scenario.conceptLabel },
        qualifiers: {},
        confidence: 1,
        polarity: 1,
        concepts: [
          {
            surface: scenario.conceptLabel,
            relationship: 'mechanism implemented for ecommerce order recovery',
            weight: 1,
            evidenceLevel: 'implemented',
            strength: 1,
          },
        ],
      },
      {
        sourceSegmentIds: ['utterance-0002'],
        subjectSegmentId: 'utterance-0002',
        predicate: 'implemented source-described domain work',
        narrative: 'Implemented ecommerce order recovery work.',
        objectType: 'source-described domain',
        objectValue: { surface: 'ecommerce order recovery' },
        qualifiers: {},
        confidence: 1,
        polarity: 1,
        concepts: [
          {
            surface: 'ecommerce order recovery',
            relationship: 'domain where the mechanism was implemented',
            weight: 1,
            evidenceLevel: 'implemented',
            strength: 1,
          },
        ],
      },
      {
        sourceSegmentIds: ['utterance-0002'],
        subjectSegmentId: 'utterance-0002',
        predicate: 'implemented work in source-described language',
        narrative: `Implemented the ${scenario.conceptLabel} work in TypeScript.`,
        objectType: 'source-described language',
        objectValue: { surface: 'typescript' },
        qualifiers: {},
        confidence: 1,
        polarity: 1,
        concepts: [
          {
            surface: 'typescript',
            relationship: 'implementation language used for the mechanism',
            weight: 1,
            evidenceLevel: 'implemented',
            strength: 1,
          },
        ],
      },
      {
        sourceSegmentIds: ['utterance-0002'],
        subjectSegmentId: 'utterance-0002',
        predicate: 'validated behavior with source-described coverage',
        narrative: `Validated the ${scenario.conceptLabel} work with Vitest coverage.`,
        objectType: 'source-described validation',
        objectValue: { surface: 'Vitest coverage' },
        qualifiers: {},
        confidence: 1,
        polarity: 1,
        concepts: [
          {
            surface: 'Vitest',
            relationship: 'test framework used for validation',
            weight: 1,
            evidenceLevel: 'validated',
            strength: 1,
          },
        ],
      },
    ],
  };
}

async function attachE2ETranscriptionProvider(page: Page, scenario: RecordedMatchScenario): Promise<void> {
  await page.route('**/api/v1/meeting-rooms/**/recording', async (route) => {
    await route.continue({
      headers: {
        ...route.request().headers(),
        [E2E_DEEPGRAM_RESPONSE_HEADER]: JSON.stringify(e2eDeepgramResponse(scenario)),
        [E2E_MEETING_ANALYSIS_HEADER]: JSON.stringify(e2eMeetingAnalysis(scenario)),
      },
    });
  });
}

async function seedRecordedRoleRepoMatchFixture(
  request: APIRequestContext,
  token: string,
  candidateId: string,
  scenario: RecordedMatchScenario,
): Promise<RecordedMatchFixture> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const repoFullName = `pipe/e2e-recorded-room-${suffix}`;
  const repoUrl = `https://github.com/${repoFullName}`;
  const prNumber = 77;
  const data: Record<string, unknown> = {
    fixtureId: `recorded-room-match-${suffix}`,
    candidateId,
    useExistingCandidateEvidence: true,
    concepts: scenario.concepts ?? [
      { canonicalKey: scenario.conceptKey, namespace: 'term', label: scenario.conceptLabel },
      { canonicalKey: ORDER_RECOVERY_CONCEPT_KEY, namespace: 'term', label: 'ecommerce order recovery' },
      { canonicalKey: TYPESCRIPT_CONCEPT_KEY, namespace: 'term', label: 'TypeScript' },
      { canonicalKey: VITEST_CONCEPT_KEY, namespace: 'term', label: 'Vitest' },
    ],
    roleSource: {
      title: scenario.existingChallengePacketId
        ? 'Recorded room live packet role'
        : 'Recorded room source-backed role',
      jobDescriptionMd: scenario.roleJobDescriptionMd
        ?? `Review TypeScript PRs that implement ${scenario.conceptLabel} for ecommerce order recovery with Vitest coverage.`,
      selectedConceptKeys: scenario.roleSelectedConceptKeys ?? [scenario.conceptKey],
    },
    candidateEvidence: [],
  };
  if (scenario.existingChallengePacketId) {
    data.existingChallengePacketId = scenario.existingChallengePacketId;
  } else {
    Object.assign(data, {
      omitSamplePrRow: true,
      repo: {
        githubUrl: repoUrl,
        fullName: repoFullName,
        primaryLanguage: 'TypeScript',
        description: 'E2E recorded room matching repository.',
      },
      pullRequest: {
        number: prNumber,
        title: `Add ${scenario.conceptLabel} for ecommerce order recovery`,
        author: 'pipe-e2e',
        baseSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        headSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        mergedAt: '2026-06-23T08:00:00.000Z',
      },
      repoSpans: [
        {
          key: 'implementation',
          path: 'src/orderRecovery.ts',
          exactText: [
            'export type RecoveryEvent = { orderId: string; attempt: number; shard: string };',
            '',
            `// Implement ${scenario.conceptLabel} for ecommerce order recovery.`,
            'export function buildLatticeReplayBuffer(orderId: string) {',
            `  const mechanism = "${scenario.conceptLabel}";`,
            '  const recoveryDomain = "ecommerce order recovery";',
            '  return { orderId, mechanism, recoveryDomain, replayKey: `${orderId}:${mechanism}` };',
            '}',
            '',
            'export function replayRecoveryEvent(event: RecoveryEvent) {',
            '  const buffer = buildLatticeReplayBuffer(event.orderId);',
            '  return { ...buffer, shard: event.shard, attempt: event.attempt };',
            '}',
          ].join('\n'),
          artifactType: 'source',
          lineStart: 1,
          lineEnd: 12,
        },
        {
          key: 'policy',
          path: 'src/orderRecoveryPolicy.ts',
          exactText: [
            'import { replayRecoveryEvent, type RecoveryEvent } from "./orderRecovery";',
            '',
            'export function shouldReplayOrderRecovery(event: RecoveryEvent) {',
            '  const replay = replayRecoveryEvent(event);',
            '  if (replay.attempt < 1) return false;',
            '  if (replay.recoveryDomain !== "ecommerce order recovery") return false;',
            `  return replay.mechanism === "${scenario.conceptLabel}";`,
            '}',
            '',
            'export function recoveryPolicyLabel() {',
            `  return "${scenario.conceptLabel} protects ecommerce order recovery";`,
            '}',
          ].join('\n'),
          artifactType: 'source',
          lineStart: 1,
          lineEnd: 12,
        },
        {
          key: 'coverage',
          path: 'src/orderRecovery.test.ts',
          exactText: [
            'import { describe, expect, it } from "vitest";',
            'import { buildLatticeReplayBuffer } from "./orderRecovery";',
            '',
            'describe("ecommerce order recovery", () => {',
            `it("validates ${scenario.conceptLabel} for ecommerce order recovery", () => {`,
            '  const replay = buildLatticeReplayBuffer("order-1");',
            `  expect(replay.mechanism).toBe("${scenario.conceptLabel}");`,
            `  expect("Vitest coverage for ${scenario.conceptLabel}").toContain("${scenario.conceptLabel}");`,
            '});',
            '});',
          ].join('\n'),
          artifactType: 'test',
          lineStart: 1,
          lineEnd: 10,
        },
      ],
      demands: [
        {
          id: 'demand-lattice-replay-buffer',
          family: 'source-backed:implementation',
          narrative: `Implement ${scenario.conceptLabel} for ecommerce order recovery.`,
          conceptKeys: [scenario.conceptKey, ORDER_RECOVERY_CONCEPT_KEY, TYPESCRIPT_CONCEPT_KEY],
          sourceSpanKeys: ['implementation'],
          weight: 0.5,
          mechanisms: [scenario.conceptLabel],
          domains: ['ecommerce order recovery'],
          ownershipActions: ['implemented'],
        },
        {
          id: 'demand-recovery-policy',
          family: 'source-backed:recovery-policy',
          narrative: `Review the ecommerce order recovery policy around ${scenario.conceptLabel}.`,
          conceptKeys: [scenario.conceptKey, ORDER_RECOVERY_CONCEPT_KEY],
          sourceSpanKeys: ['policy'],
          weight: 0.25,
          mechanisms: [scenario.conceptLabel],
          domains: ['ecommerce order recovery'],
          ownershipActions: ['implemented'],
        },
        {
          id: 'demand-vitest-coverage',
          family: 'source-backed:verification',
          narrative: `Validate ${scenario.conceptLabel} with Vitest coverage.`,
          conceptKeys: [scenario.conceptKey, VITEST_CONCEPT_KEY],
          sourceSpanKeys: ['coverage'],
          weight: 0.25,
          mechanisms: [scenario.conceptLabel],
          domains: ['ecommerce order recovery'],
          ownershipActions: ['validated'],
        },
      ],
    });
  }
  const res = await request.post(`${API_BASE}/api/v1/internal/e2e/standalone-review-match-fixture`, {
    headers: jsonAuthHeaders(token),
    data,
  });
  expect(res.status()).toBe(200);
  const body = await res.json() as RecordedMatchFixture;
  expect(body.packetId).toBeTruthy();
  expect(body.roleSources[0]?.conceptKeys).toContain(scenario.conceptKey);
  return body;
}

test.describe('two-user video room', () => {
  test('connects a host and guest through the scheduled interview room links', async ({
    browser,
    page,
    request,
  }) => {
    const token = await getAuthToken(page);
    const { hostUrl, guestUrl } = await createMeetingRoom(request, token);

    const hostContext = await browser.newContext({
      permissions: ['camera', 'microphone'],
      viewport: { width: 1280, height: 720 },
    });
    const guestContext = await browser.newContext({
      permissions: ['camera', 'microphone'],
      viewport: { width: 1280, height: 720 },
    });

    try {
      const host = await newRoomContext(hostContext);
      const guest = await newRoomContext(guestContext);
      const hostFrames = observeRoomFrames(host);
      const guestFrames = observeRoomFrames(guest);

      await Promise.all([
        host.goto(hostUrl),
        guest.goto(guestUrl),
      ]);
      await Promise.all([
        expect(host.getByTestId('device-check')).toBeVisible(),
        expect(guest.getByTestId('device-check')).toBeVisible(),
      ]);
      await Promise.all([
        host.getByTestId('join-room').click(),
        guest.getByTestId('join-room').click(),
      ]);

      await expect(host.getByTestId('call-stage')).toHaveAttribute('data-room-phase', 'connected', { timeout: 30_000 });
      await expect(guest.getByTestId('call-stage')).toHaveAttribute('data-room-phase', 'connected', { timeout: 30_000 });
      await expect(host.getByTestId('standard-layout')).toBeVisible();
      await expect(guest.getByTestId('standard-layout')).toBeVisible();
      await expect(host.getByTestId('remote-video')).toBeVisible();
      await expect(guest.getByTestId('remote-video')).toBeVisible();
      await expect(host.getByTestId('local-video')).toBeVisible();
      await expect(guest.getByTestId('local-video')).toBeVisible();

      expect(sawFrame(hostFrames, 'OFFER')).toBeTruthy();
      expect(sawFrame(guestFrames, 'OFFER')).toBeTruthy();
      expect(sawFrame(hostFrames, 'ANSWER')).toBeTruthy();
      expect(sawFrame(guestFrames, 'ANSWER')).toBeTruthy();
      expect(sawFrame(hostFrames, 'ICE_CANDIDATE')).toBeTruthy();
      expect(sawFrame(guestFrames, 'ICE_CANDIDATE')).toBeTruthy();
    } finally {
      await hostContext.close();
      await guestContext.close();
    }
  });

  test('syncs shared desktop windows across host and guest', async ({
    browser,
    page,
    request,
  }) => {
    const token = await getAuthToken(page);
    const { hostUrl, guestUrl } = await createMeetingRoom(request, token, {
      title: 'E2E Shared Desktop Room',
    });

    const hostContext = await browser.newContext({
      permissions: ['camera', 'microphone'],
      viewport: { width: 1280, height: 720 },
    });
    const guestContext = await browser.newContext({
      permissions: ['camera', 'microphone'],
      viewport: { width: 1280, height: 720 },
    });

    try {
      const host = await newRoomContext(hostContext);
      const guest = await newRoomContext(guestContext);

      await Promise.all([
        host.goto(hostUrl),
        guest.goto(guestUrl),
      ]);
      await Promise.all([
        expect(host.getByTestId('device-check')).toBeVisible(),
        expect(guest.getByTestId('device-check')).toBeVisible(),
      ]);
      await Promise.all([
        host.getByTestId('join-room').click(),
        guest.getByTestId('join-room').click(),
      ]);

      await expect(host.getByTestId('call-stage')).toHaveAttribute('data-room-phase', 'connected', { timeout: 30_000 });
      await expect(guest.getByTestId('call-stage')).toHaveAttribute('data-room-phase', 'connected', { timeout: 30_000 });
      await expect(host.getByTestId('standard-layout')).toBeVisible();
      await expect(guest.getByTestId('standard-layout')).toBeVisible();

      await host.getByTestId('enter-win95-desktop').click();
      await expect(host.getByTestId('call-stage')).toHaveAttribute('data-room-layout', 'win95', { timeout: 10_000 });
      await expect(guest.getByTestId('call-stage')).toHaveAttribute('data-room-layout', 'win95', { timeout: 10_000 });
      await expect(host.getByTestId('win95-desktop')).toBeVisible();
      await expect(guest.getByTestId('win95-desktop')).toBeVisible();
      await expect(host.getByTestId('room-window-chat')).toBeVisible();
      await expect(guest.getByTestId('room-window-chat')).toBeVisible();

      await host.getByTestId('chat-input').fill('Host can send messages inside the shared room.');
      await host.getByTestId('chat-send').click();
      await expect(guest.getByTestId('chat-window')).toContainText(
        'Host can send messages inside the shared room.',
        { timeout: 10_000 },
      );

      await guest.getByTestId('chat-input').fill('Guest can reply from the same desktop.');
      await guest.getByTestId('chat-send').click();
      await expect(host.getByTestId('chat-window')).toContainText(
        'Guest can reply from the same desktop.',
        { timeout: 10_000 },
      );

      const hostDesktopBox = await host.getByTestId('win95-desktop').boundingBox();
      expect(hostDesktopBox).toBeTruthy();
      await host.mouse.move(hostDesktopBox!.x + 260, hostDesktopBox!.y + 180);
      await expect(guest.getByTestId('room-peer-cursor-host')).toBeVisible({ timeout: 10_000 });
      await expect(guest.getByTestId('room-peer-cursor-host')).toContainText('Host');

      const guestDesktopBox = await guest.getByTestId('win95-desktop').boundingBox();
      expect(guestDesktopBox).toBeTruthy();
      await guest.mouse.move(guestDesktopBox!.x + 420, guestDesktopBox!.y + 220);
      await expect(host.getByTestId('room-peer-cursor-guest')).toBeVisible({ timeout: 10_000 });
      await expect(host.getByTestId('room-peer-cursor-guest')).toContainText('Guest');

      await host.getByTestId('room-desktop-icon-browser').dblclick();
      await expect(host.getByTestId('room-window-browser')).toBeVisible();
      await expect(guest.getByTestId('room-window-browser')).toBeVisible({ timeout: 10_000 });

      await host.getByTestId('room-browser-address-input').fill('example.com');
      await host.getByTestId('room-browser-go').click();
      await expect(guest.getByTestId('room-browser-address-input')).toHaveValue('https://example.com', { timeout: 10_000 });

      await guest.getByTestId('room-desktop-icon-notepad').dblclick();
      await expect(host.getByTestId('room-window-notepad')).toBeVisible({ timeout: 10_000 });
      await guest.getByTestId('room-notepad-textarea').fill('Candidate notes sync in the shared desktop.');
      await expect(host.getByTestId('room-notepad-textarea')).toHaveValue(
        'Candidate notes sync in the shared desktop.',
        { timeout: 10_000 },
      );

      await guest.getByTestId('room-window-browser').getByLabel('Close').click();
      await expect(host.getByTestId('room-window-browser')).toHaveCount(0, { timeout: 10_000 });
      await expect(guest.getByTestId('room-window-browser')).toHaveCount(0);
    } finally {
      await hostContext.close();
      await guestContext.close();
    }
  });

  test('requires host-manual recording and uploads saved recording media on end call', async ({
    browser,
    page,
    request,
  }) => {
    const token = await getAuthToken(page);
    const scenario = makeRecordedMatchScenario();
    const { meetingId, hostUrl, guestUrl, recipientEmail } = await createMeetingRoom(request, token);

    const hostContext = await browser.newContext({
      permissions: ['camera', 'microphone'],
      viewport: { width: 1280, height: 720 },
    });
    const guestContext = await browser.newContext({
      permissions: ['camera', 'microphone'],
      viewport: { width: 1280, height: 720 },
    });

    try {
      const host = await newRoomContext(hostContext);
      const guest = await newRoomContext(guestContext);

      await host.goto(hostUrl);
      await expect(host.getByTestId('device-check')).toBeVisible();
      await host.getByTestId('join-room').click();
      await expect(host.getByTestId('call-stage')).toBeVisible();
      await expect(host.getByTestId('recording-state')).toContainText('Not recording');
      await expect(host.getByTestId('start-recording')).toBeDisabled();

      await guest.goto(guestUrl);
      await expect(guest.getByTestId('device-check')).toBeVisible();
      await guest.getByTestId('join-room').click();

      await expect(host.getByTestId('call-stage')).toHaveAttribute('data-room-phase', 'connected', { timeout: 30_000 });
      await expect(guest.getByTestId('call-stage')).toHaveAttribute('data-room-phase', 'connected', { timeout: 30_000 });
      await expect(host.getByTestId('remote-video')).toBeVisible();
      await expect(guest.getByTestId('remote-video')).toBeVisible();

      await expect(host.getByTestId('recording-state')).toContainText('Not recording');
      await expect(host.getByTestId('start-recording')).toBeEnabled();
      const beforeRecordingDetail = await waitForMeetingDetail(
        request,
        token,
        meetingId,
        (detail) => detail.status === 'IN_PROGRESS' && detail.transcriptStatus === 'NONE',
      );
      expect(beforeRecordingDetail.recordingR2Key).toBeNull();

      await expect(host.getByTestId('clippy-proactive-card')).toContainText('begin recording', { timeout: 10_000 });
      await expect(host.getByTestId('clippy-action-start-recording')).toBeVisible();
      await host.getByTestId('clippy-action-start-recording').click();
      await expect(host.getByTestId('recording-state')).toContainText('Recording', { timeout: 10_000 });
      await expect(host.getByTestId('win95-tray-recording')).toContainText('Recording', { timeout: 10_000 });
      const recordingDetail = await waitForMeetingDetail(
        request,
        token,
        meetingId,
        (detail) => detail.transcriptStatus === 'RECORDING',
      );
      expect(recordingDetail.recordingR2Key).toBeNull();

      await attachE2ETranscriptionProvider(host, scenario);
      await host.waitForTimeout(1500);
      const uploadRequestPromise = host.waitForRequest((req) =>
        req.method() === 'POST' && req.url().includes(`/api/v1/meeting-rooms/`) && req.url().endsWith('/recording'),
      );
      const uploadResponsePromise = host.waitForResponse((res) =>
        res.url().includes(`/api/v1/meeting-rooms/`) && res.url().endsWith('/recording') && res.status() === 202,
        { timeout: 30_000 },
      );
      await host.getByTestId('end-call').click();
      const uploadRequest = await uploadRequestPromise;
      const contentType = uploadRequest.headers()['content-type'] ?? '';
      expect(contentType).toContain('multipart/form-data');
      await uploadResponsePromise;

      await expect(host.getByTestId('recording-save-status')).toContainText('Recording saved', { timeout: 30_000 });
      const savedDetail = await waitForMeetingDetail(
        request,
        token,
        meetingId,
        (detail) => Boolean(detail.recordingR2Key)
          && ['PROCESSING', 'READY', 'FAILED'].includes(detail.transcriptStatus),
      );
      expect(savedDetail.recordingR2Key).toContain(`/${meetingId}/recording.webm`);

      const readyDetail = await waitForMeetingDetail(
        request,
        token,
        meetingId,
        (detail) => detail.transcriptStatus === 'READY',
        60_000,
      );
      expect(readyDetail.recordingR2Key).toBe(savedDetail.recordingR2Key);

      const candidate = await createRolelessCandidateForRecording(request, token, recipientEmail);
      const livingContext = await fetchCandidateLivingContext(request, token, candidate.id);
      const { transcriptText, transcriptionAudioKey } = recordingSourceFromContext(
        livingContext,
        readyDetail.recordingR2Key!,
        scenario.transcriptText,
      );
      expect(transcriptText).toBe(scenario.transcriptText);

      const fixture = await seedRecordedRoleRepoMatchFixture(request, token, candidate.id, scenario);
      const profileRes = await request.get(`${API_BASE}/api/v1/candidates/${candidate.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(profileRes.status()).toBe(200);
      const profile = await profileRes.json() as {
        standaloneReviewMatch?: {
          matchStatus?: string;
          packetId?: string | null;
          repoUrl?: string | null;
          prNumber?: number | null;
          evidence?: Array<{
            candidateSourceRefs?: Array<{ exactText?: string; sourceRefType?: string }>;
            challengeSourceRefs?: Array<{ exactText?: string; sourceRefType?: string }>;
            sharedConcepts?: string[];
          }>;
        } | null;
      };
      expect(profile.standaloneReviewMatch).toMatchObject({
        matchStatus: 'MATCHED',
        packetId: fixture.packetId,
        repoUrl: fixture.repoUrl,
        prNumber: fixture.prNumber,
      });
      expect(profile.standaloneReviewMatch?.evidence?.some((entry) =>
        entry.candidateSourceRefs?.some((source) =>
          source.sourceRefType === 'source_span'
          && source.exactText === scenario.transcriptText
        )
        && entry.challengeSourceRefs?.some((source) =>
          source.sourceRefType === 'repo_source_span'
          && source.exactText?.includes(scenario.expectedRepoEvidenceText ?? scenario.conceptLabel)
        )
        && entry.sharedConcepts?.includes(scenario.conceptKey)
      )).toBe(true);

      await page.goto(`${APP_BASE}/candidates/${candidate.id}`);
      const contextTab = page.locator('button').filter({ hasText: /^CONTEXT$/ });
      await expect(contextTab).toBeVisible({ timeout: 30_000 });
      await contextTab.click();

      const meetingEvidence = page.getByTestId('meeting-evidence-panel');
      await expect(meetingEvidence).toBeVisible({ timeout: 30_000 });
      await expect(meetingEvidence).toContainText('Video Meeting');
      await expect(meetingEvidence).toContainText(transcriptText);
      const recordingProvenance = meetingEvidence.getByTestId('meeting-recording-provenance');
      await expect(recordingProvenance).toContainText('READY');
      await expect(recordingProvenance).toContainText(readyDetail.recordingR2Key!);
      await expect(recordingProvenance).toContainText(transcriptionAudioKey);

      const matchPanel = page.getByTestId('standalone-review-match-panel');
      await expect(matchPanel).toContainText('MATCHED');
      await expect(matchPanel).toContainText(`${fixture.repoUrl.replace('https://github.com/', '')} #${fixture.prNumber}`);
      await expect(matchPanel).toContainText(scenario.expectedMatchTitle ?? `Add ${scenario.conceptLabel} for ecommerce order recovery`);
      const evidenceBridge = page.getByTestId('match-evidence-bridge');
      await expect(evidenceBridge).toBeVisible();
      await expect(evidenceBridge).toContainText(scenario.transcriptText);
      await expect(evidenceBridge).toContainText(scenario.expectedBridgeRepoText ?? `Implement ${scenario.conceptLabel} for ecommerce order recovery.`);
      await expect(evidenceBridge).toContainText(scenario.conceptKey);
      const bridgePersonSource = evidenceBridge
        .getByTestId('match-bridge-person-source')
        .filter({ hasText: scenario.transcriptText })
        .first();
      await expect(bridgePersonSource).toHaveAttribute('data-source-ref-type', 'source_span');
      const bridgeRepoSource = evidenceBridge
        .getByTestId('match-bridge-repo-source')
        .filter({ hasText: scenario.expectedRepoEvidenceText ?? scenario.conceptLabel })
        .first();
      await expect(bridgeRepoSource).toHaveAttribute('data-source-ref-type', 'repo_source_span');
    } finally {
      await hostContext.close();
      await guestContext.close();
    }
  });

  test('renegotiates when the guest rejoins the same room link', async ({
    browser,
    page,
    request,
  }) => {
    const token = await getAuthToken(page);
    const { hostUrl, guestUrl } = await createMeetingRoom(request, token);

    const hostContext = await browser.newContext({
      permissions: ['camera', 'microphone'],
      viewport: { width: 1280, height: 720 },
    });
    const guestContext = await browser.newContext({
      permissions: ['camera', 'microphone'],
      viewport: { width: 1280, height: 720 },
    });

    try {
      const host = await newRoomContext(hostContext);
      const firstGuest = await newRoomContext(guestContext);
      const hostFrames = observeRoomFrames(host);

      await Promise.all([
        host.goto(hostUrl),
        firstGuest.goto(guestUrl),
      ]);
      await Promise.all([
        expect(host.getByTestId('device-check')).toBeVisible(),
        expect(firstGuest.getByTestId('device-check')).toBeVisible(),
      ]);
      await Promise.all([
        host.getByTestId('join-room').click(),
        firstGuest.getByTestId('join-room').click(),
      ]);

      await expect(host.getByTestId('call-stage')).toHaveAttribute('data-room-phase', 'connected', { timeout: 30_000 });
      await expect(firstGuest.getByTestId('call-stage')).toHaveAttribute('data-room-phase', 'connected', { timeout: 30_000 });

      await firstGuest.close();

      const rejoinedGuest = await newRoomContext(guestContext);
      await rejoinedGuest.goto(guestUrl);
      await expect(rejoinedGuest.getByTestId('device-check')).toBeVisible();
      await rejoinedGuest.getByTestId('join-room').click();

      await expect(host.getByTestId('call-stage')).toHaveAttribute('data-room-phase', 'connected', { timeout: 30_000 });
      await expect(rejoinedGuest.getByTestId('call-stage')).toHaveAttribute('data-room-phase', 'connected', { timeout: 30_000 });
      await expect(host.getByTestId('remote-video')).toBeVisible();
      await expect(rejoinedGuest.getByTestId('remote-video')).toBeVisible();
      expect(countFrames(hostFrames, 'OFFER')).toBeGreaterThanOrEqual(2);
    } finally {
      await hostContext.close();
      await guestContext.close();
    }
  });
});
