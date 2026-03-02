# Code Review Request — Scheduling OAuth Implementation

## Overview
This PR implements the core OAuth handshake for third-party scheduling providers. It specifically addresses the PKCE requirement for Calendly and a common synchronization bug in Amplify AppSync when mixing UserPool and IAM authorization.

## Review Items

### 1. Web Crypto PKCE (Frontend)
**File**: `src/components/Scheduling/ConnectionSetup.tsx`
- We use `window.crypto.subtle.digest` for S256 hashing.
- **Question**: Is the session storage persistence of the `code_verifier` sufficiently secure for this flow?
- **Logic**: 
  ```typescript
  const verifierArray = crypto.getRandomValues(new Uint8Array(32));
  const verifier = Array.from(verifierArray).map(b => b.toString(16).padStart(2, '0')).join('');
  sessionStorage.setItem('pipe_oauth_code_verifier', verifier);
  ```

### 2. Manual State Sync (Frontend)
**File**: `src/hooks/useSchedulingConnection.ts`
- `observeQuery` (UserPool) doesn't see records created by Lambda (IAM).
- **Solution**: The `exchangeOAuth` mutation now returns the created connection data, which is used to manually set the local state.
- **Review**: Does this manually set state conflict with any potential future `observeQuery` updates?

### 3. OAuth 2.1 Exchange (Lambda)
**File**: `amplify/functions/schedulingOAuth/handler.ts`
- The `fetch` call now optionally includes `code_verifier`.
- Trimming of environment variables: `(process.env['...'] ?? '').trim()`.
- **Review**: Is the error surfacing `errorBody.slice(0, 300)` too much data for the client response?

## Validation Status
- [x] TypeScript validation (`npx tsc --noEmit`)
- [x] Manual testing of Calendly auth redirect
- [x] Manual testing of exchange success path
- [x] Manual testing of disconnect success path
