# Role Discovery as Dual-Purpose Sales Intake — Research Brief

**Date:** 2026-04-11
**Slug:** `role-discovery-sales-intake`
**Plan:** `knowledge/outputs/.plans/role-discovery-sales-intake.md`
**Research files:** R1-sales (sales frameworks), R2-intake (recruiter playbooks), R3-evp (EVP extraction), R4-jtbd (design thinking + narrative)
**Target deliverable:** Prompt-level and turn-controller recommendations for the Role Discovery agent
**Status:** Draft — awaiting verifier and reviewer passes

---

## Executive Summary

PIPE's Role Discovery agent has a structural problem that no amount of prompt tuning will fix: it was designed to do one job (extract requirements) but the business needs it to do two (extract requirements and extract sales ammunition). The current system prompt uses IDEO empathy principles, Five Whys, and laddering — all listen-mode techniques — without any directive to surface what would make a candidate want this role. The result is a vague, goal-light interview that produces a flat `CandidatePersona` with `mustHaveSkills: ["Kafka"]` and a sanitized job description that actively hides friction. Neither artifact serves the recruiter who needs to pitch the role to a passive candidate, and the requirements artifact is shallow because the agent never forces prioritization, challenges unrealistic expectations, or quantifies the cost of not filling the role.

The research across four dimensions — consultative sales frameworks (SPIN, MEDDIC, Challenger, Sandler, Gap Selling), professional recruiter intake playbooks (retained executive search, contingency tech, in-house TA), Employer Value Proposition extraction, and design thinking / JTBD methodology — converges on a single structural recommendation: the agent must operate in dual mode on every turn. Every question the agent asks should extract both a discovery signal (who the hiring manager wants) and a sales signal (why a candidate would want this role). This is not two separate conversations — it is one conversation with two extraction targets per turn.

The research identifies three root causes for the current vagueness:

First, the agent does not probe contradictions. When a hiring manager says "we value work-life balance" and later mentions "we need someone who ships on weekends," the agent accepts both without challenge. The empathy-map research (Says/Thinks/Does/Feels) shows that contradictions are where insight lives — the gap between what people say and what they actually do reveals the real culture, which is the thing the recruiter must pitch honestly.

Second, the agent does not demand stories. The artifact contains lists ("mustHaveSkills," "disposition," "redFlags") when it should contain narrative: a day-in-the-life scenario, a concrete anecdote about the last successful hire, a thick-description account of what happens in standup. Green & Brock's narrative-transportation research is unambiguous: stories are 22× more memorable than facts, and concrete sensory detail (the Grafana dashboard at 2am, the manager pacing behind the keyboard) creates the emotional absorption that makes a candidate say "I can see myself there." The checklist does not transport. The story does.

Third, the agent does not translate nouns into verbs. When the hiring manager says "Kafka," the agent writes down "Kafka" and moves on. But Kafka is a solution hypothesis, not a need. The need is the outcome: "minimize message loss during traffic spikes" or "maximize real-time event throughput for the growth team." Ulwick's outcome-statement format — direction + metric + object + context — disambiguates vague success criteria into testable statements that serve both the scorecard ("can this candidate do the verb?") and the sales pitch ("this role lets you do the verb").

The recommendation is to restructure the Role Discovery agent around five phases, integrate SPIN + MEDDIC + Sandler as the sales-discovery backbone, and add 16 turn-behavior rules grounded in JTBD, design thinking, and narrative-transportation research. The detailed specification follows.

---

## Part 1 — The Diagnosis: Why the Current Agent Is Vague

### 1.1 Five concrete sources of vagueness

The code audit (roleAgentPrompts.ts, roleAgent.ts, roleContexts.ts) identified five specific locations where vagueness enters the system:

**1. No extraction targets for tool results (roleAgentPrompts.ts:88–93).** The prompt tells the agent to use `research_company` and `search_technology` tools proactively, but provides no directive for what to do with the results. The agent researches the company but never weaves that research into a specific probe: "I see your company raised a Series B last quarter — how does this hire relate to the post-funding growth plan?" Without extraction targets, research becomes background noise.

**2. No penalty for missing critical topics (roleAgentPrompts.ts:134–146).** The prompt lists "information you MUST gather" — compensation, success metrics, day-in-the-life, dealbreakers, team shape, tools knowledge, who thrives/struggles — but provides no mechanism to enforce completeness. If the conversation veers into technical architecture for eight turns and never covers compensation, the agent can still produce a valid synthesis. The "MUST" has no teeth.

**3. Persona hides friction (roleAgentPrompts.ts:199–203).** The prompt draws a hard distinction between the persona (internal truth, can be critical) and the job description (neutral, professional tone). This means the JD actively sanitizes what the persona captures: "Escalation is broken" becomes "actively rebuilding its escalation process." The candidate never sees the friction that makes the role difficult — and per the Realistic Job Preview meta-analyses (Earnest et al. 2011, k=52, n≈17,000), honesty about friction builds trust and reduces 90-day turnover by 35%.

**4. Knowledge state not passed to agent (roleContexts.ts:508–519).** The agent call passes exchanges only, not the knowledge-state metadata from prior turns. The agent has no access to its own prior assessment of which exchanges were high-energy or which domains are underexplored. This forces the agent to re-derive context from raw text every turn, making it less purposeful than it would be with state.

**5. No dual-purpose directive in the opening (roleAgentPrompts.ts:295–302).** The first real question (after calibration) is purely context-setting. The agent is never told to extract the Employer Value Proposition during the interview. The "sell" angle is left entirely to post-hoc JD generation, which means the JD is a guess about what's compelling rather than a documented extract of what the hiring manager actually said was compelling.

### 1.2 What prior research already solved

The `role-discovery-data-contract` research brief (2026-04-10) solved the qualitative-methodology layer: how to structure the artifact for maximum fidelity. It prescribed:

- A per-stakeholder × per-domain matrix with laddering chains (attribute → consequence → value), sourced from Means-End Chain Theory, framework analysis, and IPA evidence-anchoring.
- Five team-culture signals (OCAI's four archetypes plus psychological safety).
- BARS anchor overrides with evidence sourced from the interview itself.
- Dealbreakers as auto-flag-then-HITL gates (never auto-reject).
- Multi-stakeholder disagreement preserved, not averaged (ρ = .34, 89% of rating variance is source-unique).

That research prescribed *what the artifact should look like*. This research prescribes *how the conversation should be conducted to populate that artifact with rich, dual-purpose content*.

---

## Part 2 — The Dual-Purpose Intake Model

### 2.1 Every question serves two masters

The central insight from integrating the four research dimensions is that requirements extraction and sales-ammunition extraction are not sequential activities (first learn what they want, then learn what they sell). They are the same activity viewed from two angles. A single probe — "Tell me about the last engineer who joined and was really successful — what did they do in their first 90 days?" — simultaneously extracts:

- **Discovery signal:** Success criteria, onboarding expectations, time-to-productivity, valued behaviors, team integration patterns.
- **Sales ammunition:** A concrete anecdote of a real person who thrived; the candidate can visualize themselves in that story; the story demonstrates the team is good at onboarding.

The EVP research (R3-evp) documents 20 such dual-purpose probes, each grounded in practitioner sources. The JTBD research (R4-jtbd) provides 16 turn-behavior rules that ensure every probe yields both signals. The sales-framework research (R1-sales) provides the question-sequencing logic (SPIN: Situation → Problem → Implication → Need-Payoff) that creates urgency and quantified business impact alongside requirements discovery.

### 2.2 The five Gartner EVP categories as a completeness checklist

Gartner's EVP taxonomy (five categories, 38 attributes) provides a structural checklist for the agent:

| Category | What it covers | Example dual-purpose probe |
|---|---|---|
| **Rewards** | Compensation, equity, bonus, benefits | "What's the approved comp range, and is there equity upside?" |
| **Opportunity** | Career growth, learning, mentorship, advancement | "What does growth look like here — give me an example of someone who grew significantly?" |
| **Work** | Autonomy, flexibility, meaningful tasks, challenge | "How much ownership will this person have over technical decisions?" |
| **People** | Team quality, leadership, collaboration, culture | "Who will they work with most closely — tell me about that person?" |
| **Organisation** | Mission, purpose, brand, stability, values | "Why does this work matter? When this team succeeds, who's better off?" |

The current agent covers some of these incidentally (through the six domains: Why/Work/Team/Bar/Codebase/Process), but it does not track EVP coverage as a separate dimension. The recommendation is to add EVP coverage tracking alongside domain coverage in the turn controller, so the agent can detect when it has deep requirements data (all six domains) but shallow sales data (only Rewards and Work touched, People and Organisation missing).

### 2.3 Sales frameworks as question-sequencing logic

The SPIN framework provides the most empirically grounded question-sequencing model (35,000 calls, 12-year Huthwaite study). Applied to the intake:

- **Situation questions** establish context: "How is your team structured? How is work distributed while this role is open?" Both discovery (team shape, current capacity) and sales (team overload = urgency).
- **Problem questions** surface stated pain: "What bottlenecks is the team experiencing?" Discovery (stated reason for hire) and sales (pain narrative).
- **Implication questions** quantify business impact and create urgency: "If this role stays open another 60 days, what projects get delayed? How does that affect your Q3 roadmap?" Discovery (urgency, priority) and sales (quantified cost of vacancy — the recruiter can now say "this role is worth $82K/month in lost productivity").
- **Need-Payoff questions** build value and surface the EVP: "If we find someone who can ship independently in 30 days, how would that change your planning?" Discovery (success metric) and sales (the offer is "ship independently in 30 days," which is the pull for candidates who want autonomy).

MEDDIC adds a qualification layer that prevents the agent from spending 20 turns on a role that has no approved headcount:

- **Economic Buyer:** "Who ultimately approves the headcount budget — is that you, or someone else?" If the answer is "my VP hasn't approved yet," the agent flags it.
- **Champion:** "Who internally is most invested in this hire succeeding?" Identifies the internal advocate.
- **Decision Process:** "Walk me through the interview and approval process — how many rounds, who has veto, what's the timeline?" Maps the process so the recruiter can tell candidates what to expect.
- **Decision Criteria:** "What are the non-negotiables?" Forces the must-have/nice-to-have distinction the current agent skips.

Sandler's Pain Funnel adds the emotional layer:

- **Surface:** "What challenges is this vacancy creating?" Stated pain.
- **Business:** "How does the delayed product launch affect your Q3 forecast?" Quantified impact.
- **Emotional:** "How does missing this milestone affect you personally — your standing with the board, your credibility with the team?" Personal stakes that create urgency.

### 2.4 Transparent friction as a sales lever

The Realistic Job Preview (RJP) meta-analysis literature is unambiguous: honesty about friction builds trust, does not reduce candidate interest (when properly framed), and reduces 90-day turnover by 35%.

- Earnest et al. (2011, k=52, n≈17,000): the primary mechanism by which RJPs reduce turnover is enhanced perceptions of organizational honesty, not lowered expectations.
- Phillips (1998): RJPs related to lower attrition, lower voluntary turnover, higher performance.
- 48% of employees leave because reality didn't match what they were told during hiring.

The implication: the agent must explicitly probe for friction ("What was harder than expected on the last big project?" "Why did the last person leave?" "What's one thing about this role that might surprise a candidate?") and the artifact must preserve friction alongside the positive narrative. The recruiter then positions friction as a trade-off, not a flaw: "Yes, there's on-call, but here's how the team handles it — $500/week bonus, remote flexibility, incidents average 1-2 per quarter. If you want to work on something that matters enough to run 24/7, this is the trade-off."

---

## Part 3 — The Turn Architecture

### 3.1 Five-phase conversation structure

Drawing from the canonical 60-minute recruiter intake timeline (composite across LinkedIn, Greenhouse, Metaview, and Lou Adler), adapted for a 20-turn LLM conversation:

| Phase | Turns | Goal | Key probes |
|---|---|---|---|
| **1. Contract & Context** | 1–3 | Set expectations, understand business context | "Why is this role open now?" MEDDIC Economic Buyer check. Sandler Up-Front Contract. |
| **2. Deep Discovery** | 4–10 | Surface requirements AND stories | SPIN Problem + Implication questions. JTBD four forces. Dual-purpose probes (success story, day-in-the-life, team dynamics). |
| **3. Prioritize & Challenge** | 11–14 | Force clarity, challenge assumptions | Must-have/nice-to-have prioritization. Challenger reframes if requirements misalign with market. Compensation alignment. |
| **4. EVP & Friction** | 15–17 | Extract sales ammunition and honest friction | "Why would a candidate take this over alternatives?" RJP friction probes. "What's the one story I should tell a candidate?" |
| **5. Qualify & Close** | 18–20 | Confirm process, produce artifact summary | MEDDIC Decision Process / Decision Criteria. Timeline. Recap + confirm. |

This replaces the current unstructured approach where the agent explores six domains without phasing. The phased structure ensures that discovery (Phase 2) happens before prioritization (Phase 3), which happens before EVP extraction (Phase 4). Today, the agent may spend 15 turns on discovery and never reach prioritization or EVP.

### 3.2 The 16 turn-behavior rules

These are specific, testable behavioral rules the agent must follow, grounded in the research. They replace the current prompt's loose directives ("follow energy," "ask about specific instances") with precise triggers and actions.

**Rule 1: Anchor every topic with a moment, not an abstraction.** When the hiring manager names a need, don't ask "why do you need that?" (abstract). Ask "when did you first realize you needed that? Walk me through what happened" (moment-anchored). Source: JTBD switch interview, cognitive interview technique.

**Rule 2: Probe all four forces for every major stated need.** Push (what's broken?), Pull (what becomes possible?), Anxiety (what worries you about changing?), Habit (what makes the current way feel safe?). Source: JTBD four forces diagram.

**Rule 3: Never accept a noun without probing for the adjacent verb.** "What do you use Kafka to do?" "Why Kafka instead of [alternative]?" The verb (the functional job) is the actual requirement; the noun is a solution hypothesis. Source: Ulwick ODI outcome statements.

**Rule 4: Translate vague success criteria into outcome statements.** "Fast onboarding" → "You want to minimize the weeks it takes for a new hire to ship independently, even when the codebase is undocumented?" Confirm or refine. Source: Ulwick ODI format.

**Rule 5: Contrast is mandatory for every choice.** "Why senior instead of mid-level?" "Why hire now instead of Q3?" "Why backfill instead of reorganize?" Contrast forces articulation of decision criteria. Source: JTBD contrast probing.

**Rule 6: Probe the Says/Thinks gap when you hear a virtue or value.** "You said you value work-life balance — what do you worry will happen if we hire someone who doesn't fit that?" The fear reveals what the value actually means. Source: IDEO empathy map.

**Rule 7: Ladder up with 'why' to find root cause; ladder down with 'how' for specificity.** "We need Kubernetes" → "Why?" → "Deploys are broken" → "Why?" → "No one understands the YAML" → Root cause is documentation/retention, not skill gap. Source: d.school How/Why laddering.

**Rule 8: Demand a day-in-the-life scenario before closing.** "Walk me through Tuesday for your ideal hire. 9am standup — what do they say? 2pm code review — what do they catch?" If the hiring manager can't describe a day, they have a wishlist, not a persona. Source: Cooper goal-directed design.

**Rule 9: Probe for sensory/concrete detail in every story.** When the hiring manager says "it was a disaster" or "she was amazing," probe: "What did you see? What did [person] say? Where were you? What time of day?" Concrete beats abstract for narrative transportation. Source: Green & Brock, JTBD environmental cuing.

**Rule 10: When you hear a process or practice, probe for thick description.** "We have daily standups" is thin. "What happens in standup? Who talks? Who's silent? When does it feel useful versus performative?" Thick description surfaces culture. Source: Madsbjerg sensemaking, Geertz.

**Rule 11: Defamiliarize the familiar to surface assumptions.** "If a new hire saw your team's Slack tomorrow, what would confuse them? What would they think is normal that actually isn't?" Source: Madsbjerg defamiliarization.

**Rule 12: Flip to demand-side: ask why a candidate would switch TO you.** After probing requirements (supply-side), flip: "Why would a great engineer leave their current job for this one? What's broken at other companies that you fix?" Forces the hiring manager to articulate the pull. Source: JTBD demand-side theory.

**Rule 13: Probe the passive → active transition to reveal urgency.** "When did you start thinking about hiring?" (passive). "What made you actually post the role?" (active). The trigger event reveals priority and budget unlock. Source: JTBD six-stage timeline.

**Rule 14: Use non-directed listening at the start; structured probes after.** Open with a germinal question: "Tell me about the problem that made you open this role." Let the hiring manager talk for 2-3 turns. Then probe gaps with structured questions. Source: Indi Young practical empathy.

**Rule 15: Identify the job executor (candidate) vs. stakeholder (hiring manager).** "What job is the new hire trying to do in their career?" vs. "What job are you hiring this role to do for the team?" The gap between them is the culture-fit risk. Source: Ulwick ODI, JTBD demand-side.

**Rule 16: Replace "Do you need X?" with "Tell me about the last time X was missing."** Leading questions ("Do you need leadership skills?") bias toward yes. Story-based questions surface unbiased reality. Source: d.school empathy interview best practices.

### 3.3 Forcing functions for completeness

The current agent has no mechanism to enforce that critical topics are covered. The recommendation is to add three forcing functions to the turn controller:

**1. Coverage gates.** The turn controller tracks domain coverage (existing) AND EVP coverage (new: Rewards/Opportunity/Work/People/Organisation) AND qualification coverage (new: Economic Buyer/Champion/Decision Process/Decision Criteria). When the turn budget reaches 70% (turn 14 of 20), if any EVP category has zero data, the agent switches to EVP probes. If any qualification element is missing, the agent switches to MEDDIC probes.

**2. Must-have prioritization checkpoint.** At turn 12-14, the agent pauses discovery and forces prioritization: "You've mentioned [N] requirements. If you could only keep 3-4 and had to compromise on the rest, which are non-negotiable?" This prevents purple-squirrel searches and surfaces true priorities.

**3. Friction probe requirement.** The agent must ask at least one explicit friction probe before synthesis. "What was harder than expected on the last big project?" or "What's one thing about this role that might surprise a candidate?" If no friction has been surfaced by turn 16, the agent asks. This is a non-negotiable based on the RJP evidence.

---

## Part 4 — The Sales-Ammunition Contract

### 4.1 What the recruiter needs to leave intake with

The EVP research (R3-evp) and the intake-playbook research (R2-intake) converge on five categories of sales ammunition that actually move candidates:

**1. Compensation transparency.** 47% of job seekers expect to learn salary before applying. The intake must surface: approved comp range, equity/bonus structure, and how it compares to market. The recruiter uses this in the first candidate outreach — not as a sell, but as a pre-qualifier that builds trust.

**2. Mission/customer-impact story.** "Why does this work matter? When this team succeeds, who's better off?" The answer must be concrete: "We build the payment system for gig workers who get paid weekly instead of monthly. When it works, a DoorDash driver can pay rent on time." Not "we make a difference."

**3. Growth trajectory anecdote.** 83% of employees see learning/development as vital. The intake must extract a concrete example: "Jenna joined as a mid-level engineer two years ago. She led the API redesign, presented at eng all-hands, moved into a tech lead role. She's now mentoring two juniors." That is the growth pitch.

**4. Autonomy and ownership example.** Autonomy increases intrinsic motivation by up to 32% for knowledge workers. The intake must extract a specific decision boundary: "They'll choose the A/B testing framework solo; they'll need product approval to deprecate a feature." Concrete, not abstract.

**5. Team dynamics anecdote.** "You'll pair with Marcus, our senior backend engineer. He's been here three years, knows the system inside out, loves mentoring, and will challenge every shortcut you propose." That is a pre-qualifier: candidates who hate being challenged will self-select out; candidates who want to level up will lean in.

**6. Transparent friction with framing.** "Yes, there's on-call one week per month, but we pay $500/week bonus, you can work remotely that week, and incidents average 1-2 per quarter. If you've been on-call at a startup with no process, this is an upgrade. If you've never done on-call and don't want to, let's not waste your time."

### 4.2 Additions to the Role Context Document schema

The current RCD schema (from the data-contract research) contains `domain_matrix`, `technical_context`, `team_culture_profile`, `bars_overrides`, `probe_bank_enrichment`, and `dealbreakers`. To support dual-purpose intake, add:

```json
{
  "sales_ammunition": {
    "evp_coverage": {
      "Rewards": "COVERED|PARTIAL|NONE",
      "Opportunity": "COVERED|PARTIAL|NONE",
      "Work": "COVERED|PARTIAL|NONE",
      "People": "COVERED|PARTIAL|NONE",
      "Organisation": "COVERED|PARTIAL|NONE"
    },
    "compensation_narrative": {
      "range_shared": true,
      "range_text": "$140-160K base + 0.15% equity vesting 4yr",
      "market_alignment": "AT_MARKET|BELOW|ABOVE",
      "source_turn": 14
    },
    "stories": [
      {
        "story_id": "s_001",
        "type": "SUCCESS_HIRE|TEAM_WIN|FRICTION_RJP|MISSION|GROWTH",
        "text": "When Sarah joined six months ago, she spent her first 30 days shadowing every step of the release process, then proposed a new CI/CD pipeline that cut deploy time by 40%. That's the kind of early impact this team rewards.",
        "protagonist": "Sarah",
        "stakes": "deploy process was slow and manual",
        "resolution": "40% faster deploys",
        "source_stakeholder": "HIRING_MANAGER",
        "source_turn": 8,
        "retellability_score": "HIGH|MEDIUM|LOW",
        "evp_categories_touched": ["Opportunity", "Work"]
      }
    ],
    "transparent_friction": [
      {
        "friction_id": "f_001",
        "raw_friction": "On-call one week per month; two 2am incidents last quarter",
        "framing": "On-call with $500/week bonus, remote flexibility, ~2 incidents/quarter. An upgrade from unstructured on-call at most startups.",
        "source_turn": 12
      }
    ],
    "demand_side_pitch": {
      "push_from_current": "Senior engineers at large companies feel stuck solving the same problem. Candidates leaving FAANG cite lack of ownership.",
      "pull_to_us": "End-to-end ownership of a system that serves 50K users. Direct access to CEO. Equity upside pre-Series B.",
      "anxiety_mitigators": "Team has 3 senior engineers — you won't be the only senior. Onboarding includes 30-day pairing.",
      "habit_breakers": "Equity cliff at current company vested; candidate is past 1-year mark."
    },
    "qualification": {
      "economic_buyer_identified": true,
      "economic_buyer_role": "VP Engineering",
      "champion_identified": true,
      "champion_role": "Hiring Manager",
      "decision_process": "3 rounds: phone screen, technical, culture. Final decision: HM + VP. Timeline: 2 weeks from first interview.",
      "headcount_approved": true,
      "budget_approved": true,
      "timeline_urgency": "HIGH — launch delayed until backfill"
    }
  }
}
```

This schema sits alongside the existing RCD, not inside it. The RCD's `domain_matrix` serves the scorecard (downstream assessment). The `sales_ammunition` block serves the recruiter's pitch (candidate outreach). Both are populated from the same conversation, by the same agent, through the same dual-purpose probes.

---

## Part 5 — Prompt-Level Recommendations

These are the specific additions and changes to the existing system prompt (`roleAgentPrompts.ts`) and turn controller (`roleAgent.ts`, `roleContexts.ts`) that the founder can hand to the implementer.

### 5.1 System prompt additions

**Add to the agent's identity/role section:**
> You are a strategic talent advisor conducting a dual-purpose intake conversation. Your goals are simultaneous, not sequential: (1) discover who this person needs (requirements), and (2) discover why a candidate would want this role (sales ammunition). Every question you ask should extract both a discovery signal and a sales signal. You are not an order-taker — you are a consultant who brings market insight, challenges unrealistic expectations, and surfaces the stories and friction that make an honest pitch possible.

**Add to the methodology section:**
> Use SPIN question sequencing: establish Situation, surface Problems, explore Implications (quantify business impact of the vacancy), and build Need-Payoff (what becomes possible when the role is filled). Layer in MEDDIC qualification: confirm Economic Buyer (who approves headcount?), identify Champion (who advocates internally?), map Decision Process (interview stages, veto power), and clarify Decision Criteria (non-negotiables vs. nice-to-haves). Use Sandler Pain Funnel to surface emotional stakes: what is the hiring manager personally worried about if this role stays open?

**Add to the "information you MUST gather" section:**
> In addition to the six domains, you must also gather:
> - At least one concrete success story (a real person who thrived in this or a similar role — name, what they did, how it went)
> - At least one transparent friction point (what is hard or surprising about this role, framed as a trade-off not a flaw)
> - The Employer Value Proposition across five categories (Rewards, Opportunity, Work, People, Organisation) — if you reach turn 14 without touching all five, prioritize the missing ones
> - Qualification data: headcount approval status, budget authority, decision process, timeline, must-have vs. nice-to-have distinction (forced — you must ask the hiring manager to rank their requirements)

**Add to the turn-behavior rules:**
> (Insert Rules 1-16 from Part 3.2 above as numbered directives in the system prompt.)

**Replace the persona/JD generation instruction:**
> Instead of generating a sanitized JD separate from a critical persona, generate a single Sales-Ready Role Brief that includes:
> - Role requirements (must-haves, nice-to-haves, outcome statements)
> - Success metrics (30/60/90-day milestones)
> - Sales ammunition (stories, EVP by category, friction-with-framing, demand-side pitch)
> - Qualification summary (Economic Buyer, Champion, Decision Process, timeline)
> - Day-in-the-life scenario (extracted from the conversation)
> The brief is the primary artifact. It replaces the flat CandidatePersona as the downstream input to challenge design, scoring, and candidate outreach.

### 5.2 Turn controller changes

**Pass knowledge state to the agent.** The agent call in `roleContexts.ts` currently passes only exchanges. Add the knowledge-state metadata (domain coverage, EVP coverage, qualification status) so the agent can see what it already knows and what it's missing.

**Add EVP coverage tracking.** Alongside the existing `domainCoverage` object (Why/Work/Team/Bar/Codebase/Process), add `evpCoverage` (Rewards/Opportunity/Work/People/Organisation) with the same levels (none/sparse/partial/covered/deep). Update the agent's reasoning step to include EVP gaps.

**Add qualification tracking.** Track four boolean/enum fields: `economicBuyerIdentified`, `championIdentified`, `decisionProcessMapped`, `mustHavesPrioritized`. When all four are true, qualification is complete.

**Add forcing-function logic.** At turn 70% (typically turn 14 of 20):
- If any EVP category is `none`, inject a meta-directive: "You have not covered [category] in your sales ammunition. Ask a question that surfaces [category] content."
- If `mustHavesPrioritized` is false, inject: "You have not forced must-have/nice-to-have prioritization. Do so now."
- If no friction has been surfaced, inject: "You have not asked a transparent-friction question. Ask one now."

**Add story tracking.** The agent's JSON response should include a `storiesExtracted` array with story objects (type, protagonist, stakes, resolution, source_turn). The turn controller checks this: if zero stories by turn 14, it signals the agent to extract one.

### 5.3 Synthesis changes

**Replace the flat CandidatePersona with the Sales-Ready Role Brief.** The current synthesis collapses the rich conversation into eight flat fields (seniority, archetype, mustHaveSkills[], niceToHaveSkills[], disposition[], careerSignal, redFlags[], dealbreakers[]). The new synthesis produces a structured brief with the schema from Part 4.2, preserving stories, friction, EVP, qualification, and demand-side pitch alongside the requirements.

**Preserve verbatim quotes.** Every story and friction point in the sales_ammunition block must include the source_turn and a verbatim or near-verbatim quote from the hiring manager. This is the IPA evidence-anchoring requirement from the data-contract research, extended to the sales layer.

---

## Part 6 — What the Evidence Shows About Expected Impact

The research provides several data points on the expected impact of these changes:

- Strong EVP reduces compensation premium needed to attract talent by 50% and reaches 50% deeper into passive candidate pools (Gartner).
- 42% of offer acceptance decisions are driven by EVP/company reputation, not pay/title (Korn Ferry 2024).
- Companies with strong employer brands see 43-50% reduction in cost-per-hire and 2× applicants per posting (LinkedIn Talent Solutions).
- RJPs reduce 90-day turnover by 35% on average (QIC-WD 2023), with some firms seeing 50% reduction.
- 48% of employees leave because reality didn't match what they were told (QIC-WD 2023) — the cost of hiding friction.
- Organizations using formalized sales methodology achieve 27% higher win rates and 21% higher quota attainment (Eagr 2026).
- SPIN Implication questions appear in 87% of won deals over $100K; top performers ask 4× more Implication questions (Huthwaite).
- When hiring managers aren't aligned on role requirements, organizations are 41% more likely to change requisitions mid-search, adding 38% to time-to-fill (Gartner).

These are not guarantees, but they suggest that a dual-purpose intake — one that produces both requirements and sales ammunition — should reduce time-to-fill (better candidate targeting), improve offer acceptance (stronger pitch), and reduce early turnover (honest friction framing).

---

## Part 7 — Expert vs. Junior: The Behavioral Bar

The intake-playbook research identified a clear behavioral distinction between expert and junior recruiters during intake. This distinction translates directly into LLM agent design: the agent must exhibit expert behaviors, not junior ones.

| Junior behavior | Expert behavior | Agent directive |
|---|---|---|
| Asks "How many years of experience?" | Asks "What do the best people do differently?" | Rule 16: story-based over credential-based |
| Accepts requirements as given | Challenges with market data | Challenger reframe when requirements → market mismatch |
| Treats everything as must-have | Forces 3-4 non-negotiables | Must-have prioritization checkpoint at turn 12-14 |
| Asks about the role in isolation | Probes organizational/team context | Rules 6, 10, 11: Says/Thinks gap, thick description, defamiliarization |
| Skips compensation | Brings market data, aligns budget | MEDDIC Economic Buyer + comp alignment in Phase 3 |
| Accepts "team player" at face value | Probes "what happens when someone isn't?" | Rule 6: Says/Thinks gap probing |
| Produces a list of skills | Produces outcome-based performance profile | Rule 4: outcome statements; Rule 8: day-in-the-life |
| Skips EVP entirely | Asks "why would a top person take this?" | Rule 12: demand-side flip; Phase 4 EVP probes |

The overall posture: the agent should feel like a strategic conversation with a smart recruiter who has done their homework, not like a form being filled out. It should challenge, reframe, probe for stories, and leave the hiring manager feeling like they discovered something they didn't know about their own role.

---

## Open Questions

1. **Market data access.** Several recommendations (Challenger reframes, compensation alignment, talent-pool sizing) assume the agent has access to salary benchmarks and market intelligence. The current agent has `research_company` and `search_technology` tools but no salary-data source. Should the agent surface market data from an external source, or should it rely on the hiring manager's self-reported comp data?

2. **Story quality measurement.** The sales_ammunition schema includes `retellability_score` for stories. How should the agent assess whether a story has enough concrete, sensory detail to be retellable? One option: check for the presence of a named protagonist, a specific time/place, a challenge, and a resolution. If any are missing, probe for more detail.

3. **Turn budget allocation.** The five-phase model allocates ~3/7/4/3/3 turns. In practice, some hiring managers will be terse and finish in 12 turns; others will need 25+. The turn controller should adapt: if Phase 2 (Deep Discovery) completes early, move up Phase 3 (Prioritize & Challenge). If it runs long, compress Phase 4 (EVP & Friction) but never skip it.

4. **Challenger reframe calibration.** The Challenger research shows it's most effective for new relationships and can backfire with established clients. For PIPE, the agent is always the "new" partner (first intake for a pipeline). But the Challenger move ("your comp expectations are below market") is risky in a text-based conversation where tone is hard to control. How aggressive should the agent be? One option: frame reframes as curiosity, not confrontation — "I notice the market for this role typically commands $X — how does your budget compare?" rather than "You're underpaying."

5. **Relationship to the existing RCD.** The data-contract research prescribed the RCD schema. This research prescribes a `sales_ammunition` block that sits alongside it. The question is where the boundary lies: should the `demand_side_pitch` and `stories` live in the RCD (as additional domain_matrix content), or in a separate `sales_ammunition` document? The recommendation is separate, because the RCD serves the scorecard (internal) and the sales_ammunition serves the pitch (external), and they have different consumers with different needs. But this is an architectural decision the founder should confirm.

6. **Multi-stakeholder EVP.** When multiple stakeholders are interviewed (per ADR-028), they may give conflicting EVP stories. The hiring manager says "great work-life balance"; the team member says "we work weekends during crunch." The data-contract research says preserve both (ρ = .34, source-unique variance is informative). For sales ammunition, which narrative do you tell the candidate? The recommendation: tell both, framed as honest range — "The hiring manager describes the team as balanced; the team member notes crunch weeks happen 2-3 times per year. Here's how they handle it." This is the RJP principle applied to multi-stakeholder data.
