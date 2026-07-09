import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const APP_BASE = (process.env.APP_BASE || 'https://app-dev.hire-pipe.com').replace(/\/$/, '');
const BASIC_USER = process.env.PIPE_APP_DEV_BASIC_AUTH_USER
  || process.env.APP_DEV_BASIC_AUTH_USER
  || process.env.PIPE_DEV_BASIC_AUTH_USER
  || process.env.DEV_BASIC_AUTH_USER
  || '';
const BASIC_PASSWORD = process.env.PIPE_APP_DEV_BASIC_AUTH_PASSWORD
  || process.env.APP_DEV_BASIC_AUTH_PASSWORD
  || process.env.PIPE_DEV_BASIC_AUTH_PASSWORD
  || process.env.DEV_BASIC_AUTH_PASSWORD
  || '';
const EXPECT_EMAIL_SENT = process.env.EXPECT_EMAIL_SENT !== '0';
const REMOTE = !APP_BASE.includes('localhost') && !APP_BASE.includes('127.0.0.1');

function assertEnv() {
  if (!REMOTE) return;
  if (!BASIC_USER || !BASIC_PASSWORD) {
    throw new Error(
      'Set PIPE_APP_DEV_BASIC_AUTH_USER/PASSWORD, APP_DEV_BASIC_AUTH_USER/PASSWORD, or PIPE_DEV_BASIC_AUTH_USER/PASSWORD to smoke deployed app-dev.',
    );
  }
}

function authHeaders() {
  if (!BASIC_USER && !BASIC_PASSWORD) return {};
  const value = Buffer.from(`${BASIC_USER}:${BASIC_PASSWORD}`).toString('base64');
  return { Authorization: `Basic ${value}` };
}

function cleanRoomUrl(rawUrl) {
  if (!rawUrl) return null;
  const url = new URL(rawUrl);
  url.username = '';
  url.password = '';
  return url.toString().replace(/\/room\/.+$/, '/room/<token>');
}

function canonicalUrl(rawUrl) {
  if (!rawUrl) return null;
  const url = new URL(rawUrl);
  url.username = '';
  url.password = '';
  return url.toString();
}

async function requestJson(path, init = {}) {
  const response = await fetch(`${APP_BASE}${path}`, {
    ...init,
    headers: {
      ...authHeaders(),
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!response.ok) {
    throw new Error(`${init.method ?? 'GET'} ${path} failed (${response.status}): ${text}`);
  }
  return body;
}

async function postJson(path, body) {
  return requestJson(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function pollInterviewDetail(interviewId) {
  let lastDetail = null;
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    lastDetail = await requestJson(`/api/v1/scheduling/interviews/${interviewId}`);
    if (!EXPECT_EMAIL_SENT || lastDetail?.interview?.emailSentAt) return lastDetail;
    await sleep(1500);
  }
  return lastDetail;
}

async function main() {
  assertEnv();

  const unique = Date.now();
  const recipientEmail = `codex-invite-smoke-${unique}@pipe-test.dev`;
  const recipientName = 'Codex Invite Smoke';

  const created = await postJson('/api/v1/scheduling/interviews', {
    recipientName,
    recipientEmail,
    meetingType: 'DIRECT_VIDEO_CALL',
    interviewType: 'VIDEO',
  });
  const interviewId = created?.interview?.id;
  assert(interviewId, `Create interview response missing interview id: ${JSON.stringify(created)}`);

  const invited = await postJson(`/api/v1/scheduling/interviews/${interviewId}/invite`, {
    email: recipientEmail,
    message: 'Automated dev smoke for the PIPE invite flow.',
  });

  assert(invited?.success === true, `Invite did not report success: ${JSON.stringify(invited)}`);
  assert(typeof invited?.meetingUrl === 'string' && invited.meetingUrl.length > 0, 'Invite response missing meetingUrl.');
  assert(invited?.room?.guestUrl === invited.meetingUrl, 'Invite meetingUrl must be the canonical guest room link.');
  assert(invited?.room?.hostUrl && invited.room.hostUrl !== invited.room.guestUrl, 'Host and guest room links must be distinct.');
  if (EXPECT_EMAIL_SENT) {
    assert(invited.emailSent === false, `Invite POST should return before background email completes: ${JSON.stringify(invited)}`);
    assert(invited.emailQueued === true, `Expected background email delivery to be queued, got: ${JSON.stringify(invited)}`);
  }

  const detail = await pollInterviewDetail(interviewId);
  const interview = detail?.interview;
  assert(interview?.id === interviewId, 'Detail response returned the wrong interview.');
  assert(
    canonicalUrl(interview?.meetingUrl) === canonicalUrl(invited.meetingUrl),
    'scheduled_interviews.meetingUrl does not match invite response.',
  );
  assert(
    canonicalUrl(interview?.linkedMeeting?.meetingUrl) === canonicalUrl(invited.meetingUrl),
    'linked meeting URL does not match invite response.',
  );
  assert(interview?.linkedMeeting?.room?.id, 'linked meeting is missing room metadata.');
  assert(interview?.inviteLinkSentAt, 'interview inviteLinkSentAt was not persisted.');
  if (EXPECT_EMAIL_SENT) {
    assert(interview?.emailSentAt, 'interview emailSentAt was not persisted.');
  }

  const summary = interview?.livingContext?.summary;
  assert(summary?.interactionCount >= 2, 'living context did not record interview creation plus invite delivery.');
  assert(summary?.contextRecordCount >= 2, 'living context did not record source-backed invite context records.');
  assert(summary?.sourceSpanCount >= 2, 'living context did not preserve source spans for invite context.');

  console.log(JSON.stringify({
    ok: true,
    interviewId,
    emailSent: invited.emailSent,
    emailQueued: invited.emailQueued ?? false,
    provider: invited.provider ?? null,
    meetingUrl: cleanRoomUrl(invited.meetingUrl),
    hostUrl: cleanRoomUrl(invited.room.hostUrl),
    context: {
      interactions: summary.interactionCount,
      records: summary.contextRecordCount,
      sourceSpans: summary.sourceSpanCount,
    },
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
