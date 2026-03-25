import { defineStorage } from "@aws-amplify/backend";

/**
 * Central asset store for the Pipe platform.
 *
 * Path conventions (wildcards must be the final path segment — Amplify constraint):
 *   candidate-documents/{candidateId}/{filename}   — CVs, attachments (recruiter upload)
 *   candidate-recordings/{candidateId}/{filename}  — Video/audio (Lambda pre-signed write)
 *   candidate-submissions/{candidateId}/{challengeId}.webm — Short-answer voice/video (Lambda presigned write)
 *   challenge-questions/{challengeId}/question.webm        — Recruiter question videos (recruiter upload; guest read)
 *
 * Candidates are NOT Cognito users and cannot authenticate directly.
 * All candidate-side uploads go through a Lambda that validates the
 * inviteToken and returns a pre-signed URL. See ADR-022.
 */
export const storage = defineStorage({
  name: "pipeAssets",
  access: (allow) => ({
    // Recruiter uploads CVs and attachments directly via Amplify Storage
    "candidate-documents/*": [
      allow.authenticated.to(["read", "write", "delete"]),
    ],
    // Recordings are written by Lambda (IAM); recruiters read only
    "candidate-recordings/*": [
      allow.authenticated.to(["read"]),
    ],
    // Short-answer voice/video submissions — Lambda writes via presigned URL (IAM);
    // recruiters read only. No candidate (guest) read access needed here.
    "candidate-submissions/*": [
      allow.authenticated.to(["read"]),
    ],
    // Recruiter question videos — recruiters write; candidates (unauthenticated) read.
    // Path uses challengeId UUID which is not guessable, reducing enumeration risk.
    "challenge-questions/*": [
      allow.authenticated.to(["read", "write", "delete"]),
      allow.guest.to(["read"]),
    ],
  }),
});
