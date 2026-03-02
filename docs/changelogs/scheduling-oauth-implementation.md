# Changelog — Scheduling OAuth Implementation

## Summary
Implemented the full OAuth 2.1 exchange flow with PKCE support for third-party scheduling providers (starting with Calendly and Cal.com). Resolved critical synchronization issues between IAM-authorized backend updates and UserPool-authorized frontend subscriptions.

## Changes

### 🛠️ Backend (Amplify Functions)
- **`amplify/functions/schedulingOAuth`**:
    - Upgraded token exchange to support **PKCE (Proof Key for Code Exchange)**.
    - Added `code_verifier` handling for Calendly compatibility.
    - Implemented secret value trimming to prevent whitespace-related authentication failures.
    - Improved error reporting by surfacing provider-specific error bodies in the Lambda response.
    - Set `resourceGroupName: 'data'` to ensure proper deployment grouping.

### 💻 Frontend (React)
- **`src/components/Scheduling/ConnectionSetup.tsx`**:
    - Integrated PKCE challenge generation (S256) using Web Crypto API.
    - Added session-storage persistence for the `code_verifier` across the OAuth redirect.
    - Updated `exchangeOAuth` call to pass the verifier back to the Lambda.
- **`src/hooks/useSchedulingConnection.ts`**:
    - **Critical Fix**: Implemented manual state synchronization. Since connections are created/updated in the Lambda via IAM auth, the AppSync `observeQuery` (which uses UserPool auth) was not receiving real-time events for these server-side changes.
    - Updated `exchangeOAuth` and `disconnect` to return the updated record data directly and update the local `connection` state immediately.
- **`src/components/Scheduling/provider/CalendlyProvider.tsx`**:
    - Updated `getAuthUrl` to accept and include `code_challenge` and `code_challenge_method=S256`.
- **`src/lib/scheduling/pluginRegistry.ts`**:
    - Updated `SchedulingPlugin` interface to support optional PKCE parameters.

### 🧩 Infrastructure & Schema
- **`amplify/functions/schedulingWebhook`**:
    - Set `resourceGroupName: 'data'` for consistency.
- **`src/App.tsx`**:
    - Cleaned up unused `ProfileHeader` import to resolve `tsc` validation errors.

## Verification Results

### ✅ Automated Tests
- `npx tsc --noEmit`: **PASSED**
- Lambda local test (mock exchange): **PASSED**

### ✅ Manual Verification
- Calendly OAuth flow: Redirects → Authorizes → Exchanges → UI updates to CONNECTED.
- Token exchange error handling: Surfaced "Invalid client" error when secrets were missing.
- Disconnect flow: Local state clears immediately; record updated in DynamoDB.
