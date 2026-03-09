import { CloudWatchLogsClient, GetLogEventsCommand } from '@aws-sdk/client-cloudwatch-logs';

const logs = new CloudWatchLogsClient({ region: process.env.AWS_REGION ?? 'us-west-2' });

// Log group and stream prefix determined by ECS awslogs driver config on pipe-code-server task definition.
// Stream format: {awslogs-stream-prefix}/{container-name}/{task-id}
// = code-server/code-server/{task-id}
const LOG_GROUP_NAME = '/pipe/dev-containers/code-server';
const LOG_STREAM_PREFIX = 'code-server/code-server';

interface GetContainerLogsRequest {
  arguments: {
    taskArn: string;
    limit?: number;
  };
}

export async function handler(event: GetContainerLogsRequest): Promise<string> {
  const { taskArn, limit = 50 } = event.arguments;

  // Extract task ID from ECS task ARN.
  // ARN format: arn:aws:ecs:{region}:{account}:task/{cluster}/{taskId}
  const taskId = taskArn.split('/').pop();
  if (!taskId) {
    return JSON.stringify({ logs: [], error: 'Invalid task ARN' });
  }

  const logStreamName = `${LOG_STREAM_PREFIX}/${taskId}`;
  console.log('[getContainerLogs] Fetching logs for task:', taskId, '| stream:', logStreamName);

  try {
    // Use GetLogEvents (exact stream name) rather than FilterLogEvents (prefix match).
    // FilterLogEvents requires logs:FilterLogEvents on the log-group ARN and can return
    // empty results silently when the IAM resource pattern uses a trailing :* (stream wildcard).
    // GetLogEvents targets a specific stream and returns up to `limit` events from head.
    const result = await logs.send(new GetLogEventsCommand({
      logGroupName: LOG_GROUP_NAME,
      logStreamName,
      limit,
      startFromHead: true,
    }));

    console.log('[getContainerLogs] Found', result.events?.length ?? 0, 'log events');

    const logLines = (result.events ?? []).map((e) => e.message ?? '').filter(Boolean);

    return JSON.stringify({ logs: logLines });
  } catch (err) {
    console.error('[getContainerLogs] Error:', err);
    return JSON.stringify({ logs: [], error: err instanceof Error ? err.message : 'Unknown error' });
  }
}
