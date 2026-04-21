import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_PATH = process.env.GIT_REPO_PATH || '..';

/**
 * Run Claude CLI with a prompt and collect output.
 * Returns parsed JSON or null on failure.
 */
function runClaude(prompt, { cwd, timeout = 120000 } = {}) {
  const resolvedCwd = cwd || path.resolve(__dirname, REPO_PATH);
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    const proc = spawn('claude', ['-p', prompt, '--dangerously-skip-permissions'], {
      cwd: resolvedCwd,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout,
    });

    proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    proc.on('close', (code) => {
      if (code !== 0 && !stdout) {
        console.error(`[claude-analyzer] Claude exited ${code}: ${stderr.slice(0, 300)}`);
        resolve(null);
        return;
      }
      // Extract JSON from output
      const jsonMatch = stdout.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          resolve(JSON.parse(jsonMatch[0]));
        } catch (e) {
          console.error(`[claude-analyzer] JSON parse error: ${e.message}`);
          console.error(`[claude-analyzer] Raw output (first 500): ${stdout.slice(0, 500)}`);
          resolve(null);
        }
      } else {
        // Try array match
        const arrMatch = stdout.match(/\[[\s\S]*\]/);
        if (arrMatch) {
          try { resolve(JSON.parse(arrMatch[0])); } catch { resolve(null); }
        } else {
          console.error(`[claude-analyzer] No JSON found in output (${stdout.length} chars)`);
          resolve(null);
        }
      }
    });

    proc.on('error', (err) => {
      console.error(`[claude-analyzer] Spawn error: ${err.message}`);
      resolve(null);
    });
  });
}

/**
 * Analyze a batch of commits to determine which features they touch.
 */
export async function analyzeCommitsBatch(commits, featuresContext) {
  const results = [];

  // Process in batches of 5 to avoid overwhelming Claude
  const batchSize = 5;
  for (let i = 0; i < commits.length; i += batchSize) {
    const batch = commits.slice(i, i + batchSize);
    const commitsText = batch.map((c, idx) =>
      `Commit ${idx + 1}:\n  Hash: ${c.hash}\n  Message: ${c.message}\n  Files: ${c.files.join(', ')}`
    ).join('\n\n');

    const prompt = `You are a code change analyzer for the Pipe OS project (AWS Amplify Gen 2 + React + TypeScript).

Features in the project: ${featuresContext || 'Unknown'}

Analyze these commits and respond ONLY with a JSON array (no markdown, no preamble):

${commitsText}

For each commit, determine:
1. Which feature(s) it touches (match to feature names listed above)
2. Type: bugfix, feature, refactor, docs, chore
3. Brief 1-line summary
4. Severity if bugfix: P0, P1, P2, P3 (or null)

Respond with ONLY this JSON array:
[
  {
    "commit": "hash",
    "features": ["feature name"],
    "type": "bugfix|feature|refactor|docs|chore",
    "summary": "brief description",
    "severity": "P0|P1|P2|P3|null",
    "analyzed": true
  }
]`;

    const result = await runClaude(prompt);
    if (Array.isArray(result)) {
      results.push(...result);
      console.log(`✓ Analyzed batch ${Math.floor(i / batchSize) + 1}: ${batch.length} commits`);
    } else if (result && result.commit) {
      results.push(result);
    } else {
      // Fallback: mark commits as unanalyzed
      for (const c of batch) {
        results.push({
          commit: c.hash,
          message: c.message,
          features: ['unknown'],
          type: 'unknown',
          summary: c.message,
          severity: null,
          analyzed: false,
        });
      }
    }

    // Small delay between batches
    if (i + batchSize < commits.length) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  return results;
}

/**
 * Analyze feature status based on recent commits and bugs.
 */
export async function analyzeFeatureStatus(feature, recentCommits = []) {
  const bugsContext = feature.bugs
    ? feature.bugs.map(b => `${b.severity}: ${b.title} [${b.status}]`).join('\n')
    : 'No bugs';

  const commitsContext = recentCommits
    .map(c => `${c.timestamp}: ${c.message}`)
    .join('\n') || 'No recent commits';

  const prompt = `You are a project status analyzer for Pipe OS.

Feature: ${feature.name}
Component: ${feature.component}
Route: ${feature.route}

Recent commits:
${commitsContext}

Open bugs:
${bugsContext}

Determine the status:
- working: Feature complete, no open P0/P1 bugs
- partial: Partially implemented or has P2 bugs
- broken: Has open P0/P1 bugs
- blocked: Blocked by dependencies
- in_progress: Active development

Respond ONLY with this JSON (no markdown):
{
  "status": "working|partial|broken|blocked|in_progress",
  "reason": "brief explanation",
  "recommendation": "suggested next action"
}`;

  const result = await runClaude(prompt, { timeout: 60000 });
  return result || {
    status: feature.status || 'unknown',
    reason: 'Could not analyze',
    recommendation: 'Manual review needed',
  };
}

/**
 * Analyze a Lambda function's source code and generate documentation + Mermaid diagram.
 */
export async function analyzeLambda(name, code) {
  const prompt = `You are a technical documentation writer. Analyze this AWS Lambda function named "${name}" and respond ONLY with valid JSON (no markdown, no preamble).

Source code:
${code}

Generate documentation with this exact JSON structure:
{
  "description": "2-3 sentence plain-English description of what this Lambda does and why",
  "trigger": "how it is invoked (API Gateway, AppSync mutation, direct invocation, etc)",
  "inputs": [{"name": "fieldName", "type": "string|number|object|etc", "desc": "what it is"}],
  "outputs": [{"name": "fieldName", "type": "string|number|object|etc", "desc": "what it returns"}],
  "dependencies": ["list of external services, models, APIs, or SDKs used"],
  "errorHandling": [{"code": "ERROR_CODE", "description": "when this happens"}],
  "security": "auth requirements, IAM permissions, data access patterns",
  "flow": "flowchart TD\\n  A[Invoke] --> B[Step]\\n  B --> C[Result]",
  "notes": "security considerations, edge cases, or important caveats (or empty string)"
}

For the flow field: write a valid Mermaid flowchart TD diagram (use \\n for newlines). Show key steps, decision points, error paths.`;

  const result = await runClaude(prompt, { timeout: 90000 });
  return result;
}

/**
 * Generate BDD specs for a journey or lambda using Claude.
 */
export async function generateBDD({ featureId, journeyName, lambdaName, componentCode }) {
  let prompt;

  if (lambdaName) {
    prompt = `You are writing BDD (Behavior-Driven Development) specs for the "${lambdaName}" Lambda function in the Pipe OS project.

Read the Lambda source code at amplify/functions/${lambdaName}/handler.ts and any related files.

Generate Given/When/Then scenarios that cover:
1. Happy path (normal successful invocation)
2. Error paths (invalid input, missing data, auth failures)
3. Edge cases (empty arrays, null fields, concurrent calls)

Respond ONLY with this JSON (no markdown):
{
  "scenarios": [
    {
      "name": "scenario name",
      "steps": "Given ...\\nWhen ...\\nThen ..."
    }
  ]
}`;
  } else {
    prompt = `You are writing BDD specs for the "${journeyName}" user journey in the Pipe OS project.

${componentCode ? `Component code:\n${componentCode.slice(0, 4000)}` : `Read the component source code to understand this journey.`}

Generate a concise Given/When/Then scenario that covers the main flow of "${journeyName}".

Respond ONLY with this JSON (no markdown):
{
  "bdd": "Given ...\\nWhen ...\\nThen ..."
}`;
  }

  const result = await runClaude(prompt, { timeout: 60000 });
  return result;
}

/**
 * Parse Amplify schema into entities array using Claude.
 */
export async function parseSchema() {
  const prompt = `Read the file amplify/data/resource.ts in this project.

Parse ALL data models (not mutations/queries) and respond ONLY with this JSON (no markdown, no preamble):
{
  "entities": [
    {
      "name": "ModelName",
      "description": "1-sentence description from the comments",
      "fields": [
        {"name": "fieldName", "type": "String|ID|Integer|Float|Boolean|DateTime|JSON|Enum|etc", "required": true/false, "default": null, "authOverride": null}
      ],
      "auth": ["owner", "publicApiKey.read", "custom.read"],
      "relationships": [
        {"type": "hasMany|belongsTo|hasOne", "target": "OtherModel", "field": "fieldName"}
      ],
      "secondaryIndexes": ["indexName"]
    }
  ],
  "entityDiagram": "erDiagram\\n  Pipeline ||--o{ Stage : has\\n  ..."
}

For entityDiagram: write a valid Mermaid ER diagram showing all models and their relationships. Use ||--o{ for hasMany, }o--|| for belongsTo, ||--|| for hasOne.

Include ALL models: Pipeline, Stage, Challenge, Candidate, Assessment, VideoSession, VideoSignal, CodeArtifact, CandidateMedia, ScheduledInterview, SchedulingConnection, RoleContext, RepoTemplate, DevContainerSession.`;

  const result = await runClaude(prompt, { timeout: 120000 });
  return result;
}

/**
 * Generate a data flow diagram for a specific route/feature.
 */
export async function generateDataFlowDiagram(feature) {
  const prompt = `You are generating a Mermaid data flow diagram for the "${feature.name}" feature in Pipe OS.

Route: ${feature.route}
Component: ${feature.component}
Components: ${(feature.components || []).join(', ')}
API Calls: ${(feature.apiCalls || []).join(', ')}
Lambdas: ${(feature.lambdas || []).join(', ')}

Read the main component file at src/pages/${feature.component} to understand the data flow.

Respond ONLY with this JSON (no markdown):
{
  "diagram": "flowchart LR\\n  A[Route: ${feature.route}] --> B[${feature.component}]\\n  ..."
}

Show: Route → Component → Hooks/API calls → Lambdas → Data Models → Response flow.
Use subgraphs for Frontend, API Layer, and Data Layer.`;

  const result = await runClaude(prompt, { timeout: 90000 });
  return result;
}
