/**
 * Culture Scorer — multi-agent scoring pipeline for completed culture interviews.
 *
 * ### What this module does
 *
 * Called by the route handler after `advanceCultureInterview` returns
 * `action: 'terminate'`. Accepts the full `CultureTranscript` plus an
 * `OrgCultureBenchmark` and returns a `CultureScoreReport`.
 *
 * The pipeline fires 11 Gemma calls:
 *   - 5 in parallel: one per behavioral competency dimension (BARS rubric scoring)
 *   - 5 in parallel: one per culture profile axis (position on a 1–5 spectrum)
 *   - 1 sequential: synthesis narrative + recommendation
 *
 * The 10 parallel calls use `Promise.all` so the wall-clock cost is dominated
 * by one call, not ten. The synthesis call runs after all dimensions are scored
 * because the narrative is grounded in the aggregated dimension scores.
 *
 * ### Why one specialist per dimension (research §2.2)
 *
 * Huynh et al. 2025 demonstrate that asking a single LLM to simultaneously
 * evaluate multiple soft-skill criteria causes cross-criterion interference —
 * the model anchors on the most salient signal and distorts adjacent scores.
 * One focused prompt per criterion, each with balanced 3-shot calibration
 * examples, achieves QWK ≈ 0.62 (human expert agreement range is 0.55–0.65).
 * That is the architecture this module implements.
 *
 * ### Phase C note
 *
 * The inline BARS rubric table (`COMPETENCY_BARS_RUBRICS`) and profile
 * position descriptors (`CULTURE_PROFILE_BARS`) are the source of truth for
 * MVP scoring. Phase C will introduce a wiki-sync script
 * (`scripts/sync-culture-wiki.ts`) that reads `knowledge/culture/dimensions/*.md`
 * and regenerates this file's rubric constants automatically. Until then,
 * rubric changes must be made here and in the wiki by hand.
 */

import type { LLMProvider, LLMMessage } from './llm/types';
import type { CultureTranscript } from './cultureAgent';
import { COMPETENCY_DIMENSIONS, type CompetencyDimension } from './cultureQuestionBank';
import type { CultureTeamContext } from './cultureRoleResolution';
import type { BarsOverride, DealbreakerRecord } from '../types';
import {
  buildCompetencyScorerSystemPrompt,
  buildCompetencyScorerUserMessage,
  buildCultureProfileScorerSystemPrompt,
  buildCultureProfileUserMessage,
  buildSynthesisSystemPrompt,
  buildSynthesisUserMessage,
  type BarsRubric,
  type CultureProfileDimension,
} from './cultureScorerPrompts';

// ─── Public types ─────────────────────────────────────────────────────────────

/** All 5 culture-profile axes that PIPE scores. */
export const CULTURE_PROFILE_DIMENSIONS: readonly CultureProfileDimension[] = [
  'autonomy',
  'risk-tolerance',
  'work-pace',
  'collaboration-style',
  'feedback-orientation',
] as const;

export interface CompetencyScoreResult {
  dimension: CompetencyDimension;
  /**
   * Adjusted 1–5 BARS score the recruiter UI displays. When a dispositional
   * weight is applied, this is `rawScore` shifted by the weight delta, clamped
   * to [1,5]. When no weight is set, `adjustedScore === rawScore`.
   */
  score: 1 | 2 | 3 | 4 | 5;
  /** Unmodified model-emitted score before any RCD dispositional weight. */
  rawScore: 1 | 2 | 3 | 4 | 5;
  /** Dispositional weight applied from the RCD (in [-1, +1]); 0 when none. */
  dispositionalWeight: number;
  /** True if any BARS level text was swapped for an RCD-approved override. */
  barsOverrideApplied: boolean;
  /** Verbatim candidate quotes that ground the score (§6.5 explainability). */
  evidenceQuotes: string[];
  /** 0–1 epistemic confidence in the score given transcript coverage. */
  confidence: number;
  /** One-paragraph explanation citing adjacent BARS levels. */
  reasoning: string;
  /** Number of re-prompts issued for ungrounded scores (0 or 1). */
  repromptCount: number;
  /** Original score before re-prompt (populated only when repromptCount > 0). */
  originalScore?: number;
  /** Original confidence before re-prompt (populated only when repromptCount > 0). */
  originalConfidence?: number;
}

export interface CultureProfileScoreResult {
  dimension: CultureProfileDimension;
  /** Where the candidate sits on the 1–5 axis. Not a quality score. */
  candidatePosition: 1 | 2 | 3 | 4 | 5;
  /** Verbatim candidate quotes that ground the position estimate. */
  evidenceQuotes: string[];
  /** 0–1 epistemic confidence in the position estimate. */
  confidence: number;
  /** Reasoning explaining why adjacent positions were not chosen. */
  reasoning: string;
  /** Number of re-prompts issued for ungrounded scores (0 or 1). */
  repromptCount: number;
  /** Original position before re-prompt (populated only when repromptCount > 0). */
  originalPosition?: number;
  /** Original confidence before re-prompt (populated only when repromptCount > 0). */
  originalConfidence?: number;
}

/**
 * Explicit numeric culture profile for an organization.
 * Set once per pipeline by the recruiter (or defaulted to org average).
 * Each value is a position on a 1–5 axis, not a quality rating.
 *
 * @see ADR-030 §Culture Profile; research brief §3.2 and §3.4
 */
export interface OrgCultureBenchmark {
  autonomy: 1 | 2 | 3 | 4 | 5;
  riskTolerance: 1 | 2 | 3 | 4 | 5;
  workPace: 1 | 2 | 3 | 4 | 5;
  collaborationStyle: 1 | 2 | 3 | 4 | 5;
  feedbackOrientation: 1 | 2 | 3 | 4 | 5;
}

/**
 * HITL-gated dealbreaker flag surfaced to the recruiter when the scorer
 * detects evidence matching an RCD-approved dealbreaker pattern. Never
 * auto-fails a candidate (Griggs / Uniform Guidelines / EEOC v. iTutorGroup /
 * EU AI Act Art 14). The recruiter must review and confirm or override
 * before the session advances.
 */
export interface DealbreakerFlag {
  dealbreakerId: string;
  label: string;
  pattern: string;
  /** The verbatim transcript quote that ground the flag, if one was matched. */
  matchedQuote: string | null;
  /** Whether the pattern was actually matched against transcript turns. */
  matched: boolean;
  /** Copied from the RCD for the Griggs business-necessity defense. */
  jobRelatednessNote: string;
  jobRelatednessStrength: 'strong' | 'moderate' | 'weak';
  /** Source stakeholder per the RCD — audit trail only, never displayed raw. */
  sourceStakeholder: string;
  /** Pointer into an RCD laddering chain for the audit trail. */
  sourceChainId: string;
}

export interface CultureScoreReport {
  competencyScores: CompetencyScoreResult[];
  profileScores: CultureProfileScoreResult[];
  /** Dealbreaker flags from the RCD — empty when no RCD or no matches. */
  dealbreakerFlags: DealbreakerFlag[];
  /** True when any flag was raised — blocks advancement until HITL review. */
  hitlReviewRequired: boolean;
  synthesis: {
    headline: string;
    narrative: string;
    recommendation: 'HIRE' | 'FLAG_FOR_REVIEW' | 'PASS';
  };
  orgBenchmark: OrgCultureBenchmark;
  /** ISO timestamp when the scoring pipeline completed. */
  scoredAt: string;
}

export class CultureScorerUnavailableError extends Error {
  readonly provider: string | null;

  constructor(reason: string, provider: LLMProvider | string | null = null) {
    super(reason);
    this.name = 'CultureScorerUnavailableError';
    this.provider = typeof provider === 'string' ? provider : provider?.name ?? null;
  }
}

// ─── BARS rubric table ────────────────────────────────────────────────────────
// One honest craft-quality 5-level BARS rubric per competency dimension, plus
// 3 calibration quotes (Low / Medium / High) drawn from plausible candidate
// answer patterns.
//
// Anchoring style follows research brief §2.1 and §2.2: each level describes
// observable behaviors in a past-behavior answer, not trait labels or
// personality descriptors. Level 1 describes concrete failure modes (passive,
// vague, team-attributed). Level 5 requires quantified outcomes, explicit
// personal attribution, AND demonstrated reflection or system-change.
//
// TODO (Phase C): Replace inline constants with wiki-sync output from
// `scripts/sync-culture-wiki.ts`. Keep this shape identical to the generated
// output so the migration is a drop-in.

interface CompetencyRubricEntry {
  rubric: BarsRubric;
  calibration: { low: string; medium: string; high: string };
}

export const COMPETENCY_BARS_RUBRICS: Record<CompetencyDimension, CompetencyRubricEntry> = {
  ownership: {
    rubric: {
      level1:
        'No specific example, or describes a team effort in which the candidate\'s personal role is absent. Uses "we" throughout with no distinct personal action. May claim ownership in the abstract without any behavioral evidence.',
      level2:
        'Provides a real example but the personal contribution is peripheral or reactive — candidate noticed a problem but waited to be assigned to it, or their action was one small step inside a larger managed effort they did not initiate.',
      level3:
        'Describes a situation where the candidate stepped in voluntarily or above their job scope, with clear personal actions in first person. Outcome is mentioned but may be generic ("it worked out", "the issue was resolved"). Reflection absent or surface-level.',
      level4:
        'Stepped beyond assigned scope, describes a sequence of specific personal actions with named tools, people, or decisions, and reports a concrete measurable outcome (timelines, metrics, or team impact). Some evidence of learning or changed behavior after the event.',
      level5:
        'Multiple-turn evidence of taking on unassigned responsibility at meaningful scope and risk. Personal actions are granular and causally linked to a quantified outcome. Explicit reflection on what they learned AND a downstream change they made to prevent recurrence or scale the solution. No passivity — active subject throughout.',
    },
    calibration: {
      low: 'Our team dealt with the on-call rotation issue and eventually we got it sorted out.',
      medium:
        'I noticed the runbook was out of date so I rewrote it over a weekend — after that, new engineers onboarded faster.',
      high: 'The payment service was timing out in prod and it wasn\'t my squad\'s system, but I traced the latency spike to a misconfigured connection pool, submitted a PR with a fix and a load-test showing 40% latency drop, got it merged in under two hours, and then added a canary alert so we\'d catch this class of issue automatically going forward.',
    },
  },

  collaboration: {
    rubric: {
      level1:
        'Describes collaboration in platitudes ("I\'m a team player", "we all worked well together") with no specific joint-work example. Or describes a situation where collaboration was passive — candidate was pulled in, not someone who shaped the collaboration.',
      level2:
        'Provides a real example of working with others, but the candidate\'s specific contribution to the joint work is unclear. May describe the team\'s outcome without distinguishing personal role. Conflict or friction is absent or glossed over.',
      level3:
        'Names a specific collaborative effort, describes their distinct contribution, and shows awareness of a differing perspective or friction point. Acknowledges what the other person brought. Outcome attributed jointly but candidate\'s piece is visible.',
      level4:
        'Describes a collaboration that required navigating a real difference — in approach, authority, or working style. Candidate adapted their communication or process, names what they changed, and the outcome reflects the joint work rather than one person\'s vision. Shows genuine respect for the other perspective.',
      level5:
        'Provides multiple turns of evidence of collaboration across team, authority, or discipline boundaries. Demonstrates calibrated adaptation: can name specifically what about their own style they adjusted and why, and describes the resulting outcome as genuinely better than either party\'s individual approach would have been. Shows curiosity about others\' constraints.',
    },
    calibration: {
      low: 'We worked together on the migration and everyone pulled their weight.',
      medium:
        'My counterpart on the design side and I had different ideas about the information architecture. I walked through my reasoning with her and we landed on a hybrid that used her navigation model with my content hierarchy.',
      high: 'The platform team had a completely different risk tolerance than we did — they wanted six weeks of validation and we needed to ship in two. I set up a joint retro to surface the underlying constraints instead of just escalating. We ended up co-designing a staged rollout with automated rollback that satisfied both concerns, and the platform lead later told me it became their default for cross-team deploys.',
    },
  },

  'learning-orientation': {
    rubric: {
      level1:
        'No specific learning event described, or candidate describes learning through passive exposure ("I picked it up over time"). Unable or unwilling to name a concrete skill gap or incorrect belief they held. Generic statements about "always being curious."',
      level2:
        'Describes a learning moment but it is externally triggered with no evidence of the candidate actively seeking it (e.g., a manager told them they were wrong, a project failed and they absorbed the post-mortem). The learning is acknowledged but no behavioral change is described.',
      level3:
        'Names a specific incorrect belief or skill gap, describes what triggered the update, and can say concretely what they did differently afterward. The example is real and specific — a named technology, decision, or approach — not a category.',
      level4:
        'Describes proactively seeking learning beyond what the role required. Has a concrete study or experimentation method (side projects, deliberate practice, external reading), and can describe measurable progress. Shows intellectual honesty: willing to name a belief they held confidently and abandoned.',
      level5:
        'Describes a pattern of self-directed learning with evidence of iteration: not just acquiring new knowledge but updating priors based on evidence, seeking disconfirming feedback, and applying learning to create new capability visible to others. Can name specific moments where they were confidently wrong and changed not just their behavior but their mental model.',
    },
    calibration: {
      low: 'I\'m always looking to learn new things — I read tech blogs and stay current.',
      medium:
        'I was convinced distributed transactions were the right solution for our data model until a colleague showed me a talk by Pat Helland that changed my thinking. I rebuilt the approach around event sourcing and the result was much simpler.',
      high: 'I spent three years believing that good tests meant high code coverage. After working with a property-based testing advocate at my last job I realized I\'d been optimizing the wrong thing — I was testing implementation, not behavior. I ran a study group to re-examine our test suite, reduced the count by 40% while tripling the defect-catch rate, and gave a company-wide talk on what I\'d gotten wrong.',
    },
  },

  'conflict-handling': {
    rubric: {
      level1:
        'Avoids the conflict example entirely, describes a conflict that resolved itself without their intervention, or describes a situation where they deferred or capitulated without engaging the substance of the disagreement. May describe conflict as something that "doesn\'t really happen" on their teams.',
      level2:
        'Describes a real conflict but the candidate\'s handling was passive or procedural — they escalated immediately, waited for a manager to decide, or expressed their opinion once and dropped it. The disagreement is described from their perspective only; little evidence of genuinely engaging the other view.',
      level3:
        'Named a specific disagreement, states their own position clearly, and describes a genuine attempt to understand the opposing view. The resolution is described, and both parties are credited. May have escalated appropriately after direct conversation failed. Shows no lasting interpersonal damage.',
      level4:
        'Demonstrates structured pushback: framed their disagreement with evidence or principles, invited the other party to do the same, and sought a resolution that addressed both underlying concerns — not just a compromise that leaves both parties partially dissatisfied. Can distinguish between "I was right and they were wrong" and "we each saw something the other missed."',
      level5:
        'Evidence across multiple turns of productive disagreement: can describe a situation where they pushed back successfully AND one where they were persuaded to change their position. Demonstrates disagreement as a tool for better outcomes rather than positional combat. Shows capacity to hold a minority view under social pressure without becoming combative or brittle.',
    },
    calibration: {
      low: 'We had a disagreement about the architecture but the team talked it through and we found a solution that worked.',
      medium:
        'My manager wanted to ship a feature without instrumentation. I pushed back in a 1:1, walked through the risks, and we agreed on shipping with basic event logging first and adding full analytics in the next sprint.',
      high: 'The CPO had made a public commitment to a launch date I believed was irresponsible from a data-quality standpoint. I wrote a one-pager with three scenarios and their risk profiles, requested time in the next leadership review, presented it cold, and accepted when the CPO acknowledged the risk but overrode my recommendation. I shipped it cleanly, documented the tradeoffs in the ADR, and filed the follow-up ticket to address the quality debt. Three months later the CPO proactively cited that interaction as the kind of pushback they wanted more of.',
    },
  },

  'self-awareness': {
    rubric: {
      level1:
        'Cannot name a genuine weakness, blind spot, or past error with any specificity. Produces a disguised strength ("I work too hard"), deflects to external causes, or describes feedback they received but clearly did not integrate. Shows no curiosity about their own patterns.',
      level2:
        'Names a weakness or blind spot but the description is abstract, has no behavioral evidence, and lacks any account of what they do to manage it. The weakness is acknowledged intellectually but not demonstrated through a real example of it causing a problem.',
      level3:
        'Describes a real, specific weakness or blind spot with a concrete example of it manifesting in their work. Has a named coping strategy or compensation tactic. Acknowledges impact on others. May not have resolved the underlying pattern but is clearly aware of it.',
      level4:
        'Provides a real weakness with behavioral evidence, describes how they discovered it (ideally through external feedback, not self-assessment), names a specific change they made, and can report on whether the change worked. Shows genuine ownership of the gap rather than minimizing it.',
      level5:
        'Demonstrates a pattern of self-insight developed over time. Can describe the same blind spot appearing in multiple contexts and evolving. Can distinguish between "behaviors I\'ve changed" and "patterns I still actively manage." Describes seeking feedback specifically about this area, integrating it, and updating their approach. Shows that self-awareness is a practice, not a static trait.',
    },
    calibration: {
      low: 'I sometimes care too much about quality and have to remind myself not to gold-plate things.',
      medium:
        'I have a tendency to take over problems when I see a faster path — I\'ve had to learn to hold back and let teammates work through things at their own pace, even when it\'s slower.',
      high: 'Three performance reviews in a row mentioned that I\'m hard to read in disagreements — I go quiet instead of signaling that I\'m processing. I used to dismiss this as introverted-style noise. After a specific incident where a team lead thought I\'d disengaged from a project when I was actually deeply invested, I started ending meetings with an explicit "here\'s where I am on this" signal. My skip-level told me six months later that the team\'s trust in me had visibly improved. I still default to quiet but I know the trigger and I\'ve built a habit around it.',
    },
  },
};

// ─── Culture profile position descriptors ────────────────────────────────────
// One 5-point behavioral descriptor set per culture profile dimension.
// Position 1 is the left/low end; position 5 is the right/high end.
// Neither extreme is inherently better — the description is behavioral, not
// evaluative. The org benchmark sits somewhere on the same scale.
//
// TODO (Phase C): Sync from `knowledge/culture/dimensions/profiles/*.md`.

interface ProfileEntry {
  positionDescriptors: Record<1 | 2 | 3 | 4 | 5, string>;
}

export const CULTURE_PROFILE_BARS: Record<CultureProfileDimension, ProfileEntry> = {
  autonomy: {
    positionDescriptors: {
      1: 'Strongly prefers to work within clear structures and explicit direction. Seeks manager alignment before acting on ambiguous problems. Describes discomfort or decreased effectiveness in roles without defined expectations.',
      2: 'Works comfortably within established processes and asks for clarity on priorities before proceeding independently. Takes initiative within well-defined lanes but checks in before expanding scope.',
      3: 'Adapts readily to both structured and autonomous environments. Can self-direct when needed but also functions well with regular alignment. Does not express strong preference either way.',
      4: 'Prefers to own problems end-to-end with minimal check-ins. Defines their own scope and success criteria, seeks manager input on blockers rather than direction. Describes frustration with micromanagement.',
      5: 'Operates most effectively when given a goal and left to define the path. Describes best work periods as ones with high autonomy and few process constraints. Struggles when required to get approval for decisions they believe they are qualified to make.',
    },
  },

  'risk-tolerance': {
    positionDescriptors: {
      1: 'Describes decision-making in terms of minimizing downside risk. Preferences for incremental changes, extensive validation, and staged rollouts. Discomfort with ambiguity and reversible-feeling decisions.',
      2: 'Cautious but not paralyzed — will act on incomplete information with sufficient validation. Describes setbacks as motivating post-mortems and improved process, not as evidence that speed was wrong.',
      3: 'Contextually calibrated risk tolerance — more conservative in high-stakes or irreversible situations, more willing to move fast in low-stakes reversible ones. Can articulate the distinction.',
      4: 'Comfortable making consequential decisions with incomplete data. Describes fast action followed by iteration as preferred mode. Has examples of making the call before the team had consensus and being comfortable with that.',
      5: 'Thrives in high-ambiguity, high-velocity environments. Describes best work as shipping something imperfect fast and learning from it. May describe past environments as too slow. Has examples of taking consequential bets they drove despite significant uncertainty.',
    },
  },

  'work-pace': {
    positionDescriptors: {
      1: 'Describes productive work as deep, sustained focus on one problem at a time. Prefers long horizons, careful deliberation, and thorough execution over speed. May describe fast environments as anxiety-inducing or quality-damaging.',
      2: 'Works best with clear priorities and reasonable timelines. Can switch contexts but needs transition time. Describes best output as coming from focused sprints rather than sustained fragmentation.',
      3: 'Productive across a range of paces. Can sustain both rapid iteration cycles and slower deep-work modes. Does not describe speed itself as intrinsically positive or negative.',
      4: 'Describes high pace as energizing. Comfortable with rapid context switching, short feedback loops, and re-prioritization. May describe slow environments as frustrating or under-stimulating.',
      5: 'Most effective in high-velocity environments with constant change. Describes the ability to hold many parallel threads and ship incrementally as core to how they work. May describe slow-paced teams as difficult to work in long-term.',
    },
  },

  'collaboration-style': {
    positionDescriptors: {
      1: 'Works most effectively in clearly defined individual ownership with minimal handoffs. Describes best work as solo deep-work with async feedback at natural checkpoints. Describes pair programming, mob programming, or continuous sync as distracting rather than additive.',
      2: 'Collaborative when the task requires it but defaults to individual execution. Seeks alignment on direction, then prefers to execute independently and bring results back for review.',
      3: 'Adaptive collaboration — will structure work as individual or joint depending on the problem complexity and team preference. Neither strongly prefers solo work nor continuous collaboration.',
      4: 'Collaborative by default — thinks better in discussion, prefers to develop ideas with others rather than alone. Describes best work as emerging from tight-loop team interaction rather than individual output.',
      5: 'Highly collaborative style — finds individual work less effective than working closely with others. Describes mob programming, whiteboarding, or pair work as productive rather than distracting. May describe isolation as decreasing output quality.',
    },
  },

  'feedback-orientation': {
    positionDescriptors: {
      1: 'Preferences for receiving feedback in formal, structured settings (performance reviews, scheduled 1:1s). Describes unsolicited or direct feedback as uncomfortable without prior relationship building. May describe directness as culturally abrasive.',
      2: 'Receptive to feedback from trusted sources in private settings. Values tact and relationship context. Can engage with direct feedback but prefers it to come with explanation rather than as unqualified observation.',
      3: 'Comfortable with regular feedback in both formal and informal settings. Can receive direct or challenging feedback without significant defensiveness, though may need processing time. Gives feedback thoughtfully.',
      4: 'Actively seeks feedback, including critical and unsolicited input. Describes feedback as a regular input to improving work rather than a special event. Has examples of asking for critique and acting on it promptly.',
      5: 'Highly feedback-seeking style — builds feedback loops into their workflow. Describes real-time critique, aggressive code review, and radical candor environments as productive rather than uncomfortable. May describe cultures that buffer feedback as slowing growth.',
    },
  },
};

// ─── Entry point ─────────────────────────────────────────────────────────────

export interface ScoreCultureInterviewInput {
  /** Cloudflare AI provider. Null means culture scoring is unavailable. */
  provider: LLMProvider | null;
  /** The completed transcript from the culture interview agent. */
  transcript: CultureTranscript;
  /** The organization's explicit culture profile benchmark for this pipeline. */
  orgBenchmark: OrgCultureBenchmark;
  /**
   * RCD-derived Team Context (ADR-036 Phase 2). When present, the scorer
   * applies `bars_overrides` (anchor text substitution), `dispositionalWeights`
   * (post-score magnitude adjustment, sign-preserved), and `dealbreakers`
   * (HITL flag generation). Null during the migration window — the scorer
   * degrades to the static rubric with no weights and no flags.
   */
  teamContext?: CultureTeamContext | null | undefined;
}

/**
 * Re-prompt wrapper for competency dimension scoring.
 * If the first response has empty evidenceQuotes and a non-neutral score,
 * issues one re-prompt requesting direct transcript quotes.
 */
async function scoreCompetencyDimensionWithReprompt(
  args: ScoreCompetencyArgs,
): Promise<CompetencyScoreResult> {
  const { provider, dimension, dispositionalWeight = 0 } = args;
  const { messages, overridden } = buildCompetencyScorerMessages(args);

  const content = await callProvider(provider, messages, 1024);

  let result = parseCompetencyResponse(dimension, content, {
    barsOverrideApplied: overridden,
    dispositionalWeight,
  }, provider);

  // Re-prompt on ungrounded scores (ADR-029 §6). A score without a direct
  // transcript quote is not source-backed enough to persist.
  if (result.evidenceQuotes.length === 0) {
    const originalScore = result.score;
    const originalConfidence = result.confidence;
    messages.push({ role: 'assistant', content });
    messages.push({
      role: 'user',
      content: `Your previous score for ${dimension} had no evidence quotes. Please re-score with at least one direct quote from the interview transcript supporting your rating.`,
    });

    const repromptContent = await callProvider(provider, messages, 1024);
    const repromptResult = parseCompetencyResponse(dimension, repromptContent, {
      barsOverrideApplied: overridden,
      dispositionalWeight,
    }, provider);
    if (repromptResult.evidenceQuotes.length === 0) {
      throw new CultureScorerUnavailableError(
        `Culture competency scorer for ${dimension} did not return source evidence quotes after re-prompt.`,
        provider,
      );
    }
    result = {
      ...repromptResult,
      repromptCount: 1,
      originalScore,
      originalConfidence,
    };
  }

  return result;
}

/**
 * Re-prompt wrapper for culture profile dimension scoring.
 * If the first response has empty evidenceQuotes and a non-neutral position,
 * issues one re-prompt requesting direct transcript quotes.
 */
async function scoreCultureProfileDimensionWithReprompt(
  args: ScoreProfileArgs,
): Promise<CultureProfileScoreResult> {
  const { provider, dimension } = args;
  const messages = buildCultureProfileScorerMessages(args);

  const content = await callProvider(provider, messages, 1024);

  let result = parseProfileResponse(dimension, content, provider);

  // Re-prompt on ungrounded positions (ADR-029 §6). A position estimate without
  // a direct transcript quote is not source-backed enough to persist.
  if (result.evidenceQuotes.length === 0) {
    const originalPosition = result.candidatePosition;
    const originalConfidence = result.confidence;
    messages.push({ role: 'assistant', content });
    messages.push({
      role: 'user',
      content: `Your previous position for ${dimension} had no evidence quotes. Please re-score with at least one direct quote from the interview transcript supporting your rating.`,
    });

    const repromptContent = await callProvider(provider, messages, 1024);
    const repromptResult = parseProfileResponse(dimension, repromptContent, provider);
    if (repromptResult.evidenceQuotes.length === 0) {
      throw new CultureScorerUnavailableError(
        `Culture profile scorer for ${dimension} did not return source evidence quotes after re-prompt.`,
        provider,
      );
    }
    result = {
      ...repromptResult,
      repromptCount: 1,
      originalPosition,
      originalConfidence,
    };
  }

  return result;
}

/**
 * Public entry point. Called by the route handler after the culture interview
 * agent returns `action: 'terminate'`.
 *
 * Fires all 10 dimension calls in parallel (Promise.all), then fires the
 * sequential synthesis call on the aggregated results.
 *
 * @see research brief §2.2 — parallel specialist agents for criterion isolation
 * @see research brief §2.3 (CoMAI) — summarization agent follows all scoring agents
 */
export async function scoreCultureInterview(
  input: ScoreCultureInterviewInput,
): Promise<CultureScoreReport> {
  const { provider, transcript, orgBenchmark, teamContext } = input;

  if (!provider) {
    throw new CultureScorerUnavailableError('Culture scoring provider is not configured.');
  }

  // Fire all 10 dimension calls concurrently (with re-prompt guards).
  const [competencyResults, profileResults] = await Promise.all([
    Promise.all(
      COMPETENCY_DIMENSIONS.map((dim) =>
        scoreCompetencyDimensionWithReprompt({
          provider,
          dimension: dim,
          transcript,
          barsOverrides: teamContext?.barsOverrides ?? [],
          dispositionalWeight: teamContext?.dispositionalWeights?.[dim] ?? 0,
        }),
      ),
    ),
    Promise.all(
      CULTURE_PROFILE_DIMENSIONS.map((dim) =>
        scoreCultureProfileDimensionWithReprompt({ provider, dimension: dim, transcript, orgBenchmark }),
      ),
    ),
  ]);

  // Sequential synthesis call — needs all scores to write a grounded narrative.
  const synthesis = await synthesizeReport({
    provider,
    competencyResults,
    profileResults,
    transcript,
    orgBenchmark,
  });

  // RCD dealbreaker HITL gate: scan the transcript for any RCD-approved
  // dealbreaker pattern and raise a flag per match. Never auto-fails — the
  // recruiter sees the flags and decides.
  const dealbreakerFlags = teamContext
    ? evaluateDealbreakers(teamContext.dealbreakers, transcript)
    : [];

  return {
    competencyScores: competencyResults,
    profileScores: profileResults,
    dealbreakerFlags,
    hitlReviewRequired: dealbreakerFlags.some((f) => f.matched),
    synthesis,
    orgBenchmark,
    scoredAt: new Date().toISOString(),
  };
}

// ─── Competency dimension scorer ──────────────────────────────────────────────

interface ScoreCompetencyArgs {
  provider: LLMProvider;
  dimension: CompetencyDimension;
  transcript: CultureTranscript;
  /** RCD-approved BARS anchor overrides — filtered inside to this dimension. */
  barsOverrides?: BarsOverride[];
  /**
   * Per-dimension dispositional weight delta in [-1, +1]. Applied post-score
   * as a sign-preserved magnitude shift — never zeroes a dimension, and the
   * adjusted score is clamped to [1, 5].
   */
  dispositionalWeight?: number;
}

/**
 * Apply RCD-approved BARS anchor overrides to the static rubric for one
 * dimension. Each override replaces a single `levelN` entry. Unmatched
 * levels keep their static text. Returns a new rubric + an `overridden`
 * flag indicating whether any substitution actually happened.
 */
export function applyBarsOverrides(
  dimension: CompetencyDimension,
  staticRubric: BarsRubric,
  overrides: readonly BarsOverride[],
): { rubric: BarsRubric; overridden: boolean } {
  const matching = overrides.filter((o) => o.dimension === dimension);
  if (matching.length === 0) return { rubric: staticRubric, overridden: false };

  const next: BarsRubric = { ...staticRubric };
  let overridden = false;
  for (const o of matching) {
    if (o.anchor_level >= 1 && o.anchor_level <= 5) {
      const key = `level${o.anchor_level}` as keyof BarsRubric;
      next[key] = o.override_anchor_text;
      overridden = true;
    }
  }
  return { rubric: next, overridden };
}

/**
 * Apply an RCD dispositional weight to a raw score. The weight is a
 * magnitude shift in [-1, +1]; we add `round(weight * 1)` to the raw score
 * and clamp to [1, 5]. Sign-preservation constraint: a weight cannot move a
 * score across a level boundary by more than ±1 in a single scoring run,
 * and cannot push below 1 or above 5. This prevents a single dispositional
 * knob from zeroing out a dimension or saturating it.
 */
export function applyDispositionalWeight(
  rawScore: 1 | 2 | 3 | 4 | 5,
  weight: number,
): 1 | 2 | 3 | 4 | 5 {
  if (!Number.isFinite(weight) || weight === 0) return rawScore;
  const clampedWeight = Math.max(-1, Math.min(1, weight));
  const delta = Math.round(clampedWeight);
  const shifted = Math.max(1, Math.min(5, rawScore + delta));
  return shifted as 1 | 2 | 3 | 4 | 5;
}

/**
 * Score one behavioral competency dimension via a single Gemma call.
 *
 * Fails closed on missing provider output or missing source evidence. Culture
 * score reports are persisted downstream, so a partial neutral score would be
 * indistinguishable from real assessment evidence.
 */
function buildCompetencyScorerMessages(args: ScoreCompetencyArgs): { messages: LLMMessage[]; overridden: boolean } {
  const { dimension, transcript, barsOverrides = [] } = args;
  const entry = COMPETENCY_BARS_RUBRICS[dimension];

  // Apply RCD-approved anchor overrides before the model sees the rubric.
  const { rubric: effectiveRubric, overridden } = applyBarsOverrides(
    dimension,
    entry.rubric,
    barsOverrides,
  );

  const messages: LLMMessage[] = [
    { role: 'system', content: buildCompetencyScorerSystemPrompt() },
    {
      role: 'user',
      content: buildCompetencyScorerUserMessage({
        dimension,
        rubric: effectiveRubric,
        calibration: entry.calibration,
        transcript,
      }),
    },
  ];

  return { messages, overridden };
}

export async function scoreCompetencyDimension(args: ScoreCompetencyArgs): Promise<CompetencyScoreResult> {
  const { provider, dimension, dispositionalWeight = 0 } = args;
  const { messages, overridden } = buildCompetencyScorerMessages(args);

  const content = await callProvider(provider, messages, 1024);
  const result = parseCompetencyResponse(dimension, content, {
    barsOverrideApplied: overridden,
    dispositionalWeight,
  }, provider);
  if (result.evidenceQuotes.length === 0) {
    throw new CultureScorerUnavailableError(
      `Culture competency scorer for ${dimension} did not return source evidence quotes.`,
      provider,
    );
  }
  return result;
}

function parseCompetencyResponse(
  dimension: CompetencyDimension,
  content: string,
  meta: { barsOverrideApplied: boolean; dispositionalWeight: number },
  provider?: LLMProvider,
): CompetencyScoreResult {
  try {
    const stripped = stripJsonFences(content);
    const raw = JSON.parse(stripped) as unknown;
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

    const rawScore = parseScoreInt(r.score, `competency ${dimension} score`);
    const score = applyDispositionalWeight(rawScore, meta.dispositionalWeight);
    const evidenceQuotes = parseStringArray(r.evidence_quotes);
    const confidence = parseConfidence(r.confidence, `competency ${dimension} confidence`);
    const reasoning = requireString(r.reasoning, `competency ${dimension} reasoning`);

    return {
      dimension,
      score,
      rawScore,
      dispositionalWeight: meta.dispositionalWeight,
      barsOverrideApplied: meta.barsOverrideApplied,
      evidenceQuotes,
      confidence,
      reasoning,
      repromptCount: 0,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new CultureScorerUnavailableError(
      `Culture competency scorer for ${dimension} returned invalid JSON: ${message}`,
      provider ?? null,
    );
  }
}

// ─── Dealbreaker HITL gate ────────────────────────────────────────────────────

/**
 * Scan the transcript for RCD-approved dealbreaker patterns. Each dealbreaker
 * in the RCD carries a `pattern` string — we search for it as a
 * case-insensitive substring across all candidate responses. A match raises
 * a flag with the verbatim quote for the audit trail; no match still
 * surfaces the dealbreaker with `matched: false` so the recruiter can see
 * what was checked.
 *
 * Never auto-fails. The `hitlReviewRequired` aggregate on the report is the
 * signal the recruiter UI uses to block advancement until review.
 */
export function evaluateDealbreakers(
  dealbreakers: readonly DealbreakerRecord[],
  transcript: CultureTranscript,
): DealbreakerFlag[] {
  if (dealbreakers.length === 0) return [];

  const candidateText = transcript.turns
    .map((t) => t.candidateResponse ?? '')
    .filter((t) => t.length > 0);

  return dealbreakers.map((db) => {
    const needle = db.pattern.trim().toLowerCase();
    let matchedQuote: string | null = null;
    if (needle.length > 0) {
      for (const response of candidateText) {
        if (response.toLowerCase().includes(needle)) {
          matchedQuote = response;
          break;
        }
      }
    }
    return {
      dealbreakerId: db.id,
      label: db.label,
      pattern: db.pattern,
      matchedQuote,
      matched: matchedQuote !== null,
      jobRelatednessNote: db.job_relatedness_note,
      jobRelatednessStrength: db.job_relatedness_strength,
      sourceStakeholder: db.source_stakeholder,
      sourceChainId: db.source_chain_id,
    };
  });
}

// ─── Culture profile axis scorer ─────────────────────────────────────────────

interface ScoreProfileArgs {
  provider: LLMProvider;
  dimension: CultureProfileDimension;
  transcript: CultureTranscript;
  orgBenchmark: OrgCultureBenchmark;
}

/**
 * Locate one culture profile position via a single Gemma call.
 *
 * The benchmark position for the dimension is passed to the prompt as context
 * only — scoring is independent of the benchmark. Comparison happens in
 * the synthesis call, not here.
 */
function buildCultureProfileScorerMessages(args: ScoreProfileArgs): LLMMessage[] {
  const { dimension, transcript, orgBenchmark } = args;
  const entry = CULTURE_PROFILE_BARS[dimension];
  const benchmarkKey = dimensionToBenchmarkKey(dimension);
  const orgBenchmarkPosition = orgBenchmark[benchmarkKey];

  return [
    { role: 'system', content: buildCultureProfileScorerSystemPrompt() },
    {
      role: 'user',
      content: buildCultureProfileUserMessage({
        dimension,
        positionDescriptors: entry.positionDescriptors,
        orgBenchmarkPosition,
        transcript,
      }),
    },
  ];
}

export async function scoreCultureProfileDimension(
  args: ScoreProfileArgs,
): Promise<CultureProfileScoreResult> {
  const { provider, dimension } = args;
  const messages = buildCultureProfileScorerMessages(args);

  const content = await callProvider(provider, messages, 1024);
  const result = parseProfileResponse(dimension, content, provider);
  if (result.evidenceQuotes.length === 0) {
    throw new CultureScorerUnavailableError(
      `Culture profile scorer for ${dimension} did not return source evidence quotes.`,
      provider,
    );
  }
  return result;
}

function parseProfileResponse(
  dimension: CultureProfileDimension,
  content: string,
  provider?: LLMProvider,
): CultureProfileScoreResult {
  try {
    const stripped = stripJsonFences(content);
    const raw = JSON.parse(stripped) as unknown;
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

    const candidatePosition = parseScoreInt(r.candidate_position, `profile ${dimension} candidate_position`);
    const evidenceQuotes = parseStringArray(r.evidence_quotes);
    const confidence = parseConfidence(r.confidence, `profile ${dimension} confidence`);
    const reasoning = requireString(r.reasoning, `profile ${dimension} reasoning`);

    return { dimension, candidatePosition, evidenceQuotes, confidence, reasoning, repromptCount: 0 };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new CultureScorerUnavailableError(
      `Culture profile scorer for ${dimension} returned invalid JSON: ${message}`,
      provider ?? null,
    );
  }
}

// ─── Synthesis ────────────────────────────────────────────────────────────────

interface SynthesizeReportArgs {
  provider: LLMProvider;
  competencyResults: CompetencyScoreResult[];
  profileResults: CultureProfileScoreResult[];
  transcript: CultureTranscript;
  orgBenchmark: OrgCultureBenchmark;
}

/**
 * Write the final narrative report from the aggregated dimension scores.
 *
 * Uses maxTokens: 2048 because the narrative writes 250–400 words of prose
 * in addition to the JSON wrapper. The agent prompt and synthesis prompt
 * use 1024 for structured output; synthesis needs more room.
 */
export async function synthesizeReport(
  args: SynthesizeReportArgs,
): Promise<CultureScoreReport['synthesis']> {
  const { provider, competencyResults, profileResults, transcript, orgBenchmark } = args;

  // Build the profile results with org benchmark positions for the synthesis message.
  const profileResultsWithBenchmark = profileResults.map((r) => ({
    dimension: r.dimension,
    candidatePosition: r.candidatePosition,
    orgBenchmarkPosition: orgBenchmark[dimensionToBenchmarkKey(r.dimension)],
    reasoning: r.reasoning,
  }));

  const messages: LLMMessage[] = [
    { role: 'system', content: buildSynthesisSystemPrompt() },
    {
      role: 'user',
      content: buildSynthesisUserMessage({
        competencyResults: competencyResults.map((r) => ({
          dimension: r.dimension,
          score: r.score,
          reasoning: r.reasoning,
        })),
        profileResults: profileResultsWithBenchmark,
        transcript,
      }),
    },
  ];

  const content = await callProvider(provider, messages, 2048);

  return parseSynthesisResponse(content, provider);
}

function parseSynthesisResponse(
  content: string,
  provider?: LLMProvider,
): CultureScoreReport['synthesis'] {
  try {
    const stripped = stripJsonFences(content);
    const raw = JSON.parse(stripped) as unknown;
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

    const headline = requireString(r.headline, 'synthesis headline');
    const narrative = requireString(r.narrative, 'synthesis narrative');
    const recommendation = parseRecommendation(r.recommendation);

    return { headline, narrative, recommendation };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new CultureScorerUnavailableError(
      `Culture synthesis scorer returned invalid JSON: ${message}`,
      provider ?? null,
    );
  }
}

// ─── Shared LLM call helper ───────────────────────────────────────────────────

/**
 * Thin wrapper around `provider.complete` with consistent error handling.
 * Returns the trimmed content string or null on failure.
 */
async function callProvider(
  provider: LLMProvider,
  messages: LLMMessage[],
  maxTokens: number,
): Promise<string> {
  try {
    const completion = await provider.complete(messages, {
      forceJson: true,
      maxTokens,
    });
    const content = (completion.content ?? '').trim();
    if (content.length === 0) {
      throw new CultureScorerUnavailableError('Culture scorer provider returned empty content.', provider);
    }
    return content;
  } catch (err) {
    if (err instanceof CultureScorerUnavailableError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new CultureScorerUnavailableError(`Culture scorer provider failed: ${message}`, provider);
  }
}

// ─── JSON fence stripping ─────────────────────────────────────────────────────
// Mirrors `stripJsonFences` in cloudflareAIProvider.ts — Gemma 4 frequently
// wraps JSON in ```json ... ``` even when explicitly asked not to.

function stripJsonFences(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  if (fenceMatch) return fenceMatch[1]!.trim();
  return trimmed;
}

// ─── Field parsers ────────────────────────────────────────────────────────────

function parseScoreInt(v: unknown, fieldName: string): 1 | 2 | 3 | 4 | 5 {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new Error(`${fieldName} is missing or not numeric.`);
  }
  const n = Math.round(v);
  if (n >= 1 && n <= 5) return n as 1 | 2 | 3 | 4 | 5;
  throw new Error(`${fieldName} must be between 1 and 5.`);
}

function parseConfidence(v: unknown, fieldName: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new Error(`${fieldName} is missing or not numeric.`);
  }
  if (v < 0 || v > 1) {
    throw new Error(`${fieldName} must be between 0 and 1.`);
  }
  return v;
}

function parseStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function requireString(v: unknown, fieldName: string): string {
  if (typeof v !== 'string' || v.trim().length === 0) {
    throw new Error(`${fieldName} is missing or empty.`);
  }
  return v.trim();
}

function parseRecommendation(v: unknown): 'HIRE' | 'FLAG_FOR_REVIEW' | 'PASS' {
  if (v === 'HIRE' || v === 'FLAG_FOR_REVIEW' || v === 'PASS') return v;
  throw new Error('synthesis recommendation is missing or invalid.');
}

// ─── Benchmark key mapping ────────────────────────────────────────────────────

/**
 * Maps a CultureProfileDimension to its camelCase key on OrgCultureBenchmark.
 * Kept as a lookup rather than a dynamic transformation to preserve type safety.
 */
function dimensionToBenchmarkKey(
  dim: CultureProfileDimension,
): keyof OrgCultureBenchmark {
  const map: Record<CultureProfileDimension, keyof OrgCultureBenchmark> = {
    autonomy: 'autonomy',
    'risk-tolerance': 'riskTolerance',
    'work-pace': 'workPace',
    'collaboration-style': 'collaborationStyle',
    'feedback-orientation': 'feedbackOrientation',
  };
  return map[dim];
}
