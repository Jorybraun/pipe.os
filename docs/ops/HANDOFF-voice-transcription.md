# Handoff: Voice Input & Transcription Pipeline

**Date:** 2026-02-28
**Priority:** Post-MVP sprint 2
**Design doc:** `docs/design/voice-transcription-architecture.md`
**ADR:** `docs/decisions/ADR-008-voice-input-transcription.md`
**Status:** Ready to plan — do NOT start until MVP first cohort is live.

---

## Pre-conditions

Before starting, verify:

1. `npx tsc --noEmit` passes clean
2. `npx ampx sandbox` is running for your dev environment
3. `@aws-amplify/storage` is already installed (it is, as part of the Amplify package)
4. No existing `amplify/storage/` directory (you're creating it)
5. AWS account has Amazon Transcribe enabled in your deployment region

---

## Implementation Order

Work in this exact order. Each step must pass `npx tsc --noEmit` before continuing.

---

## Step 1 — Schema: Extend Assessment model

**File:** `amplify/data/resource.ts`

Add these fields to the `Assessment` model:

```typescript
recordingKey: a.string(),
transcript: a.string(),
transcriptionStatus: a.enum(['NONE', 'PROCESSING', 'COMPLETED', 'ERROR']),
transcriptionError: a.string(),
```

No authorization changes needed — existing `allow.owner()` and `allow.publicApiKey().to(['create', 'read'])` cover these fields.

Run:
```bash
npx tsc --noEmit   # must pass
npx ampx sandbox   # re-deploy schema
```

---

## Step 2 — Storage resource

Create `amplify/storage/resource.ts`:

```typescript
import { defineStorage } from '@aws-amplify/backend';
import { transcriptionTrigger } from '../functions/transcriptionTrigger/resource';

export const storage = defineStorage({
  name: 'pipeRecordings',
  access: (allow) => ({
    'recordings/{entity_id}/*': [
      allow.entity('identity').to(['read', 'write', 'delete']),
      allow.authenticated.to(['read']),
    ],
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

export const backend = defineBackend({
  auth,
  data,
  storage,
  transcriptionTrigger,
  transcriptionCompletion,
});
```

---

## Step 3 — transcriptionTrigger Lambda

Create `amplify/functions/transcriptionTrigger/` directory.

**`amplify/functions/transcriptionTrigger/resource.ts`:**
```typescript
import { defineFunction } from '@aws-amplify/backend';

export const transcriptionTrigger = defineFunction({
  name: 'transcriptionTrigger',
  entry: './handler.ts',
  environment: {
    TRANSCRIBE_LANGUAGE_CODE: 'en-US',
  },
  timeoutSeconds: 30,
});
```

**`amplify/functions/transcriptionTrigger/types.ts`:**
```typescript
export interface ParsedS3Key {
  candidateId: string;
  assessmentId: string;
  challengeId: string;
  extension: string;
}

export interface TranscriptionTriggerInput {
  Records: Array<{
    s3: {
      bucket: { name: string };
      object: { key: string };
    };
  }>;
}
```

**`amplify/functions/transcriptionTrigger/handler.ts`:**

```typescript
import {
  TranscribeClient,
  StartTranscriptionJobCommand,
} from '@aws-sdk/client-transcribe';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../data/resource';
import type { TranscriptionTriggerInput, ParsedS3Key } from './types';

// Note: import outputs at deploy time from the generated amplify_outputs
// In Lambda context, use process.env values set by Amplify
const client = generateClient<Schema>({ authMode: 'iam' });
const transcribe = new TranscribeClient({});

/**
 * Parses "recordings/{candidateId}/{assessmentId}/{challengeId}.{ext}"
 * Returns null if the key doesn't match (e.g. a transcript file triggering the rule).
 */
function parseS3Key(key: string): ParsedS3Key | null {
  const decodedKey = decodeURIComponent(key.replace(/\+/g, ' '));
  const match = decodedKey.match(
    /^recordings\/([^/]+)\/([^/]+)\/([^/]+)\.(\w+)$/
  );
  if (!match) return null;
  return {
    candidateId: match[1],
    assessmentId: match[2],
    challengeId: match[3],
    extension: match[4],
  };
}

export const handler = async (event: TranscriptionTriggerInput): Promise<void> => {
  for (const record of event.Records) {
    const bucket = record.s3.bucket.name;
    const key = record.s3.object.key;

    const parsed = parseS3Key(key);
    if (!parsed) {
      console.log('[transcriptionTrigger] Skipping non-recording key:', key);
      continue;
    }

    const { assessmentId, challengeId, extension } = parsed;
    const jobName = `pipe-${assessmentId}-${challengeId}`.slice(0, 200);
    const outputKey = `transcripts/${assessmentId}/${challengeId}.json`;

    console.log('[transcriptionTrigger] Starting job:', jobName);

    try {
      // Mark assessment as PROCESSING
      const { errors: updateErrors } = await client.models.Assessment.update({
        id: assessmentId,
        transcriptionStatus: 'PROCESSING',
      });
      if (updateErrors) throw new Error(updateErrors[0].message);

      // Start Transcribe job
      await transcribe.send(
        new StartTranscriptionJobCommand({
          TranscriptionJobName: jobName,
          LanguageCode: process.env['TRANSCRIBE_LANGUAGE_CODE'] ?? 'en-US',
          MediaFormat: extension === 'webm' ? 'webm' : 'mp4',
          Media: { MediaFileUri: `s3://${bucket}/${key}` },
          OutputBucketName: bucket,
          OutputKey: outputKey,
        })
      );

      console.log('[transcriptionTrigger] Job started:', jobName);
    } catch (err) {
      console.error('[transcriptionTrigger] Error starting job:', err);

      // Mark as ERROR so recruiter sees it
      await client.models.Assessment.update({
        id: assessmentId,
        transcriptionStatus: 'ERROR',
        transcriptionError:
          err instanceof Error ? err.message : 'Unknown error',
      }).catch((e: unknown) =>
        console.error('[transcriptionTrigger] Failed to update error status:', e)
      );
    }
  }
};
```

**Add Transcribe IAM policy in `amplify/backend.ts`** (after `defineBackend`):

```typescript
import * as iam from 'aws-cdk-lib/aws-iam';

backend.transcriptionTrigger.resources.lambda.addToRolePolicy(
  new iam.PolicyStatement({
    effect: iam.Effect.ALLOW,
    actions: ['transcribe:StartTranscriptionJob'],
    resources: ['*'],
  })
);
```

Install the Transcribe SDK:
```bash
cd amplify && npm i @aws-sdk/client-transcribe
```

---

## Step 4 — transcriptionCompletion Lambda

Create `amplify/functions/transcriptionCompletion/` directory.

**`amplify/functions/transcriptionCompletion/resource.ts`:**
```typescript
import { defineFunction } from '@aws-amplify/backend';

export const transcriptionCompletion = defineFunction({
  name: 'transcriptionCompletion',
  entry: './handler.ts',
  timeoutSeconds: 30,
});
```

**`amplify/functions/transcriptionCompletion/types.ts`:**
```typescript
export interface TranscribeEventBridgeEvent {
  source: 'aws.transcribe';
  'detail-type': 'Transcribe Job State Change';
  detail: {
    TranscriptionJobName: string;
    TranscriptionJobStatus: 'COMPLETED' | 'FAILED';
    FailureReason?: string;
    Transcript?: {
      TranscriptFileUri: string;
    };
  };
}

export interface TranscribeOutputJson {
  results: {
    transcripts: Array<{ transcript: string }>;
  };
}
```

**`amplify/functions/transcriptionCompletion/handler.ts`:**
```typescript
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../data/resource';
import type {
  TranscribeEventBridgeEvent,
  TranscribeOutputJson,
} from './types';

const s3 = new S3Client({});
const client = generateClient<Schema>({ authMode: 'iam' });

/**
 * Parses job name "pipe-{assessmentId}-{challengeId}" back to IDs.
 * Job names are: pipe- + assessmentId (UUID, 36 chars) + - + challengeId (UUID, 36 chars)
 * Total: 5 + 36 + 1 + 36 = 78 chars (well within 200-char limit).
 */
function parseJobName(
  jobName: string
): { assessmentId: string; challengeId: string } | null {
  const match = jobName.match(
    /^pipe-([0-9a-f-]{36})-([0-9a-f-]{36})$/i
  );
  if (!match) return null;
  return { assessmentId: match[1], challengeId: match[2] };
}

export const handler = async (
  event: TranscribeEventBridgeEvent
): Promise<void> => {
  const { TranscriptionJobName, TranscriptionJobStatus, FailureReason } =
    event.detail;

  const parsed = parseJobName(TranscriptionJobName);
  if (!parsed) {
    console.log(
      '[transcriptionCompletion] Ignoring unrecognized job:',
      TranscriptionJobName
    );
    return;
  }

  const { assessmentId } = parsed;

  if (TranscriptionJobStatus === 'FAILED') {
    console.error('[transcriptionCompletion] Job failed:', TranscriptionJobName, FailureReason);
    await client.models.Assessment.update({
      id: assessmentId,
      transcriptionStatus: 'ERROR',
      transcriptionError: FailureReason ?? 'Transcription job failed',
    });
    return;
  }

  // COMPLETED path
  try {
    // The Transcript URI is s3://bucket/transcripts/{assessmentId}/{challengeId}.json
    const transcriptUri = event.detail.Transcript?.TranscriptFileUri;
    if (!transcriptUri) throw new Error('No TranscriptFileUri in event');

    // Parse "s3://bucket/key" → bucket + key
    const uriMatch = transcriptUri.match(/^s3:\/\/([^/]+)\/(.+)$/);
    if (!uriMatch) throw new Error(`Unparseable URI: ${transcriptUri}`);
    const [, bucket, key] = uriMatch;

    // Fetch transcript JSON from S3
    const response = await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: key })
    );
    const body = await response.Body?.transformToString('utf-8');
    if (!body) throw new Error('Empty transcript response from S3');

    const json = JSON.parse(body) as TranscribeOutputJson;
    const transcript = json.results.transcripts[0]?.transcript ?? '';

    console.log('[transcriptionCompletion] Transcript length:', transcript.length);

    await client.models.Assessment.update({
      id: assessmentId,
      transcript,
      transcriptionStatus: 'COMPLETED',
    });
  } catch (err) {
    console.error('[transcriptionCompletion] Error processing transcript:', err);
    await client.models.Assessment.update({
      id: assessmentId,
      transcriptionStatus: 'ERROR',
      transcriptionError:
        err instanceof Error ? err.message : 'Failed to process transcript',
    }).catch((e: unknown) =>
      console.error('[transcriptionCompletion] Failed to write error status:', e)
    );
  }
};
```

**Add S3 IAM policy in `amplify/backend.ts`:**
```typescript
backend.transcriptionCompletion.resources.lambda.addToRolePolicy(
  new iam.PolicyStatement({
    effect: iam.Effect.ALLOW,
    actions: ['s3:GetObject'],
    resources: [
      `arn:aws:s3:::${backend.storage.resources.bucket.bucketName}/transcripts/*`,
    ],
  })
);
```

Install the S3 SDK (probably already installed; check):
```bash
cd amplify && npm i @aws-sdk/client-s3
```

---

## Step 5 — EventBridge rule (CDK escape hatch)

Add to `amplify/backend.ts` after all `addToRolePolicy` calls:

```typescript
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import { Stack } from 'aws-cdk-lib';

const transcribeRule = new events.Rule(
  Stack.of(backend.transcriptionCompletion.resources.lambda),
  'TranscribeJobCompletionRule',
  {
    eventPattern: {
      source: ['aws.transcribe'],
      detailType: ['Transcribe Job State Change'],
      detail: {
        TranscriptionJobStatus: ['COMPLETED', 'FAILED'],
      },
    },
  }
);

transcribeRule.addTarget(
  new targets.LambdaFunction(
    backend.transcriptionCompletion.resources.lambda
  )
);
```

Install CDK packages (already present as Amplify dependencies; verify):
```bash
cd amplify && npm ls aws-cdk-lib
```

---

## Step 6 — RecordingShell component

Create `src/components/Shells/RecordingShell.tsx`.

Key props:
```typescript
interface RecordingShellProps {
  assessmentId: string;
  challengeId: string;
  candidateId: string;
  maxDurationSec?: number; // default 300
  onRecordingSubmitted: (recordingKey: string) => void;
  children: ReactNode; // TextareaPanel (text answer, fallback)
}
```

Key behaviors:
- Detect `MediaRecorder` support on mount; hide recording UI if unsupported
- Use `MediaRecorder.isTypeSupported('audio/webm;codecs=opus')` to pick format
- Show animated recording indicator + elapsed timer
- Auto-stop at `maxDurationSec`
- Upload via `uploadData` from `@aws-amplify/storage`:
  ```typescript
  import { uploadData } from '@aws-amplify/storage';
  const result = await uploadData({
    key: `recordings/${candidateId}/${assessmentId}/${challengeId}.${extension}`,
    data: audioBlob,
    options: { contentType: mimeType },
  }).result;
  ```
- On success, call `onRecordingSubmitted(result.key)`
- The caller (`useAssessment`) updates `Assessment.recordingKey`

---

## Step 7 — Update resolveShells.ts

```typescript
// src/lib/challenge/resolveShells.ts

export interface ResolvedShells {
  timer: { enabled: boolean; timeLimit: number | null };
  recording: { enabled: boolean; maxDurationSec: number };
}

export function resolveShells(challenge: Challenge, stage: Stage): ResolvedShells {
  const config = challenge.config as { recordingEnabled?: boolean; maxRecordingDurationSec?: number } | null;
  const recordingEnabled =
    challenge.type === 'QUIZ_SHORT_ANSWER' && (config?.recordingEnabled ?? false);

  return {
    timer: { ... }, // existing logic
    recording: {
      enabled: recordingEnabled,
      maxDurationSec: config?.maxRecordingDurationSec ?? 300,
    },
  };
}
```

Then in `ChallengeRegistry.tsx`, after the timer shell:
```typescript
if (shells.recording.enabled) {
  content = (
    <RecordingShell
      assessmentId={assessmentId}
      challengeId={challenge.id}
      candidateId={candidateId}
      maxDurationSec={shells.recording.maxDurationSec}
      onRecordingSubmitted={(key) => handleRecordingSubmitted(key)}
    >
      {content}
    </RecordingShell>
  );
}
```

---

## Step 8 — CandidateProfilePage: transcript UI

In the SHORT_ANSWER assessment card, add a transcript section:

```tsx
{assessment.transcriptionStatus === 'PROCESSING' && (
  <div className="transcript-loading">
    <Loader2 size={12} className="animate-spin" />
    <span>Transcribing audio answer...</span>
  </div>
)}

{assessment.transcriptionStatus === 'COMPLETED' && assessment.transcript && (
  <div className="transcript-complete">
    <div className="transcript-label">VERBAL_ANSWER</div>
    <p>{assessment.transcript}</p>
  </div>
)}

{assessment.transcriptionStatus === 'ERROR' && (
  <div className="transcript-error">
    Transcription failed — typed answer only
  </div>
)}
```

---

## Step 9 — Deploy & smoke test

```bash
# Type check
npx tsc --noEmit

# Deploy to sandbox
npx ampx sandbox

# Manual test:
# 1. Create a SHORT_ANSWER challenge with config.recordingEnabled = true
# 2. Open /assess/:token as candidate
# 3. Record a 10-second answer
# 4. Verify: Assessment.transcriptionStatus transitions NONE → PROCESSING → COMPLETED
# 5. Open CandidateProfilePage as recruiter
# 6. Verify transcript text is visible
```

---

## Data Lifecycle

Add S3 lifecycle rule in `amplify/backend.ts` (CDK):

```typescript
import * as s3 from 'aws-cdk-lib/aws-s3';

const bucket = backend.storage.resources.bucket as s3.Bucket;
bucket.addLifecycleRule({
  id: 'RecordingsRetention',
  prefix: 'recordings/',
  transitions: [
    {
      storageClass: s3.StorageClass.GLACIER,
      transitionAfter: Duration.days(30),
    },
  ],
  expiration: Duration.days(90),
});
```

---

## Rollback

This feature is entirely additive:
- Schema changes are new fields on `Assessment` — no migration needed
- New S3 bucket — independent of existing DynamoDB data
- New Lambdas — not invoked unless a file is uploaded
- EventBridge rule — fires only for Transcribe jobs created by this system

To disable: set `Challenge.config.recordingEnabled = false` for all challenges. No code changes needed.
