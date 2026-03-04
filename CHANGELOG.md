# Changelog — Commitment History

All notable changes are indexed here. Detailed file diffs and summaries live in `/docs/changelogs/`.

---

### [Unreleased]

#### Added
- **Roles & RoleCard UI Redesign**: Overhauled the main Roles listing and RoleCard components with a modern, horizontal brutalist aesthetic.
- **AppSync Real-time Status**: Replaced container status polling with real-time push notifications via AppSync subscriptions for Dev Containers.

---

### `replace-polling-with-appsync` — Replace Container Status Polling with AppSync Subscriptions
- **Status**: 🟢 DONE
- **Changes**:
    - Replaced ECS container status polling with real-time push notifications using `DevContainerSession.onUpdate()`.
    - **`ecsStatusBridge` Lambda**: New bridge that routes EventBridge ECS Task State Change events to AppSync mutations.
    - **SSM Configuration**: Used SSM Parameter Store to break circular CDK dependencies between DynamoDB tables and Lambda handlers.
    - **Notification Engine**: Integrated DynamoDB Streams with a new `notificationStreamService` to decouple background processing from handlers.
    - **UI Enhancements**: Added brutalist/glassmorphic navigation for Roles and Sandbox; integrated `useDevContainerSession` hook with real-time status updates.
