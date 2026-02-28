# Code Review Request: lambda-runtime-upgrade

**Commit ID:** lambda-runtime-upgrade
**Date:** 2026-02-28
**Author:** Gemini CLI Agent
**Changelog:** [docs/changelogs/lambda-runtime-upgrade.md](../changelogs/lambda-runtime-upgrade.md)

## Summary
Upgraded all AWS Lambda functions and core backend dependencies to Node.js 22 to align with AWS support timelines and Node.js 20 EOL.

## Key Changes for Review

### 1. Lambda Runtime Update
**Files:** 
- `amplify/functions/jobDescriptionAgent/resource.ts`
- `amplify/functions/questionAgent/resource.ts`
- `amplify/functions/scoringAgent/resource.ts`

**Change:** Updated `runtime` from `20` to `22`.

**Rationale:** Node.js 20 is approaching EOL, and Node.js 22 is the current recommended LTS version for Lambda.

### 2. Dependency Upgrade
**Files:** `package.json`, `package-lock.json`

**Change:** Upgraded `@aws-amplify/backend` and `@aws-amplify/backend-cli`.

**Rationale:** The updated versions are required to support the `22` value in the `NodeVersion` type for Amplify Gen 2.

## Type Safety Review
- ✅ All changes pass `npx tsc --noEmit`.

## Testing Plan
**Before Deployment:**
- [ ] Run `npx ampx sandbox` to verify backend definition validity.

**Manual Testing:**
1. **Lambda Execution:**
   - Trigger each agent (Job Description, Question, Scoring) in the sandbox environment.
   - Verify they execute without runtime errors.

## Requested Reviewer: Hans
Please verify the runtime version choice and the dependency upgrade.
