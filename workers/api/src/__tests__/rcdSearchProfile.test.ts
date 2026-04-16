import { describe, it, expect } from 'vitest';
import { buildRcdSearchProfile } from '../lib/repoDiscovery/rcdSearchProfile';
import type { RoleContextDocument } from '../types';

function buildTestRcd(overrides: Partial<RoleContextDocument> = {}): RoleContextDocument {
  const base: RoleContextDocument = {
    rcd_version: 'rcd-v1',
    role_context_id: 'rc-test-profile',
    pipeline_id: 'pipe-test',
    created_at: '2026-04-14T00:00:00.000Z',
    domain_matrix: {
      HIRING_MANAGER: {
        codebase: {
          primary_authority: true,
          coverage: 'deep',
          laddering_chains: [],
          open_codes: [],
          axial_links: [],
          stories: [
            {
              situation: 'A payment reconciliation job timed out mid-run.',
              action: 'The team split it into idempotent chunks with explicit checkpoints.',
              outcome: 'Throughput tripled and retries stopped double-charging.',
              moral: 'Correctness and throughput rise together when retries are idempotent.',
              source_exchange_id: 'ex-1',
            },
          ],
          summary: 'The team writes payment reconciliation logic against a Postgres ledger.',
        },
        work: {
          primary_authority: true,
          coverage: 'covered',
          laddering_chains: [],
          open_codes: [],
          axial_links: [],
          stories: [],
          summary: 'We operate the fintech platform serving recurring B2B subscriptions.',
        },
      },
    },
    conflicts: [],
    technical_context: {
      stack: ['TypeScript', 'Node', 'Postgres'],
      constructs: ['event_sourcing', 'idempotent_jobs', 'distributed_locks'],
      seniority_band: 'senior',
      codebase_expectations: ['monorepo', 'integration_heavy_tests', 'thorough_review'],
      dispositional_weights: { rigor: 1.2 },
    },
    team_culture_profile: { per_stakeholder: {} },
    bars_overrides: [
      {
        dimension: 'review_culture',
        override_anchor_text: 'Every PR has at least two approvals and a written test rationale.',
      } as never,
    ],
    probe_bank_enrichment: { static_base_version: 'v1', enriched_probes: [] },
    dealbreakers: [],
    red_flags: [],
    consumer_slice: {} as never,
    validation_metadata: {
      schema_version: 'rcd-v1',
      synthesis_model: 'mock',
      synthesis_prompt_version: 'v1',
      verification_pass_model: 'mock',
      face_validity_reviewed_at: null,
      face_validity_reviewer: null,
    },
  };
  return { ...base, ...overrides };
}

describe('buildRcdSearchProfile', () => {
  it('produces a narrative in [400, 600] words', () => {
    const profile = buildRcdSearchProfile(buildTestRcd());
    const wordCount = profile.trim().split(/\s+/).length;
    expect(wordCount).toBeGreaterThanOrEqual(400);
    expect(wordCount).toBeLessThanOrEqual(600);
  });

  it('mentions seniority_band, stack, and constructs verbatim', () => {
    const profile = buildRcdSearchProfile(buildTestRcd());
    expect(profile).toContain('senior');
    expect(profile.toLowerCase()).toContain('typescript');
    expect(profile.toLowerCase()).toContain('postgres');
    expect(profile).toContain('event_sourcing');
  });

  it('includes codebase_expectations and domain summaries', () => {
    const profile = buildRcdSearchProfile(buildTestRcd());
    expect(profile).toContain('monorepo');
    expect(profile.toLowerCase()).toContain('reconciliation');
  });

  it('includes story situation/action/outcome when stories are present', () => {
    const profile = buildRcdSearchProfile(buildTestRcd());
    expect(profile.toLowerCase()).toContain('idempotent');
  });

  it('pads sparse RCDs up to the 400-word floor', () => {
    const sparse = buildTestRcd({
      technical_context: {
        stack: ['Go'],
        constructs: [],
        seniority_band: 'mid',
        codebase_expectations: [],
        dispositional_weights: {},
      },
      domain_matrix: {},
      bars_overrides: [],
    });
    const profile = buildRcdSearchProfile(sparse);
    expect(profile.trim().split(/\s+/).length).toBeGreaterThanOrEqual(400);
  });
});
