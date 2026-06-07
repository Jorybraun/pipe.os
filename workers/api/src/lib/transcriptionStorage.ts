/**
 * File-based transcription storage for phone calls.
 *
 * Stores human-readable transcriptions and metadata in R2 alongside audio recordings.
 * Complements the SQLite storage in phone_calls.transcription column.
 *
 * R2 path structure:
 *   call-recordings/{callId}/transcription.md  — Human-readable transcription
 *   call-recordings/{callId}/metadata.json      — Complete metadata snapshot
 */

export interface TranscriptionMetadata {
  callId: string;
  candidateId: string;
  pipelineId: string;
  ownerId: string;
  direction: string;
  fromNumber: string;
  toNumber: string;
  twilioCallSid?: string;
  durationSeconds?: number;
  recordingUrl?: string;
  recordingS3Key?: string;
  transcriptionStatus: string;
  transcriptionService?: string;
  transcriptionModel?: string;
  startedAt?: string;
  endedAt?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Format transcription as human-readable markdown.
 *
 * @param transcript - Raw transcription text
 * @param metadata - Call metadata
 * @returns Formatted markdown string
 */
export function formatTranscriptionMarkdown(
  transcript: string,
  metadata: TranscriptionMetadata,
): string {
  const lines: string[] = [];

  lines.push('# Phone Call Transcription');
  lines.push('');
  lines.push('## Call Details');
  lines.push('');
  lines.push(`- **Call ID**: ${metadata.callId}`);
  lines.push(`- **Direction**: ${metadata.direction}`);
  lines.push(`- **From**: ${metadata.fromNumber}`);
  lines.push(`- **To**: ${metadata.toNumber}`);
  if (metadata.twilioCallSid) {
    lines.push(`- **Twilio Call SID**: ${metadata.twilioCallSid}`);
  }
  if (metadata.durationSeconds) {
    lines.push(`- **Duration**: ${metadata.durationSeconds} seconds`);
  }
  if (metadata.startedAt) {
    lines.push(`- **Started**: ${metadata.startedAt}`);
  }
  if (metadata.endedAt) {
    lines.push(`- **Ended**: ${metadata.endedAt}`);
  }
  lines.push(`- **Status**: ${metadata.transcriptionStatus}`);
  if (metadata.transcriptionService) {
    lines.push(`- **Transcription Service**: ${metadata.transcriptionService}`);
  }
  if (metadata.transcriptionModel) {
    lines.push(`- **Transcription Model**: ${metadata.transcriptionModel}`);
  }
  lines.push('');
  lines.push('## Transcription');
  lines.push('');
  lines.push(transcript || '(No transcription available)');
  lines.push('');

  return lines.join('\n');
}

/**
 * Store transcription and metadata in R2.
 *
 * @param storage - R2 bucket binding
 * @param callId - Phone call ID
 * @param transcript - Raw transcription text
 * @param metadata - Complete call metadata
 * @throws Error if storage operations fail
 */
export async function storeTranscriptionFiles(
  storage: R2Bucket,
  callId: string,
  transcript: string,
  metadata: TranscriptionMetadata,
): Promise<void> {
  try {
    // Format and store transcription.md
    const markdown = formatTranscriptionMarkdown(transcript, metadata);
    const transcriptionKey = `call-recordings/${callId}/transcription.md`;
    await storage.put(transcriptionKey, markdown, {
      httpMetadata: { contentType: 'text/markdown' },
      customMetadata: { callId, type: 'transcription' },
    });

    // Store metadata.json
    const metadataKey = `call-recordings/${callId}/metadata.json`;
    await storage.put(metadataKey, JSON.stringify(metadata, null, 2), {
      httpMetadata: { contentType: 'application/json' },
      customMetadata: { callId, type: 'metadata' },
    });

    console.log(`[transcriptionStorage] Stored transcription files for call ${callId}`);
  } catch (error) {
    console.error(`[transcriptionStorage] Failed to store files for call ${callId}:`, error);
    throw error;
  }
}

/**
 * Retrieve transcription markdown from R2.
 *
 * @param storage - R2 bucket binding
 * @param callId - Phone call ID
 * @returns Transcription markdown string, or null if not found
 */
export async function getTranscriptionMarkdown(
  storage: R2Bucket,
  callId: string,
): Promise<string | null> {
  try {
    const key = `call-recordings/${callId}/transcription.md`;
    const object = await storage.get(key);

    if (!object) {
      return null;
    }

    const text = await object.text();
    return text;
  } catch (error) {
    console.error(`[transcriptionStorage] Failed to retrieve transcription for call ${callId}:`, error);
    return null;
  }
}

/**
 * Retrieve transcription metadata from R2.
 *
 * @param storage - R2 bucket binding
 * @param callId - Phone call ID
 * @returns Metadata object, or null if not found
 */
export async function getTranscriptionMetadata(
  storage: R2Bucket,
  callId: string,
): Promise<TranscriptionMetadata | null> {
  try {
    const key = `call-recordings/${callId}/metadata.json`;
    const object = await storage.get(key);

    if (!object) {
      return null;
    }

    const text = await object.text();
    return JSON.parse(text) as TranscriptionMetadata;
  } catch (error) {
    console.error(`[transcriptionStorage] Failed to retrieve metadata for call ${callId}:`, error);
    return null;
  }
}

/**
 * Check if transcription files exist in R2.
 *
 * @param storage - R2 bucket binding
 * @param callId - Phone call ID
 * @returns True if both transcription.md and metadata.json exist
 */
export async function transcriptionFilesExist(
  storage: R2Bucket,
  callId: string,
): Promise<boolean> {
  try {
    const transcriptionKey = `call-recordings/${callId}/transcription.md`;
    const metadataKey = `call-recordings/${callId}/metadata.json`;

    const [transcription, metadata] = await Promise.all([
      storage.head(transcriptionKey),
      storage.head(metadataKey),
    ]);

    return transcription !== null && metadata !== null;
  } catch (error) {
    console.error(`[transcriptionStorage] Failed to check files for call ${callId}:`, error);
    return false;
  }
}
