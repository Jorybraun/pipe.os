import 'dotenv/config';
import MistralClient from '@mistralai/mistralai';

/**
 * Mistral Analyzer: Uses Mistral API to analyze commits and infer feature impacts
 */

const client = new MistralClient(process.env.MISTRAL_API_KEY);

/**
 * Analyze a commit to determine which feature it touches and what type of work it is
 */
export async function analyzeCommit(commit, featuresContext = '') {
  const prompt = `You are a code change analyzer for the Pipe OS project. Analyze this commit and respond ONLY with valid JSON.

Features in the project:
${featuresContext || 'Pipeline Creation, Candidate Assessment, Challenge Editor, Code Review, Quiz'}

Commit:
- Hash: ${commit.hash}
- Message: ${commit.message}
- Files changed: ${commit.files.join(', ')}

Determine:
1. Which feature(s) it touches (best guess based on files and message)
2. Type of work: bugfix, feature, refactor, docs, chore
3. Brief 1-line summary
4. If bugfix, severity: P0, P1, P2, P3 (or null)

Respond ONLY with this JSON structure (no markdown, no extra text):
{
  "features": ["feature name"],
  "type": "bugfix|feature|refactor|docs|chore",
  "summary": "brief description",
  "severity": "P0|P1|P2|P3|null",
  "confidence": 0.95
}`;

  try {
    const response = await client.chat({
      model: 'mistral-small-latest',
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.1
    });

    const content = response.choices[0].message.content;

    // Try to parse JSON from response
    try {
      // Extract JSON from potential markdown code blocks
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        return { ...result, analyzed: true };
      }
    } catch (parseError) {
      console.error('Failed to parse Mistral response:', content);
    }

    // Fallback if parsing fails
    return {
      features: ['unknown'],
      type: 'unknown',
      summary: commit.message,
      severity: null,
      confidence: 0,
      analyzed: false
    };
  } catch (error) {
    console.error('Mistral API error:', error.message);
    throw error;
  }
}

/**
 * Analyze feature status based on recent commits and bugs
 */
export async function analyzeFeatureStatus(feature, recentCommits = []) {
  const bugsContext = feature.bugs
    ? feature.bugs.map(b => `${b.severity}: ${b.title}`).join('\n')
    : 'No bugs';

  const commitsContext = recentCommits
    .map(c => `${c.timestamp}: ${c.message}`)
    .join('\n') || 'No recent commits';

  const prompt = `You are a project status analyzer for the Pipe OS project.

Feature: ${feature.name}
Component: ${feature.component}
Recent commits:
${commitsContext}

Open bugs:
${bugsContext}

Determine the status:
- working: Feature is complete, no open P0/P1 bugs
- partial: Feature partially implemented or has P2 bugs
- broken: Feature has open P0/P1 bugs
- blocked: Feature blocked by dependencies
- in_progress: Active development (commits in last 3 days)

Respond ONLY with this JSON (no markdown):
{
  "status": "working|partial|broken|blocked|in_progress",
  "reason": "brief explanation",
  "recommendation": "suggested next action"
}`;

  try {
    const response = await client.chat({
      model: 'mistral-small-latest',
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.1
    });

    const content = response.choices[0].message.content;

    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (parseError) {
      console.error('Failed to parse status response:', content);
    }

    return {
      status: feature.status || 'unknown',
      reason: 'Could not analyze',
      recommendation: 'Manual review needed'
    };
  } catch (error) {
    console.error('Mistral API error:', error.message);
    return {
      status: feature.status || 'unknown',
      reason: 'API error',
      recommendation: 'Retry later'
    };
  }
}

/**
 * Analyze a Lambda function's source code and generate documentation + Mermaid diagram
 */
export async function analyzeLambda(name, code) {
  const prompt = `You are a technical documentation writer. Analyze this AWS Lambda function named "${name}" and respond ONLY with valid JSON.

Source code:
${code}

Generate documentation with this exact JSON structure (no markdown, no extra text):
{
  "description": "2-3 sentence plain-English description of what this Lambda does and why",
  "trigger": "how it is invoked (API Gateway, AppSync mutation, direct invocation, etc)",
  "inputs": [{"name": "fieldName", "type": "string|number|object|etc", "desc": "what it is"}],
  "outputs": [{"name": "fieldName", "type": "string|number|object|etc", "desc": "what it returns"}],
  "dependencies": ["list of external services, models, APIs, or SDKs used"],
  "flow": "flowchart TD\\n  A[Invoke] --> B[Step]\\n  B --> C[Result]",
  "notes": "security considerations, edge cases, or important caveats (or empty string)"
}

For the flow field: write a valid Mermaid flowchart TD diagram (use \\n for newlines, double-quote the whole string). Show the key steps and decision points.`;

  try {
    const response = await client.chat({
      model: 'mistral-small-latest',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1
    });
    const content = response.choices[0].message.content;
    const match = content.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
  } catch (e) {
    console.error(`[analyzeLambda] ${name}:`, e.message);
  }
  return null;
}

/**
 * Batch analyze multiple commits
 */
export async function analyzeCommitsBatch(commits, featuresContext) {
  const results = [];

  for (const commit of commits) {
    // Add small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 500));

    const analysis = await analyzeCommit(commit, featuresContext);
    results.push({
      commit: commit.hash,
      message: commit.message,
      ...analysis
    });

    console.log(`✓ Analyzed: ${commit.message.slice(0, 50)}`);
  }

  return results;
}
