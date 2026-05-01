/**
 * Validate AI providers — quick health check for Vertex AI and Kimi.
 * Run: npx tsx scripts/validate-providers.ts
 */

import { VertexAIProvider } from '../src/lib/llm/vertexAIProvider';
import { KimiProvider } from '../src/lib/llm/kimiProvider';

async function testVertex(model = 'meta/llama-3.1-8b-instruct-maas') {
  const saJson = process.env.VERTEX_SA_KEY_JSON;
  const projectId = process.env.VERTEX_AI_PROJECT_ID ?? 'pipe-493116';
  if (!saJson) return { ok: false, error: 'VERTEX_SA_KEY_JSON missing' };

  const sa = JSON.parse(saJson) as { private_key: string; client_email: string; project_id: string };
  const provider = new VertexAIProvider(sa, projectId, 'us-central1', model);

  try {
    const start = Date.now();
    const result = await provider.complete(
      [{ role: 'user', content: 'Say "pong" and nothing else.' }],
      { maxTokens: 10 },
    );
    return { ok: true, model, elapsed: Date.now() - start, content: result.content.slice(0, 50) };
  } catch (err) {
    return { ok: false, model, error: err instanceof Error ? err.message : String(err) };
  }
}

async function testKimi() {
  const key = process.env.KIMI_API_KEY;
  const model = process.env.KIMI_MODEL ?? 'moonshot-v1-32k';
  const baseUrl = process.env.KIMI_BASE_URL ?? 'https://api.moonshot.cn/v1';
  if (!key) return { ok: false, error: 'KIMI_API_KEY missing' };

  const provider = new KimiProvider(key, model, baseUrl);

  try {
    const start = Date.now();
    const result = await provider.complete(
      [{ role: 'user', content: 'Say "pong" and nothing else.' }],
      { maxTokens: 10 },
    );
    return { ok: true, model, baseUrl, elapsed: Date.now() - start, content: result.content.slice(0, 50) };
  } catch (err) {
    return { ok: false, model, baseUrl, error: err instanceof Error ? err.message : String(err) };
  }
}

async function main() {
  console.log('Validating AI providers...\n');

  const vertex = await testVertex();
  console.log('Vertex AI:', vertex.ok ? `✅ ${vertex.model} in ${vertex.elapsed}ms → "${vertex.content}"` : `❌ ${vertex.error}`);

  const kimi = await testKimi();
  console.log('Kimi:', kimi.ok ? `✅ ${kimi.model} (${kimi.baseUrl}) in ${kimi.elapsed}ms → "${kimi.content}"` : `❌ ${kimi.error}`);

  console.log('\nPick the one that works and set CANDIDATE_AGENT_PROVIDER=vertex-ai or CANDIDATE_AGENT_PROVIDER=kimi');
}

main();
