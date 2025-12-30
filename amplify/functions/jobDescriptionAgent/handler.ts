/**
 * Job Description Agent Lambda Handler
 *
 * Generates comprehensive job descriptions and interview recommendations
 * from accumulated role context.
 *
 * Only invoked when RoleContext status === 'ready'.
 */

import Anthropic from '@anthropic-ai/sdk';
import { v4 as uuid } from 'uuid';
import type {
  JobDescriptionRequest,
  JobDescriptionResponse,
  JobDescription,
  CandidateFilter,
  SuggestedStage,
} from './types';

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514';
const MAX_TOKENS = parseInt(process.env.CLAUDE_MAX_TOKENS || '2048');

/**
 * Lambda handler entry point.
 */
export async function handler(event: JobDescriptionRequest): Promise<JobDescriptionResponse> {
  const startTime = Date.now();

  console.log('[JobDescriptionAgent] Starting request', {
    roleId: event.roleContext.id,
    status: event.roleContext.status,
    exchangeCount: event.roleContext.exchanges.length,
  });

  try {
    if (event.roleContext.status !== 'ready') {
      throw new Error('RoleContext must have status="ready" to generate job description');
    }

    if (!event.roleContext.baseline) {
      throw new Error('RoleContext must have baseline filled');
    }

    // Generate all outputs in parallel for speed
    const [jobDescription, candidateFilters, suggestedStages] = await Promise.all([
      generateJobDescription(event.roleContext),
      generateCandidateFilters(event.roleContext),
      generateSuggestedStages(event.roleContext),
    ]);

    const processingTime = Date.now() - startTime;

    console.log('[JobDescriptionAgent] Request complete', {
      processingTime,
      responsibilitiesCount: jobDescription.responsibilities.length,
      filterCount: candidateFilters.length,
      stageCount: suggestedStages.length,
    });

    return {
      jobDescription,
      candidateFilters,
      suggestedStages,
      processingTime,
    };
  } catch (error) {
    console.error('[JobDescriptionAgent] Error:', error);
    throw error;
  }
}

/**
 * Generates comprehensive job description.
 */
async function generateJobDescription(
  roleContext: JobDescriptionRequest['roleContext']
): Promise<JobDescription> {
  const { baseline, context, exchanges } = roleContext;

  const prompt = `You are generating a comprehensive job description based on role discovery context.

BASELINE:
${JSON.stringify(baseline, null, 2)}

DISCOVERED CONTEXT:
${JSON.stringify(context, null, 2)}

CONVERSATION INSIGHTS (last 5):
${exchanges.slice(-5).map(e => `Q: ${e.agentQuestion}\nA: ${e.userResponse}\nExtracted: ${e.extractedFacts.join(', ')}`).join('\n\n')}

TASK:
Generate a compelling, specific job description that reflects the ACTUAL role based on the discovery conversation.

REQUIREMENTS:
- Title: Use the baseline title
- Summary: 2-3 sentences capturing role essence
- Responsibilities: 5-8 bullet points (what they'll DO, not generic duties)
- Requirements:
  - Required: 4-6 must-have qualifications
  - Preferred: 3-5 nice-to-have qualifications
- Success Indicators: 3-5 metrics/outcomes for 90-day and 1-year success
- Team Context: 2-3 sentences about the team, culture, collaboration
- Growth Opportunity: 2-3 sentences about career trajectory

OUTPUT FORMAT (JSON):
{
  "title": "exact title from baseline",
  "summary": "2-3 sentence overview",
  "responsibilities": ["specific duty 1", "specific duty 2", ...],
  "requirements": {
    "required": ["must-have 1", "must-have 2", ...],
    "preferred": ["nice-to-have 1", "nice-to-have 2", ...]
  },
  "successIndicators": ["90-day metric 1", "1-year outcome 1", ...],
  "teamContext": "Team description",
  "growthOpportunity": "Career growth description",
  "rawMarkdown": "# Full job description in markdown format"
}`;

  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    messages: [{ role: 'user', content: prompt }],
  });

  const content = message.content[0];
  if (content.type !== 'text') {
    throw new Error('Unexpected response type from Anthropic');
  }

  try {
    const result = JSON.parse(content.text) as JobDescription;
    return result;
  } catch (error) {
    console.error('[JD Generator] Failed to parse JSON:', content.text);
    throw new Error('JD_GENERATION_FAILED: Invalid JSON response');
  }
}

/**
 * Generates candidate screening filters.
 */
async function generateCandidateFilters(
  roleContext: JobDescriptionRequest['roleContext']
): Promise<CandidateFilter[]> {
  const { baseline, context } = roleContext;

  const prompt = `Generate candidate screening filters based on role requirements.

BASELINE:
${JSON.stringify(baseline, null, 2)}

CONTEXT:
${JSON.stringify(context, null, 2)}

TASK:
Create 5-10 specific screening criteria that differentiate strong from weak candidates.

CATEGORIES:
- experience: Years, domains, specific tech experience
- skills: Technical skills, soft skills
- traits: Behaviors, attitudes, working styles
- logistics: Location, availability, work model preferences

OUTPUT FORMAT (JSON):
[
  {
    "id": "uuid",
    "category": "experience|skills|traits|logistics",
    "label": "Specific, measurable criterion",
    "required": true|false,
    "derivedFrom": "Which part of context led to this filter"
  }
]`;

  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  const content = message.content[0];
  if (content.type !== 'text') {
    throw new Error('Unexpected response type from Anthropic');
  }

  try {
    const filters = JSON.parse(content.text) as Array<Omit<CandidateFilter, 'id'>>;

    // Add UUIDs
    return filters.map(filter => ({
      ...filter,
      id: uuid(),
    }));
  } catch (error) {
    console.error('[Filter Generator] Failed to parse JSON:', content.text);
    throw new Error('FILTER_GENERATION_FAILED: Invalid JSON response');
  }
}

/**
 * Generates suggested interview stages.
 */
async function generateSuggestedStages(
  roleContext: JobDescriptionRequest['roleContext']
): Promise<SuggestedStage[]> {
  const { baseline, context } = roleContext;

  const prompt = `Design an interview pipeline for this role.

BASELINE:
${JSON.stringify(baseline, null, 2)}

CONTEXT:
${JSON.stringify(context, null, 2)}

TASK:
Suggest 3-5 interview stages that evaluate the skills and traits critical for THIS specific role.

AVAILABLE STAGE TYPES:
- technical_screen: Phone/video technical discussion
- coding: Live coding or take-home challenge
- system_design: Architecture/design discussion
- behavioral: STAR-format behavioral questions
- culture_fit: Values alignment, team dynamics
- hiring_manager: Hiring manager interview
- team_interview: Meet the team session
- presentation: Present work or case study

OUTPUT FORMAT (JSON):
[
  {
    "id": "uuid",
    "type": "technical_screen|coding|...",
    "name": "Stage name (e.g., 'Technical Deep Dive')",
    "rationale": "Why this stage for THIS role",
    "focusAreas": ["What to evaluate 1", "What to evaluate 2", ...],
    "suggestedDuration": 60,
    "order": 1
  }
]`;

  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  const content = message.content[0];
  if (content.type !== 'text') {
    throw new Error('Unexpected response type from Anthropic');
  }

  try {
    const stages = JSON.parse(content.text) as Array<Omit<SuggestedStage, 'id'>>;

    // Add UUIDs
    return stages.map(stage => ({
      ...stage,
      id: uuid(),
    }));
  } catch (error) {
    console.error('[Stage Generator] Failed to parse JSON:', content.text);
    throw new Error('STAGE_GENERATION_FAILED: Invalid JSON response');
  }
}
