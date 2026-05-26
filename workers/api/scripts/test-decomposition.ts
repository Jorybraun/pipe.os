/**
 * Quick decomposition prompt test — runs the decomposition LLM against
 * a sample resume text without going through the full upload pipeline.
 */

import { VertexAIProvider } from '../src/lib/llm/vertexAIProvider';
import {
  DECOMPOSITION_SYSTEM_PROMPT,
  buildDecompositionUserMessage,
} from '../src/lib/candidateDiscovery/candidateDecompositionPrompt';

async function main() {
  const gatewayUrl = process.env.CF_AI_GATEWAY_URL;
  const apiToken = process.env.CF_API_TOKEN;
  const projectId = process.env.VERTEX_AI_PROJECT_ID ?? 'pipe-493116';
  const region = process.env.VERTEX_AI_REGION ?? 'us-central1';
  const model = process.env.VERTEX_AI_MODEL ?? 'meta/llama-3.1-8b-instruct-maas';

  if (!gatewayUrl) {
    console.error('Set CF_AI_GATEWAY_URL env var');
    process.exit(1);
  }
  if (!apiToken) {
    console.error('Set CF_API_TOKEN env var');
    process.exit(1);
  }

  const provider = new VertexAIProvider(gatewayUrl, apiToken, projectId, region, model);

  // Sample resume text from the logs
  const resumeText = `Jory Braun
Vancouver, BC, Canada
jorybraun@icloud.com
History
Morgan Stanley Senior UI Developer : January 2024 - March 2025 (1 year 3 months)
Montreal, Canada (React, Redux toolkit, TypeScript, Redux-Saga, Jenkins, ShadCN)
● Collaborated directly with stakeholders to gather requirements and translate them into a scalable frontend architecture
● Architected and documented application patterns`;

  const parsed = {
    skills: [] as string[],
    experiences: [] as Array<{ company: string; role: string; startDate?: string; endDate?: string; description: string; isCurrent?: boolean }>,
    educationBlocks: [] as Array<{ institution: string; degree: string; field?: string; year?: string }>,
    credentials: [] as Array<{ name: string; issuer?: string; year?: string }>,
    projects: [] as Array<{ name: string; description: string; url?: string }>,
  };

  const userMessage = buildDecompositionUserMessage({ parsed, resumeText });
  console.log('Model:', model);
  console.log('Prompt chars:', DECOMPOSITION_SYSTEM_PROMPT.length + userMessage.length);
  console.log('---');

  const start = Date.now();
  try {
    const result = await provider.complete(
      [
        { role: 'system', content: DECOMPOSITION_SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      { forceJson: true, maxTokens: 4096 },
    );
    const elapsed = Date.now() - start;
    console.log(`Success in ${elapsed}ms`);
    console.log('Raw response:');
    console.log(result.content);
  } catch (err) {
    const elapsed = Date.now() - start;
    console.error(`Failed in ${elapsed}ms:`, err instanceof Error ? err.message : err);
  }
}

main();
