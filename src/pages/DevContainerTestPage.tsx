import { useState } from 'react';
import { useData } from '../providers';

export default function DevContainerTestPage(): JSX.Element {
  const dataFactory = useData();
  const [sessionId, setSessionId] = useState('');
  const [result, setResult] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);

  const handleLaunch = async () => {
    if (!sessionId) {
      alert('Enter a session ID');
      return;
    }

    const client = dataFactory.createClient();
    setLoading(true);
    try {
      const launchDevContainer = client.mutations['launchDevContainer'];
      if (!launchDevContainer) throw new Error('launchDevContainer mutation not available');
      const { data, errors } = await launchDevContainer({ sessionId });
      if (errors) throw new Error(errors[0]?.message ?? 'Unknown error');
      setResult(data);
    } catch (err) {
      setResult({ error: err instanceof Error ? err.message : 'Unknown error' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: '2rem', maxWidth: '600px', margin: '0 auto' }}>
      <h1>Dev Container Test</h1>

      <div style={{ marginBottom: '1rem' }}>
        <label>
          Session ID:
          <input
            type="text"
            value={sessionId}
            onChange={(e) => setSessionId(e.target.value)}
            placeholder="test-session-123"
            style={{ marginLeft: '1rem', padding: '0.5rem', width: '300px' }}
          />
        </label>
      </div>

      <button onClick={handleLaunch} disabled={loading} style={{ padding: '0.5rem 1rem' }}>
        {loading ? 'Launching...' : 'Launch Container'}
      </button>

      {Boolean(result) && (
        <pre style={{ marginTop: '2rem', background: '#f5f5f5', padding: '1rem', borderRadius: '4px' }}>
          {JSON.stringify(result, null, 2)}
        </pre>
      )}

      <div style={{ marginTop: '2rem', fontSize: '0.875rem', color: '#666' }}>
        <p><strong>Expected flow:</strong></p>
        <ol>
          <li>Lambda calls ECS RunTask</li>
          <li>Returns taskArn + status: PROVISIONING</li>
          <li>ECS event triggers ecsStatusBridge</li>
          <li>Bridge creates ALB target group + listener rule</li>
          <li>Bridge updates DevContainerSession with URL</li>
          <li>Frontend subscribes to status changes</li>
        </ol>
      </div>
    </div>
  );
}
