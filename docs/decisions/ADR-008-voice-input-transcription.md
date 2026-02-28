# ADR-008: Voice Input & Transcription Architecture

## Status
Proposed

## Context
The Pipe platform aims to enhance candidate experience and recruiter insights by allowing verbal responses to Short Answer challenges. This requires a robust system for recording, storing, and transcribing audio data within the AWS Amplify Gen 2 ecosystem.

## Decision
We will implement an event-driven transcription pipeline using Amazon Transcribe and AWS Amplify Gen 2 storage triggers.

### 1. Audio Recording (Frontend)
- **Component:** A reusable `RecordingShell` component using the browser's `MediaRecorder` API.
- **Format:** Default to `audio/webm` (supported by Chrome/Firefox) or `audio/mp4` (Safari) with a fallback.
- **Upload:** Direct upload to S3 via `@aws-amplify/storage` using the `private` access level.

### 2. Storage & Trigger (Backend)
- **Storage:** Use `defineStorage` in `amplify/storage/resource.ts`.
- **Trigger:** Attach an `onUpload` trigger to the storage resource using `defineFunction`.
- **Pathing:** Files will be stored at `protected/recordings/{candidateId}/{assessmentId}/{challengeId}.webm`.

### 3. Transcription Pipeline
- **Service:** **Amazon Transcribe** (Batch mode for v1).
- **Orchestration:**
    1. `onUpload` Lambda receives the S3 event.
    2. Lambda initiates a `StartTranscriptionJob` with Amazon Transcribe.
    3. The job will output to a specific "transcripts" prefix in the same bucket.
- **Completion Tracking:**
    - Use an **Amazon EventBridge** rule to detect `Transcribe Job State Change` (to `COMPLETED`).
    - This rule triggers a `transcriptionCompletionHandler` Lambda.
    - This Lambda reads the transcript JSON from S3 and updates the corresponding DynamoDB record in the `Assessment` model.

### 4. Data Retention
- Audio files will have an S3 Lifecycle policy to move to Glacier after 30 days and delete after 90 days (configurable by recruiter/organization).
- Text transcripts will be persisted in DynamoDB as part of the assessment record for permanent (or long-term) access.

## Rationale
- **Amplify-Native:** Leveraging `defineStorage` triggers aligns with the project's engineering standards.
- **Scalability:** Event-driven architecture ensures we can handle thousands of concurrent assessments without bottlenecks.
- **Accuracy:** Amazon Transcribe provides industry-standard accuracy and supports multi-language detection, which is critical for a global platform.
- **Separation of Concerns:** Using EventBridge for completion tracking keeps the initial upload Lambda lightweight and cost-effective.

## Consequences
- **Latency:** Transcription is asynchronous. Recruiters may see a "Transcribing..." status for a few seconds/minutes after a candidate finishes.
- **Cost:** Amazon Transcribe has a cost per second of audio. We should monitor this and potentially implement usage limits per assessment.
- **Complexity:** Requires setting up EventBridge rules within the Amplify backend (using `backend.ts` for custom resources).

## Alternatives Considered
- **Whisper on Lambda:** Higher accuracy but significantly more complex to deploy and maintain (requires large Lambda layers or SageMaker).
- **Client-side Transcription:** Lower cost but poor accuracy, lack of control, and high CPU usage on candidate devices (especially mobile).
