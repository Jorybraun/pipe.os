/**
 * Probe Librarian — Deterministic probe lookup and adaptation.
 *
 * Two probe libraries:
 *   - Signal Probes (9): technical reality — review culture, incidents, done definition,
 *     feedback, seniority, shipping, thrives/struggles, new joiner observations,
 *     and codebase organization.
 *   - Soul Probes (6): human truth — clone three, interview gap, conflict style,
 *     hidden priority, tradeoff trauma, friction truth.
 *
 * No LLM calls. <1ms.
 */

import type { ParticipantRole, Domain } from '../../../types';
import type { GeneratedQuestion } from '../interview/types';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Probe {
  id: string;
  /** Base probe question text — the canonical form. */
  text: string;
  /** Which domains this probe surfaces signal for. */
  targetDomains: Domain[];
  /** What this probe is designed to reveal. */
  intent: string;
  /** Per-role adaptations of the base text. */
  roleVariants: Partial<Record<ParticipantRole, string>>;
  /** What to follow up on if the answer is short or vague. */
  drillingHints: string[];
  /** What to ladder toward if energy is high. */
  ladderingTarget: string;
  /** Whether this is a personality-reveal probe (maps to team_culture_profile). */
  isPersonalityProbe: boolean;
  /** Whether this is a soul-track probe (human truth, behavior over values). */
  isSoulProbe: boolean;
}

export interface ProbePlan {
  probe: Probe;
  /** The adapted question text for this participant role. */
  adaptedText: string;
  /** Primary domain to advance this turn. */
  primaryDomain: Domain;
  /** Secondary domains this probe also touches. */
  secondaryDomains: Domain[];
}

// ─── Signal Probes (1-9) ─────────────────────────────────────────────────────

const SIGNAL_PROBES: Probe[] = [
  // TEAM DOMAIN (first in flow)
  {
    id: 'probe_1_code_review',
    text: 'Tell me about a recent code review that got interesting — what happened?',
    targetDomains: ['team', 'codebase'],
    intent: 'Surface review culture, communication norms, psychological safety, and quality standards through a concrete story.',
    roleVariants: {
      TEAM_MEMBER: 'Tell me about a recent code review you were in that got interesting — what happened?',
      HIRING_MANAGER: 'Tell me about a recent code review on your team that got interesting — what happened?',
      INTERNAL_RECRUITER: 'Have you heard about any code reviews on the team that got interesting? What happened?',
      EXTERNAL_RECRUITER: 'What does code review culture look like on this team — any stories come to mind?',
    },
    drillingHints: [
      'What was the disagreement about?',
      'How did the team resolve it?',
    ],
    ladderingTarget: 'Why does the team care about this kind of feedback? What happens if they get it wrong?',
    isPersonalityProbe: false,
    isSoulProbe: false,
  },
  {
    id: 'probe_4_feedback_style',
    text: 'How do you usually give feedback to someone you work with?',
    targetDomains: ['team', 'bar'],
    intent: 'Surface directness, mentorship style, growth expectations, and communication norms.',
    roleVariants: {
      TEAM_MEMBER: 'How do people on your team usually give feedback to each other?',
      HIRING_MANAGER: 'How do you usually give feedback to engineers on your team?',
      INTERNAL_RECRUITER: "What's the feedback culture like on this team?",
      EXTERNAL_RECRUITER: "How would you describe the feedback culture on this team?",
    },
    drillingHints: [
      'Can you give me an example of feedback that landed well?',
      'What about feedback that did not land well?',
    ],
    ladderingTarget: 'What does the team believe about growth and improvement? How do they act on it?',
    isPersonalityProbe: false,
    isSoulProbe: false,
  },
  {
    id: 'probe_7_thrives_struggles',
    text: 'What kind of person tends to do really well on this team? And who tends to struggle?',
    targetDomains: ['team'],
    intent: 'Maps to: clan_affinity, market_affinity, psychological_safety (team_culture_profile).',
    roleVariants: {
      TEAM_MEMBER: 'What kind of person tends to do really well on this team? And who tends to struggle?',
      HIRING_MANAGER: 'What kind of person tends to do really well on this team? And who tends to struggle?',
      INTERNAL_RECRUITER: 'From what you have seen, what kind of person thrives on this team? And who struggles?',
      EXTERNAL_RECRUITER: 'What kind of candidate tends to thrive on this team?',
    },
    drillingHints: [
      'What is a specific example of someone who thrived?',
      'What about someone who struggled — what happened?',
    ],
    ladderingTarget: 'Why do those traits matter here? What would change if the team had different strengths?',
    isPersonalityProbe: true,
    isSoulProbe: false,
  },
  {
    id: 'probe_8_new_joiner_observation',
    text: 'If a new joiner spent their first week just watching how the team works, what would stand out to them?',
    targetDomains: ['team', 'process'],
    intent: 'Maps to: adhocracy_affinity, hierarchy_affinity, psychological_safety (team_culture_profile).',
    roleVariants: {
      TEAM_MEMBER: 'If a new joiner spent their first week just watching how the team works, what would stand out to them?',
      HIRING_MANAGER: 'If a new engineer spent their first week watching how your team works, what would stand out to them?',
      INTERNAL_RECRUITER: 'What would stand out to a new hire in their first week on this team?',
      EXTERNAL_RECRUITER: 'What would surprise a new hire about how this team works?',
    },
    drillingHints: [
      'What would surprise them positively?',
      'What might surprise them negatively?',
    ],
    ladderingTarget: 'Why does the team work this way? What would break if they changed it?',
    isPersonalityProbe: true,
    isSoulProbe: false,
  },
  // WORK DOMAIN (second in flow)
  {
    id: 'probe_5_senior_definition',
    text: "If I asked your team what 'senior' means here, what would they say?",
    targetDomains: ['work', 'bar'],
    intent: 'Surface autonomy level, ownership scope, mentorship dynamics, and the seniority bar.',
    roleVariants: {
      TEAM_MEMBER: "If someone asked you what 'senior' means on this team, what would you say?",
      HIRING_MANAGER: "If I asked your team what 'senior' means here, what would they say?",
      INTERNAL_RECRUITER: "How would the team define what 'senior' means in this role?",
      EXTERNAL_RECRUITER: "What does 'senior' mean for this team?",
    },
    drillingHints: [
      'What does a senior person do that a mid-level does not?',
      'What would make someone NOT senior here?',
    ],
    ladderingTarget: 'Why does the team value those specific traits? What business outcome depends on them?',
    isPersonalityProbe: false,
    isSoulProbe: false,
  },
  {
    id: 'probe_6_last_shipment',
    text: 'Walk me through the last thing your team shipped — how did it go from idea to live?',
    targetDomains: ['work', 'codebase', 'process'],
    intent: 'Surface stack, architecture, autonomy, shipping cadence, and collaboration patterns through a concrete story.',
    roleVariants: {
      TEAM_MEMBER: 'Walk me through the last thing you and your team shipped — how did it go from idea to live?',
      HIRING_MANAGER: 'Walk me through the last thing your team shipped — how did it go from idea to live?',
      INTERNAL_RECRUITER: 'Can you walk me through how the team shipped something recently?',
      EXTERNAL_RECRUITER: 'How does the team typically ship something from idea to production?',
    },
    drillingHints: [
      'What was the biggest technical decision?',
      'Who made the call?',
    ],
    ladderingTarget: 'Why did they choose that approach? What constraints drove the decision?',
    isPersonalityProbe: false,
    isSoulProbe: false,
  },
  // BAR DOMAIN (third in flow)
  {
    id: 'probe_3_done_definition',
    text: "When a PR is truly finished on your team — what does that actually look like?",
    targetDomains: ['bar', 'codebase'],
    intent: 'Surface quality standards, testing practices, review rigor, and the definition of "done".',
    roleVariants: {
      TEAM_MEMBER: "When a PR is truly finished on your team — what does that actually look like from your perspective?",
      HIRING_MANAGER: "When a PR is truly finished on your team — what does that actually look like?",
      INTERNAL_RECRUITER: "What does 'done' look like for a PR on this team?",
      EXTERNAL_RECRUITER: "What does a finished PR look like on this team?",
    },
    drillingHints: [
      'What kind of tests need to pass?',
      'Who gives the final approval?',
    ],
    ladderingTarget: 'Why does the team draw the line there? What would happen if they moved it?',
    isPersonalityProbe: false,
    isSoulProbe: false,
  },
  // PROCESS DOMAIN (fifth in flow)
  {
    id: 'probe_2_production_incident',
    text: "When something breaks in production, what's the first thing the team does?",
    targetDomains: ['process', 'team'],
    intent: 'Surface ownership patterns, blame culture, on-call expectations, and operational maturity.',
    roleVariants: {
      TEAM_MEMBER: "When something broke in production recently, what did the team actually do?",
      HIRING_MANAGER: "When something breaks in production, what's the first thing the team does?",
      INTERNAL_RECRUITER: "How does the team handle production incidents? What's the first thing they do?",
      EXTERNAL_RECRUITER: "How does this team handle it when something breaks in production?",
    },
    drillingHints: [
      'Who gets paged first?',
      'Is there a post-mortem process?',
    ],
    ladderingTarget: 'What does the team value more: speed of recovery or prevention? Why?',
    isPersonalityProbe: false,
    isSoulProbe: false,
  },
  // CODEBASE DOMAIN (fourth in flow)
  {
    id: 'probe_9_codebase_organization',
    text: 'How is the codebase organized — what are the main areas or modules?',
    targetDomains: ['codebase', 'work'],
    intent: 'Surface technical architecture, code organization patterns, and system structure.',
    roleVariants: {
      TEAM_MEMBER: 'How is your codebase organized — what are the main areas or modules you work with?',
      HIRING_MANAGER: 'How is the team\'s codebase organized — what are the main areas or modules?',
      INTERNAL_RECRUITER: 'How is the codebase organized technically?',
      EXTERNAL_RECRUITER: 'What\'s the high-level structure of the codebase?',
    },
    drillingHints: [
      'What lives in each major area?',
      'How do engineers navigate between different parts?',
    ],
    ladderingTarget: 'Why is it organized this way? What tradeoffs did they make?',
    isPersonalityProbe: false,
    isSoulProbe: false,
  },
];

// ─── Soul Probes (1-6, delivered in SOUL phase) ──────────────────────────────

const SOUL_PROBES: Probe[] = [
  {
    id: 'probe_soul_1_clone_three',
    text: 'You probably have a mental list: "If I could clone three people, I\'d hire them again in a heartbeat." What do those people have in common?',
    targetDomains: ['team'],
    intent: 'Surface tacit success model — what the team actually values in people, not what they say they value.',
    roleVariants: {
      TEAM_MEMBER: 'You probably have teammates you\'d love to work with again. What do those people have in common?',
      HIRING_MANAGER: 'You probably have a mental list of people you\'d clone if you could. What do they have in common?',
      INTERNAL_RECRUITER: 'From what you\'ve seen, who on this team would the hiring manager fight to keep? What makes them special?',
      EXTERNAL_RECRUITER: 'What kind of person tends to get promoted or retained on this team?',
    },
    drillingHints: [
      'Can you give me a specific example of one of those people in action?',
      'What would someone WITHOUT that trait look like on this team?',
    ],
    ladderingTarget: 'Why does the team value those traits? What would break if they hired someone without them?',
    isPersonalityProbe: true,
    isSoulProbe: true,
  },
  {
    id: 'probe_soul_2_interview_gap',
    text: 'Flip side — who did you think would work out but didn\'t? What was the gap between interview and reality?',
    targetDomains: ['team'],
    intent: 'Surface false positives and blind spots — what looks good in interviews but fails on the team.',
    roleVariants: {
      TEAM_MEMBER: 'Have you seen someone join who seemed great in interviews but didn\'t work out? What was the gap?',
      HIRING_MANAGER: 'Flip side — who did you think would work out but didn\'t? What was the gap between interview and reality?',
      INTERNAL_RECRUITER: 'Have you seen a hire that looked perfect on paper but didn\'t work out? What was missing?',
      EXTERNAL_RECRUITER: 'Have you placed candidates here who looked great but didn\'t last? What was the gap?',
    },
    drillingHints: [
      'What did they say in the interview that sounded convincing?',
      'What specific behavior revealed the mismatch?',
    ],
    ladderingTarget: 'What does the team now watch for that they used to miss? How did this change their hiring bar?',
    isPersonalityProbe: true,
    isSoulProbe: true,
  },
  {
    id: 'probe_soul_3_conflict_style',
    text: 'When two people on the team genuinely disagree about how to do something, how does it resolve? Can you give me a real example?',
    targetDomains: ['team'],
    intent: 'Surface conflict metabolism — how power works, who decides, and whether disagreement is safe.',
    roleVariants: {
      TEAM_MEMBER: 'When you\'ve seen two people on the team genuinely disagree, how did it resolve?',
      HIRING_MANAGER: 'When two engineers on your team genuinely disagree about how to do something, how does it resolve?',
      INTERNAL_RECRUITER: 'How does this team handle genuine disagreement? Can you give me a real example?',
      EXTERNAL_RECRUITER: 'What happens when two strong voices on this team disagree?',
    },
    drillingHints: [
      'Who made the final call?',
      'How did the person who lost the argument feel afterward?',
    ],
    ladderingTarget: 'What does the team believe about disagreement? Is it seen as productive or destructive?',
    isPersonalityProbe: true,
    isSoulProbe: true,
  },
  {
    id: 'probe_soul_4_hidden_priority',
    text: 'What does the hiring manager actually care about that isn\'t written in any doc or said in all-hands?',
    targetDomains: ['team'],
    intent: 'Surface shadow values — the real bar that isn\'t documented but drives decisions.',
    roleVariants: {
      TEAM_MEMBER: 'What does your manager actually care about that they don\'t say explicitly?',
      HIRING_MANAGER: 'What do you actually care about in a hire that you don\'t put in the job description?',
      INTERNAL_RECRUITER: 'What have you learned the hiring manager actually cares about that isn\'t in the brief?',
      EXTERNAL_RECRUITER: 'What does the client emphasize behind closed doors that isn\'t in the job spec?',
    },
    drillingHints: [
      'Can you give me an example of a decision where that unstated priority mattered?',
      'What do candidates sometimes miss about what this team actually values?',
    ],
    ladderingTarget: 'Why isn\'t this priority stated openly? What would happen if it were?',
    isPersonalityProbe: true,
    isSoulProbe: true,
  },
  {
    id: 'probe_soul_5_tradeoff_trauma',
    text: 'If you had to choose: someone who ships fast but needs handholding, or someone who mentors but ships slow? Has that choice burned you before?',
    targetDomains: ['team'],
    intent: 'Surface tradeoff philosophy and trauma — painful choices that shaped the team\'s hiring instincts.',
    roleVariants: {
      TEAM_MEMBER: 'Have you seen the team choose between someone fast but independent vs. someone slower who lifts others up? How did it go?',
      HIRING_MANAGER: 'Have you hired someone who was brilliant but hard to work with? Or great to work with but slow? Which hurt more?',
      INTERNAL_RECRUITER: 'What tradeoff has this team made that they\'d make differently now?',
      EXTERNAL_RECRUITER: 'What kind of candidate has this team regretted passing on — or regretted hiring?',
    },
    drillingHints: [
      'What specifically went wrong?',
      'What would you do differently next time?',
    ],
    ladderingTarget: 'What does this team value more: individual output or team capability? Why?',
    isPersonalityProbe: true,
    isSoulProbe: true,
  },
  {
    id: 'probe_soul_6_friction_truth',
    text: 'Why would someone leave this team? What\'s the hard part no one talks about in interviews?',
    targetDomains: ['team'],
    intent: 'Surface retention risk and authentic friction — the truth candidates need to hear.',
    roleVariants: {
      TEAM_MEMBER: 'Why would someone on this team decide to leave? What\'s the hardest part?',
      HIRING_MANAGER: 'Why would someone leave this team? What\'s the hard part no one talks about in interviews?',
      INTERNAL_RECRUITER: 'What\'s the real reason people have left this team?',
      EXTERNAL_RECRUITER: 'What should candidates know about the hard parts of this team?',
    },
    drillingHints: [
      'Is there a pattern in who leaves?',
      'What do people say in exit interviews?',
    ],
    ladderingTarget: 'Is this friction seen as a problem to fix or a reality to accept?',
    isPersonalityProbe: true,
    isSoulProbe: true,
  },
];

const PROBE_BY_ID = new Map([...SIGNAL_PROBES, ...SOUL_PROBES].map((p) => [p.id, p]));

// ─── Signal Probe API ────────────────────────────────────────────────────────

/** Return the Nth signal probe (1-indexed). */
export function getProbe(n: number): Probe | undefined {
  return SIGNAL_PROBES[n - 1];
}

/** Total number of signal probes. */
export function getProbeCount(): number {
  return SIGNAL_PROBES.length;
}

/** Return a probe by its stable ID (searches both signal and soul). */
export function getProbeById(id: string): Probe | undefined {
  return PROBE_BY_ID.get(id);
}

/** Return all signal probe IDs in order. */
export function getProbeIds(): string[] {
  return SIGNAL_PROBES.map((p) => p.id);
}

// ─── Soul Probe API ──────────────────────────────────────────────────────────

/** Return the Nth soul probe (1-indexed). */
export function getSoulProbe(n: number): Probe | undefined {
  return SOUL_PROBES[n - 1];
}

/** Total number of soul probes. */
export function getSoulProbeCount(): number {
  return SOUL_PROBES.length;
}

/** Return all soul probe IDs in order. */
export function getSoulProbeIds(): string[] {
  return SOUL_PROBES.map((p) => p.id);
}

// ─── Probe Plan Builders ─────────────────────────────────────────────────────

function buildProbePlanInternal(
  probe: Probe | undefined,
  participantRole: ParticipantRole | null,
): ProbePlan | undefined {
  if (!probe) return undefined;

  const adaptedText =
    participantRole && probe.roleVariants[participantRole]
      ? probe.roleVariants[participantRole]!
      : probe.text;

  return {
    probe,
    adaptedText,
    primaryDomain: probe.targetDomains[0] ?? 'team',
    secondaryDomains: probe.targetDomains.slice(1),
  };
}

/**
 * Build a ProbePlan for the current DISCOVERY turn.
 *
 * @param probesDelivered — how many signal probes have already been asked
 * @param participantRole — who we're talking to
 */
export function buildProbePlan(
  probesDelivered: number,
  participantRole: ParticipantRole | null,
): ProbePlan | undefined {
  const nextIndex = probesDelivered + 1;
  const probe = getProbe(nextIndex);
  return buildProbePlanInternal(probe, participantRole);
}

/**
 * Build a ProbePlan for the current SOUL turn.
 *
 * @param soulProbesDelivered — how many soul probes have already been asked
 * @param participantRole — who we're talking to
 */
export function buildSoulProbePlan(
  soulProbesDelivered: number,
  participantRole: ParticipantRole | null,
): ProbePlan | undefined {
  const nextIndex = soulProbesDelivered + 1;
  const probe = getSoulProbe(nextIndex);
  return buildProbePlanInternal(probe, participantRole);
}

// ─── Probe Instruction Builders ──────────────────────────────────────────────

function buildProbeInstructionInternal(
  plan: ProbePlan | undefined,
  probesDelivered: number,
  totalCount: number,
  label: string,
): string {
  if (!plan) return '';

  const lines: string[] = [];
  lines.push(`## ${label} (${probesDelivered + 1} of ${totalCount})`);
  lines.push(`"${plan.adaptedText}"`);
  lines.push(`Target: ${plan.primaryDomain}${plan.secondaryDomains.length > 0 ? ' + ' + plan.secondaryDomains.join(', ') : ''}`);
  lines.push(`Intent: ${plan.probe.intent}`);

  if (plan.probe.drillingHints.length > 0) {
    lines.push(`If the answer is short or vague, follow up with ONE of:`);
    for (const hint of plan.probe.drillingHints) {
      lines.push(`  - ${hint}`);
    }
  }

  lines.push(`Ladder target: ${plan.probe.ladderingTarget}`);

  return lines.join('\n');
}

/**
 * Build a concise signal probe instruction block for injection into the user prompt.
 */
export function buildProbeInstruction(
  probesDelivered: number,
  participantRole: ParticipantRole | null,
): string {
  const plan = buildProbePlan(probesDelivered, participantRole);
  return buildProbeInstructionInternal(plan, probesDelivered, getProbeCount(), 'Next Probe');
}

/**
 * Build a concise soul probe instruction block for injection into the user prompt.
 */
export function buildSoulProbeInstruction(
  soulProbesDelivered: number,
  participantRole: ParticipantRole | null,
): string {
  const plan = buildSoulProbePlan(soulProbesDelivered, participantRole);
  return buildProbeInstructionInternal(plan, soulProbesDelivered, getSoulProbeCount(), 'Next Soul Probe');
}

/**
 * Build a compact reference of all remaining signal probes.
 */
export function buildRemainingProbeSummary(probesDelivered: number): string {
  const remaining = SIGNAL_PROBES.slice(probesDelivered);
  if (remaining.length === 0) return 'All signal probes delivered.';

  return remaining
    .map((p, i) => `${probesDelivered + i + 1}. ${p.id} → ${p.targetDomains.join('+')}`)
    .join('\n');
}

/**
 * Build a compact reference of all remaining soul probes.
 */
export function buildRemainingSoulProbeSummary(soulProbesDelivered: number): string {
  const remaining = SOUL_PROBES.slice(soulProbesDelivered);
  if (remaining.length === 0) return 'All soul probes delivered.';

  return remaining
    .map((p, i) => `${soulProbesDelivered + i + 1}. ${p.id} → ${p.targetDomains.join('+')}`)
    .join('\n');
}

// ─── Domain-Oriented Probe Lookup ────────────────────────────────────────────

/**
 * Convert a Probe to the GeneratedQuestion shape used by the domain orchestrator.
 */
function probeToGeneratedQuestion(
  probe: Probe,
  participantRole: ParticipantRole | null,
): GeneratedQuestion {
  const adaptedText =
    participantRole && probe.roleVariants[participantRole]
      ? probe.roleVariants[participantRole]!
      : probe.text;

  return {
    id: probe.id,
    text: adaptedText,
    intent: probe.intent,
    drillingHints: probe.drillingHints.length > 0 ? probe.drillingHints : undefined,
    ladderingTarget: probe.ladderingTarget,
  };
}

/**
 * Return calibrated signal probes for a domain, excluding already-delivered ones.
 *
 * Probes are returned in their canonical order (1–8). A probe is included if
 * the domain appears as the PRIMARY (first) target in its `targetDomains` list.
 * This ensures probes respect the domain flow order and prevents illogical jumps.
 * Probes whose IDs appear in `deliveredProbeIds` are excluded to prevent cross-domain duplication.
 *
 * Adapted to the participant's role for contextual phrasing.
 */
export function getProbesForDomain(
  domain: Domain,
  participantRole: ParticipantRole | null,
  deliveredProbeIds: string[],
): GeneratedQuestion[] {
  const delivered = new Set(deliveredProbeIds);
  const matching = SIGNAL_PROBES.filter(
    (p) => p.targetDomains[0] === domain && !delivered.has(p.id),
  );

  console.log(
    `[probeLibrarian] domain=${domain} | matching=${matching.length} | delivered=${deliveredProbeIds.length} | ids=${matching.map((p) => p.id).join(',')}`,
  );

  return matching.map((p) => probeToGeneratedQuestion(p, participantRole));
}

/**
 * Return calibrated soul probes for a domain, excluding already-delivered ones.
 * Same semantics as getProbesForDomain but queries the soul probe library.
 * Uses primary domain matching to respect the domain flow order.
 */
export function getSoulProbesForDomain(
  domain: Domain,
  participantRole: ParticipantRole | null,
  deliveredProbeIds: string[],
): GeneratedQuestion[] {
  const delivered = new Set(deliveredProbeIds);
  const matching = SOUL_PROBES.filter(
    (p) => p.targetDomains[0] === domain && !delivered.has(p.id),
  );

  return matching.map((p) => probeToGeneratedQuestion(p, participantRole));
}
