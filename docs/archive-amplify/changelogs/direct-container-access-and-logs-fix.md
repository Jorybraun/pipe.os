# Direct Container Access & CloudWatch Logs Fix

**Date**: 2026-03-08  
**Status**: 🟢 DONE  
**Branch**: `copilot/replace-polling-with-appsync`

## Description

This update resolves two critical blockers for dev container usability: (1) code-server's lack of `--base-path` support which broke ALB sub-path routing, and (2) CloudWatch log fetching failures caused by IAM resource pattern mismatches.

## Changes

### 1. Direct Public IP Access (Bypassing ALB)
- **Problem**: code-server 4.22.1 crashes with `Unknown option --base-path`. Without this flag, it cannot serve assets correctly at `/session/{id}/`.
- **Solution**: Reverted from ALB path-based routing to direct container access via public IP for the prototype phase.
- **Implementation**:
    - `ecsStatusBridge`: Added `getPublicIp()` helper that extracts the ENI ID from the ECS event and calls `ec2:DescribeNetworkInterfaces` to retrieve the public IPv4 address.
    - Added fallback to `ecs:DescribeTasks` in `ecsStatusBridge` because EventBridge `RUNNING` events often omit attachment details.
    - Updated URL construction to `http://{publicIp}:8080/`.
    - Added `ec2:DescribeNetworkInterfaces` to `ecsStatusBridge` IAM policy in `backend.ts`.
    - Opened port 8080 in `infra/networking.tf` from `0.0.0.0/0`.

### 2. Reliable Container Log Fetching
- **Problem**: `FilterLogEventsCommand` was returning 0 results. This was due to an IAM policy resource pattern mismatch (`log-group:...:*` is treated as a log-stream ARN, while `FilterLogEvents` requires a log-group ARN).
- **Solution**: Switched to `GetLogEventsCommand` for exact log stream targeting.
- **Implementation**:
    - Updated `getContainerLogs` handler to construct the exact log stream name: `code-server/code-server/{taskId}`.
    - Used `GetLogEventsCommand` with `startFromHead: true`.
    - Corrected IAM permissions in `backend.ts` to include `logs:GetLogEvents` on both the log-group ARN (no trailing `:*`) and the log-stream wildcard ARN.

### 3. devContainerStatus Improvements
- **Change**: Updated DynamoDB table lookup to use SSM Parameter Store for the table name, avoiding hardcoded table name dependencies in the handler.
- **Implementation**: Added `DEVCONTAINERSESSION_TABLE_SSM` env var and `ssm:GetParameter` permission.

### 4. Infrastructure Cleanup (Terraform)
- **Change**: Fixed EventBridge Lambda target ARNs in `infra/eventbridge.tf` to match the current Amplify sandbox naming convention.
- **Change**: Added `infra/lambda-permissions.tf` for explicit EventBridge invocation permissions.

## Validation

- ✅ `ecsStatusBridge` successfully extracts public IP and updates AppSync.
- ✅ Dev container iframe renders correctly via direct public IP.
- ✅ Logs panel successfully fetches and displays code-server startup logs.
- ✅ Type check `npx tsc --noEmit` passes.

## Files Modified

- `amplify/backend.ts` — Added EC2/Logs IAM permissions.
- `amplify/data/resource.ts` — Added `getContainerLogs` query.
- `amplify/functions/ecsStatusBridge/handler.ts` — Implemented public IP lookup logic.
- `amplify/functions/getContainerLogs/handler.ts` — Switched to `GetLogEvents`.
- `infra/eventbridge.tf` — Corrected Lambda target ARNs.
- `src/hooks/useDevContainerSession.ts` — Added logging for debugging URL updates.
- `src/pages/DevContainerSandboxPage.tsx` — Added logging for log fetch lifecycle.
