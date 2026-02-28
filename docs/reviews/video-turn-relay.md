# Code Review Request: video-turn-relay

**Commit ID:** video-turn-relay
**Date:** 2026-02-28
**Author:** Gemini CLI Agent / Devin Subagent
**Changelog:** [docs/changelogs/video-turn-relay.md](../changelogs/video-turn-relay.md)

## Summary
Secured the WebRTC TURN integration by moving sensitive API calls to a backend-only Lambda function.

## Key Changes for Review

### 1. Secure Credential Retrieval
**File:** `amplify/functions/turnCredentialsAgent/handler.ts`

**Change:** New Lambda handler that fetches credentials from Metered.ca using `process.env.METERED_API_KEY`.

**Rationale:** Original implementation exposed the secret key in the frontend. This refactor ensures the key stays in the secure backend environment.

### 2. AppSync Integration
**File:** `amplify/data/resource.ts`

**Change:** Added `getTurnCredentials` query with `authenticated` and `publicApiKey` authorization.

**Rationale:** Both recruiters and candidates need TURN credentials to establish a peer-to-peer connection.

### 3. Frontend Refactor
**File:** `src/lib/video/webrtcConfig.ts`

**Change:** Refactored `getIceServers()` to use the new AppSync query.

**Rationale:** Aligns with the new secure architecture.

## Security Review
- ✅ **No Secret Leaks:** The `METERED_API_KEY` is only used in the Lambda environment.
- ✅ **Authorization:** `getTurnCredentials` is properly authorized for both user types.

## Testing Plan
**Before Deployment:**
- [ ] Run `npx ampx sandbox` to verify backend definition validity.

**Manual Testing:**
1. **TURN Credentials:**
   - Trigger the `getTurnCredentials` query in the sandbox.
   - Verify it returns valid ICE servers from Metered.ca.

## Requested Reviewer: Hans
Please verify the security model and the AppSync authorization.
