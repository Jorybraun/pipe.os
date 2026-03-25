/**
 * generateMediaUploadUrl Lambda Types
 *
 * Generates a presigned S3 PUT URL for candidate media uploads.
 * Candidates are not Cognito users and cannot use Amplify Storage directly —
 * this Lambda validates the candidateId and returns a time-limited upload URL.
 */

export interface GenerateMediaUploadUrlArgs {
  /** Candidate's own ID — validated against DB before issuing URL */
  candidateId: string;
  /** The challenge this recording belongs to */
  challengeId: string;
  /** MIME type of the file being uploaded, e.g. "video/webm" or "audio/webm" */
  mimeType: string;
  /** 'video' | 'audio' */
  mediaType: string;
}

export interface GenerateMediaUploadUrlResult {
  /** Presigned PUT URL — valid for 5 minutes */
  uploadUrl: string;
  /** The S3 key the file will land at — store in submission + CandidateMedia */
  s3Key: string;
}
