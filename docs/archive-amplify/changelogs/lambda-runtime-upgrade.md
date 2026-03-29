# Commit lambda-runtime-upgrade — Upgrade Lambda Functions to Node.js 22

**Date:** 2026-02-28
**Review Status:** 🟡 PENDING
**Reviewed By:** (human user)

## Summary
Upgraded all AWS Lambda functions and core backend dependencies to Node.js 22 to align with AWS support timelines and Node.js 20 EOL.

## Related Tasks
- [Maintenance] Upgrade Lambda runtime to Node.js 22

## Modified Files

### 🏗️ Backend & Infrastructure
- `amplify/functions/jobDescriptionAgent/resource.ts`
  - **Change**: `runtime: 20` → `runtime: 22`
- `amplify/functions/questionAgent/resource.ts`
  - **Change**: `runtime: 20` → `runtime: 22`
- `amplify/functions/scoringAgent/resource.ts`
  - **Change**: `runtime: 20` → `runtime: 22`

### 📦 Dependencies
- `package.json` & `package-lock.json`
  - **Upgraded**: `@aws-amplify/backend` from `^1.5.0` to `^1.21.0`
  - **Upgraded**: `@aws-amplify/backend-cli` from `^1.2.9` to `^1.8.2`
  - **Rationale**: Required for the `NodeVersion` type in Amplify Gen 2 to include `22`.

## Verification Checklist
- [x] `npx tsc --noEmit` passed.
- [x] Verified that Amplify Gen 2 backend definitions accept `runtime: 22` with the updated dependencies.

## Action Required
- **Deployment**: Production environment must be redeployed with these changes before April 30, 2026 (Node.js 20 EOL).
