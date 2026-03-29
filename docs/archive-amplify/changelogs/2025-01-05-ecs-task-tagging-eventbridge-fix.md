# ECS Task Tagging & EventBridge Integration Fix

**Date**: 2025-01-05  
**Commit**: c2ca8a1  
**Branch**: copilot/replace-polling-with-appsync

## Problem

Dev containers stopped working after switching to HTTP. Investigation revealed the root cause was missing ECS task tags, not the HTTP vs HTTPS change. The `ecsStatusBridge` Lambda skips tasks without the `pipe:session` tag, preventing ALB registration.

## Root Cause

The `devContainerLaunch` Lambda was creating ECS tasks without enabling managed tags or tag propagation. Without the `pipe:session` tag, `ecsStatusBridge` couldn't identify which session the task belonged to and skipped processing it (line 348 in handler).

## Solution

### 1. ECS Task Tagging Fix
**File**: `amplify/functions/devContainerLaunch/handler.ts`

Added two properties to the `RunTaskCommand`:
- `enableECSManagedTags: true` - Enables ECS-managed tags on tasks
- `propagateTags: 'TASK_DEFINITION'` - Propagates tags from task definition to tasks

This ensures the `pipe:session` tag is applied to every launched task.

### 2. EventBridge Integration
**File**: `infra/eventbridge.tf` (new)

Created Terraform configuration for EventBridge rule that wasn't being deployed by Amplify:
- EventBridge rule to capture ECS Task State Change events
- Lambda permission for EventBridge to invoke `ecsStatusBridge`
- Event target pointing to the Amplify-managed Lambda

**Why Terraform?** Amplify sandboxes don't deploy CDK constructs defined in `backend.ts` outside the main stack.

### 3. Container Logs Lambda
**Files**: 
- `amplify/functions/getContainerLogs/handler.ts` (new)
- `amplify/functions/getContainerLogs/resource.ts` (new)

Added Lambda to fetch CloudWatch logs for debugging. Returns logs as JSON string to match AWSJSON scalar type requirements.

### 4. Security Documentation
**File**: `docs/decisions/ADR-018-dev-container-access-control.md` (new)

Documented multi-layer access control strategy:
- Signed JWT tokens in URL query params (60-min TTL)
- AWS WAF rules for Referer validation
- Lambda@Edge for token validation
- Disabled code-server authentication

## Validation

Used AWS MCP server to validate the fix:
- ✅ ECS task `3eb0aea76eff473dab9d245295e41355` running with `pipe:session` tag
- ✅ CloudWatch logs show code-server listening on port 8080
- ✅ ALB target group `pipe-s-863b5aadf57e4370b5a8cfc7c` created
- ✅ Container accessible via ALB (returns 401 from code-server auth)

## Key Insights

1. **Tag propagation is critical**: Without `pipe:session` tags, the entire ALB registration pipeline fails silently
2. **EventBridge rules need Terraform**: Amplify doesn't deploy CDK EventBridge constructs in sandboxes
3. **AWSJSON requires strings**: Lambda resolvers must return `JSON.stringify()` for AWSJSON scalar types
4. **AppSync subscriptions don't replay**: Frontend subscription wasn't receiving updates, causing URL to show as undefined despite backend success

## Files Changed

- `amplify/functions/devContainerLaunch/handler.ts` - Added ECS managed tags
- `amplify/functions/getContainerLogs/handler.ts` - New Lambda for logs
- `amplify/functions/getContainerLogs/resource.ts` - Lambda resource definition
- `infra/eventbridge.tf` - EventBridge rule configuration
- `docs/decisions/ADR-018-dev-container-access-control.md` - Security ADR
- `CHANGELOG.md` - Updated with changes

## Next Steps

1. Deploy EventBridge rule: `cd infra && terraform apply`
2. Test container launch end-to-end
3. Implement ADR-018 access control strategy
4. Debug frontend AppSync subscription issue
