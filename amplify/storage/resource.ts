import { defineStorage } from "@aws-amplify/backend";

/**
 * Central asset store for the Pipe platform.
 *
 * Path conventions (wildcards must be the final path segment — Amplify constraint):
 *   candidate-documents/{candidateId}/{filename}   — CVs, attachments (recruiter upload)
 *   candidate-recordings/{candidateId}/{filename}  — Video/audio (Lambda pre-signed write)
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
  }),
});
