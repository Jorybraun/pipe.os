/**
 * Custom GraphQL subscription queries for dev container real-time status updates.
 *
 * These queries are used by useDevContainerSession to subscribe to
 * container lifecycle events pushed by the ecsStatusBridge Lambda.
 */

export const onContainerStatusChangedQuery = /* GraphQL */ `
  subscription OnContainerStatusChanged($sessionId: String!) {
    onContainerStatusChanged(sessionId: $sessionId) {
      taskArn
      sessionId
      status
      url
      updatedAt
    }
  }
`;
