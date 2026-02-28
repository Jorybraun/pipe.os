# Voice Input & Transcription — Architecture

**Status:** Proposed (post-MVP sprint 2)
**Owner:** Jory
**ADR:** `docs/decisions/ADR-008-voice-input-transcription.md`
**Implementation runbook:** `docs/ops/HANDOFF-voice-transcription.md`

---

## Overview

Voice input allows candidates to answer `QUIZ_SHORT_ANSWER` challenges verbally instead of (or in addition to) typing. The spoken answer is recorded in-browser, uploaded to S3, and asynchronously transcribed by Amazon Transcribe. The transcript lands back in the `Assessment` record and is surfaced in the recruiter's `CandidateProfilePage`.

Voice recording is **opt-in per challenge**, controlled by `Challenge.config.recordingEnabled = true`. It is not active by default.

---

## System Context

```
┌─────────────────────────────────────────────────────────────────────┐
│  Browser (Candidate)                                                │
│                                                                     │
│  RecordingShell                                                     │
│  ├── idle: shows "Start Recording" button                           │
│  ├── recording: MediaRecorder captures audio blob                  │
│  ├── uploading: Storage.put() → S3                                 │
│  └── submitted: shows "Transcribing..." until status updates        │
│                                                                     │
│  TextareaPanel (typed answer, always available as fallback)         │
└──────────────────────┬──────────────────────────────────────────────┘
                       │  S3 ObjectCreated event
                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│  AWS Backend                                                        │
│                                                                     │
│  S3 (pipeRecordings)                                                │
│  └── recordings/{candidateId}/{assessmentId}/{challengeId}.webm    │
│                  │                                                  │
│             onUpload trigger                                        │
│                  │                                                  │
│  transcriptionTrigger Lambda                                        │
│  ├── Parses S3 key → extracts assessmentId, challengeId            │
│  ├── StartTranscriptionJob (Amazon Transcribe)                      │
│  │   └── Output: transcripts/{assessmentId}/{challengeId}.json     │
│  └── AppSync (IAM) → Assessment.update(transcriptionStatus=PROCESSING)│
│                  │                                                  │
│             (async 15s–3min)                                        │
│                  │                                                  │
│  Amazon Transcribe completes → emits EventBridge event              │
│                  │                                                  │
│  EventBridge Rule: "TranscribeJobStateChange: COMPLETED|FAILED"     │
│                  │                                                  │
│  transcriptionCompletion Lambda                                     │
│  ├── Reads transcript JSON from S3                                  │
│  ├── Extracts transcript text                                       │
│  └── AppSync (IAM) → Assessment.update(transcript, status=COMPLETED)│
│                  │                                                  │
│  AppSync subscription (existing observeQuery in hooks)              │
│                  │                                                  │
└──────────────────┼──────────────────────────────────────────────────┘
                   │  real-time push via AppSync subscription
                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Browser (Recruiter)                                                │
│                                                                     │
│  CandidateProfilePage                                               │
│  └── Assessment card for SHORT_ANSWER                               │
│      ├── transcriptionStatus = PROCESSING → "Transcribing..."      │
│      ├── transcriptionStatus = COMPLETED → transcript text          │
│      └── transcriptionStatus = ERROR → "Transcription failed"       │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Data Model Additions

### Assessment model extensions

```typescript
// amplify/data/resource.ts — Assessment model additions
recordingKey: a.string(),            // S3 key of audio file, e.g. "recordings/c1/a2/ch3.webm"
transcript: a.string(),              // Completed transcript text
transcriptionStatus: a.enum([
  'NONE',        // No recording; text-only answer
  'PROCESSING',  // Transcribe job running
  'COMPLETED',   // transcript field is populated
  'ERROR',       // Job failed; see transcriptionError
]),
transcriptionError: a.string(),      // Human-readable error, only set when status=ERROR
```

Authorization — no change from current Assessment auth:
- `allow.owner()` — recruiter can read everything
- `allow.publicApiKey().to(['create', 'read'])` — candidate can create, both can read

The `transcriptionCompletion` Lambda writes via IAM auth (automatically granted to Lambda execution roles in Amplify Gen 2).

---

## Sequence Diagrams

### Happy path — candidate records and submits

```
Candidate Browser                S3              transcriptionTrigger       Transcribe
     │                            │                     │                       │
     │── MediaRecorder.start() ──►│                     │                       │
     │   (record 0–5 min)         │                     │                       │
     │── MediaRecorder.stop() ──► │                     │                       │
     │── Storage.put(blob) ──────►│                     │                       │
     │                            │── ObjectCreated ───►│                       │
     │                            │                     │── StartTranscriptionJob►│
     │                            │                     │── Assessment.update  │ │
     │                            │                     │   (status=PROCESSING)│ │
     │◄── Assessment subscription─┤────────────────────────────────────────────┤ │
     │    (status → PROCESSING)   │                     │                       │
     │    shows "Transcribing..." │                     │               (15s–3min)
     │                            │                     │                       │
     │                            │                     │◄── JobStateChange COMPLETED
     │                            │                     │  (EventBridge)        │
     │                            │◄── GetObject ──────►│                       │
     │                            │    (transcript JSON) │                      │
     │                            │                     │── Assessment.update   │
     │                            │                     │   (transcript, COMPLETED)
     │◄── Assessment subscription─┤─────────────────────┘                       │
         (status → COMPLETED,     │
          transcript text shows)  │
```

### Error path — Transcribe job fails

```
transcriptionCompletion Lambda
  │
  │── detail.TranscriptionJobStatus = "FAILED"
  │── Assessment.update({
  │     transcriptionStatus: 'ERROR',
  │     transcriptionError: detail.FailureReason,
  │   })
  │
  └── Recruiter UI shows error badge on assessment card
```

---

## File Structure

```
amplify/
├── storage/
│   └── resource.ts                   ← New: pipeRecordings S3 bucket + trigger
├── functions/
│   ├── transcriptionTrigger/         ← New
│   │   ├── handler.ts
│   │   ├── types.ts
│   │   └── resource.ts
│   └── transcriptionCompletion/      ← New
│       ├── handler.ts
│       ├── types.ts
│       └── resource.ts
└── backend.ts                        ← Add storage, EventBridge rule

src/
├── components/
│   └── Shells/
│       └── RecordingShell.tsx        ← New: recording UI shell
└── lib/
    └── challenge/
        └── resolveShells.ts          ← Update: activate recording shell
```

---

## RecordingShell State Machine

```
         ┌──────────┐
         │   idle   │◄───────────────────────────────┐
         └────┬─────┘                                │
              │ onStartRecording                     │
              ▼                                      │
        ┌──────────┐                                 │
        │recording │                                 │
        └────┬─────┘                                 │
             │ onStopRecording                        │
             ▼                                       │
        ┌──────────┐                                 │
        │uploading │──── error ──► show retry ───────┤
        └────┬─────┘                                 │
             │ upload success                        │
             ▼                                       │
        ┌──────────────┐                             │
        │  submitted   │──── onRetry ────────────────┘
        │(transcribing)│
        └──────────────┘
```

States:
- **idle** — Default. "Start Recording" button visible. TextareaPanel available.
- **recording** — Red pulsing indicator. Timer. "Stop" button. No textarea (prevents distraction).
- **uploading** — Spinner. "Uploading..." label. Prevents re-recording.
- **submitted** — "Answer submitted. Transcription in progress..." message. Polling handled by AppSync subscription on the Assessment record.

Maximum recording time: 5 minutes (enforced by `maxDurationSec` prop, default 300). Auto-stops and auto-uploads at limit.

---

## AWS Cost Estimate

Amazon Transcribe pricing (Standard, us-east-1, as of 2026):
- $0.024 per minute of audio
- Free tier: 60 minutes/month for first 12 months

Estimate for a 50-candidate cohort, average 3 SHORT_ANSWER challenges per assessment, average 2 min audio each:
- 50 × 3 × 2 = 300 minutes
- 300 × $0.024 = **$7.20/cohort**

S3 storage: negligible at this scale (audio files deleted after 90 days).

---

## Security Notes

- Audio files stored at `recordings/{candidateId}/...` — candidates can only access their own path via `allow.entity('identity')` in the Storage access config
- Recruiters read via authenticated access to `recordings/*`
- Transcript JSON on S3 is only accessible to the `transcriptionCompletion` Lambda (not to candidate browsers)
- Final transcript text stored in `Assessment.transcript` is protected by the existing Assessment authorization rules
- No PII is logged by either Lambda (only assessmentId and challengeId)

---

## Open Questions (pre-implementation)

1. **Language detection:** Should we enable automatic language detection in Transcribe, or lock to `en-US`? Auto-detection costs an additional 10% per job. Post-MVP consideration.
2. **Custom vocabulary:** For technical interviews, Transcribe can be given a custom vocabulary (e.g. framework names). Worth doing post-sprint 2.
3. **Real-time transcript preview:** Transcribe Streaming would show the transcript as the candidate speaks. High complexity; consider if recruiter feedback demands it.
4. **Fallback UX:** If browser doesn't support `MediaRecorder` (old Safari), RecordingShell falls back to text-only silently. Log this for analytics.
