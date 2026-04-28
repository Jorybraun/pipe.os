import { describe, it, expect, vi, beforeEach } from 'vitest';
import { callRoleAgent, mergeKnowledgeState } from '../lib/roleAgent';
import { buildRoleAgentSystemPrompt, buildRoleAgentUserMessage } from '../lib/roleAgentPrompts';

// ─── Mock fetch ─────────────────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

// ─── mergeKnowledgeState ───────────────────────────────────────────────────

describe('mergeKnowledgeState', () => {
  it('merges new domains into empty state', () => {
    const result = mergeKnowledgeState({}, {
      why: { origin: 'backfill', urgency: 'high' },
    });
    expect(result.why).toEqual({ origin: 'backfill', urgency: 'high' });
  });

  it('merges new keys into existing domain', () => {
    const existing = { why: { origin: 'backfill' } };
    const update = { why: { urgency: 'high' } };
    const result = mergeKnowledgeState(existing, update);
    expect(result.why).toEqual({ origin: 'backfill', urgency: 'high' });
  });

  it('overwrites existing keys with newer values', () => {
    const existing = { why: { origin: 'new' } };
    const update = { why: { origin: 'backfill' } };
    const result = mergeKnowledgeState(existing, update);
    expect(result.why).toEqual({ origin: 'backfill' });
  });

  it('preserves unrelated domains', () => {
    const existing = { work: { product: 'SaaS' } };
    const update = { team: { size: 6 } };
    const result = mergeKnowledgeState(existing, update);
    expect(result.work).toEqual({ product: 'SaaS' });
    expect(result.team).toEqual({ size: 6 });
  });

  it('handles empty update gracefully', () => {
    const existing = { why: { origin: 'new' } };
    const result = mergeKnowledgeState(existing, {});
    expect(result).toEqual(existing);
  });
});

// ─── buildRoleAgentSystemPrompt — participant role variants ────────────────

describe('buildRoleAgentSystemPrompt', () => {
  it('returns core prompt without participant role', () => {
    const prompt = buildRoleAgentSystemPrompt();
    expect(prompt).toContain('senior technical recruiting partner');
    expect(prompt).not.toContain('Your Interviewee');
  });

  it('includes hiring manager section', () => {
    const prompt = buildRoleAgentSystemPrompt('HIRING_MANAGER');
    expect(prompt).toContain('Your Interviewee: Hiring Manager');
    expect(prompt).toContain('Value-level laddering');
  });

  it('includes internal recruiter section', () => {
    const prompt = buildRoleAgentSystemPrompt('INTERNAL_RECRUITER');
    expect(prompt).toContain('Your Interviewee: Internal Recruiter');
    expect(prompt).toContain('What the HM emphasized');
  });

  it('includes external recruiter section', () => {
    const prompt = buildRoleAgentSystemPrompt('EXTERNAL_RECRUITER');
    expect(prompt).toContain('Your Interviewee: External Recruiter');
    expect(prompt).toContain('client brief');
  });

  it('includes team member section', () => {
    const prompt = buildRoleAgentSystemPrompt('TEAM_MEMBER');
    expect(prompt).toContain('Your Interviewee: Team Member');
    expect(prompt).toContain('ground truth for culture');
  });

  it('ignores unknown participant roles', () => {
    const prompt = buildRoleAgentSystemPrompt('UNKNOWN_ROLE');
    expect(prompt).not.toContain('Your Interviewee');
  });
});

// ─── buildRoleAgentUserMessage — knowledge state context ───────────────────

describe('buildRoleAgentUserMessage', () => {
  it('includes baseline data', () => {
    const msg = buildRoleAgentUserMessage({
      baseline: { title: 'Marketing Director' },
      exchanges: [],
      knowledgeState: {},
      questionsAsked: 0,
      questionBudget: 8,
    });
    expect(msg).toContain('Marketing Director');
    expect(msg).toContain('BASELINE FORM DATA');
  });

  it('includes shared knowledge state when present', () => {
    const msg = buildRoleAgentUserMessage({
      baseline: { title: 'Engineer' },
      exchanges: [],
      knowledgeState: { team: { size: 6, culture_hm: 'async-first' } },
      questionsAsked: 0,
      questionBudget: 8,
    });
    expect(msg).toContain('Previously Established Facts');
    expect(msg).toContain('async-first');
  });

  it('omits knowledge state section when empty', () => {
    const msg = buildRoleAgentUserMessage({
      baseline: { title: 'Engineer' },
      exchanges: [],
      knowledgeState: {},
      questionsAsked: 0,
      questionBudget: 8,
    });
    expect(msg).not.toContain('Previously Established Facts');
  });

  it('includes budget exhaustion warning', () => {
    const msg = buildRoleAgentUserMessage({
      baseline: { title: 'Engineer' },
      exchanges: [],
      knowledgeState: {},
      questionsAsked: 9,
      questionBudget: 8,
    });
    expect(msg).toContain('Budget nearly exhausted');
  });

  it('signals synthesis when budget is zero', () => {
    const msg = buildRoleAgentUserMessage({
      baseline: { title: 'Engineer' },
      exchanges: [],
      knowledgeState: {},
      questionsAsked: 8,
      questionBudget: 8,
    });
    expect(msg).toContain('BUDGET EXHAUSTED');
  });
});

// ─── callRoleAgent — error when no provider ──────────────────────────────────

describe('callRoleAgent', () => {
  it('throws when no provider is configured', async () => {
    await expect(callRoleAgent({
      provider: null,
      fallbackProvider: null,
      baseline: { title: 'Designer' },
      exchanges: [],
      knowledgeState: {},
      questionsAsked: 0,
      questionBudget: 8,
    })).rejects.toThrow('No AI provider is configured');
  });

  it('throws when budget exhausted and no provider', async () => {
    await expect(callRoleAgent({
      provider: null,
      fallbackProvider: null,
      baseline: { title: 'Designer' },
      exchanges: [],
      knowledgeState: {},
      questionsAsked: 8,
      questionBudget: 8,
    })).rejects.toThrow('No AI provider is configured');
  });
});
