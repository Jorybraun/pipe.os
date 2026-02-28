# Fix TypeScript validation error in turnCredentialsAgent

## Overview

A TypeScript validation error was occurring in the `amplify/functions/turnCredentialsAgent/resource.ts` file. This was due to the incorrect usage of `process.env.METERED_API_KEY` when defining the secret.

## Problem

The `process.env.METERED_API_KEY` was causing a TypeScript validation error, preventing successful builds and deployments.

## Solution

The issue was resolved by replacing `process.env.METERED_API_KEY` with `secret('METERED_API_KEY')`. This aligns with the expected method for accessing secrets within the AWS Amplify Gen 2 environment.

## Verification

The fix was verified by running `npx tsc --noEmit` to ensure that no TypeScript errors were present after the change.

## Files Affected

- `amplify/functions/turnCredentialsAgent/resource.ts`

## Commit Hash

[PLACEHOLDER_COMMIT_ID]
