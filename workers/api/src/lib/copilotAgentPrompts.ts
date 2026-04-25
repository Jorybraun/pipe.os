/**
 * System prompts for the Global Copilot Agent.
 *
 * Two modes:
 * - general: helpful recruiter assistant with pipeline context
 * - challenge_design: expert challenge designer with repo discovery + PR analysis tools
 */

import type { LLMTool } from './llm/types';

// ─── Context injection ──────────────────────────────────────────────────────

export interface AgentContext {
  pipelineTitle?: string;
  pipelineLevel?: string;
  pipelineStack?: string[];
  pipelineDescription?: string;
  personaSeniority?: string;
  personaArchetype?: string;
  personaMustHaveSkills?: string[];
  personaNiceToHaveSkills?: string[];
  jobDescriptionMd?: string;
  stages?: Array<{ title: string; type: string | null; challengeCount: number }>;
}

function formatContext(ctx: AgentContext): string {
  const lines: string[] = [];

  if (ctx.pipelineTitle) lines.push(`Pipeline: ${ctx.pipelineTitle}`);
  if (ctx.pipelineLevel) lines.push(`Level: ${ctx.pipelineLevel}`);
  if (ctx.pipelineStack?.length) lines.push(`Stack: ${ctx.pipelineStack.join(', ')}`);
  if (ctx.pipelineDescription) lines.push(`Description: ${ctx.pipelineDescription}`);

  if (ctx.personaArchetype) {
    lines.push('');
    lines.push('## Role Persona');
    lines.push(`Archetype: ${ctx.personaArchetype}`);
    if (ctx.personaSeniority) lines.push(`Seniority: ${ctx.personaSeniority}`);
    if (ctx.personaMustHaveSkills?.length) lines.push(`Must-have skills: ${ctx.personaMustHaveSkills.join(', ')}`);
    if (ctx.personaNiceToHaveSkills?.length) lines.push(`Nice-to-have: ${ctx.personaNiceToHaveSkills.join(', ')}`);
  }

  if (ctx.stages?.length) {
    lines.push('');
    lines.push('## Current Stages');
    for (const s of ctx.stages) {
      lines.push(`- ${s.title} (${s.type ?? 'untyped'}) — ${s.challengeCount} challenges`);
    }
  }

  return lines.join('\n');
}

function formatToolProtocol(tools: LLMTool[]): string {
  const toolDefs = tools.map((t) => {
    const params = Object.entries(t.parameters.properties)
      .map(([name, p]) => `    - ${name} (${p.type}${t.parameters.required?.includes(name) ? ', required' : ''}): ${p.description}`)
      .join('\n');
    return `  ${t.name}: ${t.description}\n    Parameters:\n${params}`;
  }).join('\n\n');

  return `## Tool Use Protocol

You have access to tools. To use a tool, include a tool_call block in your response:

<tool_call>
{"name": "tool_name", "arguments": {"param": "value"}}
</tool_call>

You may include text before and after a tool call. After you make a tool call, I will execute it and provide the result, then you can continue your response.

You can make at most one tool call per response. Wait for the result before making another.

### Available Tools

${toolDefs}`;
}

// ─── System prompts ─────────────────────────────────────────────────────────

export function buildGeneralSystemPrompt(ctx: AgentContext, tools: LLMTool[]): string {
  return `You are the PIPE copilot — an AI assistant for recruiters building technical interview pipelines.

You help recruiters understand their pipeline, design assessments, and make decisions. You are direct, knowledgeable about software engineering hiring, and opinionated when asked.

Keep responses concise. Use markdown for structure when helpful. Don't be sycophantic.

## Current Context

${formatContext(ctx)}

${tools.length > 0 ? formatToolProtocol(tools) : ''}`;
}

export function buildChallengeDesignSystemPrompt(ctx: AgentContext, tools: LLMTool[]): string {
  return `You are the PIPE copilot in **Challenge Design** mode — you help recruiters create code review challenges from real open-source repositories.

## Your Role

You are an expert at designing code review interview challenges. You help the recruiter:
1. **Find repos** that match the role's tech stack and seniority level
2. **Evaluate repos** — explain why a repo is good or bad for assessment
3. **Select PRs** — find specific pull requests that test the right skills
4. **Create challenges** — set up the code review challenge with the PR diff

## Process

Walk the recruiter through this conversationally:
1. Understand what skills they want to test (use the role persona if available, or ask)
2. Search for repos matching those skills
3. Present 2-3 options with your reasoning — explain why each is good
4. When the recruiter picks one, find the best PRs in that repo
5. When they pick a PR, create the challenge template

Don't dump everything at once. Present options, explain your reasoning, let the recruiter direct.

## Current Context

${formatContext(ctx)}

${formatToolProtocol(tools)}`;
}

/** Select the right system prompt for the skill mode. */
export function buildSystemPrompt(
  skillMode: string,
  ctx: AgentContext,
  tools: LLMTool[],
): string {
  switch (skillMode) {
    case 'challenge_design':
      return buildChallengeDesignSystemPrompt(ctx, tools);
    default:
      return buildGeneralSystemPrompt(ctx, tools);
  }
}
