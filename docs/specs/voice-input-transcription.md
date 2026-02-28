# Technical Specification: Voice Input & Transcription

## 1. Overview
This specification details the implementation of voice-to-text transcription for Short Answer challenges on the Pipe platform. It follows the architectural decisions outlined in **ADR-008**.

## 2. Data Schema Updates (`amplify/data/resource.ts`)

### 2.1. `Assessment` Model Enhancement
We will add fields to the `Assessment` model to track audio and transcription data.

```typescript
Assessment: a.model({
  // ... existing fields ...
  audioS3Key: a.string(),        // Key for the audio file in S3
  transcript: a.string(),        // The transcribed text
  transcriptionStatus: a.enum([
    'PENDING', 
    'PROCESSING', 
    'COMPLETED', 
    'FAILED'
  ]),
  transcriptionError: a.string(),
}).authorization((allow) => [
  allow.owner(),
  allow.publicApiKey().to(['create', 'read', 'update']), // Candidates can update their recording key
]),
```

## 3. Storage Configuration (`amplify/storage/resource.ts`)

### 3.1. Permissions
The storage bucket must allow candidates to upload and recruiters to read audio files.

```typescript
export const storage = defineStorage({
  name: 'pipeMedia',
  access: (allow) => ({
    'protected/recordings/*': [
      allow.authenticated.to(['read', 'write']),
      allow.guest.to(['read', 'write']) // For candidate-facing token-based access
    ]
  }),
  triggers: {
    onUpload: defineFunction({
      entry: '../functions/transcriptionAgent/handler.ts'
    })
  }
});
```

## 4. Lambda Functions

### 4.1. `transcriptionAgent` (S3 Trigger)
- **Runtime:** Node.js 20.x
- **Responsibilities:**
  - Receive S3 `ObjectCreated` event.
  - Extract `candidateId` and `assessmentId` from the key path.
  - Call `transcribeClient.startTranscriptionJob()`.
  - Update `Assessment` model status to `PROCESSING` via AppSync GraphQL.
- **IAM Policy:**
  - `s3:GetObject` on the source bucket.
  - `transcribe:StartTranscriptionJob`.

### 4.2. `transcriptionCompletionHandler` (EventBridge Trigger)
- **Runtime:** Node.js 20.x
- **Responsibilities:**
  - Triggered by EventBridge: `aws.transcribe` with `TranscriptionJobStatus` == `COMPLETED`.
  - Fetch the transcript JSON from S3.
  - Extract the `transcript` text from the JSON.
  - Update the `Assessment` record in DynamoDB with the text and status `COMPLETED`.
- **IAM Policy:**
  - `s3:GetObject` on the transcript output bucket.
  - `appsync:GraphQL` permissions to update the Assessment.

## 5. Frontend Components (`src/components/Assessment/`)

### 5.1. `RecordingShell` Component
- **Props:**
  ```typescript
  interface RecordingShellProps {
    onUploadComplete: (s3Key: string) => void;
    maxDurationSeconds?: number;
    challengeId: string;
  }
  ```
- **States:** `IDLE`, `RECORDING`, `PLAYBACK`, `UPLOADING`, `ERROR`.
- **MediaRecorder Config:**
  - High-quality audio (128kbps).
  - WebM (Opus) format with MP4 fallback.

### 5.2. Integration into `ShortAnswerChallenge`
- Provide a toggle for the candidate: "Type Answer" or "Record Answer".
- If "Record Answer", show `RecordingShell`.
- Once uploaded, display a "Transcribing..." indicator.

## 6. Implementation Milestones (Devin)
1. **Schema & Storage:** Deploy updated models and S3 trigger.
2. **Recording Shell:** Build the UI component and verify S3 upload.
3. **Transcription Agent:** Implement the Lambda to kick off jobs.
4. **Completion Logic:** Setup EventBridge rule and update GraphQL.
5. **Recruiter UI:** Show the transcript on the `CandidateProfilePage`.

## 7. Quality Gates (Quinn)
- [ ] Recording works on mobile (iOS/Android).
- [ ] Transcribe successfully handles 2-minute audio responses.
- [ ] Recruiter can search for keywords within the generated transcript.
- [ ] PII redaction (optional v1.1) is functional if enabled.
