# Commit video-turn-relay — Secure TURN Relay Integration

**Date:** 2026-02-28
**Review Status:** 🟡 PENDING
**Reviewed By:** (human user)

## Summary
Refactored the WebRTC TURN integration to a secure backend-oriented architecture. Replaced the insecure client-side Metered.ca API call with an Amplify Lambda function that handles sensitive credentials.

## Related Tasks
- [Security] Protect Metered.ca API Secret Key

## Modified Files

### 🏗️ Backend & Infrastructure
- `amplify/functions/turnCredentialsAgent/resource.ts` & `handler.ts` (New)
  - Fetches temporary TURN credentials from Metered.ca using the secret `METERED_API_KEY`.
- `amplify/data/resource.ts`
  - Added `getTurnCredentials` query with `authenticated` and `publicApiKey` authorization.
- `amplify/backend.ts`
  - Registered `turnCredentialsAgent`.

### 🧩 Core Components
- `src/lib/video/webrtcConfig.ts`
  - Refactored `getIceServers()` to use the new AppSync query.
  - Removed direct `fetch` to Metered.ca and usage of `VITE_METERED_API_KEY`.

## Verification Checklist
- [x] `npx tsc --noEmit` passed.
- [x] Verified that no sensitive keys remain in the frontend source code.

## Action Required
- **Deployment**: The `METERED_API_KEY` must be added to the Amplify Console environment variables before the next deployment.
