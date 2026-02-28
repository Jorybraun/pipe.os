# ADR-008: Voice Input & Transcription Architecture

**Status:** Proposed — implement post-MVP sprint 2
**Date:** 2026-02-27 (revised 2026-02-28)
**Deciders:** Jory (solo founder)

> **Scope:** This ADR covers `QUIZ_SHORT_ANSWER` challenges only. It is explicitly post-MVP.
> Do not start implementation until: the first recruiter cohort is onboarded and MVP is stable.
> Full implementation runbook: `docs/ops/HANDOFF-voice-transcription.md`
> Full design doc: `docs/design/voice-transcription-architecture.md`

---

## Context

`QUIZ_SHORT_ANSWER` challenges ask candidates to explain their reasoning in their own words. Typed text responses work, but verbal answers are often more natural, richer, and faster for candidates — and give recruiters a signal on communication ability that text cannot.

Implementing this requires:
1. Recording audio in the browser (`MediaRecorder` API)
2. Uploading to S3 (Amplify Storage)
3. Kicking off a transcription job (Amazon Transcribe)
4. Writing the transcript back to the `Assessment` record when the job completes
5. Showing "transcribing..." → transcript in the recruiter's `CandidateProfilePage`

There is no existing `amplify/storage/` resource in the project. This feature requires creating one.

---

## Decision

Implement an event-driven transcription pipeline using **Amazon Transcribe Batch**, **Amplify Storage with S3 upload trigger**, and **Amazon EventBridge** for job completion routing.

### Audio format

**Chosen: `audio/webm;codecs=opus`**

Rationale: Chrome and Firefox both support `audio/webm;codecs=opus` natively via `MediaRecorder`. Safari requires `audio/mp4` (AAC). Amazon Transcribe supports both formats. The implementation uses `MediaRecorder.isTypeSupported()` to detect the correct format at runtime and records in the best available codec. The S3 key includes the file extension (`recording.webm` or `recording.mp4`) so Transcribe can auto-detect the media format.

```typescript
// Detection logic (implemented in RecordingShell)
const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
  ? 'audio/webm;codecs=opus'
  : 'audio/mp4';
const extension = mimeType.startsWith('audio/webm') ? 'webm' : 'mp4';
```

Amazon Transcribe does **not** need the media format specified explicitly when the file extension is `webm` or `mp4` — it auto-detects.

### S3 path structure

```
recordings/{candidateId}/{assessmentId}/{challengeId}.{ext}
```

- `candidateId` — Amplify Cognito-free candidate ID (from `Candidate` record)
- `assessmentId` — ties back to the `Assessment` record that will receive the transcript
- `challengeId` — for multi-challenge stages, disambiguates which recording
- `ext` — `webm` or `mp4`

### Component overview

```
Browser (RecordingShell)
  └─ MediaRecorder → Blob
  └─ Storage.put() → S3 (private path)
                         │
                   onUpload trigger
                         │
              transcriptionTrigger Lambda
                  └─ StartTranscriptionJob (Amazon Transcribe)
                  └─ sets job name = assessmentId + challengeId (unique)
                         │
                   (async: 15s–2min)
                         │
                 EventBridge rule
                 "TranscribeJobStateChange: COMPLETED"
                         │
              transcriptionCompletion Lambda
                  └─ GetTranscriptionJob → transcript S3 URI
                  └─ S3.getObject → transcript JSON
                  └─ AppSync mutation (IAM auth) → Assessment.update({ transcript })
                         │
                   CandidateProfilePage
                  └─ shows transcript (existing observeQuery subscription)
```

### 1. Amplify Storage resource

Create `amplify/storage/resource.ts`:

```typescript
import { defineStorage } from '@aws-amplify/backend';
import { transcriptionTrigger } from '../functions/transcriptionTrigger/resource';

export const storage = defineStorage({
  name: 'pipeRecordings',
  access: (allow) => ({
    // Candidates write to their own path; recruiters read all recordings
    'recordings/{entity_id}/*': [
      allow.entity('identity').to(['read', 'write', 'delete']),
      allow.authenticated.to(['read']),
    ],
    // Transcribe output bucket prefix (Lambda writes here; private)
    'transcripts/*': [
      allow.resource(transcriptionTrigger).to(['read', 'write']),
      allow.authenticated.to(['read']),
    ],
  }),
  triggers: {
    onUpload: transcriptionTrigger,
  },
});
```

Register in `amplify/backend.ts`:
```typescript
import { storage } from './storage/resource';
export const backend = defineBackend({ auth, data, storage, ... });
```

### 2. transcriptionTrigger Lambda

**File:** `amplify/functions/transcriptionTrigger/`

**Trigger:** S3 `ObjectCreated` events on `recordings/*` prefix.

**IAM requirements:** The Lambda execution role needs:
```json
{
  "Effect": "Allow",
  "Action": ["transcribe:StartTranscriptionJob"],
  "Resource": "*"
}
```

Grant this in `amplify/functions/transcriptionTrigger/resource.ts`:
```typescript
import { defineFunction } from '@aws-amplify/backend';

export const transcriptionTrigger = defineFunction({
  name: 'transcriptionTrigger',
  entry: './handler.ts',
});

// In amplify/backend.ts, after defineBackend:
backend.transcriptionTrigger.resources.lambda.addToRolePolicy(
  new iam.PolicyStatement({
    effect: iam.Effect.ALLOW,
    actions: ['transcribe:StartTranscriptionJob'],
    resources: ['*'],
  })
);
```

**Handler logic:**
1. Parse S3 key from the event: `recordings/{candidateId}/{assessmentId}/{challengeId}.{ext}`
2. Extract `assessmentId` and `challengeId` from the path
3. Call `StartTranscriptionJob` with:
   - `TranscriptionJobName`: `pipe-{assessmentId}-{challengeId}` (must be unique; 36-char UUID cap means truncation to 200 chars is safe)
   - `MediaFileUri`: `s3://{bucket}/{key}`
   - `LanguageCode`: `en-US` (configurable via env var for future i18n)
   - `OutputBucketName`: same bucket
   - `OutputKey`: `transcripts/{assessmentId}/{challengeId}.json`
4. Update `Assessment` via AppSync mutation to set `transcriptionStatus: 'PROCESSING'`

**Error handling:** If `StartTranscriptionJob` throws (e.g. duplicate job name), the Lambda should catch, log, and update `Assessment.transcriptionStatus = 'ERROR'`.

### 3. transcriptionCompletion Lambda (EventBridge triggered)

**File:** `amplify/functions/transcriptionCompletion/`

**Trigger:** Amazon EventBridge rule matching:
```json
{
  "source": ["aws.transcribe"],
  "detail-type": ["Transcribe Job State Change"],
  "detail": { "TranscriptionJobStatus": ["COMPLETED", "FAILED"] }
}
```

**IAM requirements:** Needs S3 read access to the transcript JSON, plus AppSync IAM mutation access:
```typescript
backend.transcriptionCompletion.resources.lambda.addToRolePolicy(
  new iam.PolicyStatement({
    effect: iam.Effect.ALLOW,
    actions: ['s3:GetObject'],
    resources: [`arn:aws:s3:::${bucketName}/transcripts/*`],
  })
);
// AppSync IAM access is granted automatically via Amplify when you
// call generateClient({ authMode: 'iam' }) inside a Lambda
```

**How to set up the EventBridge rule in Amplify Gen 2 (CDK escape hatch):**
```typescript
// In amplify/backend.ts, after defineBackend:
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';

const transcribeCompletionRule = new events.Rule(
  backend.createStack('TranscribeCompletionRule'),
  'TranscribeJobCompleted',
  {
    eventPattern: {
      source: ['aws.transcribe'],
      detailType: ['Transcribe Job State Change'],
      detail: { TranscriptionJobStatus: ['COMPLETED', 'FAILED'] },
    },
  }
);

transcribeCompletionRule.addTarget(
  new targets.LambdaFunction(
    backend.transcriptionCompletion.resources.lambda
  )
);
```

**Handler logic:**
1. Parse `TranscriptionJobName` from the EventBridge event: `pipe-{assessmentId}-{challengeId}`
2. Extract `assessmentId` and `challengeId`
3. If status is `FAILED`: call AppSync mutation (IAM auth) → `Assessment.update({ transcriptionStatus: 'ERROR', transcript: null })`
4. If status is `COMPLETED`:
   - Read transcript JSON from `s3://transcripts/{assessmentId}/{challengeId}.json`
   - Extract `results.transcripts[0].transcript` (the full text)
   - Call AppSync mutation (IAM auth) → `Assessment.update({ transcript, transcriptionStatus: 'COMPLETED' })`

**AppSync IAM auth in Lambda:**
```typescript
import { generateClient } from 'aws-amplify/data';
import { Amplify } from 'aws-amplify';
import outputs from '../../../amplify_outputs.json';

Amplify.configure(outputs);
const client = generateClient<Schema>({ authMode: 'iam' });

await client.models.Assessment.update({
  id: assessmentId,
  transcript: transcriptText,
  transcriptionStatus: 'COMPLETED',
});
```

Note: The Lambda's IAM execution role automatically has AppSync IAM access when Amplify is configured with `authorizationModes: { defaultAuthorizationMode: 'userPool', iamAuthorizationMode: { ... } }`. No additional policy statement is needed for AppSync — it is handled by Amplify's CDK output.

### 4. Schema additions

Add to `Assessment` model in `amplify/data/resource.ts`:

```typescript
Assessment: a.model({
  // ... existing fields ...
  transcript: a.string(),                             // Completed transcription text
  transcriptionStatus: a.enum([                       // Tracks async pipeline state
    'NONE',        // No recording submitted
    'PROCESSING',  // Transcribe job in progress
    'COMPLETED',   // Transcript available
    'ERROR',       // Job failed (see Assessment.transcriptionError)
  ]),
  transcriptionError: a.string(),                     // Error message if status=ERROR
})
```

### 5. RecordingShell component

A new behavioral shell wrapping `QUIZ_SHORT_ANSWER` challenges when a recording is requested. Lives at `src/components/Shells/RecordingShell.tsx`. Already stubbed in `resolveShells.ts` under `recording.enabled`.

Activates when `Challenge.config.recordingEnabled = true`.

Key states: `idle → recording → uploading → submitted`.

---

## Options Considered

### Option A: Event-driven pipeline — S3 trigger + Transcribe + EventBridge (chosen)

| Dimension | Assessment |
|---|---|
| Latency for candidate | ✅ Zero — they submit and move on |
| Latency for recruiter | ~30s–3min async; status shown in UI |
| Infrastructure complexity | Medium — 2 Lambdas + EventBridge rule |
| Cost | ~$0.024/min audio (free tier: 60min/month) |
| AWS-native alignment | ✅ Follows Amplify patterns |
| Amplify Gen 2 support | ⚠️ EventBridge requires CDK escape hatch (documented above) |

### Option B: Synchronous transcription in upload Lambda (rejected)

Have the trigger Lambda poll `GetTranscriptionJob` until complete. Rejected: Lambda has a 15-minute max but Transcribe batch jobs can take up to 4 hours for long audio (though recordings will be <10 min). Polling is wasteful and brittle. EventBridge push is strictly better.

### Option C: Amazon Transcribe Streaming (real-time, rejected for now)

Streams audio directly to Transcribe during recording via WebSocket. Near-instant transcripts. Rejected for MVP of this feature: requires a backend WebSocket proxy (Transcribe streaming doesn't support browser-direct calls), adding significant infrastructure complexity. Post-MVP option if recruiter feedback demands real-time transcript previews.

### Option D: Whisper on Lambda (rejected)

Higher accuracy, especially for non-native English speakers. Requires large Lambda layers (~500MB) or SageMaker, no Amplify-native integration. Cost and complexity unjustified at this scale. Consider post-100-customer.

### Option E: Client-side Whisper (Web Assembly, rejected)

`whisper.cpp` compiled to WASM runs in-browser at ~1x–3x realtime. Interesting, but 100MB WASM bundle, significant CPU on candidate device (especially mobile), no reliability guarantees. Rejected for MVP.

---

## Trade-off Analysis

The EventBridge + CDK escape hatch is the only non-standard Amplify pattern here. It is well-documented above and is a one-time setup. All other components (defineStorage, defineFunction, S3 trigger) are standard Amplify Gen 2.

The primary risk is the CDK escape hatch: if Amplify Gen 2 changes its CDK version or internal stack structure, the escape hatch may need updating. This is low probability and low impact (an event rule is a primitive, stable AWS resource).

The async UX is a feature, not a bug: candidates aren't blocked waiting for transcription, and the UI shows status clearly.

---

## Consequences

- New `amplify/storage/resource.ts` must be created and registered.
- Two new Lambda functions: `transcriptionTrigger` and `transcriptionCompletion`.
- One EventBridge rule (CDK escape hatch in `amplify/backend.ts`).
- `Assessment` model gains `transcript`, `transcriptionStatus`, `transcriptionError` fields (additive schema change — safe to deploy without migration).
- `RecordingShell` must be built and wired into `resolveShells.ts` (already stubbed).
- `CandidateProfilePage` needs a "transcript" section for `QUIZ_SHORT_ANSWER` assessments with `transcriptionStatus !== 'NONE'`.
- Data retention: add S3 lifecycle rule (move to Glacier after 30 days, delete after 90 days) as a CDK construct in `amplify/backend.ts`.
- `Assessment.submission` for SHORT_ANSWER challenges should store the typed text (existing behavior) OR the S3 key of the recording — not both in the same field. Recommend: typed text stays in `submission`, S3 key stored in a new `recordingKey: a.string()` field.

---

## Error States

The system must handle these failure modes gracefully:

| Failure | Handling |
|---|---|
| MediaRecorder not supported | `RecordingShell` detects, falls back to text-only mode |
| S3 upload fails | `RecordingShell` retries once, then falls back to text |
| Transcribe job fails | `transcriptionCompletion` sets `transcriptionStatus = 'ERROR'`; recruiter sees error badge |
| EventBridge rule mis-fires or Lambda cold-start timeout | Job status stays `PROCESSING`; add a cron Lambda to sweep stuck jobs (post-MVP) |
| Transcript is empty (silence or background noise) | `transcript = ''` stored; recruiter sees "No speech detected" |

---

## Action Items

1. [ ] **Post-MVP sprint 2:** Create `docs/design/voice-transcription-architecture.md` — full component diagram with sequence flows
2. [ ] **Post-MVP sprint 2:** Create `amplify/storage/resource.ts` with `pipeRecordings` bucket and trigger
3. [ ] **Post-MVP sprint 2:** Create `amplify/functions/transcriptionTrigger/` (handler + types + resource)
4. [ ] **Post-MVP sprint 2:** Create `amplify/functions/transcriptionCompletion/` (handler + types + resource)
5. [ ] **Post-MVP sprint 2:** Add EventBridge rule CDK construct to `amplify/backend.ts`
6. [ ] **Post-MVP sprint 2:** Add `transcript`, `transcriptionStatus`, `transcriptionError`, `recordingKey` to `Assessment` schema
7. [ ] **Post-MVP sprint 2:** Build `RecordingShell.tsx` — idle / recording / uploading / submitted states
8. [ ] **Post-MVP sprint 2:** Update `resolveShells.ts` to activate `recording` shell when `Challenge.config.recordingEnabled = true`
9. [ ] **Post-MVP sprint 2:** Update `CandidateProfilePage` — transcript section for SHORT_ANSWER with status indicators
10. [ ] **Post-MVP sprint 2:** Run `npx ampx sandbox`, `npx tsc --noEmit`, end-to-end smoke test

**Do not start until:** MVP is live with the first recruiter cohort.
