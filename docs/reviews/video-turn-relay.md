# Code Review — fix-turn-relay-via-offer

**Date:** 2026-02-28
**Author:** Gemini CLI
**Reviewer:** [Pending]

## Description
This PR fixes the video call failure for candidates by relaying TURN credentials through the OFFER signaling payload. This eliminates the need for unauthenticated candidates to call the `getTurnCredentials` Lambda directly, which was causing authentication failures and exposing a potential abuse vector.

## Changeset

### 🔒 Security & Schema
- **`amplify/data/resource.ts`**: Removed `allow.publicApiKey()` from `getTurnCredentials`. Now only recruiters (authenticated via Cognito User Pool) can fetch relay credentials.

### 📡 Signaling & Types
- **`src/lib/video/types.ts`**: Added `iceServers` to `SdpPayload` to carry credentials in the OFFER.
- **`src/hooks/useVideoSession.ts`**:
    - `startCall()`: Fetches credentials and embeds them in the OFFER.
    - `acceptCall()`: Extracts credentials from the OFFER and uses them for the peer connection.
    - `initPeerConnection()`: Supports optional credential override.

### 🛠️ Client Configuration
- **`src/lib/video/webrtcConfig.ts`**: 
    - Forced `userPool` auth for `getTurnCredentials` to avoid misleading "no federated JWT" console warnings.
    - Switched to typed query `client.queries.getTurnCredentials()`.

## Validation Plan
1. [x] **Type Check**: `npx tsc --noEmit` passes.
2. [ ] **Sandbox Deploy**: Run `npx ampx sandbox` to verify schema changes deploy without error.
3. [ ] **Manual E2E**: Start a call as a recruiter, verify candidate receives `iceServers` in the OFFER signal and successfully joins the call.

## Security Audit
- **Exposure**: TURN credentials (username/password) are relayed via AppSync. Since AppSync signals are already encrypted and scoped to the session (recruiter/candidate only), this is acceptable.
- **Abuse**: The `getTurnCredentials` Lambda is now restricted to authenticated recruiters only.
