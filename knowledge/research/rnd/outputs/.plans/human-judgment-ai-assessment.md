# Research Plan: Human Judgment in AI-Augmented Engineering Assessment

## Core question
What is the human skill that matters when AI does the typing, how do you measure it scientifically, and what does a concrete assessment product look like that tests it?

## Sub-questions

### Cognitive foundations
1. What does automation bias research (aviation, medicine, nuclear) tell us about when humans fail to override AI? What interventions reduce complacency?
2. What metacognitive behaviors distinguish experts who effectively supervise AI from those who blindly defer? Is this trainable or innate?
3. What does calibration research say — can you measure whether someone knows what they don't know about AI output?

### Assessment design (from domains that already test judgment-not-execution)
4. How do medical OSCEs, aviation check rides, and legal performance tests design tasks that force demonstrated reasoning — not just correct answers?
5. What scoring rubrics exist for "quality of judgment" vs "correctness of output" in these domains?
6. How does SWE-bench / DevBench / CodeContests / HumanEval structure tasks and scoring? What works, what fails, what's the gap for AI-augmented work?

### What "good" looks like in practice
7. How do senior engineers actually work with AI today? Observed patterns from companies that adopted Copilot/Cursor at scale — not theory, real behavior.
8. What distinguishes a senior engineer who uses AI well from a junior who over-relies on it? Is there research or even anecdotal signal?
9. What do engineering managers say they wish they could test for in interviews now that AI has changed how people work?

### Instrumentable signals in live environments
10. What can you actually capture in a dev container (VS Code Server, Fly.io Machine, Codespaces)? Editor events, terminal history, git operations, file navigation, AI completion acceptance/rejection?
11. Which of these signals have been studied as predictors of code quality or developer expertise? Separate noise from signal.
12. How do you score open-ended work in a real codebase without just having another AI grade it? What are the alternatives — planted bugs, test suites, diff analysis, human rubrics?

### Agentic workflow comprehension
13. What does "directing an AI agent" look like as a testable skill? Can the candidate define the right constraints, predict failure modes, intervene at the right time?
14. Is there any emerging research on agent supervision as a cognitive skill? HCI papers, AI safety research, RLHF annotation quality studies?
15. What would a concrete "debug this broken agent workflow" task look like — and is there prior art?

### Product design bridge
16. What does a concrete assessment session look like from the candidate's perspective? 30 minutes? 60 minutes? What's the flow?
17. What's the minimum viable instrumentation — what do you capture on day one vs what's aspirational?
18. How do you avoid the grading paradox — if AI grades the candidate's AI-augmented work, what's the validity?

## Strategy
- **Researcher A:** Cognitive science + human factors — automation bias, complacency, metacognition, calibration. Academic papers from aviation, medicine, nuclear, autonomous vehicles. Focus on interventions that work, not just descriptions of failure. Must include concrete assessment implications.
- **Researcher B:** Assessment design prior art — medical OSCEs, aviation check rides, legal performance tests, AND software-specific benchmarks (SWE-bench, DevBench, CodeContests). How do these domains structure tasks, score judgment, and handle open-ended evaluation? Must extract design principles, not just describe systems.
- **Researcher C:** Developer behavior + telemetry — how do real engineers use AI today (ethnographic), what IDE/editor signals are capturable, what correlates with quality. Developer surveys (GitHub, StackOverflow, JetBrains), Copilot adoption studies, process metrics research. Must ground in what's technically instrumentable.
- **Researcher D:** Agentic AI interaction + product design — human-agent collaboration research, agent supervision, workflow orchestration, AND how this maps to a concrete candidate experience. What would the session look like? What's the task flow? How do you score it? Must bridge from theory to product.

Expected rounds: 1 primary, 1 targeted follow-up if agentic research is too thin.

## Acceptance criteria
- [ ] Automation bias interventions with ≥3 independent studies and concrete design implications
- [ ] ≥2 non-software domains where judgment-not-execution is assessed, with extractable task design principles
- [ ] SWE-bench / DevBench task structure analyzed with gaps identified for AI-augmented assessment
- [ ] ≥2 sources on real developer AI usage patterns (not surveys — observed behavior or case studies)
- [ ] ≥2 sources on capturable IDE/editor telemetry with quality correlation evidence
- [ ] At least 1 source on agentic workflow assessment or human-agent supervision skills
- [ ] Contradictions between "trust AI" and "verify AI" research identified and addressed
- [ ] Concrete task design principles extracted — not just theory
- [ ] Grading paradox addressed — how to score without AI-grading-AI circularity
- [ ] At least a rough sketch of what a 30-60 minute candidate session looks like

## Task ledger
| ID | Owner | Task | Status | Output |
|---|---|---|---|---|
| T1 | researcher | Cognitive science: automation bias, metacognition, calibration, human-AI oversight interventions | done | knowledge/rnd/outputs/human-judgment-research-cognitive.md |
| T2 | researcher | Assessment design: OSCEs, check rides, legal exams, SWE-bench, DevBench — task structures + scoring | done | knowledge/rnd/outputs/human-judgment-research-assessment.md |
| T3 | researcher | Developer behavior: real AI usage patterns, capturable telemetry, quality correlation evidence | done | knowledge/rnd/outputs/human-judgment-research-telemetry.md |
| T4 | researcher | Agentic interaction + product design: supervision skills, workflow comprehension, candidate session design | done | knowledge/rnd/outputs/human-judgment-research-agentic.md |
| T5 | lead | Synthesis draft — 8-section brief combining all research | done | knowledge/rnd/outputs/.drafts/human-judgment-ai-assessment-draft.md |
| T6 | verifier | Add inline citations, verify URLs | done | knowledge/rnd/outputs/human-judgment-ai-assessment-brief.md |
| T7 | reviewer | Evidence-integrity verification pass | done | knowledge/rnd/outputs/human-judgment-ai-assessment-verification.md |
| T8 | lead | Fix FATAL + MAJOR issues from review, deliver to papers/ | done | knowledge/rnd/papers/human-judgment-ai-assessment.md |

## Verification log
| Item | Method | Status | Evidence |
|---|---|---|---|
| Automation bias stats (44% drop, 92.8→23.6%) | Cross-referenced cognitive.md sources | pending | Verifier agent checking |
| OSCE reliability (14+ questions for 0.80) | Cross-referenced assessment.md sources | pending | Verifier agent checking |
| Code churn 41% higher | Cross-referenced telemetry.md sources | pending | Verifier agent checking |
| SWE-bench contamination (35-point gap) | Cross-referenced assessment.md sources | pending | Verifier agent checking |
| 3-5× agent debugging time | Cross-referenced agentic.md sources | pending | Verifier agent checking |

## Decision log
- **2026-04-10:** All 4 research dimensions completed in single round. No follow-up round needed — agentic research was sufficiently grounded (RLHF annotator analogy, agent failure taxonomy, session blueprint all backed by sources).
- **2026-04-10:** Draft synthesis written by lead. Key decisions: structured as 8 sections mapping research → product design; included concrete 60-min session blueprint; addressed grading paradox with 5 solutions; mapped directly to Pipe infrastructure.
