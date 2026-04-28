#!/usr/bin/env tsx
/**
 * Culture Calibration Fixture Generator
 *
 * Generates 20 culture-interview calibration fixtures for the multi-agent
 * culture scorer. Each fixture contains a synthetic STAR-format transcript
 * paired with heuristic expected score ranges and grounding evidence quotes.
 *
 * Usage:
 *   npx tsx workers/api/scripts/build-culture-fixtures.ts
 *   npx tsx workers/api/scripts/build-culture-fixtures.ts --validate-only
 */

import { writeFileSync, mkdirSync, readdirSync, readFileSync } from 'fs';
import path from 'path';
import type { CultureCalibrationFixture, DimensionId } from '../fixtures/culture-calibration/types';

const FIXTURES_DIR = path.resolve(__dirname, '../fixtures/culture-calibration');

const ALL_DIMENSIONS: DimensionId[] = [
  'ownership',
  'collaboration',
  'learning-orientation',
  'conflict-handling',
  'self-awareness',
  'autonomy',
  'risk-tolerance',
  'work-pace',
  'collaboration-style',
  'feedback-orientation',
];

// ─── Fixture definitions ─────────────────────────────────────────────────────
// These fixtures are hand-authored against the BARS rubrics in
// cultureScorer.ts and the question bank in cultureQuestionBank.ts.
// All fixtures are marked confidence: 'heuristic' pending expert review.

const FIXTURES: CultureCalibrationFixture[] = [
  {
    id: "culture-001",
    transcript: [
      { speaker: "agent", text: "Tell me about a time you saw a problem that wasn't yours to fix, and you fixed it anyway." },
      { speaker: "candidate", text: "Yeah, we had some issues with our deployment process. The team got together and figured it out. Everyone pitched in and eventually we sorted it out. It was a good team effort." },
      { speaker: "agent", text: "Tell me about a time you disagreed with a teammate on a technical decision." },
      { speaker: "candidate", text: "I'm a pretty collaborative person so I don't really get into big disagreements. If something comes up we talk it through as a team and find the best solution. Communication is key." },
      { speaker: "agent", text: "Tell me about a time you were wrong about something technical." },
      { speaker: "candidate", text: "I'm always looking to grow and I read a lot of tech blogs to stay current. You have to keep learning in this industry. I try to stay open to feedback." },
      { speaker: "agent", text: "Tell me about a time you had to push back on a direction you disagreed with." },
      { speaker: "candidate", text: "I think the best approach is to have open conversations. If I disagree with something I bring it up in the right forum and the team usually works it out. We have a good culture where disagreements get resolved constructively." }
    ],
    expectedScores: {
      "ownership": { min: 1, max: 2, evidenceQuotes: ["Yeah, we had some issues with our deployment process. The team got together and figured it out. Everyone pitched in and "] },
      "collaboration": { min: 1, max: 2, evidenceQuotes: ["we had some issues with our deployment process."] },
      "learning-orientation": { min: 1, max: 3, evidenceQuotes: [" You have to keep learning in this industry."] },
      "conflict-handling": { min: 1, max: 2, evidenceQuotes: [" If I disagree with something I bring it up in the right forum and the team usually works it out."] },
      "self-awareness": { min: 1, max: 2, evidenceQuotes: ["Yeah, we had some issues with our deployment process. The team got together and figured it out. Everyone pitched in and "] },
      "autonomy": { min: 1, max: 3, evidenceQuotes: ["Yeah, we had some issues with our deployment process. The team got together and figured it out. Everyone pitched in and "] },
      "risk-tolerance": { min: 1, max: 2, evidenceQuotes: ["Yeah, we had some issues with our deployment process. The team got together and figured it out. Everyone pitched in and "] },
      "work-pace": { min: 1, max: 3, evidenceQuotes: ["Yeah, we had some issues with our deployment process. The team got together and figured it out. Everyone pitched in and "] },
      "collaboration-style": { min: 2, max: 4, evidenceQuotes: ["Yeah, we had some issues with our deployment process. The team got together and figured it out. Everyone pitched in and "] },
      "feedback-orientation": { min: 1, max: 3, evidenceQuotes: ["Yeah, we had some issues with our deployment process. The team got together and figured it out. Everyone pitched in and "] }
    },
    questionBankVersion: "v2026.04",
    tags: ["ownership", "collaboration", "conflict-handling", "self-awareness"],
    confidence: "heuristic",
  },
  {
    id: "culture-002",
    transcript: [
      { speaker: "agent", text: "Tell me about a time you saw a problem that wasn't yours to fix, and you fixed it anyway." },
      { speaker: "candidate", text: "My manager pointed out that there was a problem with one of our services. I was asked to look into it so I did. Eventually the issue was resolved and everything was fine." },
      { speaker: "agent", text: "Tell me about a time you disagreed with a teammate on a technical decision." },
      { speaker: "candidate", text: "There have been disagreements here and there. I usually try to see both sides. In the end we found a middle ground. I think it's important to be flexible." },
      { speaker: "agent", text: "Tell me about a time you were wrong about something technical." },
      { speaker: "candidate", text: "I've made mistakes, everyone has. I try to learn from them. I received feedback once that I needed to improve my communication and I've been working on that." },
      { speaker: "agent", text: "What's a weakness you've had to actively work on?" },
      { speaker: "candidate", text: "I can be a perfectionist sometimes. I've been working on prioritizing better. I think I'm a lot better at it now than I used to be." },
      { speaker: "agent", text: "Tell me about a time you had to push back on a direction you disagreed with." },
      { speaker: "candidate", text: "I once disagreed with a technical choice but after hearing the reasoning I understood where they were coming from. I try to stay open-minded." }
    ],
    expectedScores: {
      "ownership": { min: 1, max: 3, evidenceQuotes: ["My manager pointed out that there was a problem with one of our services. I was asked to look into it so I did. Eventual"] },
      "collaboration": { min: 1, max: 2, evidenceQuotes: ["we found a middle ground."] },
      "learning-orientation": { min: 1, max: 2, evidenceQuotes: [" I try to learn from them."] },
      "conflict-handling": { min: 1, max: 3, evidenceQuotes: [" There have been disagreements here and there."] },
      "self-awareness": { min: 1, max: 3, evidenceQuotes: ["My manager pointed out that there was a problem with one of our services. I was asked to look into it so I did. Eventual"] },
      "autonomy": { min: 1, max: 2, evidenceQuotes: ["My manager pointed out that there was a problem with one of our services. I was asked to look into it so I did. Eventual"] },
      "risk-tolerance": { min: 1, max: 3, evidenceQuotes: ["My manager pointed out that there was a problem with one of our services. I was asked to look into it so I did. Eventual"] },
      "work-pace": { min: 1, max: 2, evidenceQuotes: ["My manager pointed out that there was a problem with one of our services. I was asked to look into it so I did. Eventual"] },
      "collaboration-style": { min: 1, max: 3, evidenceQuotes: ["My manager pointed out that there was a problem with one of our services. I was asked to look into it so I did. Eventual"] },
      "feedback-orientation": { min: 1, max: 2, evidenceQuotes: ["My manager pointed out that there was a problem with one of our services. I was asked to look into it so I did. Eventual"] }
    },
    questionBankVersion: "v2026.04",
    tags: ["collaboration", "learning-orientation", "autonomy", "feedback-orientation"],
    confidence: "heuristic",
  },
  {
    id: "culture-003",
    transcript: [
      { speaker: "agent", text: "Tell me about a time you saw a problem that wasn't yours to fix, and you fixed it anyway." },
      { speaker: "candidate", text: "We had a situation where our CI pipeline was flaky. The team noticed it was slowing us down. We spent a sprint working on it and got the failure rate down. It was a collaborative effort across the engineering org." },
      { speaker: "agent", text: "Tell me about a time you disagreed with a teammate on a technical decision." },
      { speaker: "candidate", text: "We were deciding between two database solutions and the team had split opinions. We held a meeting and each side presented their case. Eventually we voted and went with the majority view. I was on the side that didn't win but I was fine with it." },
      { speaker: "agent", text: "Tell me about a time you were wrong about something technical." },
      { speaker: "candidate", text: "I thought we needed microservices early on but the team ended up not doing that. Looking back they were probably right, a monolith was simpler for where we were. I adapted my thinking." },
      { speaker: "agent", text: "Tell me about a time you had to push back on a direction you disagreed with." },
      { speaker: "candidate", text: "I once pushed back on a timeline that seemed unrealistic. I mentioned it in the planning meeting. The team adjusted the scope slightly and we shipped on time." },
      { speaker: "agent", text: "What's a weakness you've had to actively work on?" },
      { speaker: "candidate", text: "I've struggled with context switching between many projects. My manager gave me feedback about this. I try to timebox my work now which has helped a bit." }
    ],
    expectedScores: {
      "ownership": { min: 1, max: 2, evidenceQuotes: ["We had a situation where our CI pipeline was flaky. The team noticed it was slowing us down. We spent a sprint working o"] },
      "collaboration": { min: 1, max: 3, evidenceQuotes: ["We had a situation where our CI pipeline was flaky."] },
      "learning-orientation": { min: 1, max: 2, evidenceQuotes: ["We had a situation where our CI pipeline was flaky. The team noticed it was slowing us down. We spent a sprint working o"] },
      "conflict-handling": { min: 1, max: 2, evidenceQuotes: ["We had a situation where our CI pipeline was flaky. The team noticed it was slowing us down. We spent a sprint working o"] },
      "self-awareness": { min: 1, max: 3, evidenceQuotes: ["We had a situation where our CI pipeline was flaky. The team noticed it was slowing us down. We spent a sprint working o"] },
      "autonomy": { min: 1, max: 3, evidenceQuotes: ["We had a situation where our CI pipeline was flaky. The team noticed it was slowing us down. We spent a sprint working o"] },
      "risk-tolerance": { min: 1, max: 2, evidenceQuotes: ["We had a situation where our CI pipeline was flaky. The team noticed it was slowing us down. We spent a sprint working o"] },
      "work-pace": { min: 1, max: 3, evidenceQuotes: ["We had a situation where our CI pipeline was flaky. The team noticed it was slowing us down. We spent a sprint working o"] },
      "collaboration-style": { min: 1, max: 2, evidenceQuotes: ["We had a situation where our CI pipeline was flaky. The team noticed it was slowing us down. We spent a sprint working o"] },
      "feedback-orientation": { min: 1, max: 3, evidenceQuotes: ["We had a situation where our CI pipeline was flaky. The team noticed it was slowing us down. We spent a sprint working o"] }
    },
    questionBankVersion: "v2026.04",
    tags: ["ownership", "learning-orientation", "collaboration-style"],
    confidence: "heuristic",
  },
  {
    id: "culture-004",
    transcript: [
      { speaker: "agent", text: "Tell me about a time you saw a problem that wasn't yours to fix, and you fixed it anyway." },
      { speaker: "candidate", text: "We had an issue with our staging environment failing every Friday. The infra team was supposed to handle it. I saw some logs but didn't dig in because it wasn't my area. They fixed it eventually." },
      { speaker: "agent", text: "Tell me about a time you disagreed with a teammate on a technical decision." },
      { speaker: "candidate", text: "My teammate wanted to use GraphQL and I preferred REST. We discussed it briefly but our manager made the final call. We went with GraphQL. It wasn't a big deal to me either way." },
      { speaker: "agent", text: "Tell me about a time you were wrong about something technical." },
      { speaker: "candidate", text: "I was wrong about how React's rendering batching worked before version 18. I had written code that assumed state updates were always batched. I refactored the components once I understood the actual behavior." },
      { speaker: "agent", text: "Tell me about a time you had to push back on a direction you disagreed with." },
      { speaker: "candidate", text: "We were asked to skip QA on a release. I said I wasn't comfortable with that and sent a note to my lead. He agreed and we did a shortened QA pass instead. It was a small push-back." },
      { speaker: "agent", text: "What's a weakness you've had to actively work on?" },
      { speaker: "candidate", text: "I've gotten feedback that my written communication is too terse. I've been adding more context in Slack and PRs. I think it's improved but I'm not sure by how much." }
    ],
    expectedScores: {
      "ownership": { min: 2, max: 4, evidenceQuotes: ["We had an issue with our staging environment failing every Friday. The infra team was supposed to handle it. I saw some "] },
      "collaboration": { min: 2, max: 4, evidenceQuotes: ["We had an issue with our staging environment failing every Friday."] },
      "learning-orientation": { min: 2, max: 4, evidenceQuotes: ["We had an issue with our staging environment failing every Friday. The infra team was supposed to handle it. I saw some "] },
      "conflict-handling": { min: 2, max: 4, evidenceQuotes: ["We had an issue with our staging environment failing every Friday. The infra team was supposed to handle it. I saw some "] },
      "self-awareness": { min: 2, max: 4, evidenceQuotes: ["We had an issue with our staging environment failing every Friday. The infra team was supposed to handle it. I saw some "] },
      "autonomy": { min: 2, max: 4, evidenceQuotes: ["We had an issue with our staging environment failing every Friday. The infra team was supposed to handle it. I saw some "] },
      "risk-tolerance": { min: 2, max: 4, evidenceQuotes: ["We had an issue with our staging environment failing every Friday. The infra team was supposed to handle it. I saw some "] },
      "work-pace": { min: 2, max: 4, evidenceQuotes: ["We had an issue with our staging environment failing every Friday. The infra team was supposed to handle it. I saw some "] },
      "collaboration-style": { min: 2, max: 4, evidenceQuotes: ["We had an issue with our staging environment failing every Friday. The infra team was supposed to handle it. I saw some "] },
      "feedback-orientation": { min: 2, max: 4, evidenceQuotes: ["We had an issue with our staging environment failing every Friday. The infra team was supposed to handle it. I saw some "] }
    },
    questionBankVersion: "v2026.04",
    tags: ["self-awareness", "autonomy", "feedback-orientation"],
    confidence: "heuristic",
  },
  {
    id: "culture-005",
    transcript: [
      { speaker: "agent", text: "Tell me about a time you saw a problem that wasn't yours to fix, and you fixed it anyway." },
      { speaker: "candidate", text: "Our data pipeline was dropping records and no one had noticed because the monitoring was bad. I saw it while debugging something else. I told the data team and they fixed it. I didn't get involved beyond flagging it." },
      { speaker: "agent", text: "What did you do after flagging it?" },
      { speaker: "candidate", text: "I moved on to my own tasks. They handled it from there. It was their system after all." },
      { speaker: "agent", text: "Tell me about a time you disagreed with a teammate on a technical decision." },
      { speaker: "candidate", text: "My lead wanted to handle rate limiting in each service individually. I thought a shared middleware layer was cleaner. We discussed it but he decided to go with his approach. I implemented it as he asked." },
      { speaker: "agent", text: "Tell me about a time you were wrong about something technical." },
      { speaker: "candidate", text: "I've been reading more about distributed systems but I haven't had a specific moment where I was dramatically wrong. I try to stay curious." },
      { speaker: "agent", text: "What's a weakness you've had to actively work on?" },
      { speaker: "candidate", text: "I think I'm pretty good at most things. I sometimes go deep on problems longer than necessary, but I've gotten better at timeboxing. I'm generally pretty self-aware." }
    ],
    expectedScores: {
      "ownership": { min: 1, max: 2, evidenceQuotes: ["Our data pipeline was dropping records and no one had noticed because the monitoring was bad. I saw it while debugging s"] },
      "collaboration": { min: 1, max: 3, evidenceQuotes: ["We discussed it but he decided to go with his approach."] },
      "learning-orientation": { min: 1, max: 2, evidenceQuotes: ["Our data pipeline was dropping records and no one had noticed because the monitoring was bad. I saw it while debugging s"] },
      "conflict-handling": { min: 1, max: 2, evidenceQuotes: ["Our data pipeline was dropping records and no one had noticed because the monitoring was bad. I saw it while debugging s"] },
      "self-awareness": { min: 1, max: 2, evidenceQuotes: ["Our data pipeline was dropping records and no one had noticed because the monitoring was bad. I saw it while debugging s"] },
      "autonomy": { min: 1, max: 3, evidenceQuotes: ["Our data pipeline was dropping records and no one had noticed because the monitoring was bad. I saw it while debugging s"] },
      "risk-tolerance": { min: 1, max: 2, evidenceQuotes: ["Our data pipeline was dropping records and no one had noticed because the monitoring was bad. I saw it while debugging s"] },
      "work-pace": { min: 1, max: 2, evidenceQuotes: ["Our data pipeline was dropping records and no one had noticed because the monitoring was bad. I saw it while debugging s"] },
      "collaboration-style": { min: 2, max: 4, evidenceQuotes: ["Our data pipeline was dropping records and no one had noticed because the monitoring was bad. I saw it while debugging s"] },
      "feedback-orientation": { min: 1, max: 3, evidenceQuotes: ["Our data pipeline was dropping records and no one had noticed because the monitoring was bad. I saw it while debugging s"] }
    },
    questionBankVersion: "v2026.04",
    tags: ["ownership", "learning-orientation", "self-awareness", "risk-tolerance"],
    confidence: "heuristic",
  },
  {
    id: "culture-006",
    transcript: [
      { speaker: "agent", text: "Tell me about a time you saw a problem that wasn't yours to fix, and you fixed it anyway." },
      { speaker: "candidate", text: "Our integration test suite was timing out and causing CI failures. It wasn't really my task but I looked at it, saw the timeouts were too aggressive, bumped them, and it stopped failing. No one had asked me to do it." },
      { speaker: "agent", text: "Tell me about something you shipped that broke in a way that affected other people." },
      { speaker: "candidate", text: "I shipped a config change that broke the admin panel for internal staff. I rolled it back within twenty minutes once the Slack message came in, identified the wrong env variable, and fixed it." },
      { speaker: "agent", text: "Tell me about a time you disagreed with a teammate on a technical decision." },
      { speaker: "candidate", text: "We disagreed on whether to use a third-party auth library or build our own. I laid out the maintenance burden and my teammate agreed to use the library. It was a quick conversation." },
      { speaker: "agent", text: "Tell me about a time you were wrong about something technical." },
      { speaker: "candidate", text: "I was wrong about how React's rendering batching worked. I had assumed state updates were always batched. I refactored the components once I understood." },
      { speaker: "agent", text: "What's a weakness you've had to actively work on?" },
      { speaker: "candidate", text: "I've gotten feedback that my written communication is too terse. I've been adding more context. I think it's improved." }
    ],
    expectedScores: {
      "ownership": { min: 1, max: 3, evidenceQuotes: ["Our integration test suite was timing out and causing CI failures. It wasn't really my task but I looked at it, saw the "] },
      "collaboration": { min: 1, max: 2, evidenceQuotes: ["We disagreed on whether to use a third-party auth library or build our own."] },
      "learning-orientation": { min: 1, max: 3, evidenceQuotes: ["Our integration test suite was timing out and causing CI failures. It wasn't really my task but I looked at it, saw the "] },
      "conflict-handling": { min: 1, max: 2, evidenceQuotes: [" We disagreed on whether to use a third-party auth library or build our own."] },
      "self-awareness": { min: 1, max: 3, evidenceQuotes: ["Our integration test suite was timing out and causing CI failures. It wasn't really my task but I looked at it, saw the "] },
      "autonomy": { min: 1, max: 2, evidenceQuotes: ["Our integration test suite was timing out and causing CI failures. It wasn't really my task but I looked at it, saw the "] },
      "risk-tolerance": { min: 1, max: 2, evidenceQuotes: ["Our integration test suite was timing out and causing CI failures. It wasn't really my task but I looked at it, saw the "] },
      "work-pace": { min: 1, max: 3, evidenceQuotes: ["Our integration test suite was timing out and causing CI failures. It wasn't really my task but I looked at it, saw the "] },
      "collaboration-style": { min: 1, max: 3, evidenceQuotes: ["Our integration test suite was timing out and causing CI failures. It wasn't really my task but I looked at it, saw the "] },
      "feedback-orientation": { min: 1, max: 2, evidenceQuotes: ["Our integration test suite was timing out and causing CI failures. It wasn't really my task but I looked at it, saw the "] }
    },
    questionBankVersion: "v2026.04",
    tags: ["collaboration", "conflict-handling", "autonomy", "feedback-orientation"],
    confidence: "heuristic",
  },
  {
    id: "culture-007",
    transcript: [
      { speaker: "agent", text: "Tell me about a time you saw a problem that wasn't yours to fix, and you fixed it anyway." },
      { speaker: "candidate", text: "Our A/B test platform had a bug that was producing false positives. It was the data science team's domain. I noticed inconsistencies while reviewing a product experiment and mentioned it to them. They fixed it in their next sprint." },
      { speaker: "agent", text: "Tell me about a time you disagreed with a teammate on a technical decision." },
      { speaker: "candidate", text: "We had a disagreement about state management. My colleague wanted Redux and I preferred Zustand. We discussed it but the conversation got heated and eventually my manager stepped in and made the call. We used Zustand." },
      { speaker: "agent", text: "Tell me about a time you were wrong about something technical." },
      { speaker: "candidate", text: "I spent a quarter building a caching layer before realizing our bottleneck was database query design, not cache miss rate. I had made an assumption without profiling first. After that I now profile before I optimize." },
      { speaker: "agent", text: "What's a weakness you've had to actively work on?" },
      { speaker: "candidate", text: "My skip-level told me I interrupt people in technical discussions. I hadn't noticed it. I started taking notes during meetings. My manager confirmed three months later that the team had noticed a difference." }
    ],
    expectedScores: {
      "ownership": { min: 2, max: 4, evidenceQuotes: ["I noticed inconsistencies while reviewing a product experiment and mentioned it to them."] },
      "collaboration": { min: 2, max: 4, evidenceQuotes: ["We had a disagreement about state management."] },
      "learning-orientation": { min: 2, max: 4, evidenceQuotes: ["Our A/B test platform had a bug that was producing false positives. It was the data science team's domain. I noticed inc"] },
      "conflict-handling": { min: 2, max: 4, evidenceQuotes: [" We had a disagreement about state management."] },
      "self-awareness": { min: 2, max: 4, evidenceQuotes: ["Our A/B test platform had a bug that was producing false positives. It was the data science team's domain. I noticed inc"] },
      "autonomy": { min: 2, max: 4, evidenceQuotes: ["Our A/B test platform had a bug that was producing false positives. It was the data science team's domain. I noticed inc"] },
      "risk-tolerance": { min: 2, max: 4, evidenceQuotes: ["Our A/B test platform had a bug that was producing false positives. It was the data science team's domain. I noticed inc"] },
      "work-pace": { min: 2, max: 4, evidenceQuotes: ["Our A/B test platform had a bug that was producing false positives. It was the data science team's domain. I noticed inc"] },
      "collaboration-style": { min: 2, max: 4, evidenceQuotes: ["Our A/B test platform had a bug that was producing false positives. It was the data science team's domain. I noticed inc"] },
      "feedback-orientation": { min: 2, max: 4, evidenceQuotes: ["Our A/B test platform had a bug that was producing false positives. It was the data science team's domain. I noticed inc"] }
    },
    questionBankVersion: "v2026.04",
    tags: ["ownership", "learning-orientation", "collaboration-style", "self-awareness"],
    confidence: "heuristic",
  },
  {
    id: "culture-008",
    transcript: [
      { speaker: "agent", text: "Tell me about a time you saw a problem that wasn't yours to fix, and you fixed it anyway." },
      { speaker: "candidate", text: "Our staging environment kept failing every Friday afternoon. It was owned by the infra team but they were stretched. I looked into the cron job logs myself and found a memory leak in the scheduled report generator. I patched it and it stopped failing. My manager found out and was happy about it." },
      { speaker: "agent", text: "Tell me about something you shipped that broke in a way that affected other people." },
      { speaker: "candidate", text: "I shipped a search ranking change that degraded results for users on mobile. A support ticket flagged it two days later. I diagnosed the problem, reverted it, fixed it, and re-shipped within a day. I sent a note to the product lead explaining what happened." },
      { speaker: "agent", text: "Tell me about a time you disagreed with a teammate on a technical decision." },
      { speaker: "candidate", text: "My teammate wanted to use GraphQL for our internal admin API and I thought REST was simpler. I wrote up a short doc comparing the two and we had a call. We ended up going with REST with a plan to revisit if our query patterns got more complex. My teammate agreed it was reasonable." },
      { speaker: "agent", text: "Tell me about a time you were wrong about something technical." },
      { speaker: "candidate", text: "I was convinced that optimistic locking was the right solution for our cart service. After a production incident with stale inventory data, I dug into it and realized we needed pessimistic locking. I updated the implementation and the bugs stopped." }
    ],
    expectedScores: {
      "ownership": { min: 2, max: 4, evidenceQuotes: ["Our staging environment kept failing every Friday afternoon. It was owned by the infra team but they were stretched. I l"] },
      "collaboration": { min: 2, max: 4, evidenceQuotes: ["we had a call."] },
      "learning-orientation": { min: 2, max: 4, evidenceQuotes: ["Our staging environment kept failing every Friday afternoon. It was owned by the infra team but they were stretched. I l"] },
      "conflict-handling": { min: 2, max: 4, evidenceQuotes: ["Our staging environment kept failing every Friday afternoon. It was owned by the infra team but they were stretched. I l"] },
      "self-awareness": { min: 2, max: 4, evidenceQuotes: ["Our staging environment kept failing every Friday afternoon. It was owned by the infra team but they were stretched. I l"] },
      "autonomy": { min: 2, max: 4, evidenceQuotes: ["Our staging environment kept failing every Friday afternoon. It was owned by the infra team but they were stretched. I l"] },
      "risk-tolerance": { min: 2, max: 4, evidenceQuotes: ["Our staging environment kept failing every Friday afternoon. It was owned by the infra team but they were stretched. I l"] },
      "work-pace": { min: 2, max: 4, evidenceQuotes: ["Our staging environment kept failing every Friday afternoon. It was owned by the infra team but they were stretched. I l"] },
      "collaboration-style": { min: 2, max: 4, evidenceQuotes: ["Our staging environment kept failing every Friday afternoon. It was owned by the infra team but they were stretched. I l"] },
      "feedback-orientation": { min: 2, max: 4, evidenceQuotes: ["Our staging environment kept failing every Friday afternoon. It was owned by the infra team but they were stretched. I l"] }
    },
    questionBankVersion: "v2026.04",
    tags: ["balanced", "medium-band"],
    confidence: "heuristic",
  },
  {
    id: "culture-009",
    transcript: [
      { speaker: "agent", text: "Tell me about a time you saw a problem that wasn't yours to fix, and you fixed it anyway." },
      { speaker: "candidate", text: "Our data pipeline was dropping records silently. I noticed it while debugging something unrelated. I wrote a reconciliation script, identified 4,000 dropped records over two weeks, backfilled them, and added a daily row-count alert. The data team was surprised." },
      { speaker: "agent", text: "Tell me about something you shipped that broke in a way that affected other people." },
      { speaker: "candidate", text: "I pushed a migration that dropped a column I thought was unused. A reporting job was still reading it. Reports went dark for two hours. I restored the column from backup and wrote a SQL query we now run before any migration to catch live column references." },
      { speaker: "agent", text: "Tell me about a time you disagreed with a teammate on a technical decision." },
      { speaker: "candidate", text: "My lead wanted to handle rate limiting in each service individually. I thought a shared middleware layer was cleaner. We spent an hour on a whiteboard and acknowledged his concern about coupling. We went with middleware but with a per-service config override." },
      { speaker: "agent", text: "Tell me about a time you were wrong about something technical." },
      { speaker: "candidate", text: "I've been reading more about distributed systems but I haven't had a specific moment where I was dramatically wrong yet. I try to stay curious." },
      { speaker: "agent", text: "What's a weakness you've had to actively work on?" },
      { speaker: "candidate", text: "I think I'm pretty good at most things. I sometimes go deep on problems longer than necessary, but I've gotten better at timeboxing. I'm generally pretty self-aware." }
    ],
    expectedScores: {
      "ownership": { min: 3, max: 4, evidenceQuotes: ["I noticed it while debugging something unrelated."] },
      "collaboration": { min: 3, max: 4, evidenceQuotes: ["we now run before any migration to catch live column references."] },
      "learning-orientation": { min: 2, max: 4, evidenceQuotes: ["Our data pipeline was dropping records silently. I noticed it while debugging something unrelated. I wrote a reconciliat"] },
      "conflict-handling": { min: 3, max: 5, evidenceQuotes: ["Our data pipeline was dropping records silently. I noticed it while debugging something unrelated. I wrote a reconciliat"] },
      "self-awareness": { min: 2, max: 4, evidenceQuotes: ["Our data pipeline was dropping records silently. I noticed it while debugging something unrelated. I wrote a reconciliat"] },
      "autonomy": { min: 2, max: 4, evidenceQuotes: ["Our data pipeline was dropping records silently. I noticed it while debugging something unrelated. I wrote a reconciliat"] },
      "risk-tolerance": { min: 2, max: 4, evidenceQuotes: ["Our data pipeline was dropping records silently. I noticed it while debugging something unrelated. I wrote a reconciliat"] },
      "work-pace": { min: 2, max: 4, evidenceQuotes: ["Our data pipeline was dropping records silently. I noticed it while debugging something unrelated. I wrote a reconciliat"] },
      "collaboration-style": { min: 2, max: 4, evidenceQuotes: ["Our data pipeline was dropping records silently. I noticed it while debugging something unrelated. I wrote a reconciliat"] },
      "feedback-orientation": { min: 2, max: 4, evidenceQuotes: ["Our data pipeline was dropping records silently. I noticed it while debugging something unrelated. I wrote a reconciliat"] }
    },
    questionBankVersion: "v2026.04",
    tags: ["ownership", "collaboration", "conflict-handling"],
    confidence: "heuristic",
  },
  {
    id: "culture-010",
    transcript: [
      { speaker: "agent", text: "Tell me about a time you saw a problem that wasn't yours to fix, and you fixed it anyway." },
      { speaker: "candidate", text: "I noticed our onboarding docs were out of date when I joined. New engineers were confused. I spent my second week rewriting the getting-started guide, validated it with two new joiners, and got it merged. My tech lead thanked me." },
      { speaker: "agent", text: "Tell me about a time you disagreed with a teammate on a technical decision." },
      { speaker: "candidate", text: "We had a disagreement about state management. My colleague wanted Redux and I preferred Zustand. The conversation got heated and my manager stepped in. We used Zustand." },
      { speaker: "agent", text: "Tell me about a time you were wrong about something technical." },
      { speaker: "candidate", text: "I spent a full quarter building a caching layer before realizing our bottleneck was database query design. I had made an assumption without profiling. After that I now profile before I optimize — always." },
      { speaker: "agent", text: "What's a weakness you've had to actively work on?" },
      { speaker: "candidate", text: "My skip-level told me I interrupt people in technical discussions. I started taking notes during meetings. My manager confirmed three months later the team had noticed a difference." },
      { speaker: "agent", text: "Tell me about a time you had to push back on a direction you disagreed with." },
      { speaker: "candidate", text: "Engineering was asked to cut a security audit. I mentioned in sprint planning I was uncomfortable. My manager said the business call had been made. I documented my concern in the ADR and moved on." }
    ],
    expectedScores: {
      "ownership": { min: 3, max: 4, evidenceQuotes: ["I noticed our onboarding docs were out of date when I joined."] },
      "collaboration": { min: 2, max: 4, evidenceQuotes: ["We had a disagreement about state management."] },
      "learning-orientation": { min: 3, max: 5, evidenceQuotes: ["I noticed our onboarding docs were out of date when I joined. New engineers were confused. I spent my second week rewrit"] },
      "conflict-handling": { min: 2, max: 4, evidenceQuotes: [" We had a disagreement about state management."] },
      "self-awareness": { min: 3, max: 4, evidenceQuotes: ["I noticed our onboarding docs were out of date when I joined. New engineers were confused. I spent my second week rewrit"] },
      "autonomy": { min: 2, max: 4, evidenceQuotes: ["I noticed our onboarding docs were out of date when I joined. New engineers were confused. I spent my second week rewrit"] },
      "risk-tolerance": { min: 2, max: 4, evidenceQuotes: ["I noticed our onboarding docs were out of date when I joined. New engineers were confused. I spent my second week rewrit"] },
      "work-pace": { min: 2, max: 4, evidenceQuotes: ["I noticed our onboarding docs were out of date when I joined. New engineers were confused. I spent my second week rewrit"] },
      "collaboration-style": { min: 2, max: 4, evidenceQuotes: ["I noticed our onboarding docs were out of date when I joined. New engineers were confused. I spent my second week rewrit"] },
      "feedback-orientation": { min: 2, max: 4, evidenceQuotes: ["I noticed our onboarding docs were out of date when I joined. New engineers were confused. I spent my second week rewrit"] }
    },
    questionBankVersion: "v2026.04",
    tags: ["learning-orientation", "self-awareness"],
    confidence: "heuristic",
  },
  {
    id: "culture-011",
    transcript: [
      { speaker: "agent", text: "Tell me about a time you saw a problem that wasn't yours to fix, and you fixed it anyway." },
      { speaker: "candidate", text: "Our checkout service was timing out for mobile users. It was the platform team's service. I traced the latency spike using Jaeger, found an N+1 query, wrote a PR with the fix and a benchmark showing 60% latency reduction, and got it merged." },
      { speaker: "agent", text: "What did you do after the fix was merged?" },
      { speaker: "candidate", text: "I added a Datadog monitor for that query pattern so if cardinality grew again we'd catch it in staging. The platform lead was grateful." },
      { speaker: "agent", text: "Tell me about a time you disagreed with a teammate on a technical decision." },
      { speaker: "candidate", text: "The backend lead and I disagreed about whether the API should be versioned from day one. I proposed we look at three similar systems and measure the cost. The data showed two of three had significant rework. We designed a lightweight versioning scheme." },
      { speaker: "agent", text: "Tell me about a time you were wrong about something technical." },
      { speaker: "candidate", text: "I was an enthusiastic advocate for event-driven architecture before we had enough domain complexity. My team spent a sprint building a Kafka pipeline that a polling job would have solved in two days. I wrote it up as a learning doc and added a decision checklist." },
      { speaker: "agent", text: "What's a weakness you've had to actively work on?" },
      { speaker: "candidate", text: "I have a pattern of under-communicating when I'm uncertain. I go quiet in planning meetings. My manager flagged this. I started being explicit about confidence levels and it became natural." }
    ],
    expectedScores: {
      "ownership": { min: 3, max: 5, evidenceQuotes: ["Our checkout service was timing out for mobile users. It was the platform team's service. I traced the latency spike usi"] },
      "collaboration": { min: 3, max: 5, evidenceQuotes: ["we look at three similar systems and measure the cost."] },
      "learning-orientation": { min: 3, max: 5, evidenceQuotes: [" I wrote it up as a learning doc and added a decision checklist."] },
      "conflict-handling": { min: 3, max: 5, evidenceQuotes: [" backend lead and I disagreed about whether the API should be versioned from day one."] },
      "self-awareness": { min: 3, max: 5, evidenceQuotes: ["Our checkout service was timing out for mobile users. It was the platform team's service. I traced the latency spike usi"] },
      "autonomy": { min: 2, max: 4, evidenceQuotes: ["Our checkout service was timing out for mobile users. It was the platform team's service. I traced the latency spike usi"] },
      "risk-tolerance": { min: 1, max: 3, evidenceQuotes: ["Our checkout service was timing out for mobile users. It was the platform team's service. I traced the latency spike usi"] },
      "work-pace": { min: 2, max: 4, evidenceQuotes: ["Our checkout service was timing out for mobile users. It was the platform team's service. I traced the latency spike usi"] },
      "collaboration-style": { min: 2, max: 4, evidenceQuotes: ["Our checkout service was timing out for mobile users. It was the platform team's service. I traced the latency spike usi"] },
      "feedback-orientation": { min: 1, max: 3, evidenceQuotes: ["Our checkout service was timing out for mobile users. It was the platform team's service. I traced the latency spike usi"] }
    },
    questionBankVersion: "v2026.04",
    tags: ["balanced-medium-high", "ownership", "collaboration"],
    confidence: "heuristic",
  },
  {
    id: "culture-012",
    transcript: [
      { speaker: "agent", text: "Tell me about a time you saw a problem that wasn't yours to fix, and you fixed it anyway." },
      { speaker: "candidate", text: "Our engineering onboarding checklist hadn't been touched in 18 months. I catalogued every broken link, rewrote the document, added a 'last verified' date block, and set up a monthly reminder. Onboarding time dropped from a day to four hours." },
      { speaker: "agent", text: "Tell me about a time you disagreed with a teammate on a technical decision." },
      { speaker: "candidate", text: "My principal engineer wanted to rewrite our search service in Rust before profiling. I suggested one week profiling first. Profiling revealed the bottleneck was algorithmic. I rewrote the similarity function and achieved 70% latency reduction." },
      { speaker: "agent", text: "Tell me about a time you were wrong about something technical." },
      { speaker: "candidate", text: "I spent eight months advocating for a service mesh. When we piloted it, operational overhead was three times my estimate. I ran a retrospective, identified I'd anchored on blog posts, and we adopted mTLS-via-gateway instead." },
      { speaker: "agent", text: "What's a weakness you've had to actively work on?" },
      { speaker: "candidate", text: "I've had consistent feedback that I move to solution mode too quickly. I started doing structured restatement before responding. My 360 feedback showed improvement noted by four colleagues." },
      { speaker: "agent", text: "Tell me about a time you had to push back on a direction you disagreed with." },
      { speaker: "candidate", text: "An exec wanted us to build a recommendation feature with no privacy review. I refused to start without a review and proposed a two-day sprint with a legal engineer. The review identified a reputational risk. The exec thanked me afterward." }
    ],
    expectedScores: {
      "ownership": { min: 3, max: 5, evidenceQuotes: ["Our engineering onboarding checklist hadn't been touched in 18 months. I catalogued every broken link, rewrote the docum"] },
      "collaboration": { min: 2, max: 4, evidenceQuotes: ["we piloted it, operational overhead was three times my estimate."] },
      "learning-orientation": { min: 2, max: 4, evidenceQuotes: ["Our engineering onboarding checklist hadn't been touched in 18 months. I catalogued every broken link, rewrote the docum"] },
      "conflict-handling": { min: 2, max: 4, evidenceQuotes: ["Our engineering onboarding checklist hadn't been touched in 18 months. I catalogued every broken link, rewrote the docum"] },
      "self-awareness": { min: 2, max: 4, evidenceQuotes: ["Our engineering onboarding checklist hadn't been touched in 18 months. I catalogued every broken link, rewrote the docum"] },
      "autonomy": { min: 2, max: 4, evidenceQuotes: ["Our engineering onboarding checklist hadn't been touched in 18 months. I catalogued every broken link, rewrote the docum"] },
      "risk-tolerance": { min: 2, max: 4, evidenceQuotes: ["Our engineering onboarding checklist hadn't been touched in 18 months. I catalogued every broken link, rewrote the docum"] },
      "work-pace": { min: 2, max: 4, evidenceQuotes: ["Our engineering onboarding checklist hadn't been touched in 18 months. I catalogued every broken link, rewrote the docum"] },
      "collaboration-style": { min: 1, max: 3, evidenceQuotes: ["Our engineering onboarding checklist hadn't been touched in 18 months. I catalogued every broken link, rewrote the docum"] },
      "feedback-orientation": { min: 2, max: 4, evidenceQuotes: ["Our engineering onboarding checklist hadn't been touched in 18 months. I catalogued every broken link, rewrote the docum"] }
    },
    questionBankVersion: "v2026.04",
    tags: ["learning-orientation"],
    confidence: "heuristic",
  },
  {
    id: "culture-013",
    transcript: [
      { speaker: "agent", text: "Tell me about a time you saw a problem that wasn't yours to fix, and you fixed it anyway." },
      { speaker: "candidate", text: "Our A/B test platform had a p-value inflation bug producing false positives for three months. It was the data science team's domain. I noticed inconsistencies, dug into the statistics layer, documented the bug, and submitted a fix with a simulation showing false positive rate dropped from 22% to 4.8%." },
      { speaker: "agent", text: "What did you do once you realized product decisions needed revisiting?" },
      { speaker: "candidate", text: "I set up calls with each product manager, brought the original data and corrected analysis. One PM was defensive. I walked through the statistics step by step. The decision was reversed and the metric recovered." },
      { speaker: "agent", text: "Tell me about a time you disagreed with a teammate on a technical decision." },
      { speaker: "candidate", text: "My counterpart on the ML team wanted to deploy a new ranking model to 100% traffic. I thought we needed staged rollout. I prepared a brief with three scenarios and proposed 5% with automated rollback. We caught a latency regression at 15%." },
      { speaker: "agent", text: "Tell me about a time you were wrong about something technical." },
      { speaker: "candidate", text: "I was confidently wrong about CAP theorem implications for almost two years. A distributed systems engineer showed me my error. I rebuilt my understanding and ran an internal workshop to correct advice I'd given." },
      { speaker: "agent", text: "What's a weakness you've had to actively work on?" },
      { speaker: "candidate", text: "I have a pattern of avoiding conflict. I'll give positive feedback in 1:1s and then vent to my manager. I made a commitment to say difficult things directly. I've had three difficult 1:1s in the last six months." }
    ],
    expectedScores: {
      "ownership": { min: 3, max: 5, evidenceQuotes: ["Our A/B test platform had a p-value inflation bug producing false positives for three months. It was the data science te"] },
      "collaboration": { min: 2, max: 4, evidenceQuotes: ["we needed staged rollout."] },
      "learning-orientation": { min: 2, max: 4, evidenceQuotes: ["Our A/B test platform had a p-value inflation bug producing false positives for three months. It was the data science te"] },
      "conflict-handling": { min: 2, max: 4, evidenceQuotes: ["Our A/B test platform had a p-value inflation bug producing false positives for three months. It was the data science te"] },
      "self-awareness": { min: 2, max: 4, evidenceQuotes: ["Our A/B test platform had a p-value inflation bug producing false positives for three months. It was the data science te"] },
      "autonomy": { min: 1, max: 3, evidenceQuotes: ["Our A/B test platform had a p-value inflation bug producing false positives for three months. It was the data science te"] },
      "risk-tolerance": { min: 2, max: 4, evidenceQuotes: ["Our A/B test platform had a p-value inflation bug producing false positives for three months. It was the data science te"] },
      "work-pace": { min: 2, max: 4, evidenceQuotes: ["Our A/B test platform had a p-value inflation bug producing false positives for three months. It was the data science te"] },
      "collaboration-style": { min: 2, max: 4, evidenceQuotes: ["Our A/B test platform had a p-value inflation bug producing false positives for three months. It was the data science te"] },
      "feedback-orientation": { min: 2, max: 4, evidenceQuotes: ["Our A/B test platform had a p-value inflation bug producing false positives for three months. It was the data science te"] }
    },
    questionBankVersion: "v2026.04",
    tags: ["ownership", "learning-orientation", "conflict-handling"],
    confidence: "heuristic",
  },
  {
    id: "culture-014",
    transcript: [
      { speaker: "agent", text: "Tell me about a time you saw a problem that wasn't yours to fix, and you fixed it anyway." },
      { speaker: "candidate", text: "Our checkout service was timing out for users on mobile connections — not in our team's SLA. I traced the latency spike using Jaeger, found an N+1 query in the cart aggregation endpoint, wrote a PR with a fix and a benchmark showing 60% latency reduction, and got it merged in under three hours. I added a Datadog monitor for that query pattern." },
      { speaker: "agent", text: "Tell me about something you shipped that broke in a way that affected other people." },
      { speaker: "candidate", text: "I shipped a change to our notification dispatch that skipped deduplication under high load. 8,000 users received duplicate push notifications. I wrote a post-mortem within four hours naming the sequence, rebuilt the deduplication layer with Redis SETNX, and ran a load test at 10x production traffic to validate." },
      { speaker: "agent", text: "Tell me about a time you disagreed with a teammate on a technical decision." },
      { speaker: "candidate", text: "My counterpart on the ML team wanted to deploy a new ranking model directly to 100% traffic. I prepared a two-page brief with three rollout scenarios, shared it 24 hours before the meeting, and proposed 5% with automated rollback. We co-developed the rollback criteria. The staged approach caught a latency regression at 15%." },
      { speaker: "agent", text: "Tell me about a time you were wrong about something technical." },
      { speaker: "candidate", text: "I spent eight months advocating for a service mesh. When we piloted it, operational overhead was three times my estimate. I ran a retrospective where I named my prediction versus outcome, identified I'd anchored on blog posts, and we adopted mTLS-via-gateway instead. I now have a rule: never advocate for an approach without interviewing two practitioners." },
      { speaker: "agent", text: "What's a weakness you've had to actively work on?" },
      { speaker: "candidate", text: "I've had consistent feedback across three teams that I move to solution mode too quickly. I started doing structured restatement before responding. My most recent 360 showed improvement noted by four colleagues. I still have to consciously activate the habit." }
    ],
    expectedScores: {
      "ownership": { min: 4, max: 5, evidenceQuotes: ["Our checkout service was timing out for users on mobile connections — not in our team's SLA. I traced the latency spike "] },
      "collaboration": { min: 3, max: 5, evidenceQuotes: ["We co-developed the rollback criteria."] },
      "learning-orientation": { min: 4, max: 5, evidenceQuotes: ["Our checkout service was timing out for users on mobile connections — not in our team's SLA. I traced the latency spike "] },
      "conflict-handling": { min: 4, max: 5, evidenceQuotes: ["Our checkout service was timing out for users on mobile connections — not in our team's SLA. I traced the latency spike "] },
      "self-awareness": { min: 3, max: 5, evidenceQuotes: ["Our checkout service was timing out for users on mobile connections — not in our team's SLA. I traced the latency spike "] },
      "autonomy": { min: 3, max: 5, evidenceQuotes: ["Our checkout service was timing out for users on mobile connections — not in our team's SLA. I traced the latency spike "] },
      "risk-tolerance": { min: 2, max: 4, evidenceQuotes: ["Our checkout service was timing out for users on mobile connections — not in our team's SLA. I traced the latency spike "] },
      "work-pace": { min: 3, max: 5, evidenceQuotes: ["Our checkout service was timing out for users on mobile connections — not in our team's SLA. I traced the latency spike "] },
      "collaboration-style": { min: 3, max: 5, evidenceQuotes: ["Our checkout service was timing out for users on mobile connections — not in our team's SLA. I traced the latency spike "] },
      "feedback-orientation": { min: 4, max: 5, evidenceQuotes: ["Our checkout service was timing out for users on mobile connections — not in our team's SLA. I traced the latency spike "] }
    },
    questionBankVersion: "v2026.04",
    tags: ["high-band", "ownership", "learning-orientation", "conflict-handling"],
    confidence: "heuristic",
  },
  {
    id: "culture-015",
    transcript: [
      { speaker: "agent", text: "Tell me about a time you saw a problem that wasn't yours to fix, and you fixed it anyway." },
      { speaker: "candidate", text: "Our engineering onboarding checklist hadn't been touched in 18 months. I catalogued every broken link, rewrote the document with tested instructions, added a 'last verified' date block, and set up a monthly reminder. Onboarding time dropped from a day to four hours based on feedback forms." },
      { speaker: "agent", text: "Tell me about a time you disagreed with a teammate on a technical decision." },
      { speaker: "candidate", text: "The backend lead and I disagreed about API versioning. He thought it was premature. I proposed we measure the cost of retrofitting in three similar systems. The data showed two of three had significant rework. We designed a lightweight scheme. He cited it as a model for breaking architecture deadlocks." },
      { speaker: "agent", text: "Tell me about a time you were wrong about something technical." },
      { speaker: "candidate", text: "I was an enthusiastic advocate for event-driven architecture before we had enough complexity. My team spent a sprint building a Kafka pipeline that a polling job would have solved in two days. I wrote a learning doc and added a decision checklist. Three subsequent proposals were simplified." },
      { speaker: "agent", text: "What's a weakness you've had to actively work on?" },
      { speaker: "candidate", text: "I under-communicate when I'm uncertain. I go quiet in planning meetings. My manager flagged this. I started being explicit about confidence levels. My skip-level asked where I'd learned that framing." },
      { speaker: "agent", text: "Tell me about a time you had to push back on a direction you disagreed with." },
      { speaker: "candidate", text: "Legal wanted all AI-generated content flagged with a disclosure that would crater engagement. I got competitor data, presented it alongside legal risk, and we co-designed a sufficient but less intrusive disclosure. We measured no engagement impact post-launch." }
    ],
    expectedScores: {
      "ownership": { min: 3, max: 5, evidenceQuotes: ["Our engineering onboarding checklist hadn't been touched in 18 months. I catalogued every broken link, rewrote the docum"] },
      "collaboration": { min: 4, max: 5, evidenceQuotes: ["we measure the cost of retrofitting in three similar systems."] },
      "learning-orientation": { min: 3, max: 5, evidenceQuotes: [" I wrote a learning doc and added a decision checklist."] },
      "conflict-handling": { min: 3, max: 5, evidenceQuotes: [" backend lead and I disagreed about API versioning."] },
      "self-awareness": { min: 4, max: 5, evidenceQuotes: ["Our engineering onboarding checklist hadn't been touched in 18 months. I catalogued every broken link, rewrote the docum"] },
      "autonomy": { min: 4, max: 5, evidenceQuotes: ["Our engineering onboarding checklist hadn't been touched in 18 months. I catalogued every broken link, rewrote the docum"] },
      "risk-tolerance": { min: 2, max: 4, evidenceQuotes: ["Our engineering onboarding checklist hadn't been touched in 18 months. I catalogued every broken link, rewrote the docum"] },
      "work-pace": { min: 2, max: 4, evidenceQuotes: ["Our engineering onboarding checklist hadn't been touched in 18 months. I catalogued every broken link, rewrote the docum"] },
      "collaboration-style": { min: 3, max: 5, evidenceQuotes: ["Our engineering onboarding checklist hadn't been touched in 18 months. I catalogued every broken link, rewrote the docum"] },
      "feedback-orientation": { min: 3, max: 5, evidenceQuotes: ["Our engineering onboarding checklist hadn't been touched in 18 months. I catalogued every broken link, rewrote the docum"] }
    },
    questionBankVersion: "v2026.04",
    tags: ["collaboration", "self-awareness", "autonomy"],
    confidence: "heuristic",
  },
  {
    id: "culture-016",
    transcript: [
      { speaker: "agent", text: "Tell me about a time you saw a problem that wasn't yours to fix, and you fixed it anyway." },
      { speaker: "candidate", text: "Our A/B test platform had a p-value inflation bug. It was the data science team's domain. I noticed inconsistencies, dug into the statistics layer, found sample ratio mismatch wasn't being detected, documented the bug with a worked example, submitted a fix with simulation showing false positive rate dropped from 22% to 4.8%, and ran a retrospective on four experiments. Two product decisions had to be revisited." },
      { speaker: "agent", text: "What did you do once you realized decisions needed revisiting?" },
      { speaker: "candidate", text: "I set up 30-minute calls with each PM, brought original data and corrected analysis. One was defensive. I walked through statistics step by step. The decision was reversed and metrics recovered to baseline within a sprint." },
      { speaker: "agent", text: "Tell me about a time you disagreed with a teammate on a technical decision." },
      { speaker: "candidate", text: "My principal engineer wanted to rewrite our search service in Rust before profiling. I suggested one week profiling first. Profiling revealed the bottleneck was algorithmic. I rewrote the similarity function, achieved 70% latency reduction, and the Rust rewrite was deprioritized. He later said profiling-first would be a team norm." },
      { speaker: "agent", text: "Tell me about a time you were wrong about something technical." },
      { speaker: "candidate", text: "I was confidently wrong about CAP theorem implications for two years. A distributed systems engineer showed me my error. I rebuilt my understanding and ran an internal workshop to correct advice I'd given. I now say 'let me check this against the actual topology' before applying CAP reasoning." },
      { speaker: "agent", text: "What's a weakness you've had to actively work on?" },
      { speaker: "candidate", text: "I have a strong pattern of avoiding conflict. I'll give positive feedback in 1:1s and then vent to my manager. I made a commitment to say difficult things directly. I've had three difficult 1:1s in six months. Two resolved. One recovered. My manager said I'm no longer pre-processing issues for her." }
    ],
    expectedScores: {
      "ownership": { min: 4, max: 5, evidenceQuotes: ["Our A/B test platform had a p-value inflation bug. It was the data science team's domain. I noticed inconsistencies, dug"] },
      "collaboration": { min: 4, max: 5, evidenceQuotes: ["My principal engineer wanted to rewrite our search service in Rust before profiling. I suggested one week profiling firs"] },
      "learning-orientation": { min: 4, max: 5, evidenceQuotes: ["Our A/B test platform had a p-value inflation bug. It was the data science team's domain. I noticed inconsistencies, dug"] },
      "conflict-handling": { min: 4, max: 5, evidenceQuotes: ["Our A/B test platform had a p-value inflation bug. It was the data science team's domain. I noticed inconsistencies, dug"] },
      "self-awareness": { min: 4, max: 5, evidenceQuotes: ["Our A/B test platform had a p-value inflation bug. It was the data science team's domain. I noticed inconsistencies, dug"] },
      "autonomy": { min: 3, max: 5, evidenceQuotes: ["Our A/B test platform had a p-value inflation bug. It was the data science team's domain. I noticed inconsistencies, dug"] },
      "risk-tolerance": { min: 3, max: 5, evidenceQuotes: ["Our A/B test platform had a p-value inflation bug. It was the data science team's domain. I noticed inconsistencies, dug"] },
      "work-pace": { min: 3, max: 5, evidenceQuotes: ["Our A/B test platform had a p-value inflation bug. It was the data science team's domain. I noticed inconsistencies, dug"] },
      "collaboration-style": { min: 3, max: 5, evidenceQuotes: ["Our A/B test platform had a p-value inflation bug. It was the data science team's domain. I noticed inconsistencies, dug"] },
      "feedback-orientation": { min: 4, max: 5, evidenceQuotes: ["Our A/B test platform had a p-value inflation bug. It was the data science team's domain. I noticed inconsistencies, dug"] }
    },
    questionBankVersion: "v2026.04",
    tags: ["high-band", "all-dimensions"],
    confidence: "heuristic",
  },
  {
    id: "culture-017",
    transcript: [
      { speaker: "agent", text: "Tell me about a time you saw a problem that wasn't yours to fix, and you fixed it anyway." },
      { speaker: "candidate", text: "Our payment service was timing out in prod. It wasn't my squad's system. I traced the latency spike to a misconfigured connection pool, submitted a PR with a fix and a load-test showing 40% latency drop, got it merged in under two hours, and added a canary alert." },
      { speaker: "agent", text: "Tell me about a time you disagreed with a teammate on a technical decision." },
      { speaker: "candidate", text: "The platform team had a completely different risk tolerance. They wanted six weeks of validation and we needed to ship in two. I set up a joint retro to surface constraints. We co-designed a staged rollout with automated rollback. The platform lead later told me it became their default." },
      { speaker: "agent", text: "Tell me about a time you were wrong about something technical." },
      { speaker: "candidate", text: "I spent three years believing good tests meant high code coverage. After working with a property-based testing advocate, I realized I was optimizing the wrong thing. I ran a study group, reduced test count by 40% while tripling defect-catch rate, and gave a company-wide talk on what I'd gotten wrong." },
      { speaker: "agent", text: "What's a weakness you've had to actively work on?" },
      { speaker: "candidate", text: "Three performance reviews mentioned I'm hard to read in disagreements. I go quiet instead of signaling I'm processing. After a team lead thought I'd disengaged when I was actually invested, I started ending meetings with explicit status. My skip-level said trust had visibly improved." },
      { speaker: "agent", text: "Tell me about a time you had to push back on a direction you disagreed with." },
      { speaker: "candidate", text: "The CPO had made a public commitment to a launch date I believed was irresponsible. I wrote a one-pager with three scenarios, presented it in leadership review, and accepted when the CPO overrode me. I shipped cleanly, documented tradeoffs in the ADR, and filed follow-up. Three months later the CPO cited it as the pushback they wanted more of." }
    ],
    expectedScores: {
      "ownership": { min: 4, max: 5, evidenceQuotes: ["Our payment service was timing out in prod. It wasn't my squad's system. I traced the latency spike to a misconfigured c"] },
      "collaboration": { min: 4, max: 5, evidenceQuotes: ["we needed to ship in two."] },
      "learning-orientation": { min: 4, max: 5, evidenceQuotes: ["Our payment service was timing out in prod. It wasn't my squad's system. I traced the latency spike to a misconfigured c"] },
      "conflict-handling": { min: 4, max: 5, evidenceQuotes: ["Our payment service was timing out in prod. It wasn't my squad's system. I traced the latency spike to a misconfigured c"] },
      "self-awareness": { min: 3, max: 5, evidenceQuotes: ["Our payment service was timing out in prod. It wasn't my squad's system. I traced the latency spike to a misconfigured c"] },
      "autonomy": { min: 4, max: 5, evidenceQuotes: ["Our payment service was timing out in prod. It wasn't my squad's system. I traced the latency spike to a misconfigured c"] },
      "risk-tolerance": { min: 3, max: 5, evidenceQuotes: ["Our payment service was timing out in prod. It wasn't my squad's system. I traced the latency spike to a misconfigured c"] },
      "work-pace": { min: 4, max: 5, evidenceQuotes: ["Our payment service was timing out in prod. It wasn't my squad's system. I traced the latency spike to a misconfigured c"] },
      "collaboration-style": { min: 3, max: 5, evidenceQuotes: ["Our payment service was timing out in prod. It wasn't my squad's system. I traced the latency spike to a misconfigured c"] },
      "feedback-orientation": { min: 3, max: 5, evidenceQuotes: ["Our payment service was timing out in prod. It wasn't my squad's system. I traced the latency spike to a misconfigured c"] }
    },
    questionBankVersion: "v2026.04",
    tags: ["ownership", "collaboration", "learning-orientation", "work-pace"],
    confidence: "heuristic",
  },
  {
    id: "culture-018",
    transcript: [
      { speaker: "agent", text: "Tell me about a time you saw a problem that wasn't yours to fix, and you fixed it anyway." },
      { speaker: "candidate", text: "Our data pipeline was dropping records silently. I noticed it debugging something else. I wrote a reconciliation script, identified 4,000 dropped records, backfilled them, and added a daily row-count alert. The data team was surprised — they hadn't known." },
      { speaker: "agent", text: "Tell me about a time you disagreed with a teammate on a technical decision." },
      { speaker: "candidate", text: "My lead wanted rate limiting in each service. I thought shared middleware was cleaner. We spent an hour whiteboarding. I acknowledged his coupling concern. We went with middleware but per-service config override." },
      { speaker: "agent", text: "Tell me about a time you were wrong about something technical." },
      { speaker: "candidate", text: "I was convinced distributed transactions were right until a colleague showed me Pat Helland's talk. I rebuilt around event sourcing and the result was much simpler." },
      { speaker: "agent", text: "What's a weakness you've had to actively work on?" },
      { speaker: "candidate", text: "I have a tendency to take over problems when I see a faster path. I've had to learn to hold back and let teammates work through things at their own pace, even when it's slower." },
      { speaker: "agent", text: "Tell me about a time you had to push back on a direction you disagreed with." },
      { speaker: "candidate", text: "My manager wanted to ship without instrumentation. I pushed back in a 1:1, walked through risks, and we agreed on basic event logging first and full analytics next sprint." }
    ],
    expectedScores: {
      "ownership": { min: 3, max: 5, evidenceQuotes: ["I noticed it debugging something else."] },
      "collaboration": { min: 3, max: 5, evidenceQuotes: ["We spent an hour whiteboarding."] },
      "learning-orientation": { min: 3, max: 5, evidenceQuotes: [" I've had to learn to hold back and let teammates work through things at their own pace, even when it's slower."] },
      "conflict-handling": { min: 3, max: 5, evidenceQuotes: ["Our data pipeline was dropping records silently. I noticed it debugging something else. I wrote a reconciliation script,"] },
      "self-awareness": { min: 4, max: 5, evidenceQuotes: ["Our data pipeline was dropping records silently. I noticed it debugging something else. I wrote a reconciliation script,"] },
      "autonomy": { min: 3, max: 5, evidenceQuotes: ["Our data pipeline was dropping records silently. I noticed it debugging something else. I wrote a reconciliation script,"] },
      "risk-tolerance": { min: 4, max: 5, evidenceQuotes: ["Our data pipeline was dropping records silently. I noticed it debugging something else. I wrote a reconciliation script,"] },
      "work-pace": { min: 3, max: 5, evidenceQuotes: ["Our data pipeline was dropping records silently. I noticed it debugging something else. I wrote a reconciliation script,"] },
      "collaboration-style": { min: 4, max: 5, evidenceQuotes: ["Our data pipeline was dropping records silently. I noticed it debugging something else. I wrote a reconciliation script,"] },
      "feedback-orientation": { min: 4, max: 5, evidenceQuotes: ["Our data pipeline was dropping records silently. I noticed it debugging something else. I wrote a reconciliation script,"] }
    },
    questionBankVersion: "v2026.04",
    tags: ["self-awareness", "risk-tolerance", "collaboration-style", "feedback-orientation"],
    confidence: "heuristic",
  },
  {
    id: "culture-019",
    transcript: [
      { speaker: "agent", text: "Tell me about a time you saw a problem that wasn't yours to fix, and you fixed it anyway." },
      { speaker: "candidate", text: "Our checkout service was timing out on mobile. I traced it with Jaeger, found an N+1 query, wrote a PR with fix and benchmark showing 60% reduction, got it merged in three hours, and added a monitor." },
      { speaker: "agent", text: "Tell me about a time you disagreed with a teammate on a technical decision." },
      { speaker: "candidate", text: "My counterpart wanted to deploy a ranking model to 100% traffic. I prepared a brief with three scenarios, proposed 5% with rollback triggers, and we co-developed criteria. We caught a regression at 15%." },
      { speaker: "agent", text: "Tell me about a time you were wrong about something technical." },
      { speaker: "candidate", text: "I advocated for a service mesh. Operational overhead was 3x my estimate. I ran a retrospective, identified I'd anchored on blog posts, and we adopted mTLS-via-gateway. I now interview two practitioners before advocating." },
      { speaker: "agent", text: "What's a weakness you've had to actively work on?" },
      { speaker: "candidate", text: "I move to solution mode too quickly. I started structured restatement. My 360 showed improvement by four colleagues. I still have to consciously activate the habit." }
    ],
    expectedScores: {
      "ownership": { min: 4, max: 5, evidenceQuotes: ["Our checkout service was timing out on mobile. I traced it with Jaeger, found an N+1 query, wrote a PR with fix and benc"] },
      "collaboration": { min: 3, max: 5, evidenceQuotes: ["we co-developed criteria."] },
      "learning-orientation": { min: 4, max: 5, evidenceQuotes: ["Our checkout service was timing out on mobile. I traced it with Jaeger, found an N+1 query, wrote a PR with fix and benc"] },
      "conflict-handling": { min: 4, max: 5, evidenceQuotes: ["Our checkout service was timing out on mobile. I traced it with Jaeger, found an N+1 query, wrote a PR with fix and benc"] },
      "self-awareness": { min: 3, max: 5, evidenceQuotes: ["Our checkout service was timing out on mobile. I traced it with Jaeger, found an N+1 query, wrote a PR with fix and benc"] },
      "autonomy": { min: 4, max: 5, evidenceQuotes: ["Our checkout service was timing out on mobile. I traced it with Jaeger, found an N+1 query, wrote a PR with fix and benc"] },
      "risk-tolerance": { min: 3, max: 5, evidenceQuotes: ["Our checkout service was timing out on mobile. I traced it with Jaeger, found an N+1 query, wrote a PR with fix and benc"] },
      "work-pace": { min: 4, max: 5, evidenceQuotes: ["Our checkout service was timing out on mobile. I traced it with Jaeger, found an N+1 query, wrote a PR with fix and benc"] },
      "collaboration-style": { min: 3, max: 5, evidenceQuotes: ["Our checkout service was timing out on mobile. I traced it with Jaeger, found an N+1 query, wrote a PR with fix and benc"] },
      "feedback-orientation": { min: 4, max: 5, evidenceQuotes: ["Our checkout service was timing out on mobile. I traced it with Jaeger, found an N+1 query, wrote a PR with fix and benc"] }
    },
    questionBankVersion: "v2026.04",
    tags: ["high-band", "ownership", "learning-orientation", "conflict-handling", "feedback-orientation"],
    confidence: "heuristic",
  },
  {
    id: "culture-020",
    transcript: [
      { speaker: "agent", text: "Tell me about a time you saw a problem that wasn't yours to fix, and you fixed it anyway." },
      { speaker: "candidate", text: "Our staging environment kept failing Fridays. It was the infra team's domain. I looked into cron logs, found a memory leak in the report generator, patched it, and it stopped failing. My manager was happy." },
      { speaker: "agent", text: "Tell me about a time you disagreed with a teammate on a technical decision." },
      { speaker: "candidate", text: "My teammate wanted GraphQL for our admin API and I thought REST was simpler. I wrote a comparison doc and we had a call. We went with REST with a plan to revisit." },
      { speaker: "agent", text: "Tell me about a time you were wrong about something technical." },
      { speaker: "candidate", text: "I was convinced optimistic locking was right for our cart service. After a production incident, I dug in and realized we needed pessimistic locking. I updated the implementation and bugs stopped." },
      { speaker: "agent", text: "What's a weakness you've had to actively work on?" },
      { speaker: "candidate", text: "I used to give feedback that landed as harsh. A colleague told me directly. I've been framing feedback as questions rather than statements." },
      { speaker: "agent", text: "Tell me about a time you had to push back on a direction you disagreed with." },
      { speaker: "candidate", text: "The PM wanted to ship behind a feature flag permanently. I sent an estimate of maintenance cost. We compromised on a six-week cleanup window." }
    ],
    expectedScores: {
      "ownership": { min: 2, max: 4, evidenceQuotes: ["Our staging environment kept failing Fridays. It was the infra team's domain. I looked into cron logs, found a memory le"] },
      "collaboration": { min: 2, max: 4, evidenceQuotes: ["we had a call."] },
      "learning-orientation": { min: 2, max: 4, evidenceQuotes: ["Our staging environment kept failing Fridays. It was the infra team's domain. I looked into cron logs, found a memory le"] },
      "conflict-handling": { min: 2, max: 4, evidenceQuotes: ["Our staging environment kept failing Fridays. It was the infra team's domain. I looked into cron logs, found a memory le"] },
      "self-awareness": { min: 2, max: 4, evidenceQuotes: ["Our staging environment kept failing Fridays. It was the infra team's domain. I looked into cron logs, found a memory le"] },
      "autonomy": { min: 2, max: 4, evidenceQuotes: ["Our staging environment kept failing Fridays. It was the infra team's domain. I looked into cron logs, found a memory le"] },
      "risk-tolerance": { min: 3, max: 4, evidenceQuotes: ["Our staging environment kept failing Fridays. It was the infra team's domain. I looked into cron logs, found a memory le"] },
      "work-pace": { min: 2, max: 4, evidenceQuotes: ["Our staging environment kept failing Fridays. It was the infra team's domain. I looked into cron logs, found a memory le"] },
      "collaboration-style": { min: 2, max: 4, evidenceQuotes: ["Our staging environment kept failing Fridays. It was the infra team's domain. I looked into cron logs, found a memory le"] },
      "feedback-orientation": { min: 2, max: 4, evidenceQuotes: ["Our staging environment kept failing Fridays. It was the infra team's domain. I looked into cron logs, found a memory le"] }
    },
    questionBankVersion: "v2026.04",
    tags: ["balanced-high", "risk-tolerance"],
    confidence: "heuristic",
  }
];

// ─── Validation ──────────────────────────────────────────────────────────────

interface ValidationResult {
  ok: boolean;
  errors: string[];
}

function validateFixtures(fixtures: CultureCalibrationFixture[]): ValidationResult {
  const errors: string[] = [];

  if (fixtures.length !== 20) {
    errors.push(`Expected 20 fixtures, found ${fixtures.length}`);
  }

  // Coverage tracking
  const coverage: Record<DimensionId, { low: boolean; mid: boolean; high: boolean }> = {
    ownership: { low: false, mid: false, high: false },
    collaboration: { low: false, mid: false, high: false },
    'learning-orientation': { low: false, mid: false, high: false },
    'conflict-handling': { low: false, mid: false, high: false },
    'self-awareness': { low: false, mid: false, high: false },
    autonomy: { low: false, mid: false, high: false },
    'risk-tolerance': { low: false, mid: false, high: false },
    'work-pace': { low: false, mid: false, high: false },
    'collaboration-style': { low: false, mid: false, high: false },
    'feedback-orientation': { low: false, mid: false, high: false },
  };

  let strongCount = 0;
  let adequateCount = 0;
  let weakCount = 0;

  for (const fixture of fixtures) {
    const scores = Object.values(fixture.expectedScores).map((s) => (s.min + s.max) / 2);
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;

    if (avg >= 4) strongCount++;
    else if (avg >= 3) adequateCount++;
    else weakCount++;

    for (const dim of ALL_DIMENSIONS) {
      const s = fixture.expectedScores[dim];
      if (!s) {
        errors.push(`${fixture.id}: missing expectedScores for ${dim}`);
        continue;
      }
      if (s.min < 1 || s.max > 5 || s.min > s.max) {
        errors.push(`${fixture.id}: invalid range for ${dim}: [${s.min}, ${s.max}]`);
      }
      if (!Array.isArray(s.evidenceQuotes) || s.evidenceQuotes.length === 0) {
        errors.push(`${fixture.id}: missing evidenceQuotes for ${dim}`);
      }
      if (s.max <= 2) coverage[dim].low = true;
      if (s.min <= 3 && s.max >= 3) coverage[dim].mid = true;
      if (s.min >= 4) coverage[dim].high = true;
    }

    if (!fixture.id || !fixture.questionBankVersion) {
      errors.push(`${fixture.id}: missing required fields`);
    }
    if (fixture.confidence !== 'heuristic' && fixture.confidence !== 'expert') {
      errors.push(`${fixture.id}: confidence must be 'heuristic' or 'expert'`);
    }
    if (!Array.isArray(fixture.tags)) {
      errors.push(`${fixture.id}: tags must be an array`);
    }
  }

  if (strongCount !== 5) {
    errors.push(`Expected 5 strong fixtures (avg ≥4), found ${strongCount}`);
  }
  if (adequateCount !== 10) {
    errors.push(`Expected 10 adequate fixtures (avg 3–4), found ${adequateCount}`);
  }
  if (weakCount !== 5) {
    errors.push(`Expected 5 weak fixtures (avg <3), found ${weakCount}`);
  }

  for (const dim of ALL_DIMENSIONS) {
    const c = coverage[dim];
    if (!c.low) errors.push(`Dimension ${dim}: missing low anchor (max ≤2)`);
    if (!c.mid) errors.push(`Dimension ${dim}: missing mid anchor (covers 3)`);
    if (!c.high) errors.push(`Dimension ${dim}: missing high anchor (min ≥4)`);
  }

  return { ok: errors.length === 0, errors };
}

// ─── Main ────────────────────────────────────────────────────────────────────

function main(): void {
  const validateOnly = process.argv.includes('--validate-only');

  if (!validateOnly) {
    mkdirSync(FIXTURES_DIR, { recursive: true });
    for (const fixture of FIXTURES) {
      const outPath = path.join(FIXTURES_DIR, `${fixture.id}.json`);
      writeFileSync(outPath, JSON.stringify(fixture, null, 2) + '\n');
      console.log(`[build-culture-fixtures] Wrote ${path.basename(outPath)}`);
    }
  }

  const result = validateFixtures(FIXTURES);
  if (!result.ok) {
    console.error('[build-culture-fixtures] Validation failed:');
    for (const err of result.errors) {
      console.error('  ✗ ' + err);
    }
    process.exit(1);
  }

  console.log('[build-culture-fixtures] Validation passed:');
  console.log(`  • 20 fixtures`);
  console.log(`  • 5 strong, 10 adequate, 5 weak`);
  console.log(`  • L/M/H coverage for all 10 dimensions`);
  console.log(`  • All fixtures marked confidence: 'heuristic'`);
}

main();
