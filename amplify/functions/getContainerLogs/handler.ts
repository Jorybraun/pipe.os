import { CloudWatchLogsClient, FilterLogEventsCommand } from '@aws-sdk/client-cloudwatch-logs';

const logs = new CloudWatchLogsClient({ region: process.env.AWS_REGION ?? 'us-west-2' });

interface GetContainerLogsRequest {
  arguments: {
    taskArn: string;
    limit?: number;
  };
}

export async function handler(event: GetContainerLogsRequest) {
  const { taskArn, limit = 50 } = event.arguments;
  
  // Extract task ID from ARN (last part after /)
  const taskId = taskArn.split('/').pop();
  if (!taskId) {
    return JSON.stringify({ logs: [], error: 'Invalid task ARN' });
  }

  console.log('[getContainerLogs] Fetching logs for task:', taskId);

  try {
    const result = await logs.send(new FilterLogEventsCommand({
      logGroupName: '/pipe/dev-containers/code-server',
      logStreamNamePrefix: `code-server/code-server/${taskId}`,
      limit,
    }));

    console.log('[getContainerLogs] Found', result.events?.length, 'log events');

    const logLines = (result.events ?? []).map(e => e.message ?? '').filter(Boolean);
    
    return JSON.stringify({ logs: logLines });
  } catch (err) {
    console.error('[getContainerLogs] Error:', err);
    return JSON.stringify({ logs: [], error: err instanceof Error ? err.message : 'Unknown error' });
  }
}
