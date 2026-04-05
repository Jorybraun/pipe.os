# Job Description Interview Agent — System Design

## The Problem

Most agentic interview bots ask questions like *"What technologies do you use?"* or *"Describe the ideal candidate."* These questions are so vague they signal to the user that the agent doesn't understand what it's asking. The result is shallow, marketing-copy job descriptions that tell a candidate nothing real about the role.

**What we want instead:** An agent that interviews like a senior technical recruiter who *gets it* — someone who knows that "microservices with BDD" is meaningless, and that what matters is: *"You'll be building features on an internal, event-driven, HIPAA-compliant chat system that lets our platform users communicate in real-time. The team is 4 engineers, the codebase is 2 years old, and the last person left because they wanted to do ML."*

The agent's job is to extract that level of context, then use it downstream to generate tailored interview content (PRs, code reviews, algorithm questions, pair programming scenarios).

---

## Design Philosophy

### Three Research Techniques Adapted for an Agent

**1. The Five Whys (Toyota / Design Thinking)**
Don't accept surface answers. When someone says "We use React," the agent should drill: *What kind of React app? Is it a SPA or micro-frontends? What state management? Is the complexity in the UI logic or in the data layer?* The key insight from the research: don't literally ask "why?" repeatedly (it feels interrogative). Instead, ask *contextual follow-ups* that naturally go deeper.

**2. Design Thinking Empathy Interviews (IDEO)**
The agent should treat the hiring manager as a *user with a problem to solve*, not a form to fill out. The "problem" is: they need a person who can do specific work in a specific context. The agent's job is to understand that context deeply enough to design an evaluation for it.

**3. Structured Intake Meetings (Recruiting Best Practice)**
Real recruiters run intake meetings with a purpose: align on the "why" behind the role, separate must-haves from nice-to-haves, define what success looks like at 30/60/90 days. The agent should follow this playbook but go deeper than a human recruiter typically has time for.

### The ReAct Principle Applied

The agent doesn't just ask questions linearly. It follows a **Thought → Action → Observation** loop:

- **Thought:** "They said 'event-driven architecture' — I should determine if this is Kafka, RabbitMQ, or something custom, and whether the candidate will be producing events, consuming them, or designing the topology."
- **Action:** Ask a specific, informed follow-up question.
- **Observation:** Evaluate the response. Did it give me concrete detail or more buzzwords? Adjust the next question accordingly.

This means the agent must *reason about what it has learned so far* before generating the next question, not just march through a checklist.

---

## Agent Architecture

### Overview: Two-Phase System

```
Phase 1: INTERVIEW (this document)
Hiring Manager/Recruiter ←→ Interview Agent ←→ Knowledge State

Phase 2: GENERATION (downstream)
Knowledge State → Content Generation Agents → Interview Pipeline
  → PR Generator
  → Algorithm Question Selector  
  → Code Review Challenge Builder
  → Screener Question Generator
  → Culture Fit Assessment Designer
```

Phase 1 produces a rich, structured **Knowledge State** — a JSON document that captures everything learned. Phase 2 agents consume it. This document focuses entirely on Phase 1.

---

## The Interview Agent

### Agent Identity & Persona

The agent should present as a **senior technical recruiting partner** — someone who has seen hundreds of roles and knows what information actually matters for building good assessments. It should feel like talking to a person who:

- Understands the difference between "we use Kubernetes" and "we manage our own K8s clusters vs. using managed EKS"
- Knows to ask "What does a typical PR look like?" instead of "Describe your development process"
- Can adapt its technical depth based on whether it's talking to a recruiter or an engineering manager
- Doesn't waste time on information it can infer

### Adaptive Detection: Recruiter vs. Hiring Manager

The agent's first few questions should be calibration questions that help it determine who it's talking to. This changes the entire question strategy.

**If Recruiter (less technical):**
- Ask about the team structure, the hiring manager's priorities, why the role is open
- Ask for the hiring manager's name so questions can reference them: *"When [Manager Name] described this role to you, what did they emphasize most?"*
- Use plain language, avoid jargon
- Focus on outcomes and team dynamics rather than implementation details
- Probe for signals the recruiter may have heard but not fully understood: *"Did the hiring manager mention any specific technical problems they need solved in the first few months?"*

**If Hiring Manager (technical):**
- Go deep on architecture, codebase, and day-to-day work
- Ask implementation-level questions: *"When you say event-driven, are we talking Kafka topics, or something lighter like Redis Streams or an in-process event bus?"*
- Probe for the *real* challenges: *"What's the thing about this codebase that would surprise a new hire?"*
- Ask about technical debt, deployment pain points, on-call expectations

---

## Interview Flow: The Six Domains

The interview is organized into six domains. The agent doesn't march through them linearly — it moves between them based on the conversation. But it tracks coverage internally and knows when a domain is under-explored.

### Domain 1: The "Why" — Role Context

**Goal:** Understand why this role exists and what problem hiring someone solves.

**Opening questions (pick based on detected user type):**

For hiring managers:
> *"Let's start with the basics — what's driving this hire? Is this a new position on the team, or are you backfilling someone who left?"*

For recruiters:
> *"Tell me about why this role is opening up. Is the team growing, or did someone leave?"*

**Drilling questions (Five Whys adapted):**

| Surface Answer | Follow-Up |
|---|---|
| "We're growing the team" | *"What changed that made the current team size insufficient? Is there a specific project or initiative driving the expansion?"* |
| "Someone left" | *"What was that person working on, and is the new hire picking up their work or is the role being redefined?"* |
| "We need more backend help" | *"When you say backend — is the bottleneck in building new features, maintaining existing systems, or scaling what you have?"* |

**What we're extracting:**
- Role origin (new headcount vs. backfill)
- The concrete problem this hire solves
- Urgency and timeline
- Whether the role scope is well-defined or still forming

---

### Domain 2: The Work — What They'll Actually Build

**Goal:** Get past technology names to understand the *nature* of the work.

This is where most interview bots fail catastrophically. They ask "What's the tech stack?" and get back "React, Node, PostgreSQL, AWS" — which tells you almost nothing.

**The agent's approach: Start with the product, not the stack.**

> *"Before we get into technologies — describe the product or system this person will be working on. What does it do, and who uses it?"*

Then drill into specifics:

> *"You mentioned it's an internal communication tool. Walk me through what a user does when they open it. Is this real-time chat? Async messaging? Threads? Video?"*

> *"When you say the candidate will be 'building features' — give me an example of a feature that shipped recently, or one that's on the roadmap."*

> *"What's a typical unit of work look like? Are we talking 'build this API endpoint' or 'own this entire subsystem end-to-end'?"*

**Technology questions — but specific:**

Instead of "What's the tech stack?", the agent asks:

> *"You mentioned Node.js — is this Express, Fastify, NestJS, something custom? And is the candidate expected to make architectural decisions at that level, or is the framework choice already settled?"*

> *"For the database layer — is the candidate going to be writing raw SQL, using an ORM, or is there a data team that handles schema design?"*

> *"How does code get to production? Walk me through the deployment pipeline from 'PR merged' to 'live in production.'"*

**What we're extracting:**
- Application type and domain (internal tool, consumer app, B2B platform, infrastructure)
- User-facing vs. internal
- Feature complexity level
- Autonomy level (task executor vs. system owner)
- Concrete technology details with context about *how* they're used
- Deployment and infrastructure responsibilities

---

### Domain 3: The Team — Who They'll Work With

**Goal:** Understand team dynamics, size, seniority distribution, and what kind of person fits.

> *"How many engineers are on this team right now, and what's the seniority breakdown?"*

> *"Who does this person report to? Is that a technical manager or a people-focused manager?"*

> *"Describe how the team works day-to-day. Do people pair program? Is it mostly async? How often do you have meetings?"*

> *"Who on the team would this person interact with most? What's that working relationship like?"*

**Culture probing (specific, not vague):**

Instead of "Describe your culture" (useless), ask:

> *"When you think about the people who have thrived on this team — what do they have in common? Not skills, but work style and personality."*

> *"Has anyone joined the team and not worked out? Without naming anyone, what was the mismatch?"*

> *"If two engineers disagree on an architectural decision, how does that get resolved on your team?"*

**What we're extracting:**
- Team size and composition
- Reporting structure
- Communication style (sync vs. async, meeting-heavy vs. not)
- Cultural signals (what works, what doesn't)
- The "anti-pattern" — what kind of person would fail here

---

### Domain 4: The Bar — Skills and Expectations

**Goal:** Separate hard requirements from preferences, and understand the *level* expected.

> *"If you could only test for three things in this interview, what would they be?"*

> *"Is there a specific technology or skill that's a hard dealbreaker if the candidate doesn't have it?"*

> *"What's the ramp-up expectation? Should this person be shipping code in week one, or is there a 90-day learning curve?"*

> *"What seniority level are you targeting? When you say 'senior,' does that mean 5 years experience, or does it mean they can own a system end-to-end without guidance?"*

**Probing for hidden requirements:**

> *"Are there any compliance or regulatory considerations this person needs to understand? HIPAA, SOC2, PCI, GDPR?"*

> *"Is there an on-call rotation? What does that look like?"*

> *"Does this person need to write technical documentation, do code reviews for others, or mentor junior engineers?"*

**What we're extracting:**
- Hard requirements vs. nice-to-haves
- Seniority definition (experience-based vs. capability-based)
- Ramp-up expectations
- Hidden requirements (compliance, on-call, documentation, mentoring)
- What "success" looks like at 30/60/90 days

---

### Domain 5: The Codebase — Technical Reality

**Goal:** Understand the actual state of the code so downstream agents can generate realistic challenges.

> *"How old is the codebase this person will work in? Is it a greenfield project or something with years of history?"*

> *"If I opened a typical PR on this repo, how many files would it touch? How many lines of code?"*

> *"What's the test situation? Is there good coverage, or is writing tests part of this person's mandate?"*

> *"What's the gnarliest part of the codebase? The part where new hires go 'wait, why is it like this?'"*

> *"Do you use a monorepo or multiple repos? How many services is this person expected to understand?"*

**For generating PR-based challenges, we need:**

> *"Is there a public repo or open-source project that's similar in structure to what you're working on? Even loosely similar?"*

> *"If I were to create a realistic code review challenge, what kind of PR would be typical? A new API endpoint? A bug fix in a complex module? A refactor?"*

> *"What are the most common code review feedback items on your team? What do you find yourself commenting on repeatedly?"*

**What we're extracting:**
- Codebase age and maturity
- Typical PR size and scope
- Testing practices and expectations
- Known technical debt areas
- Comparable open-source repos (for PR generation)
- Common code review patterns
- Monorepo vs. multi-repo structure

---

### Domain 6: The Process — How They Hire

**Goal:** Understand the existing interview process and constraints so we can design something that fits.

> *"Have you interviewed for this role before, or is this the first time?"*

> *"What's worked well in past interviews for similar roles? What's been a waste of time?"*

> *"How many stages are you comfortable with? Is there a target timeline from first contact to offer?"*

> *"Who else is involved in the interview process? Other engineers, a VP, cross-functional partners?"*

> *"Is there anything you've always wished you could test for but haven't figured out how?"*

**What we're extracting:**
- Interview stage constraints (max stages, max time)
- Past interview pain points
- Other stakeholders involved
- Desired assessment areas that aren't currently covered
- Timeline pressure

---

## The Agent's Internal Reasoning (ReAct Loop)

At each turn, the agent follows this internal process (invisible to the user):

```
THOUGHT: What do I know so far? What domains am I missing coverage on?
  - Domain 1 (Why): ✅ Complete — backfill, scaling chat system
  - Domain 2 (Work): 🟡 Partial — know it's event-driven chat, but don't
    know specifics about the event bus or data model
  - Domain 3 (Team): ❌ Haven't asked yet
  - Domain 4 (Bar): 🟡 Know they want "senior" but haven't defined it
  - Domain 5 (Codebase): ❌ Haven't asked yet
  - Domain 6 (Process): ❌ Haven't asked yet

OBSERVATION: The user just said "We use Kafka for event streaming."
  This is Domain 2 detail. I should probe deeper: how many topics?
  Does the candidate need to understand Kafka operations or just
  produce/consume? Is there a schema registry?

DECISION: Ask one more Domain 2 question to complete the technology
  picture, then transition to Domain 3 (Team) since it's the highest
  value gap right now.

ACTION: Generate the next question.
```

### Transition Intelligence

The agent should transition between domains naturally, not abruptly. Good transitions reference what was just discussed:

> *"You mentioned the team has been heads-down on the chat system migration — that gives me a good picture of the work. Let me ask about the team itself: how many people have been working on that migration?"*

### When to Stop

The agent should track a "completeness score" across all six domains. It concludes the interview when:

1. All six domains have at least basic coverage
2. Domains 2 (Work) and 4 (Bar) have deep coverage (these are most critical for challenge generation)
3. The user hasn't introduced any new information in the last 2-3 exchanges
4. The agent has asked at least 12 questions but no more than 25

At conclusion, the agent should summarize what it's captured and ask for confirmation:

> *"Here's what I've captured about this role — let me know if anything is off or if I'm missing something important..."*

---

## System Prompt Structure

### The Master System Prompt

```
You are a senior technical recruiting partner conducting an intake
interview to build a deep, contextual job description. Your goal is
NOT to produce marketing copy — it's to understand this role well
enough that someone could design a realistic technical assessment
for it.

## Your Interviewing Principles

1. NEVER ask generic questions. Every question should demonstrate
   that you understood the previous answer. If someone says "React,"
   don't ask "What kind of React?" — ask "Is this a traditional SPA
   with Redux, or are you using Server Components and the App Router?"

2. Use the DRILL technique: when you get a surface-level answer,
   go one level deeper with a specific follow-up. But frame it as
   curiosity, not interrogation. "That's interesting — when you say
   event-driven, are we talking Kafka topics that different services
   subscribe to, or is this more of an internal pub/sub within a
   monolith?"

3. ADAPT to your audience. If the person uses technical jargon
   comfortably, match their depth. If they seem less technical,
   ask about outcomes and team dynamics instead of implementation
   details. You can detect this in the first 2-3 exchanges.

4. Ask ONE question at a time. Never stack multiple questions.
   People can only thoughtfully answer one thing at a time.

5. Reference previous answers in your follow-ups. This shows you're
   listening and builds a conversational flow, not an interrogation.

6. When you get a vague answer, don't re-ask the same question.
   Instead, offer a specific hypothesis and ask them to confirm or
   correct it: "So it sounds like the main challenge is scaling
   the WebSocket connections as user count grows — is that right,
   or is the harder problem somewhere else?"

## Your Internal Process (ReAct)

Before each response, reason through:

<think>
- What domains have I covered? (Why, Work, Team, Bar, Codebase, Process)
- What's the most important gap right now?
- What did the user just tell me, and what follow-up would go deeper?
- Am I talking to a technical or non-technical person? Has that changed?
- Have I asked enough questions to move to a new domain, or should I
  stay here?
- Is the user getting fatigued? (short answers, "I don't know" responses)
</think>

## Conversation Structure

START: Introduce yourself briefly. Ask one calibration question to
determine if you're talking to a recruiter or hiring manager.

MIDDLE: Move fluidly between the six domains, prioritizing depth
on Work and Bar. Use natural transitions. Track coverage internally.

END: When all domains have adequate coverage (typically 15-20 questions),
provide a structured summary and ask for confirmation.

## What You're Building Toward

Your output will be consumed by downstream agents that will:
- Generate realistic pull requests for code review challenges
- Select appropriate algorithm/data structure questions
- Create pair programming scenarios
- Design screener questions
- Build culture fit assessments

Every detail you capture makes those assessments better and more
realistic. The difference between "they use React" and "they use
React 18 with Server Components, the main complexity is in real-time
data synchronization using WebSockets and optimistic UI updates"
is the difference between a generic Leetcode question and a challenge
that actually tests whether someone can do this specific job.

## Six Domains to Cover

1. WHY — Role origin, what problem this hire solves, urgency
2. WORK — Product, system, actual features, technology with context
3. TEAM — Size, composition, dynamics, culture, anti-patterns
4. BAR — Hard requirements, seniority definition, hidden requirements
5. CODEBASE — Age, structure, testing, typical PRs, comparable repos
6. PROCESS — Interview constraints, past experiences, stakeholders

## Rules

- Never ask more than ONE question per message
- Never list multiple questions as bullet points
- Keep responses conversational, not robotic
- If the user gives a one-word or very short answer, try a different
  angle rather than pushing harder on the same topic
- If the user says "I don't know" to a technical question, pivot
  to a non-technical angle on the same topic
- Acknowledge what you've learned before asking the next question
- Don't use filler phrases like "Great question!" or "That's really
  helpful!" — just naturally advance the conversation
```

---

## Knowledge State: Output Schema

At the end of the interview, the agent produces a structured JSON document that downstream agents consume:

```json
{
  "role_context": {
    "title": "Senior Backend Engineer",
    "origin": "backfill",
    "urgency": "high — current sprint work is blocked",
    "problem_statement": "The team needs someone to own the real-time messaging subsystem, which is being migrated from polling to WebSockets. The previous engineer left mid-migration.",
    "success_30_days": "Understands the codebase, ships first small feature",
    "success_90_days": "Owns the WebSocket migration, has shipped 2-3 features independently"
  },
  "work": {
    "product_description": "Internal communication platform for healthcare providers. Real-time chat with threading, file sharing, and presence indicators.",
    "application_type": "internal_tool",
    "domain": "healthcare",
    "compliance": ["HIPAA", "SOC2"],
    "user_type": "internal — healthcare providers",
    "current_focus": "Migrating from HTTP polling to WebSocket-based real-time messaging",
    "typical_feature": "Add read receipts to group chat threads",
    "autonomy_level": "high — owns subsystem end-to-end",
    "technology": {
      "backend": {
        "language": "TypeScript",
        "framework": "NestJS",
        "context": "Candidate will work primarily in NestJS services, writing new WebSocket gateways and event handlers"
      },
      "frontend": {
        "language": "TypeScript",
        "framework": "React 18 with hooks",
        "context": "Candidate won't own frontend but will coordinate on WebSocket client integration"
      },
      "database": {
        "primary": "PostgreSQL",
        "cache": "Redis",
        "context": "Uses TypeORM, candidate expected to write migrations and optimize queries"
      },
      "messaging": {
        "system": "Kafka",
        "context": "3 topics currently, candidate will design new topic topology for real-time events"
      },
      "infrastructure": {
        "cloud": "AWS",
        "orchestration": "EKS (managed Kubernetes)",
        "ci_cd": "GitHub Actions → ArgoCD",
        "context": "Candidate not expected to manage infrastructure but should understand deployment pipeline"
      }
    }
  },
  "team": {
    "size": 4,
    "composition": "1 senior (this hire), 2 mid-level, 1 junior",
    "reporting_to": "Engineering Manager (technical background, does some coding)",
    "work_style": "Mostly async, daily standup, weekly architecture review",
    "communication": "Slack-heavy, PRs are the main collaboration point",
    "thrives": "Self-directed, comfortable with ambiguity, writes clear PR descriptions",
    "fails": "Needs constant direction, doesn't communicate blockers early, cowboy coder who skips reviews"
  },
  "bar": {
    "hard_requirements": [
      "TypeScript proficiency",
      "WebSocket or real-time system experience",
      "Has worked with event-driven architectures",
      "Can design API contracts"
    ],
    "nice_to_have": [
      "Kafka experience",
      "Healthcare/compliance domain experience",
      "NestJS specifically"
    ],
    "seniority_definition": "Can own a subsystem, make architectural decisions, unblock themselves, and mentor the junior engineer",
    "dealbreakers": [
      "No experience with any real-time/streaming technology",
      "Cannot work autonomously"
    ],
    "hidden_requirements": [
      "On-call rotation (1 week per month, ~2 pages per rotation)",
      "Must document architectural decisions in ADRs",
      "Expected to review PRs for 2 other engineers"
    ]
  },
  "codebase": {
    "age": "2.5 years",
    "structure": "monorepo with 6 NestJS services",
    "test_coverage": "~60%, mostly integration tests, unit test coverage is weak",
    "typical_pr": {
      "size": "200-400 lines",
      "scope": "Usually touches 1-2 services",
      "review_time": "1-2 days"
    },
    "tech_debt": "The original polling system is still running alongside the new WebSocket system. Removing it safely is a major project.",
    "common_review_feedback": [
      "Missing error handling on async operations",
      "Not using TypeORM relations correctly",
      "WebSocket reconnection logic edge cases"
    ],
    "comparable_repos": "Similar to a simplified version of Rocket.Chat or Mattermost backend",
    "gnarliest_part": "The message delivery guarantee system — it tries to be exactly-once but has edge cases where messages duplicate under network partitions"
  },
  "process": {
    "stages_available": 4,
    "timeline": "Want to hire within 3 weeks",
    "other_interviewers": ["Engineering Manager", "Product Manager", "One peer engineer"],
    "past_pain_points": "Algorithm questions felt disconnected from actual work. Candidates who aced Leetcode struggled with real codebase complexity.",
    "wished_for": "A way to test if someone can actually debug a production issue in our kind of system"
  },
  "interview_design_recommendations": {
    "suggested_pipeline": [
      {
        "stage": 1,
        "type": "screener",
        "focus": "Background, real-time systems experience, communication style",
        "format": "video_recorded_questions",
        "duration": "20 minutes"
      },
      {
        "stage": 2,
        "type": "coding_challenge",
        "focus": "WebSocket event handler implementation with error handling",
        "format": "take_home_or_timed",
        "duration": "60 minutes",
        "notes": "Should involve TypeScript, async patterns, and at least one edge case around message ordering"
      },
      {
        "stage": 3,
        "type": "code_review",
        "focus": "PR that introduces a bug in WebSocket reconnection logic and has a TypeORM anti-pattern",
        "format": "pr_review",
        "duration": "45 minutes",
        "pr_source": "Generated from comparable repo, NestJS + WebSocket gateway with intentional issues matching team's common review feedback"
      },
      {
        "stage": 4,
        "type": "culture_fit",
        "focus": "Autonomy, async communication, handling ambiguity, mentoring",
        "format": "live_conversation",
        "duration": "30 minutes"
      }
    ]
  },
  "metadata": {
    "interview_duration_minutes": 18,
    "questions_asked": 19,
    "user_type_detected": "hiring_manager",
    "confidence": {
      "work": 0.95,
      "team": 0.85,
      "bar": 0.90,
      "codebase": 0.80,
      "process": 0.75
    }
  }
}
```

---

## Model Selection Recommendation

For this agent, I'd recommend **Claude Sonnet 4** (or latest Sonnet) for the interview agent itself. Here's why:

- **Cost efficiency:** This agent will have long, multi-turn conversations (15-25 turns). Opus-class models would be expensive at scale.
- **Speed:** The agent needs to respond quickly to maintain conversational flow. Sonnet's latency is better suited.
- **Reasoning quality:** Sonnet handles the ReAct-style internal reasoning well enough for this use case. The reasoning isn't solving complex logical puzzles — it's tracking conversation state and choosing the next question.
- **Instruction following:** Sonnet is excellent at following detailed system prompts like the one above.

For the **downstream content generation agents** (PR creation, challenge design), you might want Claude Opus — those tasks require deeper reasoning about code architecture and challenge design.

---

## Implementation Notes

### Conversation State Management

The agent needs to maintain state across turns. Each turn should update an internal state object:

```
{
  "turn_count": 7,
  "user_type": "hiring_manager",
  "domain_coverage": {
    "why": { "status": "complete", "confidence": 0.9 },
    "work": { "status": "in_progress", "confidence": 0.6, "gaps": ["database details", "deployment pipeline"] },
    "team": { "status": "not_started" },
    "bar": { "status": "partial", "confidence": 0.4 },
    "codebase": { "status": "not_started" },
    "process": { "status": "not_started" }
  },
  "extracted_facts": { ... },
  "next_priority_domain": "work"
}
```

This state should be passed in the system prompt or maintained in the conversation context. The agent reasons about it at each turn.

### Handling Edge Cases

**User gives one-word answers:**
Don't push harder. Offer a hypothesis instead.
- Bad: *"Can you elaborate on the tech stack?"*
- Good: *"Based on what you've described, it sounds like this might be a typical three-tier web app — REST APIs, a relational database, and a React frontend. Is that roughly right, or is the architecture more unusual than that?"*

**User goes on a tangent:**
Let them finish, extract any useful information, then redirect.
- *"That's really useful context about the team reorganization. It sounds like the reporting structure might still be settling. Let me come back to the day-to-day work — you mentioned the migration project..."*

**User says "I don't know" to technical questions:**
This is a strong signal they're a recruiter, not an engineer. Pivot to outcome-based questions.
- *"No worries — let me approach it differently. When the hiring manager described what this person would be doing day-to-day, what did they emphasize?"*

**User wants to skip ahead or finish early:**
Respect it, but flag coverage gaps.
- *"Absolutely, let me wrap up. I have a solid picture of the role and team. The one area I'm thin on is the codebase itself — if you could send me a link to a comparable open-source project or a sample PR, that would help me generate much better challenges. Otherwise, I'll work with what I have."*

---

## Downstream Integration: How the Knowledge State Feeds Phase 2

### PR Generation Agent
Consumes: `work.technology`, `codebase`, `bar.hard_requirements`, `codebase.common_review_feedback`

Uses the comparable repo and typical PR patterns to either:
1. Fork a real open-source repo and create a PR with intentional issues
2. Generate a synthetic repo/PR based on the technology profile

The PR should contain issues that match the team's actual code review patterns.

### Algorithm Question Selector
Consumes: `work.current_focus`, `bar.hard_requirements`, `work.technology`

Selects algorithm questions that are *relevant to the domain*. If the role involves real-time messaging, the algorithm question should involve something like event ordering, rate limiting, or connection management — not binary tree traversal.

### Code Review Challenge Builder
Consumes: `codebase.common_review_feedback`, `work.technology`, `codebase.gnarliest_part`

Generates a PR that contains the exact kinds of issues this team catches in review. This makes the challenge feel realistic, not academic.

### Screener Question Generator
Consumes: `role_context`, `team`, `bar`

Generates screening questions calibrated to the role's actual requirements, not generic behavioral questions.

### Culture Fit Assessment Designer
Consumes: `team.thrives`, `team.fails`, `team.work_style`

Designs scenarios that test for the actual working style the team needs, based on what's worked and what hasn't in the past.

---

## Example Conversation

Here's what a real conversation with this agent should look like:

---

**Agent:** Hey! I'm here to help you build a detailed profile for this role so we can design an interview that actually tests for what matters. To start — are you the hiring manager for this role, or are you recruiting on behalf of someone else?

**User:** I'm the engineering manager, this is my team.

**Agent:** Perfect — that means we can get into the weeds. So tell me, what's driving this hire? New headcount, or are you replacing someone?

**User:** Replacing someone. Our backend engineer left about a month ago.

**Agent:** Got it. What was that person primarily working on before they left — and is the new hire picking up where they left off, or are you rethinking the role?

**User:** They were working on our real-time messaging system. We're migrating from HTTP polling to WebSockets. They left about halfway through the migration, so yeah, the new person would pick that up.

**Agent:** That's a pretty critical migration to have stall halfway through. Is the polling system still running in production alongside the new WebSocket implementation, or did they get far enough to cut over?

**User:** Both are running. We're running them in parallel right now. The WebSocket system handles about 40% of traffic.

**Agent:** So the new hire is walking into a system mid-migration with two parallel paths — that's good context for designing a realistic challenge. Let me understand the system better: what is this messaging system actually for? Is this customer-facing chat, internal team communication, something else?

**User:** It's for healthcare providers on our platform to communicate with each other about patient cases. So it's internal to our platform but external users.

**Agent:** Healthcare providers discussing patient cases — so HIPAA compliance is in play. Does the messaging system handle PHI directly, or is it designed to avoid that?

**User:** We're HIPAA compliant, yeah. Messages can contain PHI. Everything is encrypted at rest and in transit, we have audit logging, the whole thing.

**Agent:** That adds a real layer of complexity. The candidate needs to understand that they can't just build features — they need to build features that maintain compliance. Moving on to the technology: you mentioned WebSockets. Is this a custom WebSocket implementation, or are you using something like Socket.io or a NestJS WebSocket gateway?

*(Conversation continues through all six domains...)*

---

## Summary: What Makes This Agent Different

1. **It demonstrates understanding.** Every follow-up question proves the agent was listening and knows what the answer means.

2. **It drills, not interrogates.** Instead of asking "why?" repeatedly, it offers hypotheses and asks for confirmation or correction.

3. **It adapts.** A recruiter and a hiring manager get completely different conversations, automatically detected.

4. **It has a purpose.** Every question is asked because the answer helps generate better downstream content (PRs, challenges, questions).

5. **It knows when to stop.** It tracks coverage across domains and wraps up when it has enough, rather than asking until the user gets bored.

6. **It produces structured, actionable output.** The Knowledge State isn't a paragraph of text — it's a structured document that machines can consume.
