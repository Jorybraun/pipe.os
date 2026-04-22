# ADR-022: Candidate Media Storage Domain

**Date:** 2026-03-25
**Status:** Accepted
**Deciders:** Hans (solo founder)

---

## Context

Candidates on the Pipe platform will accumulate multiple types of binary assets over the course of an interview pipeline:
- CVs / resumes (already partially implemented)
- Video recordings from live or async video stages
- Audio recordings from voice interview stages
- Code submissions and attachments (future)

The original storage design (`candidateResumes` bucket, `resumes/{candidateId}/{filename}`) was narrow — designed only for CV upload. It also stored a single `resumeS3Key` string on the `Candidate` model, which cannot represent multiple assets of different types.

Additionally, candidates are **not Cognito users**. They authenticate via an `inviteToken` and a public API key. This means candidates cannot use `allow.authenticated` Amplify Storage rules — all candidate-side uploads must go through a Lambda that validates the token and returns a pre-signed S3 URL.

---

## Decision

Replace the single `resumeS3Key` string on `Candidate` with a separate **`CandidateMedia` model** that tracks each S3 asset as its own record. Rename the storage bucket from `candidateResumes` to `pipeAssets` and restructure S3 paths under a `candidates/{candidateId}/` namespace.

---

## Alternatives Considered

### Option A — Flat fields on Candidate
Add `videoRecordingKeys: string[]`, `audioRecordingKeys: string[]`, etc. directly to the `Candidate` model.

- **Pros:** Simple, no extra model
- **Cons:** Cannot query "all recordings for stage X"; adding a new asset type requires schema migration; no place to store per-asset metadata (mimeType, filename, uploadedAt); arrays are unordered

### Option B — CandidateMedia model (chosen)
Separate `CandidateMedia` table with `type`, `s3Key`, `filename`, `mimeType`, `stageId`.

- **Pros:** Queryable (by type, by stage); each asset has its own metadata; adding new asset types is additive; recruiter UI can list assets cleanly; DynamoDB-native (no array anti-patterns)
- **Cons:** Extra model, extra round-trip to create record after upload

### Option C — Single JSON blob on Candidate
`mediaAssets: json` containing an array of asset descriptors.

- **Pros:** No schema change
- **Cons:** Not queryable; requires full candidate read to inspect assets; race conditions on concurrent writes; DynamoDB JSON arrays are an anti-pattern for append operations

---

## Rationale

Option B wins because:
1. Per-stage recording queries are a first-class recruiter need ("show recordings for the video interview stage")
2. DynamoDB handles relational fan-out better than arrays
3. Adding new asset types (e.g. `SCREEN_RECORDING`, `CODE_SNAPSHOT`) requires no schema migration
4. Each asset having its own record makes deletion, pre-signed URL generation, and UI listing straightforward

---

## Consequences

### Positive
- Clean recruiter UI: list all assets for a candidate, filter by type or stage
- Pre-signed URL generation scope: Lambda validates inviteToken, creates CandidateMedia record, returns URL — single atomic operation
- `resumeS3Key` on `Candidate` is deprecated (kept for backward compat) and can be removed once all read paths migrate to `CandidateMedia`

### Negative / Trade-offs
- One extra DynamoDB write per upload (acceptable)
- Existing `resumeS3Key` values on old `Candidate` records are orphaned — they won't have corresponding `CandidateMedia` rows (only matters for test data; production data was clean)

### Risks
- Lambda pre-signed URL flow for candidate-side uploads (recordings) is not yet implemented — `candidates/*/recordings/*` storage path is defined but unused until that Lambda is built

---

## S3 Path Conventions

Amplify Storage requires wildcards to be the **final path segment only** — nested wildcards like
`candidates/*/documents/*` are rejected at CDK synthesis time. Paths use flat prefixes instead:

```
candidate-documents/{candidateId}/{filename}           RESUME, ATTACHMENT
candidate-recordings/{candidateId}/{stageId}.webm      VIDEO_RECORDING, AUDIO_RECORDING
```

## Follow-up

- Build `generateUploadUrl` Lambda: validates inviteToken → returns pre-signed S3 PUT URL → caller creates `CandidateMedia` record on success
- Migrate recruiter CV download links from `resumeS3Key` → `CandidateMedia` query
- Add `CandidateMedia` list to `CandidateProfilePage` recruiter view
