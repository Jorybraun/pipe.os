/**
 * Calibration fixtures for the Culture Scorer QWK harness.
 *
 * 10 synthetic transcripts spanning LOW / MEDIUM / HIGH quality bands.
 * Each fixture records expert-assigned ground-truth scores so the QWK
 * harness can compare them against agent output.
 *
 * ### Design rationale
 *
 * The expert scores here are the calibration ground truth. They are written
 * honestly — scores vary within bands and across dimensions. A HIGH candidate
 * is not 5/5/5/5/5; a MEDIUM candidate has real variance. Two borderline cases
 * (fixtures 04 and 07) are deliberately ambiguous between 2 and 3 so QWK
 * measures real discrimination power rather than trivial separation.
 *
 * Every transcript has at least 5 question turns covering all 5 competency
 * dimensions so the scorer receives signal on every axis.
 *
 * @see workers/api/src/lib/cultureScorerCalibration.ts — QWK harness
 * @see research brief §2.9 — target QWK ≥ 0.55
 */

import type { CultureTranscript } from '../cultureAgent';
import type { CompetencyDimension } from '../cultureQuestionBank';
import type { CultureProfileDimension } from '../cultureScorerPrompts';

// ─── Public interface ─────────────────────────────────────────────────────────

export interface CalibrationFixture {
  /** Human-readable label used in the report. */
  label: string;
  /** Quality band — for grouping in output, not used by QWK math. */
  band: 'LOW' | 'MEDIUM' | 'HIGH';
  /** Completed transcript to pass to scoreCultureInterview. */
  transcript: CultureTranscript;
  /**
   * Expert-assigned BARS scores (1–5) per competency dimension.
   * These are the ground truth for QWK computation.
   */
  expertCompetencyScores: Record<CompetencyDimension, 1 | 2 | 3 | 4 | 5>;
  /**
   * Expert-assigned profile positions (1–5) per culture-profile dimension.
   * These are also ground truth for the profile QWK axis.
   */
  expertProfileScores: Record<CultureProfileDimension, 1 | 2 | 3 | 4 | 5>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a completed turn — no pending response. */
function turn(
  idx: number,
  questionId: string,
  questionText: string,
  response: string,
  probeOf: string | null = null,
): CultureTranscript['turns'][number] {
  return {
    idx,
    questionId,
    questionText,
    probeOf,
    candidateResponse: response,
    starSlots: null, // filled by agent at runtime; irrelevant for scorer input
    timestamp: '2026-04-01T10:00:00.000Z',
  };
}

// ─── LOW band (fixtures 01–03) ────────────────────────────────────────────────
// Vague, team-attributed, no measurable outcomes, generic platitudes.
// Expert scores: mostly 1–2 across dimensions.

const low01: CalibrationFixture = {
  label: 'LOW-01 — generic team player, no personal actions',
  band: 'LOW',
  transcript: {
    turns: [
      // ownership-001
      turn(0, 'ownership-001', "Tell me about a time you saw a problem that wasn't yours to fix, and you fixed it anyway.", "Yeah, we had some issues with our deployment process. The team got together and figured it out. Everyone pitched in and eventually we sorted it out. It was a good team effort."),
      // ownership-002
      turn(1, 'ownership-002', "Tell me about something you shipped that broke in a way that affected other people.", "We had a bug that went out once. The team rallied and we got it fixed pretty quickly. These things happen and you just learn from them."),
      // collaboration-001
      turn(2, 'collaboration-001', "Tell me about a time you disagreed with a teammate on a technical decision.", "I'm a pretty collaborative person so I don't really get into big disagreements. If something comes up we talk it through as a team and find the best solution. Communication is key."),
      // learning-orientation-001
      turn(3, 'learning-orientation-001', "Tell me about a time you were wrong about something technical.", "I'm always looking to grow and I read a lot of tech blogs to stay current. You have to keep learning in this industry. I try to stay open to feedback."),
      // self-awareness-001
      turn(4, 'self-awareness-001', "What's a weakness you've had to actively work on?", "I sometimes work too hard and need to remind myself to step back. I care a lot about quality which can be a double-edged sword. But overall I think that's a strength in disguise."),
      // conflict-handling-001
      turn(5, 'conflict-handling-001', "Tell me about a time you had to push back on a direction you disagreed with.", "I think the best approach is to have open conversations. If I disagree with something I bring it up in the right forum and the team usually works it out. We have a good culture where disagreements get resolved constructively."),
    ],
    scratchpad: {
      dimensionCoverage: { ownership: 1, collaboration: 1, 'learning-orientation': 1, 'conflict-handling': 1, 'self-awareness': 1 },
      probesUsedForCurrentQ: 0,
      runningThemes: [],
    },
  },
  expertCompetencyScores: {
    ownership: 1,
    collaboration: 1,
    'learning-orientation': 1,
    'conflict-handling': 1,
    'self-awareness': 1,
  },
  expertProfileScores: {
    autonomy: 3,
    'risk-tolerance': 2,
    'work-pace': 3,
    'collaboration-style': 4,
    'feedback-orientation': 2,
  },
};

const low02: CalibrationFixture = {
  label: 'LOW-02 — passive, reactive, no STAR structure',
  band: 'LOW',
  transcript: {
    turns: [
      turn(0, 'ownership-001', "Tell me about a time you saw a problem that wasn't yours to fix, and you fixed it anyway.", "My manager pointed out that there was a problem with one of our services. I was asked to look into it so I did. Eventually the issue was resolved and everything was fine."),
      turn(1, 'ownership-002', "Tell me about something you shipped that broke in a way that affected other people.", "There was an incident at my last job where something we shipped caused some errors. The on-call person caught it and we all helped fix it. There was a post-mortem but I don't remember the details."),
      turn(2, 'collaboration-001', "Tell me about a time you disagreed with a teammate on a technical decision.", "There have been disagreements here and there. I usually try to see both sides. In the end we found a middle ground. I think it's important to be flexible."),
      turn(3, 'learning-orientation-001', "Tell me about a time you were wrong about something technical.", "I've made mistakes, everyone has. I try to learn from them. I received feedback once that I needed to improve my communication and I've been working on that."),
      turn(4, 'self-awareness-001', "What's a weakness you've had to actively work on?", "I can be a perfectionist sometimes. I've been working on prioritizing better. I think I'm a lot better at it now than I used to be."),
      turn(5, 'conflict-handling-001', "Tell me about a time you had to push back on a direction you disagreed with.", "I once disagreed with a technical choice but after hearing the reasoning I understood where they were coming from. I try to stay open-minded."),
    ],
    scratchpad: {
      dimensionCoverage: { ownership: 1, collaboration: 1, 'learning-orientation': 1, 'conflict-handling': 1, 'self-awareness': 1 },
      probesUsedForCurrentQ: 0,
      runningThemes: [],
    },
  },
  expertCompetencyScores: {
    ownership: 1,
    collaboration: 2,
    'learning-orientation': 2,
    'conflict-handling': 1,
    'self-awareness': 2,
  },
  expertProfileScores: {
    autonomy: 2,
    'risk-tolerance': 2,
    'work-pace': 2,
    'collaboration-style': 3,
    'feedback-orientation': 2,
  },
};

const low03: CalibrationFixture = {
  label: 'LOW-03 — named events but team-attributed, no personal causal chain',
  band: 'LOW',
  transcript: {
    turns: [
      turn(0, 'ownership-001', "Tell me about a time you saw a problem that wasn't yours to fix, and you fixed it anyway.", "We had a situation where our CI pipeline was flaky. The team noticed it was slowing us down. We spent a sprint working on it and got the failure rate down. It was a collaborative effort across the engineering org."),
      turn(1, 'ownership-002', "Tell me about something you shipped that broke in a way that affected other people.", "We once shipped a feature that had an edge case we hadn't tested. Some users got error pages. We reverted quickly and fixed the edge case. The team was quick to respond."),
      turn(2, 'collaboration-001', "Tell me about a time you disagreed with a teammate on a technical decision.", "We were deciding between two database solutions and the team had split opinions. We held a meeting and each side presented their case. Eventually we voted and went with the majority view. I was on the side that didn't win but I was fine with it."),
      turn(3, 'learning-orientation-001', "Tell me about a time you were wrong about something technical.", "I thought we needed microservices early on but the team ended up not doing that. Looking back they were probably right, a monolith was simpler for where we were. I adapted my thinking."),
      turn(4, 'self-awareness-001', "What's a weakness you've had to actively work on?", "I've struggled with context switching between many projects. My manager gave me feedback about this. I try to timebox my work now which has helped a bit."),
      turn(5, 'conflict-handling-001', "Tell me about a time you had to push back on a direction you disagreed with.", "I once pushed back on a timeline that seemed unrealistic. I mentioned it in the planning meeting. The team adjusted the scope slightly and we shipped on time."),
    ],
    scratchpad: {
      dimensionCoverage: { ownership: 1, collaboration: 1, 'learning-orientation': 1, 'conflict-handling': 1, 'self-awareness': 1 },
      probesUsedForCurrentQ: 0,
      runningThemes: [],
    },
  },
  expertCompetencyScores: {
    ownership: 2,
    collaboration: 2,
    'learning-orientation': 2,
    'conflict-handling': 2,
    'self-awareness': 2,
  },
  expertProfileScores: {
    autonomy: 2,
    'risk-tolerance': 2,
    'work-pace': 3,
    'collaboration-style': 3,
    'feedback-orientation': 3,
  },
};

// ─── MEDIUM band (fixtures 04–07) ─────────────────────────────────────────────
// Some specifics, mixed slot coverage, moderate detail.
// Fixtures 04 and 07 are intentionally borderline (2–3 range).
// Expert scores: mix of 2–4 across dimensions.

const medium04: CalibrationFixture = {
  label: 'MEDIUM-04 (borderline) — specifics present but outcomes vague',
  band: 'MEDIUM',
  transcript: {
    turns: [
      turn(0, 'ownership-001', "Tell me about a time you saw a problem that wasn't yours to fix, and you fixed it anyway.", "Our staging environment kept failing every Friday afternoon. It was owned by the infra team but they were stretched. I looked into the cron job logs myself and found a memory leak in the scheduled report generator. I patched it and it stopped failing. My manager found out and was happy about it."),
      turn(1, 'ownership-002', "Tell me about something you shipped that broke in a way that affected other people.", "I shipped a search ranking change that degraded results for users on mobile. A support ticket flagged it two days later. I diagnosed the problem — the mobile weight coefficient was inverted — reverted it, fixed it, and re-shipped within a day. I sent a note to the product lead explaining what happened."),
      turn(2, 'collaboration-001', "Tell me about a time you disagreed with a teammate on a technical decision.", "My teammate wanted to use GraphQL for our internal admin API and I thought REST was simpler for our use case. I wrote up a short doc comparing the two and we had a call. We ended up going with REST with a plan to revisit if our query patterns got more complex. My teammate agreed it was reasonable given our timeline."),
      turn(3, 'learning-orientation-001', "Tell me about a time you were wrong about something technical.", "I was convinced that optimistic locking was the right solution for our cart service. After a production incident where we got stale inventory data, I dug into it and realized we needed pessimistic locking for that specific path. I updated the implementation and the bugs stopped."),
      turn(4, 'self-awareness-001', "What's a weakness you've had to actively work on?", "I used to give technical feedback in a way that landed as harsh sometimes. A colleague told me directly after a code review. I've been more deliberate about framing feedback as questions rather than statements, and I think it's helped the dynamic on my team."),
      turn(5, 'conflict-handling-001', "Tell me about a time you had to push back on a direction you disagreed with.", "The product manager wanted to ship a feature behind a feature flag permanently instead of cleaning up the dead code path. I said I didn't think that was sustainable and sent her an estimate of the ongoing maintenance cost. We compromised on a six-week cleanup window in the roadmap."),
    ],
    scratchpad: {
      dimensionCoverage: { ownership: 1, collaboration: 1, 'learning-orientation': 1, 'conflict-handling': 1, 'self-awareness': 1 },
      probesUsedForCurrentQ: 0,
      runningThemes: [],
    },
  },
  expertCompetencyScores: {
    ownership: 3,
    collaboration: 3,
    'learning-orientation': 3,
    'conflict-handling': 3,
    'self-awareness': 3,
  },
  expertProfileScores: {
    autonomy: 4,
    'risk-tolerance': 3,
    'work-pace': 3,
    'collaboration-style': 3,
    'feedback-orientation': 3,
  },
};

const medium05: CalibrationFixture = {
  label: 'MEDIUM-05 — good ownership, weaker self-awareness',
  band: 'MEDIUM',
  transcript: {
    turns: [
      turn(0, 'ownership-001', "Tell me about a time you saw a problem that wasn't yours to fix, and you fixed it anyway.", "Our data pipeline was dropping records silently and no one had noticed because the monitoring was inadequate. I noticed it while debugging something unrelated. I wrote a reconciliation script, identified 4,000 dropped records over two weeks, backfilled them, and added a daily row-count alert. The data team was surprised — they hadn't known this was happening."),
      turn(1, 'ownership-002', "Tell me about something you shipped that broke in a way that affected other people.", "I pushed a migration that dropped a column I thought was unused. Turned out a reporting job was still reading it. Reports went dark for two hours. I found the cause in the job logs, restored the column from backup, verified all reports were running, and wrote a SQL query that we now run before any migration to catch live column references."),
      turn(2, 'collaboration-001', "Tell me about a time you disagreed with a teammate on a technical decision.", "My lead wanted to handle rate limiting in each service individually. I thought a shared middleware layer was cleaner and more consistent. We spent an hour on a whiteboard, and I acknowledged his concern about coupling. We went with middleware but with a per-service config override so individual services could opt out if needed."),
      turn(3, 'learning-orientation-001', "Tell me about a time you were wrong about something technical.", "I've been reading more about distributed systems theory but I haven't had a specific moment where I was dramatically wrong yet. I try to stay curious and keep up with new approaches as they emerge."),
      turn(4, 'self-awareness-001', "What's a weakness you've had to actively work on?", "I think I'm pretty good at most things. I sometimes go deep on problems longer than necessary, but I've gotten better at timeboxxing. I'm generally pretty self-aware."),
      turn(5, 'conflict-handling-001', "Tell me about a time you had to push back on a direction you disagreed with.", "The CTO wanted us to rewrite a service in a new language before we understood the domain well. I asked for a meeting, presented the risks with a concrete estimate of rework cost if our domain model changed post-rewrite, and we agreed to delay six weeks to build domain confidence first. That ended up saving us two rewrites."),
    ],
    scratchpad: {
      dimensionCoverage: { ownership: 1, collaboration: 1, 'learning-orientation': 1, 'conflict-handling': 1, 'self-awareness': 1 },
      probesUsedForCurrentQ: 0,
      runningThemes: [],
    },
  },
  expertCompetencyScores: {
    ownership: 4,
    collaboration: 4,
    'learning-orientation': 2,
    'conflict-handling': 4,
    'self-awareness': 2,
  },
  expertProfileScores: {
    autonomy: 4,
    'risk-tolerance': 3,
    'work-pace': 4,
    'collaboration-style': 3,
    'feedback-orientation': 2,
  },
};

const medium06: CalibrationFixture = {
  label: 'MEDIUM-06 — good learning, uneven conflict and collaboration',
  band: 'MEDIUM',
  transcript: {
    turns: [
      turn(0, 'ownership-001', "Tell me about a time you saw a problem that wasn't yours to fix, and you fixed it anyway.", "I noticed our onboarding docs were out of date when I joined. New engineers were confused by steps that no longer existed. I spent my second week rewriting the getting-started guide, validated it with two new joiners, and got it merged. My tech lead thanked me for doing it without being asked."),
      turn(1, 'collaboration-001', "Tell me about a time you disagreed with a teammate on a technical decision.", "We had a disagreement about state management. My colleague wanted Redux and I preferred Zustand. We discussed it but the conversation got a bit heated and eventually my manager stepped in and made the call. We used Zustand."),
      turn(2, 'learning-orientation-001', "Tell me about a time you were wrong about something technical.", "I spent a full quarter building a caching layer before realizing our bottleneck was actually database query design, not cache miss rate. I had made an assumption about where the performance problem was without profiling first. After that incident I now profile before I optimize — always. I've applied that principle to two subsequent projects and avoided similar wasted effort."),
      turn(3, 'self-awareness-001', "What's a weakness you've had to actively work on?", "My skip-level told me I interrupt people in technical discussions. I hadn't noticed it. I started taking notes during meetings so I'd have something to do with the impulse to speak before others finish. My manager confirmed three months later that the team had noticed a difference."),
      turn(4, 'conflict-handling-001', "Tell me about a time you had to push back on a direction you disagreed with.", "Engineering was asked to cut a security audit from the roadmap to hit a launch date. I mentioned in the sprint planning that I was uncomfortable with the risk. My manager said the business call had already been made. I documented my concern in the ADR and moved on."),
      turn(5, 'ownership-002', "Tell me about something you shipped that broke in a way that affected other people.", "A feature I built caused duplicate email sends to about 300 users. I caught it in the morning logs, drafted and sent an apology email via our comms tool within two hours, identified the race condition, deployed a fix, and added an idempotency key pattern to our email send layer so it couldn't recur."),
    ],
    scratchpad: {
      dimensionCoverage: { ownership: 1, collaboration: 1, 'learning-orientation': 1, 'conflict-handling': 1, 'self-awareness': 1 },
      probesUsedForCurrentQ: 0,
      runningThemes: [],
    },
  },
  expertCompetencyScores: {
    ownership: 3,
    collaboration: 2,
    'learning-orientation': 4,
    'conflict-handling': 2,
    'self-awareness': 4,
  },
  expertProfileScores: {
    autonomy: 4,
    'risk-tolerance': 2,
    'work-pace': 3,
    'collaboration-style': 3,
    'feedback-orientation': 4,
  },
};

const medium07: CalibrationFixture = {
  label: 'MEDIUM-07 (borderline) — consistent 2–3, few specifics, plausible stories',
  band: 'MEDIUM',
  transcript: {
    turns: [
      turn(0, 'ownership-001', "Tell me about a time you saw a problem that wasn't yours to fix, and you fixed it anyway.", "Our integration test suite was timing out and causing CI failures. It wasn't really my task but I looked at it, saw the timeouts were too aggressive, bumped them, and it stopped failing. No one had asked me to do it."),
      turn(1, 'ownership-002', "Tell me about something you shipped that broke in a way that affected other people.", "I shipped a config change that broke the admin panel for internal staff. They couldn't log in. I rolled it back within twenty minutes once the Slack message came in, identified the wrong env variable, and fixed it."),
      turn(2, 'collaboration-001', "Tell me about a time you disagreed with a teammate on a technical decision.", "We disagreed on whether to use a third-party auth library or build our own. I laid out the maintenance burden tradeoffs and my teammate agreed to use the library. It was a pretty quick conversation."),
      turn(3, 'learning-orientation-001', "Tell me about a time you were wrong about something technical.", "I was wrong about how React's rendering batching worked before 18. I had written code that assumed state updates were always batched and then found out they weren't in event handlers outside React. I refactored the affected components once I understood the actual behavior."),
      turn(4, 'self-awareness-001', "What's a weakness you've had to actively work on?", "I've gotten feedback that my written communication is too terse and people sometimes misread it as curt. I've been adding more context in Slack and PRs. I think it's improved but I'm not sure by how much."),
      turn(5, 'conflict-handling-001', "Tell me about a time you had to push back on a direction you disagreed with.", "We were asked to skip QA on a release. I said I wasn't comfortable with that and sent a note to my lead listing the risks. He agreed and we did a shortened QA pass instead. It was a small push-back."),
    ],
    scratchpad: {
      dimensionCoverage: { ownership: 1, collaboration: 1, 'learning-orientation': 1, 'conflict-handling': 1, 'self-awareness': 1 },
      probesUsedForCurrentQ: 0,
      runningThemes: [],
    },
  },
  expertCompetencyScores: {
    ownership: 2,
    collaboration: 3,
    'learning-orientation': 3,
    'conflict-handling': 2,
    'self-awareness': 3,
  },
  expertProfileScores: {
    autonomy: 3,
    'risk-tolerance': 2,
    'work-pace': 3,
    'collaboration-style': 3,
    'feedback-orientation': 3,
  },
};

// ─── HIGH band (fixtures 08–10) ──────────────────────────────────────────────
// Concrete situations, named actions, measurable results, genuine reflection.
// Expert scores: mostly 4–5 with realistic variation (no dimension scores all 5s).

const high08: CalibrationFixture = {
  label: 'HIGH-08 — strong ownership + conflict, good across all dims',
  band: 'HIGH',
  transcript: {
    turns: [
      turn(0, 'ownership-001', "Tell me about a time you saw a problem that wasn't yours to fix, and you fixed it anyway.", "Our checkout service was timing out for users on mobile connections — not in our team's SLA, it was the platform team's service. I traced the latency spike using Jaeger, found a N+1 query in their cart aggregation endpoint, wrote a PR with the fix and a benchmark showing 60% latency reduction, and got it merged with their approval in under three hours. I added a Datadog monitor for that specific query pattern so if cardinality grew again we'd catch it in staging."),
      turn(1, 'ownership-002', "Tell me about something you shipped that broke in a way that affected other people.", "I shipped a change to our notification dispatch that skipped deduplication under high load. 8,000 users received duplicate push notifications. I wrote a post-mortem within four hours naming the sequence: the lock contention path I'd introduced, why the load test hadn't caught it, and what I was doing about it. I rebuilt the deduplication layer with a Redis SETNX pattern instead of database locks and ran a load test at 10x production traffic to validate. I also refactored the load test harness to generate burst patterns, which it hadn't been doing before."),
      turn(2, 'collaboration-001', "Tell me about a time you disagreed with a teammate on a technical decision.", "My counterpart on the ML team wanted to deploy a new ranking model directly to 100% of traffic. I thought we needed a staged rollout because the offline evaluation metrics didn't match our online business KPIs historically. I prepared a two-page brief with three rollout scenarios and their risk profiles, shared it 24 hours before the decision meeting, and proposed we start at 5% with automated rollback triggers at two metric thresholds. The ML lead agreed and we codeveloped the rollback criteria together. The model shipped cleanly to 100% over two weeks. The staged approach caught a latency regression at 15% that would have been severe at full traffic."),
      turn(3, 'learning-orientation-001', "Tell me about a time you were wrong about something technical.", "I spent eight months advocating for a service mesh to handle our service-to-service auth. I'd read about it extensively and was confident it was the right architectural move. When we actually piloted it, the operational overhead was three times what I'd estimated and the team didn't have the Kubernetes expertise to operate it safely. I ran a retrospective with the team where I explicitly named my prediction versus the outcome, identified that I'd anchored on the architecture blog posts rather than interviewing teams who'd operated it in production, and we adopted mTLS-via-gateway instead. I now have a rule: never advocate for an approach you haven't interviewed at least two practitioners about."),
      turn(4, 'self-awareness-001', "What's a weakness you've had to actively work on?", "I've had consistent feedback across three different teams that I move to solution mode too quickly — I'll understand a problem well enough to see a solution and start proposing it before other people have felt heard. I started doing a structured restatement step: before I respond to a problem description in a meeting or PR comment, I paraphrase what I heard and check it before offering a solution. My most recent 360 feedback showed a specific improvement noted by four colleagues on 'listening before proposing.' I still have to consciously activate the habit; it hasn't become automatic."),
      turn(5, 'conflict-handling-001', "Tell me about a time you had to push back on a direction you disagreed with.", "My VP wanted to halt all third-party dependency updates for six months to stabilize the platform. I thought that was a net-negative security posture. I wrote a brief classifying our 40 dependencies by risk tier, showed that 7 of them had active CVEs in the frozen versions, and proposed a policy instead: security patches always, minor updates quarterly, major updates with migration budget. The VP was concerned about engineer time and I offered to own the policy doc and the triage process. We adopted the tiered approach. Eight months later it had become org-wide policy."),
    ],
    scratchpad: {
      dimensionCoverage: { ownership: 1, collaboration: 1, 'learning-orientation': 1, 'conflict-handling': 1, 'self-awareness': 1 },
      probesUsedForCurrentQ: 0,
      runningThemes: [],
    },
  },
  expertCompetencyScores: {
    ownership: 5,
    collaboration: 4,
    'learning-orientation': 5,
    'conflict-handling': 5,
    'self-awareness': 4,
  },
  expertProfileScores: {
    autonomy: 5,
    'risk-tolerance': 3,
    'work-pace': 4,
    'collaboration-style': 3,
    'feedback-orientation': 5,
  },
};

const high09: CalibrationFixture = {
  label: 'HIGH-09 — strong collaboration + self-awareness, ownership slightly lower',
  band: 'HIGH',
  transcript: {
    turns: [
      turn(0, 'ownership-001', "Tell me about a time you saw a problem that wasn't yours to fix, and you fixed it anyway.", "Our engineering onboarding checklist hadn't been touched in 18 months. I was the fifth person in a month to waste two hours on a broken step. I catalogued every broken link and outdated step, rewrote the document with tested instructions, added a 'last verified' date block, and set up a monthly calendar reminder shared with the team leads to revalidate it. Onboarding time for the next cohort dropped from roughly a day to four hours based on the feedback form we added."),
      turn(1, 'collaboration-001', "Tell me about a time you disagreed with a teammate on a technical decision.", "The backend lead and I had a fundamental disagreement about whether the API should be versioned from day one. He thought it was premature; I thought retrofitting versioning was always more expensive than building it in. We went back and forth for two meetings without resolution. I proposed we look at three similar systems the team had built and measure what it actually cost them to retrofit versioning. The data showed two of three had significant rework. That concrete evidence moved him. We designed a lightweight versioning scheme that cost less than a day of work and avoided the later problem. He cited that conversation as a model for how to break architecture deadlocks."),
      turn(2, 'learning-orientation-001', "Tell me about a time you were wrong about something technical.", "I was an enthusiastic advocate for event-driven architecture before I had enough domain complexity to justify it. My team spent a sprint building a Kafka pipeline for a use case that a polling job would have solved in two days. I recognized the mistake three weeks in. I wrote it up as a learning doc for the team and added a decision checklist to our architecture review template specifically to challenge event-driven proposals with: 'does this actually need async, or do we want async because it's interesting?' Three subsequent proposals were simplified to synchronous patterns after the checklist was applied."),
      turn(3, 'self-awareness-001', "What's a weakness you've had to actively work on?", "I have a pattern of under-communicating when I'm uncertain. I go quiet in planning meetings when I'm not confident in an estimate and it reads as agreement. My manager flagged this in my first performance review; I'd nodded along to a scope I privately thought was unachievable. I started being explicit about confidence levels: 'I'm at 60% confidence on that estimate, I'd want two hours to sanity check it.' I had to do it mechanically at first but it became natural. The last time I gave a public estimate my skip-level asked where I'd learned that framing — she wanted to use it with her other reports."),
      turn(4, 'conflict-handling-001', "Tell me about a time you had to push back on a direction you disagreed with.", "Legal wanted all AI-generated content flagged with a disclosure that I thought would crater engagement. I didn't just push back — I got engagement data from a competitor who had implemented a similar disclosure. I presented the data alongside the legal risk of not disclosing. We co-designed a disclosure that was legally sufficient but less intrusive. Legal signed off and we measured no engagement impact post-launch."),
      turn(5, 'ownership-002', "Tell me about something you shipped that broke in a way that affected other people.", "I shipped a lazy-loading change that worked perfectly on Chrome but broke Safari's scroll restoration in a way that made pages jump. It was in production for six hours before I saw the Sentry report. I hotfixed it that evening, added Safari to our automated visual regression suite which had been Chrome-only, and wrote a two-paragraph post-mortem in the team Notion. My manager told me the transparency in the post-mortem was what made it a non-event rather than a trust-damaging incident."),
    ],
    scratchpad: {
      dimensionCoverage: { ownership: 1, collaboration: 1, 'learning-orientation': 1, 'conflict-handling': 1, 'self-awareness': 1 },
      probesUsedForCurrentQ: 0,
      runningThemes: [],
    },
  },
  expertCompetencyScores: {
    ownership: 4,
    collaboration: 5,
    'learning-orientation': 4,
    'conflict-handling': 4,
    'self-awareness': 5,
  },
  expertProfileScores: {
    autonomy: 4,
    'risk-tolerance': 3,
    'work-pace': 3,
    'collaboration-style': 4,
    'feedback-orientation': 5,
  },
};

const high10: CalibrationFixture = {
  label: 'HIGH-10 — balanced high across all dims, with probe depth',
  band: 'HIGH',
  transcript: {
    turns: [
      turn(0, 'ownership-001', "Tell me about a time you saw a problem that wasn't yours to fix, and you fixed it anyway.", "Our A/B test platform had a p-value inflation bug that had been producing false positives for about three months. It was the data science team's domain, not mine. I noticed inconsistencies while reviewing a product experiment and dug into the statistics layer. Found that sample ratio mismatch wasn't being detected and the variance estimator assumed independence it wasn't getting. I documented the bug with a worked example, submitted a fix with a simulation showing that the false positive rate dropped from 22% to 4.8%, and ran a retrospective on the four experiments that had launched based on the bad results. Two product decisions had to be revisited. I presented the retrospective to the leadership team voluntarily."),
      turn(1, 'ownership-001', "What did you specifically do once you realized two product decisions needed revisiting?", "I set up 30-minute calls with each product manager. I brought the original experiment data, the corrected analysis, and a recommendation on each — for one experiment the conclusion held under the corrected analysis; for the other it didn't and I recommended reversing the decision. One PM was initially defensive. I walked through the statistics step by step, not as a gotcha but as a shared problem. The decision was ultimately reversed and the product metric recovered to baseline within a sprint.", 'ownership-001'),
      turn(2, 'collaboration-001', "Tell me about a time you disagreed with a teammate on a technical decision.", "My principal engineer wanted to rewrite our search service in Rust before we'd profiled it. I thought the bottleneck was algorithmic, not language-level. I suggested we spend one week profiling before committing to the rewrite. He agreed. Profiling revealed the bottleneck was in a naive similarity computation, not in our Golang overhead. I rewrote the similarity function in three days, achieved a 70% latency reduction, and the Rust rewrite was deprioritized indefinitely. My principal later said the profiling-first principle was something he was going to enforce as a team norm."),
      turn(3, 'learning-orientation-001', "Tell me about a time you were wrong about something technical.", "I was confidently wrong about the CAP theorem implications for our use case for almost two years. I'd read the original paper and thought I understood the consistency–availability tradeoff, but I was applying it to a network partition model that didn't match our actual deployment topology. A distributed systems engineer joined our team and showed me my error in a whiteboard session. I was embarrassed — I'd been giving advice to junior engineers based on a flawed model. I took two weeks to rebuild my understanding from scratch with the correct model, ran an internal workshop to correct the advice I'd given, and now explicitly say 'let me check this against the actual topology' before applying CAP reasoning."),
      turn(4, 'self-awareness-001', "What's a weakness you've had to actively work on?", "I have a strong pattern of avoiding conflict in interpersonal situations even when I shouldn't. I'll give positive feedback in 1:1s and then vent in my manager's ear, which is both cowardly and creates management overhead. I identified this pattern myself after re-reading a performance review and noticing I'd praised someone's work in writing that I'd privately complained about twice. I made a commitment to say difficult things directly to the person first, before going to my manager. I've had three difficult 1:1 conversations in the last six months that I would have previously routed around. Two of them resolved the issue. One made things awkward briefly but the relationship recovered. My manager has commented that I'm no longer 'pre-processing' issues for her that I should own."),
      turn(5, 'conflict-handling-001', "Tell me about a time you had to push back on a direction you disagreed with.", "An exec wanted us to build a recommendation feature with no privacy review on a tight deadline. I refused to start the work without a review — not as a passive objection but as an explicit 'I'm not comfortable building this without reviewing the data access pattern.' I proposed a two-day privacy review sprint with a legal engineer I'd worked with before. The exec pushed back. I stood firm, offered to write the privacy brief myself to keep the timeline impact small, and was ultimately given the two days. The privacy review identified that we were inadvertently exposing watch history across shared-device households, which would have been a significant reputational risk. The exec thanked me afterward."),
    ],
    scratchpad: {
      dimensionCoverage: { ownership: 1, collaboration: 1, 'learning-orientation': 1, 'conflict-handling': 1, 'self-awareness': 1 },
      probesUsedForCurrentQ: 0,
      runningThemes: [],
    },
  },
  expertCompetencyScores: {
    ownership: 5,
    collaboration: 5,
    'learning-orientation': 5,
    'conflict-handling': 5,
    'self-awareness': 5,
  },
  expertProfileScores: {
    autonomy: 5,
    'risk-tolerance': 4,
    'work-pace': 4,
    'collaboration-style': 4,
    'feedback-orientation': 5,
  },
};

// ─── Export ───────────────────────────────────────────────────────────────────

export const CALIBRATION_FIXTURES: CalibrationFixture[] = [
  low01,
  low02,
  low03,
  medium04,
  medium05,
  medium06,
  medium07,
  high08,
  high09,
  high10,
];
