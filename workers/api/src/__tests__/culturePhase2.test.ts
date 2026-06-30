/**
 * BDD for ADR-036 Phase 2 — culture consumers reading the Role Context
 * Document (RCD) end-to-end.
 *
 * Scenario (from ADR-036 §Phase 2 acceptance sketch + P2.5 handoff):
 *   Given a role context with a seeded RCD (team culture profile, BARS
 *     overrides, dispositional weights, dealbreakers, enriched probes),
 *   When the culture session resolves its Team Context, picks its next
 *     question, scores the transcript, and evaluates dealbreakers,
 *   Then the selector biases toward questions with enriched probes, the
 *     scorer substitutes approved anchor text, the dispositional weight
 *     shifts magnitudes sign-preserved (never zeroing a dimension), and
 *     matching dealbreakers raise HITL flags the recruiter must resolve
 *     before the candidate report is released.
 *
 * Each test targets one link in the chain. The D1-facing resolvers
 * (resolveCultureRoleContext, loadRoleProbeBank) are exercised with a
 * lightweight in-memory stub that satisfies the shape of
 * `@cloudflare/workers-types` D1Database — enough for these tests to run
 * without spinning up miniflare.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import { resolveCultureRoleContext, hasTeamContext } from '../lib/cultureRoleResolution';
import { loadRoleProbeBank, mergeEnrichedProbes, enrichedProbeCount } from '../lib/cultureProbeBank';
import { pickNextQuestion, CULTURE_QUESTION_BANK } from '../lib/cultureQuestionBank';
import {
  applyBarsOverrides,
  applyDispositionalWeight,
  evaluateDealbreakers,
  scoreCultureInterview,
  CultureScorerUnavailableError,
  COMPETENCY_BARS_RUBRICS,
  type OrgCultureBenchmark,
} from '../lib/cultureScorer';
import { defaultCultureTranscript, type CultureTranscript } from '../lib/cultureAgent';
import type {
  RoleContextDocument,
  DealbreakerRecord,
  BarsOverride,
  TeamCultureProfile,
} from '../types';

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

// ─── Fixtures ────────────────────────────────────────────────────────────────

const MOCK_ORG_BENCHMARK: OrgCultureBenchmark = {
  autonomy: 4,
  riskTolerance: 3,
  workPace: 4,
  collaborationStyle: 3,
  feedbackOrientation: 4,
};

const MOCK_TEAM_CULTURE_PROFILE: TeamCultureProfile = {
  per_stakeholder: {
    HIRING_MANAGER: {
      clan_affinity: 4,
      adhocracy_affinity: 3,
      market_affinity: 2,
      hierarchy_affinity: 3,
      psychological_safety: 4,
    },
    TEAM_MEMBER: {
      clan_affinity: 5,
      adhocracy_affinity: 2,
      market_affinity: 2,
      hierarchy_affinity: 2,
      psychological_safety: 5,
    },
  },
};

const MOCK_BARS_OVERRIDES: BarsOverride[] = [
  {
    dimension: 'ownership',
    anchor_level: 5,
    base_anchor_text: 'static level 5 text',
    override_anchor_text:
      'Level 5 for this team requires the candidate to have rewritten a runbook or an oncall process and verified the downstream rotation reduction with data.',
    source_chain_id: 'chain-hm-bar-1',
    approved_by: 'recruiter-1',
    approved_at: '2026-04-10T12:00:00Z',
  },
];

const MOCK_DEALBREAKERS: DealbreakerRecord[] = [
  {
    id: 'db-1',
    label: 'Will not pair',
    pattern: 'i prefer to work alone',
    source_stakeholder: 'TEAM_MEMBER',
    source_chain_id: 'chain-tm-team-1',
    job_relatedness_note:
      'The team requires daily pairing per the hiring manager and team member; candidates who refuse pairing cannot meet the observable job requirements.',
    job_relatedness_strength: 'strong',
    evidence_quote: 'Pairing is critical for us',
  },
];

function buildMockRcd(): RoleContextDocument {
  return {
    rcd_version: 'rcd-v1',
    role_context_id: 'rc-test-phase2',
    pipeline_id: 'pipe-phase2',
    created_at: '2026-04-10T00:00:00Z',
    domain_matrix: {
      HIRING_MANAGER: {
        team: {
          primary_authority: true,
          coverage: 'covered',
          laddering_chains: [],
          open_codes: ['pairing_required'],
          axial_links: [],
          stories: [],
          summary: 'The HM expects daily pairing on this team.',
        },
      },
      TEAM_MEMBER: {
        team: {
          primary_authority: true,
          coverage: 'deep',
          laddering_chains: [],
          open_codes: ['pairing_daily'],
          axial_links: [],
          stories: [],
          summary: 'Pairing is daily practice, not optional.',
        },
      },
    },
    conflicts: [],
    technical_context: {
      stack: ['TypeScript'],
      constructs: ['pairing_ritual'],
      seniority_band: 'senior',
      codebase_expectations: ['monorepo'],
      dispositional_weights: { ownership: 0.6, collaboration: -0.4 },
    },
    team_culture_profile: MOCK_TEAM_CULTURE_PROFILE,
    bars_overrides: [],
    probe_bank_enrichment: {
      static_base_version: 'v1',
      enriched_probes: [],
    },
    dealbreakers: MOCK_DEALBREAKERS,
    red_flags: [],
    consumer_slice: {
      seniority: 'senior',
      archetype: 'Senior IC',
      mustHaveSkills: ['TypeScript'],
      niceToHaveSkills: [],
      disposition: ['collaborative'],
      careerSignal: 'has pair programmed in production',
      redFlags: [],
      dealbreakers: ['will not pair'],
    },
    validation_metadata: {
      schema_version: 'rcd-v1',
      synthesis_model: 'mock-gemma',
      synthesis_prompt_version: 'rcd-synthesis-v1',
      verification_pass_model: 'mock-gemma',
      face_validity_reviewed_at: null,
      face_validity_reviewer: null,
    },
  };
}

// ─── D1 stub ────────────────────────────────────────────────────────────────

interface StubRow {
  [key: string]: unknown;
}

/**
 * Minimal D1Database stub that matches on SQL prefix and returns canned rows.
 * Only supports the calls the cultureRoleResolution + cultureProbeBank
 * modules issue — the whole point of this test is to exercise those modules,
 * not the D1 client.
 */
function buildStubDb(config: {
  roleContextRow: StubRow | null;
  probeBankRows: StubRow[];
}): D1Database {
  const prepare = (sql: string): unknown => {
    const statement = {
      bind: (..._args: unknown[]) => ({
        first: async <T>(): Promise<T | null> => {
          if (sql.includes('role_contexts')) {
            return (config.roleContextRow as T | null) ?? null;
          }
          return null;
        },
        all: async <T>(): Promise<{ results: T[] }> => {
          if (sql.includes('role_probe_bank')) {
            return { results: config.probeBankRows as T[] };
          }
          return { results: [] };
        },
        run: async () => ({ success: true }),
      }),
    };
    return statement;
  };
  return { prepare } as unknown as D1Database;
}

// ─── 1. resolveCultureRoleContext reads RCD ─────────────────────────────────

describe('resolveCultureRoleContext (RCD path)', () => {
  it('returns a populated Team Context when rcd_json is present', async () => {
    const rcd = buildMockRcd();
    const db = buildStubDb({
      roleContextRow: {
        id: 'rc-test-phase2',
        rcd_version: 'rcd-v1',
        rcd_json: JSON.stringify(rcd),
        persona_json: null,
        bars_overrides: JSON.stringify(MOCK_BARS_OVERRIDES),
      },
      probeBankRows: [],
    });

    const resolution = await resolveCultureRoleContext(db, 'assessment-1');

    expect(resolution.seniority).toBe('senior');
    expect(resolution.roleOverlayId).toBe('senior-ic');
    expect(hasTeamContext(resolution)).toBe(true);
    if (!hasTeamContext(resolution)) return;

    expect(resolution.teamContext.rcdVersion).toBe('rcd-v1');
    expect(resolution.teamContext.roleContextId).toBe('rc-test-phase2');
    expect(resolution.teamContext.teamCultureProfile).toEqual(MOCK_TEAM_CULTURE_PROFILE);
    expect(resolution.teamContext.dispositionalWeights).toEqual({
      ownership: 0.6,
      collaboration: -0.4,
    });
    expect(resolution.teamContext.dealbreakers).toHaveLength(1);
    expect(resolution.teamContext.dealbreakers[0]!.id).toBe('db-1');
    // BARS overrides come from the column, not the synthesis draft.
    expect(resolution.teamContext.barsOverrides).toHaveLength(1);
    expect(resolution.teamContext.barsOverrides[0]!.dimension).toBe('ownership');
    // Team domain cells are hoisted for downstream selectors.
    expect(resolution.teamContext.teamDomainCells.hiringManager?.summary).toContain('pairing');
    expect(resolution.teamContext.teamDomainCells.teamMember?.summary).toContain('daily practice');
  });

  it('falls back to persona_json path when rcd_json is absent', async () => {
    const db = buildStubDb({
      roleContextRow: {
        id: 'rc-legacy',
        rcd_version: null,
        rcd_json: null,
        persona_json: JSON.stringify({
          seniority: 'engineering manager, 8 years',
          archetype: 'Engineering Manager',
        }),
        bars_overrides: null,
      },
      probeBankRows: [],
    });

    const resolution = await resolveCultureRoleContext(db, 'assessment-legacy');

    expect(resolution.seniority).toBe('manager');
    expect(resolution.roleOverlayId).toBe('manager');
    expect(resolution.teamContext).toBeNull();
  });

  it('returns fallback when no role context row exists', async () => {
    const db = buildStubDb({ roleContextRow: null, probeBankRows: [] });
    const resolution = await resolveCultureRoleContext(db, 'assessment-missing');
    expect(resolution.seniority).toBe('mid');
    expect(resolution.roleOverlayId).toBe('universal');
    expect(resolution.teamContext).toBeNull();
  });
});

// ─── 2. Probe bank loader + selector integration ────────────────────────────

describe('loadRoleProbeBank + pickNextQuestion', () => {
  it('loads enriched probes grouped by dimension', async () => {
    const db = buildStubDb({
      roleContextRow: null,
      probeBankRows: [
        {
          id: 'p1',
          dimension: 'ownership',
          probe_text: 'Did you escalate that runbook change?',
          source: 'rcd_enriched',
          source_chain_id: 'chain-1',
          rcd_version: 'rcd-v1',
        },
        {
          id: 'p2',
          dimension: 'ownership',
          probe_text: 'Who picked up oncall after you left?',
          source: 'rcd_enriched',
          source_chain_id: 'chain-1',
          rcd_version: 'rcd-v1',
        },
        {
          id: 'p3',
          dimension: 'collaboration',
          probe_text: 'What did pairing look like that week?',
          source: 'rcd_enriched',
          source_chain_id: 'chain-2',
          rcd_version: 'rcd-v1',
        },
      ],
    });

    const bank = await loadRoleProbeBank(db, 'rc-test-phase2');
    expect(bank.ownership).toHaveLength(2);
    expect(bank.collaboration).toHaveLength(1);
    expect(enrichedProbeCount(bank, ['ownership', 'collaboration'])).toBe(3);
  });

  it('returns empty bank on null role context id', async () => {
    const db = buildStubDb({ roleContextRow: null, probeBankRows: [] });
    const bank = await loadRoleProbeBank(db, null);
    expect(bank).toEqual({});
  });

  it('merges enriched probes into the picked question via pickNextQuestion', async () => {
    const bank = {
      ownership: [
        {
          id: 'p1',
          dimension: 'ownership' as const,
          text: 'Did you escalate that runbook change?',
          source: 'rcd_enriched' as const,
          sourceChainId: 'chain-1',
          rcdVersion: 'rcd-v1',
        },
      ],
    };

    const picked = pickNextQuestion({
      coverage: {
        ownership: 0,
        collaboration: 0,
        'learning-orientation': 0,
        'conflict-handling': 0,
        'self-awareness': 0,
      },
      askedIds: new Set(),
      seniority: 'senior',
      roleOverlayId: 'senior-ic',
      probeBank: bank,
    });

    expect(picked).not.toBeNull();
    // The winner should be an ownership-dimension question (boosted by bank).
    expect(picked!.dimensions).toContain('ownership');
    // Enriched probe is merged under a synthetic slot key.
    const probesMap = picked!.probes as Record<string, string>;
    const hasEnriched = Object.keys(probesMap).some((k) => k.startsWith('enriched_'));
    expect(hasEnriched).toBe(true);
  });

  it('leaves the question unchanged when the bank is empty for its dimensions', () => {
    const q = CULTURE_QUESTION_BANK[0]!;
    const merged = mergeEnrichedProbes(q, {});
    expect(merged).toBe(q);
  });
});

// ─── 3. BARS overrides ──────────────────────────────────────────────────────

describe('applyBarsOverrides', () => {
  it('substitutes approved anchor text for the overridden level only', () => {
    const staticRubric = COMPETENCY_BARS_RUBRICS.ownership.rubric;
    const { rubric, overridden } = applyBarsOverrides('ownership', staticRubric, MOCK_BARS_OVERRIDES);

    expect(overridden).toBe(true);
    expect(rubric.level5).toContain('rewritten a runbook');
    // Untouched levels are preserved verbatim.
    expect(rubric.level1).toBe(staticRubric.level1);
    expect(rubric.level4).toBe(staticRubric.level4);
  });

  it('returns the static rubric unchanged when no overrides match the dimension', () => {
    const staticRubric = COMPETENCY_BARS_RUBRICS.collaboration.rubric;
    const { rubric, overridden } = applyBarsOverrides('collaboration', staticRubric, MOCK_BARS_OVERRIDES);
    expect(overridden).toBe(false);
    expect(rubric).toBe(staticRubric);
  });

  it('ignores overrides with out-of-range anchor levels', () => {
    const staticRubric = COMPETENCY_BARS_RUBRICS.ownership.rubric;
    const { rubric, overridden } = applyBarsOverrides('ownership', staticRubric, [
      { ...MOCK_BARS_OVERRIDES[0]!, anchor_level: 99 },
    ]);
    expect(overridden).toBe(false);
    expect(rubric.level5).toBe(staticRubric.level5);
  });
});

// ─── 4. Dispositional weight, sign-preserved ────────────────────────────────

describe('applyDispositionalWeight', () => {
  it('shifts a midpoint score up by +1 when weight is +0.6', () => {
    expect(applyDispositionalWeight(3, 0.6)).toBe(4);
  });

  it('shifts a midpoint score down by -1 when weight is -0.6', () => {
    expect(applyDispositionalWeight(3, -0.6)).toBe(2);
  });

  it('clamps at the upper bound — cannot exceed 5 regardless of weight magnitude', () => {
    expect(applyDispositionalWeight(5, 5)).toBe(5);
    expect(applyDispositionalWeight(5, 0.9)).toBe(5);
  });

  it('clamps at the lower bound — cannot fall below 1 regardless of weight magnitude', () => {
    expect(applyDispositionalWeight(1, -5)).toBe(1);
    expect(applyDispositionalWeight(1, -0.9)).toBe(1);
  });

  it('cannot zero out a dimension — the clamped shift is at most ±1 per call', () => {
    // Even a wildly negative weight can only move a raw=3 to raw=2, not below.
    expect(applyDispositionalWeight(3, -100)).toBe(2);
    expect(applyDispositionalWeight(3, 100)).toBe(4);
  });

  it('returns the raw score unchanged when weight is 0 or non-finite', () => {
    expect(applyDispositionalWeight(3, 0)).toBe(3);
    expect(applyDispositionalWeight(3, Number.NaN)).toBe(3);
    expect(applyDispositionalWeight(3, Number.POSITIVE_INFINITY)).toBe(3);
  });
});

// ─── 5. Dealbreaker HITL flags ──────────────────────────────────────────────

describe('evaluateDealbreakers', () => {
  function buildTranscriptWithAnswer(text: string): CultureTranscript {
    const t = defaultCultureTranscript();
    t.turns.push({
      idx: 0,
      questionId: 'test-q',
      questionText: 'What is your work style?',
      probeOf: null,
      candidateResponse: text,
      starSlots: null,
      timestamp: '2026-04-10T00:00:00Z',
    });
    return t;
  }

  it('matches a dealbreaker pattern case-insensitively in any candidate response', () => {
    const transcript = buildTranscriptWithAnswer(
      'Honestly, I PREFER TO WORK ALONE most of the time and only loop people in when I need review.',
    );
    const flags = evaluateDealbreakers(MOCK_DEALBREAKERS, transcript);
    expect(flags).toHaveLength(1);
    expect(flags[0]!.matched).toBe(true);
    expect(flags[0]!.matchedQuote).toContain('WORK ALONE');
    expect(flags[0]!.jobRelatednessStrength).toBe('strong');
    expect(flags[0]!.jobRelatednessNote).toContain('pairing');
  });

  it('surfaces the dealbreaker with matched=false when no match is found (audit trail)', () => {
    const transcript = buildTranscriptWithAnswer(
      'I love pair programming and did it every day at my last job.',
    );
    const flags = evaluateDealbreakers(MOCK_DEALBREAKERS, transcript);
    expect(flags).toHaveLength(1);
    expect(flags[0]!.matched).toBe(false);
    expect(flags[0]!.matchedQuote).toBeNull();
  });

  it('returns an empty array when the team context has no dealbreakers', () => {
    const transcript = buildTranscriptWithAnswer('Anything here is fine.');
    expect(evaluateDealbreakers([], transcript)).toEqual([]);
  });
});

// ─── 6. Scoring provider boundary with team context ─────────────────────────

describe('scoreCultureInterview with teamContext and no provider', () => {
  it('rejects instead of fabricating neutral culture scores', async () => {
    const transcript = defaultCultureTranscript();
    await expect(scoreCultureInterview({
      provider: null,
      transcript,
      orgBenchmark: MOCK_ORG_BENCHMARK,
      teamContext: {
        rcdVersion: 'rcd-v1',
        roleContextId: 'rc-test-phase2',
        teamCultureProfile: MOCK_TEAM_CULTURE_PROFILE,
        dispositionalWeights: { ownership: 0.6 },
        teamDomainCells: { hiringManager: null, teamMember: null },
        barsOverrides: MOCK_BARS_OVERRIDES,
        dealbreakers: MOCK_DEALBREAKERS,
      },
    })).rejects.toMatchObject({
      name: 'CultureScorerUnavailableError',
      provider: null,
    } satisfies Partial<CultureScorerUnavailableError>);
  });
});
