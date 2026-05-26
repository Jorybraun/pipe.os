# Human Judgment in AI-Augmented Engineering: Assessment Framework

## Executive Summary

When AI handles execution, the human skill that matters is judgment — problem definition, evaluation of AI output, knowing when to intervene, and understanding why something works (not just that it works). This is empirically supported: experienced radiologists' accuracy fell from 82% to 45.5% with incorrect AI suggestions; developers using AI score 17% lower on comprehension quizzes; AI-generated code has 41% higher churn rates indicating lower initial quality. Expertise does not protect against automation bias.

The research converges on a concrete assessment architecture: a multi-station dev container session with planted bugs (providing ground truth), AI tools available but logged, multi-phase structure per station (solve with AI → explain → solve variant without AI), and behavioral telemetry capturing not just what candidates produce but how they interact with AI. This is grounded in decades of assessment design from medicine (OSCEs use 10-15 stations), aviation (check rides), and law (MPT), all of which have solved the "test judgment not execution" problem already. The key insight from those domains: reliable assessment requires 7-15 independent samples across varied contexts (not one big test). Pipe's target of 6-8 independent tasks per assessment is adapted from MMI's 7-12 station model. Scoring rubrics must reward reasoning process quality, not just correctness.

---

## 1. The Cognitive Science: Why Humans Fail at Supervising AI

### Automation bias is universal and expertise doesn't protect against it

Automation bias — over-relying on automated recommendations at the expense of independent judgment — occurs in 6-11% of cases where correct pre-advice decisions are reversed to incorrect ones. Erroneous AI advice is 26% more likely to be followed than control decisions.

Critical finding: **expertise does not protect.** When AI provided incorrect suggestions in chest X-ray diagnosis, physician accuracy dropped from 92.8% to 23.6%. Experienced mammography radiologists (>15 years) saw accuracy fall from 82% to 45.5% with incorrect AI. This is not a junior problem — it's a human cognition problem.

The mechanisms:
- **Attentional shift**: active information-seeking degrades to passive information-receiving under automation
- **Trust miscalibration**: higher but imperfect system reliability paradoxically increases complacency
- **Out-of-the-loop problem**: operators lose both situation awareness and manual skills simultaneously
- **Metacognitive failure**: AI users overestimate their own performance despite measurable degradation

### What actually reduces automation bias

Cognitive forcing strategies (checklists, mandatory pauses) showed **null results in RCTs** despite positive qualitative reception. What works:

1. **Exposure to failure cases during training** — significantly decreased complacency in process control operators
2. **Displaying confidence levels alongside AI advice** — improved appropriateness of reliance
3. **Supportive information rather than direct recommendations** — shows reasoning, not just answers
4. **Internal accountability** — pilots who internally perceived accountability verified automated cues; externally-imposed accountability did not help professionals
5. **Manual skill practice in mixed environments** — alternating between manual and automated work preserved skills

**Assessment design implication**: The challenge must include cases where the AI is confidently wrong. This is the single most diagnostic scenario — it reveals whether someone actually evaluates or just defers. Checklists won't help; only practice with real failure cases builds resistance.

---

## 2. Assessment Design: How Other Domains Test Judgment

### Medical OSCEs: Multi-station graduated scoring

OSCEs use 10-15 timed stations (6 minutes each) testing distinct competencies. The key innovation: rubrics use **graduated scoring** that rewards reasoning quality, not binary correct/incorrect. Standardized patients (trained actors) create consistent complexity while maintaining unpredictability that requires genuine reasoning.

Reliability requires **14+ independent questions across multiple stations**. A single scenario cannot reliably predict performance — judgment is context-specific.

**Design principle for Pipe**: Use 6-8 independent PR reviews or coding tasks across varied contexts, not one long assessment. Score the reasoning process (did they identify the right concerns, justify their decisions, update when challenged), not just the final output.

### Aviation check rides: Judgment under automation

FAA check rides separate technical proficiency from judgment/decision-making but evaluate both simultaneously in realistic scenarios. The Perceive → Process → Perform model provides structured assessment of aeronautical decision-making. Examiners are trained to evaluate when pilots correctly override automation.

**Design principle for Pipe**: Include scenarios that specifically test override judgment — cases where the AI suggests something plausible but wrong, and the candidate must decide whether to accept, reject, or modify.

### Bar exam MPT: Process over product

The Multistate Performance Test scores "organization, clarity, responsiveness to instructions, and legal reasoning rather than substantive legal knowledge." Candidates receive materials and produce work product, but scoring focuses on the quality of analytical reasoning, not arriving at a specific conclusion.

**Design principle for Pipe**: Score how the candidate approaches the problem (did they explore before prompting AI? did they verify the output? did they explain their reasoning?) not just whether the code passes tests.

### What software benchmarks get wrong

SWE-bench, HumanEval, CodeContests all evaluate **product correctness via pass/fail**. None assess:
- Ability to evaluate AI output
- Reasoning process quality
- Whether the candidate understands why their solution works
- Code review competency

SWE-bench has severe contamination issues (35-point performance gaps between verified and contamination-resistant sets). HumanEval problems are too simple and admit trivial solutions. CodeContests tests algorithmic puzzle-solving, not engineering judgment.

**The gap Pipe fills**: Performance-based assessment of engineering judgment with process scoring, not just output correctness. No existing benchmark does this.

---

## 3. Developer Behavior: What "Good" Actually Looks Like

### How senior engineers use AI differently

- **Acceptance rates**: Industry-wide Copilot acceptance is 27-30%. The healthy range is 25-35%. Below 25% suggests underuse; above 35% suggests insufficient evaluation.
- **Strategic vs. delegated use**: Senior engineers use AI for routine implementation while focusing their expertise on architecture and complex problem-solving. They begin by identifying boundaries (domain logic, data access, interfaces), not by prompting AI.
- **Post-acceptance modification**: Developers frequently accept AI suggestions then refactor — the "accept-then-edit" pattern is itself a signal. AI-generated code has **41% higher churn rate** than human-written code.
- **Knowledge retention**: The AI-assisted group scored **17% lower** on post-task knowledge quizzes. The largest gap was in debugging questions — AI use particularly impairs ability to recognize failures.

### The signals that distinguish seniors from over-reliant juniors

| Signal | Senior behavior | Over-reliant junior behavior |
|---|---|---|
| Code churn (2-week) | Lower — edits are intentional | Higher — accepts then fixes repeatedly |
| Refactoring ratio | Maintains DRY, refactors regularly | Copy-paste rises 48%, refactoring drops from 25% to <10% |
| Test-first patterns | Red-green-refactor-commit cycles (20-40/hr) | Code-first, tests after (or never) |
| AI prompt quality | Asks for explanations, provides context | Demands solutions, no follow-up |
| Verification behavior | Tests AI output systematically | Blindly accepts and moves on |
| Post-task comprehension | Can explain why the fix works | Cannot explain edge cases |

### Code review quality predictors

Useful code review comments share vocabulary with the changed code, contain relevant code elements, and come from reviewers experienced with the artifacts under review. Microsoft's study of 1.5M review comments found functional issues, missing validation checks, and API usage issues are most useful — not style/formatting comments.

---

## 4. What You Can Instrument in a Dev Container

### Day-one instrumentation (capturable now)

| Signal | How to capture | Predictive value |
|---|---|---|
| AI prompt text + response | Log AI API calls | High — prompt sophistication correlates with expertise |
| AI acceptance/rejection/edit | VS Code extension API | High — blind acceptance is the primary automation bias signal |
| Test execution frequency | Terminal command capture | High — test-before-commit predicts quality |
| Git commit patterns | Git hooks | Medium — TDD cycles, commit granularity |
| File navigation sequence | Editor events | Medium — exploration patterns before prompting |
| Code churn (edits after AI acceptance) | Diff analysis | High — 41% higher churn in AI code is the signal |

### Aspirational instrumentation (add later)

| Signal | Why it matters | Difficulty |
|---|---|---|
| Confidence-based AI routing | Candidate triggers help only when stuck | Requires custom AI interface |
| Time-on-task per phase | Reading vs. prompting vs. editing vs. testing ratios | Requires phase detection |
| Explanation quality scoring | Automated assessment of comprehension | Requires rubric + evaluator |
| Cross-session learning curves | Does candidate improve across multiple challenges | Requires repeat assessments |

### Performance overhead

LangSmith shows virtually no measurable overhead for telemetry. AgentOps and Langfuse show 12-15% overhead. OpenTelemetry is the emerging standard — use it from day one.

---

## 5. Agentic Workflow Comprehension: The Emerging Frontier

### Agent failure modes are structurally different from software bugs

Six core failure modes: context degradation, specification drift, sycophantic confirmation, tool call failures, cascading failure, and silent failure. The critical insight: **one early mistake cascades through subsequent decisions**, compounding into larger failures. Error propagation — not individual errors — is what kills agent reliability.

Debugging multi-agent systems takes **3-5× longer** than single-agent issues. Teams spend 40% of sprint time investigating agent failures.

### What "agent comprehension" looks like as a testable skill

- **Failure prediction**: Given a workflow description, can you identify where it will break?
- **Intervention timing**: An agent is running — when do you step in? Too early wastes the agent's value; too late wastes your time fixing cascaded errors.
- **Constraint design**: Can you specify the right guardrails for an agent without over-constraining it?
- **Trace reading**: Can you read an agent execution trace and identify where it went off track?

This is a new cognitive skill. No validated assessment framework exists. But the closest analogues (RLHF annotator quality, AI safety oversight research) suggest that **metacognitive monitoring** — the ability to evaluate whether a solution attempt is on track — is the core predictor.

### The RLHF annotator analogy

Good RLHF annotators are essentially doing what we want candidates to do: evaluating AI output and judging quality. The research shows:
- Not all human feedback is equal — annotator quality varies dramatically
- Developers who use AI strategically (asking follow-up questions, requesting explanations) retain significantly more knowledge than those who delegate
- Active engagement patterns predict evaluator quality, not just correctness of judgment

---

## 6. The Grading Paradox: How to Score Without AI Grading AI

The problem: if you use AI to grade AI-augmented work, you've built a circular system. The candidate's work was shaped by AI; the evaluation was shaped by AI; what did the human actually demonstrate?

### Solutions the research supports

**1. Planted bugs with test-based ground truth (primary method)**
SWE-bench methodology: plant a known bug with a test suite that fails without the fix and passes with it. Binary ground truth — either they found and fixed it or they didn't. No AI grading needed.

This is directly what your repo catalog is for. You have qualified repos with SWE-bench eligible PRs. The challenge flow becomes: revert a known fix, plant the failing test, candidate must restore functionality.

**2. Comprehension transfer test (no-AI variant)**
After the AI-augmented task, give a structurally similar problem without AI access. Research shows the AI-assisted group scored 17% lower on comprehension — this transfer test captures that gap. If they understood the first fix, they can do the variant. If they just delegated to AI, they can't.

**3. Explanation quality (human-rubric scored)**
Ask the candidate to explain what the bug was and why the fix works. Score with a BARS-style rubric. This is the OSCE model — graduated scoring on explanation quality, not binary correct/incorrect.

**4. Behavioral process scoring (telemetry-based)**
Score based on captured telemetry: Did they verify AI output? Did they run tests before committing? Did they explore the codebase before prompting? These are automation-bias-resistant behaviors that correlate with expertise.

**5. Hybrid calibration**
Use automated scoring (test passage, churn metrics) for the objective dimensions. Use human review for the subjective dimensions (explanation quality, prompt sophistication). Measure inter-rater kappa quarterly. This is exactly the model in STRATEGY.md (Devstral for live scoring, Sonnet as offline oracle).

---

## 7. The Candidate Session: What It Actually Looks Like

### 60-minute AI-augmented engineering assessment

**Pre-session (automated, 5 minutes before candidate joins)**
- Spin up isolated dev container (Docker/Fly.io Machine)
- Clone target repo from catalog, apply planted bug (revert known fix)
- Provision AI assistant (token-limited, all interactions logged)
- Initialize OpenTelemetry traces

**Phase 1 — Orientation & baseline (0-10 min)**
Candidate opens environment, reviews task brief: "This repository has a failing test suite. Identify the bug and fix it. You have access to an AI coding assistant — use it however you think is most effective."
Telemetry captures: navigation patterns, initial exploration before first AI prompt.

**Phase 2 — AI-augmented problem solving (10-40 min)**
Candidate works iteratively with AI assistant. The planted bug is designed so that naive AI prompting will produce a plausible but wrong fix (the AI-confidently-wrong scenario from automation bias research). The correct fix requires understanding the codebase context that the AI doesn't have.
Telemetry captures: prompt sophistication, acceptance/rejection patterns, test run frequency, code churn, verification behavior.

**Phase 3 — Comprehension check (40-50 min)**
Written explanation: "What was the bug? How did you use the AI assistant? What did the AI get wrong or miss?"
Followed by a variant problem (similar bug, different function) **without AI access**.
Assessment target: transfer learning, metacognitive awareness, independence.

**Phase 4 — Code review round (50-60 min)**
Candidate reviews an AI-generated PR in the same repo. Some suggestions are correct, some are subtly wrong. Candidate annotates which are valid and why.
Assessment target: evaluation judgment, the core AI literacy skill.

### Scoring dimensions (100 points)

| Dimension | Weight | What it measures | Scoring method |
|---|---|---|---|
| Task completion | 25 pts | Did they fix the bug? Tests pass? No regressions? | Automated (test suite) |
| AI collaboration quality | 25 pts | Prompt sophistication, verification behavior, failure recovery | Telemetry + rubric |
| Comprehension & transfer | 25 pts | Explanation quality, variant problem performance | Human rubric + automated |
| Code review judgment | 25 pts | Accuracy of evaluation, reasoning quality on AI-generated PR | BARS rubric |

---

## 8. How This Maps to Pipe's Existing Infrastructure

| Pipe component | How it connects |
|---|---|
| Repo catalog (crawler) | Provides the repos with planted bugs and ground truth test suites |
| Construct taxonomy (60 slugs) | Determines which bug types to plant based on role requirements |
| Seniority bands | Calibrates difficulty — junior bugs are simpler, senior bugs require architectural understanding |
| Implementer agent | Could serve as the AI assistant in the dev container, now instrumented |
| Scoring panel (Devstral) | Handles automated dimensions; human review for subjective dimensions |
| Role Discovery | Determines which repo, bug type, and difficulty to select for each candidate |
| PR samples | Direct source of challenges — revert a real fix, candidate must restore it |

The pipeline:
```
Role Discovery → skill/seniority/domain match → matchRepos() → select best PR
→ revert fix (plant bug) → spin up dev container → candidate session
→ telemetry + ground truth scoring → report
```

---

## Open Questions

1. **Container cold start time**: Fly.io Machines can cold start in ~300ms but a full repo clone + dependency install adds latency. Can you pre-warm containers with popular repos?

2. **AI assistant model choice**: Do you provide Copilot? Claude? GPT? Or your own implementer agent? The choice affects what telemetry you can capture — your own agent gives full logging; third-party tools may not.

3. **Calibration across repos**: A bug in a React app is fundamentally different difficulty than a bug in a Rust async runtime, even at the "same" seniority band. How do you normalize scores across repos? The OSCE approach (multiple independent stations) partially addresses this.

4. **Candidate gaming**: If candidates know the AI assistant is logged, they may behave differently than they would in real work. The transfer test (no-AI variant) partially controls for this, but it's a validity threat.

5. **Time investment**: 60 minutes is significant candidate time. Is the signal-per-minute high enough vs. the existing 15-minute code review challenge? The research says yes (MMI: more independent samples = higher reliability), but candidates may drop off.

6. **Construct-to-bug-type mapping**: The 60-slug construct taxonomy needs a mapping to specific bug templates. This is CR-15 in STRATEGY.md — the most critical next step after this research.

7. **What seniority level is this appropriate for?** The transfer test (no-AI variant) may be too easy for staff engineers and too hard for juniors. The session structure may need seniority-specific variants.
